package monitor

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/vgbn2/minecraft/internal/model"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReservationsAreExclusiveAndExpire(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	if err := store.Reserve(ctx, "one", "profile", 4096, 1, now, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := store.Reserve(ctx, "one", "profile", 4096, 2, now, time.Minute); err == nil {
		t.Fatal("duplicate reservation passed")
	}
	values, err := store.Reservations(ctx, now.Add(2*time.Minute))
	if err != nil || len(values) != 0 {
		t.Fatalf("expired reservations remain: %+v %v", values, err)
	}
}

func TestReleaseReservationRequiresMatchingPID(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	if err := store.Reserve(ctx, "one", "profile", 4096, 10, now, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := store.ReleaseReservation(ctx, "one", 11); err == nil {
		t.Fatal("mismatched PID released reservation")
	}
	if err := store.ReleaseReservation(ctx, "one", 10); err != nil {
		t.Fatal(err)
	}
}
func TestAtomicSnapshotRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	want := model.Snapshot{SchemaVersion: 1, SampledAt: time.Now().UTC(), MonitorHealthy: true}
	if err := WriteSnapshotAtomic(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := admissionLoad(path)
	if err != nil || got.SchemaVersion != 1 {
		t.Fatalf("round trip failed: %+v %v", got, err)
	}
}
func admissionLoad(path string) (model.Snapshot, error) {
	raw, err := os.ReadFile(path)
	var value model.Snapshot
	if err == nil {
		err = json.Unmarshal(raw, &value)
	}
	return value, err
}

func TestQuarantineMovesDatabaseAndSnapshot(t *testing.T) {
	dir := t.TempDir()
	database := filepath.Join(dir, "monitor.db")
	snapshot := filepath.Join(dir, "state.json")
	if err := os.WriteFile(database, []byte("bad"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(snapshot, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	moved, err := Quarantine(database, snapshot, time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(moved) != 2 {
		t.Fatalf("moved=%v", moved)
	}
	if _, err := os.Stat(database); !os.IsNotExist(err) {
		t.Fatalf("database was not quarantined: %v", err)
	}
}

func TestQuarantineIncludesWALAndSharedMemory(t *testing.T) {
	dir := t.TempDir()
	database := filepath.Join(dir, "monitor.db")
	snapshot := filepath.Join(dir, "state.json")
	for _, path := range []string{database, database + "-wal", database + "-shm", snapshot} {
		if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	moved, err := Quarantine(database, snapshot, time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC))
	if err != nil || len(moved) != 4 {
		t.Fatalf("moved=%v err=%v", moved, err)
	}
}

func TestRecordSnapshotBuildsFiveMinuteAndDailyRollups(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	start := time.Date(2026, 8, 20, 10, 1, 0, 0, time.UTC)
	for index, memory := range []int64{8 << 30, 6 << 30} {
		snapshot := model.Snapshot{
			SchemaVersion: 2, SampledAt: start.Add(time.Duration(index) * 30 * time.Second), MonitorHealthy: true, CraftyHealthy: true, TimeSyncHealthy: true,
			MemAvailableBytes: memory, CPUPercentCurrent: float64(20 + index*20), Load1: float64(2 + index),
			RootStorage: model.StorageMetric{FreeBytes: 40 << 30}, ServerStorage: model.StorageMetric{FreeBytes: 30 << 30}, BackupStorage: model.StorageMetric{FreeBytes: 20 << 30},
		}
		if err := store.RecordSnapshot(ctx, snapshot); err != nil {
			t.Fatal(err)
		}
	}
	for _, seconds := range []int64{300, 86400} {
		rollups, err := store.Rollups(ctx, seconds)
		if err != nil || len(rollups) != 1 {
			t.Fatalf("seconds=%d rollups=%+v err=%v", seconds, rollups, err)
		}
		got := rollups[0]
		if got.SampleCount != 2 || got.MemAvailableMinBytes != 6<<30 || got.MemAvailableAvgBytes != 7<<30 || got.CPUPercentAverage != 30 {
			t.Fatalf("seconds=%d rollup=%+v", seconds, got)
		}
	}
	if err := store.Checkpoint(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestPruneAppliesRawAndRollupRetentionWindows(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	now := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	for _, sampledAt := range []time.Time{now.Add(-49 * time.Hour), now.Add(-47 * time.Hour)} {
		if _, err := store.db.ExecContext(ctx, "INSERT INTO samples(sampled_at,snapshot_json) VALUES(?,?)", sampledAt.Unix(), `{}`); err != nil {
			t.Fatal(err)
		}
	}
	for _, fixture := range []struct {
		seconds int64
		at      time.Time
	}{
		{300, now.Add(-31 * 24 * time.Hour)}, {300, now.Add(-29 * 24 * time.Hour)},
		{86400, now.Add(-181 * 24 * time.Hour)}, {86400, now.Add(-179 * 24 * time.Hour)},
	} {
		if _, err := store.db.ExecContext(ctx, "INSERT INTO rollups(bucket_seconds,bucket_at,summary_json) VALUES(?,?,?)", fixture.seconds, fixture.at.Unix(), `{}`); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Prune(ctx, now); err != nil {
		t.Fatal(err)
	}
	for query, want := range map[string]int{
		"SELECT COUNT(*) FROM samples":                            1,
		"SELECT COUNT(*) FROM rollups WHERE bucket_seconds=300":   1,
		"SELECT COUNT(*) FROM rollups WHERE bucket_seconds=86400": 1,
	} {
		var got int
		if err := store.db.QueryRowContext(ctx, query).Scan(&got); err != nil || got != want {
			t.Fatalf("query=%q got=%d want=%d err=%v", query, got, want, err)
		}
	}
}

type fakeNotifier struct {
	name          string
	notifications []Notification
	fail          bool
}

func (value *fakeNotifier) Name() string { return value.name }
func (value *fakeNotifier) Notify(_ context.Context, notification Notification) error {
	value.notifications = append(value.notifications, notification)
	if value.fail {
		return errors.New("secret-token /private/path")
	}
	return nil
}

func TestAlertHysteresisDedupRecoveryReminderAndMockDelivery(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	warning := []AlertRecord{{Key: "memory", Severity: "warning", Detail: "memory elevated"}}
	if due, err := store.ReconcileAlerts(ctx, warning, now); err != nil || len(due) != 0 {
		t.Fatalf("first warning due=%v err=%v", due, err)
	}
	due, err := store.ReconcileAlerts(ctx, warning, now.Add(30*time.Second))
	if err != nil || len(due) != 1 || due[0].Transition != "triggered" {
		t.Fatalf("second warning due=%v err=%v", due, err)
	}
	notifier := &fakeNotifier{name: "fixture"}
	if err := store.DeliverNotifications(ctx, due, []Notifier{notifier}, now.Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	if due, err = store.ReconcileAlerts(ctx, warning, now.Add(29*time.Minute)); err != nil || len(due) != 0 {
		t.Fatalf("early reminder due=%v err=%v", due, err)
	}
	due, err = store.ReconcileAlerts(ctx, warning, now.Add(31*time.Minute))
	if err != nil || len(due) != 1 || due[0].Transition != "reminder" {
		t.Fatalf("reminder due=%v err=%v", due, err)
	}
	if due, err = store.ReconcileAlerts(ctx, warning, now.Add(31*time.Minute+30*time.Second)); err != nil || len(due) != 0 {
		t.Fatalf("duplicate reminder due=%v err=%v", due, err)
	}
	if due, err = store.ReconcileAlerts(ctx, warning, now.Add(61*time.Minute)); err != nil || len(due) != 1 || due[0].Transition != "reminder" {
		t.Fatalf("second interval reminder due=%v err=%v", due, err)
	}
	if due, err = store.ReconcileAlerts(ctx, nil, now.Add(62*time.Minute)); err != nil || len(due) != 0 {
		t.Fatalf("first clear due=%v err=%v", due, err)
	}
	due, err = store.ReconcileAlerts(ctx, nil, now.Add(63*time.Minute))
	if err != nil || len(due) != 1 || due[0].Transition != "recovered" {
		t.Fatalf("recovery due=%v err=%v", due, err)
	}
}

func TestCriticalAlertImmediateAndNotifierErrorIsRedacted(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	due, err := store.ReconcileAlerts(ctx, []AlertRecord{{Key: "cpu", Severity: "critical", Detail: "critical CPU"}}, now)
	if err != nil || len(due) != 1 {
		t.Fatalf("due=%v err=%v", due, err)
	}
	err = store.DeliverNotifications(ctx, due, []Notifier{&fakeNotifier{name: "fixture", fail: true}}, now)
	if err == nil || strings.Contains(err.Error(), "secret-token") || strings.Contains(err.Error(), "/private") {
		t.Fatalf("unexpected delivery error %q", err)
	}
	_, events, err := store.Alerts(ctx)
	if err != nil || len(events) < 2 || strings.Contains(fmt.Sprint(events), "secret-token") {
		t.Fatalf("events=%v err=%v", events, err)
	}
}

func TestAlertStateSurvivesMonitorRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "monitor.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	critical := []AlertRecord{{Key: "memory", Severity: "critical", Detail: "critical memory"}}
	if due, err := store.ReconcileAlerts(ctx, critical, now); err != nil || len(due) != 1 {
		t.Fatalf("due=%v err=%v", due, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if due, err := store.ReconcileAlerts(ctx, critical, now.Add(time.Minute)); err != nil || len(due) != 0 {
		t.Fatalf("restart duplicated transition due=%v err=%v", due, err)
	}
}

func TestFailedDeliveryAttemptThrottleSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "monitor.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	critical := []AlertRecord{{Key: "memory", Severity: "critical", Detail: "critical memory"}}
	due, err := store.ReconcileAlerts(ctx, critical, now)
	if err != nil || len(due) != 1 {
		t.Fatalf("due=%v err=%v", due, err)
	}
	if err := store.DeliverNotifications(ctx, due, []Notifier{&fakeNotifier{name: "fixture", fail: true}}, now); err == nil {
		t.Fatal("failed delivery unexpectedly passed")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if due, err = store.ReconcileAlerts(ctx, critical, now.Add(30*time.Minute-time.Second)); err != nil || len(due) != 0 {
		t.Fatalf("restart repeated early reminder due=%v err=%v", due, err)
	}
	if due, err = store.ReconcileAlerts(ctx, critical, now.Add(30*time.Minute)); err != nil || len(due) != 1 || due[0].Transition != "reminder" {
		t.Fatalf("restart reminder due=%v err=%v", due, err)
	}
	if due, err = store.ReconcileAlerts(ctx, critical, now.Add(30*time.Minute+30*time.Second)); err != nil || len(due) != 0 {
		t.Fatalf("failed reminder repeated due=%v err=%v", due, err)
	}
	records, _, err := store.Alerts(ctx)
	if err != nil || len(records) != 1 || records[0].LastNotified != 0 {
		t.Fatalf("failed delivery changed success evidence records=%v err=%v", records, err)
	}
}

func TestOpenAddsNotificationAttemptTableToExistingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "monitor.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	statements := []string{
		`CREATE TABLE alerts(alert_key TEXT PRIMARY KEY, severity TEXT NOT NULL, active INTEGER NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, last_notified INTEGER NOT NULL, occurrences INTEGER NOT NULL, detail TEXT NOT NULL)`,
		`CREATE TABLE alert_hysteresis(alert_key TEXT PRIMARY KEY, present_streak INTEGER NOT NULL, clear_streak INTEGER NOT NULL)`,
		`INSERT INTO alerts VALUES('memory','warning',1,1,2,0,2,'memory elevated')`,
		`INSERT INTO alert_hysteresis VALUES('memory',2,0)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			db.Close()
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var alerts, attempts int
	if err := store.db.QueryRow("SELECT COUNT(*) FROM alerts").Scan(&alerts); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow("SELECT COUNT(*) FROM alert_notification_attempts").Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if alerts != 1 || attempts != 0 {
		t.Fatalf("migration changed existing state alerts=%d attempts=%d", alerts, attempts)
	}
}
