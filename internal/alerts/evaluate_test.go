package alerts

import (
	"testing"

	"github.com/vgbn2/minecraft/internal/model"
)

func TestEvaluateClassifiesAndSortsFindings(t *testing.T) {
	snapshot := model.Snapshot{
		MemAvailableBytes: 2 << 30, CPUPercent5m: 95, MemoryFullPSIAvg60: 6,
		IOFullPSIAvg60: 21, SwapOutMiBPerMinute: 11, SwapOutSamples: 3,
		MonitorHealthy: true, CraftyHealthy: true, TimeSyncHealthy: true,
	}
	findings := Evaluate(snapshot)
	if len(findings) != 5 {
		t.Fatalf("findings=%+v", findings)
	}
	for index, finding := range findings {
		if finding.Severity != "critical" {
			t.Fatalf("finding=%+v", finding)
		}
		if index > 0 && findings[index-1].Key > finding.Key {
			t.Fatalf("findings are not sorted: %+v", findings)
		}
	}
}
