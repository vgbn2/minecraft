package app

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestVersionJSONEnvelope(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := Run(context.Background(), []string{"--json", "version"}, &stdout, &stderr)
	if code != 0 || !strings.Contains(stdout.String(), `"ok": true`) || !strings.Contains(stdout.String(), Version) {
		t.Fatalf("unexpected result code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
	}
}
func TestObsoleteTenantCommandIsAbsent(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := Run(context.Background(), []string{"tenant", "start", "tenant-one"}, &stdout, &stderr)
	if code == 0 || !strings.Contains(stderr.String(), "unknown command") {
		t.Fatalf("obsolete lifecycle surface remained: code=%d stderr=%q", code, stderr.String())
	}
}

func TestUnknownCommandJSONContract(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := Run(context.Background(), []string{"--json", "unknown"}, &stdout, &stderr)
	if code != 2 || stderr.Len() != 0 {
		t.Fatalf("unexpected streams code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
	}
	for _, fragment := range []string{`"ok": false`, `"command": "unknown"`, `"code": "command_failed"`, `unknown command`} {
		if !strings.Contains(stdout.String(), fragment) {
			t.Fatalf("missing %q in %q", fragment, stdout.String())
		}
	}
}

func TestJSONFlagDoesNotChangeCommandArguments(t *testing.T) {
	args, enabled := extractJSON([]string{"gate", "check", "--json", "--profile", "one.json"})
	if !enabled || strings.Join(args, " ") != "gate check --profile one.json" {
		t.Fatalf("args=%v enabled=%t", args, enabled)
	}
}
