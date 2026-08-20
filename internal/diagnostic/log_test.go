package diagnostic

import (
	"bytes"
	"strings"
	"testing"
)

func TestEventProducesOneStructuredLine(t *testing.T) {
	var output bytes.Buffer
	Event(&output, "monitor_probe_failed", map[string]any{"component": "storage", "issue_code": "root_storage_unavailable"})
	if strings.Count(output.String(), "\n") != 1 || !strings.Contains(output.String(), `"event":"monitor_probe_failed"`) || !strings.Contains(output.String(), `"issue_code":"root_storage_unavailable"`) {
		t.Fatalf("output=%q", output.String())
	}
}

func TestHealthyStructuredLogVolumeIsBounded(t *testing.T) {
	var output bytes.Buffer
	const events = 1000
	for index := 0; index < events; index++ {
		Event(&output, "monitor_sample_completed", map[string]any{"issue_count": 0})
	}
	if lines := strings.Count(output.String(), "\n"); lines != events {
		t.Fatalf("lines=%d", lines)
	}
	bytesPerEvent := output.Len() / events
	t.Logf("events=%d bytes=%d bytes_per_event=%d", events, output.Len(), bytesPerEvent)
	if bytesPerEvent > 128 {
		t.Fatalf("structured log bytes per event=%d", bytesPerEvent)
	}
}
