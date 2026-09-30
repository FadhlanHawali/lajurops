# Open Planner

A self-hosted planner in the spirit of Jira/Trello, built for teams that mix
**scheduled, hour-level work** (support, deployments, implementations) with
**date-level work** (requests, deliverables).

- **Board**: Kanban (To Do → In Progress → In Review → Done) with drag & drop
- **Timeline (Gantt)**: zoom from **month → week → day → 6 hours → hour**; drag to reschedule, drag edges to resize, Ctrl+scroll to zoom
- **Calendar**: month/week/day/agenda views; drag, resize, or select a slot to create
- **Tasks with subtasks** (one level, like Jira), keys like `OPS-12`
- **Two task types**
  - `hourly`: exact start/end timestamps, snapped to 15 min on the hour zoom
  - `daily`: whole days (start date → due date)
- **Workload report**: per user, per week or month: hourly support hours, hourly/daily task counts, completion; drill down and export CSV
- **Keycloak** login (OIDC + PKCE); users are provisioned on first login

It ships as a **single binary**: the React frontend is compiled by Vite and embedded
into the Go server with `go:embed`, the same approach [Radar](https://github.com/skyhook-io/radar) uses.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Go 1.22, chi, pgx v5, go-oidc |
| Database | PostgreSQL 16 (migrations embedded, applied on startup) |
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS v4, TanStack Query, FullCalendar, custom Gantt |
| Auth     | Keycloak (public client, Authorization Code + PKCE) |

```
cmd/open-planner/     main: config, DB, HTTP server
internal/api/         REST handlers (/api/...)
internal/auth/        Keycloak JWT verification middleware
internal/store/       SQL queries (projects, tasks, users, reports)
internal/db/          pool + embedded SQL migrations
web/                  React app; web/dist is embedded into the binary
deploy/keycloak/      realm import (client + demo users)
```

## Quick start (Docker Compose)

```bash
cp .env.example .env   # optional
docker compose up -d --build
```

| Service  | URL |
|----------|-----|
| App      | http://localhost:8080 |
| Keycloak | http://localhost:8081 (admin console: `admin` / `KEYCLOAK_ADMIN_PASSWORD`) |

The `open-planner` realm is imported with two demo users, **alice** and **bob**. Their
passwords are in [deploy/keycloak/realm-open-planner.json](deploy/keycloak/realm-open-planner.json).
Change or remove them before exposing the stack.

## Local development

Requires Go 1.22+, Node 20+ and a PostgreSQL.

```bash
# terminal 1: API on :8080 without Keycloak (every request is the "dev" user)
export DATABASE_URL=postgres://planner:planner@localhost:5432/planner?sslmode=disable
make dev-backend

# terminal 2: Vite on :5173 with hot reload, proxying /api to :8080
make dev-web
```

Build the single binary:

```bash
make build        # web/dist + bin/open-planner
./bin/open-planner
```

## Configuration

| Variable         | Default | Description |
|------------------|---------|-------------|
| `ADDR`           | `:8080` | Listen address |
| `DATABASE_URL`   | `postgres://planner:planner@localhost:5432/planner?sslmode=disable` | PostgreSQL DSN |
| `OIDC_ISSUER`    | (required) | Realm URL **as the browser sees it**, e.g. `https://sso.example.com/realms/open-planner` |
| `OIDC_JWKS_URL`  | `<issuer>/protocol/openid-connect/certs` | Where the server fetches signing keys; set it when the backend reaches Keycloak on an internal hostname |
| `OIDC_CLIENT_ID` | `open-planner` | Public client used by the SPA; tokens must have `azp` = this |
| `AUTH_DISABLED`  | `false` | Local development only: skip Keycloak entirely |

The frontend gets its Keycloak settings at runtime from `GET /api/config`, so
one build works in every environment.

### Using an existing Keycloak

1. Create a client `open-planner`: *Client authentication* off (public), *Standard flow* on.
2. Valid redirect URIs: `https://planner.example.com/*`; Web origins: `+`.
3. Advanced → *Proof Key for Code Exchange*: `S256`.
4. Run the app with `OIDC_ISSUER=https://<keycloak>/realms/<realm>`.

### Production notes

- Run Keycloak with `start` (not `start-dev`), TLS, and `KC_HOSTNAME` set to its public URL.
- Put the app behind TLS; set `PUBLIC_APP_URL`/`PUBLIC_KEYCLOAK_URL` and update the client's redirect URIs.
- Change every default password in `.env` and the realm file.

## How reporting counts work

A task counts toward the week/month its **start** falls in (creation time if unscheduled),
for its **assignee**. *Hourly support hours* = `actual_hours` when recorded, otherwise the
scheduled duration (`end - start`). Subtasks count as tasks of their own.

## API

All endpoints except `/api/config` and `/healthz` require `Authorization: Bearer <access token>`.

```
GET    /api/config                         runtime config for the SPA
GET    /api/me | /api/users
GET    /api/projects            POST /api/projects
GET    /api/projects/{id}       PATCH/DELETE /api/projects/{id}
GET    /api/tasks?project_id=&assignee_id=&type=&top_level=&parent_id=&from=&to=
POST   /api/tasks               { project_id | parent_id, title, type, start_at, end_at, ... }
GET    /api/tasks/{id}          includes subtasks / parent
PATCH  /api/tasks/{id}          partial update; null clears a field
DELETE /api/tasks/{id}          also deletes subtasks
GET    /api/reports/workload?from=&to=&project_id=
GET    /api/reports/workload/{userId}/tasks?from=&to=&project_id=
```
