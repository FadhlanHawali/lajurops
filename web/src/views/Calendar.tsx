import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { addDays, addMonths, addWeeks, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { AgendaList } from '../components/calendar/AgendaList'
import { MonthGrid } from '../components/calendar/MonthGrid'
import { TimeGrid } from '../components/calendar/TimeGrid'
import { EnvBadge } from '../components/Environments'
import { INDEPENDENT, ProjectMultiFilter } from '../components/ProjectMultiFilter'
import { useTaskModal } from '../components/TaskModal'
import { useAccess } from '../lib/access'
import { groupAllDay, groupTimed, MAX_OVERLAP, type CalendarItem, type GroupKey, type TaskGroup } from '../lib/calendarGroups'
import { colorForId, pillStyle } from '../lib/colors'
import { formatSchedule } from '../lib/dates'
import { Button, FilterBar, StatusPill } from '../components/ui'
import { useTaskFilters, useTasks } from '../lib/queries'
import type { Task } from '../lib/types'

type View = 'month' | 'week' | 'day' | 'agenda'
const VIEWS: { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
  { id: 'agenda', label: 'Agenda' },
]

const GROUP_KEY = 'lajurops:calendar-group'
const VIEW_KEY = 'lajurops:calendar-view'
const load = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable: keep it for this page view only
  }
}

/** The visible range for a view: month shows six full weeks; agenda a week. */
function rangeOf(view: View, anchor: Date) {
  if (view === 'day') return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) }
  if (view === 'month') {
    const from = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
    return { from, to: addDays(from, 42) }
  }
  const from = startOfWeek(anchor, { weekStartsOn: 1 })
  return { from, to: addDays(from, 7) }
}

function titleOf(view: View, anchor: Date, from: Date, to: Date) {
  if (view === 'day') return format(anchor, 'EEEE, MMMM d, yyyy')
  if (view === 'month') return format(anchor, 'MMMM yyyy')
  const last = addDays(to, -1)
  return isSameMonth(from, last) ? `${format(from, 'MMM d')} – ${format(last, 'd, yyyy')}` : `${format(from, 'MMM d')} – ${format(last, 'MMM d, yyyy')}`
}

export default function Calendar({ workspaceId }: { workspaceId?: string }) {
  const { assignee, type } = useTaskFilters()
  const [view, setViewState] = useState<View>(() => (VIEWS.some((v) => v.id === load(VIEW_KEY)) ? (load(VIEW_KEY) as View) : 'week'))
  const [anchor, setAnchor] = useState(() => new Date())
  const [grouped, setGroupedState] = useState(() => load(GROUP_KEY) !== 'off')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<TaskGroup | null>(null)
  const setView = (v: View) => {
    setViewState(v)
    save(VIEW_KEY, v)
    setPanel(null)
  }
  const setGrouped = (v: boolean) => {
    setGroupedState(v)
    save(GROUP_KEY, v ? 'on' : 'off')
  }
  const { from, to } = rangeOf(view, anchor)
  const step = (n: number) => {
    setPanel(null)
    setAnchor((a) => (view === 'month' ? addMonths(a, n) : view === 'day' ? addDays(a, n) : addWeeks(a, n)))
  }

  // Projects span weeks and would bury the actual work; show them only when filtered for.
  // Ancestors bring each task's daily parent and project, for the project filter and grouping.
  const { data: fetched = [] } = useTasks(
    { workspace_id: workspaceId, assignee_id: assignee, type: type || 'daily,hourly', ancestors: true, from: from.toISOString(), to: to.toISOString() },
    true,
    { keepPrevious: true },
  )
  const { data: projects = [] } = useTasks({ workspace_id: workspaceId, type: 'project' })
  const modal = useTaskModal()
  const access = useAccess()
  const canCreate = workspaceId ? access.canEdit(workspaceId) : access.canEditAny

  const byId = useMemo(() => new Map([...projects, ...fetched].map((t) => [t.id, t])), [projects, fetched])
  const projectOf = (t: Task): Task | undefined => {
    for (let p = t.parent_id ? byId.get(t.parent_id) : undefined; p; p = p.parent_id ? byId.get(p.parent_id) : undefined) {
      if (p.type === 'project') return p
    }
  }
  const projectKey = (t: Task) => (t.type === 'project' ? t.id : (projectOf(t)?.id ?? INDEPENDENT))

  // Ancestors aren't filtered by the server, so apply type and assignee here too.
  const types = type ? [type] : ['daily', 'hourly']
  const inView = fetched.filter((t) => t.start_at && types.includes(t.type) && (!assignee || t.assignee_ids.includes(assignee)))
  const tasks = picked.size ? inView.filter((t) => picked.has(projectKey(t))) : inView
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of inView) m.set(projectKey(t), (m.get(projectKey(t)) ?? 0) + 1)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, projects, assignee, type])

  // One project picked: group by environment; otherwise by project.
  const byEnv = picked.size === 1
  const keyOf = (t: Task): GroupKey => {
    if (byEnv)
      return t.environment_id
        ? { key: t.environment_id, label: t.environment_name ?? 'Environment', color: t.environment_color ?? 'slate' }
        : { key: 'none', label: 'No environment', color: 'slate' }
    const p = t.type === 'project' ? t : projectOf(t)
    return p ? { key: p.id, label: p.title, color: colorForId(p.id) } : { key: INDEPENDENT, label: 'Independent tasks', color: 'slate' }
  }
  const timeView = view === 'week' || view === 'day'
  const grouping = grouped && timeView

  const items = useMemo<CalendarItem[]>(() => {
    const plain = (t: Task): CalendarItem => {
      const s = new Date(t.start_at!)
      const e = t.end_at ? new Date(t.end_at) : new Date(s.getTime() + (t.type === 'hourly' ? 3_600_000 : 86_400_000))
      return { kind: 'task', task: t, start: s, end: e, allDay: t.type !== 'hourly', segment: false }
    }
    if (!grouping) return tasks.map(plain)
    const noun = byEnv ? 'environments' : 'projects'
    return [
      ...groupTimed(
        tasks.filter((t) => t.type === 'hourly'),
        keyOf,
        noun,
      ),
      ...groupAllDay(
        tasks.filter((t) => t.type !== 'hourly'),
        from,
        to,
        keyOf,
        noun,
      ),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, grouping, byEnv, from.getTime(), to.getTime()])

  const openTask = (t: Task) => modal.openTask(t.id)
  const create = canCreate
    ? (start: Date, end: Date, allDay: boolean) =>
        modal.createTask({
          title: '',
          workspace_id: workspaceId,
          type: allDay ? 'daily' : 'hourly',
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          assignee_ids: assignee ? [assignee] : [],
        })
    : null
  const days = Array.from({ length: view === 'day' ? 1 : 7 }, (_, i) => addDays(from, i))
  const isCurrent = view === 'month' ? isSameMonth(anchor, new Date()) : view === 'day' ? isSameDay(anchor, new Date()) : isSameDay(startOfWeek(new Date(), { weekStartsOn: 1 }), from)

  return (
    <div className="flex h-full flex-col gap-3">
      <FilterBar>
        <ProjectMultiFilter
          value={picked}
          onChange={(next) => {
            setPicked(next)
            setPanel(null)
          }}
          projects={projects}
          counts={counts}
          footer={picked.size === 1 ? 'One project: busy slots group by environment' : 'Busy slots group by project · ↑↓ and Enter to tick'}
        />
        {timeView && (
          <label
            className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 select-none"
            title={`Show one block per ${byEnv ? 'environment' : 'project'} when more than ${MAX_OVERLAP} tasks overlap, or a day has more than ${MAX_OVERLAP} daily tasks`}
          >
            <span
              role="switch"
              aria-checked={grouped}
              tabIndex={0}
              onClick={() => setGrouped(!grouped)}
              onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), setGrouped(!grouped))}
              className={clsx('relative inline-block h-[18px] w-[30px] rounded-full transition', grouped ? 'bg-blue-600' : 'bg-slate-300')}
            >
              <span className={clsx('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all', grouped ? 'left-[14px]' : 'left-[2px]')} />
            </span>
            <span onClick={() => setGrouped(!grouped)}>Group busy slots</span>
          </label>
        )}
      </FilterBar>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
            <div className="flex">
              <Button variant="ghost" title="Previous" onClick={() => step(-1)}>
                <ChevronLeft size={16} />
              </Button>
              <Button variant="ghost" title="Next" onClick={() => step(1)}>
                <ChevronRight size={16} />
              </Button>
            </div>
            <Button
              onClick={() => {
                setPanel(null)
                setAnchor(new Date())
              }}
              disabled={isCurrent}
            >
              Today
            </Button>
            <h2 className="mx-auto text-lg font-semibold text-slate-800">{titleOf(view, anchor, from, to)}</h2>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={clsx('px-3 py-1', view === v.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {timeView ? (
              <TimeGrid key={view} days={days} items={items} onOpenTask={openTask} onOpenGroup={setPanel} onCreate={create} />
            ) : view === 'month' ? (
              <MonthGrid
                start={from}
                month={anchor}
                items={items}
                onOpenTask={openTask}
                onOpenGroup={setPanel}
                onCreate={create}
                onPickDay={(d) => {
                  setAnchor(d)
                  setView('day')
                }}
              />
            ) : (
              <AgendaList from={from} to={to} tasks={tasks} projectOf={projectOf} onOpenTask={openTask} />
            )}
          </div>
        </div>
        {panel && <GroupPanel group={panel} byEnv={byEnv} projectOf={projectOf} onOpen={(id) => modal.openTask(id)} onClose={() => setPanel(null)} />}
      </div>
    </div>
  )
}

/** A group's tasks, opened by clicking the group. */
function GroupPanel({
  group: g,
  byEnv,
  projectOf,
  onOpen,
  onClose,
}: {
  group: TaskGroup
  byEnv: boolean
  projectOf: (t: Task) => Task | undefined
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const end = new Date(g.end.getTime() - 1)
  const when = g.allDay
    ? format(g.start, 'EEE, MMM d')
    : `${format(g.start, 'EEE, MMM d · HH:mm')}–${isSameDay(g.start, end) ? format(g.end, 'HH:mm') : format(g.end, 'MMM d HH:mm')}`
  const tasks = [...g.tasks].sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!) || a.number - b.number)
  // "+N more" in month view can mix daily and hourly tasks.
  const kind = tasks.every((t) => t.type === 'hourly') ? 'hourly ' : tasks.every((t) => t.type !== 'hourly') ? 'daily ' : ''
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs font-semibold" style={pillStyle(g.color)}>
            {g.label}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {when} · {tasks.length} {kind}task{tasks.length === 1 ? '' : 's'}
          </p>
        </div>
        <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
        {tasks.map((t) => {
          const p = projectOf(t)
          return (
            <li key={t.id}>
              <button className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => onOpen(t.id)}>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="tabular-nums">{formatSchedule(t)}</span>
                  <span className="ml-auto font-medium text-slate-400">{t.key}</span>
                </div>
                <div className={clsx('truncate text-sm', t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>{t.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {t.environment_name && <EnvBadge name={t.environment_name} color={t.environment_color} size="xs" />}
                  {!byEnv && p && (
                    <span className="truncate rounded px-1 text-[10px] font-medium" style={pillStyle(colorForId(p.id))}>
                      {p.title}
                    </span>
                  )}
                  <span className="ml-auto">
                    <StatusPill status={t.status} />
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

