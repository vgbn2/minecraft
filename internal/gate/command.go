package gate

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/vgbn2/minecraft/internal/model"
)

func CheckCommand(profile model.Profile, args []string) error {
	if len(args) < 5 || filepath.Base(args[0]) != "java" {
		return fmt.Errorf("execution must invoke java directly")
	}
	wantXMS := fmt.Sprintf("-Xms%dM", profile.Resources.HeapInitialMB)
	wantXMX := fmt.Sprintf("-Xmx%dM", profile.Resources.HeapMaxMB)
	hasXMS, hasXMX := false, false
	jarPath := ""
	for index, arg := range args {
		if arg == wantXMS {
			hasXMS = true
		}
		if arg == wantXMX {
			hasXMX = true
		}
		if strings.HasPrefix(arg, "-Xms") && arg != wantXMS {
			return fmt.Errorf("unexpected JVM initial heap %q", arg)
		}
		if strings.HasPrefix(arg, "-Xmx") && arg != wantXMX {
			return fmt.Errorf("unexpected JVM maximum heap %q", arg)
		}
		if arg == "-jar" && index+1 < len(args) {
			jarPath = args[index+1]
		}
	}
	if !hasXMS || !hasXMX || jarPath == "" {
		return fmt.Errorf("execution command does not match approved JVM bounds or artifact")
	}
	absJar, err := filepath.Abs(jarPath)
	if err != nil {
		return err
	}
	realJar, err := filepath.EvalSymlinks(absJar)
	if err != nil {
		return fmt.Errorf("resolve server artifact: %w", err)
	}
	realRoot, err := filepath.EvalSymlinks(profile.ServerRoot)
	if err != nil {
		return fmt.Errorf("resolve approved server root: %w", err)
	}
	root := filepath.Clean(realRoot) + string(filepath.Separator)
	if !strings.HasPrefix(realJar, root) {
		return fmt.Errorf("artifact is outside approved server root")
	}
	digest, err := fileSHA256(realJar)
	if err != nil {
		return err
	}
	if digest != profile.Artifact.SHA256 {
		return fmt.Errorf("artifact checksum mismatch")
	}
	return nil
}

func CheckRuntime(profile model.Profile, args []string) error {
	if err := CheckCommand(profile, args); err != nil {
		return err
	}
	raw, err := os.ReadFile(filepath.Join(profile.ServerRoot, "server.properties"))
	if err != nil {
		return fmt.Errorf("read server.properties: %w", err)
	}
	want := fmt.Sprintf("online-mode=%t", profile.Security.OnlineMode)
	found := false
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "online-mode=") {
			if line != want {
				return fmt.Errorf("server.properties online-mode does not match profile")
			}
			found = true
		}
	}
	if !found {
		return fmt.Errorf("server.properties does not declare online-mode")
	}
	for _, artifact := range profile.Plugins {
		if err := checkBundle(filepath.Join(profile.ServerRoot, "plugins"), artifact); err != nil {
			return err
		}
	}
	for _, artifact := range profile.Mods {
		if err := checkBundle(filepath.Join(profile.ServerRoot, "mods"), artifact); err != nil {
			return err
		}
	}
	return nil
}

func checkBundle(root string, artifact model.BundleArtifact) error {
	parsed, err := url.Parse(artifact.DownloadURL)
	if err != nil {
		return err
	}
	name := filepath.Base(parsed.Path)
	if name == "." || name == "/" || name == "" {
		return fmt.Errorf("bundle %s has no artifact filename", artifact.ID)
	}
	digest, err := fileSHA256(filepath.Join(root, name))
	if err != nil {
		return fmt.Errorf("bundle %s: %w", artifact.ID, err)
	}
	if digest != artifact.SHA256 {
		return fmt.Errorf("bundle %s checksum mismatch", artifact.ID)
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open server artifact: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", fmt.Errorf("hash server artifact: %w", err)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
