package atlas

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	inventoryPath = "workspace/code-atlas/inventory.md"
	beginMarker   = "<!-- BEGIN GENERATED INVENTORY -->"
	endMarker     = "<!-- END GENERATED INVENTORY -->"
)

var markdownLink = regexp.MustCompile(`\[[^]]+\]\(([^)]+)\)`)

func Check(ctx context.Context, root string) error {
	expected, err := expectedInventory(ctx, root)
	if err != nil {
		return err
	}
	current, err := os.ReadFile(filepath.Join(root, inventoryPath))
	if err != nil {
		return fmt.Errorf("read atlas inventory: %w", err)
	}
	generated, err := generatedSection(string(current))
	if err != nil {
		return err
	}
	if generated != expected {
		return fmt.Errorf("atlas inventory is stale; run mcctl atlas sync --root %s", root)
	}
	if err := checkLinks(root); err != nil {
		return err
	}
	return checkDeclaredPaths(root)
}

func Sync(ctx context.Context, root string) error {
	expected, err := expectedInventory(ctx, root)
	if err != nil {
		return err
	}
	path := filepath.Join(root, inventoryPath)
	current, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read atlas inventory: %w", err)
	}
	start := strings.Index(string(current), beginMarker)
	end := strings.Index(string(current), endMarker)
	if start < 0 || end < start {
		return fmt.Errorf("atlas inventory markers are missing or out of order")
	}
	updated := string(current[:start+len(beginMarker)]) + "\n" + expected + "\n" + string(current[end:])
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, []byte(updated), 0o644); err != nil {
		return fmt.Errorf("write temporary atlas inventory: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("promote atlas inventory: %w", err)
	}
	return nil
}

func expectedInventory(ctx context.Context, root string) (string, error) {
	command := exec.CommandContext(ctx, "git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard")
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("list tracked files: %w", err)
	}
	listed := strings.Fields(string(output))
	paths := make([]string, 0, len(listed))
	for _, path := range listed {
		if info, statErr := os.Stat(filepath.Join(root, filepath.FromSlash(path))); statErr == nil && !info.IsDir() {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	var rendered strings.Builder
	rendered.WriteString("| Tracked path | Agent context |\n| --- | --- |\n")
	for _, path := range paths {
		fmt.Fprintf(&rendered, "| `%s` | [%s](%s) |\n", path, contextLabel(path), contextPath(path))
	}
	return strings.TrimSuffix(rendered.String(), "\n"), nil
}

func generatedSection(document string) (string, error) {
	start := strings.Index(document, beginMarker)
	end := strings.Index(document, endMarker)
	if start < 0 || end < start {
		return "", fmt.Errorf("atlas inventory markers are missing or out of order")
	}
	return strings.TrimSpace(document[start+len(beginMarker) : end]), nil
}

func contextLabel(path string) string {
	switch path {
	case "Dockerfile":
		return "Docker image"
	case "docker-compose.yml":
		return "Current Compose"
	case "server.properties.example":
		return "Server properties"
	}
	if strings.HasPrefix(path, "workspace/") {
		return "Workspace continuity"
	}
	if strings.HasPrefix(path, "cmd/") || strings.HasPrefix(path, "internal/") || strings.HasPrefix(path, "examples/") || strings.HasPrefix(path, "tools/") {
		return "Control plane"
	}
	return "Repository root"
}

func contextPath(path string) string {
	switch path {
	case "Dockerfile":
		return "files/Dockerfile.md"
	case "docker-compose.yml":
		return "files/docker-compose.yml.md"
	case "server.properties.example":
		return "files/server.properties.example.md"
	}
	if strings.HasPrefix(path, "workspace/") {
		return "folders/workspace.md"
	}
	if strings.HasPrefix(path, "cmd/") || strings.HasPrefix(path, "internal/") || strings.HasPrefix(path, "examples/") || strings.HasPrefix(path, "tools/") {
		return "folders/control-plane.md"
	}
	return "folders/root.md"
}

func checkLinks(root string) error {
	atlasRoot := filepath.Join(root, "workspace", "code-atlas")
	return filepath.WalkDir(atlasRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".md" {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, match := range markdownLink.FindAllSubmatch(content, -1) {
			target := string(match[1])
			if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") || strings.HasPrefix(target, "#") {
				continue
			}
			target = strings.SplitN(target, "#", 2)[0]
			if _, err := os.Stat(filepath.Join(filepath.Dir(path), filepath.FromSlash(target))); err != nil {
				return fmt.Errorf("broken atlas link in %s: %s", path, target)
			}
		}
		return nil
	})
}

func checkDeclaredPaths(root string) error {
	atlasRoot := filepath.Join(root, "workspace", "code-atlas")
	return filepath.WalkDir(atlasRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || filepath.Ext(path) != ".md" {
			return walkErr
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		scanner := bufio.NewScanner(bytes.NewReader(content))
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "Source paths:") {
				continue
			}
			parts := strings.Split(line, "`")
			for index := 1; index < len(parts); index += 2 {
				declared := parts[index]
				if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(declared))); err != nil {
					return fmt.Errorf("declared source path in %s does not exist: %s", path, declared)
				}
			}
		}
		return scanner.Err()
	})
}
