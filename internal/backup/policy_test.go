package backup

import "testing"

func TestBackupRequiresStoppedServer(t *testing.T) {
	if err := RequireStopped("stopped"); err != nil {
		t.Fatal(err)
	}
	if err := RequireStopped("running"); err == nil {
		t.Fatal("running backup should fail")
	}
}

func TestArchivePathSafety(t *testing.T) {
	for _, path := range []string{"../world", "/absolute/world", ".."} {
		if err := ValidateArchivePath(path); err == nil {
			t.Fatalf("unsafe path %q passed", path)
		}
	}
	if err := ValidateArchivePath("world/region/r.0.0.mca"); err != nil {
		t.Fatalf("safe path failed: %v", err)
	}
}
