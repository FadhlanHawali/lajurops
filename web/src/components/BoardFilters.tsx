import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { CalendarDays, Check, ChevronDown, CornerDownLeft, FolderKanban, Search } from 'lucide-react'
import type { Task } from '../lib/types'
import { matchScore } from './ParentPicker'
import { Popover } from './Popover'
import { taskColor } from './ui'

/** Compact trigger matching the filter bar's selects. */
function FilterTrigger({ icon: Icon, label, open, active, ...props }: { icon: typeof Search; label: React.ReactNode; open: boolean; active?: boolean } & Record<string, unknown>) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'flex max-w-72 items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-sm transition',
        open ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-300 hover:border-slate-400',
        active && 'font-medium text-blue-700',
      )}
    >
      <Icon size={14} className="shrink-0 text-slate-400" />
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown size={14} className="shrink-0 text-slate-400" />
    </button>
  )
}

// --- project filter ---------------------------------------------------------

/** '' = all, 'none' = independent tasks, otherwise a project id. */
export function ProjectFilter({ value, onChange, projects }: { value: string; onChange: (v: string) => void; projects: Task[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const fixed = [
    { id: '', label: 'All projects' },
    { id: 'none', label: 'Independent tasks' },
  ]
  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    const openFirst = (a: Task, b: Task) => Number(a.status === 'done') - Number(b.status === 'done')
    if (!q) return [...projects].sort((a, b) => openFirst(a, b) || a.title.localeCompare(b.title))
    return projects
      .map((p) => ({ p, s: matchScore(p, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || openFirst(a.p, b.p) || a.p.title.localeCompare(b.p.title))
      .map((r) => r.p)
  }, [projects, q])
  // While searching only matching projects are listed; otherwise the two fixed rows come first.
  const rows: { id: string; label: string; project?: Task }[] = [...(q ? [] : fixed), ...results.map((p) => ({ id: p.id, label: p.title, project: p }))]

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
  }
  const selected = projects.find((p) => p.id === value)
  const label = selected ? selected.title : (fixed.find((f) => f.id === value)?.label ?? 'All projects')

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setQuery('')
      }}
      trigger={(props, isOpen) => <FilterTrigger icon={FolderKanban} label={label} open={isOpen} active={!!value} {...props} />}
    >
      <div className="w-80">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            autoFocus
            className="w-full bg-transparent text-sm focus:outline-none"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && rows[active]) {
                e.preventDefault()
                pick(rows[active].id)
              }
            }}
          />
        </div>
        <ul ref={listRef} className="max-h-72 overflow-y-auto p-1">
          {rows.map((r, i) => (
            <li
              key={r.id || 'all'}
              data-row={i}
              role="option"
              aria-selected={r.id === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r.id)}
              className={clsx('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', i === active && 'bg-blue-50')}
            >
              {r.project ? (
                <>
                  <span className={clsx('h-2 w-2 shrink-0 rounded-sm', taskColor(r.project))} />
                  <span className="w-14 shrink-0 text-xs font-medium text-slate-400">{r.project.key}</span>
                  <span className={clsx('min-w-0 flex-1 truncate', r.project.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>{r.label}</span>
                  <span className={clsx('shrink-0 text-[10px] font-medium uppercase', r.project.project_kind === 'short' ? 'text-orange-600' : 'text-amber-700')}>
                    {r.project.project_kind}
                  </span>
                </>
              ) : (
                <span className="flex-1 text-slate-600">{r.label}</span>
              )}
              {r.id === value && <Check size={14} className="shrink-0 text-blue-600" />}
            </li>
          ))}
          {rows.length === 0 && <li className="px-2 py-3 text-center text-sm text-slate-400">No matching projects</li>}
        </ul>
        <div className="flex justify-between border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
          <span>{q ? `${results.length} match${results.length === 1 ? '' : 'es'}` : `${projects.length} project${projects.length === 1 ? '' : 's'} · type to search`}</span>
          <span className="flex items-center gap-1">
            ↑↓ <CornerDownLeft size={10} />
          </span>
        </div>
      </div>
    </Popover>
  )
}

// --- date filter ------------------------------------------------------------

/** Inclusive day range; null = all dates. */
export type DateRangeFilter = { from: Date; to: Date } | null

const week = (d: Date) => ({ from: startOfWeek(d, { weekStartsOn: 1 }), to: endOfWeek(d, { weekStartsOn: 1 }) })
const month = (d: Date) => ({ from: startOfMonth(d), to: endOfMonth(d) })

function presets() {
  const today = new Date()
  return [
    { label: 'Today', range: { from: startOfDay(today), to: startOfDay(today) } },
    { label: 'This week', range: week(today) },
    { label: 'Last week', range: week(addWeeks(today, -1)) },
    { label: 'Next week', range: week(addWeeks(today, 1)) },
    { label: 'This month', range: month(today) },
    { label: 'Last month', range: month(addMonths(today, -1)) },
  ]
}

export const thisWeek = (): DateRangeFilter => week(new Date())

const sameRange = (a: DateRangeFilter, b: DateRangeFilter) => !!a && !!b && isSameDay(a.from, b.from) && isSameDay(a.to, b.to)

/**
 * Whether a task's schedule overlaps the range. Task ends are exclusive
 * (a daily task ending "Oct 3" is stored as Oct 4 00:00). Tasks without
 * dates still show unless they're done, so unscheduled work isn't hidden.
 */
export function inDateRange(t: Pick<Task, 'start_at' | 'end_at' | 'status'>, r: DateRangeFilter): boolean {
  if (!r) return true
  const start = t.start_at ? new Date(t.start_at) : null
  const end = t.end_at ? new Date(t.end_at) : null
  if (!start && !end) return t.status !== 'done'
  const from = startOfDay(r.from)
  const until = addDays(startOfDay(r.to), 1)
  const s = start ?? end!
  const e = end ?? new Date(s.getTime() + 1)
  return s < until && e > from
}

export function DateFilter({ value, onChange }: { value: DateRangeFilter; onChange: (r: DateRangeFilter) => void }) {
  const [open, setOpen] = useState(false)
  const [pickStart, setPickStart] = useState<Date | null>(null) // first click of a custom range
  const list = presets()
  const preset = list.find((p) => sameRange(p.range, value))
  const fmt = (d: Date) => format(d, d.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy')
  const label = !value ? 'All dates' : preset ? `${preset.label} · ${fmt(value.from)}${isSameDay(value.from, value.to) ? '' : ` – ${fmt(value.to)}`}` : `${fmt(value.from)} – ${fmt(value.to)}`

  const set = (r: DateRangeFilter) => {
    onChange(r)
    setOpen(false)
  }
  const onDayClick = (day: Date) => {
    if (!pickStart || day < pickStart) return setPickStart(day)
    set({ from: pickStart, to: day })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        setPickStart(null)
      }}
      trigger={(props, isOpen) => <FilterTrigger icon={CalendarDays} label={label} open={isOpen} active={!!value} {...props} />}
    >
      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 p-2.5">
        {[...list, { label: 'All dates', range: null }].map((p) => {
          const on = p.range ? sameRange(p.range, value) : !value
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => set(p.range)}
              className={clsx(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition',
                on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <DayPicker
        weekStartsOn={1}
        showOutsideDays
        fixedWeeks
        className="planner-rdp"
        mode="range"
        defaultMonth={value?.from ?? new Date()}
        selected={pickStart ? { from: pickStart, to: pickStart } : value ? { from: value.from, to: value.to } : undefined}
        onDayClick={onDayClick}
      />
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        {pickStart ? 'Now pick the end date' : 'Or pick a start date for a custom range'}
      </p>
    </Popover>
  )
}
