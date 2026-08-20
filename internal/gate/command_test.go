package gate

import (
	"crypto/sha256"
	"fmt"
	"github.com/vgbn2/minecraft/internal/model"
	"os"
	"path/filepath"
	"testing"
)

func TestCheckCommandPinsHeapRootAndHash(t *testing.T) {
	root := t.TempDir()
	jar := filepath.Join(root, "server.jar")
	raw := []byte("jar")
	if err := os.WriteFile(jar, raw, 0o640); err != nil {
		t.Fatal(err)
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(raw))
	profile := model.Profile{ServerRoot: root, Artifact: model.Artifact{SHA256: digest}, Resources: model.Resources{HeapInitialMB: 1024, HeapMaxMB: 2560}}
	args := []string{"java", "-Xms1024M", "-Xmx2560M", "-jar", jar, "nogui"}
	if err := CheckCommand(profile, args); err != nil {
		t.Fatal(err)
	}
	args[2] = "-Xmx4096M"
	if err := CheckCommand(profile, args); err == nil {
		t.Fatal("unapproved heap passed")
	}
}

func TestCheckRuntimePinsOnlineModeAndBundles(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "plugins"), 0o750); err != nil {
		t.Fatal(err)
	}
	jar := filepath.Join(root, "server.jar")
	plugin := filepath.Join(root, "plugins", "AuthMe.jar")
	serverRaw := []byte("server")
	pluginRaw := []byte("plugin")
	if err := os.WriteFile(jar, serverRaw, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(plugin, pluginRaw, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "server.properties"), []byte("online-mode=false\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	profile := model.Profile{ServerRoot: root, Artifact: model.Artifact{SHA256: fmt.Sprintf("%x", sha256.Sum256(serverRaw))}, Resources: model.Resources{HeapInitialMB: 2048, HeapMaxMB: 4096}, Security: model.Security{OnlineMode: false}, Plugins: []model.BundleArtifact{{ID: "authme", DownloadURL: "https://example.com/AuthMe.jar", SHA256: fmt.Sprintf("%x", sha256.Sum256(pluginRaw))}}}
	args := []string{"java", "-Xms2048M", "-Xmx4096M", "-jar", jar, "nogui"}
	if err := CheckRuntime(profile, args); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "server.properties"), []byte("online-mode=true\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := CheckRuntime(profile, args); err == nil {
		t.Fatal("online-mode drift passed")
	}
}
