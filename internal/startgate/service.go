package startgate

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/vgbn2/minecraft/internal/admission"
	"github.com/vgbn2/minecraft/internal/gate"
	operationlock "github.com/vgbn2/minecraft/internal/lock"
	"github.com/vgbn2/minecraft/internal/model"
	"github.com/vgbn2/minecraft/internal/monitor"
)

type Request struct {
	Config  model.Config
	Profile model.Profile
	Command []string
	Execute bool
	EUID    int
	PID     int
	Now     time.Time
}

type Result struct {
	Decision model.AdmissionDecision
	Reserved bool
}

// Authorize owns the lock-to-reservation transaction. Runtime verification is
// performed while the global operation lock is held so no competing start can
// observe a partially authorized launch.
func Authorize(ctx context.Context, request Request) (Result, error) {
	if err := validateServerRoot(request.Config.ServerRoot, request.Profile.ServerRoot); err != nil {
		return Result{}, err
	}
	guard, err := operationlock.Acquire(request.Config.OperationLockPath, true)
	if err != nil {
		return Result{}, errors.New("operation_in_progress")
	}
	defer guard.Close()
	store, err := monitor.Open(request.Config.MonitorDBPath)
	if err != nil {
		return Result{}, err
	}
	defer store.Close()
	reservations, err := store.Reservations(ctx, request.Now)
	if err != nil {
		return Result{}, err
	}
	snapshot, err := admission.LoadSnapshot(request.Config.SnapshotPath)
	if err != nil {
		return Result{}, err
	}
	decision := admission.Evaluate(request.Now, request.Config, request.Profile, snapshot, reservations)
	result := Result{Decision: decision}
	if !request.Execute {
		return result, nil
	}
	if request.EUID != request.Config.CraftyServiceUID {
		return Result{}, errors.New("gate exec must run as the configured Crafty service UID")
	}
	if !decision.Allowed {
		return result, nil
	}
	if err := gate.CheckRuntime(request.Profile, request.Command); err != nil {
		return Result{}, err
	}
	ttl := time.Duration(request.Config.ReservationTTLSecs) * time.Second
	if err := store.Reserve(ctx, request.Profile.CraftyServerID, request.Profile.ID, request.Profile.Resources.HeapMaxMB, request.PID, request.Now, ttl); err != nil {
		return Result{}, err
	}
	result.Reserved = true
	return result, nil
}

func ReleaseFailedExec(ctx context.Context, cfg model.Config, serverID string, pid int) error {
	guard, err := operationlock.Acquire(cfg.OperationLockPath, false)
	if err != nil {
		return errors.New("operation_in_progress")
	}
	defer guard.Close()
	store, err := monitor.Open(cfg.MonitorDBPath)
	if err != nil {
		return err
	}
	defer store.Close()
	return store.ReleaseReservation(ctx, serverID, pid)
}

func validateServerRoot(configuredRoot, profileRoot string) error {
	relative, err := filepath.Rel(filepath.Clean(configuredRoot), filepath.Clean(profileRoot))
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("profile server_root is outside configured server root")
	}
	return nil
}
