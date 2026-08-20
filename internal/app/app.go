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

	"github.com/vgbn2/minecraft/internal/atlas"
	controlconfig "github.com/vgbn2/minecraft/internal/config"
	"github.com/vgbn2/minecraft/internal/crafty"
	"github.com/vgbn2/minecraft/internal/model"
	"github.com/vgbn2/minecraft/internal/profile"
	"github.com/vgbn2/minecraft/internal/statefile"
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
		return alertsCommand(ctx, args[1:], stderr)
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
	return statefile.WriteJSONAtomic(path, value)
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
