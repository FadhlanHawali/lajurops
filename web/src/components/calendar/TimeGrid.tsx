import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { addDays, addMinutes, format, isSameDay, isToday, startOfDay } from 'date-fns'
import type { CalendarItem, TaskGroup } from '../../lib/calendarGroups'
import { itemEnd, itemId, itemStart, layoutLanes, layoutTimed, moreGroup, itemTasks } from '../../lib/calendarLayout'
import type { Task } from '../../lib/types'
import { hhmm, itemStyle, itemTitle, TaskLabel } from './items'

const HOUR = 48 // px per hour
const SLOT_MIN = 30
const SLOT = (HOUR * SLOT_MIN) / 60
const LANE = 22 // px per all-day lane
const MAX_LANES = 3
const MAX_COLS = 4
const GUTTER = 52

/** Week or day view: an all-day row over a 24-hour time grid. */
export function TimeGrid({
  days,
  items,
  onOpenTask,
  onOpenGroup,
  onCreate,
}: {
  days: Date[]
  items: CalendarItem[]
  onOpenTask: (t: Task) => void
  onOpenGroup: (g: TaskGroup) => void
  /** Creating by clicking or dragging over empty time; null when the user can't. */
  onCreate: ((start: Date, end: Date, allDay: boolean) => void) | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const now = useNow()
  const allDay = items.filter((it) => (it.kind === 'group' ? it.group.allDay : it.allDay))
  const timed = items.filter((it) => !(it.kind === 'group' ? it.group.allDay : it.allDay))

  // Open at 07:00, like a working day.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR - 12
  }, [])

  // All-day row: lanes, capped, with "+N more" per day.
  const lanes = layoutLanes(allDay, days)
  const hiddenByDay = days.map((_, i) => lanes.filter((l) => l.lane >= MAX_LANES && l.from <= i && l.to > i))
  const shownLanes = Math.min(MAX_LANES, Math.max(0, ...lanes.map((l) => l.lane + 1)))
  const allDayH = Math.max(shownLanes, 1) * LANE + (hiddenByDay.some((h) => h.length) ? 18 : 0) + 6

  // Drag over empty time to create (a click makes one 30-minute slot).
  const [sel, setSel] = useState<{ day: number; a: number; b: number } | null>(null)
  useEffect(() => {
    if (!sel) return
    const up = () => {
      const lo = Math.min(sel.a, sel.b)
      const hi = Math.max(sel.a, sel.b) + 1
      const d = startOfDay(days[sel.day])
      setSel(null)
      onCreate?.(addMinutes(d, lo * SLOT_MIN), addMinutes(d, hi * SLOT_MIN), false)
    }
    window.addEventListener('pointerup', up, { once: true })
    return () => window.removeEventListener('pointerup', up)
  }, [sel, days, onCreate])
  const slotAt = (e: React.PointerEvent, el: HTMLElement) => Math.max(0, Math.min(47, Math.floor((e.clientY - el.getBoundingClientRect().top) / SLOT)))

  const open = (it: CalendarItem) => (it.kind === 'group' ? onOpenGroup(it.group) : onOpenTask(it.task))
  const cols = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto select-none" style={{ scrollbarGutter: 'stable' }}>
      {/* Day headers and the all-day row stay on top while scrolling. */}
      <div className="sticky top-0 z-20 bg-white">
        <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((d) => (
            <div key={d.toISOString()} className={clsx('border-l border-slate-200 py-1.5 text-center text-sm', isToday(d) ? 'font-semibold text-blue-700' : 'text-slate-700')}>
              {format(d, days.length === 1 ? 'EEEE d MMMM' : 'EEE d')}
            </div>
          ))}
        </div>
        <div className="grid border-b-2 border-slate-200" style={{ gridTemplateColumns: cols }}>
          <div className="pt-1 pr-2 text-right text-[11px] text-slate-400">all-day</div>
          <div className="relative" style={{ gridColumn: `span ${days.length}`, height: allDayH }}>
            {days.map((d, i) => (
              <div
                key={d.toISOString()}
                className={clsx('absolute inset-y-0 border-l border-slate-200', isToday(d) && 'bg-blue-50/40', onCreate && 'cursor-pointer hover:bg-slate-50')}
                style={{ left: `${(i / days.length) * 100}%`, width: `${100 / days.length}%` }}
                onClick={() => onCreate?.(startOfDay(d), addDays(startOfDay(d), 1), true)}
                title={onCreate ? 'Click to add a daily task' : undefined}
              />
            ))}
            {lanes
              .filter((l) => l.lane < MAX_LANES)
              .map((l) => (
                <button
                  key={itemId(l.item)}
                  type="button"
                  title={itemTitle(l.item)}
                  onClick={() => open(l.item)}
                  className="absolute truncate rounded px-1.5 text-left text-[11px] leading-5 hover:brightness-95"
                  style={{ ...itemStyle(l.item), top: 3 + l.lane * LANE, height: LANE - 3, left: `calc(${(l.from / days.length) * 100}% + 2px)`, width: `calc(${((l.to - l.from) / days.length) * 100}% - 4px)` }}
                >
                  {l.item.kind === 'group' ? (
                    <>
                      <b className="font-semibold">{l.item.group.label}</b> · {l.item.group.tasks.length}
                    </>
                  ) : (
                    <TaskLabel task={l.item.task} />
                  )}
                </button>
              ))}
            {hiddenByDay.map((hidden, i) =>
              hidden.length ? (
                <button
                  key={i}
                  type="button"
                  className="absolute bottom-0.5 rounded px-1.5 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                  style={{ left: `calc(${(i / days.length) * 100}% + 2px)` }}
                  onClick={() => {
                    const d = startOfDay(days[i])
                    const all = lanes.filter((l) => l.from <= i && l.to > i).flatMap((l) => itemTasks(l.item))
                    onOpenGroup({ ...moreGroup(all, d, addDays(d, 1), true), label: `All day · ${format(d, 'EEE d MMM')}` })
                  }}
                >
                  +{hidden.length} more
                </button>
              ) : null,
            )}
          </div>
        </div>
      </div>

      {/* Time grid */}
      <div className="grid" style={{ gridTemplateColumns: cols }}>
        <div className="relative" style={{ height: 24 * HOUR }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums" style={{ top: h * HOUR }}>
              {h ? `${String(h).padStart(2, '0')}:00` : ''}
            </span>
          ))}
        </div>
        {days.map((d, di) => {
          const dayStart = startOfDay(d).getTime()
          const mine = timed.filter((it) => isSameDay(new Date(itemStart(it)), d))
          const placed = layoutTimed(mine, MAX_COLS)
          const nowTop = isSameDay(now, d) ? ((now.getTime() - dayStart) / 3_600_000) * HOUR : null
          return (
            <div
              key={d.toISOString()}
              className={clsx('relative border-l border-slate-200', isToday(d) && 'bg-blue-50/30', onCreate && 'cursor-cell')}
              style={{
                height: 24 * HOUR,
                backgroundImage: `repeating-linear-gradient(to bottom, #e2e8f0 0 1px, transparent 1px ${HOUR / 2}px, #f1f5f9 ${HOUR / 2}px ${HOUR / 2 + 1}px, transparent ${HOUR / 2 + 1}px ${HOUR}px)`,
              }}
              onPointerDown={(e) => {
                if (!onCreate || e.button !== 0 || e.target !== e.currentTarget) return
                const s = slotAt(e, e.currentTarget)
                setSel({ day: di, a: s, b: s })
              }}
              onPointerMove={(e) => sel && sel.day === di && setSel({ ...sel, b: slotAt(e, e.currentTarget) })}
            >
              {sel?.day === di && (
                <div
                  className="pointer-events-none absolute inset-x-1 z-10 rounded bg-blue-500/20 ring-1 ring-blue-500"
                  style={{ top: Math.min(sel.a, sel.b) * SLOT, height: (Math.abs(sel.a - sel.b) + 1) * SLOT }}
                >
                  <span className="px-1 text-[11px] font-medium text-blue-800">
                    {hhmm(addMinutes(startOfDay(d), Math.min(sel.a, sel.b) * SLOT_MIN))}–{hhmm(addMinutes(startOfDay(d), (Math.max(sel.a, sel.b) + 1) * SLOT_MIN))}
                  </span>
                </div>
              )}
              {placed.map(({ item, col, ncol }) => {
                const s = itemStart(item)
                const e = Math.max(itemEnd(item), s + 20 * 60_000)
                const top = ((s - dayStart) / 3_600_000) * HOUR
                const h = Math.max(((e - s) / 3_600_000) * HOUR - 2, 18)
                const g = item.kind === 'group' ? item.group : null
                return (
                  <button
                    key={itemId(item)}
                    type="button"
                    title={itemTitle(item)}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => open(item)}
                    className="absolute z-[5] overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:z-[6] hover:brightness-95"
                    style={{ ...itemStyle(item), top: top + 1, height: h, left: `calc(${(col / ncol) * 100}% + 1px)`, width: `calc(${100 / ncol}% - 2px)` }}
                  >
                    {g ? (
                      <>
                        <span className="block truncate font-semibold">{g.label}</span>
                        <span className="block">{g.tasks.length} tasks</span>
                        {h > 46 && <span className="block truncate opacity-80">{[...new Set(g.tasks.map((t) => t.environment_name).filter(Boolean))].join(' · ')}</span>}
                      </>
                    ) : (
                      <>
                        <span className="block opacity-90 tabular-nums">
                          {hhmm(new Date(s))}–{hhmm(new Date(itemEnd(item)))}
                        </span>
                        <span className="block">
                          {item.kind === 'task' && <TaskLabel task={item.task} />}
                        </span>
                      </>
                    )}
                  </button>
                )
              })}
              {nowTop !== null && (
                <div className="pointer-events-none absolute inset-x-0 z-[7] h-0.5 bg-red-500" style={{ top: nowTop }}>
                  <span className="absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}
