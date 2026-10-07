import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { addDays, addWeeks, format, formatISO, parseISO, startOfWeek } from 'date-fns'
import { AlertTriangle, ArrowDown, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, FolderKanban, GripVertical, Loader2, Lock, MessageSquare, Plus, RotateCcw, Search, Target, UserCheck, UserPlus, Users, X } from 'lucide-react'
import { useTaskModal } from '../components/TaskModal'
import { EnvBadge } from '../components/Environments'
import { INDEPENDENT, ProjectMultiFilter } from '../components/ProjectMultiFilter'
import { WeekPicker } from '../components/WeekPicker'
import { Avatar, AvatarStack, Button, Empty, StatusPill, TypeBadge, inputCls, userName } from '../components/ui'
import { useAccess } from '../lib/access'
import { formatSchedule, hoursBetween } from '../lib/dates'
import { useCommitments, useMe, useMyCommitment, useSaveCommitment, useTasks, useUpdateTask, useUsers, useWorkspaces } from '../lib/queries'
import type { Commitment, CommitmentBrief, CommittedTask, Task } from '../lib/types'

const fmtH = (h: number) => (Math.round(h * 10) / 10).toLocaleString() + 'h'

/** A task's hours as shown on its row: the estimate, else an hourly task's scheduled time. */
const taskHours = (t: Task) => t.estimate_hours ?? (t.type === 'hourly' ? hoursBetween(t.start_at, t.end_at) : 0)
/** Planned hours: picked daily tasks' estimates plus the hourly time (counted on the server like Workload). */
const plannedHours = (c: Pick<Commitment, 'hourly_hours'>, daily: Pick<Task, 'estimate_hours'>[]) => c.hourly_hours + daily.reduce((a, t) => a + (t.estimate_hours ?? 0), 0)

export default function Commitments() {
  const [view, setView] = useState<'mine' | 'team'>('mine')
  const [anchor, setAnchor] = useState(() => new Date())
  const [workspaceId, setWorkspaceId] = useState('')
  const { data: workspaces = [] } = useWorkspaces()
  const [dirty, setDirty] = useState(false)

  const start = startOfWeek(anchor, { weekStartsOn: 1 })
  const week = formatISO(start)
  // Same query as My week, so this costs nothing extra.
  const overdue = useMyCommitment(week).data?.overdue.length ?? 0
  const go = (next: Date) => {
    if (dirty && !confirm('Discard your unsaved commitment changes?')) return
    setAnchor(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
          {(
            [
              ['mine', 'My week'],
              ['team', 'Team'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => v !== view && (!dirty || confirm('Discard your unsaved commitment changes?')) && setView(v)} className={clsx('inline-flex items-center gap-1.5 px-3 py-1', view === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-600')}>
              {l}
              {v === 'mine' && overdue > 0 && <OverdueBadge count={overdue} />}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => go(addWeeks(anchor, -1))}>
          <ChevronLeft size={16} />
        </Button>
        <WeekPicker value={anchor} onChange={go} />
        <Button variant="ghost" onClick={() => go(addWeeks(anchor, 1))}>
          <ChevronRight size={16} />
        </Button>
        <Button onClick={() => go(new Date())}>This week</Button>
        {view === 'team' && (
          <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            <option value="">All workspaces</option>
            {workspaces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {view === 'mine' ? <MyWeek key={week} week={week} onDirty={setDirty} /> : <Team week={week} workspaceId={workspaceId} />}
    </div>
  )
}

/** Red count of unfinished commitments from earlier weeks. */
export function OverdueBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold text-white"
      title={`${count} committed task${count === 1 ? '' : 's'} from earlier weeks not done yet`}
    >
      {count}
    </span>
  )
}

/** Week number of a YYYY-MM-DD Monday, e.g. "Week 41". */
const weekLabel = (day: string) => `Week ${format(parseISO(day), 'I')}`
/** Monday–Sunday of that week, e.g. "Sep 28 – Oct 4". */
const weekRange = (day: string) => {
  const d = parseISO(day)
  return `${format(d, 'MMM d')} – ${format(addDays(d, 6), 'MMM d')}`
}

/** My week: a one-line notice of unfinished commitments from earlier weeks; the list itself is in "Available to commit". */
function OverdueStrip({ count, onReview }: { count: number; onReview: () => void }) {
  if (!count) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm">
      <AlertTriangle size={16} className="shrink-0 text-red-600" />
      <span className="font-semibold text-red-800">
        {count} task{count === 1 ? '' : 's'} you committed to earlier {count === 1 ? "isn't" : "aren't"} done
      </span>
      <span className="text-xs text-red-700/80">from the last 4 weeks</span>
      <button className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-100" onClick={onReview}>
        Review <ArrowDown size={12} />
      </button>
    </div>
  )
}

function Stat({ label, children, accent }: { label: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold text-slate-800', accent)}>{children}</div>
    </div>
  )
}

/** Committed and done counts for one task type, optionally with their hours. */
function TypeStat({ label, tasks, hours }: { label: string; tasks: Task[]; hours?: number }) {
  const done = tasks.filter((t) => t.status === 'done').length
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
        <div>
          <span className="text-2xl font-semibold text-slate-800">{tasks.length}</span> <span className="text-sm text-slate-500">committed</span>
          {hours !== undefined && <span className="text-sm font-medium whitespace-nowrap text-violet-600"> · {fmtH(hours)}</span>}
        </div>
        <div>
          <span className="text-2xl font-semibold text-emerald-600">{done}</span> <span className="text-sm text-slate-500">done</span>
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
        <div className="h-full rounded bg-emerald-500" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
      </div>
    </div>
  )
}

function CapacityBar({ hours, capacity }: { hours: number; capacity: number }) {
  const over = hours > capacity
  return (
    <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
      <div className={clsx('h-full rounded', over ? 'bg-red-500' : 'bg-violet-500')} style={{ width: `${capacity ? Math.min(100, (hours / capacity) * 100) : hours ? 100 : 0}%` }} />
    </div>
  )
}

// --- My week ---

function MyWeek({ week, onDirty }: { week: string; onDirty: (dirty: boolean) => void }) {
  const me = useMe().data
  const { data: mine, isLoading } = useMyCommitment(week)
  // With ancestors, so each task's project is known.
  // Only daily tasks are picked; hourly ones are committed by their schedule.
  const { data: listed = [] } = useTasks({ assignee_id: me?.id, type: 'daily', ancestors: true }, !!me)
  // Unassigned daily tasks: picking one assigns it to you on save.
  const { data: unassignedListed = [] } = useTasks({ assignee_id: 'none', type: 'daily', ancestors: true })
  // Which list "Available to commit" shows; Assigned to you unless asked.
  const [tab, setTab] = useState<'overdue' | 'mine' | 'others' | 'free'>('mine')
  // Other people's daily tasks this week (or unscheduled): picking one adds
  // you as an owner. Loaded once the tab is opened, as it can be long.
  const [othersOpened, setOthersOpened] = useState(false)
  useEffect(() => {
    if (tab === 'others') setOthersOpened(true)
  }, [tab])
  const weekEnd = formatISO(addDays(parseISO(week), 7))
  const { data: othersListed = [], isFetching: othersLoading } = useTasks(
    { assignee_id: 'others', type: 'daily', ancestors: true, from: week, to: weekEnd, undated: 'open' },
    othersOpened,
  )
  const { canEdit } = useAccess()
  const modal = useTaskModal()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const save = useSaveCommitment(week)

  const [ids, setIds] = useState<string[]>([])
  const [capacity, setCapacity] = useState(40)
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<'committed' | 'backlog' | null>(null)

  // Start from the saved commitment whenever it (re)loads.
  const auto = useMemo(() => (mine?.tasks ?? []).filter((t) => t.automatic), [mine])
  const savedIds = useMemo(() => (mine?.tasks ?? []).filter((t) => !t.automatic).map((t) => t.id), [mine])
  useEffect(() => {
    if (!mine) return
    setIds(savedIds)
    setCapacity(mine.capacity_hours)
    setNote(mine.note)
  }, [mine, savedIds])

  const saved = mine ? { ids: savedIds, capacity: mine.capacity_hours, note: mine.note } : null
  const dirty = !!saved && (saved.capacity !== capacity || saved.note !== note || saved.ids.join() !== ids.join())
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])

  const byId = useMemo(
    () => new Map([...othersListed, ...unassignedListed, ...listed, ...(mine?.tasks ?? [])].map((t) => [t.id, t])),
    [othersListed, unassignedListed, listed, mine],
  )
  /** The project a task sits in (parent or grandparent), if any. */
  const projectOf = (t: Task): Task | undefined => {
    for (let p = t.parent_id ? byId.get(t.parent_id) : undefined; p; p = p.parent_id ? byId.get(p.parent_id) : undefined) {
      if (p.type === 'project') return p
    }
  }
  const assigned = listed.filter((t) => t.type === 'daily' && !!me && t.assignee_ids.includes(me.id))
  const committed = ids.map((id) => byId.get(id)).filter((t): t is Task => !!t)
  const carried = new Set(mine?.carried_over ?? [])
  const q = search.trim().toLowerCase()
  const isMine = (t: Task) => !!me && t.assignee_ids.includes(me.id)
  /** Unassigned, in a workspace you can edit: you can take it on. */
  const isFree = (t: Task) => t.assignee_ids.length === 0 && canEdit(t.workspace_id)
  /** Someone else's, in a workspace you can edit: you can join as an owner. */
  const isShared = (t: Task) => t.assignee_ids.length > 0 && !isMine(t) && canEdit(t.workspace_id)
  const canTake = (t: Task) => isMine(t) || isFree(t) || isShared(t)
  const available = (list: Task[]) => list.filter((t) => t.type === 'daily' && t.status !== 'done' && !ids.includes(t.id))
  // Unfinished commitments from earlier weeks get their own section (and
  // aren't repeated under "Assigned to you"); picked ones move to the right.
  const openOverdue = (mine?.overdue ?? []).filter((t) => !ids.includes(t.id))
  const overdueIds = new Set(openOverdue.map((t) => t.id))
  const openMine = available(assigned).filter((t) => !overdueIds.has(t.id))
  const openFree = available(unassignedListed.filter(isFree))
  const openOthers = available(othersListed.filter(isShared))
  const projectCounts = new Map<string, number>()
  const projects = new Map<string, Task>()
  for (const t of [...openOverdue, ...openMine, ...openOthers, ...openFree]) {
    const p = projectOf(t)
    if (p) projects.set(p.id, p)
    const k = p?.id ?? INDEPENDENT
    projectCounts.set(k, (projectCounts.get(k) ?? 0) + 1)
  }
  const filtered = (list: Task[]) =>
    list
      .filter((t) => !picked.size || picked.has(projectOf(t)?.id ?? INDEPENDENT))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q))
      // Carried-over work first, then by schedule (unscheduled last).
      .sort((a, b) => Number(carried.has(b.id)) - Number(carried.has(a.id)) || (a.start_at ?? '9').localeCompare(b.start_at ?? '9'))
  const backlogMine = filtered(openMine)
  const backlogFree = filtered(openFree)
  const backlogOthers = filtered(openOthers)
  // Overdue, oldest week first: [week, tasks][]
  const overdueGroups = new Map<string, CommittedTask[]>()
  for (const t of filtered(openOverdue) as CommittedTask[]) {
    const wk = t.committed_week ?? ''
    overdueGroups.set(wk, [...(overdueGroups.get(wk) ?? []), t])
  }
  const backlogOverdue = [...overdueGroups].sort(([a], [b]) => a.localeCompare(b))
  const overdueShown = backlogOverdue.reduce((a, [, list]) => a + list.length, 0)
  const pickableOverdue = openOverdue.filter((t) => !t.automatic && canTake(t))
  const narrowed = !!q || picked.size > 0

  // Which list "Available to commit" shows; Assigned to you unless asked.
  // Rendering thousands of rows at once freezes the page, so lists show
  // LIST_PAGE rows at a time (counts and search still cover everything).
  const [limit, setLimit] = useState(LIST_PAGE)
  useEffect(() => setLimit(LIST_PAGE), [tab, q, picked])
  let budget = limit
  const overdueVisible = backlogOverdue
    .map(([wk, list]) => {
      const part = list.slice(0, Math.max(0, budget))
      budget -= part.length
      return [wk, part] as const
    })
    .filter(([, list]) => list.length > 0)
  useEffect(() => {
    if (tab === 'overdue' && openOverdue.length === 0) setTab('mine')
  }, [tab, openOverdue.length])
  // "Review" in the strip: open the Overdue tab, bring the list into view and flash it.
  const listRef = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(false)
  const review = () => {
    setTab('overdue')
    if (listRef.current) {
      listRef.current.scrollTop = 0
      listRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    setFlash(true)
    setTimeout(() => setFlash(false), 1500)
  }
  const hours = mine ? plannedHours(mine, committed) : 0

  const commit = (id: string, before?: string) =>
    setIds((list) => {
      const rest = list.filter((x) => x !== id)
      const at = before ? rest.indexOf(before) : -1
      return at < 0 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)]
    })
  const uncommit = (id: string) => setIds((list) => list.filter((x) => x !== id))
  const dropProps = (zone: 'committed' | 'backlog') => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(zone)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(null)
      const id = e.dataTransfer.getData('text/plain')
      if (!id) return
      if (zone === 'backlog') uncommit(id)
      else if (!ids.includes(id)) commit(id)
    },
  })

  if (isLoading || !mine) return <div className="flex justify-center p-10 text-slate-400"><Loader2 className="animate-spin" /></div>

  return (
    <>
      <OverdueStrip count={openOverdue.length} onReview={review} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <TypeStat label="Daily tasks" tasks={committed} />
        <TypeStat label="Hourly tasks" tasks={auto} hours={mine.hourly_hours} />
        <Stat label="Planned hours / capacity" accent={hours > capacity ? 'text-red-600' : 'text-violet-600'}>
          <span className="whitespace-nowrap">{fmtH(hours)}</span>{' '}
          <span className="text-base font-normal whitespace-nowrap text-slate-400">
            /
            <input
              type="number"
              min={0}
              max={168}
              title="Your capacity this week (hours)"
              className="mx-0.5 w-11 rounded border border-transparent px-1 text-right text-base text-slate-500 [appearance:textfield] hover:border-slate-300 focus:border-blue-500 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
              value={capacity}
              onChange={(e) => setCapacity(Math.max(0, Math.min(168, Number(e.target.value) || 0)))}
            />
            h
          </span>
          <CapacityBar hours={hours} capacity={capacity} />
        </Stat>
        <Stat label="Last week kept" accent="text-sky-600">
          {mine.prev_total ? (
            <>
              {mine.prev_kept} / {mine.prev_total} <span className="text-base font-normal text-slate-400">· {Math.round((mine.prev_kept / mine.prev_total) * 100)}%</span>
            </>
          ) : (
            <span className="text-base font-normal text-slate-400">No commitment</span>
          )}
        </Stat>
      </div>

      {/* Side by side, both lists fit the screen and scroll on their own, so Save stays in view. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:h-[max(28rem,calc(100vh-20rem))] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Available to commit</h2>
            <span className="text-xs text-slate-400">daily tasks, not done</span>
            <span className="ml-auto" />
            <ProjectMultiFilter value={picked} onChange={setPicked} projects={[...projects.values()]} counts={projectCounts} />
            <label className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs">
              <Search size={12} className="text-slate-400" />
              <input className="w-28 outline-none" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          {/* One list at a time, so a long overdue list doesn't bury the rest. */}
          <div className="flex border-b border-slate-200 px-2 text-sm" role="tablist">
            {(
              [
                ['overdue', 'Overdue', overdueShown, AlertTriangle],
                ['mine', 'Assigned to you', backlogMine.length, UserCheck],
                ['others', 'Assigned to others', othersOpened && !othersLoading ? backlogOthers.length : null, Users],
                ['free', 'Unassigned', backlogFree.length, UserPlus],
              ] as const
            )
              .filter(([id]) => id !== 'overdue' || openOverdue.length > 0)
              .map(([id, label, count, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={clsx(
                    '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium whitespace-nowrap',
                    tab === id ? (id === 'overdue' ? 'border-red-500 text-red-700' : 'border-blue-600 text-slate-900') : 'border-transparent text-slate-500 hover:text-slate-800',
                  )}
                >
                  <Icon size={14} className={id === 'overdue' ? 'text-red-500' : undefined} />
                  {label}
                  {count !== null && (
                    <span className={clsx('rounded-full px-1.5 text-[11px] tabular-nums', id === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600')}>{count}</span>
                  )}
                </button>
              ))}
          </div>
          <div
            ref={listRef}
            {...dropProps('backlog')}
            className={clsx(
              'max-h-[60vh] min-h-40 flex-1 overflow-y-auto transition-colors duration-700 lg:max-h-none',
              over === 'backlog' && dragging && ids.includes(dragging) && 'bg-sky-50 outline-2 -outline-offset-4 outline-sky-400 outline-dashed',
              flash && 'bg-red-100/60',
            )}
          >
            {tab === 'overdue' && (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-1.5 text-xs text-red-700/80">
                  Committed in the last 4 weeks, not done · pick daily ones again, reschedule hourly ones
                  {pickableOverdue.length > 0 && (
                    <button className="ml-auto rounded px-1.5 py-0.5 font-semibold text-red-700 hover:bg-red-100" onClick={() => pickableOverdue.forEach((t) => commit(t.id))}>
                      <Plus size={11} className="mr-0.5 inline" />
                      Add all daily ({pickableOverdue.length})
                    </button>
                  )}
                </div>
                {overdueVisible.map(([wk, list]) => (
                  <div key={wk}>
                    <div className="sticky top-0 z-10 border-b border-red-100 bg-red-50 px-4 py-1 text-[11px] font-semibold text-red-700">
                      {wk ? (
                        <>
                          {weekLabel(wk)} <span className="font-normal text-red-600/80">· {weekRange(wk)}</span>
                        </>
                      ) : (
                        'Earlier'
                      )}{' '}
                      · {overdueGroups.get(wk)?.length ?? list.length}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {list.map((t) =>
                        t.automatic ? (
                          // Hourly tasks follow their dates: reschedule to move them.
                          <TaskRow key={t.id} task={t} project={t.project_title ?? undefined} action={{ icon: CalendarClock, title: 'Reschedule (opens the task)', run: () => modal.openTask(t.id) }} />
                        ) : (
                          <TaskRow key={t.id} task={t} project={t.project_title ?? undefined} onDrag={setDragging} action={{ icon: Plus, title: 'Commit to this again', run: () => commit(t.id) }} />
                        ),
                      )}
                    </div>
                  </div>
                ))}
                <ShowMore shown={Math.min(limit, overdueShown)} total={overdueShown} onMore={() => setLimit((l) => l + LIST_PAGE)} />
                {overdueShown === 0 && <p className="p-6 text-center text-sm text-slate-400">{openOverdue.length ? 'No matching tasks.' : 'All caught up.'}</p>}
              </>
            )}
            {tab === 'mine' && (
              <div className="divide-y divide-slate-100">
                {backlogMine.slice(0, limit).map((t) => (
                  <TaskRow key={t.id} task={t} project={projectOf(t)?.title} carried={carried.has(t.id)} onDrag={setDragging} action={{ icon: Plus, title: 'Commit to this', run: () => commit(t.id) }} />
                ))}
                <ShowMore shown={Math.min(limit, backlogMine.length)} total={backlogMine.length} onMore={() => setLimit((l) => l + LIST_PAGE)} />
                {backlogMine.length === 0 && <p className="p-6 text-center text-sm text-slate-400">{narrowed ? 'No matching tasks.' : 'Nothing left to pick.'}</p>}
              </div>
            )}
            {tab === 'others' && (
              <>
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-500">
                  Other people's daily tasks this week (or unscheduled). Picking one adds you as an owner when you save; nobody is removed.
                </div>
                {othersLoading && othersListed.length === 0 ? (
                  <div className="flex justify-center p-6 text-slate-400">
                    <Loader2 className="animate-spin" size={18} />
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {backlogOthers.slice(0, limit).map((t) => (
                      <TaskRow key={t.id} task={t} project={projectOf(t)?.title} owners={t.assignee_ids} onDrag={setDragging} action={{ icon: Plus, title: 'Join as an owner and commit to it', run: () => commit(t.id) }} />
                    ))}
                    <ShowMore shown={Math.min(limit, backlogOthers.length)} total={backlogOthers.length} onMore={() => setLimit((l) => l + LIST_PAGE)} />
                    {backlogOthers.length === 0 && <p className="p-6 text-center text-sm text-slate-400">{narrowed ? 'No matching tasks.' : "Nobody else has open daily tasks this week in workspaces you can edit."}</p>}
                  </div>
                )}
              </>
            )}
            {tab === 'free' && (
              <>
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-500">Picking an unassigned task assigns it to you when you save.</div>
                <div className="divide-y divide-slate-100">
                  {backlogFree.slice(0, limit).map((t) => (
                    <TaskRow key={t.id} task={t} project={projectOf(t)?.title} onDrag={setDragging} action={{ icon: Plus, title: 'Take this on and commit to it', run: () => commit(t.id) }} />
                  ))}
                  <ShowMore shown={Math.min(limit, backlogFree.length)} total={backlogFree.length} onMore={() => setLimit((l) => l + LIST_PAGE)} />
                  {backlogFree.length === 0 && <p className="p-6 text-center text-sm text-slate-400">{narrowed ? 'No matching tasks.' : 'No unassigned daily tasks in workspaces you can edit.'}</p>}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-lg border-2 border-sky-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Target size={15} className="text-sky-600" /> This week I will finish
            </h2>
          </div>
          <div className="max-h-[60vh] min-h-40 flex-1 overflow-y-auto lg:max-h-none">
          <SectionHeader icon={CalendarDays} title="Daily tasks" hint="picked by you · drag to reorder" />
          <div {...dropProps('committed')} className={clsx('min-h-24 divide-y divide-slate-100', over === 'committed' && dragging && !ids.includes(dragging) && 'bg-sky-50 outline-2 -outline-offset-4 outline-sky-400 outline-dashed')}>
            {committed.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={projectOf(t)?.title}
                committed
                carried={carried.has(t.id)}
                unassigned={!canTake(t)}
                pending={[
                  ...(isFree(t) ? ['will be assigned to you'] : []),
                  ...(isShared(t) ? ["you'll be added as an owner"] : []),
                  ...(!t.start_at && !t.end_at && canEdit(t.workspace_id) ? ['will be scheduled Mon–Fri'] : []),
                ]}
                onDrag={setDragging}
                onDropBefore={(id) => commit(id, t.id)}
                action={{ icon: X, title: 'Remove from commitment', run: () => uncommit(t.id) }}
              />
            ))}
            {committed.length === 0 && <p className="p-6 text-center text-sm text-slate-400">Drag daily tasks here, or click + on one, to commit to it this week.</p>}
          </div>
          <SectionHeader icon={Clock} title="Hourly tasks" hint="automatic: assigned to you and scheduled this week" />
          <div className="divide-y divide-slate-100">
            {auto.map((t) => (
              <TaskRow key={t.id} task={t} project={t.project_title ?? undefined} committed carried={carried.has(t.id)} />
            ))}
            {auto.length === 0 && <p className="p-4 text-center text-sm text-slate-400">No hourly tasks scheduled for you this week.</p>}
          </div>
          </div>
          <div className="sticky bottom-0 rounded-b-lg border-t border-slate-200 bg-white p-3">
            <label className="text-xs font-medium text-slate-500">
              Note for the team (optional)
              <textarea className={clsx(inputCls, 'mt-1')} rows={2} maxLength={2000} placeholder="e.g. Out Thursday afternoon; the prod deploy depends on QA sign-off" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <span className={clsx('text-xs', save.error ? 'text-red-600' : 'text-slate-400')}>
                {save.error
                  ? save.error.message
                  : dirty
                    ? 'Unsaved changes'
                    : mine.updated_at
                      ? `Saved ${format(new Date(mine.updated_at), 'EEE HH:mm')} · visible to your team`
                      : 'Not shared yet'}
              </span>
              {dirty && (
                <Button
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    setIds(saved!.ids)
                    setCapacity(saved!.capacity)
                    setNote(saved!.note)
                  }}
                >
                  <RotateCcw size={14} /> Reset
                </Button>
              )}
              <Button
                variant="primary"
                className={clsx(!dirty && 'ml-auto')}
                disabled={save.isPending || (!dirty && !!mine.updated_at)}
                // Tasks now assigned only to others can't stay committed.
                onClick={() => save.mutate({ capacity_hours: capacity, note, task_ids: committed.filter(canTake).map((t) => t.id) })}
              >
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {mine.updated_at ? 'Save commitment' : 'Share commitment'}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Hourly tasks assigned to you that start this week are committed automatically; reschedule or reassign one to change that. Their hours are counted like
        Hourly Workload (actual hours, else the schedule; overlapping tasks once), and daily tasks add their estimates. A task counts as kept when it's done before the week ends.
      </p>
    </>
  )
}

const LIST_PAGE = 100

/** "Showing 100 of 1,812 · Show 100 more" under a capped list; nothing when all rows are shown. */
function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
      Showing {shown.toLocaleString()} of {total.toLocaleString()} · search or filter by project to narrow it down
      <button className="ml-auto rounded-md border border-slate-300 px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-50" onClick={onMore}>
        Show {Math.min(LIST_PAGE, total - shown)} more
      </button>
    </div>
  )
}

/** Tick a task done (tick again to reopen it as To Do). Read-only without edit access to its workspace. */
function DoneCheckbox({ task: t, size = 'md' }: { task: Pick<Task, 'id' | 'status' | 'workspace_id'>; size?: 'sm' | 'md' }) {
  const update = useUpdateTask()
  const { canEdit } = useAccess()
  const done = t.status === 'done'
  const editable = canEdit(t.workspace_id)
  const box = clsx(
    'flex shrink-0 items-center justify-center rounded transition',
    size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5',
    done ? 'bg-emerald-500 text-white' : 'border-2 border-slate-300',
    editable && (done ? 'cursor-pointer hover:bg-emerald-600' : 'cursor-pointer hover:border-emerald-500 hover:bg-emerald-50'),
  )
  const icon = done && <Check size={size === 'md' ? 11 : 9} strokeWidth={3} />
  if (!editable) {
    return (
      <span className={box} title={done ? 'Done' : 'Not done (you can view this workspace only)'}>
        {icon}
      </span>
    )
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      className={box}
      title={done ? 'Done · click to reopen as To Do' : 'Mark as done'}
      onClick={(e) => {
        e.stopPropagation()
        update.mutate({ id: t.id, patch: { status: done ? 'todo' : 'done' } })
      }}
    >
      {icon}
    </button>
  )
}

function SectionHeader({ icon: Icon, title, hint }: { icon: typeof Clock; title: string; hint: string }) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-2 border-b border-slate-100 bg-slate-50 px-4 py-1.5">
      <span className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase">
        <Icon size={12} /> {title}
      </span>
      <span className="text-xs text-slate-400">{hint}</span>
    </div>
  )
}

function TaskRow({
  task: t,
  project,
  committed,
  carried,
  unassigned,
  owners,
  pending = [],
  action,
  onDrag,
  onDropBefore,
}: {
  task: Task
  /** Title of the project the task sits in. */
  project?: string
  committed?: boolean
  carried?: boolean
  unassigned?: boolean
  /** Current owners, shown as avatars (for other people's tasks). */
  owners?: string[]
  /** What saving will change on the task (e.g. assign or schedule it). */
  pending?: string[]
  /** Omitted for automatic (hourly) rows, which can't be moved or removed. */
  action?: { icon: typeof Plus; title: string; run: () => void }
  onDrag?: (id: string | null) => void
  onDropBefore?: (id: string) => void
}) {
  const modal = useTaskModal()
  const h = taskHours(t)
  const done = t.status === 'done'
  return (
    <div
      draggable={!!onDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.id)
        e.dataTransfer.effectAllowed = 'move'
        onDrag?.(t.id)
      }}
      onDragEnd={() => onDrag?.(null)}
      onDragOver={onDropBefore && ((e) => e.preventDefault())}
      onDrop={
        onDropBefore &&
        ((e) => {
          const id = e.dataTransfer.getData('text/plain')
          if (!id || id === t.id) return
          e.preventDefault()
          e.stopPropagation()
          onDropBefore(id)
        })
      }
      className={clsx('group flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50', onDrag && 'cursor-grab active:cursor-grabbing', done && 'opacity-60')}
    >
      <div className="pt-0.5">
        {committed ? (
          <DoneCheckbox task={t} />
        ) : (
          <GripVertical size={16} className="text-slate-300" />
        )}
      </div>
      <button className="min-w-0 flex-1 text-left" onClick={() => modal.openTask(t.id)}>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-mono text-slate-400">{t.key}</span>
          <TypeBadge type={t.type} />
          {t.environment_name && <EnvBadge name={t.environment_name} color={t.environment_color} size="xs" />}
          {carried && (
            <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-medium text-orange-700" title="Committed last week, not done yet">
              <RotateCcw size={10} /> carried over
            </span>
          )}
          {unassigned && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">no longer assigned to you</span>}
          {pending.map((p) => (
            <span key={p} className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700" title="Happens when you save">
              {p}
            </span>
          ))}
        </div>
        <div className={clsx('mt-0.5 truncate text-sm font-medium text-slate-800', done && 'line-through')}>{t.title}</div>
        <div className="truncate text-xs text-slate-500">
          {project && <span className="font-medium text-slate-600">{project} · </span>}
          {formatSchedule(t) || 'Not scheduled'}
        </div>
      </button>
      <div className="flex flex-col items-end gap-1">
        {owners && owners.length > 0 && <AvatarStack ids={owners} max={3} />}
        <StatusPill status={t.status} />
        <span className="text-xs tabular-nums text-slate-500" title={t.estimate_hours == null && t.type === 'daily' ? 'No estimate' : undefined}>
          {h ? fmtH(h) : '—'}
        </span>
      </div>
      {action ? (
        <button className="rounded p-1 text-slate-400 group-hover:opacity-100 pointer-fine:opacity-0 hover:bg-slate-200 hover:text-slate-700 focus:opacity-100" title={action.title} onClick={action.run}>
          <action.icon size={14} />
        </button>
      ) : (
        <span className="p-1 text-slate-300" title="Committed automatically by its schedule">
          <Lock size={14} />
        </span>
      )}
    </div>
  )
}

// --- Team ---

function Team({ week, workspaceId }: { week: string; workspaceId: string }) {
  const { data: list = [], isLoading } = useCommitments(week, workspaceId)
  // Someone has a commitment once they save one or have hourly work scheduled.
  const committed = list.filter(hasCommitment)
  const tasks = committed.flatMap((c) => c.tasks)
  const teamOverdue = list.reduce((a, c) => a + c.overdue.length, 0)
  const overCapacity = committed.filter((c) => cardHours(c) > c.capacity_hours).length
  const sorted = [...committed, ...list.filter((c) => !hasCommitment(c))]

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Members committed">
          {committed.length} / {list.length}
        </Stat>
        <Stat label="Tasks committed">{tasks.length}</Stat>
        <Stat label="Done so far" accent="text-emerald-600">
          {tasks.filter((t) => t.status === 'done').length} / {tasks.length}
          {teamOverdue > 0 && (
            <div className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
              <AlertTriangle size={12} /> {teamOverdue} overdue from earlier weeks
            </div>
          )}
        </Stat>
        <Stat label="Over capacity" accent={overCapacity ? 'text-red-600' : undefined}>
          {overCapacity} {overCapacity === 1 ? 'person' : 'people'}
        </Stat>
      </div>
      {!isLoading && list.length === 0 ? (
        <Empty>No users yet — users appear here after their first Keycloak login.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((c) => (
            <PersonCard key={c.user_id} c={c} />
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">
        A commitment is the daily tasks a person picks for the week plus their hourly tasks scheduled in it. Done counts committed tasks that are done now; "kept" on My week counts tasks done before the week ended.
      </p>
    </>
  )
}

const hasCommitment = (c: CommitmentBrief) => !!c.updated_at || c.tasks.length > 0
const cardHours = (c: CommitmentBrief) => plannedHours(c, c.tasks.filter((t) => !t.automatic))

/** "Daily 1/3 done"-style chip for one task type on a person's card. */
function TypeCount({ icon: Icon, label, tasks, cls, hours }: { icon: typeof Clock; label: string; tasks: Pick<Task, 'status'>[]; cls: string; hours?: number }) {
  const done = tasks.filter((t) => t.status === 'done').length
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 whitespace-nowrap', cls)} title={`${label}: ${done} of ${tasks.length} done`}>
      <Icon size={11} /> {label} {done}/{tasks.length}
      {hours !== undefined && hours > 0 && <span className="opacity-70">· {fmtH(hours)}</span>}
    </span>
  )
}

/**
 * True once the element has come within `margin` of its scroll area's visible
 * part (and stays true). Lets big lists render only what people scroll to.
 */
function useSeen<T extends HTMLElement>(margin = 600) {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') return setSeen(true)
    // Observe against the nearest scrolling ancestor, so the margin works inside it.
    let root: HTMLElement | null = el.parentElement
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { root, rootMargin: `${margin}px 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, margin])
  return [ref, seen] as const
}

function PersonCard({ c }: { c: CommitmentBrief }) {
  // A big team has thousands of task rows: draw a card's list once it's near view.
  const [cardRef, seen] = useSeen<HTMLDivElement>()
  const { byId } = useUsers()
  const modal = useTaskModal()
  const hours = cardHours(c)
  const has = hasCommitment(c)
  const over = hours > c.capacity_hours
  const done = c.tasks.filter((t) => t.status === 'done').length
  return (
    // Fixed height, so a big team lines up in even rows; the task list scrolls inside.
    <div ref={cardRef} className={clsx('flex h-[26rem] flex-col rounded-lg border bg-white', has ? 'border-slate-200' : 'border-dashed border-slate-300')}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Avatar user={byId.get(c.user_id)} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{userName(c)}</div>
          {has ? (
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-medium">
              <TypeCount icon={CalendarDays} label="Daily" tasks={c.tasks.filter((t) => !t.automatic)} cls="bg-sky-50 text-sky-700" />
              <TypeCount icon={Clock} label="Hourly" tasks={c.tasks.filter((t) => t.automatic)} cls="bg-violet-50 text-violet-700" hours={c.hourly_hours} />
              {/* Only the exceptions: over capacity, or daily tasks not picked yet. */}
              {over && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700" title={`${fmtH(hours)} planned, ${fmtH(c.capacity_hours)} capacity`}>
                  Over capacity
                </span>
              )}
              {!c.updated_at && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">Daily not picked</span>}
              {c.overdue.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-red-700"
                  title={`Committed in the last 4 weeks, not done yet:\n${c.overdue.map((t) => `${t.key} ${t.title} (${t.committed_week ? `${weekLabel(t.committed_week)}, ${weekRange(t.committed_week)}` : ''})`).join('\n')}`}
                >
                  <AlertTriangle size={11} /> {c.overdue.length} overdue
                </span>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-500">No commitment yet</div>
          )}
        </div>
        {has && (
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">
              {done}
              <span className="text-sm text-slate-400">/{c.tasks.length}</span>
            </div>
            <div className="text-[10px] text-slate-400 uppercase">done</div>
          </div>
        )}
      </div>
      {has && (
        <div className="h-1.5 bg-slate-100">
          <div className="h-full bg-emerald-500" style={{ width: `${c.tasks.length ? (done / c.tasks.length) * 100 : 0}%` }} />
        </div>
      )}
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3 text-sm">
        {(seen ? c.tasks : []).map((t) => (
          <li key={t.id} className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
            <span className="pt-[3px]">
              <DoneCheckbox task={t} size="sm" />
            </span>
            <button className="min-w-0 flex-1 text-left" onClick={() => modal.openTask(t.id)}>
              <span className={clsx('flex items-center gap-2', t.status === 'done' && 'text-slate-400 line-through')}>
                <span className="font-mono text-xs text-slate-400">{t.key}</span>
                {t.automatic && <Clock size={11} className="shrink-0 text-violet-500" aria-label="Hourly, scheduled this week" />}
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                <FolderKanban size={11} className="shrink-0 text-slate-400" />
                <span title={t.project_title ?? 'Not in a project'} className={clsx('truncate', t.project_title ? 'text-slate-600' : 'text-slate-400 italic')}>{t.project_title ?? 'Independent'}</span>
                {t.environment_name && <EnvBadge name={t.environment_name} color={t.environment_color} size="xs" />}
                {t.status !== 'done' && <StatusPill status={t.status} className="ml-auto shrink-0" />}
              </span>
            </button>
          </li>
        ))}
        {c.updated_at && c.tasks.length === 0 && <li className="text-xs text-slate-400">Committed to no tasks this week.</li>}
      </ul>
      {c.note && (
        <div className="flex max-h-16 shrink-0 gap-1.5 overflow-y-auto border-t border-slate-100 px-4 py-2 text-xs whitespace-pre-wrap text-slate-500">
          <MessageSquare size={12} className="mt-0.5 shrink-0" /> {c.note}
        </div>
      )}
    </div>
  )
}
