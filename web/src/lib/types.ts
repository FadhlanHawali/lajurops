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
}

export interface Me extends User {
  is_admin: boolean
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
}

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
]

export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']

export const statusLabel = (s: Status) => STATUSES.find((x) => x.id === s)?.label ?? s
