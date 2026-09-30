import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronsUp, Clock, Equal, CalendarDays } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useMe, useTaskFilters, useUsers } from '../lib/queries'
import type { Priority, Status, TaskType, User } from '../lib/types'
import { statusLabel } from '../lib/types'

export const userName = (u?: Pick<User, 'display_name' | 'username'> | null) =>
  u ? u.display_name || u.username : 'Unassigned'

const AVATAR_COLORS = ['bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-fuchsia-500', 'bg-teal-500']

export function Avatar({ user, size = 'sm' }: { user?: User | null; size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs'
  if (!user) {
    return (
      <span title="Unassigned" className={clsx(dims, 'inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400')}>
        ?
      </span>
    )
  }
  const name = userName(user)
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const color = AVATAR_COLORS[[...user.id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]
  return (
    <span title={name} className={clsx(dims, color, 'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white')}>
      {initials}
    </span>
  )
}

export function TypeBadge({ type, className }: { type: TaskType; className?: string }) {
  return type === 'hourly' ? (
    <span className={clsx('inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700', className)}>
      <Clock size={11} /> Hourly
    </span>
  ) : (
    <span className={clsx('inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700', className)}>
      <CalendarDays size={11} /> Daily
    </span>
  )
}

export function PriorityIcon({ priority }: { priority: Priority }) {
  const p = {
    low: { icon: ArrowDown, cls: 'text-slate-400' },
    medium: { icon: Equal, cls: 'text-amber-500' },
    high: { icon: ArrowUp, cls: 'text-orange-600' },
    urgent: { icon: ChevronsUp, cls: 'text-red-600' },
  }[priority]
  const Icon = p.icon
  return (
    <span title={`Priority: ${priority}`}>
      <Icon size={14} className={p.cls} />
    </span>
  )
}

const STATUS_CLS: Record<Status, string> = {
  todo: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-700',
  in_review: 'bg-amber-100 text-amber-800',
  done: 'bg-emerald-100 text-emerald-700',
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={clsx('inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', STATUS_CLS[status])}>
      {statusLabel(status)}
    </span>
  )
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
        className,
      )}
    />
  )
}

export const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}

export function UserSelect({
  value,
  onChange,
  className,
  allowEmpty = 'Unassigned',
}: {
  value: string
  onChange: (id: string) => void
  className?: string
  allowEmpty?: string
}) {
  const { users } = useUsers()
  return (
    <select className={clsx(inputCls, className)} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowEmpty}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {userName(u)}
        </option>
      ))}
    </select>
  )
}

/** Assignee + task type filters, persisted in the URL. */
export function FilterBar({ children }: { children?: ReactNode }) {
  const { assignee, type, setAssignee, setType } = useTaskFilters()
  const me = useMe().data
  const { users } = useUsers()
  const sel = 'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={sel} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
        <option value="">All assignees</option>
        {me && <option value={me.id}>Only me</option>}
        {users
          .filter((u) => u.id !== me?.id)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {userName(u)}
            </option>
          ))}
      </select>
      <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
        {[
          ['', 'All types'],
          ['hourly', 'Hourly'],
          ['daily', 'Daily'],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setType(v)}
            className={clsx('px-2.5 py-1', type === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">{children}</div>
}
