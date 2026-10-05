import clsx from 'clsx'
import { addDays, format, isToday, startOfDay } from 'date-fns'
import { colorForId, pillStyle } from '../../lib/colors'
import type { Task } from '../../lib/types'
import { EnvBadge } from '../Environments'
import { StatusPill } from '../ui'
import { hhmm, taskStyle, TaskLabel } from './items'

/** A day-by-day list of the range's tasks: all-day work first, then by time. */
export function AgendaList({
  from,
  to,
  tasks,
  projectOf,
  onOpenTask,
}: {
  from: Date
  to: Date
  tasks: Task[]
  projectOf: (t: Task) => Task | undefined
  onOpenTask: (t: Task) => void
}) {
  const days: { day: Date; rows: Task[] }[] = []
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
    const next = addDays(d, 1).getTime()
    const rows = tasks
      .filter((t) => {
        const s = Date.parse(t.start_at!)
        const e = t.end_at ? Date.parse(t.end_at) : s + 1
        return s < next && e > d.getTime()
      })
      .sort((a, b) => Number(a.type === 'hourly') - Number(b.type === 'hourly') || Date.parse(a.start_at!) - Date.parse(b.start_at!) || a.number - b.number)
    if (rows.length) days.push({ day: d, rows })
  }
  if (!days.length) return <p className="p-8 text-center text-sm text-slate-500">Nothing scheduled in this period.</p>

  return (
    <div className="h-full overflow-y-auto">
      {days.map(({ day, rows }) => (
        <section key={day.toISOString()}>
          <h3 className={clsx('sticky top-0 z-10 flex justify-between border-y border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold', isToday(day) ? 'text-blue-700' : 'text-slate-700')}>
            <span>{format(day, 'EEEE')}</span>
            <span className="font-normal text-slate-500">
              {format(day, 'MMMM d, yyyy')} · {rows.length} task{rows.length === 1 ? '' : 's'}
            </span>
          </h3>
          <ul className="divide-y divide-slate-100">
            {rows.map((t) => {
              const p = projectOf(t)
              return (
                <li key={t.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => onOpenTask(t)}>
                    <span className="w-24 shrink-0 text-xs text-slate-500 tabular-nums">
                      {t.type === 'hourly' ? `${hhmm(new Date(t.start_at!))}–${t.end_at ? hhmm(new Date(t.end_at)) : ''}` : 'all day'}
                    </span>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: taskStyle(t).backgroundColor }} />
                    <span className="min-w-0 flex-1 truncate text-slate-800">
                      <TaskLabel task={t} />
                    </span>
                    {t.environment_name && <EnvBadge name={t.environment_name} color={t.environment_color} size="xs" />}
                    {p && (
                      <span className="max-w-40 shrink-0 truncate rounded px-1.5 text-[11px] font-medium" style={pillStyle(colorForId(p.id))}>
                        {p.title}
                      </span>
                    )}
                    <StatusPill status={t.status} />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
