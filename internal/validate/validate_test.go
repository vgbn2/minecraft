package validate

import (
	"github.com/vgbn2/minecraft/internal/model"
	"testing"
)

func validConfig() model.Config {
	return model.Config{SchemaVersion: 2, StateDir: "/var/lib/mcctl", ProfileDir: "/etc/mcctl/profiles", ServerRoot: "/srv/minecraft/servers", BackupStagingRoot: "/srv/minecraft/backups", SnapshotPath: "/run/mcctl/state.json", MonitorDBPath: "/var/lib/mcctl/monitor.db", OperationLockPath: "/run/lock/mcctl.lock", MaxSnapshotAgeSecs: 90, ManagedHeapMaxMB: 6656, MinAvailableMB: 3072, NativeOverheadMB: 512, ReservationTTLSecs: 300, CraftyServiceUID: 1500, Crafty: model.CraftyConfig{BaseURL: "https://127.0.0.1:8443", TokenFile: "/etc/mcctl/token", OpenAPIVersion: "2.0.1", OpenAPISHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", AllowInsecureLocal: true, RequestTimeoutSecs: 10}, RootStorage: model.StorageTarget{Path: "/", MinFreePercent: 10, MinFreeBytes: 20 * 1024 * 1024 * 1024, MinInodePct: 10}, ServerStorage: model.StorageTarget{Path: "/srv/minecraft/servers", MinFreePercent: 10, MinFreeBytes: 20 * 1024 * 1024 * 1024, MinInodePct: 10}, BackupStorage: model.StorageTarget{Path: "/srv/minecraft/backups", MinFreePercent: 15}}
}
func validProfile() model.Profile {
	return model.Profile{SchemaVersion: 2, ID: "paper-main", Approved: true, ServerType: "paper", MinecraftVersion: "1.21.11", JavaVersion: 21, Artifact: model.Artifact{Kind: "paper", Version: "1.21.11", Build: "132", DownloadURL: "https://example.com/paper.jar", SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, Resources: model.Resources{HeapInitialMB: 2048, HeapMaxMB: 4096}, Security: model.Security{OnlineMode: true}, CraftyServerID: "11111111-1111-4111-8111-111111111111", ServerRoot: "/srv/minecraft/servers/paper", Port: 25565, CompatibilityEvidence: "test evidence"}
}
func TestConfigRejectsRemoteInsecureTLS(t *testing.T) {
	cfg := validConfig()
	cfg.Crafty.BaseURL = "https://example.com"
	if err := Config(cfg); err == nil {
		t.Fatal("remote insecure TLS passed")
	}
}
func TestConfigRejectsWeakerMemoryReserve(t *testing.T) {
	cfg := validConfig()
	cfg.MinAvailableMB = 2048
	if err := Config(cfg); err == nil {
		t.Fatal("weaker reserve passed")
	}
}
func TestOfflineModeIsPaperAuthMeOnly(t *testing.T) {
	value := validProfile()
	value.Security = model.Security{OnlineMode: false, OfflineAuthPlugin: "AuthMe", ThreatReview: "reviewed"}
	if err := Profile(value); err != nil {
		t.Fatal(err)
	}
	value.ServerType = "fabric"
	value.Artifact.Kind = "fabric"
	if err := Profile(value); err == nil {
		t.Fatal("offline Fabric passed")
	}
}
func TestProfileRejectsHeapAboveAggregateCap(t *testing.T) {
	value := validProfile()
	value.Resources.HeapMaxMB = 7000
	if err := Profile(value); err == nil {
		t.Fatal("oversized heap passed")
	}
}
