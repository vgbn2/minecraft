package crafty

import (
	"context"
	"fmt"
	"github.com/vgbn2/minecraft/internal/model"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestClientUsesPinnedV2PathsAndBearerToken(t *testing.T) {
	token := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(token, []byte("secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("missing bearer token")
		}
		switch r.URL.Path {
		case "/api/v2/servers":
			fmt.Fprint(w, `{"status":"ok","data":[{"server_id":"one","server_name":"Paper"}]}`)
		case "/api/v2/servers/one/action/start_server":
			fmt.Fprint(w, `{"status":"ok"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := New(model.CraftyConfig{BaseURL: server.URL, TokenFile: token, AllowInsecureLocal: true, RequestTimeoutSecs: 2})
	if err != nil {
		t.Fatal(err)
	}
	servers, err := client.ListServers(context.Background())
	if err != nil || len(servers) != 1 {
		t.Fatalf("list failed: %+v %v", servers, err)
	}
	if err := client.Action(context.Background(), "one", "start_server"); err != nil {
		t.Fatal(err)
	}
	if err := client.Action(context.Background(), "one", "kill_server"); err == nil {
		t.Fatal("kill action passed")
	}
}
