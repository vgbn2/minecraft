package app

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
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
	"github.com/vgbn2/minecraft/internal/atlas"
	"github.com/vgbn2/minecraft/internal/audit"
	controlconfig "github.com/vgbn2/minecraft/internal/config"
	"github.com/vgbn2/minecraft/internal/crafty"
	"github.com/vgbn2/minecraft/internal/gate"
	operationlock "github.com/vgbn2/minecraft/internal/lock"
	"github.com/vgbn2/minecraft/internal/model"
	"github.com/vgbn2/minecraft/internal/monitor"
	"github.com/vgbn2/minecraft/internal/profile"
)

const Version = "0.2.0-crafty"

type envelope struct {
	OK       bool       `json:"ok"`
	Command  string     `json:"command"`
	Data     any        `json:"data,omitempty"`
	Warnings []string   `json:"warnings,omitempty"`
	Error    *errorBody `json:"error,omitempty"`
}
type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type response struct {
	command  string
	data     any
	warnings []string
	human    string
}

func Run(ctx context.Context, rawArgs []string, stdout, stderr io.Writer) int {
	args, jsonOutput := extractJSON(rawArgs)
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		fmt.Fprint(stdout, helpText())
		return 0
	}
	result, err := dispatch(ctx, args, stderr)
	if err != nil {
		if jsonOutput {
			emitJSON(stdout, envelope{OK: false, Command: strings.Join(args, " "), Error: &errorBody{Code: "command_failed", Message: err.Error()}})
		} else {
			fmt.Fprintf(stderr, "mcctl: %v\n", err)
		}
		return 2
	}
	if jsonOutput {
		emitJSON(stdout, envelope{OK: true, Command: result.command, Data: result.data, Warnings: result.warnings})
	} else {
		fmt.Fprint(stdout, result.human)
		for _, warning := range result.warnings {
			fmt.Fprintf(stderr, "warning: %s\n", warning)
		}
	}
	return 0
}

func dispatch(ctx context.Context, args []string, stderr io.Writer) (response, error) {
	switch args[0] {
	case "version":
		return response{command: "version", data: map[string]string{"version": Version, "crafty_openapi": crafty.ContractVersion}, human: "mcctl " + Version + "\n"}, nil
	case "config":
		return configCommand(args[1:], stderr)
	case "profile":
		return profileCommand(args[1:], stderr)
	case "doctor":
		return doctorCommand(args[1:], stderr)
	case "crafty":
		return craftyCommand(ctx, args[1:], stderr)
	case "monitor":
		return monitorCommand(ctx, args[1:], stderr)
	case "health":
		return healthCommand(args[1:], stderr)
	case "alerts":
		return alertsCommand(args[1:], stderr)
	case "audit":
		return auditCommand(ctx, args[1:], stderr)
	case "gate":
		return gateCommand(ctx, args[1:], stderr)
	case "atlas":
		return atlasCommand(ctx, args[1:], stderr)
	default:
		return response{}, fmt.Errorf("unknown command %q; run mcctl help", args[0])
	}
}

func configCommand(args []string, stderr io.Writer) (response, error) {
	if len(args) == 0 || args[0] != "validate" {
		return response{}, errors.New("supported config command: validate")
	}
	flags := newFlagSet("config validate", stderr)
	path := flags.String("file", "", "configuration JSON path")
	if err := flags.Parse(args[1:]); err != nil {
		return response{}, err
	}
	if *path == "" {
		return response{}, errors.New("--file is required")
	}
	cfg, err := controlconfig.Load(*path)
	if err != nil {
		return response{}, err
	}
	return response{command: "config validate", data: cfg, human: fmt.Sprintf("valid Crafty control config: %s\n", *path)}, nil
}

func profileCommand(args []string, stderr io.Writer) (response, error) {
	if len(args) == 0 || args[0] != "validate" {
		return response{}, errors.New("supported profile command: validate")
	}
	flags := newFlagSet("profile validate", stderr)
	path := flags.String("file", "", "approved profile JSON path")
	if err := flags.Parse(args[1:]); err != nil {
		return response{}, err
	}
	if *path == "" {
		return response{}, errors.New("--file is required")
	}
	value, digest, err := profile.Load(*path)
	if err != nil {
		return response{}, err
	}
	data := map[string]any{"id": value.ID, "digest": digest, "server_type": value.ServerType, "resources": value.Resources}
	return response{command: "profile validate", data: data, human: fmt.Sprintf("valid approved profile: %s (%s)\n", value.ID, digest)}, nil
}

func doctorCommand(args []string, stderr io.Writer) (response, error) {
	flags := newFlagSet("doctor", stderr)
	configPath := flags.String("config", "", "configuration JSON path")
	if err := flags.Parse(args); err != nil {
		return response{}, err
	}
	if *configPath == "" {
		return response{}, errors.New("--config is required")
	}
	cfg, err := controlconfig.Load(*configPath)
	if err != nil {
		return response{}, err
	}
	tools := map[string]string{}
	for _, name := range []string{"java", "git", "timedatectl"} {
		path, lookupErr := exec.LookPath(name)
		if lookupErr != nil {
			return response{}, fmt.Errorf("required executable %s is unavailable", name)
		}
		tools[name] = path
	}
	info, err := os.Stat(cfg.Crafty.TokenFile)
	if err != nil {
		return response{}, fmt.Errorf("Crafty token file: %w", err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return response{}, errors.New("Crafty token file must not be group/world accessible")
	}
	return response{command: "doctor", data: tools, warnings: []string{"doctor does not start Crafty or a Minecraft server"}, human: "local prerequisites and token permissions are valid\n"}, nil
}

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
	_ = cfg
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
			return response{}, err
		}
		return response{command: "crafty servers", data: servers, human: fmt.Sprintf("%d Crafty servers visible\n", len(servers))}, nil
	case "stats":
		if *serverID == "" {
			return response{}, errors.New("--server is required")
		}
		stats, err := client.ServerStats(ctx, *serverID)
		if err != nil {
			return response{}, err
		}
		return response{command: "crafty stats", data: stats, human: fmt.Sprintf("server %s running=%t players=%d\n", *serverID, stats.Running, stats.Online)}, nil
	case "action":
		if *serverID == "" || *action == "" {
			return response{}, errors.New("--server and --action are required")
		}
		if err := client.Action(ctx, *serverID, *action); err != nil {
			return response{}, err
		}
		return response{command: "crafty action", data: map[string]string{"server": *serverID, "action": *action}, human: "Crafty action accepted\n"}, nil
	default:
		return response{}, errors.New("supported Crafty commands: servers, stats, action, contract-verify")
	}
}

func monitorCommand(ctx context.Context, args []string, stderr io.Writer) (response, error) {
	if len(args) == 0 || (args[0] != "sample" && args[0] != "recover") {
		return response{}, errors.New("supported monitor commands: sample, recover")
	}
	flags := newFlagSet("monitor sample", stderr)
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
	if err := store.EnrichSnapshot(ctx, &snapshot); err != nil {
		return response{}, err
	}
	findings := alerts.Evaluate(snapshot)
	records := make([]monitor.AlertRecord, 0, len(findings))
	for _, finding := range findings {
		records = append(records, monitor.AlertRecord{Key: finding.Key, Severity: finding.Severity, Detail: finding.Detail})
	}
	if err := store.ReconcileAlerts(ctx, records, snapshot.SampledAt); err != nil {
		return response{}, err
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
		_ = json.Unmarshal(raw, &lastRejection)
	}
	return response{command: "health", data: map[string]any{"snapshot": snapshot, "findings": findings, "last_rejection": lastRejection}, human: fmt.Sprintf("monitor sampled %s; %d active findings\n", snapshot.SampledAt.Format(time.RFC3339), len(findings))}, nil
}
func alertsCommand(args []string, stderr io.Writer) (response, error) {
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
	records, events, err := store.Alerts(context.Background())
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

func gateCommand(ctx context.Context, args []string, stderr io.Writer) (response, error) {
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
	relativeRoot, relErr := filepath.Rel(filepath.Clean(cfg.ServerRoot), filepath.Clean(approved.ServerRoot))
	if relErr != nil || relativeRoot == "." || relativeRoot == ".." || strings.HasPrefix(relativeRoot, ".."+string(filepath.Separator)) {
		return response{}, errors.New("profile server_root is outside configured server root")
	}
	guard, err := operationlock.Acquire(cfg.OperationLockPath, true)
	if err != nil {
		return response{}, errors.New("operation_in_progress")
	}
	defer guard.Close()
	store, err := monitor.Open(cfg.MonitorDBPath)
	if err != nil {
		return response{}, err
	}
	defer store.Close()
	now := time.Now().UTC()
	reservations, err := store.Reservations(ctx, now)
	if err != nil {
		return response{}, err
	}
	snapshot, err := admission.LoadSnapshot(cfg.SnapshotPath)
	if err != nil {
		return response{}, err
	}
	decision := admission.Evaluate(now, cfg, approved, snapshot, reservations)
	if action == "check" {
		if !decision.Allowed {
			_ = writeJSONAtomic(filepath.Join(cfg.StateDir, "last-rejection.json"), map[string]any{"at": now, "decision": decision})
			return response{}, fmt.Errorf("start rejected: %s", strings.Join(decision.Reasons, ","))
		}
		return response{command: "gate check", data: decision, human: "start admission allowed\n"}, nil
	}
	command := flags.Args()
	if os.Geteuid() != cfg.CraftyServiceUID {
		return response{}, errors.New("gate exec must run as the configured Crafty service UID")
	}
	if !decision.Allowed {
		_ = writeJSONAtomic(filepath.Join(cfg.StateDir, "last-rejection.json"), map[string]any{"at": now, "decision": decision})
		return response{}, fmt.Errorf("start rejected: %s", strings.Join(decision.Reasons, ","))
	}
	if err := gate.CheckRuntime(approved, command); err != nil {
		return response{}, err
	}
	if err := store.Reserve(ctx, approved.CraftyServerID, approved.ID, approved.Resources.HeapMaxMB, os.Getpid(), now, time.Duration(cfg.ReservationTTLSecs)*time.Second); err != nil {
		return response{}, err
	}
	if err := guard.Close(); err != nil {
		return response{}, err
	}
	if err := store.Close(); err != nil {
		return response{}, err
	}
	path, err := exec.LookPath(command[0])
	if err != nil {
		return response{}, err
	}
	if err := unix.Exec(path, command, os.Environ()); err != nil {
		return response{}, fmt.Errorf("exec Java: %w", err)
	}
	return response{}, errors.New("unreachable after exec")
}

func atlasCommand(ctx context.Context, args []string, stderr io.Writer) (response, error) {
	if len(args) == 0 || (args[0] != "check" && args[0] != "sync") {
		return response{}, errors.New("supported atlas commands: check, sync")
	}
	action := args[0]
	flags := newFlagSet("atlas "+action, stderr)
	root := flags.String("root", ".", "repository root")
	if err := flags.Parse(args[1:]); err != nil {
		return response{}, err
	}
	absRoot, err := filepath.Abs(*root)
	if err != nil {
		return response{}, err
	}
	if action == "sync" {
		if err := atlas.Sync(ctx, absRoot); err != nil {
			return response{}, err
		}
		return response{command: "atlas sync", human: "atlas inventory synchronized\n"}, nil
	}
	if err := atlas.Check(ctx, absRoot); err != nil {
		return response{}, err
	}
	return response{command: "atlas check", human: "atlas inventory and links are current\n"}, nil
}

func loadClient(path string) (model.Config, *crafty.Client, error) {
	if path == "" {
		return model.Config{}, nil, errors.New("--config is required")
	}
	cfg, err := controlconfig.Load(path)
	if err != nil {
		return cfg, nil, err
	}
	client, err := crafty.New(cfg.Crafty)
	return cfg, client, err
}
func loadProfiles(dir string) ([]model.Profile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read profile directory: %w", err)
	}
	var values []model.Profile
	serverIDs := map[string]bool{}
	ports := map[int]bool{}
	roots := map[string]bool{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		value, _, loadErr := profile.Load(filepath.Join(dir, entry.Name()))
		if loadErr != nil {
			return nil, loadErr
		}
		if serverIDs[value.CraftyServerID] || ports[value.Port] || roots[filepath.Clean(value.ServerRoot)] {
			return nil, fmt.Errorf("duplicate Crafty server UUID, port, or server root in profile %s", value.ID)
		}
		serverIDs[value.CraftyServerID] = true
		ports[value.Port] = true
		roots[filepath.Clean(value.ServerRoot)] = true
		values = append(values, value)
	}
	if len(values) == 0 {
		return nil, errors.New("profile directory contains no approved JSON profiles")
	}
	return values, nil
}
func newFlagSet(name string, stderr io.Writer) *flag.FlagSet {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.SetOutput(stderr)
	return flags
}
func extractJSON(args []string) ([]string, bool) {
	filtered := make([]string, 0, len(args))
	jsonOutput := false
	for _, arg := range args {
		if arg == "--json" {
			jsonOutput = true
			continue
		}
		filtered = append(filtered, arg)
	}
	return filtered, jsonOutput
}
func emitJSON(writer io.Writer, value envelope) {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(value)
}

func writeJSONAtomic(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".mcctl-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o640); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(raw, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
func helpText() string {
	return `mcctl - Crafty client, admission controller, monitor, and audit CLI

Usage:
  mcctl [--json] version
  mcctl [--json] config validate --file <path>
  mcctl [--json] profile validate --file <path>
  mcctl [--json] doctor --config <path>
  mcctl [--json] crafty servers|stats|action --config <path> [--server <uuid>] [--action <name>]
  mcctl [--json] crafty contract-verify --config <path> --file <openapi.yml>
  mcctl [--json] monitor sample --config <path>
  mcctl [--json] monitor recover --config <path> --confirm quarantine-corrupt-monitor
  mcctl [--json] health|alerts --config <path>
  mcctl [--json] audit --config <path>
  mcctl [--json] gate check --config <path> --profile <path>
  mcctl gate exec --config <path> --profile <path> -- java <approved args>
  mcctl [--json] atlas check|sync --root <repo>

Crafty owns server lifecycle and catalog state. Gate exec is the only approved JVM launch command.
`
}
