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
- **Keycloak** sign-in (OIDC + PKCE) with an in-app sign-in screen
- **User management** for admins: create, edit, disable, delete users, reset passwords and grant the admin role (via the Keycloak Admin API)

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
internal/auth/        Keycloak JWT verification middleware (+ admin role)
internal/keycloak/    Keycloak Admin REST API client (user management)
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

| Service       | URL / purpose |
|---------------|-----|
| `app`         | http://localhost:8080 |
| `keycloak`    | http://localhost:8081 (admin console: `admin` / `KEYCLOAK_ADMIN_PASSWORD`) |
| `planner-db`  | PostgreSQL for the planner (volume `planner-db`) |
| `keycloak-db` | PostgreSQL for Keycloak (volume `keycloak-db`) |

The `open-planner` realm is imported with two demo users: **alice** (planner admin) and
**bob** (member). Their passwords are in [deploy/keycloak/realm-open-planner.json](deploy/keycloak/realm-open-planner.json).
Change or remove them before exposing the stack.

> The realm file is imported only when the realm doesn't exist yet. After changing it,
> recreate Keycloak's database: `docker compose down -v` (this also wipes the planner DB)
> or `docker compose rm -sf keycloak keycloak-db && docker volume rm open-planner_keycloak-db`.

## Sign-in and user management

Opening the app shows a sign-in screen; **Sign in** redirects to Keycloak's login page
(passwords never touch the planner), then back to the app. Users can change their own
password from the ⚙ link in the sidebar (Keycloak account console).

Users with the Keycloak realm role **`planner-admin`** get a **Users** page to create, edit,
disable and delete accounts, reset passwords (optionally forcing a change at next sign-in) and
grant or revoke the admin role. The backend performs these calls with the service account of
the confidential client `open-planner-admin` (realm-management roles `view-users`,
`query-users`, `manage-users`, `view-realm`). Users created there can be assigned tasks
immediately; deleted or disabled users disappear from assignee lists but keep their history.

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
| `ADMIN_ROLE`     | `planner-admin` | Realm role that unlocks the Users page |
| `KEYCLOAK_ADMIN_URL` | issuer base URL | Keycloak base URL the backend uses for the Admin API (e.g. `http://keycloak:8080`) |
| `KEYCLOAK_ADMIN_CLIENT_ID` | `open-planner-admin` | Confidential client with a service account |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | (empty) | Its secret; user management is disabled when empty |
| `AUTH_DISABLED`  | `false` | Local development only: skip Keycloak entirely |

The frontend gets its Keycloak settings at runtime from `GET /api/config`, so
one build works in every environment.

### Using an existing Keycloak

1. Create a client `open-planner`: *Client authentication* off (public), *Standard flow* on.
2. Valid redirect URIs: `https://planner.example.com/*`; Web origins: `+`.
3. Advanced → *Proof Key for Code Exchange*: `S256`.
4. Create a realm role `planner-admin` and assign it to your administrators.
5. For user management, create a confidential client `open-planner-admin` with *Service accounts* on
   (standard flow off), and give its service account the `realm-management` client roles
   `view-users`, `query-users`, `manage-users`, `view-realm`.
6. Run the app with `OIDC_ISSUER=https://<keycloak>/realms/<realm>` and `KEYCLOAK_ADMIN_CLIENT_SECRET=<secret>`.

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

# planner-admin only
GET    /api/admin/users?search=&first=&max=
POST   /api/admin/users         { username, email, first_name, last_name, password, temporary_password, is_admin, enabled }
PATCH  /api/admin/users/{id}    any of the above except username; password resets it
DELETE /api/admin/users/{id}
```
