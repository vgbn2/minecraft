//go:build linux

package monitor

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vgbn2/minecraft/internal/crafty"
	"github.com/vgbn2/minecraft/internal/model"
)

type failingCraftyAPI struct{}

func (failingCraftyAPI) ListServers(context.Context) ([]crafty.Server, error) {
	return nil, errors.New("token=secret path=/private player=alice")
}
func (failingCraftyAPI) ServerStats(context.Context, string) (crafty.Stats, error) {
	return crafty.Stats{}, errors.New("unreachable")
}

func TestCollectEmitsSnapshotV2RedactedIssueCodes(t *testing.T) {
	missing := "/path/that/does/not/exist"
	cfg := model.Config{
		RootStorage: model.StorageTarget{Path: missing}, ServerStorage: model.StorageTarget{Path: missing}, BackupStorage: model.StorageTarget{Path: missing},
	}
	snapshot := Collect(context.Background(), cfg, failingCraftyAPI{}, nil, time.Now().UTC())
	if snapshot.SchemaVersion != 2 || snapshot.MonitorHealthy || snapshot.CraftyHealthy {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	want := map[string]bool{
		"root_storage_unavailable": false, "server_storage_unavailable": false,
		"backup_storage_unavailable": false, "crafty_inventory_unavailable": false,
	}
	for _, issue := range snapshot.Issues {
		if _, exists := want[issue.Code]; exists {
			want[issue.Code] = true
		}
	}
	for code, present := range want {
		if !present {
			t.Fatalf("missing issue %s in %+v", code, snapshot.Issues)
		}
	}
}
