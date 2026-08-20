package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"

	"github.com/vgbn2/minecraft/internal/admission"
	"github.com/vgbn2/minecraft/internal/alerts"
	"github.com/vgbn2/minecraft/internal/audit"
	controlconfig "github.com/vgbn2/minecraft/internal/config"
	"github.com/vgbn2/minecraft/internal/crafty"
	"github.com/vgbn2/minecraft/internal/diagnostic"
	operationlock "github.com/vgbn2/minecraft/internal/lock"
	"github.com/vgbn2/minecraft/internal/monitor"
	"github.com/vgbn2/minecraft/internal/profile"
	"github.com/vgbn2/minecraft/internal/startgate"
)

func craftyCommand(ctx context.Context, args []string, stderr io.Writer) (response, error) {
	if len(args) == 0 {
		return response{}, errors.New("supported Crafty commands: servers, stats, action, contract-verify")
	}
	flags := newFlagSet("crafty "+args[0], stderr)
	configPath := flags.String("config", "", "configuration JSON path")
	serverID := flags.String("server", "", "Crafty server UUID")
	action := flags.String("action", "", "approved Crafty action")
	contractPath := flags.String("file", "", "downloaded Crafty OpenAPI YAML")
	if err := flags.Parse(args[1:]); err != nil {
		return response{}, err
	}
	cfg, client, err := loadClient(*configPath)
	if err != nil {
		return response{}, err
	}
	switch args[0] {
	case "contract-verify":
		if *contractPath == "" {
			return response{}, errors.New("--file is required")
		}
		if err := crafty.VerifyOpenAPI(*contractPath, cfg.Crafty); err != nil {
			return response{}, err
		}
		return response{command: "crafty contract-verify", data: map[string]string{"file": *contractPath, "sha256": cfg.Crafty.OpenAPISHA256}, human: "Crafty OpenAPI contract matches the configured pin\n"}, nil
	case "servers":
		servers, err := client.ListServers(ctx)
		if err != nil {
			logCraftyAPIError(stderr, "servers", err)
			return response{}, err
		}
		return response{command: "crafty servers", data: servers, human: fmt.Sprintf("%d Crafty servers visible\n", len(servers))}, nil
	case "stats":
		if *serverID == "" {
			return response{}, errors.New("--server is required")
		}
		stats, err := client.ServerStats(ctx, *serverID)
		if err != nil {
			logCraftyAPIError(stderr, "stats", err)
			return response{}, err
		}
		return response{command: "crafty stats", data: stats, human: fmt.Sprintf("server %s running=%t players=%d\n", *serverID, stats.Running, stats.Online)}, nil
	case "action":
		if *serverID == "" || *action == "" {
			return response{}, errors.New("--server and --action are required")
		}
		if err := client.Action(ctx, *serverID, *action); err != nil {
			logCraftyAPIError(stderr, "action", err)
			return response{}, err
		}
		return response{command: "crafty action", data: map[string]string{"server": *serverID, "action": *action}, human: "Crafty action accepted\n"}, nil
	default:
		return response{}, errors.New("supported Crafty commands: servers, stats, action, contract-verify")
	}
}

func logCraftyAPIError(writer io.Writer, operation string, err error) {
	status := 0
	var httpError crafty.HTTPError
	if errors.As(err, &httpError) {
		status = httpError.StatusCode
	}
	diagnostic.Event(writer, "crafty_api_error", map[string]any{"operation": operation, "status": status})
}

func monitorCommand(ctx context.Context, args []string, stderr io.Writer) (response, error) {
	if len(args) == 0 || (args[0] != "sample" && args[0] != "recover") {
		return response{}, errors.New("supported monitor commands: sample, recover")
	}
	flags := newFlagSet("monitor "+args[0], stderr)
	configPath := flags.String("config", "", "configuration JSON path")
	confirmation := flags.String("confirm", "", "required recovery confirmation")
	if err := flags.Parse(args[1:]); err != nil {
		return response{}, err
	}
	cfg, client, err := loadClient(*configPath)
	if err != nil {
		return response{}, err
	}
	if args[0] == "recover" {
		if *confirmation != "quarantine-corrupt-monitor" {
			return response{}, errors.New("monitor recovery requires --confirm quarantine-corrupt-monitor")
		}
		guard, lockErr := operationlock.Acquire(cfg.OperationLockPath, true)
		if lockErr != nil {
			return response{}, errors.New("operation_in_progress")
		}
		defer guard.Close()
		moved, recoverErr := monitor.Quarantine(cfg.MonitorDBPath, cfg.SnapshotPath, time.Now().UTC())
		if recoverErr != nil {
			return response{}, recoverErr
		}
		return response{command: "monitor recover", data: moved, human: fmt.Sprintf("quarantined %d monitor state files; starts remain blocked until a fresh sample exists\n", len(moved))}, nil
	}
	profiles, err := loadProfiles(cfg.ProfileDir)
	if err != nil {
		return response{}, err
	}
	store, err := monitor.Open(cfg.MonitorDBPath)
	if err != nil {
		return response{}, err
	}
	defer store.Close()
	snapshot := monitor.Collect(ctx, cfg, client, profiles, time.Now().UTC())
	for _, issue := range snapshot.Issues {
		diagnostic.Event(stderr, "monitor_probe_failed", map[string]any{"issue_code": issue.Code, "component": issue.Component})
	}
	if err := store.EnrichSnapshot(ctx, &snapshot); err != nil {
		return response{}, err
	}
	findings := alerts.Evaluate(snapshot)
	records := make([]monitor.AlertRecord, 0, len(findings))
	for _, finding := range findings {
		records = append(records, monitor.AlertRecord{Key: finding.Key, Severity: finding.Severity, Detail: finding.Detail})
	}
	notifications, err := store.ReconcileAlerts(ctx, records, snapshot.SampledAt)
	if err != nil {
		return response{}, err
	}
	for _, notification := range notifications {
		diagnostic.Event(stderr, "alert_transition", map[string]any{"severity": notification.Severity, "transition": notification.Transition})
	}
	if err := writeJSONAtomic(filepath.Join(cfg.StateDir, "current-alerts.json"), map[string]any{"at": snapshot.SampledAt, "findings": findings}); err != nil {
		return response{}, err
	}
	if err := store.RecordSnapshot(ctx, snapshot); err != nil {
		return response{}, err
	}
	if err := store.Prune(ctx, time.Now().UTC()); err != nil {
		return response{}, err
	}
	if err := store.Checkpoint(ctx); err != nil {
		return response{}, err
	}
	if err := monitor.WriteSnapshotAtomic(cfg.SnapshotPath, snapshot); err != nil {
		return response{}, err
	}
	return response{command: "monitor sample", data: snapshot, human: fmt.Sprintf("monitor sample recorded at %s\n", snapshot.SampledAt.Format(time.RFC3339))}, nil
}

func healthCommand(args []string, stderr io.Writer) (response, error) {
	flags := newFlagSet("health", stderr)
	configPath := flags.String("config", "", "configuration JSON path")
	if err := flags.Parse(args); err != nil {
		return response{}, err
	}
	cfg, err := controlconfig.Load(*configPath)
	if err != nil {
		return response{}, err
	}
	snapshot, err := admission.LoadSnapshot(cfg.SnapshotPath)
	if err != nil {
		return response{}, err
	}
	findings := alerts.Evaluate(snapshot)
	var lastRejection any
	if raw, readErr := os.ReadFile(filepath.Join(cfg.StateDir, "last-rejection.json")); readErr == nil {
		if decodeErr := json.Unmarshal(raw, &lastRejection); decodeErr != nil {
			diagnostic.Event(stderr, "diagnostic_state_invalid", map[string]any{"issue_code": "last_rejection_invalid"})
			return response{}, errors.New("last rejection diagnostic is invalid")
		}
	}
	return response{command: "health", data: map[string]any{"snapshot": snapshot, "findings": findings, "last_rejection": lastRejection}, human: fmt.Sprintf("monitor sampled %s; %d active findings\n", snapshot.SampledAt.Format(time.RFC3339), len(findings))}, nil
}

func alertsCommand(ctx context.Context, args []string, stderr io.Writer) (response, error) {
	flags := newFlagSet("alerts", stderr)
	configPath := flags.String("config", "", "configuration JSON path")
	if err := flags.Parse(args); err != nil {
		return response{}, err
	}
	cfg, err := controlconfig.Load(*configPath)
	if err != nil {
		return response{}, err
	}
	store, err := monitor.Open(cfg.MonitorDBPath)
	if err != nil {
		return response{}, err
	}
	defer store.Close()
	records, events, err := store.Alerts(ctx)
	if err != nil {
		return response{}, err
	}
	return response{command: "alerts", data: map[string]any{"alerts": records, "events": events}, human: fmt.Sprintf("%d alert records; %d recent transitions\n", len(records), len(events))}, nil
}

func auditCommand(ctx context.Context, args []string, stderr io.Writer) (response, error) {
	flags := newFlagSet("audit", stderr)
	configPath := flags.String("config", "", "configuration JSON path")
	if err := flags.Parse(args); err != nil {
		return response{}, err
	}
	cfg, client, err := loadClient(*configPath)
	if err != nil {
		return response{}, err
	}
	profiles, err := loadProfiles(cfg.ProfileDir)
	if err != nil {
		return response{}, err
	}
	servers, err := client.ListServers(ctx)
	if err != nil {
		return response{}, err
	}
	findings := audit.Ownership(servers, profiles, cfg.ServerRoot)
	return response{command: "audit", data: findings, human: fmt.Sprintf("ownership audit completed with %d findings\n", len(findings))}, nil
}

type processOperations struct {
	now      func() time.Time
	euid     func() int
	pid      func() int
	lookPath func(string) (string, error)
	exec     func(string, []string, []string) error
}

func defaultProcessOperations() processOperations {
	return processOperations{
		now:      func() time.Time { return time.Now().UTC() },
		euid:     os.Geteuid,
		pid:      os.Getpid,
		lookPath: exec.LookPath,
		exec:     unix.Exec,
	}
}

func gateCommand(ctx context.Context, args []string, stderr io.Writer) (response, error) {
	return gateCommandWithOperations(ctx, args, stderr, defaultProcessOperations())
}

func gateCommandWithOperations(ctx context.Context, args []string, stderr io.Writer, process processOperations) (response, error) {
	if len(args) == 0 || (args[0] != "check" && args[0] != "exec") {
		return response{}, errors.New("supported gate commands: check, exec")
	}
	action := args[0]
	flags := newFlagSet("gate "+action, stderr)
	configPath := flags.String("config", "", "configuration JSON path")
	profilePath := flags.String("profile", "", "approved profile JSON path")
	if err := flags.Parse(args[1:]); err != nil {
		return response{}, err
	}
	if *configPath == "" || *profilePath == "" {
		return response{}, errors.New("--config and --profile are required")
	}
	cfg, err := controlconfig.Load(*configPath)
	if err != nil {
		return response{}, err
	}
	approved, _, err := profile.Load(*profilePath)
	if err != nil {
		return response{}, err
	}
	now := process.now()
	command := flags.Args()
	result, err := startgate.Authorize(ctx, startgate.Request{
		Config: cfg, Profile: approved, Command: command, Execute: action == "exec",
		EUID: process.euid(), PID: process.pid(), Now: now,
	})
	if err != nil {
		return response{}, err
	}
	decision := result.Decision
	if action == "check" {
		if !decision.Allowed {
			_ = writeJSONAtomic(filepath.Join(cfg.StateDir, "last-rejection.json"), map[string]any{"at": now, "decision": decision})
			diagnostic.Event(stderr, "admission_rejected", map[string]any{"reason_count": len(decision.Reasons), "reasons": decision.Reasons})
			return response{}, fmt.Errorf("start rejected: %s", strings.Join(decision.Reasons, ","))
		}
		return response{command: "gate check", data: decision, human: "start admission allowed\n"}, nil
	}
	if !decision.Allowed {
		_ = writeJSONAtomic(filepath.Join(cfg.StateDir, "last-rejection.json"), map[string]any{"at": now, "decision": decision})
		diagnostic.Event(stderr, "admission_rejected", map[string]any{"reason_count": len(decision.Reasons), "reasons": decision.Reasons})
		return response{}, fmt.Errorf("start rejected: %s", strings.Join(decision.Reasons, ","))
	}
	path, err := process.lookPath(command[0])
	if err != nil {
		if cleanupErr := startgate.ReleaseFailedExec(ctx, cfg, approved.CraftyServerID, process.pid()); cleanupErr != nil {
			return response{}, fmt.Errorf("locate Java and release reservation: %v; %w", err, cleanupErr)
		}
		return response{}, err
	}
	if err := process.exec(path, command, os.Environ()); err != nil {
		if cleanupErr := startgate.ReleaseFailedExec(ctx, cfg, approved.CraftyServerID, process.pid()); cleanupErr != nil {
			return response{}, fmt.Errorf("exec Java and release reservation: %v; %w", err, cleanupErr)
		}
		return response{}, fmt.Errorf("exec Java: %w", err)
	}
	return response{}, errors.New("unreachable after exec")
}
