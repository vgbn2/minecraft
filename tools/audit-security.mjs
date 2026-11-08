#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const botsDir = join(__dirname, '..', 'bots');

console.log('[SECURITY] Running dependency security audit (--package-lock-only)...');

// Strip any npm lifecycle / config environment variables that cause npm 10+ EALLOWSCRIPTS collisions
const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) {
  if (key.startsWith('npm_config_') || key.startsWith('npm_lifecycle_')) {
    delete cleanEnv[key];
  }
}

let stdout = '';
try {
  stdout = execSync('npm audit --json --package-lock-only', {
    cwd: botsDir,
    encoding: 'utf8',
    env: cleanEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
} catch (error) {
  // npm audit exits with code 1 when vulnerabilities are detected, but still outputs JSON to stdout
  stdout = error.stdout ? error.stdout.toString('utf8') : '';
}

if (!stdout || !stdout.trim().startsWith('{')) {
  console.error('[SECURITY_FAIL] npm audit produced no valid JSON output. Failing closed.');
  process.exit(1);
}

let audit;
try {
  audit = JSON.parse(stdout);
} catch (err) {
  console.error('[SECURITY_FAIL] Failed to parse npm audit JSON output:', err.message);
  process.exit(1);
}

if (audit.error) {
  console.error(`[SECURITY_FAIL] npm audit returned error code ${audit.error.code}: ${audit.error.summary || audit.error.detail}`);
  process.exit(1);
}

const vulns = audit.metadata?.vulnerabilities;
if (!vulns || typeof vulns.critical !== 'number' || typeof vulns.high !== 'number') {
  console.error('[SECURITY_FAIL] Missing or invalid vulnerability metadata in audit report. Failing closed.');
  process.exit(1);
}

console.log(`[SECURITY] Vulnerability summary: critical=${vulns.critical}, high=${vulns.high}, moderate=${vulns.moderate}, low=${vulns.low}`);

// Explicit gate: must strictly satisfy zero critical and zero high severity vulnerabilities
if (vulns.critical === 0 && vulns.high === 0) {
  console.log('[SECURITY_PASS] Zero critical and zero high severity vulnerabilities confirmed.');
  process.exit(0);
} else {
  console.error(`[SECURITY_FAIL] Audit gate violated: found ${vulns.critical} critical and ${vulns.high} high vulnerabilities!`);
  process.exit(1);
}
