package startgate

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/vgbn2/minecraft/internal/model"
	"github.com/vgbn2/minecraft/internal/statefile"
)

func gateFixture(t *testing.T) (model.Config, model.Profile, []string, time.Time) {
	t.Helper()
	root := t.TempDir()
	serverRoot := filepath.Join(root, "servers", "paper")
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
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	storage := func(path string) model.StorageMetric {
		return model.StorageMetric{Path: path, FreeBytes: 50 << 30, FreePercent: 50, FreeInodePercent: 50}
	}
	cfg := model.Config{
		StateDir: root, ServerRoot: filepath.Join(root, "servers"), SnapshotPath: filepath.Join(root, "snapshot.json"),
		MonitorDBPath: filepath.Join(root, "monitor.db"), OperationLockPath: filepath.Join(root, "operation.lock"),
		MaxSnapshotAgeSecs: 90, ManagedHeapMaxMB: 6656, MinAvailableMB: 3072, NativeOverheadMB: 512,
		ReservationTTLSecs: 300, CraftyServiceUID: 1500,
		RootStorage:   model.StorageTarget{Path: "/", MinFreePercent: 10, MinFreeBytes: 20 << 30, MinInodePct: 10},
		ServerStorage: model.StorageTarget{Path: "/servers", MinFreePercent: 10, MinFreeBytes: 20 << 30, MinInodePct: 10},
		BackupStorage: model.StorageTarget{Path: "/backups", MinFreePercent: 15},
	}
	profile := model.Profile{
		ID: "paper-main", CraftyServerID: "server-one", ServerRoot: serverRoot,
		Artifact:  model.Artifact{SHA256: fmt.Sprintf("%x", sha256.Sum256(jarRaw))},
		Resources: model.Resources{HeapInitialMB: 2048, HeapMaxMB: 4096}, Security: model.Security{OnlineMode: true},
	}
	snapshot := model.Snapshot{
		SchemaVersion: 1, SampledAt: now, MonitorHealthy: true, CraftyHealthy: true, TimeSyncHealthy: true,
		MemAvailableBytes: 10 << 30, RootStorage: storage("/"), ServerStorage: storage("/servers"), BackupStorage: storage("/backups"),
	}
	if err := statefile.WriteJSONAtomic(cfg.SnapshotPath, snapshot); err != nil {
		t.Fatal(err)
	}
	return cfg, profile, []string{"java", "-Xms2048M", "-Xmx4096M", "-jar", jar, "nogui"}, now
}

func TestAuthorizeAllowsOneReservationAndReleasesMatchingFailedExec(t *testing.T) {
	cfg, profile, command, now := gateFixture(t)
	ctx := context.Background()
	first, err := Authorize(ctx, Request{Config: cfg, Profile: profile, Command: command, Execute: true, EUID: 1500, PID: 101, Now: now})
	if err != nil || !first.Reserved || !first.Decision.Allowed {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	second, err := Authorize(ctx, Request{Config: cfg, Profile: profile, Command: command, Execute: true, EUID: 1500, PID: 102, Now: now})
	if err != nil || second.Decision.Allowed || len(second.Decision.Reasons) != 1 || second.Decision.Reasons[0] != "start_already_reserved" {
		t.Fatalf("second=%+v err=%v", second, err)
	}
	if err := ReleaseFailedExec(ctx, cfg, profile.CraftyServerID, 102); err == nil {
		t.Fatal("mismatched PID released reservation")
	}
	if err := ReleaseFailedExec(ctx, cfg, profile.CraftyServerID, 101); err != nil {
		t.Fatal(err)
	}
	third, err := Authorize(ctx, Request{Config: cfg, Profile: profile, Command: command, Execute: true, EUID: 1500, PID: 103, Now: now})
	if err != nil || !third.Reserved {
		t.Fatalf("third=%+v err=%v", third, err)
	}
}

func TestAuthorizeFailsClosedForWrongUIDBeforeReservation(t *testing.T) {
	cfg, profile, command, now := gateFixture(t)
	result, err := Authorize(context.Background(), Request{Config: cfg, Profile: profile, Command: command, Execute: true, EUID: 1, PID: 101, Now: now})
	if err == nil || result.Reserved {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestAuthorizeChecksUIDEvenWhenAdmissionWouldReject(t *testing.T) {
	cfg, profile, command, now := gateFixture(t)
	if err := statefile.WriteJSONAtomic(cfg.SnapshotPath, model.Snapshot{SchemaVersion: 2, SampledAt: now}); err != nil {
		t.Fatal(err)
	}
	result, err := Authorize(context.Background(), Request{Config: cfg, Profile: profile, Command: command, Execute: true, EUID: 1, PID: 101, Now: now})
	if err == nil || err.Error() != "gate exec must run as the configured Crafty service UID" || result.Reserved {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestAuthorizeConcurrentSingleReservation(t *testing.T) {
	cfg, profile, command, now := gateFixture(t)
	const contenders = 24
	start := make(chan struct{})
	results := make(chan Result, contenders)
	errorsSeen := make(chan error, contenders)
	var workers sync.WaitGroup
	for index := 0; index < contenders; index++ {
		workers.Add(1)
		go func(pid int) {
			defer workers.Done()
			<-start
			result, err := Authorize(context.Background(), Request{Config: cfg, Profile: profile, Command: command, Execute: true, EUID: 1500, PID: pid, Now: now})
			results <- result
			errorsSeen <- err
		}(1000 + index)
	}
	close(start)
	workers.Wait()
	close(results)
	close(errorsSeen)
	reserved := 0
	for result := range results {
		if result.Reserved {
			reserved++
		}
		if result.Decision.Allowed && !result.Reserved {
			t.Fatalf("allowed contender did not own reservation: %+v", result)
		}
	}
	if reserved != 1 {
		t.Fatalf("reserved winners=%d", reserved)
	}
	for err := range errorsSeen {
		if err != nil && err.Error() != "operation_in_progress" {
			t.Fatalf("unexpected concurrency error %v", err)
		}
	}
}
