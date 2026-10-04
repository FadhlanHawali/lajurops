import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import clsx from 'clsx'
import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  addYears,
  format,
  isWeekend,
  startOfDay,
  startOfHour,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Crosshair, Plus, ZoomIn, ZoomOut } from 'lucide-react'
import { useTaskModal } from '../components/TaskModal'
import { EnvBadge } from '../components/Environments'
import { useAccess } from '../lib/access'
import { AvatarStack, Button, FilterBar, taskColor } from '../components/ui'
import { defaultSpan, formatSchedule } from '../lib/dates'
import { useTaskFilters, useTasks, useUpdateTask } from '../lib/queries'
import { defaultChildType, type Task } from '../lib/types'

type Unit = 'hour' | '6h' | 'day' | 'week' | 'month' | 'year'

interface Zoom {
  id: string
  label: string
  pxPerHour: number
  top: Unit
  bottom: Unit
  /** Drag snapping for hourly tasks, in minutes. Daily tasks always snap to whole days. */
  snapMin: number
}

const ZOOMS: Zoom[] = [
  { id: 'hour', label: 'Hour', pxPerHour: 56, top: 'day', bottom: 'hour', snapMin: 15 },
  { id: '6h', label: '6 Hours', pxPerHour: 14, top: 'day', bottom: '6h', snapMin: 60 },
  { id: 'day', label: 'Day', pxPerHour: 2.5, top: 'month', bottom: 'day', snapMin: 60 },
  { id: 'week', label: 'Week', pxPerHour: 0.75, top: 'month', bottom: 'week', snapMin: 1440 },
  { id: 'month', label: 'Month', pxPerHour: 0.18, top: 'year', bottom: 'month', snapMin: 1440 },
]

/**
 * The timeline loads one window of time at a time: this far either side of
 * the centre when it opens, growing as you scroll towards an edge (up to
 * MAX_SPANS spans, dropping the far side).
 */
const WINDOW_HOURS: Record<string, number> = { hour: 24 * 3, '6h': 24 * 14, day: 24 * 60, week: 24 * 180, month: 24 * 730 }
const MAX_SPANS = 4
const EDGE_PX = 300 // extend the window when this close to its edge
const OVERSCAN = 12 // rows rendered above and below the viewport

/** The window around a moment for a zoom level, snapped to its top unit. */
function windowAround(center: number, zoom: Zoom) {
  const span = WINDOW_HOURS[zoom.id] * HOUR_MS
  const start = unitStart(zoom.top, new Date(center - span)).getTime()
  const end = unitAdd(zoom.top, unitStart(zoom.top, new Date(center + span)), 1).getTime()
  return { start, end }
}

const LEFT = 320 // task list column width
const ROW_H = 34
const HOUR_MS = 3_600_000

function unitStart(u: Unit, d: Date): Date {
  switch (u) {
    case 'hour':
      return startOfHour(d)
    case '6h': {
      const h = startOfHour(d)
      h.setHours(Math.floor(h.getHours() / 6) * 6)
      return h
    }
    case 'day':
      return startOfDay(d)
    case 'week':
      return startOfWeek(d, { weekStartsOn: 1 })
    case 'month':
      return startOfMonth(d)
    case 'year':
      return startOfYear(d)
  }
}

function unitAdd(u: Unit, d: Date, n: number): Date {
  switch (u) {
    case 'hour':
      return addHours(d, n)
    case '6h':
      return addHours(d, 6 * n)
    case 'day':
      return addDays(d, n)
    case 'week':
      return addWeeks(d, n)
    case 'month':
      return addMonths(d, n)
    case 'year':
      return addYears(d, n)
  }
}

function tickLabel(u: Unit, d: Date, width: number, top: boolean): string {
  switch (u) {
    case 'hour':
      return width >= 40 ? format(d, 'HH:00') : format(d, 'HH')
    case '6h':
      return format(d, 'HH:00')
    case 'day':
      return top ? format(d, 'EEEE, MMM d, yyyy') : width >= 50 ? format(d, 'EEE d') : format(d, 'd')
    case 'week':
      return format(d, 'MMM d')
    case 'month':
      return top ? format(d, 'MMMM yyyy') : width >= 60 ? format(d, 'MMM yyyy') : format(d, 'MMM')
    case 'year':
      return format(d, 'yyyy')
  }
}

/** Rounds a timestamp to the snapping grid (local days for >= 1 day). */
function snap(ms: number, snapMin: number): number {
  if (snapMin >= 1440) return startOfDay(new Date(ms + 12 * HOUR_MS)).getTime()
  const step = snapMin * 60_000
  const off = -new Date(ms).getTimezoneOffset() * 60_000
  return Math.round((ms + off) / step) * step - off
}

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

interface Row {
  task: Task
  depth: number
  /** For tasks without their own dates: the span of everything inside them. */
  rollup?: { start: number; end: number }
}

interface DragState {
  id: string
  mode: 'move' | 'start' | 'end'
  x0: number
  s0: number
  e0: number
  snapMin: number
  moved: boolean
}

export default function Gantt({ workspaceId }: { workspaceId: string }) {
  const { assignee, type } = useTaskFilters()
  const [zoomIdx, setZoomIdx] = useState(() => {
    const saved = localStorage.getItem('gantt.zoom')
    const i = ZOOMS.findIndex((z) => z.id === saved)
    return i >= 0 ? i : 2
  })
  const zoom = ZOOMS[zoomIdx]
  // The loaded (and drawn) time window; see WINDOW_HOURS.
  const [range, setRange] = useState(() => windowAround(Date.now(), zoom))
  const { data: tasks = [], isLoading } = useTasks(
    {
      workspace_id: workspaceId,
      assignee_id: assignee,
      type,
      from: new Date(range.start).toISOString(),
      to: new Date(range.end).toISOString(),
      // Unscheduled tasks too, so they can be placed by clicking the timeline.
      undated: 'all',
      // Unfiltered, rows keep their project/daily parents even when those
      // fall outside the window; filtered, orphans show at the top level.
      ancestors: !assignee && !type,
    },
    true,
    { keepPrevious: true },
  )
  const update = useUpdateTask()
  const modal = useTaskModal()
  const canEdit = useAccess().canEdit(workspaceId)
  const now = useNow()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ id: string; start: number; end: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingCenter = useRef<number | null>(null)
  // Pixels to add to scrollLeft after the window grew on the left.
  const pendingShift = useRef(0)
  // The visible part of the scroll area, for drawing only what's on screen.
  const [view, setView] = useState({ top: 0, height: 800 })

  useEffect(() => {
    try {
      localStorage.setItem('gantt.zoom', zoom.id)
    } catch {
      /* storage unavailable */
    }
  }, [zoom.id])

  // Group subtasks beneath their parents; orphans (parent filtered out) show at top level.
  const rows = useMemo<Row[]>(() => {
    const ids = new Set(tasks.map((t) => t.id))
    const children = new Map<string, Task[]>()
    const top: Task[] = []
    for (const t of tasks) {
      if (t.parent_id && ids.has(t.parent_id)) {
        const list = children.get(t.parent_id) ?? []
        list.push(t)
        children.set(t.parent_id, list)
      } else top.push(t)
    }
    const byStart = (a: Task, b: Task) =>
      (a.start_at ? Date.parse(a.start_at) : Infinity) - (b.start_at ? Date.parse(b.start_at) : Infinity) || a.number - b.number
    top.sort(byStart)

    // Span of a task's scheduled descendants, used to draw unscheduled projects.
    const span = (t: Task): { start: number; end: number } | undefined => {
      let r: { start: number; end: number } | undefined
      for (const c of children.get(t.id) ?? []) {
        const own = c.start_at
          ? { start: Date.parse(c.start_at), end: c.end_at ? Date.parse(c.end_at) : defaultSpan(c.type, new Date(c.start_at)).end.getTime() }
          : span(c)
        if (own) r = r ? { start: Math.min(r.start, own.start), end: Math.max(r.end, own.end) } : own
      }
      return r
    }

    const out: Row[] = []
    const walk = (t: Task, depth: number) => {
      out.push({ task: t, depth, rollup: t.start_at ? undefined : span(t) })
      if (!collapsed.has(t.id)) for (const c of (children.get(t.id) ?? []).sort(byStart)) walk(c, depth + 1)
    }
    top.forEach((t) => walk(t, 0))
    return out
  }, [tasks, collapsed])

  const hasChildren = useMemo(() => new Set(tasks.filter((t) => t.parent_id).map((t) => t.parent_id!)), [tasks])

  const x = (ms: number) => ((ms - range.start) / HOUR_MS) * zoom.pxPerHour
  const width = x(range.end)

  const ticks = (u: Unit) => {
    const out: { ms: number; x: number; w: number; d: Date }[] = []
    for (let d = unitStart(u, new Date(range.start)); d.getTime() < range.end; d = unitAdd(u, d, 1)) {
      const next = unitAdd(u, d, 1).getTime()
      const s = Math.max(d.getTime(), range.start)
      out.push({ ms: d.getTime(), x: x(s), w: x(Math.min(next, range.end)) - x(s), d })
    }
    return out
  }
  const topTicks = useMemo(() => ticks(zoom.top), [range, zoom])
  const bottomTicks = useMemo(() => ticks(zoom.bottom), [range, zoom])
  const weekendDays = useMemo(
    () => (['hour', '6h', 'day'].includes(zoom.bottom) ? ticks('day').filter((t) => isWeekend(t.d)) : []),
    [range, zoom],
  )

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!
    const px = clientX - el.getBoundingClientRect().left + el.scrollLeft - LEFT
    return range.start + (px / zoom.pxPerHour) * HOUR_MS
  }

  const scrollToTime = (ms: number, frac = 0.35) => {
    const el = scrollRef.current
    if (el) el.scrollLeft = x(ms) - (el.clientWidth - LEFT) * frac
  }

  // Keep the view centred on the same moment when zooming.
  const setZoom = (i: number) => {
    const el = scrollRef.current
    const next = Math.max(0, Math.min(ZOOMS.length - 1, i))
    if (next === zoomIdx) return
    const center = el ? timeAt(el.getBoundingClientRect().left + LEFT + (el.clientWidth - LEFT) / 2) : Date.now()
    pendingCenter.current = center
    setZoomIdx(next)
    setRange(windowAround(center, ZOOMS[next]))
  }
  // "Now": jump there, loading a new window when it's outside this one.
  const goToNow = () => {
    const t = Date.now()
    if (t < range.start || t > range.end) {
      pendingCenter.current = t
      setRange(windowAround(t, zoom))
    } else scrollToTime(t)
  }
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (pendingCenter.current !== null) {
      scrollToTime(pendingCenter.current, 0.5)
      pendingCenter.current = null
    } else if (el && pendingShift.current) {
      el.scrollLeft += pendingShift.current
    }
    pendingShift.current = 0
  }, [zoomIdx, range.start, range.end])

  // Grow the window when scrolling near an edge (dropping the far side
  // beyond MAX_SPANS), and track what's visible.
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }))
    if (pendingCenter.current !== null || pendingShift.current) return
    const span = WINDOW_HOURS[zoom.id] * HOUR_MS
    const max = MAX_SPANS * 2 * span
    if (el.scrollLeft < EDGE_PX) {
      const start = unitStart(zoom.top, new Date(range.start - span)).getTime()
      pendingShift.current = ((range.start - start) / HOUR_MS) * zoom.pxPerHour
      setRange({ start, end: Math.min(range.end, unitAdd(zoom.top, unitStart(zoom.top, new Date(start + max)), 1).getTime()) })
    } else if (el.scrollLeft + el.clientWidth > LEFT + x(range.end) - EDGE_PX) {
      const end = unitAdd(zoom.top, unitStart(zoom.top, new Date(range.end + span)), 1).getTime()
      const start = Math.max(range.start, unitStart(zoom.top, new Date(end - max)).getTime())
      pendingShift.current = -((start - range.start) / HOUR_MS) * zoom.pxPerHour
      setRange({ start, end })
    }
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const didInitialScroll = useRef(false)
  useLayoutEffect(() => {
    if (!didInitialScroll.current && !isLoading && scrollRef.current) {
      scrollToTime(now.getTime())
      didInitialScroll.current = true
    }
  }, [isLoading])

  // Ctrl/Cmd + wheel zooms.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(zoomIdx + (e.deltaY > 0 ? 1 : -1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  // --- dragging bars ---
  const onBarPointerDown = (e: ReactPointerEvent, t: Task, mode: DragState['mode']) => {
    if (e.button !== 0 || !t.start_at) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const s0 = Date.parse(t.start_at)
    const e0 = t.end_at ? Date.parse(t.end_at) : defaultSpan(t.type, new Date(s0)).end.getTime()
    dragRef.current = { id: t.id, mode, x0: e.clientX, s0, e0, snapMin: t.type !== 'hourly' ? 1440 : zoom.snapMin, moved: false }
  }

  const onBarPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    // Viewers can't reschedule: a press only opens the task.
    if (!d || !canEdit) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) < 4) return
    d.moved = true
    const delta = (dx / zoom.pxPerHour) * HOUR_MS
    const minDur = d.snapMin * 60_000
    let start = d.s0
    let end = d.e0
    if (d.mode === 'move') {
      start = snap(d.s0 + delta, d.snapMin)
      end = start + (d.e0 - d.s0)
    } else if (d.mode === 'start') {
      start = Math.min(snap(d.s0 + delta, d.snapMin), d.e0 - minDur)
    } else {
      end = Math.max(snap(d.e0 + delta, d.snapMin), d.s0 + minDur)
    }
    setPreview({ id: d.id, start, end })
  }

  const onBarPointerUp = (t: Task) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (!d.moved) {
      modal.openTask(t.id)
    } else if (preview && (preview.start !== d.s0 || preview.end !== d.e0)) {
      update.mutate(
        { id: t.id, patch: { start_at: new Date(preview.start).toISOString(), end_at: new Date(preview.end).toISOString() } },
        { onSettled: () => setPreview(null) },
      )
      return
    }
    setPreview(null)
  }

  const scheduleAt = (t: Task, clientX: number) => {
    if (!canEdit) return
    const at = new Date(snap(timeAt(clientX), t.type !== 'hourly' ? 1440 : zoom.snapMin))
    const { start, end } = defaultSpan(t.type, at)
    update.mutate({ id: t.id, patch: { start_at: start.toISOString(), end_at: end.toISOString() } })
  }

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const nowX = x(now.getTime())
  const bodyH = Math.max(rows.length * ROW_H, ROW_H * 3)
  // Only the rows on screen (plus some overscan) are rendered.
  const first = Math.max(0, Math.floor((view.top - 48) / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN)
  const near = (row: number) => row >= first && row < last

  // Bar geometry per visible task (honouring an in-progress drag), used for
  // dependency arrows.
  const bars = new Map<string, { row: number; start: number; end: number; done: boolean }>()
  rows.forEach(({ task: t }, row) => {
    if (!t.start_at) return
    const p = preview?.id === t.id ? preview : null
    const start = p ? p.start : Date.parse(t.start_at)
    const end = p ? p.end : t.end_at ? Date.parse(t.end_at) : defaultSpan(t.type, new Date(start)).end.getTime()
    bars.set(t.id, { row, start, end, done: t.status === 'done' })
  })
  const arrows = rows.flatMap(({ task: t }) =>
    t.blocked_by.flatMap((blockerId) => {
      const from = bars.get(blockerId)
      const to = bars.get(t.id)
      if (!from || !to) return []
      // Draw arrows that touch the rendered rows.
      if (!near(from.row) && !near(to.row)) return []
      return [{ key: `${blockerId}>${t.id}`, from, to, conflict: !from.done && to.start < from.end }]
    }),
  )

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar />
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
            {ZOOMS.map((z, i) => (
              <button key={z.id} onClick={() => setZoom(i)} className={clsx('px-2.5 py-1', i === zoomIdx ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                {z.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" title="Zoom in (Ctrl + wheel)" onClick={() => setZoom(zoomIdx - 1)} disabled={zoomIdx === 0}>
            <ZoomIn size={16} />
          </Button>
          <Button variant="ghost" title="Zoom out (Ctrl + wheel)" onClick={() => setZoom(zoomIdx + 1)} disabled={zoomIdx === ZOOMS.length - 1}>
            <ZoomOut size={16} />
          </Button>
          <Button onClick={goToNow}>
            <Crosshair size={14} /> Now
          </Button>
          <Button
            variant="ghost"
            title={collapsed.size ? 'Expand all' : 'Collapse all'}
            onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(hasChildren))}
          >
            {collapsed.size ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
          </Button>
          {canEdit && (
            <Button variant="primary" onClick={() => modal.createTask({ title: '', workspace_id: workspaceId })}>
              <Plus size={14} /> Task
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white select-none">
        <div style={{ width: LEFT + width }} className="relative">
          {/* Header */}
          <div className="sticky top-0 z-30 flex border-b border-slate-200 bg-white">
            <div className="sticky left-0 z-40 flex shrink-0 items-end border-r border-slate-200 bg-white px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500" style={{ width: LEFT, height: 48 }}>
              Task
            </div>
            <div className="relative" style={{ width, height: 48 }}>
              {topTicks.map((t) => (
                <div key={t.ms} className="absolute top-0 h-6 border-l border-slate-200 text-xs font-medium text-slate-700" style={{ left: t.x, width: t.w }}>
                  <span className="sticky inline-block truncate px-2 leading-6" style={{ left: LEFT }}>
                    {tickLabel(zoom.top, t.d, t.w, true)}
                  </span>
                </div>
              ))}
              {bottomTicks.map((t) => (
                <div
                  key={t.ms}
                  className={clsx(
                    'absolute top-6 h-6 overflow-hidden border-t border-l border-slate-200 text-center text-[11px] leading-6 text-slate-500',
                    zoom.bottom === 'day' && isWeekend(t.d) && 'bg-slate-50',
                  )}
                  style={{ left: t.x, width: t.w }}
                >
                  {tickLabel(zoom.bottom, t.d, t.w, false)}
                </div>
              ))}
              {nowX >= 0 && nowX <= width && (
                <div className="absolute bottom-0 -translate-x-1/2 rounded-t bg-red-500 px-1 text-[10px] font-semibold text-white" style={{ left: nowX }}>
                  {format(now, 'HH:mm')}
                </div>
              )}
            </div>
          </div>

          {/* Grid background */}
          <div className="pointer-events-none absolute z-0" style={{ left: LEFT, top: 48, width, height: bodyH }}>
            {weekendDays.map((t) => (
              <div key={t.ms} className="absolute top-0 h-full bg-slate-50" style={{ left: t.x, width: t.w }} />
            ))}
            {bottomTicks.map((t) => (
              <div key={t.ms} className="absolute top-0 h-full border-l border-slate-100" style={{ left: t.x }} />
            ))}
            {topTicks.map((t) => (
              <div key={t.ms} className="absolute top-0 h-full border-l border-slate-200" style={{ left: t.x }} />
            ))}
            {nowX >= 0 && nowX <= width && <div className="absolute top-0 h-full w-0.5 bg-red-500/70" style={{ left: nowX }} />}
          </div>

          {/* Dependency arrows: from the end of the task waited for to the start of the waiting task. */}
          {arrows.length > 0 && (
            <svg className="pointer-events-none absolute z-[5]" style={{ left: LEFT, top: 48 }} width={width} height={bodyH}>
              <defs>
                {(['ok', 'bad'] as const).map((k) => (
                  <marker key={k} id={`dep-arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 z" fill={k === 'ok' ? '#64748b' : '#dc2626'} />
                  </marker>
                ))}
              </defs>
              {arrows.map(({ key, from, to, conflict }) => {
                const x1 = x(from.end)
                const y1 = from.row * ROW_H + ROW_H / 2
                const x2 = x(to.start)
                const y2 = to.row * ROW_H + ROW_H / 2
                const gap = 10
                // Straight elbow when there's room; otherwise route between the rows.
                const d =
                  x2 - x1 >= gap * 2
                    ? `M${x1},${y1} H${x1 + gap} V${y2} H${x2}`
                    : `M${x1},${y1} H${x1 + gap} V${(y1 + y2) / 2} H${x2 - gap} V${y2} H${x2}`
                return (
                  <path
                    key={key}
                    d={d}
                    fill="none"
                    stroke={conflict ? '#dc2626' : '#94a3b8'}
                    strokeWidth={1.5}
                    strokeDasharray={conflict ? '4 3' : undefined}
                    markerEnd={`url(#dep-arrow-${conflict ? 'bad' : 'ok'})`}
                  />
                )
              })}
            </svg>
          )}

          {/* Rows: only those near the viewport are rendered. */}
          {!isLoading && rows.length === 0 && (
            <div className="sticky left-0 px-4 py-6 text-sm text-slate-500" style={{ width: LEFT + Math.min(width, 900) }}>
              No tasks in this period. Scroll sideways or zoom out to load more, or create a task.
            </div>
          )}
          <div className="relative" style={{ height: rows.length ? bodyH : 0 }}>
            {rows.slice(first, last).map(({ task: t, depth, rollup }, i) => {
              const p = preview?.id === t.id ? preview : null
              const start = p ? p.start : t.start_at ? Date.parse(t.start_at) : null
              const end = p ? p.end : t.end_at ? Date.parse(t.end_at) : start !== null ? defaultSpan(t.type, new Date(start)).end.getTime() : null
              // Clamp bars to the loaded window so they don't widen the scroll area.
              const bx = start !== null ? Math.max(x(start), 0) : 0
              const bw = start !== null && end !== null ? Math.max(Math.min(x(end), width) - bx, 6) : 0
              const color = t.status === 'done' ? 'bg-emerald-500' : taskColor(t)
              const inWindow = start !== null && end !== null && end > range.start && start < range.end
              return (
                <div
                  key={t.id}
                  className="group absolute left-0 z-10 flex border-b border-slate-100 hover:bg-blue-50/40"
                  style={{ height: ROW_H, top: (first + i) * ROW_H, width: LEFT + width }}
                >
                  <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-slate-200 bg-white pr-2 group-hover:bg-blue-50" style={{ width: LEFT, paddingLeft: 8 + depth * 20 }}>
                    {hasChildren.has(t.id) ? (
                      <button className="rounded p-0.5 text-slate-400 hover:bg-slate-200" onClick={() => toggle(t.id)}>
                        {collapsed.has(t.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                    ) : (
                      <span className="w-[18px]" />
                    )}
                    <span className={clsx('h-2 w-2 shrink-0', taskColor(t), t.type === 'project' ? 'rounded-sm' : 'rounded-full')} title={t.type} />
                    <span className="shrink-0 text-[11px] font-medium text-slate-400">{t.key}</span>
                    {t.environment_name && <EnvBadge name={t.environment_name} color={t.environment_color} size="xs" />}
                    {t.project_kind && (
                      <span
                        className={clsx(
                          'shrink-0 rounded px-1 text-[9px] font-bold tracking-wide uppercase',
                          t.project_kind === 'long' ? 'bg-amber-100 text-amber-800' : 'bg-orange-100 text-orange-700',
                        )}
                        title={t.project_kind === 'long' ? 'Long project (a quarter or more)' : 'Short project (about a month)'}
                      >
                        {t.project_kind}
                      </span>
                    )}
                    <button className={clsx('min-w-0 flex-1 truncate text-left text-sm', t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700', t.type === 'project' && 'font-semibold')} onClick={() => modal.openTask(t.id)} title={t.title}>
                      {t.title}
                    </button>
                    {t.type !== 'hourly' && canEdit && (
                      <button
                        className="hidden rounded p-0.5 text-slate-400 hover:bg-slate-200 group-hover:block"
                        title={`Add ${defaultChildType(t.type)} task inside`}
                        onClick={() => modal.createTask({ title: '', parent_id: t.id, type: defaultChildType(t.type) })}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                    <AvatarStack ids={t.assignee_ids} max={2} />
                  </div>

                  <div
                    className="relative"
                    style={{ width }}
                    onClick={(e) => !t.start_at && !rollup && scheduleAt(t, e.clientX)}
                    title={t.start_at || rollup ? undefined : 'Click to schedule'}
                  >
                    {start === null && rollup ? (
                      // Summary bar: spans the tasks inside; set the project's own dates to move it.
                      <button
                        className={clsx(
                          'absolute top-[10px] h-3 rounded-sm border-2',
                          t.project_kind === 'short' ? 'border-orange-400 bg-orange-100/70' : 'border-amber-500 bg-amber-100/70',
                        )}
                        style={{ left: Math.max(x(rollup.start), 0), width: Math.max(Math.min(x(rollup.end), width) - Math.max(x(rollup.start), 0), 6) }}
                        title={`${t.key} · ${t.title}
Spans its tasks: ${formatSchedule({ type: 'daily', start_at: new Date(rollup.start).toISOString(), end_at: new Date(rollup.end).toISOString() })}`}
                        onClick={() => modal.openTask(t.id)}
                      />
                    ) : start !== null ? (
                      inWindow && <div
                        className={clsx(
                          'absolute flex items-center overflow-visible rounded shadow-sm',
                          canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          color,
                          depth ? 'top-[9px] h-4' : 'top-[6px] h-[22px]',
                          p && 'ring-2 ring-blue-300',
                        )}
                        style={{ left: bx, width: bw }}
                        title={`${t.key} · ${t.title}\n${formatSchedule({ type: t.type, start_at: new Date(start).toISOString(), end_at: end ? new Date(end).toISOString() : null })}`}
                        onPointerDown={(e) => onBarPointerDown(e, t, 'move')}
                        onPointerMove={onBarPointerMove}
                        onPointerUp={() => onBarPointerUp(t)}
                        onPointerCancel={() => {
                          dragRef.current = null
                          setPreview(null)
                        }}
                      >
                        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-black/20" style={{ width: `${t.progress}%` }} />
                        <span
                          className={clsx(
                            'pointer-events-none px-1.5 text-[11px] font-medium whitespace-nowrap',
                            bw > 70 ? 'relative truncate text-white' : 'absolute left-full ml-1 text-slate-600',
                          )}
                        >
                          {t.title}
                        </span>
                        {(['start', 'end'] as const).map((edge) => (
                          <div
                            key={edge}
                            className={clsx('absolute inset-y-0 w-2 cursor-ew-resize rounded bg-white/0 hover:bg-white/40', edge === 'start' ? 'left-0' : 'right-0')}
                            onPointerDown={(e) => onBarPointerDown(e, t, edge)}
                            onPointerMove={onBarPointerMove}
                            onPointerUp={() => onBarPointerUp(t)}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="pointer-events-none sticky inline-block px-3 text-xs leading-[34px] text-slate-400 italic opacity-0 group-hover:opacity-100" style={{ left: LEFT }}>
                        Not scheduled — click on the timeline to place it
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Drag bars to reschedule, drag edges to resize. Hourly tasks snap to {zoom.snapMin >= 1440 ? '1 day' : `${zoom.snapMin} min`} at this zoom; daily tasks snap to whole days. Ctrl + scroll to zoom.
      </p>
    </div>
  )
}
