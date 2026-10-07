import { useState } from 'react'
import clsx from 'clsx'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { addWeeks, endOfWeek, format, isSameWeek, startOfWeek } from 'date-fns'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { Popover } from './Popover'

const opts = { weekStartsOn: 1 as const }

/**
 * Pick a Monday-to-Sunday week from a calendar: clicking any day selects its
 * week. `value` is any date in the current week; onChange gets the clicked day.
 */
export function WeekPicker({ value, onChange }: { value: Date; onChange: (day: Date) => void }) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(value)
  const [hover, setHover] = useState<Date>()
  const start = startOfWeek(value, opts)
  const end = endOfWeek(value, opts)
  const today = new Date()

  const pick = (d: Date) => {
    onChange(d)
    setOpen(false)
  }
  const presets = [
    { label: 'Last week', d: addWeeks(today, -1) },
    { label: 'This week', d: today },
    { label: 'Next week', d: addWeeks(today, 1) },
  ]

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setMonth(value)
      }}
      trigger={(props, isOpen) => (
        <button
          type="button"
          {...props}
          title="Pick a week"
          className={clsx(
            'inline-flex min-w-56 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100',
            isOpen && 'bg-slate-100',
          )}
        >
          <CalendarDays size={14} className="text-slate-400" />
          {format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')} · Week {format(start, 'I')}
          <ChevronDown size={14} className="text-slate-400" />
        </button>
      )}
    >
      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 p-2.5">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => pick(p.d)}
            className={clsx(
              'rounded-full border px-2.5 py-0.5 text-xs font-medium transition',
              isSameWeek(p.d, value, opts) ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <DayPicker
        className="planner-rdp"
        weekStartsOn={1}
        ISOWeek
        showWeekNumber
        showOutsideDays
        fixedWeeks
        mode="range"
        month={month}
        onMonthChange={setMonth}
        selected={{ from: start, to: end }}
        onDayClick={pick}
        onDayMouseEnter={setHover}
        onDayMouseLeave={() => setHover(undefined)}
        modifiers={{ hoverWeek: (d) => !!hover && isSameWeek(d, hover, opts) && !isSameWeek(d, value, opts) }}
        modifiersClassNames={{ hoverWeek: 'planner-rdp-hover-week' }}
      />
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Click any day to jump to its week</p>
    </Popover>
  )
}
