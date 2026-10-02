import { useMemo } from 'react'
import clsx from 'clsx'
import { addDays, differenceInCalendarDays, format, isSameDay } from 'date-fns'
import { useTaskModal } from '../components/TaskModal'
import { Avatar, userName } from '../components/ui'
import { useTasks, useUsers } from '../lib/queries'
import { statusLabel, type Status, type Task, type Workload } from '../lib/types'

const fmtH = (h: number) => (Math.round(h * 10) / 10).toLocaleString() + 'h'

const STATUS_BORDER: Record<Status, string> = {
  todo: 'border-l-slate-400',
  in_progress: 'border-l-blue-500',
  in_review: 'border-l-amber-500',
  done: 'border-l-emerald-500',
}

type Span = { start: number; end: number }

/** The time an hourly task occupies: its schedule, or actual_hours from its start when recorded. */
function spanOf(t: Task): Span | null {
  if (!t.start_at) return null
  const start = new Date(t.start_at).getTime()
  if (t.actual_hours != null) return { start, end: start + t.actual_hours * 3_600_000 }
  if (!t.end_at) return null
  const end = new Date(t.end_at).getTime()
  return end > start ? { start, end } : null
}

/** Hours covered by the spans, overlapping time counted once (same rule as the server). */
function mergedHours(spans: Span[]): number {
  const s = [...spans].sort((a, b) => a.start - b.start)
  let total = 0
  let cur: Span | null = null
  for (const sp of s) {
    if (cur && sp.start <= cur.end) cur.end = Math.max(cur.end, sp.end)
    else {
      if (cur) total += cur.end - cur.start
      cur = { ...sp }
    }
  }
  if (cur) total += cur.end - cur.start
  return total / 3_600_000
}

const sumHours = (spans: Span[]) => spans.reduce((a, s) => a + (s.end - s.start), 0) / 3_600_000

/**
 * People × days for one week: each cell lists that person's hourly tasks
 * starting that day (a task crossing midnight stays on its start day).
 */
export default function WeekGrid({ from, rows, workspaceId }: { from: Date; rows: Workload[]; workspaceId: string }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from])
  const to = addDays(from, 7)
  const { data: tasks = [], isLoading } = useTasks({ workspace_id: workspaceId || undefined, type: 'hourly', from: from.toISOString(), to: to.toISOString() })
  const { byId } = useUsers()
  const modal = useTaskModal()

  // Hourly tasks starting this week, per user and day index.
  const cells = useMemo(() => {
    const m = new Map<string, Task[][]>()
    for (const t of tasks) {
      if (!t.start_at) continue
      const start = new Date(t.start_at)
      if (start < from || start >= to) continue
      const day = differenceInCalendarDays(start, from)
      if (day < 0 || day > 6) continue
      for (const uid of t.assignee_ids) {
        if (!m.has(uid)) m.set(uid, Array.from({ length: 7 }, () => []))
        m.get(uid)![day].push(t)
      }
    }
    for (const byDay of m.values()) for (const list of byDay) list.sort((a, b) => a.start_at!.localeCompare(b.start_at!))
    return m
  }, [tasks, from, to])

  // Everyone in the report (active users, plus inactive ones with work), alphabetically.
  const people = useMemo(
    () => [...rows].filter((r) => (r.active && !r.deleted) || cells.has(r.user_id)).sort((a, b) => userName(a).localeCompare(userName(b))),
    [rows, cells],
  )

  const dayHours = (uid: string, d: number) => {
    const spans = (cells.get(uid)?.[d] ?? []).map(spanOf).filter((s): s is Span => !!s)
    const merged = mergedHours(spans)
    return { merged, overlap: sumHours(spans) - merged > 0.001 }
  }
  const weekHours = (uid: string) => mergedHours((cells.get(uid) ?? []).flat().map(spanOf).filter((s): s is Span => !!s))
  const dayTotals = days.map((_, d) => people.reduce((a, p) => a + dayHours(p.user_id, d).merged, 0))
  const today = new Date()
  const cols = 'grid grid-cols-[180px_repeat(7,minmax(128px,1fr))_72px]'

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="min-w-[1150px] text-sm">
        <div className={clsx(cols, 'border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase')}>
          <div className="px-3 py-2">Member</div>
          {days.map((d) => (
            <div key={d.toISOString()} className={clsx('border-l border-slate-200 px-2 py-2', isSameDay(d, today) && 'bg-blue-50 text-blue-700')}>
              {format(d, 'EEE d')}
            </div>
          ))}
          <div className="border-l border-slate-200 px-2 py-2 text-right">Week</div>
        </div>

        {isLoading && <div className="h-24 animate-pulse bg-slate-50" />}
        {people.map((p) => {
          const week = weekHours(p.user_id)
          return (
            <div key={p.user_id} className={clsx(cols, 'border-b border-slate-100')}>
              <div className="flex items-start gap-2 px-3 py-2">
                <Avatar user={byId.get(p.user_id)} size="md" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{userName(p)}</div>
                  <div className="text-xs text-slate-500">{week ? fmtH(week) : '—'}</div>
                </div>
              </div>
              {days.map((d, i) => {
                const list = cells.get(p.user_id)?.[i] ?? []
                const h = dayHours(p.user_id, i)
                return (
                  <div key={i} className={clsx('flex min-h-16 flex-col gap-1 border-l border-slate-100 p-1.5', isSameDay(d, today) && 'bg-blue-50/40')}>
                    {list.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => modal.openTask(t.id)}
                        title={`${t.key} · ${t.title} · ${statusLabel(t.status)}`}
                        className={clsx(
                          'rounded border border-l-[3px] border-slate-200 bg-white px-1.5 py-1 text-left shadow-sm transition hover:border-blue-300 hover:shadow',
                          STATUS_BORDER[t.status],
                        )}
                      >
                        <div className="text-[11px] font-medium text-slate-500 tabular-nums">
                          {format(new Date(t.start_at!), 'HH:mm')}
                          {t.end_at && `–${format(new Date(t.end_at), 'HH:mm')}`}
                          <span className="ml-1 text-slate-400">{t.key}</span>
                        </div>
                        <div className={clsx('line-clamp-2 text-xs leading-snug', t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>{t.title}</div>
                      </button>
                    ))}
                    {list.length > 0 && (
                      <div
                        className="mt-auto flex items-center gap-1 px-0.5 text-[11px] font-semibold text-violet-700 tabular-nums"
                        title={h.overlap ? 'Some tasks ran at the same time; overlapping time is counted once' : undefined}
                      >
                        {fmtH(h.merged)}
                        {h.overlap && <span className="inline-block h-2 w-2 rounded-full border border-violet-500 bg-gradient-to-r from-violet-500 from-50% to-transparent to-50%" />}
                      </div>
                    )}
                  </div>
                )
              })}
              <div className="border-l border-slate-100 px-2 py-2 text-right font-semibold text-slate-800 tabular-nums">{week ? fmtH(week) : '—'}</div>
            </div>
          )
        })}

        <div className={clsx(cols, 'bg-slate-50 text-xs font-semibold text-slate-600')}>
          <div className="px-3 py-2 tracking-wide uppercase">Day total</div>
          {dayTotals.map((h, i) => (
            <div key={i} className="border-l border-slate-200 px-2 py-2 tabular-nums">
              {h ? fmtH(h) : '—'}
            </div>
          ))}
          <div className="border-l border-slate-200 px-2 py-2 text-right tabular-nums">{fmtH(people.reduce((a, p) => a + weekHours(p.user_id), 0))}</div>
        </div>
      </div>
    </div>
  )
}
