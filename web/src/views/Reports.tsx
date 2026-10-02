import { Fragment, useMemo, useState } from 'react'
import clsx from 'clsx'
import { addMonths, addWeeks, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronDown, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useTaskModal } from '../components/TaskModal'
import { EnvBadge } from '../components/Environments'
import { Avatar, Button, Empty, StatusPill, TypeBadge, userName } from '../components/ui'
import { formatSchedule, hoursBetween } from '../lib/dates'
import { useWorkspaces, useUsers, useWorkload, useWorkloadTasks } from '../lib/queries'
import type { Workload } from '../lib/types'

type Period = 'week' | 'month'

const fmtH = (h: number) => (Math.round(h * 10) / 10).toLocaleString() + 'h'

export default function Reports() {
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [workspaceId, setWorkspaceId] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data: workspaces = [] } = useWorkspaces()

  const { from, to, label } = useMemo(() => {
    if (period === 'week') {
      const s = startOfWeek(anchor, { weekStartsOn: 1 })
      const e = endOfWeek(anchor, { weekStartsOn: 1 })
      return { from: s, to: new Date(e.getTime() + 1), label: `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')} · Week ${format(s, 'I')}` }
    }
    const s = startOfMonth(anchor)
    return { from: s, to: new Date(endOfMonth(anchor).getTime() + 1), label: format(s, 'MMMM yyyy') }
  }, [period, anchor])
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  const { data: rows = [], isLoading } = useWorkload(fromIso, toIso, workspaceId)
  const active = rows.filter((r) => r.total_tasks > 0)
  const totals = rows.reduce(
    (a, r) => ({ hourly: a.hourly + r.hourly_tasks, hours: a.hours + r.hourly_hours, daily: a.daily + r.daily_tasks, done: a.done + r.done_tasks, total: a.total + r.total_tasks }),
    { hourly: 0, hours: 0, daily: 0, done: 0, total: 0 },
  )
  const maxHours = Math.max(1, ...rows.map((r) => r.hourly_hours))
  const shift = (n: number) => setAnchor((a) => (period === 'week' ? addWeeks(a, n) : addMonths(a, n)))

  const exportCsv = () => {
    const header = ['User', 'Email', 'Hourly tasks', 'Hourly hours', 'Daily tasks', 'Daily done', 'Total tasks', 'Done', 'Logged hours']
    const lines = rows.map((r) =>
      [userName(r), r.email, r.hourly_tasks, r.hourly_hours.toFixed(2), r.daily_tasks, r.daily_done, r.total_tasks, r.done_tasks, r.logged_hours.toFixed(2)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `workload-${format(from, 'yyyy-MM-dd')}-${period}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
          {(['week', 'month'] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={clsx('px-3 py-1', period === p ? 'bg-slate-800 text-white' : 'bg-white text-slate-600')}>
              {p === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </Button>
        <span className="min-w-56 text-center text-sm font-medium text-slate-700">{label}</span>
        <Button variant="ghost" onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </Button>
        <Button onClick={() => setAnchor(new Date())}>This {period}</Button>
        <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
          <option value="">All workspaces</option>
          {workspaces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
        <Button className="ml-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download size={14} /> CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Hourly support hours" value={fmtH(totals.hours)} accent="text-violet-600" />
        <Stat label="Hourly tasks" value={totals.hourly} />
        <Stat label="Daily tasks" value={totals.daily} accent="text-sky-600" />
        <Stat label="Completed" value={`${totals.done} / ${totals.total}`} accent="text-emerald-600" />
      </div>

      {!isLoading && rows.length === 0 ? (
        <Empty>No users yet — users appear here after their first Keycloak login.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Member</th>
                <th className="px-4 py-2">Hourly support</th>
                <th className="px-4 py-2 text-right">Hourly tasks</th>
                <th className="px-4 py-2 text-right">Daily tasks</th>
                <th className="px-4 py-2 text-right">Done</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.user_id}>
                  <UserRow r={r} maxHours={maxHours} open={open === r.user_id} onToggle={() => setOpen(open === r.user_id ? null : r.user_id)} />
                  {open === r.user_id && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50 px-4 py-3">
                        <UserTasks userId={r.user_id} from={fromIso} to={toIso} workspaceId={workspaceId} hours={r.hourly_hours} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Tasks count toward the period their start date falls in ({active.length} of {rows.length} members active). Hourly support is the time spent on hourly
        tasks: each task's scheduled time (or its actual hours from the start), with overlapping tasks counted once.
      </p>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold text-slate-800', accent)}>{value}</div>
    </div>
  )
}

function UserRow({ r, maxHours, open, onToggle }: { r: Workload; maxHours: number; open: boolean; onToggle: () => void }) {
  const { byId } = useUsers()
  return (
    <tr className={clsx('cursor-pointer border-b border-slate-100 hover:bg-slate-50', r.total_tasks === 0 && 'text-slate-400')} onClick={onToggle}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Avatar user={byId.get(r.user_id)} size="md" />
          <div>
            <div className="font-medium text-slate-800">
              {userName(r)}
              {r.deleted ? (
                <span className="ml-1.5 rounded bg-red-100 px-1 py-px text-[10px] font-semibold text-red-700 uppercase">Deleted</span>
              ) : (
                !r.active && <span className="ml-1.5 rounded bg-slate-200 px-1 py-px text-[10px] font-semibold text-slate-600 uppercase">Disabled</span>
              )}
            </div>
            <div className="text-xs text-slate-500">{r.email || r.username}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-40 overflow-hidden rounded bg-slate-100">
            <div className="h-full rounded bg-violet-500" style={{ width: `${(r.hourly_hours / maxHours) * 100}%` }} />
          </div>
          <span className="tabular-nums font-medium">{fmtH(r.hourly_hours)}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{r.hourly_tasks}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {r.daily_tasks} <span className="text-xs text-slate-400">({r.daily_done} done)</span>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{r.done_tasks}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{r.total_tasks}</td>
      <td className="pr-3 text-slate-400">
        <ChevronDown size={16} className={clsx('transition', open && 'rotate-180')} />
      </td>
    </tr>
  )
}

function UserTasks({ userId, from, to, workspaceId, hours }: { userId: string; from: string; to: string; workspaceId: string; hours: number }) {
  const { data = [], isLoading } = useWorkloadTasks(userId, from, to, workspaceId)
  const modal = useTaskModal()
  if (isLoading) return <div className="text-sm text-slate-400">Loading…</div>
  if (!data.length) return <div className="text-sm text-slate-500">No tasks in this period.</div>
  const taskSum = data.filter((t) => t.type === 'hourly').reduce((a, t) => a + (t.actual_hours ?? hoursBetween(t.start_at, t.end_at)), 0)
  return (
    <div className="space-y-1.5">
      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
        {data.map((t) => (
          <li key={t.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-blue-50/50" onClick={() => modal.openTask(t.id)}>
            <TypeBadge type={t.type} kind={t.project_kind} />
            <span className="w-20 shrink-0 text-xs font-medium text-slate-500">{t.key}</span>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {t.environment_name && <EnvBadge name={t.environment_name} color={t.environment_color} />}
            <span className="text-xs text-slate-500">{formatSchedule(t)}</span>
            {t.type === 'hourly' && <span className="w-14 text-right text-xs font-medium tabular-nums">{fmtH(t.actual_hours ?? hoursBetween(t.start_at, t.end_at))}</span>}
            <StatusPill status={t.status} />
          </li>
        ))}
      </ul>
      {taskSum - hours > 0.01 && (
        <p className="text-xs text-slate-500">
          Hourly tasks add up to {fmtH(taskSum)}, but some ran at the same time; overlapping time is counted once, giving <b>{fmtH(hours)}</b>.
        </p>
      )}
    </div>
  )
}
