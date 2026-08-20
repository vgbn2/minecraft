package monitor

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type Notification struct {
	Key        string `json:"key"`
	Severity   string `json:"severity"`
	Transition string `json:"transition"`
	Detail     string `json:"detail"`
}

type Notifier interface {
	Name() string
	Notify(context.Context, Notification) error
}

type alertState struct {
	AlertRecord
	PresentStreak int
	ClearStreak   int
	LastAttempted int64
}

func (store *Store) ReconcileAlerts(ctx context.Context, current []AlertRecord, now time.Time) ([]Notification, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	states, err := loadAlertStates(ctx, tx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var notifications []Notification
	for _, finding := range current {
		seen[finding.Key] = true
		state, exists := states[finding.Key]
		if !exists {
			state = alertState{AlertRecord: AlertRecord{Key: finding.Key, FirstSeen: now.Unix()}}
		}
		state.Severity = finding.Severity
		state.Detail = finding.Detail
		state.LastSeen = now.Unix()
		state.Occurrences++
		state.PresentStreak++
		state.ClearStreak = 0
		activate := !state.Active && (finding.Severity == "critical" || state.PresentStreak >= 2)
		if activate {
			state.Active = true
			state.FirstSeen = now.Unix()
			state.LastAttempted = now.Unix()
			notification := Notification{Key: finding.Key, Severity: finding.Severity, Transition: "triggered", Detail: finding.Detail}
			notifications = append(notifications, notification)
			if err := recordAlertEvent(ctx, tx, notification, now); err != nil {
				return nil, err
			}
		} else if state.Active && notificationDue(state, now) {
			state.LastAttempted = now.Unix()
			notifications = append(notifications, Notification{Key: finding.Key, Severity: finding.Severity, Transition: "reminder", Detail: finding.Detail})
		}
		if err := saveAlertState(ctx, tx, state); err != nil {
			return nil, err
		}
		states[finding.Key] = state
	}
	for key, state := range states {
		if seen[key] {
			continue
		}
		state.PresentStreak = 0
		state.ClearStreak++
		if state.Active && state.ClearStreak >= 2 {
			state.Active = false
			state.LastAttempted = now.Unix()
			notification := Notification{Key: key, Severity: state.Severity, Transition: "recovered", Detail: "condition recovered"}
			notifications = append(notifications, notification)
			if err := recordAlertEvent(ctx, tx, notification, now); err != nil {
				return nil, err
			}
		}
		if err := saveAlertState(ctx, tx, state); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return notifications, nil
}

func notificationDue(state alertState, now time.Time) bool {
	reference := state.LastAttempted
	if state.LastNotified > reference {
		reference = state.LastNotified
	}
	if reference == 0 {
		reference = state.FirstSeen
	}
	return now.Unix()-reference >= int64(30*time.Minute/time.Second)
}

func loadAlertStates(ctx context.Context, tx *sql.Tx) (map[string]alertState, error) {
	rows, err := tx.QueryContext(ctx, `SELECT a.alert_key,a.severity,a.active,a.first_seen,a.last_seen,a.last_notified,a.occurrences,a.detail,COALESCE(h.present_streak,0),COALESCE(h.clear_streak,0),COALESCE(n.last_attempted,0) FROM alerts a LEFT JOIN alert_hysteresis h ON h.alert_key=a.alert_key LEFT JOIN alert_notification_attempts n ON n.alert_key=a.alert_key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := map[string]alertState{}
	for rows.Next() {
		var value alertState
		if err := rows.Scan(&value.Key, &value.Severity, &value.Active, &value.FirstSeen, &value.LastSeen, &value.LastNotified, &value.Occurrences, &value.Detail, &value.PresentStreak, &value.ClearStreak, &value.LastAttempted); err != nil {
			return nil, err
		}
		values[value.Key] = value
	}
	return values, rows.Err()
}

func saveAlertState(ctx context.Context, tx *sql.Tx, state alertState) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO alerts(alert_key,severity,active,first_seen,last_seen,last_notified,occurrences,detail) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(alert_key) DO UPDATE SET severity=excluded.severity,active=excluded.active,first_seen=excluded.first_seen,last_seen=excluded.last_seen,last_notified=excluded.last_notified,occurrences=excluded.occurrences,detail=excluded.detail`, state.Key, state.Severity, state.Active, state.FirstSeen, state.LastSeen, state.LastNotified, state.Occurrences, state.Detail)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO alert_hysteresis(alert_key,present_streak,clear_streak) VALUES(?,?,?) ON CONFLICT(alert_key) DO UPDATE SET present_streak=excluded.present_streak,clear_streak=excluded.clear_streak`, state.Key, state.PresentStreak, state.ClearStreak)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO alert_notification_attempts(alert_key,last_attempted) VALUES(?,?) ON CONFLICT(alert_key) DO UPDATE SET last_attempted=excluded.last_attempted`, state.Key, state.LastAttempted)
	return err
}

func recordAlertEvent(ctx context.Context, tx *sql.Tx, notification Notification, now time.Time) error {
	_, err := tx.ExecContext(ctx, "INSERT INTO alert_events(alert_key,transition,occurred_at,detail) VALUES(?,?,?,?)", notification.Key, notification.Transition, now.Unix(), notification.Detail)
	return err
}

func (store *Store) DeliverNotifications(ctx context.Context, notifications []Notification, notifiers []Notifier, now time.Time) error {
	var failures []error
	for _, notification := range notifications {
		allDelivered := len(notifiers) > 0
		for _, notifier := range notifiers {
			if err := notifier.Notify(ctx, notification); err != nil {
				allDelivered = false
				failures = append(failures, fmt.Errorf("notification delivery failed for adapter %s", notifier.Name()))
				if recordErr := store.recordNotificationFailure(ctx, notification.Key, notifier.Name(), now); recordErr != nil {
					failures = append(failures, recordErr)
				}
			}
		}
		if allDelivered {
			if _, err := store.db.ExecContext(ctx, "UPDATE alerts SET last_notified=? WHERE alert_key=?", now.Unix(), notification.Key); err != nil {
				failures = append(failures, err)
			}
		}
	}
	return errors.Join(failures...)
}

func (store *Store) recordNotificationFailure(ctx context.Context, key, adapter string, now time.Time) error {
	detail := fmt.Sprintf("adapter=%s code=delivery_failed", adapter)
	_, err := store.db.ExecContext(ctx, "INSERT INTO alert_events(alert_key,transition,occurred_at,detail) VALUES(?,?,?,?)", key, "notification_failed", now.Unix(), detail)
	return err
}
