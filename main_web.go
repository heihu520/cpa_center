package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"cpa-control-center/internal/backend"
)

//go:embed frontend/dist frontend/dist/**
var webAssets embed.FS

type serverEmitter struct {
	mu      sync.RWMutex
	clients map[chan serverEvent]struct{}
}

type serverEvent struct {
	Event string `json:"event"`
	Data  any    `json:"data"`
}

type appServer struct {
	manager *connectionManager
	emitter *serverEmitter
}

type apiError struct {
	Error string `json:"error"`
}

func newServerEmitter() *serverEmitter {
	return &serverEmitter{clients: make(map[chan serverEvent]struct{})}
}

func (e *serverEmitter) Emit(event string, payload any) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for ch := range e.clients {
		select {
		case ch <- serverEvent{Event: event, Data: payload}:
		default:
		}
	}
}

func (e *serverEmitter) subscribe() (chan serverEvent, func()) {
	ch := make(chan serverEvent, 128)
	e.mu.Lock()
	e.clients[ch] = struct{}{}
	e.mu.Unlock()
	return ch, func() {
		e.mu.Lock()
		if _, ok := e.clients[ch]; ok {
			delete(e.clients, ch)
			close(ch)
		}
		e.mu.Unlock()
	}
}

func main() {
	dataDir, err := backend.DefaultDataDir()
	if err != nil {
		log.Fatalf("resolve data dir: %v", err)
	}

	emitter := newServerEmitter()
	manager, err := newConnectionManager(dataDir, emitter)
	if err != nil {
		log.Fatalf("init connection manager: %v", err)
	}
	defer manager.Close()

	server := &appServer{manager: manager, emitter: emitter}
	addr := webListenAddr()
	log.Printf("CPA Control Center Web listening on http://%s", addr)
	log.Fatal(http.ListenAndServe(addr, server.routes()))
}

func webListenAddr() string {
	if value := strings.TrimSpace(os.Getenv("CPA_WEB_ADDR")); value != "" {
		return value
	}
	if port := strings.TrimSpace(os.Getenv("PORT")); port != "" {
		return "0.0.0.0:" + port
	}
	return "0.0.0.0:8080"
}

func (s *appServer) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/connections", s.handleConnections)
	mux.HandleFunc("/api/connections/active", s.handleActiveConnection)
	mux.HandleFunc("/api/connections/rename", s.handleRenameConnection)
	mux.HandleFunc("/api/connections/delete", s.handleDeleteConnection)
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/api/settings/test", s.handleTestConnection)
	mux.HandleFunc("/api/settings/test-and-save", s.handleTestAndSaveSettings)
	mux.HandleFunc("/api/scheduler/status", s.handleSchedulerStatus)
	mux.HandleFunc("/api/dashboard", s.handleDashboard)
	mux.HandleFunc("/api/quotas", s.handleQuotaSnapshot)
	mux.HandleFunc("/api/accounts", s.handleAccounts)
	mux.HandleFunc("/api/accounts/probe-one", s.handleProbeAccount)
	mux.HandleFunc("/api/accounts/probe-many", s.handleProbeAccounts)
	mux.HandleFunc("/api/accounts/disable-one", s.handleSetAccountDisabled)
	mux.HandleFunc("/api/accounts/disable-many", s.handleSetAccountsDisabled)
	mux.HandleFunc("/api/accounts/delete-one", s.handleDeleteAccount)
	mux.HandleFunc("/api/accounts/delete-many", s.handleDeleteAccounts)
	mux.HandleFunc("/api/accounts/export", s.handleExportAccounts)
	mux.HandleFunc("/api/inventory/sync", s.handleSyncInventory)
	mux.HandleFunc("/api/scan/run", s.handleRunScan)
	mux.HandleFunc("/api/scan/cancel", s.handleCancelScan)
	mux.HandleFunc("/api/maintain/run", s.handleRunMaintain)
	mux.HandleFunc("/api/scan/details", s.handleScanDetails)
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.Handle("/", s.frontendHandler())
	return mux
}

func (s *appServer) frontendHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		requestPath := "/frontend/dist/index.html"
		if r.URL.Path != "/" {
			candidate := path.Clean("/frontend/dist" + r.URL.Path)
			if candidate != "/frontend/dist" {
				if _, err := webAssets.Open(strings.TrimPrefix(candidate, "/")); err == nil {
					requestPath = candidate
				}
			}
		}

		content, err := webAssets.ReadFile(strings.TrimPrefix(requestPath, "/"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if contentType := mime.TypeByExtension(path.Ext(requestPath)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		} else if strings.HasSuffix(requestPath, ".html") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		}
		_, _ = w.Write(content)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *appServer) activeBackend() (*backend.Backend, error) {
	return s.manager.currentBackendOrOpen()
}

func (s *appServer) handleConnections(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		result, err := s.manager.listConnections()
		writeJSONResult(w, result, err)
	case http.MethodPost:
		var input struct {
			Name string `json:"name"`
			Settings backend.AppSettings `json:"settings"`
		}
		if !decodeJSONBody(w, r, &input) {
			return
		}
		result, connectionResult, err := s.manager.createConnection(input.Name, input.Settings)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": err.Error(),
				"connectionResult": connectionResult,
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"connections": result,
			"connectionResult": connectionResult,
		})
	default:
		methodNotAllowed(w)
	}
}

func (s *appServer) handleActiveConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		ConnectionID string `json:"connectionId"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	result, err := s.manager.setActiveConnection(input.ConnectionID)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleRenameConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		ConnectionID string `json:"connectionId"`
		Name string `json:"name"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	result, err := s.manager.renameConnection(input.ConnectionID, input.Name)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleDeleteConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		ConnectionID string `json:"connectionId"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	result, err := s.manager.deleteConnection(input.ConnectionID)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		backendService, err := s.activeBackend()
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		result, err := backendService.GetSettings()
		if err != nil {
			writeJSONResult(w, result, err)
			return
		}
		writeJSON(w, http.StatusOK, sanitizeSettings(result))
	case http.MethodPost:
		var input backend.AppSettings
		if !decodeJSONBody(w, r, &input) {
			return
		}
		input, err := s.mergeStoredSecretSettings(input)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		backendService, err := s.activeBackend()
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		result, err := backendService.SaveSettings(input)
		if err != nil {
			writeJSONResult(w, result, err)
			return
		}
		writeJSON(w, http.StatusOK, sanitizeSettings(result))
	default:
		methodNotAllowed(w)
	}
}

func (s *appServer) handleTestConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input backend.AppSettings
	if !decodeJSONBody(w, r, &input) {
		return
	}
	input, err := s.mergeStoredSecretSettings(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.TestConnection(input)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleTestAndSaveSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input backend.AppSettings
	if !decodeJSONBody(w, r, &input) {
		return
	}
	input, err := s.mergeStoredSecretSettings(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.TestAndSaveSettings(input)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleSchedulerStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, backendService.GetSchedulerStatus())
}

func (s *appServer) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.GetDashboardSnapshot()
	writeJSONResult(w, result, err)
}

func (s *appServer) handleQuotaSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.GetCodexQuotaSnapshot()
	writeJSONResult(w, result, err)
}

func (s *appServer) handleAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	filter := backend.AccountFilter{
		Query:    r.URL.Query().Get("query"),
		State:    r.URL.Query().Get("state"),
		Provider: r.URL.Query().Get("provider"),
		Type:     r.URL.Query().Get("type"),
		PlanType: r.URL.Query().Get("planType"),
	}
	if disabled := strings.TrimSpace(r.URL.Query().Get("disabled")); disabled != "" {
		parsed := disabled == "true"
		filter.Disabled = &parsed
	}
	page := parseIntDefault(r.URL.Query().Get("page"), 1)
	pageSize := parseIntDefault(r.URL.Query().Get("pageSize"), 20)
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.ListAccountsPage(filter, page, pageSize)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleProbeAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.ProbeAccount(input.Name)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleProbeAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		Names []string `json:"names"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.ProbeAccounts(input.Names)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleSetAccountDisabled(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		Name     string `json:"name"`
		Disabled bool   `json:"disabled"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.SetAccountDisabled(input.Name, input.Disabled)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleSetAccountsDisabled(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		Names    []string `json:"names"`
		Disabled bool     `json:"disabled"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.SetAccountsDisabled(input.Names, input.Disabled)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.DeleteAccount(input.Name)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleDeleteAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input struct {
		Names []string `json:"names"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.DeleteAccounts(input.Names)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleExportAccounts(w http.ResponseWriter, r *http.Request) {
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	if r.Method == http.MethodGet {
		kind := r.URL.Query().Get("kind")
		format := r.URL.Query().Get("format")
		result, err := backendService.ExportAccounts(kind, format, "")
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		content, err := os.ReadFile(result.Path)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		filename := path.Base(result.Path)
		if contentType := mime.TypeByExtension(path.Ext(filename)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		} else {
			w.Header().Set("Content-Type", "application/octet-stream")
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		_, _ = w.Write(content)
		return
	}

	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input backend.ExportRequest
	if !decodeJSONBody(w, r, &input) {
		return
	}
	result, err := backendService.ExportAccounts(input.Kind, input.Format, input.Path)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleSyncInventory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.SyncInventory()
	writeJSONResult(w, result, err)
}

func (s *appServer) handleRunScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.RunScan()
	writeJSONResult(w, result, err)
}

func (s *appServer) handleCancelScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.CancelScan()
	writeJSONResult(w, result, err)
}

func (s *appServer) handleRunMaintain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var input backend.MaintainOptions
	if !decodeJSONBody(w, r, &input) {
		return
	}
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.RunMaintain(input)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleScanDetails(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	runID, err := strconv.ParseInt(r.URL.Query().Get("runId"), 10, 64)
	if err != nil || runID <= 0 {
		writeError(w, http.StatusBadRequest, errors.New("invalid runId"))
		return
	}
	page := parseIntDefault(r.URL.Query().Get("page"), 1)
	pageSize := parseIntDefault(r.URL.Query().Get("pageSize"), 20)
	backendService, err := s.activeBackend()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := backendService.GetScanDetailsPage(runID, page, pageSize)
	writeJSONResult(w, result, err)
}

func (s *appServer) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming unsupported"))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, unsubscribe := s.emitter.subscribe()
	defer unsubscribe()

	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	keepAlive := time.NewTicker(20 * time.Second)
	defer keepAlive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepAlive.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case event, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(event.Data)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\n", event.Event)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func writeJSONResult[T any](w http.ResponseWriter, result T, err error) {
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, apiError{Error: err.Error()})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dest any) bool {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return false
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("request body required"))
		return false
	}
	if err := json.Unmarshal(body, dest); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return false
	}
	return true
}

func parseIntDefault(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func methodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
}

func sanitizeSettings(settings backend.AppSettings) map[string]any {
	payload := map[string]any{
		"baseUrl": settings.BaseURL,
		"managementToken": "",
		"hasSavedManagementToken": strings.TrimSpace(settings.ManagementToken) != "",
		"locale": settings.Locale,
		"layoutMode": settings.LayoutMode,
		"detailedLogs": settings.DetailedLogs,
		"targetType": settings.TargetType,
		"provider": settings.Provider,
		"scanStrategy": settings.ScanStrategy,
		"scanBatchSize": settings.ScanBatchSize,
		"skipKnown401": settings.SkipKnown401,
		"probeWorkers": settings.ProbeWorkers,
		"actionWorkers": settings.ActionWorkers,
		"quotaWorkers": settings.QuotaWorkers,
		"timeoutSeconds": settings.TimeoutSeconds,
		"retries": settings.Retries,
		"userAgent": settings.UserAgent,
		"quotaAction": settings.QuotaAction,
		"quotaCheckFree": settings.QuotaCheckFree,
		"quotaCheckPlus": settings.QuotaCheckPlus,
		"quotaCheckPro": settings.QuotaCheckPro,
		"quotaCheckTeam": settings.QuotaCheckTeam,
		"quotaCheckBusiness": settings.QuotaCheckBusiness,
		"quotaCheckEnterprise": settings.QuotaCheckEnterprise,
		"quotaFreeMaxAccounts": settings.QuotaFreeMaxAccounts,
		"quotaAutoRefreshEnabled": settings.QuotaAutoRefreshEnabled,
		"quotaAutoRefreshCron": settings.QuotaAutoRefreshCron,
		"delete401": settings.Delete401,
		"autoReenable": settings.AutoReenable,
		"exportDirectory": settings.ExportDirectory,
		"schedule": settings.Schedule,
	}
	return payload
}

func (s *appServer) mergeStoredSecretSettings(input backend.AppSettings) (backend.AppSettings, error) {
	if strings.TrimSpace(input.ManagementToken) != "" {
		return input, nil
	}
	backendService, err := s.activeBackend()
	if err != nil {
		return input, err
	}
	saved, err := backendService.GetSettings()
	if err != nil {
		return input, err
	}
	if strings.TrimSpace(saved.ManagementToken) != "" {
		input.ManagementToken = saved.ManagementToken
	}
	return input, nil
}

func unescapePathValue(value string) (string, error) {
	replacer := strings.NewReplacer("+", "%2B")
	return url.PathUnescape(replacer.Replace(value))
}
