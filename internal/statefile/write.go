package statefile

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// WriteJSONAtomic durably promotes one private JSON state file without exposing
// a partially written document to concurrent readers.
func WriteJSONAtomic(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode state file: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".mcctl-*")
	if err != nil {
		return fmt.Errorf("create temporary state file: %w", err)
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o640); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(raw, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return fmt.Errorf("promote state file: %w", err)
	}
	return nil
}
