import type { CSSProperties } from 'react'
import { format } from 'date-fns'
import type { CalendarItem, TaskGroup } from '../../lib/calendarGroups'
import { tintColors } from '../../lib/colors'
import type { Task } from '../../lib/types'

/** Solid colours for single tasks, by type (done tasks are green and faded). */
const TASK_COLORS = {
  project: '#f59e0b',
  shortProject: '#fb923c',
  hourly: '#8b5cf6',
  daily: '#0ea5e9',
  done: '#10b981',
}

export function taskStyle(t: Task): CSSProperties {
  const bg = t.status === 'done' ? TASK_COLORS.done : t.project_kind === 'short' ? TASK_COLORS.shortProject : TASK_COLORS[t.type]
  return { backgroundColor: bg, color: '#fff', opacity: t.status === 'done' ? 0.7 : 1 }
}

export function groupStyle(g: TaskGroup): CSSProperties {
  const c = tintColors(g.color)
  return { backgroundColor: c.bg, color: c.text, boxShadow: `inset 0 0 0 1px ${c.border}` }
}

export const itemStyle = (it: CalendarItem): CSSProperties => (it.kind === 'group' ? groupStyle(it.group) : taskStyle(it.task))

/** "[Env] KEY Title", with done tasks as "[DONE] ~~…~~". */
export function TaskLabel({ task: t, withKey = true }: { task: Task; withKey?: boolean }) {
  const text = `${t.environment_name ? `[${t.environment_name}] ` : ''}${withKey ? `${t.key} ` : ''}${t.title}`
  if (t.status !== 'done') return <>{text}</>
  return (
    <>
      <b className="mr-1 font-semibold">[DONE]</b>
      <span className="line-through">{text}</span>
    </>
  )
}

export const hhmm = (d: Date) => format(d, 'HH:mm')

/** Hover text for an item. */
export function itemTitle(it: CalendarItem): string {
  if (it.kind === 'group') {
    const g = it.group
    return `${g.label} · ${g.tasks.length} ${g.allDay ? 'daily' : 'hourly'} task${g.tasks.length === 1 ? '' : 's'} · click to list them`
  }
  const t = it.task
  return `${t.key} · ${t.title}${t.environment_name ? ` · ${t.environment_name}` : ''}${t.status === 'done' ? ' · done' : ''}`
}
