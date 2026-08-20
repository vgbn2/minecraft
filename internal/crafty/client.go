package crafty

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/vgbn2/minecraft/internal/model"
)

const ContractVersion = "2.0.1"

type Server struct {
	ID               string `json:"server_id"`
	Name             string `json:"server_name"`
	Path             string `json:"path"`
	BackupPath       string `json:"backup_path"`
	Executable       string `json:"executable"`
	ExecutionCommand string `json:"execution_command"`
	AutoStart        bool   `json:"auto_start"`
	Port             int    `json:"server_port"`
	Type             string `json:"type"`
}

type Stats struct {
	Running      bool    `json:"running"`
	CPU          float64 `json:"cpu"`
	Memory       string  `json:"mem"`
	MemoryPct    any     `json:"mem_percent"`
	Online       int     `json:"online"`
	Maximum      int     `json:"max"`
	Version      string  `json:"version"`
	Crashed      bool    `json:"crashed"`
	WaitingStart bool    `json:"waiting_start"`
}

type Client struct {
	baseURL   string
	tokenFile string
	http      *http.Client
}

type API interface {
	ListServers(context.Context) ([]Server, error)
	ServerStats(context.Context, string) (Stats, error)
}

type HTTPError struct {
	StatusCode int
}

func (value HTTPError) Error() string {
	return fmt.Sprintf("Crafty returned HTTP %d", value.StatusCode)
}

func New(cfg model.CraftyConfig) (*Client, error) {
	parsed, err := url.Parse(cfg.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse Crafty base URL: %w", err)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.AllowInsecureLocal {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // loopback-only validation is enforced by config validation.
	}
	return &Client{baseURL: strings.TrimRight(parsed.String(), "/"), tokenFile: cfg.TokenFile, http: &http.Client{Transport: transport, Timeout: time.Duration(cfg.RequestTimeoutSecs) * time.Second}}, nil
}

func (client *Client) ListServers(ctx context.Context) ([]Server, error) {
	var response struct {
		Status string   `json:"status"`
		Data   []Server `json:"data"`
	}
	if err := client.request(ctx, http.MethodGet, "/api/v2/servers", nil, &response); err != nil {
		return nil, err
	}
	return response.Data, nil
}

func (client *Client) ServerStats(ctx context.Context, id string) (Stats, error) {
	var response struct {
		Status string `json:"status"`
		Data   Stats  `json:"data"`
	}
	if err := client.request(ctx, http.MethodGet, "/api/v2/servers/"+url.PathEscape(id)+"/stats", nil, &response); err != nil {
		return Stats{}, err
	}
	return response.Data, nil
}

func (client *Client) Action(ctx context.Context, id, action string) error {
	allowed := map[string]bool{"start_server": true, "stop_server": true, "restart_server": true, "backup_server": true}
	if !allowed[action] {
		return fmt.Errorf("Crafty action %q is not allowed by mcctl", action)
	}
	return client.request(ctx, http.MethodPost, "/api/v2/servers/"+url.PathEscape(id)+"/action/"+action, nil, nil)
}

func (client *Client) request(ctx context.Context, method, path string, body io.Reader, output any) error {
	token, err := os.ReadFile(client.tokenFile)
	if err != nil {
		return fmt.Errorf("read Crafty token: %w", err)
	}
	if len(strings.TrimSpace(string(token))) == 0 {
		return errors.New("Crafty token file is empty")
	}
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, body)
	if err != nil {
		return fmt.Errorf("build Crafty request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	request.Header.Set("Accept", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return fmt.Errorf("Crafty request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return HTTPError{StatusCode: response.StatusCode}
	}
	if output == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(output); err != nil {
		return fmt.Errorf("decode Crafty response: %w", err)
	}
	return nil
}
