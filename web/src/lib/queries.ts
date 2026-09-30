import { useMemo } from 'react'
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from './api'
import type { Project, Task, TaskDetail, TaskType, User, Workload } from './types'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
})

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') })

export function useUsers() {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') })
  const byId = useMemo(() => new Map((q.data ?? []).map((u) => [u.id, u])), [q.data])
  return { ...q, users: q.data ?? [], byId }
}

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') })

export const useProject = (id: string | undefined) =>
  useQuery({ queryKey: ['projects', id], queryFn: () => api<Project>(`/projects/${id}`), enabled: !!id })

export interface TaskQuery {
  project_id?: string
  assignee_id?: string
  type?: TaskType | ''
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

export const useWorkload = (from: string, to: string, projectId: string) =>
  useQuery({
    queryKey: ['workload', from, to, projectId],
    queryFn: () => api<Workload[]>('/reports/workload', { query: { from, to, project_id: projectId } }),
  })

export const useWorkloadTasks = (userId: string | null, from: string, to: string, projectId: string) =>
  useQuery({
    queryKey: ['workload-tasks', userId, from, to, projectId],
    queryFn: () =>
      api<Task[]>(`/reports/workload/${userId}/tasks`, { query: { from, to, project_id: projectId } }),
    enabled: !!userId,
  })

function invalidateTaskData(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['tasks'] })
  qc.invalidateQueries({ queryKey: ['task'] })
  qc.invalidateQueries({ queryKey: ['projects'] })
  qc.invalidateQueries({ queryKey: ['workload'] })
  qc.invalidateQueries({ queryKey: ['workload-tasks'] })
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
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

export type TaskCreate = TaskPatch & { title: string; project_id?: string; parent_id?: string | null }

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

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { key: string; name: string; description: string }) =>
      api<Project>('/projects', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/projects/${id}`, { method: 'DELETE' }),
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
