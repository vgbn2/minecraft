package diagnostic

import (
	"encoding/json"
	"io"
)

func Event(writer io.Writer, event string, fields map[string]any) {
	value := map[string]any{"event": event}
	for key, field := range fields {
		value[key] = field
	}
	_ = json.NewEncoder(writer).Encode(value)
}
