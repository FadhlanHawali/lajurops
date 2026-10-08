import { useMemo } from 'react'
import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from './api'
import type { AdminUser, AdminUserInput, MemberAccess, MemberRole, RunbookSection, RunbookStep, RunbookTemplate, Comment, Commitment, CommitmentBrief, CommitmentInput, ProjectCategory, ImportResult, WorkspaceBackup, RemovedUser, SyncResult, Environment, EnvironmentDraft, Me, Workspace, Task, TaskDetail, TaskType, User, Workload } from './types'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
})

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })

export function useUsers() {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') })
  const byId = useMemo(() => new Map((q.data ?? []).map((u) => [u.id, u])), [q.data])
  // Inactive users (disabled/deleted in Keycloak) stay resolvable by id for history.
  const active = useMemo(() => (q.data ?? []).filter((u) => u.active && !u.deleted_at), [q.data])
  return { ...q, users: active, byId }
}

export const useWorkspaces = () => useQuery({ queryKey: ['workspaces'], queryFn: () => api<Workspace[]>('/workspaces') })

export const useWorkspace = (id: string | undefined) =>
  useQuery({ queryKey: ['workspaces', id], queryFn: () => api<Workspace>(`/workspaces/${id}`), enabled: !!id })

export interface TaskQuery {
  workspace_id?: string
  parent_id?: string
  assignee_id?: string
  type?: string
  top_level?: boolean
  from?: string
  to?: string
  /** With from/to, also tasks without dates: all of them, or the ones not done. */
  undated?: 'all' | 'open'
  /** Also the parents of matching tasks (project context for cards and rows). */
  ancestors?: boolean
  /** Search by title or key, best match first; use with limit. */
  q?: string
  limit?: number
}

export const useTasks = (query: TaskQuery, enabled = true, opts: { keepPrevious?: boolean } = {}) =>
  useQuery({
    queryKey: ['tasks', query],
    queryFn: () => api<Task[]>('/tasks', { query: { ...query } }),
    enabled,
    // Keep showing the last result while a new range loads (no flicker).
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  })

/** Done/total daily and hourly tasks inside each project of a workspace. */
export function useProjectProgress(workspaceId?: string) {
  const q = useQuery({
    queryKey: ['tasks', 'project-progress', workspaceId],
    queryFn: () => api<{ project_id: string; done: number; total: number }[]>(`/workspaces/${workspaceId}/project-progress`),
    enabled: !!workspaceId,
  })
  const byId = useMemo(() => new Map((q.data ?? []).map((p) => [p.project_id, p])), [q.data])
  return { ...q, byId }
}

export const useTask = (id: string | null) =>
  useQuery({ queryKey: ['task', id], queryFn: () => api<TaskDetail>(`/tasks/${id}`), enabled: !!id })

export const useWorkload = (from: string, to: string, workspaceId: string) =>
  useQuery({
    queryKey: ['workload', from, to, workspaceId],
    queryFn: () => api<Workload[]>('/reports/workload', { query: { from, to, workspace_id: workspaceId } }),
  })

export const useWorkloadTasks = (userId: string | null, from: string, to: string, workspaceId: string) =>
  useQuery({
    queryKey: ['workload-tasks', userId, from, to, workspaceId],
    queryFn: () =>
      api<Task[]>(`/reports/workload/${userId}/tasks`, { query: { from, to, workspace_id: workspaceId } }),
    enabled: !!userId,
  })

// --- weekly commitments (week: the Monday's start as RFC 3339 with the local offset) ---

export const useCommitments = (week: string, workspaceId: string) =>
  useQuery({
    queryKey: ['commitments', week, workspaceId],
    queryFn: () => api<CommitmentBrief[]>('/commitments', { query: { week, workspace_id: workspaceId } }),
    placeholderData: keepPreviousData,
  })

export const useMyCommitment = (week: string) =>
  useQuery({ queryKey: ['commitments', 'me', week], queryFn: () => api<Commitment>('/commitments/me', { query: { week } }) })

export function useSaveCommitment(week: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CommitmentInput) => api<Commitment>('/commitments/me', { method: 'PUT', query: { week }, body: input }),
    onSuccess: (data) => qc.setQueryData(['commitments', 'me', week], data),
    // Saving can assign and schedule the picked tasks.
    onSettled: () => invalidateTaskData(qc),
  })
}

function invalidateTaskData(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['tasks'] })
  qc.invalidateQueries({ queryKey: ['task'] })
  qc.invalidateQueries({ queryKey: ['workspaces'] })
  qc.invalidateQueries({ queryKey: ['workload'] })
  qc.invalidateQueries({ queryKey: ['workload-tasks'] })
  qc.invalidateQueries({ queryKey: ['commitments'] })
  qc.invalidateQueries({ queryKey: ['runbook'] }) // steps tracked as tasks follow those tasks
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'parent_id'
    | 'project_kind'
    | 'environment_id'
    | 'project_category_id'
    | 'description'
    | 'type'
    | 'status'
    | 'priority'
    | 'assignee_ids'
    | 'start_at'
    | 'end_at'
    | 'estimate_hours'
    | 'actual_hours'
    | 'progress'
    | 'position'
  >
>

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      api<Task>(`/tasks/${id}`, { method: 'PATCH', body: patch }),
    // Optimistically patch every cached task list so drags feel instant.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['commitments'] })
      const snapshots = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      for (const [key, list] of snapshots) {
        if (list) qc.setQueryData(key, list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
      }
      // Commitments too (a list for Team, one for My week), so ticking a task done is instant.
      const patchTasks = <T extends { id: string }>(list: T[]) => list.map((t) => (t.id === id ? { ...t, ...patch } : t))
      const patchOne = <C extends Commitment | CommitmentBrief>(c: C) => ({ ...c, tasks: patchTasks(c.tasks), overdue: patchTasks(c.overdue) })
      const commitmentSnapshots = qc.getQueriesData<Commitment | CommitmentBrief[]>({ queryKey: ['commitments'] })
      for (const [key, data] of commitmentSnapshots) {
        if (data) qc.setQueryData(key, Array.isArray(data) ? data.map(patchOne) : patchOne(data))
      }
      return { snapshots, commitmentSnapshots }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, list] of ctx?.snapshots ?? []) qc.setQueryData(key, list)
      for (const [key, data] of ctx?.commitmentSnapshots ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => invalidateTaskData(qc),
  })
}

export type TaskCreate = TaskPatch & { title: string; workspace_id?: string; parent_id?: string | null }

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TaskCreate) => api<Task>('/tasks', { method: 'POST', body: input }),
    onSettled: () => invalidateTaskData(qc),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}`, { method: 'DELETE' }),
    onSettled: () => invalidateTaskData(qc),
  })
}

export function useCreateWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { key: string; name: string; description: string }) =>
      api<Workspace>('/workspaces', { method: 'POST', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      qc.invalidateQueries({ queryKey: ['me'] }) // the creator is now its editor
    },
  })
}

export function useDeleteWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/workspaces/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTaskData(qc),
  })
}

/** Assignee/type filters shared by board, gantt and calendar via the URL. */
export function useTaskFilters() {
  const [params, setParams] = useSearchParams()
  const assignee = params.get('assignee') ?? ''
  const type = (params.get('type') ?? '') as TaskType | ''
  const set = (key: 'assignee' | 'type', value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value)
        else p.delete(key)
        return p
      },
      { replace: true },
    )
  return { assignee, type, setAssignee: (v: string) => set('assignee', v), setType: (v: string) => set('type', v) }
}

// --- user management (Keycloak admin API, admins only) ---

export const useAdminUsers = (search: string, first: number, max: number) =>
  useQuery({
    queryKey: ['admin-users', search, first, max],
    queryFn: () => api<{ users: AdminUser[]; total: number }>('/admin/users', { query: { search, first, max } }),
    placeholderData: (prev) => prev,
    retry: false,
  })

function invalidateUsers(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['admin-users'] })
  qc.invalidateQueries({ queryKey: ['users'] })
}

export function useSaveAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AdminUserInput }) =>
      id
        ? api<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: input })
        : api<AdminUser>('/admin/users', { method: 'POST', body: input }),
    onSettled: () => invalidateUsers(qc),
  })
}

// --- workspace access (admins) ---

export interface UserAccess {
  workspaces: MemberAccess[]
  default_role: 'viewer' | 'none'
}

export const useUserAccess = (keycloakId?: string) =>
  useQuery({ queryKey: ['user-access', keycloakId], queryFn: () => api<UserAccess>(`/admin/users/${keycloakId}/access`), enabled: !!keycloakId })

/** Saves a user's role per workspace id. */
export const saveUserAccess = (keycloakId: string, roles: Record<string, MemberRole>) =>
  api<UserAccess>(`/admin/users/${keycloakId}/access`, { method: 'PUT', body: roles })

export function useDeleteAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      invalidateUsers(qc)
      qc.invalidateQueries({ queryKey: ['removed-users'] })
    },
  })
}

// --- comments ---

export const useComments = (taskId: string) =>
  useQuery({ queryKey: ['comments', taskId], queryFn: () => api<Comment[]>(`/tasks/${taskId}/comments`) })

function invalidateComments(qc: QueryClient, taskId: string) {
  qc.invalidateQueries({ queryKey: ['comments', taskId] })
  qc.invalidateQueries({ queryKey: ['tasks'] }) // comment counts on cards
}

export function useCommentMutations(taskId: string) {
  const qc = useQueryClient()
  const onSettled = () => invalidateComments(qc, taskId)
  return {
    create: useMutation({
      mutationFn: (body: string) => api<Comment>(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } }),
      onSettled,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: string }) => api<Comment>(`/comments/${id}`, { method: 'PATCH', body: { body } }),
      onSettled,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/comments/${id}`, { method: 'DELETE' }),
      onSettled,
    }),
  }
}

// --- runbooks ---

export const useRunbook = (taskId?: string) =>
  useQuery({ queryKey: ['runbook', taskId], queryFn: () => api<RunbookSection[]>(`/tasks/${taskId}/runbook`), enabled: !!taskId })

export const useRunbookTemplates = (workspaceId?: string) =>
  useQuery({ queryKey: ['runbook-templates', workspaceId], queryFn: () => api<RunbookTemplate[]>(`/workspaces/${workspaceId}/runbook-templates`), enabled: !!workspaceId })

export interface StepInput {
  title?: string
  notes?: string
  start_at?: string | null
  duration_minutes?: number | null
  done?: boolean
  /** On add: track the step as a daily task on this day (YYYY-MM-DD, '' = no date yet). */
  task?: { day: string; tz: string }
}

/** The browser's time zone, so daily tasks land on the user's day. */
export const userTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Every runbook change refreshes the runbook and the task's progress counts. */
export function useRunbookMutations(taskId: string, workspaceId: string) {
  const qc = useQueryClient()
  // Steps can create and complete daily tasks, so refresh task data too.
  const onSettled = () => invalidateTaskData(qc)
  const m = <V,>(fn: (v: V) => Promise<unknown>) => useMutation({ mutationFn: fn, onSettled })
  return {
    addSection: m((name: string) => api(`/tasks/${taskId}/runbook/sections`, { method: 'POST', body: { name } })),
    updateSection: m(({ id, ...patch }: { id: string; name?: string; notes?: string }) => api(`/runbook/sections/${id}`, { method: 'PATCH', body: patch })),
    deleteSection: m((id: string) => api(`/runbook/sections/${id}`, { method: 'DELETE' })),
    orderSections: m((ids: string[]) => api(`/tasks/${taskId}/runbook/order`, { method: 'PUT', body: { section_ids: ids } })),
    addStep: m(({ sectionId, input }: { sectionId: string; input: StepInput }) =>
      api<RunbookStep>(`/runbook/sections/${sectionId}/steps`, { method: 'POST', body: input }),
    ),
    // Ticking shows at once; the server's answer (or a failure) settles it.
    updateStep: useMutation({
      mutationFn: ({ id, input }: { id: string; input: StepInput }) => api<RunbookStep>(`/runbook/steps/${id}`, { method: 'PATCH', body: input }),
      onMutate: async ({ id, input }) => {
        await qc.cancelQueries({ queryKey: ['runbook', taskId] })
        const prev = qc.getQueryData<RunbookSection[]>(['runbook', taskId])
        if (prev)
          qc.setQueryData<RunbookSection[]>(
            ['runbook', taskId],
            prev.map((sec) => ({ ...sec, steps: sec.steps.map((st) => (st.id === id ? { ...st, ...input } as RunbookStep : st)) })),
          )
        return { prev }
      },
      onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['runbook', taskId], ctx.prev),
      onSettled,
    }),
    deleteStep: m((id: string) => api(`/runbook/steps/${id}`, { method: 'DELETE' })),
    makeTask: m(({ id, day }: { id: string; day: string }) => api(`/runbook/steps/${id}/task`, { method: 'POST', body: { day, tz: userTimeZone() } })),
    unlinkTask: m((id: string) => api(`/runbook/steps/${id}/task`, { method: 'DELETE' })),
    applyTemplate: m((templateId: string) =>
      api(`/tasks/${taskId}/runbook/apply-template`, { method: 'POST', body: { template_id: templateId, tz: userTimeZone() } }),
    ),
    saveTemplate: useMutation({
      mutationFn: (name: string) => api<RunbookTemplate>(`/tasks/${taskId}/runbook/save-template`, { method: 'POST', body: { name } }),
      onSettled: () => qc.invalidateQueries({ queryKey: ['runbook-templates', workspaceId] }),
    }),
    deleteTemplate: useMutation({
      mutationFn: (id: string) => api(`/runbook-templates/${id}`, { method: 'DELETE' }),
      onSettled: () => qc.invalidateQueries({ queryKey: ['runbook-templates', workspaceId] }),
    }),
  }
}

// --- dependencies ---

/** A dependency: `taskId` waits for `dependsOnId`. */
export interface DependencyLink {
  taskId: string
  dependsOnId: string
}

export function useDependencyMutations() {
  const qc = useQueryClient()
  const onSettled = () => invalidateTaskData(qc)
  return {
    add: useMutation({
      mutationFn: ({ taskId, dependsOnId }: DependencyLink) => api(`/tasks/${taskId}/dependencies`, { method: 'POST', body: { depends_on_id: dependsOnId } }),
      onSettled,
    }),
    remove: useMutation({
      mutationFn: ({ taskId, dependsOnId }: DependencyLink) => api(`/tasks/${taskId}/dependencies/${dependsOnId}`, { method: 'DELETE' }),
      onSettled,
    }),
  }
}

// --- project environments ---

export const useEnvironments = (projectId: string | undefined) =>
  useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => api<Environment[]>(`/tasks/${projectId}/environments`),
    enabled: !!projectId,
  })

export const saveEnvironments = (projectId: string, list: EnvironmentDraft[]) =>
  api<Environment[]>(`/tasks/${projectId}/environments`, { method: 'PUT', body: list.map(({ id, name, color }) => ({ id, name, color })) })

export function useSetEnvironments(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (list: EnvironmentDraft[]) => saveEnvironments(projectId, list),
    onSuccess: (data) => qc.setQueryData(['environments', projectId], data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['environments', projectId] })
      invalidateTaskData(qc) // tasks may have lost a deleted environment
    },
  })
}

// --- Keycloak sync / removed users (admins) ---

export const useRemovedUsers = () =>
  useQuery({ queryKey: ['removed-users'], queryFn: () => api<RemovedUser[]>('/admin/users/removed'), retry: false })

function invalidatePeople(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['removed-users'] })
  qc.invalidateQueries({ queryKey: ['admin-users'] })
  qc.invalidateQueries({ queryKey: ['users'] })
  invalidateTaskData(qc) // assignments and workload change
}

export function useSyncUsers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<SyncResult>('/admin/users/sync', { method: 'POST' }),
    onSettled: () => invalidatePeople(qc),
  })
}

export function usePurgeUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteTasks }: { id: string; deleteTasks: boolean }) =>
      api<{ deleted_tasks: number; unassigned_tasks: number }>(`/admin/users/removed/${id}`, { method: 'DELETE', query: { delete_tasks: deleteTasks } }),
    onSettled: () => invalidatePeople(qc),
  })
}

// --- workspace backup ---

/** Downloads a workspace backup as a .json file. */
export async function downloadWorkspaceBackup(id: string, key: string) {
  const doc = await api<WorkspaceBackup>(`/workspaces/${id}/export`)
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${key}-${doc.exported_at.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export const fetchBackupFromUrl = (url: string) => api<WorkspaceBackup>('/import/fetch', { method: 'POST', body: { url } })

export const importWorkspace = (doc: WorkspaceBackup, opts: { key: string; name: string; dryRun: boolean }) =>
  api<ImportResult>('/workspaces/import', { method: 'POST', body: doc, query: { key: opts.key, name: opts.name, dry_run: opts.dryRun } })

// --- project categories (per workspace) ---

export const useCategories = (workspaceId: string | undefined) =>
  useQuery({
    queryKey: ['categories', workspaceId],
    queryFn: () => api<ProjectCategory[]>(`/workspaces/${workspaceId}/categories`),
    enabled: !!workspaceId,
  })

export function useSetCategories(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (list: { id: string; name: string; color: string }[]) =>
      api<ProjectCategory[]>(`/workspaces/${workspaceId}/categories`, { method: 'PUT', body: list.map(({ id, name, color }) => ({ id, name, color })) }),
    onSuccess: (data) => qc.setQueryData(['categories', workspaceId], data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['categories', workspaceId] })
      invalidateTaskData(qc) // projects may have lost a removed category
    },
  })
}
