//go:build linux

package monitor

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
	"time"

	"github.com/vgbn2/minecraft/internal/crafty"
	"github.com/vgbn2/minecraft/internal/model"
)

func TestMonitorLoadQualification(t *testing.T) {
	if os.Getenv("MCCTL_RUN_LOAD_QUALIFICATION") != "1" {
		t.Skip("set MCCTL_RUN_LOAD_QUALIFICATION=1 for the bounded load gate")
	}
	const samples = 720
	path := filepath.Join(t.TempDir(), "monitor.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	startAt := time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)
	runtime.GC()
	var before, after syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &before); err != nil {
		t.Fatal(err)
	}
	wallStart := time.Now()
	for index := 0; index < samples; index++ {
		sampledAt := startAt.Add(time.Duration(index) * 30 * time.Second)
		snapshot := model.Snapshot{
			SchemaVersion: 2, SampledAt: sampledAt, MonitorHealthy: true, CraftyHealthy: true, TimeSyncHealthy: true,
			MemAvailableBytes: int64(8<<30) - int64(index%60)*(4<<20), CPUPercentCurrent: float64(20 + index%10),
			Load1: 2 + float64(index%5)/10, RootStorage: model.StorageMetric{FreeBytes: 80 << 30},
			ServerStorage: model.StorageMetric{FreeBytes: 60 << 30}, BackupStorage: model.StorageMetric{FreeBytes: 100 << 30},
			Servers: []model.ServerMetric{{ID: "fixture", Running: index%3 != 0, HeapMaxMB: 4096}},
		}
		if err := store.RecordSnapshot(ctx, snapshot); err != nil {
			t.Fatal(err)
		}
		findings := []AlertRecord{}
		if index%120 == 0 {
			findings = append(findings, AlertRecord{Key: "load-fixture", Severity: "warning", Detail: "bounded load fixture"})
		}
		if _, err := store.ReconcileAlerts(ctx, findings, sampledAt); err != nil {
			t.Fatal(err)
		}
		if err := store.Prune(ctx, sampledAt); err != nil {
			t.Fatal(err)
		}
		if index%20 == 0 {
			if err := store.Checkpoint(ctx); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := store.Checkpoint(ctx); err != nil {
		t.Fatal(err)
	}
	wallElapsed := time.Since(wallStart)
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &after); err != nil {
		t.Fatal(err)
	}
	cpuSeconds := rusageSeconds(after) - rusageSeconds(before)
	dutyPercent := cpuSeconds / samples / 30 * 100
	peakRSSMiB := float64(after.Maxrss) / 1024
	rollups5m, err := store.Rollups(ctx, 300)
	if err != nil {
		t.Fatal(err)
	}
	rollupsDaily, err := store.Rollups(ctx, 86400)
	if err != nil {
		t.Fatal(err)
	}
	walBytes := fileSize(path + "-wal")
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	databaseInfo, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("samples=%d wall=%s cpu_seconds=%.4f projected_cpu_percent=%.4f peak_rss_mib=%.2f database_bytes=%d wal_bytes=%d rollups_5m=%d rollups_daily=%d", samples, wallElapsed, cpuSeconds, dutyPercent, peakRSSMiB, databaseInfo.Size(), walBytes, len(rollups5m), len(rollupsDaily))
	if dutyPercent >= 1 {
		t.Fatalf("projected CPU %.4f%% exceeds 1%%", dutyPercent)
	}
	if peakRSSMiB >= 50 {
		t.Fatalf("peak RSS %.2f MiB exceeds 50 MiB", peakRSSMiB)
	}
	if len(rollups5m) != 72 || len(rollupsDaily) != 1 {
		t.Fatalf("unexpected rollup counts five-minute=%d daily=%d", len(rollups5m), len(rollupsDaily))
	}
	if walBytes >= 4<<20 {
		t.Fatalf("checkpointed WAL bytes=%d exceeds 4 MiB qualification ceiling", walBytes)
	}
}

func rusageSeconds(value syscall.Rusage) float64 {
	return float64(value.Utime.Sec+value.Stime.Sec) + float64(value.Utime.Usec+value.Stime.Usec)/1_000_000
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

type emptyCraftyAPI struct{}

func (emptyCraftyAPI) ListServers(context.Context) ([]crafty.Server, error) { return nil, nil }
func (emptyCraftyAPI) ServerStats(context.Context, string) (crafty.Stats, error) {
	return crafty.Stats{}, nil
}

func TestLinuxProbeLatencyQualification(t *testing.T) {
	if os.Getenv("MCCTL_RUN_LOAD_QUALIFICATION") != "1" {
		t.Skip("set MCCTL_RUN_LOAD_QUALIFICATION=1 for the bounded load gate")
	}
	cfg := model.Config{
		RootStorage: model.StorageTarget{Path: "/"}, ServerStorage: model.StorageTarget{Path: "/"}, BackupStorage: model.StorageTarget{Path: "/"},
	}
	const samples = 20
	started := time.Now()
	for index := 0; index < samples; index++ {
		snapshot := Collect(context.Background(), cfg, emptyCraftyAPI{}, nil, time.Now().UTC())
		if snapshot.SchemaVersion != 2 || !snapshot.CraftyHealthy {
			t.Fatalf("snapshot=%+v", snapshot)
		}
	}
	elapsed := time.Since(started)
	average := elapsed / samples
	t.Logf("linux_probe_samples=%d wall=%s average_latency=%s", samples, elapsed, average)
	if average >= 30*time.Second {
		t.Fatalf("average sampler latency %s exceeds 30-second cadence", average)
	}
}
