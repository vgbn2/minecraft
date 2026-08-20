package audit

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/vgbn2/minecraft/internal/crafty"
	"github.com/vgbn2/minecraft/internal/model"
)

type Finding struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Detail   string `json:"detail"`
}

func Ownership(servers []crafty.Server, profiles []model.Profile, serverRoot string) []Finding {
	byID := map[string]model.Profile{}
	for _, profile := range profiles {
		byID[profile.CraftyServerID] = profile
	}
	var findings []Finding
	for _, server := range servers {
		profile, ok := byID[server.ID]
		if !ok {
			findings = append(findings, Finding{"critical", "unprofiled_crafty_server", fmt.Sprintf("%s (%s)", server.Name, server.ID)})
			continue
		}
		if filepath.Clean(server.Path) != filepath.Clean(profile.ServerRoot) {
			findings = append(findings, Finding{"critical", "server_root_mismatch", server.ID})
		}
		if !strings.Contains(server.ExecutionCommand, "mcctl gate exec") || !strings.Contains(server.ExecutionCommand, "--profile") {
			findings = append(findings, Finding{"critical", "admission_wrapper_bypassed", server.ID})
		}
	}
	for _, profile := range profiles {
		found := false
		for _, server := range servers {
			if server.ID == profile.CraftyServerID {
				found = true
				break
			}
		}
		if !found {
			findings = append(findings, Finding{"warning", "profile_server_missing", profile.ID})
		}
	}
	findings = append(findings, unmanagedJava(serverRoot, profiles)...)
	return findings
}

func unmanagedJava(serverRoot string, profiles []model.Profile) []Finding {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return []Finding{{"critical", "process_inventory_unavailable", err.Error()}}
	}
	var findings []Finding
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || !entry.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "cmdline"))
		if err != nil {
			continue
		}
		command := strings.ReplaceAll(string(raw), "\x00", " ")
		if !strings.Contains(command, "java") || !strings.Contains(command, serverRoot) {
			continue
		}
		managed := false
		for _, profile := range profiles {
			if strings.Contains(command, profile.ServerRoot) && strings.Contains(command, fmt.Sprintf("-Xmx%dM", profile.Resources.HeapMaxMB)) {
				managed = true
				break
			}
		}
		if !managed {
			findings = append(findings, Finding{"warning", "unmanaged_java", fmt.Sprintf("pid=%d command=%s", pid, command)})
		}
	}
	return findings
}
