package main

import (
  "encoding/json"
  "errors"
  "fmt"
  "os"
  "path/filepath"
  "strings"
  "sync"
  "time"

  "cpa-control-center/internal/backend"
)

type managedConnection struct {
  ID string `json:"id"`
  Name string `json:"name"`
}

type connectionsConfig struct {
  ActiveConnectionID string `json:"activeConnectionId"`
  Connections []managedConnection `json:"connections"`
}

type connectionSummary struct {
  ID string `json:"id"`
  Name string `json:"name"`
  BaseURL string `json:"baseUrl"`
  Active bool `json:"active"`
}

type connectionsResponse struct {
  ActiveConnectionID string `json:"activeConnectionId"`
  Connections []connectionSummary `json:"connections"`
}

type serverEnvelope struct {
  ConnectionID string `json:"connectionId"`
  Data any `json:"data"`
}

type connectionManager struct {
  rootDir string
  configPath string
  emitter *serverEmitter

  mu sync.Mutex
  config connectionsConfig
  currentConnectionID string
  currentBackend *backend.Backend
}

func newConnectionManager(rootDir string, emitter *serverEmitter) (*connectionManager, error) {
  manager := &connectionManager{
    rootDir: rootDir,
    configPath: filepath.Join(rootDir, "connections.json"),
    emitter: emitter,
  }
  if err := manager.load(); err != nil {
    return nil, err
  }
  return manager, nil
}

func (m *connectionManager) Close() error {
  m.mu.Lock()
  defer m.mu.Unlock()
  if m.currentBackend != nil {
    err := m.currentBackend.Close()
    m.currentBackend = nil
    m.currentConnectionID = ""
    return err
  }
  return nil
}

func (m *connectionManager) load() error {
  if err := os.MkdirAll(filepath.Join(m.rootDir, "connections"), 0o755); err != nil {
    return err
  }
  if _, err := os.Stat(m.configPath); errors.Is(err, os.ErrNotExist) {
    if err := m.bootstrapConfig(); err != nil {
      return err
    }
  }

  data, err := os.ReadFile(m.configPath)
  if err != nil {
    return err
  }
  var config connectionsConfig
  if err := json.Unmarshal(data, &config); err != nil {
    return err
  }
  if len(config.Connections) == 0 {
    config.Connections = []managedConnection{{ID: "default", Name: "Default"}}
    config.ActiveConnectionID = "default"
    if err := m.saveConfig(config); err != nil {
      return err
    }
  }
  if config.ActiveConnectionID == "" {
    config.ActiveConnectionID = config.Connections[0].ID
    if err := m.saveConfig(config); err != nil {
      return err
    }
  }
  m.config = config
  return nil
}

func (m *connectionManager) bootstrapConfig() error {
  config := connectionsConfig{
    ActiveConnectionID: "default",
    Connections: []managedConnection{{ID: "default", Name: "Default"}},
  }
  targetDir := m.connectionDataDir("default")
  if err := os.MkdirAll(targetDir, 0o755); err != nil {
    return err
  }
  legacyFiles := []struct{from,to string}{
    {from: filepath.Join(m.rootDir, "settings.json"), to: filepath.Join(targetDir, "settings.json")},
    {from: filepath.Join(m.rootDir, "state.db"), to: filepath.Join(targetDir, "state.db")},
    {from: filepath.Join(m.rootDir, "app.log"), to: filepath.Join(targetDir, "app.log")},
  }
  for _, item := range legacyFiles {
    if _, err := os.Stat(item.from); err == nil {
      if _, err := os.Stat(item.to); errors.Is(err, os.ErrNotExist) {
        _ = os.Rename(item.from, item.to)
      }
    }
  }
  return m.saveConfig(config)
}

func (m *connectionManager) saveConfig(config connectionsConfig) error {
  data, err := json.MarshalIndent(config, "", "  ")
  if err != nil {
    return err
  }
  if err := os.WriteFile(m.configPath, data, 0o644); err != nil {
    return err
  }
  m.config = config
  return nil
}

func (m *connectionManager) connectionDataDir(id string) string {
  return filepath.Join(m.rootDir, "connections", id)
}

type connectionScopedEmitter struct {
  connectionID string
  emitter *serverEmitter
}

func (e connectionScopedEmitter) Emit(event string, payload any) {
  if e.emitter == nil {
    return
  }
  e.emitter.Emit(event, serverEnvelope{ConnectionID: e.connectionID, Data: payload})
}

func (m *connectionManager) currentBackendOrOpen() (*backend.Backend, error) {
  m.mu.Lock()
  defer m.mu.Unlock()

  activeID := m.config.ActiveConnectionID
  if activeID == "" && len(m.config.Connections) > 0 {
    activeID = m.config.Connections[0].ID
    m.config.ActiveConnectionID = activeID
  }
  if activeID == "" {
    return nil, errors.New("no active connection")
  }
  if m.currentBackend != nil && m.currentConnectionID == activeID {
    return m.currentBackend, nil
  }
  if m.currentBackend != nil {
    _ = m.currentBackend.Close()
    m.currentBackend = nil
    m.currentConnectionID = ""
  }
  dataDir := m.connectionDataDir(activeID)
  if err := os.MkdirAll(dataDir, 0o755); err != nil {
    return nil, err
  }
  service, err := backend.New(dataDir, connectionScopedEmitter{connectionID: activeID, emitter: m.emitter})
  if err != nil {
    return nil, err
  }
  m.currentBackend = service
  m.currentConnectionID = activeID
  return service, nil
}

func (m *connectionManager) listConnections() (connectionsResponse, error) {
  m.mu.Lock()
  config := m.config
  m.mu.Unlock()

  response := connectionsResponse{
    ActiveConnectionID: config.ActiveConnectionID,
    Connections: make([]connectionSummary, 0, len(config.Connections)),
  }
  for _, item := range config.Connections {
    summary := connectionSummary{
      ID: item.ID,
      Name: item.Name,
      Active: item.ID == config.ActiveConnectionID,
    }
    store, err := backend.NewStore(m.connectionDataDir(item.ID))
    if err == nil {
      settings, loadErr := store.LoadSettings()
      _ = store.Close()
      if loadErr == nil {
        summary.BaseURL = settings.BaseURL
        if strings.TrimSpace(summary.Name) == "" {
          summary.Name = settings.BaseURL
        }
      }
    }
    if strings.TrimSpace(summary.Name) == "" {
      summary.Name = item.ID
    }
    response.Connections = append(response.Connections, summary)
  }
  return response, nil
}

func (m *connectionManager) setActiveConnection(id string) (connectionsResponse, error) {
  m.mu.Lock()
  found := false
  for _, item := range m.config.Connections {
    if item.ID == id {
      found = true
      break
    }
  }
  if !found {
    m.mu.Unlock()
    return connectionsResponse{}, errors.New("connection not found")
  }
  config := m.config
  config.ActiveConnectionID = id
  m.mu.Unlock()

  if err := m.saveConfig(config); err != nil {
    return connectionsResponse{}, err
  }

  m.mu.Lock()
  if m.currentBackend != nil {
    _ = m.currentBackend.Close()
    m.currentBackend = nil
    m.currentConnectionID = ""
  }
  m.mu.Unlock()

  return m.listConnections()
}

func (m *connectionManager) renameConnection(id string, name string) (connectionsResponse, error) {
  displayName := strings.TrimSpace(name)
  if displayName == "" {
    return connectionsResponse{}, errors.New("connection name required")
  }

  m.mu.Lock()
  config := m.config
  found := false
  for index, item := range config.Connections {
    if item.ID == id {
      config.Connections[index].Name = displayName
      found = true
      break
    }
  }
  m.mu.Unlock()
  if !found {
    return connectionsResponse{}, errors.New("connection not found")
  }
  if err := m.saveConfig(config); err != nil {
    return connectionsResponse{}, err
  }
  return m.listConnections()
}

func (m *connectionManager) deleteConnection(id string) (connectionsResponse, error) {
  m.mu.Lock()
  config := m.config
  if len(config.Connections) <= 1 {
    m.mu.Unlock()
    return connectionsResponse{}, errors.New("cannot delete the last connection")
  }

  nextConnections := make([]managedConnection, 0, len(config.Connections)-1)
  found := false
  for _, item := range config.Connections {
    if item.ID == id {
      found = true
      continue
    }
    nextConnections = append(nextConnections, item)
  }
  if !found {
    m.mu.Unlock()
    return connectionsResponse{}, errors.New("connection not found")
  }
  config.Connections = nextConnections
  if config.ActiveConnectionID == id {
    config.ActiveConnectionID = nextConnections[0].ID
  }
  m.mu.Unlock()

  if err := m.saveConfig(config); err != nil {
    return connectionsResponse{}, err
  }

  m.mu.Lock()
  if m.currentConnectionID == id && m.currentBackend != nil {
    _ = m.currentBackend.Close()
    m.currentBackend = nil
    m.currentConnectionID = ""
  }
  m.mu.Unlock()

  _ = os.RemoveAll(m.connectionDataDir(id))
  return m.listConnections()
}

func (m *connectionManager) createConnection(name string, settings backend.AppSettings) (connectionsResponse, backend.ConnectionResult, error) {
  id := fmt.Sprintf("conn-%x", time.Now().UnixNano())
  displayName := strings.TrimSpace(name)
  if displayName == "" {
    displayName = strings.TrimSpace(settings.BaseURL)
  }
  if displayName == "" {
    displayName = id
  }

  dataDir := m.connectionDataDir(id)
  if err := os.MkdirAll(dataDir, 0o755); err != nil {
    return connectionsResponse{}, backend.ConnectionResult{}, err
  }
  service, err := backend.New(dataDir, connectionScopedEmitter{connectionID: id, emitter: m.emitter})
  if err != nil {
    return connectionsResponse{}, backend.ConnectionResult{}, err
  }
  defer service.Close()

  result, err := service.TestAndSaveSettings(settings)
  if err != nil {
    return connectionsResponse{}, result, err
  }

  m.mu.Lock()
  config := m.config
  config.Connections = append(config.Connections, managedConnection{ID: id, Name: displayName})
  config.ActiveConnectionID = id
  m.mu.Unlock()

  if err := m.saveConfig(config); err != nil {
    return connectionsResponse{}, backend.ConnectionResult{}, err
  }

  m.mu.Lock()
  if m.currentBackend != nil {
    _ = m.currentBackend.Close()
    m.currentBackend = nil
    m.currentConnectionID = ""
  }
  m.mu.Unlock()

  response, err := m.listConnections()
  return response, result, err
}
