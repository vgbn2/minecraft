package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vgbn2/minecraft/internal/model"
)

func writeCraftyFixtureConfig(t *testing.T, baseURL string) string {
	t.Helper()
	root := t.TempDir()
	token := filepath.Join(root, "crafty.token")
	if err := os.WriteFile(token, []byte("fixture-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := func(path string, percent float64, bytes int64, inodes float64) model.StorageTarget {
		return model.StorageTarget{Path: path, MinFreePercent: percent, MinFreeBytes: bytes, MinInodePct: inodes}
	}
	cfg := model.Config{
		SchemaVersion: 2, StateDir: filepath.Join(root, "state"), ProfileDir: filepath.Join(root, "profiles"),
		ServerRoot: filepath.Join(root, "servers"), BackupStagingRoot: filepath.Join(root, "backups"),
		SnapshotPath: filepath.Join(root, "state", "snapshot.json"), MonitorDBPath: filepath.Join(root, "state", "monitor.db"),
		OperationLockPath: filepath.Join(root, "state", "operation.lock"), MaxSnapshotAgeSecs: 90,
		ManagedHeapMaxMB: 6656, MinAvailableMB: 3072, NativeOverheadMB: 512, ReservationTTLSecs: 300, CraftyServiceUID: 1500,
		Crafty:      model.CraftyConfig{BaseURL: baseURL, TokenFile: token, OpenAPIVersion: "2.0.1", OpenAPISHA256: strings.Repeat("a", 64), AllowInsecureLocal: true, RequestTimeoutSecs: 2},
		RootStorage: target("/", 10, 20<<30, 10), ServerStorage: target(filepath.Join(root, "servers"), 10, 20<<30, 10),
		BackupStorage: target(filepath.Join(root, "backups"), 15, 0, 0),
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "config.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCraftyCommandsUseFakeHTTPSContract(t *testing.T) {
	requests := make(chan string, 3)
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Errorf("unexpected authorization header")
		}
		requests <- request.Method + " " + request.URL.Path
		switch request.URL.Path {
		case "/api/v2/servers":
			fmt.Fprint(writer, `{"status":"ok","data":[{"server_id":"one","server_name":"Paper"}]}`)
		case "/api/v2/servers/one/stats":
			fmt.Fprint(writer, `{"status":"ok","data":{"running":true,"online":2}}`)
		case "/api/v2/servers/one/action/stop_server":
			fmt.Fprint(writer, `{"status":"ok"}`)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	configPath := writeCraftyFixtureConfig(t, server.URL)
	cases := [][]string{
		{"crafty", "servers", "--config", configPath},
		{"crafty", "stats", "--config", configPath, "--server", "one"},
		{"crafty", "action", "--config", configPath, "--server", "one", "--action", "stop_server"},
	}
	for _, args := range cases {
		var stdout, stderr bytes.Buffer
		if code := Run(context.Background(), args, &stdout, &stderr); code != 0 {
			t.Fatalf("args=%v code=%d stdout=%q stderr=%q", args, code, stdout.String(), stderr.String())
		}
	}
	want := []string{"GET /api/v2/servers", "GET /api/v2/servers/one/stats", "POST /api/v2/servers/one/action/stop_server"}
	for _, expected := range want {
		if got := <-requests; got != expected {
			t.Fatalf("request=%q want=%q", got, expected)
		}
	}
}

func TestCraftyCommandLogsStructuredRedactedAPIError(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(writer, `token=fixture-token path=/private/world player=alice`)
	}))
	defer server.Close()
	configPath := writeCraftyFixtureConfig(t, server.URL)
	var stdout, stderr bytes.Buffer
	code := Run(context.Background(), []string{"--json", "crafty", "servers", "--config", configPath}, &stdout, &stderr)
	combined := stdout.String() + stderr.String()
	if code != 2 || !strings.Contains(stderr.String(), `"event":"crafty_api_error"`) || !strings.Contains(stderr.String(), `"status":401`) {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
	}
	for _, secret := range []string{"fixture-token", "/private/world", "alice"} {
		if strings.Contains(combined, secret) {
			t.Fatalf("leaked %q in %q", secret, combined)
		}
	}
}

func TestLoadProfilesRejectsDuplicateCraftyOwnership(t *testing.T) {
	dir := t.TempDir()
	base := model.Profile{
		SchemaVersion: 2, ID: "paper-one", Approved: true, ServerType: "paper", MinecraftVersion: "1.21.11", JavaVersion: 21,
		Artifact:  model.Artifact{Kind: "paper", Version: "1.21.11", DownloadURL: "https://example.com/paper.jar", SHA256: strings.Repeat("a", 64)},
		Resources: model.Resources{HeapInitialMB: 1024, HeapMaxMB: 2048}, Security: model.Security{OnlineMode: true},
		CraftyServerID: "11111111-1111-4111-8111-111111111111", ServerRoot: "/srv/minecraft/servers/one", Port: 25565, CompatibilityEvidence: "fixture",
	}
	for index := 0; index < 2; index++ {
		value := base
		value.ID = fmt.Sprintf("paper-%s", []string{"one", "two"}[index])
		value.ServerRoot = fmt.Sprintf("/srv/minecraft/servers/%d", index)
		value.Port += index
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.json", index)), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := loadProfiles(dir); err == nil || !strings.Contains(err.Error(), "duplicate Crafty server UUID") {
		t.Fatalf("unexpected duplicate result %v", err)
	}
}
