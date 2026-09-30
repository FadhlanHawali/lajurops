import { useMemo } from 'react'
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from './api'
import type { AdminUser, AdminUserInput, Comment, Me, Workspace, Task, TaskDetail, TaskType, User, Workload } from './types'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
})

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })

export function useUsers() {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') })
  const byId = useMemo(() => new Map((q.data ?? []).map((u) => [u.id, u])), [q.data])
  // Inactive users (disabled/deleted in Keycloak) stay resolvable by id for history.
  const active = useMemo(() => (q.data ?? []).filter((u) => u.active), [q.data])
  return { ...q, users: active, byId }
}

export const useWorkspaces = () => useQuery({ queryKey: ['workspaces'], queryFn: () => api<Workspace[]>('/workspaces') })

export const useWorkspace = (id: string | undefined) =>
  useQuery({ queryKey: ['workspaces', id], queryFn: () => api<Workspace>(`/workspaces/${id}`), enabled: !!id })

export interface TaskQuery {
  workspace_id?: string
  assignee_id?: string
  type?: string
  top_level?: boolean
  from?: string
  to?: string
}

export const useTasks = (query: TaskQuery, enabled = true) =>
  useQuery({
    queryKey: ['tasks', query],
    queryFn: () => api<Task[]>('/tasks', { query: { ...query } }),
    enabled,
  })

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

function invalidateTaskData(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['tasks'] })
  qc.invalidateQueries({ queryKey: ['task'] })
  qc.invalidateQueries({ queryKey: ['workspaces'] })
  qc.invalidateQueries({ queryKey: ['workload'] })
  qc.invalidateQueries({ queryKey: ['workload-tasks'] })
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'parent_id'
    | 'description'
    | 'type'
    | 'status'
    | 'priority'
    | 'assignee_id'
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
      const snapshots = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      for (const [key, list] of snapshots) {
        if (list) qc.setQueryData(key, list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
      }
      return { snapshots }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, list] of ctx?.snapshots ?? []) qc.setQueryData(key, list)
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
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

export function useDeleteAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}`, { method: 'DELETE' }),
    onSettled: () => invalidateUsers(qc),
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
