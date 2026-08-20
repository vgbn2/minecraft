package config

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/vgbn2/minecraft/internal/model"
	"github.com/vgbn2/minecraft/internal/validate"
)

func Load(path string) (model.Config, error) {
	var cfg model.Config
	file, err := os.Open(path)
	if err != nil {
		return cfg, fmt.Errorf("open config: %w", err)
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		return cfg, fmt.Errorf("decode config: %w", err)
	}
	if err := validate.Config(cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}
