package crafty

import (
	"crypto/sha256"
	"fmt"
	"os"
	"strings"

	"github.com/vgbn2/minecraft/internal/model"
)

func VerifyOpenAPI(path string, cfg model.CraftyConfig) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read Crafty OpenAPI contract: %w", err)
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(raw))
	if digest != cfg.OpenAPISHA256 {
		return fmt.Errorf("Crafty OpenAPI checksum mismatch: got %s", digest)
	}
	for _, required := range []string{"version: " + cfg.OpenAPIVersion, "/api/v2/servers:", "/api/v2/servers/{serverID}/stats:", "/api/v2/servers/{serverID}/action/{action}:"} {
		if !strings.Contains(string(raw), required) {
			return fmt.Errorf("Crafty OpenAPI contract missing %q", required)
		}
	}
	return nil
}
