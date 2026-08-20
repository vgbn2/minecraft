package model

import "time"

type CraftyConfig struct {
	BaseURL            string `json:"base_url"`
	TokenFile          string `json:"token_file"`
	OpenAPIVersion     string `json:"openapi_version"`
	OpenAPISHA256      string `json:"openapi_sha256"`
	AllowInsecureLocal bool   `json:"allow_insecure_local_tls"`
	RequestTimeoutSecs int    `json:"request_timeout_seconds"`
}

type StorageTarget struct {
	Path           string  `json:"path"`
	MinFreePercent float64 `json:"min_free_percent"`
	MinFreeBytes   int64   `json:"min_free_bytes"`
	MinInodePct    float64 `json:"min_inode_percent"`
}

type Config struct {
	SchemaVersion      int           `json:"schema_version"`
	StateDir           string        `json:"state_dir"`
	ProfileDir         string        `json:"profile_dir"`
	ServerRoot         string        `json:"server_root"`
	BackupStagingRoot  string        `json:"backup_staging_root"`
	SnapshotPath       string        `json:"snapshot_path"`
	MonitorDBPath      string        `json:"monitor_db_path"`
	OperationLockPath  string        `json:"operation_lock_path"`
	MaxSnapshotAgeSecs int           `json:"max_snapshot_age_seconds"`
	ManagedHeapMaxMB   int           `json:"managed_heap_max_mb"`
	MinAvailableMB     int           `json:"min_available_memory_mb"`
	NativeOverheadMB   int           `json:"native_overhead_mb"`
	ReservationTTLSecs int           `json:"reservation_ttl_seconds"`
	CraftyServiceUID   int           `json:"crafty_service_uid"`
	Crafty             CraftyConfig  `json:"crafty"`
	RootStorage        StorageTarget `json:"root_storage"`
	ServerStorage      StorageTarget `json:"server_storage"`
	BackupStorage      StorageTarget `json:"backup_storage"`
}

type Artifact struct {
	Kind        string `json:"kind"`
	Version     string `json:"version"`
	Build       string `json:"build"`
	DownloadURL string `json:"download_url"`
	SHA256      string `json:"sha256"`
}

type BundleArtifact struct {
	ID          string `json:"id"`
	Version     string `json:"version"`
	DownloadURL string `json:"download_url"`
	SHA256      string `json:"sha256"`
}

type Resources struct {
	HeapInitialMB int `json:"heap_initial_mb"`
	HeapMaxMB     int `json:"heap_max_mb"`
}

type Security struct {
	OnlineMode        bool   `json:"online_mode"`
	OfflineAuthPlugin string `json:"offline_auth_plugin,omitempty"`
	ThreatReview      string `json:"threat_review,omitempty"`
}

type Profile struct {
	SchemaVersion         int              `json:"schema_version"`
	ID                    string           `json:"id"`
	Approved              bool             `json:"approved"`
	ServerType            string           `json:"server_type"`
	MinecraftVersion      string           `json:"minecraft_version"`
	JavaVersion           int              `json:"java_version"`
	Artifact              Artifact         `json:"artifact"`
	Plugins               []BundleArtifact `json:"plugins"`
	Mods                  []BundleArtifact `json:"mods"`
	Resources             Resources        `json:"resources"`
	Security              Security         `json:"security"`
	CraftyServerID        string           `json:"crafty_server_id"`
	ServerRoot            string           `json:"server_root"`
	Port                  int              `json:"port"`
	CompatibilityEvidence string           `json:"compatibility_evidence"`
}

type StorageMetric struct {
	Path             string  `json:"path"`
	FreeBytes        int64   `json:"free_bytes"`
	FreePercent      float64 `json:"free_percent"`
	FreeInodePercent float64 `json:"free_inode_percent"`
}

type ServerMetric struct {
	ID             string `json:"id"`
	ProfileID      string `json:"profile_id"`
	PID            int    `json:"pid"`
	Running        bool   `json:"running"`
	HeapMaxMB      int    `json:"heap_max_mb"`
	RSSBytes       int64  `json:"rss_bytes"`
	PlayerCount    int    `json:"player_count"`
	RestartCount   int    `json:"restart_count"`
	UnexpectedExit bool   `json:"unexpected_exit"`
	OOMEvidence    bool   `json:"oom_evidence"`
}

type Snapshot struct {
	SchemaVersion       int            `json:"schema_version"`
	SampledAt           time.Time      `json:"sampled_at"`
	MonitorHealthy      bool           `json:"monitor_healthy"`
	CraftyHealthy       bool           `json:"crafty_healthy"`
	TimeSyncHealthy     bool           `json:"time_sync_healthy"`
	MaintenanceActive   bool           `json:"maintenance_active"`
	Operation           string         `json:"operation,omitempty"`
	MemAvailableBytes   int64          `json:"mem_available_bytes"`
	SwapOutMiBPerMinute float64        `json:"swap_out_mib_per_minute"`
	SwapOutSamples      int            `json:"swap_out_samples"`
	CPUPercent5m        float64        `json:"cpu_percent_5m"`
	CPUPercentCurrent   float64        `json:"cpu_percent_current"`
	CPUWindowSamples    int            `json:"cpu_window_samples"`
	SwapOutPages        uint64         `json:"swap_out_pages"`
	Load1               float64        `json:"load_1"`
	MemoryFullPSIAvg60  float64        `json:"memory_full_psi_avg60"`
	IOFullPSIAvg60      float64        `json:"io_full_psi_avg60"`
	RootStorage         StorageMetric  `json:"root_storage"`
	ServerStorage       StorageMetric  `json:"server_storage"`
	BackupStorage       StorageMetric  `json:"backup_storage"`
	Servers             []ServerMetric `json:"servers"`
}

type AdmissionDecision struct {
	Allowed         bool     `json:"allowed"`
	ProfileID       string   `json:"profile_id"`
	Reasons         []string `json:"reasons,omitempty"`
	ProjectedFreeMB int64    `json:"projected_free_mb"`
	ProjectedHeapMB int      `json:"projected_heap_mb"`
	SnapshotAgeSecs int64    `json:"snapshot_age_seconds"`
}
