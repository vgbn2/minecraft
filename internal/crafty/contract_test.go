package crafty

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/vgbn2/minecraft/internal/model"
)

func TestPinnedRequiredContract(t *testing.T) {
	raw, err := os.ReadFile("testdata/crafty-v2-required.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		APIVersion   string `json:"api_version"`
		SourceSHA256 string `json:"source_sha256"`
		Operations   []struct {
			Method string `json:"method"`
			Path   string `json:"path"`
		} `json:"required_operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	if contract.APIVersion != ContractVersion || len(contract.SourceSHA256) != 64 {
		t.Fatalf("invalid pinned contract: %+v", contract)
	}
	want := map[string]bool{"GET /api/v2/servers": false, "GET /api/v2/servers/{serverID}/stats": false, "POST /api/v2/servers/{serverID}/action/{action}": false}
	for _, operation := range contract.Operations {
		key := operation.Method + " " + operation.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for operation, present := range want {
		if !present {
			t.Fatalf("required operation missing: %s", operation)
		}
	}
}

func TestVerifyOpenAPIRejectsDrift(t *testing.T) {
	raw := []byte("openapi: 3.0.4\ninfo:\n  version: 2.0.1\npaths:\n  /api/v2/servers:\n  /api/v2/servers/{serverID}/stats:\n  /api/v2/servers/{serverID}/action/{action}:\n")
	path := filepath.Join(t.TempDir(), "openapi.yml")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := model.CraftyConfig{OpenAPIVersion: "2.0.1", OpenAPISHA256: fmt.Sprintf("%x", sha256.Sum256(raw))}
	if err := VerifyOpenAPI(path, cfg); err != nil {
		t.Fatal(err)
	}
	cfg.OpenAPISHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if err := VerifyOpenAPI(path, cfg); err == nil {
		t.Fatal("drifted contract passed")
	}
}
