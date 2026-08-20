package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	controlconfig "github.com/vgbn2/minecraft/internal/config"
	"github.com/vgbn2/minecraft/internal/model"
	"github.com/vgbn2/minecraft/internal/monitor"
	"github.com/vgbn2/minecraft/internal/statefile"
)

func TestGateCommandReleasesReservationWhenJavaLookupFails(t *testing.T) {
	configPath := writeCraftyFixtureConfig(t, "https://127.0.0.1:8443")
	cfg, err := controlconfig.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	serverRoot := filepath.Join(cfg.ServerRoot, "paper")
	if err := os.MkdirAll(serverRoot, 0o750); err != nil {
		t.Fatal(err)
	}
	jarRaw := []byte("server")
	jar := filepath.Join(serverRoot, "server.jar")
	if err := os.WriteFile(jar, jarRaw, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(serverRoot, "server.properties"), []byte("online-mode=true\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	profile := model.Profile{
		SchemaVersion: 2, ID: "paper-main", Approved: true, ServerType: "paper", MinecraftVersion: "1.21.11", JavaVersion: 21,
		Artifact:  model.Artifact{Kind: "paper", Version: "1.21.11", DownloadURL: "https://example.com/server.jar", SHA256: fmt.Sprintf("%x", sha256.Sum256(jarRaw))},
		Resources: model.Resources{HeapInitialMB: 1024, HeapMaxMB: 2048}, Security: model.Security{OnlineMode: true},
		CraftyServerID: "11111111-1111-4111-8111-111111111111", ServerRoot: serverRoot, Port: 25565, CompatibilityEvidence: "fixture",
	}
	rawProfile, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	profilePath := filepath.Join(filepath.Dir(configPath), "profile.json")
	if err := os.WriteFile(profilePath, rawProfile, 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	storage := func(target model.StorageTarget) model.StorageMetric {
		return model.StorageMetric{Path: target.Path, FreeBytes: 50 << 30, FreePercent: 50, FreeInodePercent: 50}
	}
	snapshot := model.Snapshot{
		SchemaVersion: 2, SampledAt: now, MonitorHealthy: true, CraftyHealthy: true, TimeSyncHealthy: true, MemAvailableBytes: 10 << 30,
		RootStorage: storage(cfg.RootStorage), ServerStorage: storage(cfg.ServerStorage), BackupStorage: storage(cfg.BackupStorage),
	}
	if err := statefile.WriteJSONAtomic(cfg.SnapshotPath, snapshot); err != nil {
		t.Fatal(err)
	}
	process := processOperations{
		now: func() time.Time { return now }, euid: func() int { return cfg.CraftyServiceUID }, pid: func() int { return 4242 },
		lookPath: func(string) (string, error) { return "", errors.New("java unavailable") },
		exec:     func(string, []string, []string) error { return errors.New("unexpected exec") },
	}
	command := []string{"exec", "--config", configPath, "--profile", profilePath, "--", "java", "-Xms1024M", "-Xmx2048M", "-jar", jar, "nogui"}
	var stderr bytes.Buffer
	if _, err := gateCommandWithOperations(context.Background(), command, &stderr, process); err == nil || err.Error() != "java unavailable" {
		t.Fatalf("err=%v stderr=%q", err, stderr.String())
	}
	store, err := monitor.Open(cfg.MonitorDBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	reservations, err := store.Reservations(context.Background(), now)
	if err != nil || len(reservations) != 0 {
		t.Fatalf("reservations=%v err=%v", reservations, err)
	}
}
