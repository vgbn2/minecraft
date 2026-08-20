package atlas

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestSyncAndCheck(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := t.TempDir()
	write := func(relative, content string) {
		path := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(inventoryPath, "# Inventory\n\n"+beginMarker+"\nstale\n"+endMarker+"\n")
	write("workspace/code-atlas/folders/workspace.md", "# Workspace\n")
	command := exec.Command("git", "init", root)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, output)
	}
	command = exec.Command("git", "-C", root, "add", ".")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git add: %v: %s", err, output)
	}
	ctx := context.Background()
	if err := Sync(ctx, root); err != nil {
		t.Fatal(err)
	}
	if err := Check(ctx, root); err != nil {
		t.Fatal(err)
	}
	write("workspace/code-atlas/inventory.md", "# Inventory\n\n"+beginMarker+"\nstale\n"+endMarker+"\n")
	if err := Check(ctx, root); err == nil {
		t.Fatal("stale inventory unexpectedly passed")
	}
}
