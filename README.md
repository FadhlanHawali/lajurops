<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo.svg" alt="LajurOps" width="300">
  </picture>
</p>

<h3 align="center">Plan every lane, down to the hour</h3>

<p align="center">
  Open-source planning for ops teams: projects, requests and deployments on one timeline, across every environment.<br>
  Board · Projects · Timeline down to the hour · Calendar · Hourly Workload · Weekly Commitment · Keycloak · single binary
</p>

<p align="center">
  <img src="docs/media/hero-timeline.png" alt="LajurOps timeline with projects, environments and dependencies" width="900">
</p>

<p align="center">
  <a href="#quick-start-docker-compose">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#api">API</a>
</p>

> *Lajur* is Indonesian for "lane": every person, project and environment is a lane on the timeline.

## Features

### Board
Kanban for daily and hourly work (To Do → In Progress → In Review → Done). Drag cards between columns; filter
by assignee, type, project or environment. Cards show the project, environment, owners, comments and what a
task is waiting for.

<img src="docs/media/board.gif" alt="Board: drag between columns, filter by environment and type" width="900">

### Projects, categories and environments
A task is a **Project**, **Daily** or **Hourly** item, nested Project → Daily → Hourly. Projects are **long**
(a quarter or more) or **short** (about a month) and belong to a **category** (KPI, Enhancement, Ad Hoc, or your
own). A project's **status and progress come from its tasks**. Each project defines its **environments**
(e.g. Dev → QA → Staging → Production) and its tasks are grouped by environment; opening a task from a project
stacks it, with a way back.

<img src="docs/media/projects.gif" alt="Projects by category, tasks grouped by environment, stacked task dialogs" width="900">

### Timeline (Gantt) down to the hour
Zoom from **month → week → day → 6 hours → hour**. Drag bars to reschedule and edges to resize (hourly work snaps
to 15 minutes). Projects show a summary bar, and **dependencies** are drawn as arrows, red when a task is scheduled
to start before the task it waits for ends.

<img src="docs/media/timeline.gif" alt="Timeline zooming from weeks to hours with dependency arrows" width="900">

### Calendar
Month, week, day and agenda views. Daily tasks are all-day bars and hourly tasks are timed; click a task to open it,
or click or drag over empty time to create one. Busy weeks stay readable: crowded slots and days are grouped by
project (or by environment when you filter to one project), with a side panel listing the tasks in a group. Filter by
any set of projects.

<img src="docs/media/calendar.gif" alt="Calendar: month and week views, selecting a slot creates an hourly task" width="900">

### Creating tasks
Pick the type, search for the project (or daily task) it belongs to, choose the environment, schedule it with the
date/time pickers (type times like `9:30pm`, one-click durations) and assign several owners.

<img src="docs/media/create-task.gif" alt="Creating an hourly task with parent search, environment, schedule and owners" width="900">

### Markdown comments
Comment on projects, daily and hourly tasks in GitHub-flavoured Markdown (checklists, tables, code) with a
toolbar, shortcuts and preview.

<img src="docs/media/comments.gif" alt="Writing and previewing a Markdown comment" width="900">

### Hourly Workload
Per person, per week or month: time spent on **hourly tasks** (support, deployments, implementation), plus hourly/daily
task counts and completion. Daily tasks have no hours and are planned on Weekly Commitment. Drill into a person's tasks and
export CSV.

<img src="docs/media/workload.gif" alt="Workload report: weekly and monthly, per-person drill-down" width="900">

### Weekly Commitment
Each person picks the daily tasks they intend to finish this week: drag them from the daily tasks assigned to them
(work left over from last week is marked *carried over*) from unassigned ones (which assigns them) or from other people's (which adds them as a co-owner), then order them,
set their capacity and add a note. A picked task without dates is scheduled Monday to Friday of that week. Hourly tasks
assigned to them that start in the week are committed **automatically**. Planned hours are the hourly time (counted
like the workload report) plus the daily tasks' estimates, and turn red over capacity. The **Team** view shows
everyone's commitment, progress and notes, and **last week kept** shows how many committed tasks were done in time.

### Backup and restore
Export a workspace to JSON and import it (from a file or a URL) as a new workspace, with a preview first.

<img src="docs/media/backup.gif" alt="Exporting a workspace and importing the backup as a new workspace" width="900">

### Sign-in and user management
Sign in with **Keycloak** (OIDC + PKCE). Admins manage users from the app (create, disable, reset passwords,
grant admin) and choose who can **edit**, **view** or **not see** each workspace. They can also sync with
Keycloak to clean up people deleted there.

<img src="docs/media/sign-in.png" alt="Sign-in screen" width="900">

### At a glance

- **Board**: Kanban (To Do → In Progress → In Review → Done) with drag & drop
- **Timeline (Gantt)**: zoom from **month → week → day → 6 hours → hour**; drag to reschedule, drag edges to resize, Ctrl+scroll to zoom
- **Calendar**: month/week/day/agenda views; click to open, click or drag over empty time to create; busy slots grouped by project
- **Workspaces** (e.g. a team) hold all tasks; task keys look like `APP-12`
- **Three task types**, nested **Project → Daily → Hourly**:
  - `project`: the big picture; groups daily and hourly tasks (shown as a summary bar on the timeline).
    Each project is either **long** (a quarter or more) or **short** (short notice, about a month);
    the dialog suggests switching when the timeline doesn't match.
    Projects belong to a **category** (default *KPI Project*, *Enhancement Project*, *Ad Hoc Project*;
    customisable per workspace); the board shows projects in category columns. A project's **status and
    progress are derived from its daily/hourly tasks** (all done → done, any started → in progress)
  - `daily`: requests and deliverables, scheduled by whole days (start date → due date)
  - `hourly`: implementation, deployment and support work, with exact start and end times (snapped to 15 min on the hour zoom)

  A task can only contain smaller types (project → daily/hourly, daily → hourly).
  Daily and hourly tasks can also be **independent**, without a project.
- **Multiple owners** per project/daily/hourly task
- **Environments** per project (e.g. Dev → QA → Staging → Production, ordered and colour-coded);
  daily/hourly tasks in the project say which environment they're done in, shown on cards, the timeline
  and calendar, with an environment filter on the board
- **Dependencies** between daily/hourly tasks ("Deploy to Staging" *waits for* "Set up staging"): cycles are
  rejected, blocked cards show what they wait for, and the timeline draws arrows (red when a task starts before
  the task it waits for ends)
- **Comments** on projects, daily and hourly tasks, written in **Markdown** (GitHub flavoured: checklists, tables, code blocks) with a formatting toolbar and preview; authors can edit/delete their own comments, admins can delete any
- **Backup & restore**: export a workspace to JSON; import a backup from a file or a URL as a new workspace
- **Hourly Workload**: per user, per week or month: hourly hours, hourly/daily task counts, completion; drill down and export CSV
- **Week grid**: people × days for one week, listing each person's hourly tasks per day with daily and weekly hours (parallel work counted once)
- **Keycloak** sign-in (OIDC + PKCE) with an in-app sign-in screen
- **User management** for admins: create, edit, disable, delete users, reset passwords and grant the admin role (via the Keycloak Admin API)

It ships as a **single binary**: the React frontend is compiled by Vite and embedded
into the Go server with `go:embed`, the same approach [Radar](https://github.com/skyhook-io/radar) uses.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Go 1.22, chi, pgx v5, go-oidc |
| Database | PostgreSQL 16 (migrations embedded, applied on startup) |
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS v4, TanStack Query, custom Gantt and calendar |
| Auth     | Keycloak (public client, Authorization Code + PKCE) |

```
cmd/lajurops/         main: config, DB, HTTP server
internal/api/         REST handlers (/api/...)
internal/auth/        Keycloak JWT verification middleware (+ admin role)
internal/keycloak/    Keycloak Admin REST API client (user management)
internal/store/       SQL queries (workspaces, tasks, users, reports)
internal/db/          pool + embedded SQL migrations
web/                  React app; web/dist is embedded into the binary
deploy/keycloak/      realm import (clients + demo users)
scripts/demo/         seeds a demo instance and records the README media
```

## Quick start (Docker Compose)

Clone the repository (the compose file also starts Keycloak with a ready-made realm), then run the
published image:

```bash
cp .env.example .env   # optional; set LAJUROPS_VERSION=0.1.0 to pin a release
docker compose pull app
docker compose up -d
```

Or build the image from your checkout instead: `docker compose up -d --build`.

The image is `ghcr.io/fadhlanhawali/lajurops` (linux/amd64 and linux/arm64), tagged per release
(`0.1.0`, `0.1`) and `latest`. Each [GitHub release](https://github.com/FadhlanHawali/lajurops/releases)
also has single binaries for Linux, macOS and Windows.

| Service       | URL / purpose |
|---------------|-----|
| `app`         | http://localhost:8080 |
| `keycloak`    | http://localhost:8081 (admin console: `admin` / `KEYCLOAK_ADMIN_PASSWORD`) |
| `planner-db`  | PostgreSQL for LajurOps (volume `lajurops_planner-db`) |
| `keycloak-db` | PostgreSQL for Keycloak (volume `lajurops_keycloak-db`) |

The `lajurops` realm is imported with two demo users: **alice** (admin) and **bob** (member).
Their passwords are in [deploy/keycloak/realm-lajurops.json](deploy/keycloak/realm-lajurops.json).
Change or remove them before exposing the stack.

> The realm file is imported only when the realm doesn't exist yet. After changing it,
> recreate Keycloak's database: `docker compose down -v` (this also wipes the LajurOps DB)
> or `docker compose rm -sf keycloak keycloak-db && docker volume rm lajurops_keycloak-db`.

## Sign-in and user management

Opening the app shows a sign-in screen; **Sign in** redirects to Keycloak's login page
(passwords never touch LajurOps), then back to the app. Users can change their own
password from the ⚙ link in the sidebar (Keycloak account console).

Users with the Keycloak realm role **`lajurops-admin`** get a **Users** page to create, edit,
disable and delete accounts, reset passwords (optionally forcing a change at next sign-in) and
grant or revoke the admin role. The backend performs these calls with the service account of
the confidential client `lajurops-service` (realm-management roles `view-users`,
`query-users`, `manage-users`, `view-realm`). Users created there can be assigned tasks
immediately; deleted or disabled users disappear from assignee lists but keep their history.

**Users deleted directly in Keycloak:** press **Sync with Keycloak** on the Users page. LajurOps users
that no longer exist in Keycloak are marked *Deleted* and listed under "Deleted in Keycloak", where
an admin can **Remove from LajurOps**, either keeping their tasks (just unassigned) or deleting the
tasks only they own. Shared tasks, and tasks containing someone else's work, are only unassigned;
comments stay, shown as by a deleted user. Hourly Workload hides deleted/disabled people unless they have
tasks in the selected period.

### Roles and workspace access

| Role | What they can do |
|------|------------------|
| **Admin** (realm role `lajurops-admin`) | Everything, in every workspace; manage users and their access |
| **Editor** (per workspace) | Create, edit and delete tasks, comments, environments and categories; delete the workspace |
| **Viewer** (per workspace) | Read only: boards, timeline, calendar, task details, comments, workload, export |
| **No access** (per workspace) | The workspace is hidden from them |

Admins set a member's role per workspace in the user's **Edit** dialog (Role → Member → Workspace access).
A user with no role set for a workspace gets `DEFAULT_WORKSPACE_ROLE` (`viewer` by default, or `none`).
That covers new users at their first sign-in and workspaces created later. Admins, and anyone who
is an editor of at least one workspace, can create or import workspaces; the creator becomes the
new workspace's editor. The server enforces all of this; the UI also hides what a role can't do.

> **Upgrading:** when roles were added, every existing user became an **editor of every existing
> workspace**, so nothing changes until an admin restricts access.

## Local development

Requires Go 1.22+, Node 20+ and a PostgreSQL.

```bash
# terminal 1: API on :8080 without Keycloak (every request is the "dev" user)
export DATABASE_URL=postgres://planner:planner@localhost:5432/planner?sslmode=disable
make dev-backend

# terminal 2: Vite on :5173 with hot reload, proxying /api to :8080
make dev-web
```

Store integration tests run against a real, migrated database (they create and clean up their own data):

```bash
PLANNER_TEST_DATABASE_URL=postgres://planner:planner@localhost:5432/planner?sslmode=disable go test ./internal/store
```

Build the single binary:

```bash
make build        # web/dist + bin/lajurops
./bin/lajurops
```

## Configuration

| Variable         | Default | Description |
|------------------|---------|-------------|
| `ADDR`           | `:8080` | Listen address |
| `DATABASE_URL`   | `postgres://planner:planner@localhost:5432/planner?sslmode=disable` | PostgreSQL DSN |
| `OIDC_ISSUER`    | (required) | Realm URL **as the browser sees it**, e.g. `https://sso.example.com/realms/lajurops` |
| `OIDC_JWKS_URL`  | `<issuer>/protocol/openid-connect/certs` | Where the server fetches signing keys; set it when the backend reaches Keycloak on an internal hostname |
| `OIDC_CLIENT_ID` | `lajurops` | Public client used by the SPA; tokens must have `azp` = this |
| `ADMIN_ROLE`     | `lajurops-admin` | Realm role that unlocks the Users page |
| `KEYCLOAK_ADMIN_URL` | issuer base URL | Keycloak base URL the backend uses for the Admin API (e.g. `http://keycloak:8080`) |
| `KEYCLOAK_ADMIN_CLIENT_ID` | `lajurops-service` | Confidential client with a service account |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | (empty) | Its secret; user management is disabled when empty |
| `KEYCLOAK_CA_CERT` | (empty) | PEM file with extra CA certificates to trust when the server calls Keycloak over HTTPS (internal/company CA) |
| `KEYCLOAK_TLS_SKIP_VERIFY` | `false` | Don't verify Keycloak's TLS certificate at all. Insecure; prefer `KEYCLOAK_CA_CERT` |
| `IMPORT_ALLOW_PRIVATE_URLS` | `false` | Let "import from URL" fetch from private/internal addresses (e.g. an intranet file server) |
| `DEFAULT_WORKSPACE_ROLE` | `viewer` | Role of a non-admin in a workspace nobody gave them a role in: `viewer` or `none` |
| `AUTH_DISABLED`  | `false` | Local development only: skip Keycloak entirely |
| `DEV_USER_ADMIN` | `true` | With `AUTH_DISABLED`: set `false` to use the app as a non-admin member (to try roles) |
| `LOG_LEVEL`      | `info` | `debug`, `info`, `warn` or `error`. Rejected sign-in tokens are logged at `warn` with the reason |

Docker Compose reads `LAJUROPS_DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`,
`LAJUROPS_SERVICE_CLIENT_SECRET`, `PUBLIC_KEYCLOAK_URL`, `LOG_LEVEL`, `KEYCLOAK_CA_CERT` and `KEYCLOAK_TLS_SKIP_VERIFY` from `.env` (see `.env.example`).

The frontend gets its Keycloak settings at runtime from `GET /api/config`, so
one build works in every environment.

### Using an existing Keycloak

1. Create a client `lajurops`: *Client authentication* off (public), *Standard flow* on.
2. Valid redirect URIs: `https://lajurops.example.com/*`; Web origins: `+`.
3. Advanced → *Proof Key for Code Exchange*: `S256`.
4. Create a realm role `lajurops-admin` and assign it to your administrators.
5. For user management, create a confidential client `lajurops-service` with *Service accounts* on
   (standard flow off), and give its service account the `realm-management` client roles
   `view-users`, `query-users`, `manage-users`, `view-realm`.
6. Run the app with `OIDC_ISSUER=https://<keycloak>/realms/<realm>` and `KEYCLOAK_ADMIN_CLIENT_SECRET=<secret>`.

### Production notes

- Run Keycloak with `start` (not `start-dev`), TLS, and `KC_HOSTNAME` set to its public URL.
- Put the app behind TLS; set `PUBLIC_KEYCLOAK_URL` and update the client's redirect URIs.
- Change every default password in `.env` and the realm file.

### Troubleshooting sign-in (401 "invalid token")

If you can sign in but every API call fails with 401, the server rejects Keycloak's token.
The app shows the reason in a red banner, and the server logs it:

```bash
docker compose logs app | grep auth:
```

At startup the app also checks that it can fetch the signing keys
(`auth: OIDC signing keys reachable` or `auth: cannot fetch OIDC signing keys`). Common causes:

| Log says | Fix |
|----------|-----|
| `cannot fetch signing keys ... requests go through proxy ...` | A corporate `HTTP_PROXY`/`HTTPS_PROXY` reached the container. Add the Keycloak host (`keycloak` in compose) to `NO_PROXY`. The bundled compose file already does this; check `~/.docker/config.json` or your own overrides |
| `issuer mismatch: the token was issued by "X" but OIDC_ISSUER is "Y"` | Set `PUBLIC_KEYCLOAK_URL` (compose) or `OIDC_ISSUER` to exactly the Keycloak URL the browser uses (scheme, host and port), then `docker compose up -d` |
| `token expired ...` / `issued in the future` | The server's and Keycloak's clocks disagree; enable NTP |
| `signature does not match any key` | `OIDC_JWKS_URL` points at a different realm or Keycloak than `OIDC_ISSUER` |
| `token was issued to client "X"` | Set `OIDC_CLIENT_ID` to the client the frontend signs in with |
| `x509: certificate signed by unknown authority` | Keycloak uses a certificate from an internal CA. Trust it with `KEYCLOAK_CA_CERT` (below), or set `KEYCLOAK_TLS_SKIP_VERIFY=true` as a last resort |

Set `LOG_LEVEL=debug` for a log line per accepted token as well.

To trust an internal CA with Docker Compose, put its certificate (PEM) next to the compose file
and add a `docker-compose.override.yml`:

```yaml
services:
  app:
    volumes:
      - ./company-ca.pem:/certs/company-ca.pem:ro
    environment:
      KEYCLOAK_CA_CERT: /certs/company-ca.pem
```

These settings cover the server's calls to Keycloak (signing keys and user management).
The browser must trust the certificate on its own, through the OS or browser certificate store.

## Backup and restore

- **Export**: the download button on a workspace page saves `<KEY>-<date>.json` with the workspace, all
  tasks (hierarchy, dates, status, owners), environments, categories, dependencies and comments.
- **Import**: the upload button next to *Workspaces* in the sidebar. Pick/drop a file or enter a URL; a
  preview shows what will be created. A backup is always restored as a **new** workspace (choose a new key
  if the original is taken); task numbers are kept. People are matched **by username**: owners missing from
  this LajurOps instance are dropped and their comments show as by a deleted user (accounts live in Keycloak).
- **Import from URL** is downloaded by the server. To stop it being used to probe internal services, it
  refuses private/loopback/link-local addresses (e.g. `10.x`, `192.168.x`, `localhost`, cloud metadata) unless
  `IMPORT_ALLOW_PRIVATE_URLS=true`; files are limited to 25 MB.

## How reporting counts work

A task counts toward the week/month its **start** falls in (creation time if unscheduled),
for its **assignee**. Project tasks are containers and are not counted.

*Hourly support hours* are the time a person spent on hourly tasks, with **overlapping tasks
counted once**: support done in parallel isn't double-counted. For example, 09:00–11:00 and
09:00–11:30 on the same day make 2.5 h, not 4.5 h. Each task covers its scheduled time, or
`actual_hours` from its start when recorded. An unscheduled task adds its `actual_hours` on its own.
A task with several owners counts fully for each of them.

## API

All endpoints except `/api/config` and `/healthz` require `Authorization: Bearer <access token>`.

```
GET    /api/config                         runtime config for the SPA
GET    /api/me | /api/users
GET    /api/workspaces          POST /api/workspaces
GET    /api/workspaces/{id}     PATCH/DELETE /api/workspaces/{id}
GET    /api/tasks?workspace_id=&assignee_id=(id|none|others)&type=daily,hourly&top_level=&parent_id=&from=&to=
       &undated=open|all     with from/to, also tasks without dates (all, or not done)
       &ancestors=true       also the parents/grandparents of the matches
       &q=&limit=            search title or key ("APP-12"), best match first
POST   /api/tasks               { workspace_id | parent_id, title, type: project|daily|hourly, project_kind: long|short, assignee_ids: [], environment_id, start_at, end_at, ... }
GET    /api/tasks/{id}          includes subtasks, ancestors, waiting_for and blocking
PATCH  /api/tasks/{id}          partial update (incl. type, parent_id; nesting is validated); null clears a field
DELETE /api/tasks/{id}          also deletes everything inside it
GET    /api/workspaces/{id}/categories              project categories (with project counts)
GET    /api/workspaces/{id}/project-progress        done/total daily and hourly tasks inside each project
PUT    /api/workspaces/{id}/categories              [{ id?, name, color }]  replaces the list, in order
GET    /api/workspaces/{id}/export                  backup (JSON)
POST   /api/workspaces/import?key=&name=&dry_run=   body: backup; creates a new workspace
POST   /api/import/fetch        { url }             download a backup server-side (private addresses blocked)
GET    /api/tasks/{id}/environments                 a project's environments (with task counts)
PUT    /api/tasks/{id}/environments                 [{ id?, name, color }]  replaces the list, in order
POST   /api/tasks/{id}/dependencies                 { depends_on_id }   (task {id} waits for it)
DELETE /api/tasks/{id}/dependencies/{dependsOnId}
GET    /api/tasks/{id}/comments   POST /api/tasks/{id}/comments { body }   (Markdown)
PATCH  /api/comments/{id}       { body }   (author only)
DELETE /api/comments/{id}       (author or lajurops-admin)
GET    /api/reports/workload?from=&to=&workspace_id=
GET    /api/reports/workload/{userId}/tasks?from=&to=&workspace_id=
GET    /api/commitments?week=&workspace_id=          everyone's commitment; week = Monday 00:00 local, RFC 3339
GET    /api/commitments/me?week=
PUT    /api/commitments/me?week=  { capacity_hours, note, task_ids: [] }   daily tasks, in order (hourly ones are automatic);
       unassigned picks are assigned to you and unscheduled ones get Mon–Fri of the week (editors only)

# lajurops-admin only
POST   /api/admin/users/sync                 mirror Keycloak users; mark missing ones deleted
GET    /api/admin/users/removed              users deleted in Keycloak, with task/comment counts
DELETE /api/admin/users/removed/{id}?delete_tasks=true|false
GET    /api/admin/users?search=&first=&max=
POST   /api/admin/users         { username, email, first_name, last_name, password, temporary_password, is_admin, enabled }
PATCH  /api/admin/users/{id}    any of the above except username; password resets it
DELETE /api/admin/users/{id}
GET    /api/admin/users/{id}/access         every workspace with the user's role (and whether it's the default)
PUT    /api/admin/users/{id}/access         { "<workspace id>": "editor" | "viewer" | "none", ... }
```

## License

[MIT](LICENSE)
