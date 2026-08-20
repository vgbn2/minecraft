package profile

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"

	"github.com/vgbn2/minecraft/internal/model"
	"github.com/vgbn2/minecraft/internal/validate"
)

func Load(path string) (model.Profile, string, error) {
	var value model.Profile
	raw, err := os.ReadFile(path)
	if err != nil {
		return value, "", fmt.Errorf("read profile: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, "", fmt.Errorf("decode profile: %w", err)
	}
	if err := validate.Profile(value); err != nil {
		return value, "", err
	}
	digest := sha256.Sum256(raw)
	return value, hex.EncodeToString(digest[:]), nil
}
