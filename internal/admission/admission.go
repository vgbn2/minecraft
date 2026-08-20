package admission

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/vgbn2/minecraft/internal/model"
)

const mib = int64(1024 * 1024)

type Reservation struct {
	ServerID string
	HeapMB   int
}

func LoadSnapshot(path string) (model.Snapshot, error) {
	var snapshot model.Snapshot
	file, err := os.Open(path)
	if err != nil {
		return snapshot, fmt.Errorf("open monitor snapshot: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil {
		return snapshot, fmt.Errorf("decode monitor snapshot: %w", err)
	}
	if snapshot.SchemaVersion != 1 {
		return snapshot, fmt.Errorf("unsupported snapshot schema_version %d", snapshot.SchemaVersion)
	}
	return snapshot, nil
}

func Evaluate(now time.Time, cfg model.Config, profile model.Profile, snapshot model.Snapshot, reservations []Reservation) model.AdmissionDecision {
	age := now.Sub(snapshot.SampledAt)
	decision := model.AdmissionDecision{Allowed: true, ProfileID: profile.ID, SnapshotAgeSecs: int64(age.Seconds())}
	add := func(reason string) { decision.Allowed = false; decision.Reasons = append(decision.Reasons, reason) }
	if age < 0 || age > time.Duration(cfg.MaxSnapshotAgeSecs)*time.Second {
		add("monitor_snapshot_stale")
	}
	if !snapshot.MonitorHealthy {
		add("monitor_unhealthy")
	}
	if !snapshot.CraftyHealthy {
		add("crafty_unhealthy")
	}
	if !snapshot.TimeSyncHealthy {
		add("clock_unsynchronized")
	}
	if snapshot.MaintenanceActive || snapshot.Operation != "" {
		add("operation_in_progress")
	}
	projectedBytes := snapshot.MemAvailableBytes - int64(profile.Resources.HeapInitialMB+cfg.NativeOverheadMB)*mib
	decision.ProjectedFreeMB = projectedBytes / mib
	if projectedBytes < int64(cfg.MinAvailableMB)*mib {
		add("projected_memory_reserve_below_minimum")
	}
	heap := profile.Resources.HeapMaxMB
	for _, server := range snapshot.Servers {
		if server.Running {
			heap += server.HeapMaxMB
			if server.ID == profile.CraftyServerID {
				add("server_already_running")
			}
		}
	}
	for _, reservation := range reservations {
		if reservation.ServerID == profile.CraftyServerID {
			add("start_already_reserved")
			continue
		}
		heap += reservation.HeapMB
	}
	decision.ProjectedHeapMB = heap
	if heap > cfg.ManagedHeapMaxMB {
		add("combined_heap_cap_exceeded")
	}
	if snapshot.MemoryFullPSIAvg60 >= 5 {
		add("memory_pressure_critical")
	}
	if snapshot.IOFullPSIAvg60 >= 20 {
		add("io_pressure_critical")
	}
	if snapshot.SwapOutMiBPerMinute > 10 && snapshot.SwapOutSamples >= 3 {
		add("sustained_swap_out")
	}
	if snapshot.Load1 > 6 {
		add("load_critical")
	}
	if snapshot.CPUPercent5m > 90 {
		add("cpu_sustained_critical")
	}
	checkStorage := func(name string, metric model.StorageMetric, target model.StorageTarget) {
		if metric.Path != target.Path || metric.FreePercent < target.MinFreePercent || metric.FreeBytes < target.MinFreeBytes || metric.FreeInodePercent < target.MinInodePct {
			add(name + "_below_minimum")
		}
	}
	checkStorage("root_storage", snapshot.RootStorage, cfg.RootStorage)
	checkStorage("server_storage", snapshot.ServerStorage, cfg.ServerStorage)
	checkStorage("backup_storage", snapshot.BackupStorage, cfg.BackupStorage)
	sort.Strings(decision.Reasons)
	return decision
}
