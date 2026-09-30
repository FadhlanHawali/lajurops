import { addDays, addHours, differenceInMinutes, format, startOfDay, subDays } from 'date-fns'
import type { Task, TaskType } from './types'

// Daily tasks are stored as [local midnight of first day, local midnight after
// the last day) so they line up with Gantt day columns and FullCalendar's
// exclusive all-day end. Hourly tasks store exact timestamps.

/** Value for an <input type="date"> or <input type="datetime-local">. */
export function toInput(iso: string | null, type: TaskType, isEnd = false): string {
  if (!iso) return ''
  let d = new Date(iso)
  if (type === 'daily') {
    if (isEnd) d = subDays(d, 1)
    return format(d, 'yyyy-MM-dd')
  }
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

/** Parses an input value back into an ISO timestamp. */
export function fromInput(value: string, type: TaskType, isEnd = false): string | null {
  if (!value) return null
  if (type === 'daily') {
    const [y, m, d] = value.split('-').map(Number)
    let date = new Date(y, m - 1, d)
    if (isEnd) date = addDays(date, 1)
    return date.toISOString()
  }
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

/** Default schedule when a task is placed at `at` without explicit bounds. */
export function defaultSpan(type: TaskType, at: Date): { start: Date; end: Date } {
  if (type === 'daily') {
    const start = startOfDay(at)
    return { start, end: addDays(start, 1) }
  }
  return { start: at, end: addHours(at, 2) }
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0h'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h >= 24 && m === 0 && h % 24 === 0) return `${h / 24}d (${h}h)`
  return m ? `${h}h ${m}m` : `${h}h`
}

export function formatSchedule(t: Pick<Task, 'type' | 'start_at' | 'end_at'>): string {
  if (!t.start_at) return 'Unscheduled'
  const s = new Date(t.start_at)
  if (t.type === 'daily') {
    const last = t.end_at ? subDays(new Date(t.end_at), 1) : s
    return last > s ? `${format(s, 'MMM d')} – ${format(last, 'MMM d')}` : format(s, 'EEE, MMM d')
  }
  if (!t.end_at) return format(s, 'MMM d, HH:mm')
  const e = new Date(t.end_at)
  const sameDay = format(s, 'yyyyMMdd') === format(e, 'yyyyMMdd')
  const dur = formatDuration(differenceInMinutes(e, s))
  return sameDay
    ? `${format(s, 'MMM d, HH:mm')}–${format(e, 'HH:mm')} · ${dur}`
    : `${format(s, 'MMM d HH:mm')} – ${format(e, 'MMM d HH:mm')} · ${dur}`
}

export const hoursBetween = (start: string | null, end: string | null) =>
  start && end ? (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000 : 0
