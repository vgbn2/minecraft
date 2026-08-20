package monitor

import (
	"context"
	"encoding/json"
	"github.com/vgbn2/minecraft/internal/model"
	"os"
	"path/filepath"
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
