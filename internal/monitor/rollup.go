package monitor

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/vgbn2/minecraft/internal/model"
)

type MetricRollup struct {
	SchemaVersion          int     `json:"schema_version"`
	BucketSeconds          int64   `json:"bucket_seconds"`
	BucketAt               int64   `json:"bucket_at"`
	SampleCount            int     `json:"sample_count"`
	UnhealthySamples       int     `json:"unhealthy_samples"`
	MemAvailableMinBytes   int64   `json:"mem_available_min_bytes"`
	MemAvailableAvgBytes   int64   `json:"mem_available_avg_bytes"`
	CPUPercentAverage      float64 `json:"cpu_percent_average"`
	CPUPercentMaximum      float64 `json:"cpu_percent_maximum"`
	LoadAverage            float64 `json:"load_average"`
	LoadMaximum            float64 `json:"load_maximum"`
	MemoryPSIMaximum       float64 `json:"memory_psi_maximum"`
	IOPSIMaximum           float64 `json:"io_psi_maximum"`
	SwapOutMaximum         float64 `json:"swap_out_maximum"`
	RootFreeMinimumBytes   int64   `json:"root_free_minimum_bytes"`
	ServerFreeMinimumBytes int64   `json:"server_free_minimum_bytes"`
	BackupFreeMinimumBytes int64   `json:"backup_free_minimum_bytes"`
	RunningServersMaximum  int     `json:"running_servers_maximum"`
	CrashOrOOMObserved     bool    `json:"crash_or_oom_observed"`
}

func updateRollup(ctx context.Context, tx *sql.Tx, sampledAt time.Time, bucketSeconds int64) error {
	bucketAt := sampledAt.Unix() / bucketSeconds * bucketSeconds
	rows, err := tx.QueryContext(ctx, "SELECT snapshot_json FROM samples WHERE sampled_at>=? AND sampled_at<? ORDER BY sampled_at", bucketAt, bucketAt+bucketSeconds)
	if err != nil {
		return fmt.Errorf("query rollup samples: %w", err)
	}
	defer rows.Close()
	rollup := MetricRollup{SchemaVersion: 1, BucketSeconds: bucketSeconds, BucketAt: bucketAt}
	var memoryTotal int64
	var cpuTotal, loadTotal float64
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return err
		}
		var snapshot model.Snapshot
		if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
			return fmt.Errorf("decode rollup snapshot: %w", err)
		}
		rollup.SampleCount++
		memoryTotal += snapshot.MemAvailableBytes
		cpuTotal += snapshot.CPUPercentCurrent
		loadTotal += snapshot.Load1
		if !snapshot.MonitorHealthy || !snapshot.CraftyHealthy || !snapshot.TimeSyncHealthy {
			rollup.UnhealthySamples++
		}
		if rollup.SampleCount == 1 || snapshot.MemAvailableBytes < rollup.MemAvailableMinBytes {
			rollup.MemAvailableMinBytes = snapshot.MemAvailableBytes
		}
		if snapshot.CPUPercentCurrent > rollup.CPUPercentMaximum {
			rollup.CPUPercentMaximum = snapshot.CPUPercentCurrent
		}
		if snapshot.Load1 > rollup.LoadMaximum {
			rollup.LoadMaximum = snapshot.Load1
		}
		if snapshot.MemoryFullPSIAvg60 > rollup.MemoryPSIMaximum {
			rollup.MemoryPSIMaximum = snapshot.MemoryFullPSIAvg60
		}
		if snapshot.IOFullPSIAvg60 > rollup.IOPSIMaximum {
			rollup.IOPSIMaximum = snapshot.IOFullPSIAvg60
		}
		if snapshot.SwapOutMiBPerMinute > rollup.SwapOutMaximum {
			rollup.SwapOutMaximum = snapshot.SwapOutMiBPerMinute
		}
		minimumStorage(&rollup.RootFreeMinimumBytes, snapshot.RootStorage.FreeBytes, rollup.SampleCount)
		minimumStorage(&rollup.ServerFreeMinimumBytes, snapshot.ServerStorage.FreeBytes, rollup.SampleCount)
		minimumStorage(&rollup.BackupFreeMinimumBytes, snapshot.BackupStorage.FreeBytes, rollup.SampleCount)
		running := 0
		for _, server := range snapshot.Servers {
			if server.Running {
				running++
			}
			rollup.CrashOrOOMObserved = rollup.CrashOrOOMObserved || server.UnexpectedExit || server.OOMEvidence
		}
		if running > rollup.RunningServersMaximum {
			rollup.RunningServersMaximum = running
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if rollup.SampleCount == 0 {
		return nil
	}
	rollup.MemAvailableAvgBytes = memoryTotal / int64(rollup.SampleCount)
	rollup.CPUPercentAverage = cpuTotal / float64(rollup.SampleCount)
	rollup.LoadAverage = loadTotal / float64(rollup.SampleCount)
	raw, err := json.Marshal(rollup)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT OR REPLACE INTO rollups(bucket_seconds,bucket_at,summary_json) VALUES(?,?,?)", bucketSeconds, bucketAt, string(raw))
	return err
}

func minimumStorage(current *int64, value int64, sampleCount int) {
	if sampleCount == 1 || value < *current {
		*current = value
	}
}

func (store *Store) Rollups(ctx context.Context, bucketSeconds int64) ([]MetricRollup, error) {
	rows, err := store.db.QueryContext(ctx, "SELECT summary_json FROM rollups WHERE bucket_seconds=? ORDER BY bucket_at", bucketSeconds)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var values []MetricRollup
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var value MetricRollup
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}
