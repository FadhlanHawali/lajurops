import clsx from 'clsx'
import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import type { Task } from '../lib/types'

/** How far along a project is, derived from the daily/hourly tasks inside it. */
export function ProjectProgress({ project, done, total, compact }: { project: Task; done: number; total: number; compact?: boolean }) {
  const state = total === 0 ? 'empty' : project.status === 'done' ? 'done' : project.status === 'todo' ? 'todo' : 'active'
  const Icon = state === 'done' ? CheckCircle2 : state === 'active' ? CircleDot : Circle
  const label = { empty: 'No tasks yet', todo: 'Not started', active: 'In progress', done: 'Done' }[state]
  return (
    <div className={clsx(!compact && 'space-y-1')}>
      <div className="flex items-center gap-1.5 text-[11px]">
        <Icon size={12} className={clsx(state === 'done' ? 'text-emerald-500' : state === 'active' ? 'text-blue-500' : 'text-slate-400')} />
        <span className={clsx('font-semibold', state === 'done' ? 'text-emerald-700' : state === 'active' ? 'text-blue-700' : 'text-slate-500')}>{label}</span>
        {total > 0 && (
          <span className="ml-auto text-slate-500 tabular-nums">
            {done}/{total} tasks · {project.progress}%
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="h-1.5 overflow-hidden rounded bg-slate-100">
          <div className={clsx('h-full transition-all', state === 'done' ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${project.progress}%` }} />
        </div>
      )}
    </div>
  )
}
