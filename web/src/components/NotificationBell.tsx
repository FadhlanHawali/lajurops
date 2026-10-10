import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { differenceInCalendarDays, differenceInMinutes, format, isToday, isYesterday } from 'date-fns'
import {
  AlarmClock,
  ArrowLeft,
  AtSign,
  Bell,
  BellRing,
  CalendarClock,
  CircleCheck,
  History,
  Loader2,
  LockOpen,
  MessageSquare,
  Settings,
  Target,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { formatSchedule } from '../lib/dates'
import { useMarkNotificationsRead, useNotificationCount, useNotifications, useNotificationSettings, useSaveNotificationSettings } from '../lib/queries'
import type { AppNotification, NotificationChange, NotificationSettings, NotificationType, TaskType } from '../lib/types'
import { Popover } from './Popover'
import { useTaskModal } from './TaskModal'

const STYLE: Record<NotificationType, { icon: LucideIcon; cls: string }> = {
  assigned: { icon: UserPlus, cls: 'bg-blue-50 text-blue-700' },
  unassigned: { icon: UserMinus, cls: 'bg-slate-100 text-slate-600' },
  rescheduled: { icon: CalendarClock, cls: 'bg-slate-100 text-slate-600' },
  comment: { icon: MessageSquare, cls: 'bg-slate-100 text-slate-600' },
  changes: { icon: History, cls: 'bg-slate-100 text-slate-600' },
  mention: { icon: AtSign, cls: 'bg-violet-50 text-violet-700' },
  unblocked: { icon: LockOpen, cls: 'bg-emerald-50 text-emerald-700' },
  hourly_soon: { icon: AlarmClock, cls: 'bg-amber-50 text-amber-800' },
  step_soon: { icon: AlarmClock, cls: 'bg-amber-50 text-amber-800' },
  step_task_due: { icon: CalendarClock, cls: 'bg-amber-50 text-amber-800' },
  commitment_unshared: { icon: Target, cls: 'bg-pink-50 text-pink-700' },
  commitment_overdue: { icon: Target, cls: 'bg-red-50 text-red-700' },
  project_ready: { icon: CircleCheck, cls: 'bg-emerald-50 text-emerald-700' },
}

const B = ({ children }: { children: React.ReactNode }) => <span className="font-medium">{children}</span>

/** "in 8 min" / "started 20:30" for a reminder. */
function startsIn(iso?: string) {
  if (!iso) return 'soon'
  const m = differenceInMinutes(new Date(iso), new Date())
  return m > 0 ? `in ${m} min` : `at ${format(new Date(iso), 'HH:mm')}`
}

const schedule = (type: TaskType, [s, e]: [string | null, string | null]) => formatSchedule({ type, start_at: s, end_at: e })

function describeChange(c: NotificationChange) {
  return c.kind === 'rescheduled' ? `Rescheduled ${schedule(c.type, c.from)} → ${schedule(c.type, c.to)}` : `Commented: “${c.excerpt}”`
}

/** The sentence and context line for a notification. */
function describe(n: AppNotification): { text: React.ReactNode; context: string } {
  const who = n.actor_name ?? 'Someone'
  const t = n.task
  const task = t ? (
    <>
      <B>{t.key}</B> {t.title}
    </>
  ) : null
  const where = t ? [t.key.split('-')[0], ...t.path].join(' › ') : ''
  const changes = n.data.changes ?? []
  switch (n.type) {
    case 'assigned':
      return { text: n.actor_id ? <><B>{who}</B> assigned you {task}</> : <>You were assigned {task}</>, context: where }
    case 'unassigned':
      return { text: <><B>{who}</B> removed you from {task}</>, context: where }
    case 'rescheduled':
      return { text: <><B>{who}</B> rescheduled {task}</>, context: changes.length ? describeChange(changes[changes.length - 1]) : where }
    case 'comment':
      return { text: <><B>{who}</B> commented on {task}</>, context: changes.length > 1 ? `${changes.length} comments` : changes[0]?.kind === 'comment' ? `“${changes[0].excerpt}”` : where }
    case 'changes':
      return { text: <><B>{who}</B> made <B>{changes.length} changes</B> to {task}</>, context: changes.map((c) => (c.kind === 'comment' ? 'a comment' : 'new dates')).join(' · ') }
    case 'mention':
      return { text: <><B>{who}</B> mentioned you on {task}</>, context: `“${n.data.excerpt ?? ''}”` }
    case 'unblocked':
      return {
        text: (
          <>
            <B>{n.data.blocker?.key}</B> {n.data.blocker?.title} is done, so {task} can start
          </>
        ),
        context: 'You were waiting for it',
      }
    case 'hourly_soon':
      return { text: <>{task} starts {startsIn(n.data.start_at)}</>, context: where }
    case 'step_soon':
      return { text: <>Runbook step <B>{n.data.step_title}</B> starts {startsIn(n.data.start_at)}</>, context: t ? `${t.key} ${t.title}${n.data.section ? ` · ${n.data.section}` : ''}` : '' }
    case 'step_task_due':
      return { text: <>{task} is due today</>, context: 'A runbook step depends on it' }
    case 'commitment_unshared':
      return { text: <>You haven’t shared this week’s commitment yet</>, context: `Weekly Commitment · ${n.data.tasks ?? 0} tasks this week` }
    case 'commitment_overdue':
      return { text: <>You have <B>{n.data.count} overdue</B> committed task{n.data.count === 1 ? '' : 's'}</>, context: 'Weekly Commitment · from earlier weeks' }
    case 'project_ready':
      return { text: <>All tasks in <B>{t?.title}</B> are done, so it’s ready to close</>, context: `${n.data.total ?? 0} tasks` }
  }
}

function dayLabel(d: Date) {
  return isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : 'Earlier'
}
function when(d: Date) {
  const m = differenceInMinutes(new Date(), d)
  if (m < 1) return 'now'
  if (m < 60) return `${m} min`
  if (isToday(d)) return `${Math.floor(m / 60)} h`
  return differenceInCalendarDays(new Date(), d) < 7 ? format(d, 'EEE HH:mm') : format(d, 'MMM d')
}

/** The bell next to the logo: unread count, the list, and settings. */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'settings'>('list')
  const { data: count } = useNotificationCount()
  const unread = count?.unread ?? 0

  // "(3) LajurOps" in the browser tab.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '')
    document.title = unread ? `(${unread > 99 ? '99+' : unread}) ${base}` : base
  }, [unread])

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setView('list')
      }}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className="relative ml-auto rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
          title={unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}
          aria-label="Notifications"
        >
          {unread ? <BellRing size={17} /> : <Bell size={17} />}
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
    >
      <div className="flex max-h-[min(70vh,640px)] w-[26rem] flex-col">
        {view === 'list' ? <List onClose={() => setOpen(false)} onSettings={() => setView('settings')} /> : <SettingsView onBack={() => setView('list')} />}
      </div>
    </Popover>
  )
}

function List({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data, isLoading } = useNotifications(true)
  const mark = useMarkNotificationsRead()
  const modal = useTaskModal()
  const navigate = useNavigate()
  const items = (data?.items ?? []).filter((n) => tab === 'all' || !n.read)
  const groups = useMemo(() => {
    const out: { label: string; items: AppNotification[] }[] = []
    for (const n of items) {
      const label = dayLabel(new Date(n.updated_at))
      if (out[out.length - 1]?.label !== label) out.push({ label, items: [] })
      out[out.length - 1].items.push(n)
    }
    return out
  }, [items])

  const openOne = (n: AppNotification) => {
    if (!n.read) mark.mutate([n.id])
    onClose()
    if (n.type === 'commitment_unshared' || n.type === 'commitment_overdue') navigate('/commitments')
    else if (n.task) modal.openTask(n.task.id)
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5">
        <span className="text-sm font-semibold text-slate-800">Notifications</span>
        <span className="ml-1 flex gap-0.5 rounded-full bg-slate-100 p-0.5 text-xs">
          {(['all', 'unread'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={clsx('rounded-full px-2.5 py-0.5 capitalize', tab === t ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500')}>
              {t}
              {t === 'unread' && data?.unread ? ` ${data.unread}` : ''}
            </button>
          ))}
        </span>
        <button
          type="button"
          className="ml-auto rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:text-slate-300 disabled:hover:bg-transparent"
          disabled={!data?.unread}
          onClick={() => mark.mutate('all')}
        >
          Mark all read
        </button>
        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Notification settings" onClick={onSettings}>
          <Settings size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {isLoading ? (
          <div className="flex justify-center p-8 text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            <Bell size={22} className="mx-auto mb-2 text-slate-300" />
            {tab === 'unread' ? 'You’re all caught up.' : 'Nothing yet. You’ll see assignments, mentions and reminders here.'}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="px-2.5 pt-3 pb-1 text-[11px] font-medium text-slate-400">{g.label}</div>
              {g.items.map((n) => {
                const s = STYLE[n.type] ?? STYLE.changes
                const d = describe(n)
                const changes = n.data.changes ?? []
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openOne(n)}
                    onKeyDown={(e) => e.key === 'Enter' && openOne(n)}
                    className="flex cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-50"
                  >
                    <span className={clsx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', s.cls)}>
                      <s.icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block text-[13px] leading-snug text-slate-700', !n.read && 'text-slate-900')}>{d.text}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{d.context}</span>
                      {n.type === 'changes' && (
                        <>
                          {expanded === n.id && (
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-500">
                              {changes.map((c, i) => (
                                <li key={i}>{describeChange(c)}</li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            className="mt-0.5 text-xs font-medium text-blue-600 hover:underline"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpanded(expanded === n.id ? null : n.id)
                            }}
                          >
                            {expanded === n.id ? 'Hide changes' : 'Show changes'}
                          </button>
                        </>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-[11px] whitespace-nowrap text-slate-400" title={format(new Date(n.updated_at), 'PPpp')}>
                        {when(new Date(n.updated_at))}
                      </span>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-blue-500" aria-label="Unread" />}
                    </span>
                  </div>
                )
              })}
            </div>
          ))
        )}
        {items.length > 0 && <p className="pt-2 text-center text-[11px] text-slate-400">Kept for 60 days · you’re never notified about your own changes</p>}
      </div>
    </>
  )
}

const TYPES: { group: string; rows: { type: NotificationType; label: string; lead?: 'hourly_lead' | 'step_lead' }[] }[] = [
  { group: 'Assignment', rows: [{ type: 'assigned', label: 'Assigned to me' }, { type: 'unassigned', label: 'Removed from a task' }] },
  {
    group: 'Changes to my work',
    rows: [
      { type: 'rescheduled', label: 'Rescheduled by someone else' },
      { type: 'comment', label: 'New comment on my task' },
      { type: 'mention', label: '@mentioned in a comment' },
    ],
  },
  { group: 'Dependencies', rows: [{ type: 'unblocked', label: 'A task I wait for is done' }] },
  {
    group: 'Reminders',
    rows: [
      { type: 'hourly_soon', label: 'My hourly task starts soon', lead: 'hourly_lead' },
      { type: 'step_soon', label: 'My runbook step starts soon', lead: 'step_lead' },
      { type: 'step_task_due', label: 'A step’s daily task is due today (09:00)' },
    ],
  },
  {
    group: 'Weekly Commitment (Mondays, 10:00)',
    rows: [
      { type: 'commitment_unshared', label: 'Commitment not shared yet' },
      { type: 'commitment_overdue', label: 'Overdue committed tasks' },
    ],
  },
  { group: 'Projects', rows: [{ type: 'project_ready', label: 'All tasks done, ready to close' }] },
]
const LEADS = [5, 10, 15, 30, 60]

function SettingsView({ onBack }: { onBack: () => void }) {
  const { data, isLoading } = useNotificationSettings(true)
  const save = useSaveNotificationSettings()
  const update = (patch: Partial<NotificationSettings>) => data && save.mutate({ ...data, ...patch })
  const toggle = (t: NotificationType) => {
    if (!data) return
    const off = data.disabled.includes(t)
    update({ disabled: off ? data.disabled.filter((x) => x !== t) : [...data.disabled, t] })
  }
  return (
    <>
      <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2.5">
        <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onBack} aria-label="Back to notifications">
          <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-semibold text-slate-800">Notification settings</span>
        {save.isPending && <Loader2 size={13} className="ml-auto animate-spin text-slate-400" />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading || !data ? (
          <div className="flex justify-center p-8 text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <>
            <p className="px-2 pt-2 text-xs text-slate-500">
              What shows up under the bell. Reminders use your time zone{data.tz ? ` (${data.tz})` : ''}.
            </p>
            {TYPES.map((g) => (
              <div key={g.group}>
                <div className="px-2 pt-3 pb-1 text-[11px] font-medium text-slate-400">{g.group}</div>
                {g.rows.map((r) => {
                  const on = !data.disabled.includes(r.type)
                  return (
                    <label key={r.type} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
                      <span className="flex flex-1 flex-wrap items-center gap-1.5 text-sm text-slate-700">
                        {r.label}
                        {r.lead && (
                          <select
                            className="h-6 rounded border border-slate-200 bg-white px-1 text-xs"
                            value={data[r.lead]}
                            disabled={!on}
                            onClick={(e) => e.preventDefault()}
                            onChange={(e) => update({ [r.lead!]: Number(e.target.value) })}
                            aria-label={`${r.label}: minutes before`}
                          >
                            {[...new Set([...LEADS, data[r.lead]])].sort((a, b) => a - b).map((m) => (
                              <option key={m} value={m}>
                                {m} min before
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                      <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(r.type)} />
                      <span className={clsx('relative h-[18px] w-8 shrink-0 rounded-full transition', on ? 'bg-blue-600' : 'bg-slate-300')}>
                        <span className={clsx('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all', on ? 'left-4' : 'left-0.5')} />
                      </span>
                    </label>
                  )
                })}
              </div>
            ))}
            {save.error && <p className="px-2 pt-2 text-xs text-red-600">{save.error.message}</p>}
          </>
        )}
      </div>
    </>
  )
}
