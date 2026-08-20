package admission

import (
	"encoding/json"
	"github.com/vgbn2/minecraft/internal/model"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func fixture() (model.Config, model.Profile, model.Snapshot) {
	now := time.Now().UTC()
	cfg := model.Config{MaxSnapshotAgeSecs: 90, ManagedHeapMaxMB: 6656, MinAvailableMB: 3072, NativeOverheadMB: 512, RootStorage: model.StorageTarget{Path: "/", MinFreePercent: 10, MinFreeBytes: 20 << 30, MinInodePct: 10}, ServerStorage: model.StorageTarget{Path: "/servers", MinFreePercent: 10, MinFreeBytes: 20 << 30, MinInodePct: 10}, BackupStorage: model.StorageTarget{Path: "/backups", MinFreePercent: 15}}
	profile := model.Profile{ID: "fabric", CraftyServerID: "fabric-id", Resources: model.Resources{HeapInitialMB: 1024, HeapMaxMB: 2560}}
	storage := func(path string) model.StorageMetric {
		return model.StorageMetric{Path: path, FreeBytes: 50 << 30, FreePercent: 50, FreeInodePercent: 50}
	}
	snapshot := model.Snapshot{SchemaVersion: 1, SampledAt: now, MonitorHealthy: true, CraftyHealthy: true, TimeSyncHealthy: true, MemAvailableBytes: 8 << 30, RootStorage: storage("/"), ServerStorage: storage("/servers"), BackupStorage: storage("/backups"), Servers: []model.ServerMetric{{ID: "paper-id", Running: true, HeapMaxMB: 4096}}}
	return cfg, profile, snapshot
}
func TestAllowsPaperPlusFabricAtExactCap(t *testing.T) {
	cfg, profile, snapshot := fixture()
	decision := Evaluate(snapshot.SampledAt, cfg, profile, snapshot, nil)
	if !decision.Allowed || decision.ProjectedHeapMB != 6656 {
		t.Fatalf("unexpected decision: %+v", decision)
	}
}
func TestStaleSnapshotFailsClosed(t *testing.T) {
	cfg, profile, snapshot := fixture()
	decision := Evaluate(snapshot.SampledAt.Add(91*time.Second), cfg, profile, snapshot, nil)
	if decision.Allowed {
		t.Fatalf("stale snapshot allowed: %+v", decision)
	}
}
func TestReservationPreventsConcurrentOvercommit(t *testing.T) {
	cfg, profile, snapshot := fixture()
	snapshot.Servers = nil
	reservations := []Reservation{{ServerID: "other", HeapMB: 4097}}
	decision := Evaluate(snapshot.SampledAt, cfg, profile, snapshot, reservations)
	if decision.Allowed {
		t.Fatalf("reservation overcommit allowed: %+v", decision)
	}
}
func TestOldSwapWithoutSwapOutDoesNotReject(t *testing.T) {
	cfg, profile, snapshot := fixture()
	snapshot.SwapOutMiBPerMinute = 0
	snapshot.SwapOutSamples = 100
	decision := Evaluate(snapshot.SampledAt, cfg, profile, snapshot, nil)
	if !decision.Allowed {
		t.Fatalf("inactive swap rejected: %+v", decision)
	}
}

func TestLoadSnapshotReadsV1AndV2(t *testing.T) {
	for _, version := range []int{1, 2} {
		path := filepath.Join(t.TempDir(), "snapshot.json")
		raw, err := json.Marshal(model.Snapshot{SchemaVersion: version, Issues: []model.CollectionIssue{{Code: "fixture", Component: "test"}}})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		got, err := LoadSnapshot(path)
		if err != nil || got.SchemaVersion != version {
			t.Fatalf("version=%d got=%+v err=%v", version, got, err)
		}
	}
}
