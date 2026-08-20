//go:build linux

package monitor

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/vgbn2/minecraft/internal/crafty"
	"github.com/vgbn2/minecraft/internal/gate"
	"github.com/vgbn2/minecraft/internal/model"
)

func Collect(ctx context.Context, cfg model.Config, client *crafty.Client, profiles []model.Profile, now time.Time) model.Snapshot {
	snapshot := model.Snapshot{SchemaVersion: 1, SampledAt: now, MonitorHealthy: true}
	if value, err := memAvailable(); err == nil {
		snapshot.MemAvailableBytes = value
	} else {
		snapshot.MonitorHealthy = false
	}
	if value, err := loadOne(); err == nil {
		snapshot.Load1 = value
	} else {
		snapshot.MonitorHealthy = false
	}
	if value, err := cpuPercent(ctx); err == nil {
		snapshot.CPUPercentCurrent = value
		snapshot.CPUPercent5m = value
		snapshot.CPUWindowSamples = 1
	} else {
		snapshot.MonitorHealthy = false
	}
	if value, err := swapOutPages(); err == nil {
		snapshot.SwapOutPages = value
	} else {
		snapshot.MonitorHealthy = false
	}
	if value, err := psiAvg60("/proc/pressure/memory"); err == nil {
		snapshot.MemoryFullPSIAvg60 = value
	} else {
		snapshot.MonitorHealthy = false
	}
	if value, err := psiAvg60("/proc/pressure/io"); err == nil {
		snapshot.IOFullPSIAvg60 = value
	} else {
		snapshot.MonitorHealthy = false
	}
	if value, err := storage(cfg.RootStorage.Path); err == nil {
		snapshot.RootStorage = value
	} else {
		snapshot.MonitorHealthy = false
	}
	if value, err := storage(cfg.ServerStorage.Path); err == nil {
		snapshot.ServerStorage = value
	} else {
		snapshot.MonitorHealthy = false
	}
	if value, err := storage(cfg.BackupStorage.Path); err == nil {
		snapshot.BackupStorage = value
	} else {
		snapshot.MonitorHealthy = false
	}
	command := exec.CommandContext(ctx, "timedatectl", "show", "-p", "NTPSynchronized", "--value")
	if output, err := command.Output(); err == nil {
		snapshot.TimeSyncHealthy = strings.TrimSpace(string(output)) == "yes"
	}
	servers, err := client.ListServers(ctx)
	if err == nil {
		snapshot.CraftyHealthy = true
		byID := map[string]model.Profile{}
		for _, profile := range profiles {
			byID[profile.CraftyServerID] = profile
		}
		for _, server := range servers {
			profile, managed := byID[server.ID]
			if !managed {
				snapshot.MonitorHealthy = false
				continue
			}
			if filepath.Clean(server.Path) != filepath.Clean(profile.ServerRoot) || !strings.Contains(server.ExecutionCommand, "mcctl gate exec") {
				snapshot.MonitorHealthy = false
				continue
			}
			marker := strings.Index(server.ExecutionCommand, " -- ")
			if marker < 0 || gate.CheckRuntime(profile, strings.Fields(server.ExecutionCommand[marker+4:])) != nil {
				snapshot.MonitorHealthy = false
				continue
			}
			stats, statsErr := client.ServerStats(ctx, server.ID)
			if statsErr != nil {
				snapshot.MonitorHealthy = false
				continue
			}
			snapshot.Servers = append(snapshot.Servers, model.ServerMetric{ID: server.ID, ProfileID: profile.ID, Running: stats.Running, HeapMaxMB: profile.Resources.HeapMaxMB, UnexpectedExit: stats.Crashed, PlayerCount: stats.Online})
		}
	}
	return snapshot
}

func memAvailable() (int64, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var key string
		var kib int64
		if _, err := fmt.Sscanf(scanner.Text(), "%s %d kB", &key, &kib); err == nil && key == "MemAvailable:" {
			return kib * 1024, nil
		}
	}
	return 0, fmt.Errorf("MemAvailable is missing")
}

func loadOne() (float64, error) {
	raw, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(raw))
	if len(fields) < 1 {
		return 0, fmt.Errorf("invalid loadavg")
	}
	return strconv.ParseFloat(fields[0], 64)
}

func psiAvg60(path string) (float64, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(line, "full ") {
			continue
		}
		for _, field := range strings.Fields(line) {
			if strings.HasPrefix(field, "avg60=") {
				return strconv.ParseFloat(strings.TrimPrefix(field, "avg60="), 64)
			}
		}
	}
	return 0, fmt.Errorf("full avg60 missing from %s", path)
}

func storage(path string) (model.StorageMetric, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return model.StorageMetric{}, err
	}
	total := float64(stat.Blocks) * float64(stat.Bsize)
	free := float64(stat.Bavail) * float64(stat.Bsize)
	metric := model.StorageMetric{Path: path, FreeBytes: int64(free)}
	if total > 0 {
		metric.FreePercent = free / total * 100
	}
	if stat.Files > 0 {
		metric.FreeInodePercent = float64(stat.Ffree) / float64(stat.Files) * 100
	}
	return metric, nil
}

func cpuPercent(ctx context.Context) (float64, error) {
	read := func() (uint64, uint64, error) {
		raw, err := os.ReadFile("/proc/stat")
		if err != nil {
			return 0, 0, err
		}
		fields := strings.Fields(strings.SplitN(string(raw), "\n", 2)[0])
		if len(fields) < 8 || fields[0] != "cpu" {
			return 0, 0, fmt.Errorf("invalid /proc/stat")
		}
		var total, idle uint64
		for index, field := range fields[1:] {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				return 0, 0, err
			}
			total += value
			if index == 3 || index == 4 {
				idle += value
			}
		}
		return total, idle, nil
	}
	total1, idle1, err := read()
	if err != nil {
		return 0, err
	}
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-timer.C:
	}
	total2, idle2, err := read()
	if err != nil {
		return 0, err
	}
	if total2 <= total1 {
		return 0, fmt.Errorf("CPU counter did not advance")
	}
	return (1 - float64(idle2-idle1)/float64(total2-total1)) * 100, nil
}

func swapOutPages() (uint64, error) {
	raw, err := os.ReadFile("/proc/vmstat")
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "pswpout" {
			return strconv.ParseUint(fields[1], 10, 64)
		}
	}
	return 0, fmt.Errorf("pswpout missing from /proc/vmstat")
}
