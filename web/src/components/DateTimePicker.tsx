import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { DayPicker, type DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  differenceInMinutes,
  endOfMonth,
  format,
  isSameDay,
  isValid,
  nextMonday,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ArrowRight, CalendarDays, Clock } from 'lucide-react'
import { formatDuration } from '../lib/dates'
import { Popover, TriggerButton } from './Popover'

// Values use the same string formats as native inputs so forms stay simple:
// dates are "yyyy-MM-dd", date-times are "yyyy-MM-dd'T'HH:mm" (local time).
const DATE = 'yyyy-MM-dd'
const DATETIME = "yyyy-MM-dd'T'HH:mm"

const parseDate = (s: string) => {
  const d = parse(s, DATE, new Date())
  return isValid(d) ? d : undefined
}
const parseDateTime = (s: string) => {
  const d = parse(s, DATETIME, new Date())
  return isValid(d) ? d : undefined
}
const fmtDate = (d: Date) => format(d, DATE)
const fmtDateTime = (d: Date) => format(d, DATETIME)

/** "Mon, Oct 5", with the year only when it isn't the current one. */
const friendlyDate = (d: Date) => format(d, d.getFullYear() === new Date().getFullYear() ? 'EEE, MMM d' : 'EEE, MMM d, yyyy')

/** Parses what people type into a time box: "930", "9:30", "21.15", "9pm", "9:30 am". */
export function parseTime(input: string): [number, number] | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '')
  const m = s.match(/^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|a|p)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ampm = m[3]?.[0]
  if (ampm) {
    if (h < 1 || h > 12) return null
    if (ampm === 'p' && h !== 12) h += 12
    if (ampm === 'a' && h === 12) h = 0
  }
  if (h > 23 || min > 59) return null
  return [h, min]
}

function Presets({ items }: { items: { label: string; onClick: () => void; active?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-slate-100 p-2.5">
      {items.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={p.onClick}
          className={clsx(
            'rounded-full border px-2.5 py-0.5 text-xs font-medium transition',
            p.active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

const calendarProps = {
  weekStartsOn: 1 as const,
  showOutsideDays: true,
  fixedWeeks: true,
  className: 'planner-rdp',
}

// --- date range (daily tasks, projects) -------------------------------------

/** Start/end dates, both inclusive, as "yyyy-MM-dd" strings. */
export function DateRangeField({
  start,
  end,
  onChange,
  placeholder = 'Pick dates',
}: {
  start: string
  end: string
  onChange: (start: string, end: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  // After the first click we wait for the end date; hovering previews the range.
  const [pickingEnd, setPickingEnd] = useState(false)
  const [hover, setHover] = useState<Date>()
  const from = parseDate(start)
  const to = parseDate(end) ?? from
  const [month, setMonth] = useState<Date>(from ?? new Date())

  const setOpenState = (o: boolean) => {
    setOpen(o)
    setPickingEnd(false)
    setHover(undefined)
    if (o) setMonth(from ?? new Date())
  }

  const selected: DateRange | undefined = from
    ? pickingEnd && hover && hover >= from
      ? { from, to: hover }
      : { from, to }
    : undefined

  const onDayClick = (day: Date) => {
    if (!pickingEnd || !from || day < from) {
      onChange(fmtDate(day), fmtDate(day))
      setPickingEnd(true)
    } else {
      onChange(fmtDate(from), fmtDate(day))
      setOpenState(false)
    }
  }

  const today = new Date()
  const set = (a: Date, b: Date) => {
    onChange(fmtDate(a), fmtDate(b))
    setOpenState(false)
  }
  const presets = [
    { label: 'Today', a: today, b: today },
    { label: 'Tomorrow', a: addDays(today, 1), b: addDays(today, 1) },
    { label: 'This week', a: today, b: addDays(startOfWeek(today, { weekStartsOn: 1 }), 4) },
    { label: 'Next week', a: nextMonday(today), b: addDays(nextMonday(today), 4) },
    { label: 'This month', a: today, b: endOfMonth(today) },
    { label: 'Next month', a: startOfMonth(addDays(endOfMonth(today), 1)), b: endOfMonth(addDays(endOfMonth(today), 1)) },
  ].filter((p) => p.b >= p.a)

  const days = from && to ? differenceInCalendarDays(to, from) + 1 : 0

  return (
    <Popover
      open={open}
      onOpenChange={setOpenState}
      trigger={(props, isOpen) => (
        <TriggerButton icon={CalendarDays} placeholder={placeholder} open={isOpen} onClear={() => onChange('', '')} {...props}>
          {from && to && (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate pr-5">
              <span className="font-medium text-slate-800">{friendlyDate(from)}</span>
              {!isSameDay(from, to) && (
                <>
                  <ArrowRight size={12} className="shrink-0 text-slate-400" />
                  <span className="font-medium text-slate-800">{friendlyDate(to)}</span>
                </>
              )}
              <span className="ml-auto shrink-0 text-xs text-slate-400">
                {days} day{days === 1 ? '' : 's'}
              </span>
            </span>
          )}
        </TriggerButton>
      )}
    >
      <Presets
        items={presets.map((p) => ({
          label: p.label,
          onClick: () => set(p.a, p.b),
          active: !!from && !!to && isSameDay(from, p.a) && isSameDay(to, p.b),
        }))}
      />
      <DayPicker
        {...calendarProps}
        mode="range"
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onDayClick={onDayClick}
        onDayMouseEnter={(d) => pickingEnd && setHover(d)}
        onDayMouseLeave={() => setHover(undefined)}
      />
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        {pickingEnd ? 'Now pick the end date (or the same day again)' : 'Pick a start date'}
      </p>
    </Popover>
  )
}

/** A single date as "yyyy-MM-dd" (e.g. the day of a runbook step's daily task). */
export function DateField({ value, onChange, placeholder = 'Pick a date' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const current = parseDate(value)
  const [month, setMonth] = useState<Date>(current ?? new Date())
  useEffect(() => {
    if (open) setMonth(current ?? new Date())
  }, [open])
  const pick = (d: Date) => {
    onChange(fmtDate(d))
    setOpen(false)
  }
  const today = new Date()
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={(props, isOpen) => (
        <TriggerButton icon={CalendarDays} placeholder={placeholder} open={isOpen} onClear={() => onChange('')} {...props}>
          {current && <span className="flex-1 truncate pr-5 font-medium text-slate-800">{friendlyDate(current)}</span>}
        </TriggerButton>
      )}
    >
      <Presets
        items={[
          { label: 'Today', onClick: () => pick(today), active: !!current && isSameDay(current, today) },
          { label: 'Tomorrow', onClick: () => pick(addDays(today, 1)), active: !!current && isSameDay(current, addDays(today, 1)) },
          { label: 'Next Monday', onClick: () => pick(nextMonday(today)), active: !!current && isSameDay(current, nextMonday(today)) },
        ]}
      />
      <DayPicker {...calendarProps} mode="single" required month={month} onMonthChange={setMonth} selected={current} onSelect={(d) => d && pick(d)} />
    </Popover>
  )
}

// --- date + time (hourly tasks) --------------------------------------------

const SLOT_MIN = 15

function TimeList({ value, onPick, relativeTo }: { value?: Date; onPick: (h: number, m: number) => void; relativeTo?: Date }) {
  const [text, setText] = useState(value ? format(value, 'HH:mm') : '')
  const [invalid, setInvalid] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const slots = useMemo(() => Array.from({ length: (24 * 60) / SLOT_MIN }, (_, i) => [Math.floor((i * SLOT_MIN) / 60), (i * SLOT_MIN) % 60] as const), [])

  // Scroll the selected (or nearest) slot into view on open.
  useLayoutEffect(() => {
    const target = value ?? new Date()
    const idx = Math.floor((target.getHours() * 60 + target.getMinutes()) / SLOT_MIN)
    const el = listRef.current?.children[idx] as HTMLElement | undefined
    if (el && listRef.current) listRef.current.scrollTop = el.offsetTop - listRef.current.clientHeight / 2 + el.clientHeight / 2
  }, [])

  const commit = () => {
    const t = parseTime(text)
    if (!t) return setInvalid(true)
    onPick(t[0], t[1])
  }

  return (
    <div className="flex w-36 flex-col border-l border-slate-100">
      <div className="p-2">
        <input
          className={clsx('w-full rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-2', invalid ? 'border-red-400 ring-red-200' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500/20')}
          placeholder="Type e.g. 9:30pm"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setInvalid(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
      </div>
      <div ref={listRef} className="h-64 overflow-y-auto px-1 pb-1">
        {slots.map(([h, m]) => {
          const active = value && value.getHours() === h && value.getMinutes() === m
          let rel = ''
          if (relativeTo && value) {
            const candidate = new Date(value)
            candidate.setHours(h, m, 0, 0)
            const mins = differenceInMinutes(candidate, relativeTo)
            if (mins > 0 && isSameDay(candidate, relativeTo)) rel = formatDuration(mins)
          }
          return (
            <button
              key={`${h}:${m}`}
              type="button"
              onClick={() => onPick(h, m)}
              className={clsx(
                'flex w-full items-center justify-between rounded-md px-2 py-1 text-sm tabular-nums',
                active ? 'bg-blue-600 font-medium text-white' : m === 0 ? 'text-slate-800 hover:bg-slate-100' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}
              {rel && <span className={clsx('text-[11px]', active ? 'text-blue-100' : 'text-slate-400')}>{rel}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A single local date-time as "yyyy-MM-dd'T'HH:mm". */
export function DateTimeField({
  value,
  onChange,
  placeholder = 'Pick date & time',
  relativeTo,
  defaultTime = [9, 0],
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Shows durations from this moment in the time list (used for end times). */
  relativeTo?: Date
  defaultTime?: [number, number]
}) {
  const [open, setOpen] = useState(false)
  const current = parseDateTime(value)
  const [month, setMonth] = useState<Date>(current ?? new Date())
  useEffect(() => {
    if (open) setMonth(current ?? relativeTo ?? new Date())
  }, [open])

  const withDate = (day: Date) => {
    const d = new Date(day)
    const [h, m] = current ? [current.getHours(), current.getMinutes()] : defaultTime
    d.setHours(h, m, 0, 0)
    onChange(fmtDateTime(d))
  }
  const withTime = (h: number, m: number) => {
    const d = new Date(current ?? relativeTo ?? new Date())
    d.setHours(h, m, 0, 0)
    onChange(fmtDateTime(d))
    setOpen(false)
  }

  const today = new Date()
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={(props, isOpen) => (
        <TriggerButton icon={Clock} placeholder={placeholder} open={isOpen} onClear={() => onChange('')} {...props}>
          {current && (
            <span className="flex min-w-0 flex-1 items-center gap-2 truncate pr-5">
              <span className="font-medium text-slate-800">{friendlyDate(current)}</span>
              <span className="rounded bg-slate-100 px-1.5 py-px text-xs font-semibold text-slate-700 tabular-nums">{format(current, 'HH:mm')}</span>
            </span>
          )}
        </TriggerButton>
      )}
    >
      <Presets
        items={[
          { label: 'Today', onClick: () => withDate(today), active: !!current && isSameDay(current, today) },
          { label: 'Tomorrow', onClick: () => withDate(addDays(today, 1)), active: !!current && isSameDay(current, addDays(today, 1)) },
          { label: 'Next Monday', onClick: () => withDate(nextMonday(today)), active: !!current && isSameDay(current, nextMonday(today)) },
        ]}
      />
      <div className="flex">
        <DayPicker {...calendarProps} mode="single" required month={month} onMonthChange={setMonth} selected={current} onSelect={(d) => d && withDate(d)} />
        <TimeList key={value} value={current} onPick={withTime} relativeTo={relativeTo} />
      </div>
    </Popover>
  )
}

const DURATIONS = [30, 60, 120, 180, 240, 480]

/** Start/end date-times for hourly work, with one-click durations. */
export function HourlyScheduleField({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  const s = parseDateTime(start)
  const e = parseDateTime(end)
  const duration = s && e ? differenceInMinutes(e, s) : 0

  const setStart = (v: string) => {
    const ns = parseDateTime(v)
    // Moving the start keeps the duration; a first start defaults to 1 hour.
    const keep = s && e && duration > 0 ? duration : 60
    onChange(v, ns ? fmtDateTime(addMinutes(ns, keep)) : end)
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[36px_1fr] items-center gap-2">
        <span className="text-xs text-slate-500">From</span>
        <DateTimeField value={start} onChange={setStart} placeholder="Start" />
        <span className="text-xs text-slate-500">To</span>
        <DateTimeField value={end} onChange={(v) => onChange(start, v)} placeholder="End" relativeTo={s} defaultTime={s ? [s.getHours() + 1, s.getMinutes()] : [10, 0]} />
      </div>
      {s && (
        <div className="flex flex-wrap items-center gap-1.5 pl-[44px]">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange(start, fmtDateTime(addMinutes(s, d)))}
              className={clsx(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium transition',
                duration === d ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              {formatDuration(d)}
            </button>
          ))}
          {duration > 0 && !DURATIONS.includes(duration) && <span className="text-[11px] font-medium text-slate-500">{formatDuration(duration)}</span>}
          {duration < 0 && <span className="text-[11px] font-medium text-red-600">End is before start</span>}
        </div>
      )}
    </div>
  )
}
