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
import { Avatar, Button, FilterBar, Empty } from '../components/ui'
import { defaultSpan, formatSchedule } from '../lib/dates'
import { useTaskFilters, useTasks, useUpdateTask, useUsers } from '../lib/queries'
import type { Task } from '../lib/types'

type Unit = 'hour' | '6h' | 'day' | 'week' | 'month' | 'year'

interface Zoom {
  id: string
  label: string
  pxPerHour: number
  top: Unit
  bottom: Unit
  /** Drag snapping for hourly tasks, in minutes. Daily tasks always snap to whole days. */
  snapMin: number
  /** Empty space shown around the scheduled tasks, in hours. */
  padHours: number
}

const ZOOMS: Zoom[] = [
  { id: 'hour', label: 'Hour', pxPerHour: 56, top: 'day', bottom: 'hour', snapMin: 15, padHours: 24 },
  { id: '6h', label: '6 Hours', pxPerHour: 14, top: 'day', bottom: '6h', snapMin: 60, padHours: 72 },
  { id: 'day', label: 'Day', pxPerHour: 2.5, top: 'month', bottom: 'day', snapMin: 60, padHours: 24 * 14 },
  { id: 'week', label: 'Week', pxPerHour: 0.75, top: 'month', bottom: 'week', snapMin: 1440, padHours: 24 * 56 },
  { id: 'month', label: 'Month', pxPerHour: 0.18, top: 'year', bottom: 'month', snapMin: 1440, padHours: 24 * 180 },
]

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

export default function Gantt({ projectId }: { projectId: string }) {
  const { assignee, type } = useTaskFilters()
  const { data: tasks = [], isLoading } = useTasks({ project_id: projectId, assignee_id: assignee, type })
  const update = useUpdateTask()
  const modal = useTaskModal()
  const { byId: users } = useUsers()
  const now = useNow()

  const [zoomIdx, setZoomIdx] = useState(() => {
    const saved = localStorage.getItem('gantt.zoom')
    const i = ZOOMS.findIndex((z) => z.id === saved)
    return i >= 0 ? i : 2
  })
  const zoom = ZOOMS[zoomIdx]
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ id: string; start: number; end: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingCenter = useRef<number | null>(null)

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
    const out: Row[] = []
    for (const t of top) {
      out.push({ task: t, depth: 0 })
      if (!collapsed.has(t.id)) for (const c of (children.get(t.id) ?? []).sort(byStart)) out.push({ task: c, depth: 1 })
    }
    return out
  }, [tasks, collapsed])

  const hasChildren = useMemo(() => new Set(tasks.filter((t) => t.parent_id).map((t) => t.parent_id!)), [tasks])

  // Visible time range: all scheduled tasks and "now", plus padding.
  const range = useMemo(() => {
    let min = now.getTime()
    let max = now.getTime()
    for (const t of tasks) {
      if (!t.start_at) continue
      min = Math.min(min, Date.parse(t.start_at))
      max = Math.max(max, Date.parse(t.end_at ?? t.start_at))
    }
    const start = unitStart(zoom.top, new Date(min - zoom.padHours * HOUR_MS))
    const end = unitAdd(zoom.top, unitStart(zoom.top, new Date(max + zoom.padHours * HOUR_MS)), 1)
    return { start: start.getTime(), end: end.getTime() }
    // `now` only matters for the initial range; don't rebuild the axis every minute.
  }, [tasks, zoom])

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
    if (el && next !== zoomIdx) pendingCenter.current = timeAt(el.getBoundingClientRect().left + LEFT + (el.clientWidth - LEFT) / 2)
    setZoomIdx(next)
  }
  useLayoutEffect(() => {
    if (pendingCenter.current !== null) {
      scrollToTime(pendingCenter.current, 0.5)
      pendingCenter.current = null
    }
  }, [zoomIdx])

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
    dragRef.current = { id: t.id, mode, x0: e.clientX, s0, e0, snapMin: t.type === 'daily' ? 1440 : zoom.snapMin, moved: false }
  }

  const onBarPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
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
    const at = new Date(snap(timeAt(clientX), t.type === 'daily' ? 1440 : zoom.snapMin))
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
  const bodyH = rows.length * ROW_H

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
          <Button onClick={() => scrollToTime(Date.now())}>
            <Crosshair size={14} /> Now
          </Button>
          <Button
            variant="ghost"
            title={collapsed.size ? 'Expand all' : 'Collapse all'}
            onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(hasChildren))}
          >
            {collapsed.size ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
          </Button>
          <Button variant="primary" onClick={() => modal.createTask({ title: '', project_id: projectId })}>
            <Plus size={14} /> Task
          </Button>
        </div>
      </div>

      {!isLoading && rows.length === 0 ? (
        <Empty>No tasks yet. Create one to see it on the timeline.</Empty>
      ) : (
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white select-none">
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

            {/* Rows */}
            {rows.map(({ task: t, depth }) => {
              const p = preview?.id === t.id ? preview : null
              const start = p ? p.start : t.start_at ? Date.parse(t.start_at) : null
              const end = p ? p.end : t.end_at ? Date.parse(t.end_at) : start !== null ? defaultSpan(t.type, new Date(start)).end.getTime() : null
              const bx = start !== null ? x(start) : 0
              const bw = start !== null && end !== null ? Math.max(x(end) - bx, 6) : 0
              const assignee = t.assignee_id ? users.get(t.assignee_id) : null
              const color = t.status === 'done' ? 'bg-emerald-500' : t.type === 'hourly' ? 'bg-violet-500' : 'bg-sky-500'
              return (
                <div key={t.id} className="group relative z-10 flex border-b border-slate-100 hover:bg-blue-50/40" style={{ height: ROW_H }}>
                  <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-slate-200 bg-white pr-2 group-hover:bg-blue-50" style={{ width: LEFT, paddingLeft: 8 + depth * 20 }}>
                    {depth === 0 && hasChildren.has(t.id) ? (
                      <button className="rounded p-0.5 text-slate-400 hover:bg-slate-200" onClick={() => toggle(t.id)}>
                        {collapsed.has(t.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                    ) : (
                      <span className="w-[18px]" />
                    )}
                    <span className={clsx('h-2 w-2 shrink-0 rounded-full', t.type === 'hourly' ? 'bg-violet-500' : 'bg-sky-500')} title={t.type} />
                    <span className="shrink-0 text-[11px] font-medium text-slate-400">{t.key}</span>
                    <button className={clsx('min-w-0 flex-1 truncate text-left text-sm', t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700')} onClick={() => modal.openTask(t.id)} title={t.title}>
                      {t.title}
                    </button>
                    {depth === 0 && !t.parent_id && (
                      <button
                        className="hidden rounded p-0.5 text-slate-400 hover:bg-slate-200 group-hover:block"
                        title="Add subtask"
                        onClick={() => modal.createTask({ title: '', parent_id: t.id, type: t.type, assignee_id: t.assignee_id })}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                    <Avatar user={assignee} />
                  </div>

                  <div
                    className="relative"
                    style={{ width }}
                    onClick={(e) => !t.start_at && scheduleAt(t, e.clientX)}
                    title={t.start_at ? undefined : 'Click to schedule'}
                  >
                    {start !== null ? (
                      <div
                        className={clsx(
                          'absolute flex cursor-grab items-center overflow-visible rounded shadow-sm active:cursor-grabbing',
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
      )}
      <p className="text-xs text-slate-400">
        Drag bars to reschedule, drag edges to resize. Hourly tasks snap to {zoom.snapMin >= 1440 ? '1 day' : `${zoom.snapMin} min`} at this zoom; daily tasks snap to whole days. Ctrl + scroll to zoom.
      </p>
    </div>
  )
}
