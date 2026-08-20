package alerts

import (
	"sort"

	"github.com/vgbn2/minecraft/internal/model"
)

type Finding struct {
	Key      string `json:"key"`
	Severity string `json:"severity"`
	Detail   string `json:"detail"`
}

func Evaluate(snapshot model.Snapshot) []Finding {
	var findings []Finding
	add := func(key, severity, detail string) {
		findings = append(findings, Finding{Key: key, Severity: severity, Detail: detail})
	}
	availableGiB := float64(snapshot.MemAvailableBytes) / 1024 / 1024 / 1024
	if availableGiB < 3 {
		add("memory_available", "critical", "MemAvailable is below 3 GiB")
	} else if availableGiB < 4 {
		add("memory_available", "warning", "MemAvailable is below 4 GiB")
	}
	if snapshot.CPUPercent5m > 90 || snapshot.Load1 > 6 {
		add("host_cpu_load", "critical", "five-minute CPU or one-minute load is critical")
	} else if snapshot.CPUPercent5m > 80 || snapshot.Load1 > 4.5 {
		add("host_cpu_load", "warning", "five-minute CPU or one-minute load is elevated")
	}
	if snapshot.MemoryFullPSIAvg60 >= 5 {
		add("memory_psi", "critical", "memory full PSI avg60 is critical")
	} else if snapshot.MemoryFullPSIAvg60 >= 2 {
		add("memory_psi", "warning", "memory full PSI avg60 is elevated")
	}
	if snapshot.IOFullPSIAvg60 >= 20 {
		add("io_psi", "critical", "IO full PSI avg60 is critical")
	} else if snapshot.IOFullPSIAvg60 >= 10 {
		add("io_psi", "warning", "IO full PSI avg60 is elevated")
	}
	if snapshot.SwapOutMiBPerMinute > 0 {
		severity := "warning"
		if snapshot.SwapOutMiBPerMinute > 10 && snapshot.SwapOutSamples >= 3 {
			severity = "critical"
		}
		add("swap_out", severity, "active swap-out detected")
	}
	for _, server := range snapshot.Servers {
		if server.OOMEvidence || server.UnexpectedExit {
			add("server_"+server.ID, "critical", "server has OOM or unexpected-exit evidence")
		}
	}
	if !snapshot.MonitorHealthy || !snapshot.CraftyHealthy || !snapshot.TimeSyncHealthy {
		add("control_plane_health", "critical", "monitor, Crafty, or time synchronization is unhealthy")
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].Key < findings[j].Key })
	return findings
}
