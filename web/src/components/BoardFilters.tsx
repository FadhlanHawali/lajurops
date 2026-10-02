import { useState } from 'react'
import clsx from 'clsx'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { CalendarDays, FolderKanban, Layers } from 'lucide-react'
import type { Task } from '../lib/types'
import { Popover } from './Popover'
import { FilterTrigger, SearchSelect, type SearchOption } from './SearchSelect'
import { taskColor } from './ui'

// --- project filter ---------------------------------------------------------

/** '' = all, 'none' = independent tasks, otherwise a project id. */
export function ProjectFilter({ value, onChange, projects }: { value: string; onChange: (v: string) => void; projects: Task[] }) {
  const options: SearchOption[] = [
    { id: '', label: 'All projects', fixed: true },
    { id: 'none', label: 'Independent tasks', fixed: true },
    ...projects.map((p) => ({
      id: p.id,
      label: p.title,
      keywords: [p.key],
      dimmed: p.status === 'done',
      row: (
        <>
          <span className={clsx('h-2 w-2 shrink-0 rounded-sm', taskColor(p))} />
          <span className="w-14 shrink-0 text-xs font-medium text-slate-400">{p.key}</span>
          <span className={clsx('min-w-0 flex-1 truncate', p.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>{p.title}</span>
          <span className={clsx('shrink-0 text-[10px] font-medium uppercase', p.project_kind === 'short' ? 'text-orange-600' : 'text-amber-700')}>{p.project_kind}</span>
        </>
      ),
    })),
  ]
  return <SearchSelect value={value} onChange={onChange} options={options} icon={FolderKanban} placeholder="All projects" noun="projects" width="w-80" />
}

// --- environment filter -----------------------------------------------------

/** '' = all, 'none' = no environment, otherwise a lower-cased environment name. */
export function EnvironmentFilter({ value, onChange, names }: { value: string; onChange: (v: string) => void; names: string[] }) {
  const options: SearchOption[] = [
    { id: '', label: 'All environments', fixed: true },
    { id: 'none', label: 'No environment', fixed: true },
    ...names.map((n) => ({ id: n.toLowerCase(), label: n })),
  ]
  return <SearchSelect value={value} onChange={onChange} options={options} icon={Layers} placeholder="All environments" noun="environments" width="w-64" />
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
