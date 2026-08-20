package monitor

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"

	"github.com/vgbn2/minecraft/internal/admission"
	"github.com/vgbn2/minecraft/internal/model"
)

type Store struct{ db *sql.DB }

type AlertRecord struct {
	Key          string `json:"key"`
	Severity     string `json:"severity"`
	Active       bool   `json:"active"`
	FirstSeen    int64  `json:"first_seen"`
	LastSeen     int64  `json:"last_seen"`
	LastNotified int64  `json:"last_notified"`
	Occurrences  int    `json:"occurrences"`
	Detail       string `json:"detail"`
}

type AlertEvent struct {
	ID         int64  `json:"id"`
	Key        string `json:"key"`
	Transition string `json:"transition"`
	OccurredAt int64  `json:"occurred_at"`
	Detail     string `json:"detail"`
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("create monitor state directory: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open monitor database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.initialize(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (store *Store) Close() error { return store.db.Close() }

func (store *Store) initialize(ctx context.Context) error {
	for _, statement := range []string{
		"PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL", "PRAGMA busy_timeout=5000", "PRAGMA foreign_keys=ON",
		`CREATE TABLE IF NOT EXISTS samples(sampled_at INTEGER PRIMARY KEY, snapshot_json TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS rollups(bucket_seconds INTEGER NOT NULL, bucket_at INTEGER NOT NULL, summary_json TEXT NOT NULL, PRIMARY KEY(bucket_seconds,bucket_at))`,
		`CREATE TABLE IF NOT EXISTS reservations(server_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, heap_mb INTEGER NOT NULL, pid INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS alerts(alert_key TEXT PRIMARY KEY, severity TEXT NOT NULL, active INTEGER NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, last_notified INTEGER NOT NULL, occurrences INTEGER NOT NULL, detail TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS alert_events(id INTEGER PRIMARY KEY AUTOINCREMENT, alert_key TEXT NOT NULL, transition TEXT NOT NULL, occurred_at INTEGER NOT NULL, detail TEXT NOT NULL)`,
	} {
		if _, err := store.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize monitor database: %w", err)
		}
	}
	var integrity string
	if err := store.db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); err != nil || integrity != "ok" {
		return fmt.Errorf("monitor database integrity check failed: %s: %w", integrity, err)
	}
	return nil
}

func (store *Store) RecordSnapshot(ctx context.Context, snapshot model.Snapshot) error {
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("encode snapshot: %w", err)
	}
	_, err = store.db.ExecContext(ctx, "INSERT OR REPLACE INTO samples(sampled_at,snapshot_json) VALUES(?,?)", snapshot.SampledAt.Unix(), string(raw))
	if err != nil {
		return fmt.Errorf("record snapshot: %w", err)
	}
	return nil
}

func (store *Store) EnrichSnapshot(ctx context.Context, snapshot *model.Snapshot) error {
	rows, err := store.db.QueryContext(ctx, "SELECT snapshot_json FROM samples WHERE sampled_at >= ? ORDER BY sampled_at", snapshot.SampledAt.Add(-5*time.Minute).Unix())
	if err != nil {
		return fmt.Errorf("query metric window: %w", err)
	}
	defer rows.Close()
	totalCPU := snapshot.CPUPercentCurrent
	count := 1
	var previous *model.Snapshot
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return err
		}
		var old model.Snapshot
		if err := json.Unmarshal([]byte(raw), &old); err != nil {
			return fmt.Errorf("decode stored snapshot: %w", err)
		}
		totalCPU += old.CPUPercentCurrent
		count++
		copy := old
		previous = &copy
	}
	if err := rows.Err(); err != nil {
		return err
	}
	snapshot.CPUPercent5m = totalCPU / float64(count)
	snapshot.CPUWindowSamples = count
	if previous != nil && snapshot.SampledAt.After(previous.SampledAt) && snapshot.SwapOutPages >= previous.SwapOutPages {
		pages := snapshot.SwapOutPages - previous.SwapOutPages
		seconds := snapshot.SampledAt.Sub(previous.SampledAt).Seconds()
		snapshot.SwapOutMiBPerMinute = float64(pages*uint64(os.Getpagesize())) / 1024 / 1024 * 60 / seconds
		if snapshot.SwapOutMiBPerMinute > 10 {
			snapshot.SwapOutSamples = previous.SwapOutSamples + 1
		}
	}
	return nil
}

func (store *Store) Reserve(ctx context.Context, serverID, profileID string, heapMB, pid int, now time.Time, ttl time.Duration) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin reservation: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM reservations WHERE expires_at <= ?", now.Unix()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO reservations(server_id,profile_id,heap_mb,pid,created_at,expires_at) VALUES(?,?,?,?,?,?)", serverID, profileID, heapMB, pid, now.Unix(), now.Add(ttl).Unix()); err != nil {
		return fmt.Errorf("reserve start: %w", err)
	}
	return tx.Commit()
}

func (store *Store) Reservations(ctx context.Context, now time.Time) ([]admission.Reservation, error) {
	if _, err := store.db.ExecContext(ctx, "DELETE FROM reservations WHERE expires_at <= ?", now.Unix()); err != nil {
		return nil, err
	}
	rows, err := store.db.QueryContext(ctx, "SELECT server_id,heap_mb FROM reservations ORDER BY server_id")
	if err != nil {
		return nil, fmt.Errorf("query reservations: %w", err)
	}
	defer rows.Close()
	var values []admission.Reservation
	for rows.Next() {
		var value admission.Reservation
		if err := rows.Scan(&value.ServerID, &value.HeapMB); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func (store *Store) Prune(ctx context.Context, now time.Time) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM samples WHERE sampled_at < ?", now.Add(-48*time.Hour).Unix()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM rollups WHERE bucket_seconds=300 AND bucket_at < ?", now.Add(-30*24*time.Hour).Unix()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM rollups WHERE bucket_seconds=86400 AND bucket_at < ?", now.Add(-180*24*time.Hour).Unix()); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *Store) ReconcileAlerts(ctx context.Context, current []AlertRecord, now time.Time) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	active := map[string]bool{}
	rows, err := tx.QueryContext(ctx, "SELECT alert_key FROM alerts WHERE active=1")
	if err != nil {
		return err
	}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		active[key] = true
	}
	if err := rows.Close(); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, finding := range current {
		seen[finding.Key] = true
		transition := "ongoing"
		if !active[finding.Key] {
			transition = "triggered"
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO alerts(alert_key,severity,active,first_seen,last_seen,last_notified,occurrences,detail) VALUES(?,?,1,?,?,0,1,?) ON CONFLICT(alert_key) DO UPDATE SET severity=excluded.severity,active=1,last_seen=excluded.last_seen,occurrences=alerts.occurrences+1,detail=excluded.detail`, finding.Key, finding.Severity, now.Unix(), now.Unix(), finding.Detail)
		if err != nil {
			return err
		}
		if transition == "triggered" {
			if _, err := tx.ExecContext(ctx, "INSERT INTO alert_events(alert_key,transition,occurred_at,detail) VALUES(?,?,?,?)", finding.Key, transition, now.Unix(), finding.Detail); err != nil {
				return err
			}
		}
	}
	for key := range active {
		if !seen[key] {
			if _, err := tx.ExecContext(ctx, "UPDATE alerts SET active=0,last_seen=? WHERE alert_key=?", now.Unix(), key); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO alert_events(alert_key,transition,occurred_at,detail) VALUES(?,?,?,?)", key, "recovered", now.Unix(), "condition recovered"); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (store *Store) Alerts(ctx context.Context) ([]AlertRecord, []AlertEvent, error) {
	rows, err := store.db.QueryContext(ctx, "SELECT alert_key,severity,active,first_seen,last_seen,last_notified,occurrences,detail FROM alerts ORDER BY active DESC,severity,alert_key")
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var records []AlertRecord
	for rows.Next() {
		var value AlertRecord
		if err := rows.Scan(&value.Key, &value.Severity, &value.Active, &value.FirstSeen, &value.LastSeen, &value.LastNotified, &value.Occurrences, &value.Detail); err != nil {
			return nil, nil, err
		}
		records = append(records, value)
	}
	eventRows, err := store.db.QueryContext(ctx, "SELECT id,alert_key,transition,occurred_at,detail FROM alert_events ORDER BY id DESC LIMIT 200")
	if err != nil {
		return nil, nil, err
	}
	defer eventRows.Close()
	var events []AlertEvent
	for eventRows.Next() {
		var value AlertEvent
		if err := eventRows.Scan(&value.ID, &value.Key, &value.Transition, &value.OccurredAt, &value.Detail); err != nil {
			return nil, nil, err
		}
		events = append(events, value)
	}
	return records, events, eventRows.Err()
}

func WriteSnapshotAtomic(path string, snapshot model.Snapshot) error {
	raw, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("encode current snapshot: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".snapshot-*")
	if err != nil {
		return fmt.Errorf("create temporary snapshot: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
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
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("promote current snapshot: %w", err)
	}
	return nil
}

func Quarantine(databasePath, snapshotPath string, now time.Time) ([]string, error) {
	suffix := ".corrupt-" + now.UTC().Format("20060102T150405Z")
	var moved []string
	for _, path := range []string{databasePath, databasePath + "-wal", databasePath + "-shm", snapshotPath} {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return moved, err
		}
		target := path + suffix
		if err := os.Rename(path, target); err != nil {
			return moved, fmt.Errorf("quarantine %s: %w", path, err)
		}
		moved = append(moved, target)
	}
	return moved, nil
}
