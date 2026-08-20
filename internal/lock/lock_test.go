package lock

import (
	"path/filepath"
	"testing"
)

func TestNonblockingLockAllowsOneWinner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "operation.lock")
	first, err := Acquire(path, true)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if second, err := Acquire(path, true); err == nil {
		second.Close()
		t.Fatal("second lock unexpectedly won")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	third, err := Acquire(path, true)
	if err != nil {
		t.Fatalf("lock not reusable: %v", err)
	}
	third.Close()
}
