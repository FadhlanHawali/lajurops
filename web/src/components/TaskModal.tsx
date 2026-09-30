import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { addHours, differenceInMinutes, setHours, startOfDay } from 'date-fns'
import { ChevronRight, Loader2, Plus, Trash2, X } from 'lucide-react'
import { fromInput, formatDuration, toInput } from '../lib/dates'
import { useCreateTask, useDeleteTask, useProjects, useTask, useUpdateTask, useUsers, type TaskCreate, type TaskPatch } from '../lib/queries'
import { PRIORITIES, STATUSES, type Priority, type Status, type Task, type TaskType } from '../lib/types'
import { Avatar, Button, Field, inputCls, PriorityIcon, StatusPill, TypeBadge, UserSelect } from './ui'

type ModalState = { mode: 'edit'; id: string } | { mode: 'create'; defaults: TaskCreate } | null

const Ctx = createContext<{ openTask: (id: string) => void; createTask: (defaults: TaskCreate) => void }>({
  openTask: () => {},
  createTask: () => {},
})

export const useTaskModal = () => useContext(Ctx)

export function TaskModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ModalState>(null)
  const close = () => setState(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Ctx.Provider
      value={{
        openTask: (id) => setState({ mode: 'edit', id }),
        createTask: (defaults) => setState({ mode: 'create', defaults }),
      }}
    >
      {children}
      {state && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onMouseDown={close}>
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            {state.mode === 'edit' ? (
              <EditTask key={state.id} id={state.id} onClose={close} onOpen={(id) => setState({ mode: 'edit', id })} />
            ) : (
              <TaskForm initial={state.defaults} onClose={close} onSaved={(t) => setState({ mode: 'edit', id: t.id })} />
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

function EditTask({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { data, isLoading, error } = useTask(id)
  if (isLoading)
    return (
      <div className="flex h-60 items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    )
  if (error || !data) return <div className="p-8 text-red-600">Could not load task: {String(error)}</div>
  return <TaskForm key={data.updated_at} task={data} subtasks={data.subtasks} parent={data.parent} onClose={onClose} onOpen={onOpen} />
}

interface FormState {
  title: string
  description: string
  type: TaskType
  status: Status
  priority: Priority
  assignee_id: string
  start: string
  end: string
  estimate_hours: string
  actual_hours: string
  progress: number
}

function initialForm(t: Partial<Task> | TaskCreate): FormState {
  const type = t.type ?? 'daily'
  return {
    title: t.title ?? '',
    description: t.description ?? '',
    type,
    status: t.status ?? 'todo',
    priority: t.priority ?? 'medium',
    assignee_id: t.assignee_id ?? '',
    start: toInput(t.start_at ?? null, type),
    end: toInput(t.end_at ?? null, type, true),
    estimate_hours: t.estimate_hours?.toString() ?? '',
    actual_hours: t.actual_hours?.toString() ?? '',
    progress: t.progress ?? 0,
  }
}

/** Converts the schedule inputs when the task type is switched. */
function switchType(f: FormState, type: TaskType): FormState {
  if (type === f.type) return f
  const start = fromInput(f.start, f.type)
  const end = fromInput(f.end, f.type, true)
  if (!start) return { ...f, type, start: '', end: '' }
  if (type === 'hourly') {
    const s = setHours(startOfDay(new Date(start)), 9)
    return { ...f, type, start: toInput(s.toISOString(), 'hourly'), end: toInput(addHours(s, 2).toISOString(), 'hourly') }
  }
  const s = startOfDay(new Date(start)).toISOString()
  // An hourly end at exactly midnight belongs to the previous day.
  const e = end ? new Date(new Date(end).getTime() - 1) : new Date(start)
  return { ...f, type, start: toInput(s, 'daily'), end: toInput(new Date(startOfDay(e).getTime() + 86_400_000).toISOString(), 'daily', true) }
}

function TaskForm({
  task,
  initial,
  subtasks,
  parent,
  onClose,
  onOpen,
  onSaved,
}: {
  task?: Task
  initial?: TaskCreate
  subtasks?: Task[]
  parent?: Task | null
  onClose: () => void
  onOpen?: (id: string) => void
  onSaved?: (t: Task) => void
}) {
  const [f, setF] = useState<FormState>(() => initialForm(task ?? initial ?? { title: '' }))
  const [err, setErr] = useState('')
  const [projectId, setProjectId] = useState(initial?.project_id ?? '')
  const { data: projects = [] } = useProjects()
  const needsProject = !task && !initial?.parent_id && !initial?.project_id
  const update = useUpdateTask()
  const create = useCreateTask()
  const del = useDeleteTask()
  const up = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))

  const startIso = fromInput(f.start, f.type)
  const endIso = fromInput(f.end, f.type, true)
  const durationMin = startIso && endIso ? differenceInMinutes(new Date(endIso), new Date(startIso)) : 0

  const save = async () => {
    setErr('')
    if (!f.title.trim()) return setErr('Title is required')
    if (needsProject && !projectId) return setErr('Choose a project')
    if (startIso && endIso && durationMin < 0) return setErr('End must be after start')
    const num = (s: string) => (s.trim() === '' ? null : Number(s))
    const patch: TaskPatch = {
      title: f.title.trim(),
      description: f.description,
      type: f.type,
      status: f.status,
      priority: f.priority,
      assignee_id: f.assignee_id || null,
      start_at: startIso,
      end_at: endIso ?? (startIso && f.type === 'daily' ? fromInput(f.start, 'daily', true) : null),
      estimate_hours: num(f.estimate_hours),
      actual_hours: num(f.actual_hours),
      progress: f.progress,
    }
    try {
      if (task) {
        await update.mutateAsync({ id: task.id, patch })
        onClose()
      } else {
        const t = await create.mutateAsync({ ...initial, ...patch, title: patch.title!, project_id: projectId || undefined })
        onSaved?.(t)
      }
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const remove = async () => {
    if (!task) return
    const extra = task.subtask_count ? ` and its ${task.subtask_count} subtask(s)` : ''
    if (!confirm(`Delete ${task.key}${extra}?`)) return
    await del.mutateAsync(task.id)
    if (parent && onOpen) onOpen(parent.id)
    else onClose()
  }

  const busy = update.isPending || create.isPending
  const isSubtask = !!(task?.parent_id || initial?.parent_id)

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
      }}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 text-sm text-slate-500">
        {parent && (
          <>
            <button className="font-medium text-blue-600 hover:underline" onClick={() => onOpen?.(parent.id)}>
              {parent.key}
            </button>
            <ChevronRight size={14} />
          </>
        )}
        <span className="font-medium text-slate-700">{task ? task.key : isSubtask ? 'New subtask' : 'New task'}</span>
        {task && <StatusPill status={task.status} />}
        <div className="ml-auto flex items-center gap-1">
          {task && (
            <Button variant="ghost" onClick={remove} title="Delete task">
              <Trash2 size={16} />
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 p-5 md:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-4">
          <input
            autoFocus={!task}
            className="w-full rounded-md border border-transparent px-2 py-1 text-xl font-semibold hover:border-slate-200 focus:border-blue-500 focus:outline-none"
            placeholder="What needs to be done?"
            value={f.title}
            onChange={(e) => up('title', e.target.value)}
          />
          <Field label="Description">
            <textarea className={clsx(inputCls, 'min-h-32')} value={f.description} onChange={(e) => up('description', e.target.value)} placeholder="Add details, links, runbook steps…" />
          </Field>

          {task && !task.parent_id && <Subtasks parent={task} subtasks={subtasks ?? []} onOpen={onOpen!} />}
        </div>

        <div className="space-y-3">
          {needsProject && (
            <Field label="Project">
              <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Choose a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} · {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Task type">
            <div className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-300 text-sm">
              {(['hourly', 'daily'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setF((s) => switchType(s, t))} className={clsx('px-2 py-1.5', f.type === t ? 'bg-slate-800 text-white' : 'bg-white hover:bg-slate-50')}>
                  {t === 'hourly' ? 'Hourly' : 'Daily'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{f.type === 'hourly' ? 'Support, deployment, implementation — scheduled by the hour.' : 'Requests & deliverables — scheduled by date.'}</p>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Status">
              <select className={inputCls} value={f.status} onChange={(e) => up('status', e.target.value as Status)}>
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputCls} value={f.priority} onChange={(e) => up('priority', e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Assignee">
            <UserSelect value={f.assignee_id} onChange={(v) => up('assignee_id', v)} />
          </Field>
          <Field label={f.type === 'hourly' ? 'Start' : 'Start date'}>
            <input type={f.type === 'hourly' ? 'datetime-local' : 'date'} className={inputCls} value={f.start} onChange={(e) => up('start', e.target.value)} />
          </Field>
          <Field label={f.type === 'hourly' ? 'End' : 'Due date'}>
            <input type={f.type === 'hourly' ? 'datetime-local' : 'date'} className={inputCls} value={f.end} min={f.start} onChange={(e) => up('end', e.target.value)} />
          </Field>
          {durationMin > 0 && <p className="-mt-1 text-xs text-slate-500">Duration: {formatDuration(durationMin)}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Estimate (h)">
              <input type="number" min={0} step={0.25} className={inputCls} value={f.estimate_hours} onChange={(e) => up('estimate_hours', e.target.value)} />
            </Field>
            <Field label="Actual (h)">
              <input type="number" min={0} step={0.25} className={inputCls} value={f.actual_hours} onChange={(e) => up('actual_hours', e.target.value)} placeholder={f.type === 'hourly' && durationMin > 0 ? String(+(durationMin / 60).toFixed(2)) : ''} />
            </Field>
          </div>
          <Field label={`Progress · ${f.progress}%`}>
            <input type="range" min={0} max={100} step={5} className="w-full" value={f.progress} onChange={(e) => up('progress', Number(e.target.value))} />
          </Field>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
        <span className="text-sm text-red-600">{err}</span>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {task ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Subtasks({ parent, subtasks, onOpen }: { parent: Task; subtasks: Task[]; onOpen: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const create = useCreateTask()
  const update = useUpdateTask()
  const { byId } = useUsers()
  const done = subtasks.filter((s) => s.status === 'done').length

  const add = async () => {
    if (!title.trim()) return
    await create.mutateAsync({
      title: title.trim(),
      parent_id: parent.id,
      type: parent.type,
      assignee_id: parent.assignee_id,
      priority: parent.priority,
    })
    setTitle('')
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Subtasks</h3>
        {subtasks.length > 0 && (
          <span className="text-xs text-slate-500">
            {done}/{subtasks.length} done
          </span>
        )}
      </div>
      {subtasks.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded bg-slate-100">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(done / subtasks.length) * 100}%` }} />
        </div>
      )}
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              checked={s.status === 'done'}
              onChange={(e) => update.mutate({ id: s.id, patch: { status: e.target.checked ? 'done' : 'todo' } })}
            />
            <button className="text-xs font-medium text-blue-600 hover:underline" onClick={() => onOpen(s.id)}>
              {s.key}
            </button>
            <button className={clsx('min-w-0 flex-1 truncate text-left', s.status === 'done' && 'text-slate-400 line-through')} onClick={() => onOpen(s.id)}>
              {s.title}
            </button>
            <TypeBadge type={s.type} />
            <PriorityIcon priority={s.priority} />
            <Avatar user={s.assignee_id ? byId.get(s.assignee_id) : null} />
          </li>
        ))}
        <li className="flex items-center gap-2 px-2 py-1.5">
          <Plus size={14} className="text-slate-400" />
          <input
            className="flex-1 bg-transparent text-sm focus:outline-none"
            placeholder="Add a subtask and press Enter"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          />
        </li>
      </ul>
    </div>
  )
}
