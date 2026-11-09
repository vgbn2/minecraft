// Sovereign Hard-Money Diamond Standard ($DIA) Ledger, 2-Phase Custody & Unit-Integral AMM
// ponytail: built on native node:sqlite DatabaseSync in WAL mode; zero external database packages
import { DatabaseSync } from 'node:sqlite'

export const CRED_PER_DIAMOND = 100
export const CRED_PER_ANCIENT_DEBRIS = 1000

// Strictly non-farmable physical reserve ores per Minecraft Wiki renewability rules
export const NON_FARMABLE_RESERVE_ORES = new Map([
  ['diamond_ore', { reserveAsset: 'diamond', credMint: CRED_PER_DIAMOND }],
  ['deepslate_diamond_ore', { reserveAsset: 'diamond', credMint: CRED_PER_DIAMOND }],
  ['ancient_debris', { reserveAsset: 'ancient_debris', credMint: CRED_PER_ANCIENT_DEBRIS }]
])

export class DiamondStandardLedger {
  constructor(dbPath = ':memory:') {
    this.dbPath = dbPath
    this.db = new DatabaseSync(dbPath)
    this._initSchema()
  }

  _initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS reserve_vault (
        asset TEXT PRIMARY KEY,
        physical_units INTEGER NOT NULL DEFAULT 0 CHECK (physical_units >= 0),
        minted_cred INTEGER NOT NULL DEFAULT 0 CHECK (minted_cred >= 0)
      );

      INSERT OR IGNORE INTO reserve_vault (asset, physical_units, minted_cred) VALUES ('diamond', 0, 0);
      INSERT OR IGNORE INTO reserve_vault (asset, physical_units, minted_cred) VALUES ('ancient_debris', 0, 0);

      CREATE TABLE IF NOT EXISTS accounts (
        agent_id TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'citizen',
        balance_cred INTEGER NOT NULL DEFAULT 0 CHECK (balance_cred >= 0)
      );

      INSERT OR IGNORE INTO accounts (agent_id, role, balance_cred) VALUES ('TREASURY_VAULT', 'sovereign', 0);

      CREATE TABLE IF NOT EXISTS provenance_claims (
        claim_id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_epoch INTEGER NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        z INTEGER NOT NULL,
        block_type TEXT NOT NULL,
        miner_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING_CUSTODY', 'VERIFIED_MINTED', 'REJECTED')),
        chest_id TEXT,
        verified_by TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(world_epoch, x, y, z)
      );

      CREATE TABLE IF NOT EXISTS ledger_entries (
        tx_id INTEGER PRIMARY KEY AUTOINCREMENT,
        debit_account TEXT NOT NULL,
        credit_account TEXT NOT NULL,
        amount_cred INTEGER NOT NULL CHECK (amount_cred > 0),
        reason TEXT NOT NULL,
        ref_claim_id INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS market_inventory (
        item_type TEXT PRIMARY KEY,
        base_price_cred INTEGER NOT NULL CHECK (base_price_cred > 0),
        decay_lambda REAL NOT NULL DEFAULT 0.015,
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)
      );

      CREATE TABLE IF NOT EXISTS chest_locks (
        chest_id TEXT PRIMARY KEY,
        holder_id TEXT,
        fencing_token INTEGER NOT NULL DEFAULT 0,
        expires_at_ms INTEGER NOT NULL DEFAULT 0
      );
    `)
  }

  ensureAccount(agentId, role = 'citizen', initialCred = 0) {
    const stmt = this.db.prepare(`
      INSERT INTO accounts (agent_id, role, balance_cred)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        balance_cred = MAX(accounts.balance_cred, excluded.balance_cred)
    `)
    stmt.run(String(agentId), String(role), Math.max(0, Math.floor(initialCred)))
  }

  getBalance(agentId) {
    const row = this.db.prepare('SELECT balance_cred FROM accounts WHERE agent_id = ?').get(String(agentId))
    return row ? Number(row.balance_cred) : 0
  }

  getReserveState() {
    const rows = this.db.prepare('SELECT asset, physical_units, minted_cred FROM reserve_vault').all()
    const out = {}
    for (const r of rows) {
      out[r.asset] = {
        physicalUnits: Number(r.physical_units),
        mintedCred: Number(r.minted_cred)
      }
    }
    return out
  }

  // Phase 1: Submit Proof-of-Extraction Claim (strictly rejects renewable/farmable items)
  submitProvenanceClaim({ minerId, blockType, x, y, z, worldEpoch = 1, nowMs = Date.now() }) {
    const cleanBlock = String(blockType || '').toLowerCase()
    if (!NON_FARMABLE_RESERVE_ORES.has(cleanBlock)) {
      throw new Error(
        `Rejected '${cleanBlock}': base money minting requires strictly non-farmable diamond_ore, deepslate_diamond_ore, or ancient_debris`
      )
    }
    this.ensureAccount(minerId)
    const stmt = this.db.prepare(`
      INSERT INTO provenance_claims (world_epoch, x, y, z, block_type, miner_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING_CUSTODY', ?)
    `)
    const res = stmt.run(
      Math.floor(worldEpoch),
      Math.floor(x),
      Math.floor(y),
      Math.floor(z),
      cleanBlock,
      String(minerId),
      Math.floor(nowMs)
    )
    return {
      claimId: Number(res.lastInsertRowid),
      status: 'PENDING_CUSTODY'
    }
  }

  // Monotonic fencing_token lock for physical Treasury / Depot chests
  acquireChestLock(chestId, holderId, nowMs = Date.now(), ttlMs = 10000) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT holder_id, fencing_token, expires_at_ms FROM chest_locks WHERE chest_id = ?').get(String(chestId))
      if (existing && existing.holder_id && existing.holder_id !== holderId && Number(existing.expires_at_ms) > nowMs) {
        this.db.exec('COMMIT')
        return { ok: false, fencingToken: null, holderId: existing.holder_id }
      }
      const nextToken = existing ? Number(existing.fencing_token) + 1 : 1
      const expiresAt = Math.floor(nowMs + Math.max(100, ttlMs))
      this.db.prepare(`
        INSERT INTO chest_locks (chest_id, holder_id, fencing_token, expires_at_ms)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(chest_id) DO UPDATE SET
          holder_id = excluded.holder_id,
          fencing_token = excluded.fencing_token,
          expires_at_ms = excluded.expires_at_ms
      `).run(String(chestId), String(holderId), nextToken, expiresAt)
      this.db.exec('COMMIT')
      return { ok: true, fencingToken: nextToken, expiresAt }
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw err
    }
  }

  verifyFencingToken(chestId, holderId, fencingToken, nowMs = Date.now()) {
    const row = this.db.prepare('SELECT holder_id, fencing_token, expires_at_ms FROM chest_locks WHERE chest_id = ?').get(String(chestId))
    if (!row) return false
    return (
      row.holder_id === String(holderId) &&
      Number(row.fencing_token) === Number(fencingToken) &&
      Number(row.expires_at_ms) > nowMs
    )
  }

  // Phase 2: Verify physical chest delta & atomically mint $CRED backed 1:1 by physical $DIA / ancient_debris
  verifyTreasuryDeposit({ claimId, chestId, observedDelta, verifierId = 'Foreman_1', fencingToken, nowMs = Date.now() }) {
    if (!Number.isInteger(observedDelta) || observedDelta < 1) {
      throw new Error('Treasury custody verification failed: observed physical chest delta must be >= 1')
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const claim = this.db.prepare('SELECT * FROM provenance_claims WHERE claim_id = ?').get(Number(claimId))
      if (!claim) {
        throw new Error(`Provenance claim ${claimId} not found`)
      }
      if (claim.status !== 'PENDING_CUSTODY') {
        throw new Error(`Provenance claim ${claimId} already processed (${claim.status})`)
      }
      if (fencingToken !== undefined) {
        const validLock = this.verifyFencingToken(chestId, claim.miner_id, fencingToken, nowMs)
        if (!validLock) {
          throw new Error(`Stale or invalid fencing_token ${fencingToken} for chest ${chestId}`)
        }
      }

      const spec = NON_FARMABLE_RESERVE_ORES.get(claim.block_type)
      if (!spec) {
        throw new Error(`Invalid reserve block_type: ${claim.block_type}`)
      }
      const mintedCred = spec.credMint

      this.db.prepare(`
        UPDATE provenance_claims
        SET status = 'VERIFIED_MINTED', chest_id = ?, verified_by = ?
        WHERE claim_id = ?
      `).run(String(chestId), String(verifierId), Number(claimId))

      this.db.prepare(`
        UPDATE reserve_vault
        SET physical_units = physical_units + 1,
            minted_cred = minted_cred + ?
        WHERE asset = ?
      `).run(mintedCred, spec.reserveAsset)

      this.ensureAccount(claim.miner_id)
      this.db.prepare(`
        UPDATE accounts
        SET balance_cred = balance_cred + ?
        WHERE agent_id = ?
      `).run(mintedCred, claim.miner_id)

      this.db.prepare(`
        INSERT INTO ledger_entries (debit_account, credit_account, amount_cred, reason, ref_claim_id, created_at)
        VALUES ('TREASURY_VAULT', ?, ?, ?, ?, ?)
      `).run(claim.miner_id, mintedCred, `MINT_${spec.reserveAsset.toUpperCase()}`, Number(claimId), Math.floor(nowMs))

      this.db.exec('COMMIT')
      return {
        ok: true,
        claimId: Number(claimId),
        minerId: claim.miner_id,
        mintedCred,
        newBalanceCred: this.getBalance(claim.miner_id)
      }
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw err
    }
  }

  registerCommodity(itemType, basePriceCred = 20, decayLambda = 0.02, initialStock = 10) {
    this.db.prepare(`
      INSERT INTO market_inventory (item_type, base_price_cred, decay_lambda, stock)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(item_type) DO UPDATE SET
        base_price_cred = excluded.base_price_cred,
        decay_lambda = excluded.decay_lambda,
        stock = excluded.stock
    `).run(String(itemType), Math.max(1, Math.floor(basePriceCred)), Number(decayLambda), Math.max(0, Math.floor(initialStock)))
  }

  static unitPriceAtStock(basePriceCred, decayLambda, stockLevel) {
    return Math.max(1, Math.round(basePriceCred * Math.exp(-decayLambda * stockLevel)))
  }

  // Exact discrete unit-integral quote when agent SELLS qty items into market (stock increases S -> S + qty)
  quoteSellToMarket(itemType, qty) {
    const n = Math.floor(Number(qty))
    if (n <= 0) return 0
    const row = this.db.prepare('SELECT base_price_cred, decay_lambda, stock FROM market_inventory WHERE item_type = ?').get(String(itemType))
    if (!row) throw new Error(`Unknown commodity: ${itemType}`)
    let totalCred = 0
    for (let k = 0; k < n; k++) {
      totalCred += DiamondStandardLedger.unitPriceAtStock(row.base_price_cred, row.decay_lambda, row.stock + k)
    }
    return totalCred
  }

  // Exact discrete unit-integral quote when agent BUYS qty items from market (stock decreases S -> S - qty)
  quoteBuyFromMarket(itemType, qty) {
    const n = Math.floor(Number(qty))
    if (n <= 0) return 0
    const row = this.db.prepare('SELECT base_price_cred, decay_lambda, stock FROM market_inventory WHERE item_type = ?').get(String(itemType))
    if (!row) throw new Error(`Unknown commodity: ${itemType}`)
    if (row.stock < n) throw new Error(`Insufficient market stock for ${itemType}: have ${row.stock}, requested ${n}`)
    let totalCred = 0
    for (let k = 0; k < n; k++) {
      totalCred += DiamondStandardLedger.unitPriceAtStock(row.base_price_cred, row.decay_lambda, row.stock - 1 - k)
    }
    return totalCred
  }

  sellToMarket(agentId, itemType, qty, nowMs = Date.now()) {
    const n = Math.floor(Number(qty))
    if (n <= 0) throw new Error('Quantity must be >= 1')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.ensureAccount(agentId)
      const payoutCred = this.quoteSellToMarket(itemType, n)
      const treasuryBal = this.getBalance('TREASURY_VAULT')
      if (treasuryBal < payoutCred) {
        throw new Error(`Treasury liquidity insufficient: has ${treasuryBal} $CRED, needs ${payoutCred} $CRED`)
      }
      this.db.prepare('UPDATE market_inventory SET stock = stock + ? WHERE item_type = ?').run(n, String(itemType))
      this.db.prepare('UPDATE accounts SET balance_cred = balance_cred - ? WHERE agent_id = ?').run(payoutCred, 'TREASURY_VAULT')
      this.db.prepare('UPDATE accounts SET balance_cred = balance_cred + ? WHERE agent_id = ?').run(payoutCred, String(agentId))
      this.db.prepare(`
        INSERT INTO ledger_entries (debit_account, credit_account, amount_cred, reason, created_at)
        VALUES ('TREASURY_VAULT', ?, ?, ?, ?)
      `).run(String(agentId), payoutCred, `AMM_SELL_${itemType}_${n}`, Math.floor(nowMs))
      this.db.exec('COMMIT')
      return { payoutCred, newBalanceCred: this.getBalance(agentId) }
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw err
    }
  }

  buyFromMarket(agentId, itemType, qty, nowMs = Date.now()) {
    const n = Math.floor(Number(qty))
    if (n <= 0) throw new Error('Quantity must be >= 1')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.ensureAccount(agentId)
      const costCred = this.quoteBuyFromMarket(itemType, n)
      const buyerBal = this.getBalance(agentId)
      if (buyerBal < costCred) {
        throw new Error(`Agent ${agentId} balance insufficient: has ${buyerBal} $CRED, needs ${costCred} $CRED`)
      }
      this.db.prepare('UPDATE market_inventory SET stock = stock - ? WHERE item_type = ?').run(n, String(itemType))
      this.db.prepare('UPDATE accounts SET balance_cred = balance_cred - ? WHERE agent_id = ?').run(costCred, String(agentId))
      this.db.prepare('UPDATE accounts SET balance_cred = balance_cred + ? WHERE agent_id = ?').run(costCred, 'TREASURY_VAULT')
      this.db.prepare(`
        INSERT INTO ledger_entries (debit_account, credit_account, amount_cred, reason, created_at)
        VALUES (?, 'TREASURY_VAULT', ?, ?, ?)
      `).run(String(agentId), costCred, `AMM_BUY_${itemType}_${n}`, Math.floor(nowMs))
      this.db.exec('COMMIT')
      return { costCred, newBalanceCred: this.getBalance(agentId) }
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw err
    }
  }

  close() {
    try { this.db.close() } catch {}
  }
}
