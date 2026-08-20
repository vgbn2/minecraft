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
