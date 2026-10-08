import clsx from 'clsx'
import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import type { Task } from '../lib/types'

/**
 * How far along a project is: progress comes from the daily/hourly tasks
 * inside it, but it's only done once someone marks it done. When every
 * task is finished and it's still open, that's called out.
 */
export function ProjectProgress({ project, done, total, compact }: { project: Task; done: number; total: number; compact?: boolean }) {
  const state =
    project.status === 'done' ? 'done' : total === 0 ? 'empty' : done === total ? 'ready' : project.status === 'todo' ? 'todo' : 'active'
  const Icon = state === 'done' || state === 'ready' ? CheckCircle2 : state === 'active' ? CircleDot : Circle
  const label = { empty: 'No tasks yet', todo: 'Not started', active: 'In progress', ready: 'All tasks done · not closed yet', done: 'Done' }[state]
  const tone = { done: 'emerald', ready: 'amber', active: 'blue', todo: 'slate', empty: 'slate' }[state]
  return (
    <div className={clsx(!compact && 'space-y-1')}>
      <div className="flex items-center gap-1.5 text-[11px]">
        <Icon
          size={12}
          className={clsx(tone === 'emerald' ? 'text-emerald-500' : tone === 'amber' ? 'text-amber-500' : tone === 'blue' ? 'text-blue-500' : 'text-slate-400')}
        />
        <span
          className={clsx('font-semibold', tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'blue' ? 'text-blue-700' : 'text-slate-500')}
          title={state === 'ready' ? 'Finishing every task doesn\'t close a project: mark it done when it really is.' : undefined}
        >
          {label}
        </span>
        {total > 0 && (
          <span className="ml-auto text-slate-500 tabular-nums">
            {done}/{total} tasks · {project.progress}%
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="h-1.5 overflow-hidden rounded bg-slate-100">
          <div
            className={clsx('h-full transition-all', tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-blue-500')}
            style={{ width: `${project.progress}%` }}
          />
        </div>
      )}
    </div>
  )
}
