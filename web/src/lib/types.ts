export type TaskType = 'project' | 'daily' | 'hourly'
export type ProjectKind = 'long' | 'short'

export const PROJECT_KINDS: { id: ProjectKind; label: string; hint: string }[] = [
  { id: 'long', label: 'Long project', hint: 'Runs a quarter or more.' },
  { id: 'short', label: 'Short project', hint: 'Comes in on short notice; done in about a month.' },
]

/** Task types, biggest first. A task can only contain smaller types. */
export const TASK_TYPES: { id: TaskType; label: string; hint: string }[] = [
  { id: 'project', label: 'Project', hint: 'The big picture — groups daily and hourly tasks.' },
  { id: 'daily', label: 'Daily', hint: 'Requests & deliverables — scheduled by date.' },
  { id: 'hourly', label: 'Hourly', hint: 'Implementation, deployment, support — scheduled by the hour.' },
]

const RANK: Record<TaskType, number> = { project: 3, daily: 2, hourly: 1 }

/** Whether a task of type `parent` may contain a task of type `child`. */
export const canContain = (parent: TaskType, child: TaskType) => RANK[child] < RANK[parent]

/** The type a new child task gets by default. */
export const defaultChildType = (parent: TaskType): TaskType => (parent === 'project' ? 'daily' : 'hourly')
export type Status = 'todo' | 'in_progress' | 'in_review' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface User {
  id: string
  username: string
  email: string
  display_name: string
  active: boolean
  last_seen_at: string
  /** Set when the account no longer exists in Keycloak. */
  deleted_at: string | null
}

/** A planner user whose Keycloak account was deleted. */
export interface RemovedUser extends User {
  sub: string
  /** Tasks only they own (with nothing of anyone else's inside): deleted if chosen. */
  sole_tasks: number
  /** Other assignments: only unassigned. */
  shared_tasks: number
  comments: number
}

export interface SyncResult {
  in_keycloak: number
  marked_deleted: string[]
  restored: string[]
}

export interface Me extends User {
  is_admin: boolean
  /** Workspace id -> role for non-admins (no entry = no access); null for admins. */
  workspace_roles: Record<string, WorkspaceRole> | null
  can_create_workspace: boolean
}

export type WorkspaceRole = 'editor' | 'viewer'
/** A role as stored for a member; "none" means no access. */
export type MemberRole = WorkspaceRole | 'none'

/** One workspace in a user's access list (admin API). */
export interface MemberAccess {
  workspace_id: string
  key: string
  name: string
  role: MemberRole
  /** false when the role is the server default. */
  explicit: boolean
}

/** A Keycloak user as returned by the admin API. */
export interface AdminUser {
  id: string
  username: string
  email: string
  first_name: string
  last_name: string
  enabled: boolean
  email_verified: boolean
  is_admin: boolean
  required_actions: string[]
  created_at: string | null
}

export interface AdminUserInput {
  username?: string
  email?: string
  first_name?: string
  last_name?: string
  enabled?: boolean
  is_admin?: boolean
  password?: string
  temporary_password?: boolean
}

export interface Workspace {
  id: string
  key: string
  name: string
  description: string
  task_count: number
  created_at: string
  /** The caller's role here. */
  my_role?: 'admin' | WorkspaceRole
}

export interface Task {
  id: string
  workspace_id: string
  workspace_key: string
  parent_id: string | null
  number: number
  key: string
  title: string
  description: string
  type: TaskType
  /** 'long' or 'short' for projects, null for daily/hourly tasks. */
  project_kind: ProjectKind | null
  status: Status
  priority: Priority
  assignee_ids: string[]
  reporter_id: string | null
  start_at: string | null
  end_at: string | null
  estimate_hours: number | null
  actual_hours: number | null
  progress: number
  position: number
  completed_at: string | null
  created_at: string
  updated_at: string
  subtask_count: number
  subtask_done: number
  comment_count: number
  /** Ids of tasks this one waits for, and how many of them aren't done. */
  blocked_by: string[]
  open_blockers: number
  /** Environment (from the task's project) the work is done in. */
  environment_id: string | null
  environment_name: string | null
  environment_color: EnvColor | null
  /** Category of a project (KPI, Enhancement, ...); null for other tasks. */
  project_category_id: string | null
  project_category_name: string | null
  project_category_color: EnvColor | null
  /** Runbook checklist progress. */
  runbook_total: number
  runbook_done: number
}

export interface ProjectCategory {
  id: string
  workspace_id: string
  name: string
  color: EnvColor
  position: number
  project_count: number
}

/** A palette name (see lib/colors) or a custom "#rrggbb". */
export type EnvColor = string

export interface Environment {
  id: string
  project_id: string
  name: string
  color: EnvColor
  position: number
  task_count: number
}

/** An environment being edited; id is empty until saved. */
export interface EnvironmentDraft {
  id: string
  name: string
  color: EnvColor
  task_count?: number
}

export interface Comment {
  id: string
  task_id: string
  author_id: string | null
  /** Markdown source. */
  body: string
  created_at: string
  updated_at: string
}

export interface TaskDetail extends Task {
  subtasks: Task[]
  /** Parent chain, outermost first. */
  ancestors: Task[]
  /** Tasks this one waits for, and tasks waiting for it. */
  waiting_for: Task[]
  blocking: Task[]
}

export interface Workload {
  user_id: string
  username: string
  display_name: string
  email: string
  total_tasks: number
  done_tasks: number
  hourly_tasks: number
  hourly_hours: number
  daily_tasks: number
  daily_done: number
  logged_hours: number
  deleted: boolean
  active: boolean
}

/** A committed task and the project it sits in (null for independent tasks). */
export interface CommittedTask extends Task {
  project_id: string | null
  project_title: string | null
  /** Hourly tasks are committed by their schedule (assigned + starting in the week), not picked. */
  automatic: boolean
  /** On overdue tasks: the Monday (YYYY-MM-DD) of the week it was committed for. */
  committed_week?: string
}

/** What one person intends to finish in a week. */
export interface Commitment {
  user_id: string
  username: string
  display_name: string
  email: string
  /** The Monday the week starts on, YYYY-MM-DD. */
  week: string
  capacity_hours: number
  note: string
  /** null until the person commits for this week. */
  updated_at: string | null
  tasks: CommittedTask[]
  /** Time the hourly tasks take, counted like the workload report (overlaps once). */
  hourly_hours: number
  /** Last week's committed tasks that still aren't done. */
  carried_over: string[]
  /** Tasks committed last week, and how many were done before it ended. */
  prev_total: number
  prev_kept: number
  /** Tasks committed in the 4 weeks before this one that still aren't done (and aren't committed this week). */
  overdue: CommittedTask[]
}

/** What the Team view gets of a committed task (the full task is fetched when opened). */
export type TaskBrief = Pick<
  CommittedTask,
  'id' | 'workspace_id' | 'key' | 'title' | 'type' | 'status' | 'estimate_hours' | 'environment_name' | 'environment_color' | 'project_title' | 'automatic' | 'committed_week'
>

/** A Commitment with TaskBriefs, as the Team view gets it. */
export interface CommitmentBrief extends Omit<Commitment, 'tasks' | 'overdue' | 'carried_over'> {
  tasks: TaskBrief[]
  overdue: TaskBrief[]
}

export interface CommitmentInput {
  capacity_hours: number
  note: string
  task_ids: string[]
}

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
]

export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']

export const statusLabel = (s: Status) => STATUSES.find((x) => x.id === s)?.label ?? s

/** A workspace backup file (see the server's store.ExportDoc). */
export interface WorkspaceBackup {
  /** 'open-planner-workspace' is the name used before the rename. */
  format: 'lajurops-workspace' | 'open-planner-workspace'
  version: number
  exported_at: string
  exported_by?: string
  workspace: { key: string; name: string; description: string }
  users: { ref: string; username: string }[]
  tasks: unknown[]
  environments: unknown[]
  dependencies: unknown[]
  comments: unknown[]
}

export interface ImportResult {
  dry_run: boolean
  workspace: Workspace | null
  key: string
  name: string
  key_taken: boolean
  tasks: number
  environments: number
  dependencies: number
  comments: number
  assignments: number
  unknown_users: string[]
}

/** A runbook checklist item; times are optional. */
export interface RunbookStep {
  id: string
  section_id: string
  title: string
  start_at: string | null
  duration_minutes: number | null
  done: boolean
  done_at: string | null
  done_by: string | null
  position: number
}

/** A named group of runbook steps, e.g. "Preparation". */
export interface RunbookSection {
  id: string
  task_id: string
  name: string
  position: number
  steps: RunbookStep[]
}

/** A workspace's reusable runbook; step times are relative to the task start. */
export interface RunbookTemplate {
  id: string
  workspace_id: string
  name: string
  step_count: number
  updated_at: string
  sections: { name: string; steps: { title: string; offset_minutes: number | null; duration_minutes: number | null }[] }[]
}
