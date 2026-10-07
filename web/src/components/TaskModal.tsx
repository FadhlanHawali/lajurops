import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { addHours, differenceInMinutes, setHours, startOfDay } from 'date-fns'
import { ArrowLeft, CalendarX, CheckCircle2, ChevronRight, CircleDot, Eye, Flag, Hourglass, Loader2, Plus, Tags, Trash2, X } from 'lucide-react'
import { ReadOnlyContext, useAccess, useReadOnly } from '../lib/access'
import { dotStyle } from '../lib/colors'
import { formatCreatedFull, fromInput, toInput } from '../lib/dates'
import { saveEnvironments, useProjectProgress, useUsers, useCategories, useCreateTask, useEnvironments, useDeleteTask, useTask, useTasks, useUpdateTask, useWorkspaces, type TaskCreate, type TaskPatch } from '../lib/queries'
import { canContain, defaultChildType, PRIORITIES, PROJECT_KINDS, STATUSES, TASK_TYPES, type Priority, type ProjectKind, type Status, type EnvironmentDraft, type Task, type TaskType } from '../lib/types'
import { Comments } from './Comments'
import { DateRangeField, HourlyScheduleField } from './DateTimePicker'
import { ParentPicker } from './ParentPicker'
import { ProjectProgress } from './ProjectProgress'
import { Dependencies } from './Dependencies'
import { EnvBadge, EnvironmentListEditor, EnvironmentPicker, ProjectEnvironments } from './Environments'
import { SearchSelect } from './SearchSelect'
import { MultiUserPicker } from './UserPicker'
import { AvatarStack, Button, Field, inputCls, PriorityIcon, StatusPill, TypeBadge, userName } from './ui'

type Entry = { key: number; mode: 'edit'; id: string } | { key: number; mode: 'create'; defaults: TaskCreate }

const Ctx = createContext<{ openTask: (id: string) => void; createTask: (defaults: TaskCreate) => void }>({
  openTask: () => {},
  createTask: () => {},
})

export const useTaskModal = () => useContext(Ctx)

/**
 * Task dialogs form a stack: opening a task from inside another (e.g. a daily
 * task from its project) stacks it on top, and Save/Cancel/Escape return to
 * the one below. Lower dialogs stay mounted (hidden) so their unsaved edits
 * and scroll position survive.
 */
export function TaskModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([])
  const nextKey = useRef(1)
  const overlay = useRef<HTMLDivElement>(null)
  const scrolls = useRef(new Map<number, number>())
  const top = stack[stack.length - 1]

  const rememberScroll = () => {
    if (top && overlay.current) scrolls.current.set(top.key, overlay.current.scrollTop)
  }
  const entry = (e: { mode: 'edit'; id: string } | { mode: 'create'; defaults: TaskCreate }): Entry => ({ ...e, key: nextKey.current++ }) as Entry

  const closeAll = () => setStack([])
  const back = () => setStack((s) => s.slice(0, -1))
  // From inside a dialog: jump back if the task is already open below, else stack it.
  const openWithin = (id: string) => {
    rememberScroll()
    setStack((s) => {
      const i = s.findIndex((e) => e.mode === 'edit' && e.id === id)
      return i >= 0 ? s.slice(0, i + 1) : [...s, entry({ mode: 'edit', id })]
    })
  }
  const replaceTop = (id: string) => setStack((s) => [...s.slice(0, -1), entry({ mode: 'edit', id })])

  // Restore the scroll position of whichever dialog is now on top.
  useLayoutEffect(() => {
    if (top && overlay.current) overlay.current.scrollTop = scrolls.current.get(top.key) ?? 0
  }, [top?.key])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && back()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Ctx.Provider
      value={{
        openTask: (id) => setStack([entry({ mode: 'edit', id })]),
        createTask: (defaults) => setStack([entry({ mode: 'create', defaults })]),
      }}
    >
      {children}
      {stack.length > 0 && (
        <div ref={overlay} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onMouseDown={closeAll}>
          <div className="w-full max-w-4xl" onMouseDown={(e) => e.stopPropagation()}>
            {stack.map((e, i) => {
              const below = stack[i - 1]
              const backId = below?.mode === 'edit' ? below.id : undefined
              return (
                <div key={e.key} className={clsx('rounded-xl bg-white shadow-2xl', i !== stack.length - 1 && 'hidden')}>
                  {e.mode === 'edit' ? (
                    <EditTask id={e.id} onClose={back} onCloseAll={closeAll} onOpen={openWithin} backId={backId} />
                  ) : (
                    <TaskForm initial={e.defaults} onClose={back} onCloseAll={closeAll} onSaved={(t) => replaceTop(t.id)} backId={backId} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

function EditTask({
  id,
  onClose,
  onCloseAll,
  onOpen,
  backId,
}: {
  id: string
  onClose: () => void
  onCloseAll: () => void
  onOpen: (id: string) => void
  backId?: string
}) {
  const { data, isLoading, error } = useTask(id)
  if (isLoading)
    return (
      <div className="flex h-60 items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    )
  if (error || !data) return <div className="p-8 text-red-600">Could not load task: {String(error)}</div>
  return (
    <TaskForm
      key={data.updated_at}
      task={data}
      children_={data.subtasks}
      ancestors={data.ancestors}
      waitingFor={data.waiting_for}
      blocking={data.blocking}
      onClose={onClose}
      onCloseAll={onCloseAll}
      onOpen={onOpen}
      backId={backId}
    />
  )
}

interface FormState {
  title: string
  description: string
  type: TaskType
  project_kind: ProjectKind
  project_category_id: string
  environment_id: string
  parent_id: string
  status: Status
  priority: Priority
  assignee_ids: string[]
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
    project_kind: t.project_kind ?? 'short',
    project_category_id: t.project_category_id ?? '',
    environment_id: t.environment_id ?? '',
    parent_id: t.parent_id ?? '',
    status: t.status ?? 'todo',
    priority: t.priority ?? 'medium',
    assignee_ids: t.assignee_ids ?? [],
    start: toInput(t.start_at ?? null, type),
    end: toInput(t.end_at ?? null, type, true),
    estimate_hours: t.estimate_hours?.toString() ?? '',
    actual_hours: t.actual_hours?.toString() ?? '',
    progress: t.progress ?? 0,
  }
}

/** Converts the schedule inputs when switching between hourly and date-based types. */
function switchType(f: FormState, type: TaskType): FormState {
  if (type === f.type) return f
  const wasHourly = f.type === 'hourly'
  const isHourly = type === 'hourly'
  if (wasHourly === isHourly) return { ...f, type } // project <-> daily share date inputs
  const start = fromInput(f.start, f.type)
  const end = fromInput(f.end, f.type, true)
  if (!start) return { ...f, type, start: '', end: '' }
  if (isHourly) {
    const s = setHours(startOfDay(new Date(start)), 9)
    return { ...f, type, start: toInput(s.toISOString(), 'hourly'), end: toInput(addHours(s, 2).toISOString(), 'hourly') }
  }
  const s = startOfDay(new Date(start)).toISOString()
  // An hourly end at exactly midnight belongs to the previous day.
  const e = end ? new Date(new Date(end).getTime() - 1) : new Date(start)
  return { ...f, type, start: toInput(s, type), end: toInput(new Date(startOfDay(e).getTime() + 86_400_000).toISOString(), type, true) }
}

function TaskForm({
  task,
  initial,
  children_: childTasks = [],
  ancestors = [],
  waitingFor = [],
  blocking = [],
  onClose,
  onCloseAll,
  onOpen,
  onSaved,
  backId,
}: {
  task?: Task
  initial?: TaskCreate
  children_?: Task[]
  ancestors?: Task[]
  waitingFor?: Task[]
  blocking?: Task[]
  /** Leave this dialog (back to the one below, if any). */
  onClose: () => void
  /** Close every stacked dialog. */
  onCloseAll?: () => void
  onOpen?: (id: string) => void
  onSaved?: (t: Task) => void
  /** Task of the dialog below this one, for the "Back to" button. */
  backId?: string
}) {
  const [f, setF] = useState<FormState>(() => initialForm(task ?? initial ?? { title: '' }))
  const [err, setErr] = useState('')
  const [workspaceId, setWorkspaceId] = useState(task?.workspace_id ?? initial?.workspace_id ?? '')
  const access = useAccess()
  // New tasks can only go where the user is an editor.
  const { data: allWorkspaces = [] } = useWorkspaces()
  const workspaces = allWorkspaces.filter((w) => access.canEdit(w.id))
  const needsWorkspace = !task && !initial?.parent_id && !initial?.workspace_id
  // Viewers see the task but can't change it (the server refuses too).
  const readOnly = !!task && access.loaded && !access.canEdit(task.workspace_id)
  const update = useUpdateTask()
  const create = useCreateTask()
  const del = useDeleteTask()
  const up = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))

  // Possible parents: project and daily tasks in the same workspace.
  const { data: containers = [] } = useTasks({ workspace_id: workspaceId, type: 'project,daily' }, !!workspaceId)

  // The project this task sits under (directly or via its daily parent);
  // environments come from it.
  const rootProjectId = useMemo(() => {
    const known = new Map([...ancestors, ...containers].map((c) => [c.id, c]))
    let id = f.parent_id
    for (let i = 0; i < 3 && id; i++) {
      const c = known.get(id)
      if (!c) return undefined
      if (c.type === 'project') return c.id
      id = c.parent_id ?? ''
    }
    return undefined
  }, [f.parent_id, containers, ancestors])
  // Moving to another project drops an environment that belonged to the old one.
  const prevRoot = useRef(rootProjectId)
  useEffect(() => {
    if (prevRoot.current && rootProjectId !== prevRoot.current) setF((s) => ({ ...s, environment_id: '' }))
    if (rootProjectId || !f.parent_id) prevRoot.current = rootProjectId
  }, [rootProjectId, f.parent_id])
  const [envDrafts, setEnvDrafts] = useState<EnvironmentDraft[]>([])
  const { data: categories = [] } = useCategories(workspaceId || undefined)
  // Done/total of a project's daily/hourly tasks (children and grandchildren), counted by the server.
  const { byId: progress } = useProjectProgress(task?.type === 'project' ? workspaceId : undefined)
  const projectCounts = (task && progress.get(task.id)) ?? { done: 0, total: 0 }
  const parent = containers.find((c) => c.id === f.parent_id) ?? ancestors[ancestors.length - 1]
  // A type is allowed if the parent can hold it and it can hold the existing children.
  const typeAllowed = (t: TaskType) =>
    (!f.parent_id || !parent || canContain(parent.type, t)) && childTasks.every((c) => canContain(t, c.type))

  const startIso = fromInput(f.start, f.type)
  const endIso = fromInput(f.end, f.type, true)
  const durationMin = startIso && endIso ? differenceInMinutes(new Date(endIso), new Date(startIso)) : 0
  const dateBased = f.type !== 'hourly'

  const save = async () => {
    setErr('')
    if (!f.title.trim()) return setErr('Title is required')
    if (needsWorkspace && !workspaceId) return setErr('Choose a workspace')
    if (startIso && endIso && durationMin < 0) return setErr('End must be after start')
    const num = (s: string) => (s.trim() === '' ? null : Number(s))
    const patch: TaskPatch = {
      title: f.title.trim(),
      description: f.description,
      type: f.type,
      ...(f.type === 'project' ? { project_kind: f.project_kind } : { environment_id: f.environment_id || null }),
      parent_id: f.parent_id || null,
      // A project's status and progress come from its tasks.
      ...(f.type === 'project' ? { project_category_id: f.project_category_id || null } : { status: f.status, progress: f.progress }),
      priority: f.priority,
      assignee_ids: f.assignee_ids,
      start_at: startIso,
      end_at: endIso ?? (startIso && dateBased ? fromInput(f.start, f.type, true) : null),
      estimate_hours: num(f.estimate_hours),
      actual_hours: num(f.actual_hours),
    }
    try {
      if (task) {
        await update.mutateAsync({ id: task.id, patch })
        onClose()
      } else {
        const t = await create.mutateAsync({ ...initial, ...patch, title: patch.title!, workspace_id: workspaceId || undefined })
        if (t.type === 'project' && envDrafts.length) await saveEnvironments(t.id, envDrafts)
        onSaved?.(t)
      }
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const remove = async () => {
    if (!task) return
    const extra = task.subtask_count ? ` and the ${task.subtask_count} task(s) inside it` : ''
    if (!confirm(`Delete ${task.key}${extra}?`)) return
    await del.mutateAsync(task.id)
    const p = ancestors[ancestors.length - 1]
    if (!backId && p && onOpen) onOpen(p.id)
    else onClose()
  }

  const busy = update.isPending || create.isPending
  const typeInfo = TASK_TYPES.find((t) => t.id === f.type)!

  return (
    <ReadOnlyContext.Provider value={readOnly}>
    <div
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !readOnly) save()
      }}
    >
      {backId && <BackBar id={backId} onBack={onClose} />}
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-5 py-3 text-sm text-slate-500">
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1.5">
            <button className="font-medium text-blue-600 hover:underline" title={a.title} onClick={() => onOpen?.(a.id)}>
              {a.key}
            </button>
            <ChevronRight size={14} />
          </span>
        ))}
        <span className="font-medium text-slate-700">{task ? task.key : `New ${typeInfo.label.toLowerCase()} task`}</span>
        {task && <TypeBadge type={task.type} kind={task.project_kind} />}
        {task && <StatusPill status={task.status} />}
        {task && <CreatedNote task={task} />}
        <div className="ml-auto flex items-center gap-1">
          {readOnly && (
            <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600" title="You have viewer access to this workspace">
              <Eye size={12} /> View only
            </span>
          )}
          {task && !readOnly && (
            <Button variant="ghost" onClick={remove} title="Delete task">
              <Trash2 size={16} />
            </Button>
          )}
          <Button variant="ghost" onClick={onCloseAll ?? onClose} title={backId ? 'Close all' : 'Close (Esc)'}>
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 p-5 md:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-4">
          <fieldset disabled={readOnly} className="min-w-0 space-y-4">
          <input
            autoFocus={!task}
            className="w-full rounded-md border border-transparent px-2 py-1 text-xl font-semibold hover:border-slate-200 focus:border-blue-500 focus:outline-none"
            placeholder={f.type === 'project' ? 'Project name' : 'What needs to be done?'}
            value={f.title}
            onChange={(e) => up('title', e.target.value)}
          />
          <Field label="Description">
            <textarea className={clsx(inputCls, 'min-h-32')} value={f.description} onChange={(e) => up('description', e.target.value)} placeholder={readOnly ? 'No description' : 'Add details, links, runbook steps…'} />
          </Field>
          </fieldset>

          {task?.type === 'project' && <ProjectEnvironments projectId={task.id} />}
          {!task && f.type === 'project' && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Environments</h3>
              <EnvironmentListEditor items={envDrafts} onChange={setEnvDrafts} />
            </section>
          )}
          {task && task.type !== 'project' && <Dependencies task={task} waitingFor={waitingFor} blocking={blocking} onOpen={onOpen!} />}
          {task && task.type !== 'hourly' && <ChildTasks parent={task} items={childTasks} onOpen={onOpen!} />}
          {task && (
            <div className="border-t border-slate-100 pt-4">
              <Comments taskId={task.id} />
            </div>
          )}
          {!task && f.type !== 'hourly' && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
              After creating this {typeInfo.label.toLowerCase()} task you can add {f.type === 'project' ? 'daily and hourly' : 'hourly'} tasks inside it.
            </p>
          )}
        </div>

        <fieldset disabled={readOnly} className="min-w-0 space-y-3">
          {needsWorkspace && (
            <Field label="Workspace">
              <select className={inputCls} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                <option value="">Choose a workspace…</option>
                {workspaces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} · {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Type">
            <div className="grid grid-cols-3 overflow-hidden rounded-md border border-slate-300 text-sm">
              {TASK_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={!typeAllowed(t.id)}
                  title={typeAllowed(t.id) ? t.hint : `Not allowed here: ${f.parent_id ? 'the parent' : 'a task inside'} would break Project > Daily > Hourly`}
                  onClick={() => setF((s) => switchType(s, t.id))}
                  className={clsx('px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-40', f.type === t.id ? 'bg-slate-800 text-white' : 'bg-white hover:bg-slate-50')}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {f.type !== 'project' && <p className="mt-1 text-[11px] text-slate-400">{typeInfo.hint}</p>}
          </Field>
          {f.type === 'project' && <ProjectKindField value={f.project_kind} onChange={(k) => up('project_kind', k)} days={durationMin / 1440} />}
          {f.type !== 'project' && (
            <Field label={f.type === 'daily' ? 'Part of project' : 'Part of project / daily task'}>
              <ParentPicker
                value={f.parent_id}
                onChange={(id) => up('parent_id', id)}
                childType={f.type}
                containers={parent && !containers.some((c) => c.id === parent.id) ? [...containers, parent] : containers}
                excludeId={task?.id}
                disabled={!workspaceId}
              />
            </Field>
          )}
          {f.type !== 'project' && (
            <Field label="Environment">
              <EnvironmentPicker projectId={rootProjectId} value={f.environment_id} onChange={(id) => up('environment_id', id)} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            {f.type === 'project' ? (
              <Field label="Category">
                <SearchSelect
                  variant="field"
                  value={f.project_category_id}
                  onChange={(v) => up('project_category_id', v)}
                  icon={Tags}
                  placeholder="Uncategorized"
                  noun="categories"
                  options={[
                    { id: '', label: 'Uncategorized', fixed: true },
                    ...categories.map((c) => {
                      const dot = <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={dotStyle(c.color)} />
                      return {
                        id: c.id,
                        label: c.name,
                        icon: dot,
                        row: (
                          <>
                            {dot}
                            <span className="min-w-0 flex-1 truncate text-slate-800">{c.name}</span>
                          </>
                        ),
                      }
                    }),
                  ]}
                />
              </Field>
            ) : (
              <Field label="Status">
                <SearchSelect
                  variant="field"
                  search={false}
                  value={f.status}
                  onChange={(v) => up('status', v as Status)}
                  icon={CircleDot}
                  placeholder="Status"
                  noun="statuses"
                  options={STATUSES.map((st) => ({ id: st.id, label: st.label, icon: <StatusDot status={st.id} />, row: <StatusPill status={st.id} /> }))}
                />
              </Field>
            )}
            <Field label="Priority">
              <SearchSelect
                variant="field"
                search={false}
                value={f.priority}
                onChange={(v) => up('priority', v as Priority)}
                icon={Flag}
                placeholder="Priority"
                noun="priorities"
                options={PRIORITIES.map((p) => {
                  const label = p[0].toUpperCase() + p.slice(1)
                  return {
                    id: p,
                    label,
                    icon: <PriorityIcon priority={p} />,
                    row: (
                      <>
                        <PriorityIcon priority={p} />
                        <span className="flex-1 text-slate-800">{label}</span>
                      </>
                    ),
                  }
                })}
              />
            </Field>
          </div>
          <Field label={f.type === 'project' ? 'Owners' : 'Assignees'}>
            <MultiUserPicker value={f.assignee_ids} onChange={(ids) => up('assignee_ids', ids)} />
          </Field>
          {f.type === 'project' ? (
            <Field label="Timeline">
              <DateRangeField start={f.start} end={f.end} onChange={(start, end) => setF((s) => ({ ...s, start, end }))} placeholder="Not scheduled" />
            </Field>
          ) : (
            <div>
              {/* Daily/hourly work can be left "to be arranged": no dates until someone plans it. */}
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">{dateBased ? 'Start → due date' : 'Schedule'}</span>
                {f.start || f.end ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    title="Remove the dates; the task stays unscheduled until someone plans it"
                    onClick={() => setF((s) => ({ ...s, start: '', end: '' }))}
                  >
                    <CalendarX size={12} /> To be arranged
                  </button>
                ) : (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700" title="No dates yet; pick some to schedule it">
                    To be arranged
                  </span>
                )}
              </div>
              {dateBased ? (
                <DateRangeField start={f.start} end={f.end} onChange={(start, end) => setF((s) => ({ ...s, start, end }))} placeholder="To be arranged · pick dates" />
              ) : (
                <HourlyScheduleField start={f.start} end={f.end} onChange={(start, end) => setF((s) => ({ ...s, start, end }))} />
              )}
            </div>
          )}
          {f.type !== 'project' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Estimate (h)">
                <input type="number" min={0} step={0.25} className={inputCls} value={f.estimate_hours} onChange={(e) => up('estimate_hours', e.target.value)} />
              </Field>
              <Field label="Actual (h)">
                <input type="number" min={0} step={0.25} className={inputCls} value={f.actual_hours} onChange={(e) => up('actual_hours', e.target.value)} placeholder={f.type === 'hourly' && durationMin > 0 ? String(+(durationMin / 60).toFixed(2)) : ''} />
              </Field>
            </div>
          )}
          {f.type === 'project' ? (
            task?.type === 'project' && (
              <Field label="Status & progress (from its tasks)">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <ProjectProgress project={task} done={projectCounts.done} total={projectCounts.total} />
                </div>
              </Field>
            )
          ) : (
            <Field label={`Progress · ${f.progress}%`}>
              <input type="range" min={0} max={100} step={5} className="w-full" value={f.progress} onChange={(e) => up('progress', Number(e.target.value))} />
            </Field>
          )}
        </fieldset>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
        <span className="text-sm text-red-600">{err}</span>
        {readOnly ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {task ? 'Save' : 'Create'}
            </Button>
          </div>
        )}
      </div>
    </div>
    </ReadOnlyContext.Provider>
  )
}

/**
 * Tasks inside a project (daily/hourly) or a daily task (hourly). In a
 * project with environments, tasks are grouped per environment in the
 * project's order; drag a task to another group to change its environment.
 */
function ChildTasks({ parent, items, onOpen }: { parent: Task; items: Task[]; onOpen: (id: string) => void }) {
  const { data: envs = [] } = useEnvironments(parent.type === 'project' ? parent.id : undefined)
  const update = useUpdateTask()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overGroup, setOverGroup] = useState<string | null>(null)
  const readOnly = useReadOnly()
  const done = items.filter((s) => s.status === 'done').length
  const grouped = parent.type === 'project' && envs.length > 0

  const header = (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{parent.type === 'project' ? 'Tasks in this project' : 'Hourly tasks'}</h3>
        {items.length > 0 && (
          <span className="text-xs text-slate-500">
            {done}/{items.length} done
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded bg-slate-100">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
    </>
  )

  if (!grouped) {
    return (
      <div>
        {header}
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          <RowsWithDoneCollapsed items={items} row={(s) => <ChildRow key={s.id} task={s} onOpen={onOpen} />} />
          {!readOnly && <AddChildRow parent={parent} environmentId={parent.type === 'daily' ? parent.environment_id : null} />}
        </ul>
      </div>
    )
  }

  const sections = [{ id: '', name: 'No environment', color: null }, ...envs]
  const drop = (envId: string) => {
    const task = items.find((t) => t.id === dragId)
    setDragId(null)
    setOverGroup(null)
    if (task && (task.environment_id ?? '') !== envId) update.mutate({ id: task.id, patch: { environment_id: envId || null } })
  }

  return (
    <div>
      {header}
      <div className="space-y-3">
        {sections.map((sec) => {
          const list = items.filter((t) => (t.environment_id ?? '') === sec.id)
          // "No environment" only shows when it has tasks, or while dragging.
          if (!sec.id && list.length === 0 && !dragId) return null
          const secDone = list.filter((t) => t.status === 'done').length
          return (
            <section
              key={sec.id || 'none'}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                setOverGroup(sec.id)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverGroup((g) => (g === sec.id ? null : g))
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop(sec.id)
              }}
            >
              <div className="mb-1 flex items-center gap-2">
                {sec.id ? <EnvBadge name={sec.name} color={sec.color} /> : <span className="text-xs font-semibold text-slate-500">No environment</span>}
                <span className="text-[11px] text-slate-400">
                  {list.length === 0 ? 'no tasks' : `${list.length} task${list.length === 1 ? '' : 's'} · ${secDone} done`}
                </span>
              </div>
              <ul
                className={clsx(
                  'divide-y divide-slate-100 rounded-md border transition',
                  overGroup === sec.id ? 'border-blue-400 bg-blue-50/50 ring-2 ring-blue-400/30' : 'border-slate-200',
                )}
              >
                <RowsWithDoneCollapsed
                  items={list}
                  row={(s) => (
                    <ChildRow
                      key={s.id}
                      task={s}
                      onOpen={onOpen}
                      dragging={dragId === s.id}
                      onDragStart={readOnly ? undefined : () => setDragId(s.id)}
                      onDragEnd={() => {
                        setDragId(null)
                        setOverGroup(null)
                      }}
                    />
                  )}
                />
                {!readOnly && <AddChildRow parent={parent} environmentId={sec.id || null} environmentName={sec.id ? sec.name : undefined} compact />}
              </ul>
            </section>
          )
        })}
      </div>
      {!readOnly && <p className="mt-2 text-[11px] text-slate-400">Drag a task to another environment to move it.</p>}
    </div>
  )
}

/** Open tasks first; finished ones fold into a "N done" row that expands on click. */
function RowsWithDoneCollapsed({ items, row }: { items: Task[]; row: (t: Task) => ReactNode }) {
  const [showDone, setShowDone] = useState(false)
  const open = items.filter((t) => t.status !== 'done')
  const done = items.filter((t) => t.status === 'done')
  return (
    <>
      {open.map(row)}
      {done.length > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="flex w-full items-center gap-1.5 bg-slate-50/70 px-2 py-1 text-left text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <ChevronRight size={13} className={clsx('transition-transform', showDone && 'rotate-90')} />
            <CheckCircle2 size={13} className="text-emerald-500" />
            {done.length} done
          </button>
        </li>
      )}
      {showDone && done.map(row)}
    </>
  )
}

function ChildRow({
  task: s,
  onOpen,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  task: Task
  onOpen: (id: string) => void
  dragging?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
}) {
  const update = useUpdateTask()
  const readOnly = useReadOnly()
  return (
    <li
      draggable={!!onDragStart}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', s.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      className={clsx('flex items-center gap-2 bg-white px-2 py-1.5 text-sm hover:bg-slate-50', onDragStart && 'cursor-grab active:cursor-grabbing', dragging && 'opacity-40')}
    >
      <input type="checkbox" disabled={readOnly} checked={s.status === 'done'} onChange={(e) => update.mutate({ id: s.id, patch: { status: e.target.checked ? 'done' : 'todo' } })} />
      <button className="text-xs font-medium text-blue-600 hover:underline" onClick={() => onOpen(s.id)}>
        {s.key}
      </button>
      <button className={clsx('min-w-0 flex-1 truncate text-left', s.status === 'done' && 'text-slate-400 line-through')} onClick={() => onOpen(s.id)}>
        {s.title}
      </button>
      {s.open_blockers > 0 && s.status !== 'done' && (
        <span title="Waiting for other tasks">
          <Hourglass size={12} className="text-amber-500" />
        </span>
      )}
      {s.subtask_count > 0 && (
        <span className="text-[11px] text-slate-400">
          {s.subtask_done}/{s.subtask_count}
        </span>
      )}
      <TypeBadge type={s.type} kind={s.project_kind} />
      <PriorityIcon priority={s.priority} />
      <AvatarStack ids={s.assignee_ids} />
    </li>
  )
}

/** Quick-add row; tasks added here get the given environment. */
function AddChildRow({ parent, environmentId, environmentName, compact }: { parent: Task; environmentId: string | null; environmentName?: string; compact?: boolean }) {
  const [open, setOpen] = useState(!compact)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<TaskType>(defaultChildType(parent.type))
  const inputRef = useRef<HTMLInputElement>(null)
  const create = useCreateTask()
  const allowed = useMemo(() => TASK_TYPES.filter((t) => canContain(parent.type, t.id)), [parent.type])

  const add = async () => {
    if (!title.trim()) return
    await create.mutateAsync({
      title: title.trim(),
      parent_id: parent.id,
      type,
      assignee_ids: [], // assign people explicitly; don't copy the parent's owners
      priority: parent.priority,
      environment_id: environmentId,
    })
    setTitle('')
  }

  if (!open) {
    return (
      <li>
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600">
          <Plus size={13} /> Add task{environmentName ? ` to ${environmentName}` : ''}
        </button>
      </li>
    )
  }
  return (
    <li
      className="flex items-center gap-2 px-2 py-1.5"
      // Collapse an empty compact row only when focus leaves the whole row,
      // so the type dropdown can be used.
      onBlur={(e) => compact && !title.trim() && !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}
    >
      <Plus size={14} className="text-slate-400" />
      {allowed.length > 1 && (
        <select
          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
          value={type}
          onChange={(e) => {
            setType(e.target.value as TaskType)
            inputRef.current?.focus()
          }}
        >
          {allowed.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}
      <input
        ref={inputRef}
        autoFocus={compact}
        className="flex-1 bg-transparent text-sm focus:outline-none"
        placeholder={`Add ${type === 'hourly' ? 'an' : 'a'} ${type} task${environmentName ? ` in ${environmentName}` : ''} and press Enter`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) add()
          if (e.key === 'Escape' && compact) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
    </li>
  )
}

const QUARTER_DAYS = 90
const MONTH_DAYS = 31

/** Long vs short project, with a nudge when the timeline doesn't fit the choice. */
function ProjectKindField({ value, onChange, days }: { value: ProjectKind; onChange: (k: ProjectKind) => void; days: number }) {
  const suggest: ProjectKind | null = value === 'short' && days > QUARTER_DAYS ? 'long' : value === 'long' && days > 0 && days < MONTH_DAYS ? 'short' : null
  return (
    <div className="-mt-1 space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        {PROJECT_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => onChange(k.id)}
            className={clsx(
              'rounded-md border px-2 py-1.5 text-left transition',
              value === k.id ? (k.id === 'long' ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500' : 'border-orange-400 bg-orange-50 ring-1 ring-orange-400') : 'border-slate-200 hover:border-slate-300',
            )}
          >
            <span className="block text-xs font-semibold text-slate-800">{k.label}</span>
            <span className="block text-[10px] leading-tight text-slate-500">{k.hint}</span>
          </button>
        ))}
      </div>
      {suggest && (
        <p className="text-[11px] text-amber-700">
          This timeline is {suggest === 'long' ? 'longer than a quarter' : 'shorter than a month'}.{' '}
          <button type="button" className="font-semibold underline" onClick={() => onChange(suggest)}>
            Make it a {suggest} project
          </button>
        </p>
      )}
    </div>
  )
}

/** "Back to <parent>" strip shown on a dialog opened from another one. */
function BackBar({ id, onBack }: { id: string; onBack: () => void }) {
  const { data } = useTask(id) // already cached by the dialog below
  return (
    <button
      type="button"
      onClick={onBack}
      title="Back (Esc)"
      className="flex w-full items-center gap-2 rounded-t-xl border-b border-slate-200 bg-slate-50 px-5 py-2 text-left text-sm text-slate-600 hover:bg-slate-100"
    >
      <ArrowLeft size={15} />
      <span>
        Back to{' '}
        {data ? (
          <>
            <span className="font-semibold text-slate-800">{data.key}</span> · {data.title}
          </>
        ) : (
          '…'
        )}
      </span>
      <kbd className="ml-auto rounded border border-slate-300 bg-white px-1.5 text-[10px] text-slate-500">Esc</kbd>
    </button>
  )
}

const STATUS_DOT: Record<Status, string> = { todo: 'bg-slate-400', in_progress: 'bg-blue-500', in_review: 'bg-amber-500', done: 'bg-emerald-500' }
const StatusDot = ({ status }: { status: Status }) => <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', STATUS_DOT[status])} />

/** "Created Mon, Sep 28, 2026 14:05 by Alice" in the dialog header. */
function CreatedNote({ task }: { task: Task }) {
  const { byId } = useUsers()
  const by = task.reporter_id ? byId.get(task.reporter_id) : undefined
  return (
    <span className="hidden truncate text-xs text-slate-400 sm:inline">
      Created {formatCreatedFull(task.created_at)}
      {by && ` by ${userName(by)}`}
    </span>
  )
}
