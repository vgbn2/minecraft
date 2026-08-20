package backup

import (
	"fmt"
	"path/filepath"
	"strings"
)

func RequireStopped(runtimeState string) error {
	if runtimeState != "stopped" {
		return fmt.Errorf("backup requires observed stopped state")
	}
	return nil
}

func ValidateArchivePath(name string) error {
	clean := filepath.Clean(name)
	if filepath.IsAbs(name) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("unsafe archive path %q", name)
	}
	return nil
}
