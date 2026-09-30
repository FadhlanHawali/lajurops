export type TaskType = 'hourly' | 'daily'
export type Status = 'todo' | 'in_progress' | 'in_review' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface User {
  id: string
  username: string
  email: string
  display_name: string
  last_seen_at: string
}

export interface Project {
  id: string
  key: string
  name: string
  description: string
  task_count: number
  created_at: string
}

export interface Task {
  id: string
  project_id: string
  project_key: string
  parent_id: string | null
  number: number
  key: string
  title: string
  description: string
  type: TaskType
  status: Status
  priority: Priority
  assignee_id: string | null
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
}

export interface TaskDetail extends Task {
  subtasks: Task[]
  parent: Task | null
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
