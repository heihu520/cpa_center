# CPA Control Center

[English](./README.md) | [简体中文](./README.zh-CN.md)

A **Web control panel** for operating CPA / Codex auth pools, designed for server deployment, Docker runtime, and multi-connection management.

## Project Origin

This repository was not written from scratch. It is a secondary development branch derived from the following upstream repository:

- Upstream repository: [`Biliniko/cpa-control-center`](https://github.com/Biliniko/cpa-control-center)

This repository extends the upstream project with the following key adaptations:

- Expands the original desktop-focused usage model into a **Web version**
- Adds **Docker / Docker Compose** deployment support
- Adds **multi-connection / multi-URL / multi-pool switching**
- Replaces part of the Wails runtime integration with browser-side Web Runtime adaptations
- Fixes responsive layout, export UX, quota counting consistency, and event-flow freezing issues

## Positioning

This project is a good fit if you:

- already have CPA management endpoints available
- operate Codex-focused auth pools
- want to run scanning, maintenance, logs, and quota inspection in a browser
- want one console to manage multiple URLs or pools

This project is not currently focused on:

- OAuth login acquisition
- GUI auth import workflows
- multi-user permission systems
- hardened public-facing access control

## Core Capabilities

- Web console for server-side runtime
- multi-connection switching
- inventory sync
- full and incremental scanning
- maintenance actions (delete 401, disable/delete quota-limited accounts, re-enable recovered accounts)
- Codex quota workspace
- live task logs and progress streaming
- scan history and paged details
- CSV / JSON export
- bilingual UI
- Docker deployment support

## Tech Stack

### Backend

- Go
- `net/http`
- SQLite
- SSE event streaming

### Frontend

- Vue 3
- TypeScript
- Pinia
- Element Plus
- Vite

### Runtime Modes

- The desktop entrypoint is still retained (Wails)
- The recommended runtime mode for this repository is now **Web / Docker deployment**

## Architecture Overview

- Web entrypoint: [main_web.go](main_web.go)
- Multi-connection manager: [root_connections.go](root_connections.go)
- Core business layer: [internal/backend/](internal/backend/)
- Frontend API layer: [frontend/src/lib/web-api.ts](frontend/src/lib/web-api.ts)
- Frontend event bridge: [frontend/src/lib/web-runtime.ts](frontend/src/lib/web-runtime.ts)
- Settings state: [frontend/src/stores/settings.ts](frontend/src/stores/settings.ts)
- Task state: [frontend/src/stores/tasks.ts](frontend/src/stores/tasks.ts)

For a more detailed architecture review, see:

- [ARCHITECTURE.zh-CN.md](./ARCHITECTURE.zh-CN.md)

## Quick Start

### Option 1: Run the Web Version Locally

Install frontend dependencies and build assets first:

```bash
cd frontend
npm install
npm run build
```

Then return to the project root and start the web server:

```bash
cd ..
go run -tags web .
```

Default address:

```text
http://localhost:8080
```

To customize the port:

```bash
CPA_WEB_ADDR=0.0.0.0:12350 go run -tags web .
```

Or:

```bash
PORT=12350 go run -tags web .
```

### Option 2: Deploy with Docker

The repository already includes:

- [Dockerfile](Dockerfile)
- [docker-compose.yml](docker-compose.yml)
- [.dockerignore](.dockerignore)

Run:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:12350
```

Persistent data is stored by default in:

```text
./docker-data
```

For the full deployment guide, see:

- [DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md)

## First-Time Usage Flow

1. Open the settings page
2. Fill in `Base URL` and `Management Token`
3. Click **Test & Save**
4. Wait for inventory sync to complete
5. Review the dashboard and accounts list
6. Run a scan
7. Decide whether to run maintenance based on the scan result

If you need multiple pools:

1. Add a new connection from the settings page
2. Save a different URL / token pair for each connection
3. Switch between them from the connection selector

## State Model

The system currently uses the following unified states:

- `Pending`
- `Normal`
- `401 Invalid`
- `Quota Limited`
- `Recovered`
- `Error`

Notes:

- `Pending` means the account has been synced locally but not yet probed
- `Quota Limited` is now aligned with quota bucket results rather than relying on a single upstream flag only

## Data and Directory Layout

The Web version resolves its data directory from:

- `CPA_DATA_DIR` first
- otherwise the system config directory

In multi-connection mode, each connection gets its own isolated data directory. A typical layout looks like this:

```text
connections.json
connections/
  default/
    settings.json
    state.db
    app.log
  conn-xxxx/
    settings.json
    state.db
    app.log
```

## Important Notes

### 1. The current Web version does not have built-in login/authentication

If you deploy this to a public environment, you should at least protect it with:

- Basic Auth
- Cloudflare Access
- internal network access control
- your own login gateway

Otherwise, anyone who can reach the page can trigger scans, disable accounts, or delete accounts.

### 2. Multi-connection is currently a switch-based model

The current implementation uses a single active connection model. It works well for:

- switching between multiple pools for viewing and operating them

But it is not yet a true multi-pool parallel-task architecture.

### 3. Docker is the recommended deployment mode

For server usage, the recommended stack is:

- Docker Compose
- reverse proxy
- internal-only access or protected access

## Documentation Entry Points

- Architecture notes: [ARCHITECTURE.zh-CN.md](./ARCHITECTURE.zh-CN.md)
- Deployment guide: [DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md)

## Acknowledgements

- Workflow ideas were inspired by [`fantasticjoe/cpa-warden`](https://github.com/fantasticjoe/cpa-warden)
- The project is primarily intended for CPA backends exposing management endpoints, such as [`router-for-me/CLIProxyAPI`](https://github.com/router-for-me/CLIProxyAPI)
