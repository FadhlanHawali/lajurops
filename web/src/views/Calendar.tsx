import { useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type { EventContentArg, EventInput, EventDropArg, DatesSetArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import clsx from 'clsx'
import { format, isSameDay } from 'date-fns'
import { X } from 'lucide-react'
import { EnvBadge } from '../components/Environments'
import { INDEPENDENT, ProjectMultiFilter } from '../components/ProjectMultiFilter'
import { useTaskModal } from '../components/TaskModal'
import { useAccess } from '../lib/access'
import { groupAllDay, groupTimed, MAX_OVERLAP, type CalendarItem, type GroupKey, type TaskGroup } from '../lib/calendarGroups'
import { colorForId, pillStyle, tintColors } from '../lib/colors'
import { formatSchedule } from '../lib/dates'
import { FilterBar, StatusPill, userName } from '../components/ui'
import { useTaskFilters, useTasks, useUpdateTask, useUsers } from '../lib/queries'
import type { Task } from '../lib/types'

const COLORS = {
  project: { bg: '#f59e0b', border: '#d97706' },
  shortProject: { bg: '#fb923c', border: '#f97316' },
  hourly: { bg: '#8b5cf6', border: '#7c3aed' },
  daily: { bg: '#0ea5e9', border: '#0284c7' },
  done: { bg: '#10b981', border: '#059669' },
}

const GROUP_KEY = 'lajurops:calendar-group'
const loadGrouped = () => {
  try {
    return localStorage.getItem(GROUP_KEY) !== 'off'
  } catch {
    return true
  }
}

export default function Calendar({ workspaceId }: { workspaceId?: string }) {
  const { assignee, type } = useTaskFilters()
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [viewType, setViewType] = useState('timeGridWeek')
  const [grouped, setGroupedState] = useState(loadGrouped)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<TaskGroup | null>(null)
  const setGrouped = (v: boolean) => {
    setGroupedState(v)
    try {
      localStorage.setItem(GROUP_KEY, v ? 'on' : 'off')
    } catch {
      // storage unavailable: keep it for this page view only
    }
  }

  // Projects span weeks and would bury the actual work; show them only when filtered for.
  // Ancestors bring each task's daily parent and project, for the project filter and grouping.
  const { data: fetched = [] } = useTasks(
    { workspace_id: workspaceId, assignee_id: assignee, type: type || 'daily,hourly', ancestors: true, ...range },
    !!range,
    { keepPrevious: true },
  )
  const { data: projects = [] } = useTasks({ workspace_id: workspaceId, type: 'project' })
  const update = useUpdateTask()
  const modal = useTaskModal()
  const { byId: users } = useUsers()
  const access = useAccess()

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
  const grouping = grouped && viewType.startsWith('timeGrid')

  const events = useMemo<EventInput[]>(() => {
    const taskEvent = (t: Task, extra: Partial<EventInput> = {}): EventInput => {
      const c = t.status === 'done' ? COLORS.done : t.project_kind === 'short' ? COLORS.shortProject : COLORS[t.type]
      const who = t.assignee_ids.map((id) => userName(users.get(id))).join(', ')
      return {
        id: t.id,
        title: `${t.environment_name ? `[${t.environment_name}] ` : ''}${t.key} ${t.title}${who ? ` · ${who}` : ''}`,
        start: t.start_at!,
        end: t.end_at ?? undefined,
        allDay: t.type !== 'hourly',
        backgroundColor: c.bg,
        borderColor: c.border,
        classNames: t.status === 'done' ? ['opacity-60'] : [],
        // Only editors of the task's workspace can drag or resize it.
        editable: access.canEdit(t.workspace_id),
        extendedProps: { task: t },
        ...extra,
      }
    }
    if (!grouping || !range) return tasks.map((t) => taskEvent(t))

    const items: CalendarItem[] = [
      ...groupTimed(
        tasks.filter((t) => t.type === 'hourly'),
        keyOf,
        byEnv ? 'environments' : 'projects',
      ),
      ...groupAllDay(
        tasks.filter((t) => t.type !== 'hourly'),
        new Date(range.from),
        new Date(range.to),
        keyOf,
        byEnv ? 'environments' : 'projects',
      ),
    ]
    return items.map((it): EventInput => {
      if (it.kind === 'task')
        return it.segment
          ? // One day's piece of a daily task: open it to change its dates.
            taskEvent(it.task, { id: `${it.task.id}@${it.start.getTime()}`, start: it.start, end: it.end, editable: false })
          : taskEvent(it.task)
      const g = it.group
      const c = tintColors(g.color)
      return {
        id: `group:${g.key}@${g.start.getTime()}`,
        title: g.label,
        start: g.start,
        end: g.end,
        allDay: g.allDay,
        editable: false,
        backgroundColor: c.bg,
        borderColor: c.border,
        textColor: c.text,
        classNames: ['lj-group'],
        extendedProps: { group: g },
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, grouping, range, byEnv, users, access.canEdit])

  // Dropping into the all-day row turns a task daily; into the time grid, hourly.
  const persist = (arg: EventDropArg | EventResizeDoneArg) => {
    const ev = arg.event
    const task = ev.extendedProps.task as Task
    const start = ev.start!
    let end = ev.end
    if (!end) end = new Date(start.getTime() + (ev.allDay ? 86_400_000 : 2 * 3_600_000))
    update.mutate(
      {
        id: task.id,
        patch: { start_at: start.toISOString(), end_at: end.toISOString(), type: ev.allDay ? 'daily' : 'hourly' },
      },
      { onError: () => arg.revert() },
    )
  }

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
          footer={filterHint(picked)}
        />
        {viewType.startsWith('timeGrid') && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 select-none" title={`Show one block per ${byEnv ? 'environment' : 'project'} when more than ${MAX_OVERLAP} tasks overlap, or a day has more than ${MAX_OVERLAP} daily tasks`}>
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
        <div className="planner-calendar min-h-0 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-3">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
            buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' }}
            height="100%"
            firstDay={1}
            nowIndicator
            editable
            selectable={workspaceId ? access.canEdit(workspaceId) : access.canEditAny}
            selectMirror
            // Busy days/slots show "+N more" instead of drawing every event,
            // which keeps large workspaces responsive.
            dayMaxEvents={4}
            eventMaxStack={3}
            slotDuration="00:30:00"
            scrollTime="07:00:00"
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            events={events}
            datesSet={(arg: DatesSetArg) => {
              setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() })
              setViewType(arg.view.type)
              setPanel(null)
            }}
            eventContent={(arg) => renderEvent(arg, byEnv)}
            eventDidMount={(info) => {
              // Columns get narrow: the full label on hover.
              const g = info.event.extendedProps.group as TaskGroup | undefined
              info.el.title = g ? `${g.label} · ${g.tasks.length} ${g.allDay ? 'daily' : 'hourly'} tasks · click to list them` : info.event.title
            }}
            eventClick={(arg) => {
              const g = arg.event.extendedProps.group as TaskGroup | undefined
              if (g) setPanel(g)
              else modal.openTask((arg.event.extendedProps.task as Task).id)
            }}
            eventDrop={persist}
            eventResize={persist}
            select={(arg) => {
              modal.createTask({
                title: '',
                workspace_id: workspaceId,
                type: arg.allDay ? 'daily' : 'hourly',
                start_at: arg.start.toISOString(),
                end_at: arg.end.toISOString(),
                assignee_ids: assignee ? [assignee] : [],
              })
              arg.view.calendar.unselect()
            }}
          />
        </div>
        {panel && <GroupPanel group={panel} byEnv={byEnv} projectOf={projectOf} onOpen={(id) => modal.openTask(id)} onClose={() => setPanel(null)} />}
      </div>
    </div>
  )
}

const filterHint = (picked: Set<string>) =>
  picked.size === 1 ? 'One project: busy slots group by environment' : 'Busy slots group by project · ↑↓ and Enter to tick'

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
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs font-semibold" style={pillStyle(g.color)}>
            {g.label}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {when} · {tasks.length} {g.allDay ? 'daily' : 'hourly'} task{tasks.length === 1 ? '' : 's'}
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

/** Groups, and done tasks as "[DONE] ~~title~~"; other tasks use FullCalendar's default rendering. */
function renderEvent(arg: EventContentArg, byEnv: boolean) {
  const g = arg.event.extendedProps.group as TaskGroup | undefined
  if (g) {
    const sub = byEnv ? '' : [...new Set(g.tasks.map((t) => t.environment_name).filter(Boolean))].join(' · ')
    if (g.allDay)
      return (
        <div className="truncate px-1 text-[11px]">
          <b className="font-semibold">{g.label}</b> · {g.tasks.length}
        </div>
      )
    return (
      <div className="h-full overflow-hidden px-1 py-0.5 text-[11px] leading-tight">
        <div className="truncate font-semibold">{g.label}</div>
        <div>{g.tasks.length} tasks</div>
        {sub && <div className="truncate opacity-80">{sub}</div>}
      </div>
    )
  }
  if ((arg.event.extendedProps.task as Task).status !== 'done') return true
  const title = (
    <>
      <b className="mr-1 no-underline">[DONE]</b>
      <span className="line-through">{arg.event.title}</span>
    </>
  )
  // The list view lays out time and title itself; only the title is ours there.
  if (arg.view.type.startsWith('list')) return title
  // Timed events in the month grid are a dot + time + title on one line.
  if (arg.view.type === 'dayGridMonth' && !arg.event.allDay)
    return (
      <>
        <div className="fc-daygrid-event-dot" style={{ borderColor: arg.event.backgroundColor }} />
        {arg.timeText && <div className="fc-event-time">{arg.timeText}</div>}
        <div className="fc-event-title">{title}</div>
      </>
    )
  return (
    <div className="fc-event-main-frame">
      {arg.timeText && <div className="fc-event-time">{arg.timeText}</div>}
      <div className="fc-event-title-container">
        <div className="fc-event-title fc-sticky">{title}</div>
      </div>
    </div>
  )
}
