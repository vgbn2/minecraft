package statefile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteJSONAtomicPromotesPrivateCompleteDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "state.json")
	if err := WriteJSONAtomic(path, map[string]string{"status": "healthy"}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"status": "healthy"`) || raw[len(raw)-1] != '\n' {
		t.Fatalf("unexpected document %q", raw)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("mode=%o", info.Mode().Perm())
	}
}
