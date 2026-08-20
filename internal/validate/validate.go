package validate

import (
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/vgbn2/minecraft/internal/model"
)

var (
	idPattern     = regexp.MustCompile(`^[a-z][a-z0-9-]{2,63}$`)
	sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
	uuidPattern   = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
)

func ID(id string) error {
	if !idPattern.MatchString(id) {
		return errors.New("id must match ^[a-z][a-z0-9-]{2,63}$")
	}
	return nil
}

func Config(cfg model.Config) error {
	if cfg.SchemaVersion != 2 {
		return fmt.Errorf("unsupported config schema_version %d", cfg.SchemaVersion)
	}
	for name, path := range map[string]string{
		"state_dir": cfg.StateDir, "profile_dir": cfg.ProfileDir, "server_root": cfg.ServerRoot,
		"backup_staging_root": cfg.BackupStagingRoot, "snapshot_path": cfg.SnapshotPath,
		"monitor_db_path": cfg.MonitorDBPath, "operation_lock_path": cfg.OperationLockPath,
		"crafty.token_file": cfg.Crafty.TokenFile,
	} {
		if path == "" || !filepath.IsAbs(path) {
			return fmt.Errorf("%s must be an absolute path", name)
		}
	}
	parsed, err := url.Parse(cfg.Crafty.BaseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Path != "" {
		return errors.New("crafty.base_url must be an HTTPS origin without a path")
	}
	if cfg.Crafty.AllowInsecureLocal && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" && parsed.Hostname() != "::1" {
		return errors.New("insecure Crafty TLS is allowed only for a loopback origin")
	}
	if cfg.Crafty.OpenAPIVersion != "2.0.1" || !sha256Pattern.MatchString(cfg.Crafty.OpenAPISHA256) {
		return errors.New("Crafty OpenAPI version 2.0.1 and a pinned lowercase SHA-256 are required")
	}
	if cfg.Crafty.RequestTimeoutSecs < 1 || cfg.Crafty.RequestTimeoutSecs > 60 {
		return errors.New("crafty.request_timeout_seconds must be within 1..60")
	}
	if cfg.MaxSnapshotAgeSecs < 30 || cfg.MaxSnapshotAgeSecs > 90 || cfg.ManagedHeapMaxMB != 6656 || cfg.MinAvailableMB != 3072 || cfg.NativeOverheadMB < 512 {
		return errors.New("admission requires max age 30..90s, 6656 MiB heap cap, 3072 MiB reserve, and at least 512 MiB native overhead")
	}
	if cfg.ReservationTTLSecs < 120 || cfg.ReservationTTLSecs > 600 {
		return errors.New("reservation_ttl_seconds must be within 120..600")
	}
	if cfg.CraftyServiceUID <= 0 {
		return errors.New("crafty_service_uid must be explicit and non-root")
	}
	for name, target := range map[string]model.StorageTarget{"root_storage": cfg.RootStorage, "server_storage": cfg.ServerStorage, "backup_storage": cfg.BackupStorage} {
		if target.Path == "" || !filepath.IsAbs(target.Path) || target.MinFreePercent <= 0 || target.MinFreePercent >= 100 || target.MinFreeBytes < 0 || target.MinInodePct < 0 || target.MinInodePct >= 100 {
			return fmt.Errorf("%s has invalid path or limits", name)
		}
	}
	const twentyGiB = int64(20 * 1024 * 1024 * 1024)
	if cfg.RootStorage.MinFreePercent < 10 || cfg.RootStorage.MinFreeBytes < twentyGiB || cfg.RootStorage.MinInodePct < 10 ||
		cfg.ServerStorage.MinFreePercent < 10 || cfg.ServerStorage.MinFreeBytes < twentyGiB || cfg.ServerStorage.MinInodePct < 10 || cfg.BackupStorage.MinFreePercent < 15 {
		return errors.New("storage limits are weaker than the approved admission minimum")
	}
	return nil
}

func Profile(value model.Profile) error {
	if value.SchemaVersion != 2 {
		return fmt.Errorf("unsupported profile schema_version %d", value.SchemaVersion)
	}
	if err := ID(value.ID); err != nil {
		return fmt.Errorf("profile id: %w", err)
	}
	if !value.Approved {
		return errors.New("profile must be explicitly approved")
	}
	allowed := map[string]bool{"paper": true, "fabric": true, "vanilla": true, "forge": true, "neoforge": true}
	if !allowed[value.ServerType] {
		return errors.New("server_type is not supported")
	}
	if value.MinecraftVersion == "" || value.JavaVersion != 21 {
		return errors.New("Minecraft version and Java 21 are required")
	}
	if value.Artifact.Kind != value.ServerType || value.Artifact.Version == "" || !sha256Pattern.MatchString(value.Artifact.SHA256) {
		return errors.New("artifact kind/version/lowercase SHA-256 must match the profile")
	}
	if err := artifactURL(value.Artifact.DownloadURL); err != nil {
		return fmt.Errorf("artifact: %w", err)
	}
	if value.Resources.HeapInitialMB <= 0 || value.Resources.HeapMaxMB <= 0 || value.Resources.HeapInitialMB > value.Resources.HeapMaxMB || value.Resources.HeapMaxMB > 6656 {
		return errors.New("heap must satisfy 0 < initial <= max <= 6656 MiB")
	}
	if !uuidPattern.MatchString(value.CraftyServerID) {
		return errors.New("crafty_server_id must be a UUID")
	}
	if value.ServerRoot == "" || !filepath.IsAbs(value.ServerRoot) {
		return errors.New("server_root must be absolute")
	}
	if value.Port < 1024 || value.Port > 65535 {
		return errors.New("port must be within 1024..65535")
	}
	if strings.TrimSpace(value.CompatibilityEvidence) == "" {
		return errors.New("compatibility_evidence is required")
	}
	if !value.Security.OnlineMode && (value.ServerType != "paper" || strings.ToLower(value.Security.OfflineAuthPlugin) != "authme" || strings.TrimSpace(value.Security.ThreatReview) == "") {
		return errors.New("offline mode is allowed only for Paper with AuthMe and threat-review evidence")
	}
	seen := map[string]struct{}{}
	for _, artifact := range append(append([]model.BundleArtifact{}, value.Plugins...), value.Mods...) {
		if artifact.ID == "" || artifact.Version == "" || !sha256Pattern.MatchString(artifact.SHA256) {
			return errors.New("each plugin/mod requires id, version, and lowercase SHA-256")
		}
		if _, exists := seen[artifact.ID]; exists {
			return fmt.Errorf("duplicate bundle artifact id %q", artifact.ID)
		}
		seen[artifact.ID] = struct{}{}
		if err := artifactURL(artifact.DownloadURL); err != nil {
			return fmt.Errorf("bundle artifact %s: %w", artifact.ID, err)
		}
	}
	return nil
}

func artifactURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return errors.New("download_url must be an absolute HTTPS URL")
	}
	return nil
}
