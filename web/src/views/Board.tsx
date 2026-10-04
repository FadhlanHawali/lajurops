import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { addDays, startOfDay } from 'date-fns'
import { FolderKanban, Hourglass, MessageSquare, Plus } from 'lucide-react'
import { ColumnSearch, ColumnToolButtons, useColumnViews } from '../components/ColumnTools'
import { DateFilter, EnvironmentFilter, inDateRange, ProjectFilter, thisWeek, type DateRangeFilter } from '../components/BoardFilters'
import { useTaskModal } from '../components/TaskModal'
import { EnvBadge } from '../components/Environments'
import ProjectBoard from './ProjectBoard'
import { AvatarStack, FilterBar, PriorityIcon, TypeBadge } from '../components/ui'
import { useAccess } from '../lib/access'
import { formatCreatedFull, formatCreatedShort, formatSchedule } from '../lib/dates'
import { useTaskFilters, useTasks, useUpdateTask } from '../lib/queries'
import { STATUSES, type Status, type Task } from '../lib/types'

/** Projects are grouped by category; daily/hourly work by status. */
export default function Board({ workspaceId }: { workspaceId: string }) {
  const { assignee, type } = useTaskFilters()
  return type === 'project' ? <ProjectBoard workspaceId={workspaceId} assignee={assignee} /> : <TaskBoard workspaceId={workspaceId} />
}

function TaskBoard({ workspaceId }: { workspaceId: string }) {
  const { assignee, type } = useTaskFilters()
  const [projectFilter, setProjectFilter] = useState('') // '' = all, 'none' = independent, else project id
  const [envFilter, setEnvFilter] = useState('') // environment name, matched across projects
  const [dates, setDates] = useState<DateRangeFilter>(thisWeek)
  // The server applies the date range (plus open undated tasks, as
  // inDateRange does) and adds each task's parents, so cards can show which
  // project they belong to. "All dates" loads the whole workspace.
  const { data: all = [], isLoading } = useTasks(
    dates
      ? {
          workspace_id: workspaceId,
          from: startOfDay(dates.from).toISOString(),
          to: addDays(startOfDay(dates.to), 1).toISOString(),
          undated: 'open',
          ancestors: true,
        }
      : { workspace_id: workspaceId },
    true,
    { keepPrevious: true },
  )
  // Every project, for the project filter (a small list).
  const { data: projects = [] } = useTasks({ workspace_id: workspaceId, type: 'project' })
  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all])
  const projectOf = (t: Task): Task | undefined => {
    for (let p = t.parent_id ? byId.get(t.parent_id) : undefined; p; p = p.parent_id ? byId.get(p.parent_id) : undefined) {
      if (p.type === 'project') return p
    }
  }
  // Environment names in use (e.g. "UAT"), de-duplicated across projects.
  const envNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of all) if (t.environment_name && !m.has(t.environment_name.toLowerCase())) m.set(t.environment_name.toLowerCase(), t.environment_name)
    return [...m.values()]
  }, [all])
  // Projects are containers; the board shows the daily/hourly work unless filtered for.
  const tasks = all.filter(
    (t) =>
      (type ? t.type === type : t.type !== 'project') &&
      (!assignee || t.assignee_ids.includes(assignee)) &&
      (!projectFilter || (projectFilter === 'none' ? !projectOf(t) : projectOf(t)?.id === projectFilter)) &&
      (!envFilter || (envFilter === 'none' ? !t.environment_name : t.environment_name?.toLowerCase() === envFilter)) &&
      inDateRange(t, dates),
  )
  const update = useUpdateTask()
  const modal = useTaskModal()
  const [drag, setDrag] = useState<{ id: string; status: Status; index: number } | null>(null)
  // Long columns render in pages of PAGE cards.
  const [shown, setShown] = useState<Partial<Record<Status, number>>>({})
  useEffect(() => setShown({}), [dates, projectFilter, envFilter, assignee, type])

  const columns = useMemo(() => {
    const cols = Object.fromEntries(STATUSES.map((s) => [s.id, [] as Task[]])) as Record<Status, Task[]>
    for (const t of tasks) cols[t.status].push(t)
    for (const s of STATUSES) cols[s.id].sort((a, b) => a.position - b.position || a.number - b.number)
    return cols
  }, [tasks])

  const viewOf = useColumnViews('status')
  const canEdit = useAccess().canEdit(workspaceId)
  // Drag-to-reorder only makes sense in manual order with nothing filtered out.
  const reorderable = (status: Status) => {
    const v = viewOf(status)
    return v.manual && !v.filtering
  }

  const drop = (status: Status, index: number, id: string) => {
    const task = tasks.find((t) => t.id === id)
    if (!task || (task.status === status && !reorderable(status))) return
    // Sorted/filtered columns can't be reordered: a task moved there goes to the end.
    if (!reorderable(status)) index = columns[status].length
    // index counts the dragged card itself; shift it once that card is taken out.
    const from = columns[status].findIndex((t) => t.id === id)
    const at = from >= 0 && from < index ? index - 1 : index
    const list = columns[status].filter((t) => t.id !== id)
    const before = list[at - 1]?.position
    const after = list[at]?.position
    const position =
      before === undefined && after === undefined ? 1 : before === undefined ? after! - 1 : after === undefined ? before + 1 : (before + after) / 2
    if (task.status === status && task.position === position) return
    update.mutate({ id, patch: status === task.status ? { position } : { status, position } })
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <FilterBar>
        <ProjectFilter value={projectFilter} onChange={setProjectFilter} projects={projects} />
        {envNames.length > 0 && <EnvironmentFilter value={envFilter} onChange={setEnvFilter} names={envNames} />}
        <DateFilter value={dates} onChange={setDates} />
      </FilterBar>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-x-auto md:grid-cols-4">
        {STATUSES.map((col) => {
          const view = viewOf(col.id)
          // Search and sort apply to every column, done included.
          const matching = view.apply(columns[col.id])
          const limit = shown[col.id] ?? PAGE
          const items = matching.slice(0, limit)
          const marker = reorderable(col.id)
          return (
            <div
              key={col.id}
              className={clsx('flex min-h-40 min-w-64 flex-col rounded-lg bg-slate-100 p-2', drag?.status === col.id && 'ring-2 ring-blue-400')}
              onDragOver={(e) => {
                e.preventDefault()
                if (drag && drag.status !== col.id && !(e.target as HTMLElement).closest('[data-card]')) setDrag({ ...drag, status: col.id, index: columns[col.id].length })
              }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/task-id')
                if (id && drag) drop(col.id, drag.status === col.id ? drag.index : columns[col.id].length, id)
                setDrag(null)
              }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {col.label}{' '}
                  <span className="ml-1 text-slate-400">{view.filtering ? `${matching.length} of ${columns[col.id].length}` : matching.length}</span>
                </span>
                <span className="flex items-center">
                  <ColumnToolButtons view={view} />
                  {canEdit && (
                    <button className="rounded p-1 text-slate-500 hover:bg-slate-200" title="Create task" onClick={() => modal.createTask({ title: '', workspace_id: workspaceId, status: col.id })}>
                      <Plus size={14} />
                    </button>
                  )}
                </span>
              </div>
              <ColumnSearch view={view} />
              <div className="flex-1 space-y-2 overflow-y-auto">
                {isLoading && <div className="h-16 animate-pulse rounded-md bg-white/70" />}
                {items.map((t, i) => (
                  <div key={t.id}>
                    {marker && drag?.status === col.id && drag.index === i && <DropMarker />}
                    <Card
                      task={t}
                      project={projectOf(t)}
                      parent={t.parent_id ? byId.get(t.parent_id) : undefined}
                      openBlockers={t.blocked_by.map((id) => byId.get(id)).filter((b): b is Task => !!b && b.status !== 'done')}
                      onOpen={() => modal.openTask(t.id)}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/task-id', t.id)
                        e.dataTransfer.effectAllowed = 'move'
                        // Re-render after the browser has started the drag, not during dragstart.
                        setTimeout(() => setDrag({ id: t.id, status: col.id, index: i }))
                      }}
                      onDragOver={(e) => {
                        if (!drag) return
                        const r = e.currentTarget.getBoundingClientRect()
                        const index = !reorderable(col.id) ? columns[col.id].length : e.clientY < r.top + r.height / 2 ? i : i + 1
                        if (drag.status !== col.id || drag.index !== index) setDrag({ ...drag, status: col.id, index })
                      }}
                      onDragEnd={() => setDrag(null)}
                    />
                  </div>
                ))}
                {marker && drag?.status === col.id && drag.index >= items.length && <DropMarker />}
                {matching.length > items.length && (
                  <button
                    type="button"
                    onClick={() => setShown((s) => ({ ...s, [col.id]: limit + PAGE }))}
                    className="w-full rounded-md border border-dashed border-slate-300 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:bg-white hover:text-slate-700"
                  >
                    Show {Math.min(PAGE, matching.length - items.length)} more ({matching.length - items.length} not shown)
                  </button>
                )}
                {!isLoading && view.filtering && items.length === 0 && <p className="px-1 py-6 text-center text-xs text-slate-400">No matching tasks</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Cards rendered per column before "Show more". */
const PAGE = 100

const DropMarker = () => <div className="my-1 h-1 rounded bg-blue-500" />

function Card({
  task: t,
  project,
  parent,
  openBlockers,
  onOpen,
  draggable,
  ...drag
}: {
  task: Task
  project?: Task
  parent?: Task
  openBlockers: Task[]
  onOpen: () => void
  draggable: boolean
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}) {
  return (
    <div
      data-card
      draggable={draggable}
      {...drag}
      onClick={onOpen}
      className="cursor-pointer rounded-md border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-blue-300 hover:shadow"
    >
      {openBlockers.length > 0 && t.status !== 'done' && (
        <p
          className="mb-1 flex items-center gap-1 truncate rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
          title={`Waiting for: ${openBlockers.map((b) => `${b.key} ${b.title}`).join(', ')}`}
        >
          <Hourglass size={11} className="shrink-0" /> Waiting for {openBlockers.map((b) => b.key).join(', ')}
        </p>
      )}
      {project && (
        <p
          className={clsx('mb-1 flex items-center gap-1 truncate text-[11px] font-medium', project.project_kind === 'short' ? 'text-orange-600' : 'text-amber-700')}
          title={`${project.project_kind === 'short' ? 'Short' : 'Long'} project ${project.key}: ${project.title}`}
        >
          <FolderKanban size={11} className="shrink-0" /> <span className="truncate">{project.title}</span>
          {parent && parent.id !== project.id && <span className="truncate text-slate-400">› {parent.key}</span>}
        </p>
      )}
      <p className={clsx('text-sm leading-snug text-slate-800', t.status === 'done' && 'text-slate-400 line-through')}>
        {t.environment_name && <EnvBadge name={t.environment_name} color={t.environment_color} size="xs" className="mr-1 align-[1px]" />}
        {t.title}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">{formatSchedule(t)}</p>
      <p className="text-[10px] text-slate-400" title={`Created ${formatCreatedFull(t.created_at)}`}>
        Created {formatCreatedShort(t.created_at)}
      </p>
      {t.subtask_count > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded bg-slate-100">
            <div className="h-full bg-emerald-500" style={{ width: `${(t.subtask_done / t.subtask_count) * 100}%` }} />
          </div>
          <span className="text-[11px] text-slate-500">
            {t.subtask_done}/{t.subtask_count}
          </span>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <TypeBadge type={t.type} kind={t.project_kind} />
        <span className="text-[11px] font-medium text-slate-500">{t.key}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {t.comment_count > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-slate-400" title={`${t.comment_count} comment(s)`}>
              <MessageSquare size={12} /> {t.comment_count}
            </span>
          )}
          <PriorityIcon priority={t.priority} />
          <AvatarStack ids={t.assignee_ids} />
        </span>
      </div>
    </div>
  )
}
