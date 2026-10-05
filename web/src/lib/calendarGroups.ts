import { addDays, startOfDay } from 'date-fns'
import type { Task } from './types'

/**
 * Grouping for crowded calendar weeks. When more than MAX_OVERLAP timed tasks
 * overlap, or more than MAX_PER_DAY daily tasks share a day, they're shown as
 * one block per group (a project, or an environment when the calendar is
 * filtered to a single project). Quieter slots keep their individual tasks.
 */
export const MAX_OVERLAP = 3
export const MAX_PER_DAY = 3
/** Blocks shown side by side in a busy slot or day: the biggest groups, then "N more". */
export const MAX_BLOCKS = 3

/** What tasks are grouped by: a stable key, a label and a colour. */
export interface GroupKey {
  key: string
  label: string
  color: string
}

export interface TaskGroup extends GroupKey {
  tasks: Task[]
  start: Date
  end: Date
  allDay: boolean
}

/** One thing to draw: a group, or a single task (for daily tasks, its piece of one day). */
export type CalendarItem =
  | { kind: 'group'; group: TaskGroup }
  | { kind: 'task'; task: Task; start: Date; end: Date; allDay: boolean; segment: boolean }

const spanOf = (t: Task): [number, number] => {
  const s = Date.parse(t.start_at!)
  const e = t.end_at ? Date.parse(t.end_at) : s + 3_600_000
  return [s, Math.max(e, s + 15 * 60_000)]
}

function groupBy(tasks: Task[], keyOf: (t: Task) => GroupKey) {
  const by = new Map<string, { key: GroupKey; tasks: Task[] }>()
  for (const t of tasks) {
    const k = keyOf(t)
    const g = by.get(k.key) ?? { key: k, tasks: [] }
    g.tasks.push(t)
    by.set(k.key, g)
  }
  return [...by.values()].sort((a, b) => b.tasks.length - a.tasks.length)
}

/**
 * The blocks for a busy slot or day: the biggest groups, the rest folded into
 * one "N more <noun>" group, so there are at most MAX_BLOCKS side by side. A
 * group of one task is shown as that task.
 */
function blocksFor(tasks: Task[], keyOf: (t: Task) => GroupKey, noun: string): { key: GroupKey; tasks: Task[]; single: boolean }[] {
  const groups = groupBy(tasks, keyOf)
  const keep = groups.length > MAX_BLOCKS ? groups.slice(0, MAX_BLOCKS - 1) : groups
  const rest = groups.slice(keep.length)
  const out = keep.map((g) => ({ ...g, single: g.tasks.length === 1 }))
  if (rest.length)
    out.push({ key: { key: `more:${rest.map((g) => g.key.key).join(',')}`, label: `+${rest.length} ${noun}`, color: 'slate' }, tasks: rest.flatMap((g) => g.tasks), single: false })
  return out
}

/** Timed (hourly) tasks: per day of their start, clusters of overlapping tasks. */
export function groupTimed(tasks: Task[], keyOf: (t: Task) => GroupKey, noun = 'projects'): CalendarItem[] {
  const out: CalendarItem[] = []
  const byDay = new Map<number, Task[]>()
  for (const t of tasks) {
    if (!t.start_at) continue
    const d = startOfDay(new Date(t.start_at)).getTime()
    byDay.set(d, [...(byDay.get(d) ?? []), t])
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => spanOf(a)[0] - spanOf(b)[0])
    // Clusters: runs of tasks connected by overlap.
    let cluster: Task[] = []
    let clusterEnd = -Infinity
    const flush = () => {
      if (!cluster.length) return
      // The most tasks running at the same moment (checked at each start).
      const peak = Math.max(...cluster.map((t) => cluster.filter((o) => spanOf(o)[0] <= spanOf(t)[0] && spanOf(o)[1] > spanOf(t)[0]).length))
      if (peak <= MAX_OVERLAP) {
        for (const t of cluster) {
          const [s, e] = spanOf(t)
          out.push({ kind: 'task', task: t, start: new Date(s), end: new Date(e), allDay: false, segment: false })
        }
      } else {
        for (const g of blocksFor(cluster, keyOf, noun)) {
          const spans = g.tasks.map(spanOf)
          if (g.single) {
            out.push({ kind: 'task', task: g.tasks[0], start: new Date(spans[0][0]), end: new Date(spans[0][1]), allDay: false, segment: false })
            continue
          }
          out.push({
            kind: 'group',
            group: { ...g.key, tasks: g.tasks, start: new Date(Math.min(...spans.map((s) => s[0]))), end: new Date(Math.max(...spans.map((s) => s[1]))), allDay: false },
          })
        }
      }
      cluster = []
    }
    for (const t of list) {
      const [s, e] = spanOf(t)
      if (s >= clusterEnd) flush()
      cluster.push(t)
      clusterEnd = cluster.length === 1 ? e : Math.max(clusterEnd, e)
    }
    flush()
  }
  return out
}

/**
 * Daily tasks, one day at a time: a busy day shows one chip per group, a
 * quiet day its tasks (each as that day's piece of the task).
 */
export function groupAllDay(tasks: Task[], from: Date, to: Date, keyOf: (t: Task) => GroupKey, noun = 'projects'): CalendarItem[] {
  const out: CalendarItem[] = []
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
    const next = addDays(d, 1)
    const today = tasks.filter((t) => {
      if (!t.start_at) return false
      const [s, e] = spanOf(t)
      return s < next.getTime() && e > d.getTime()
    })
    if (today.length <= MAX_PER_DAY) {
      for (const t of today) out.push({ kind: 'task', task: t, start: d, end: next, allDay: true, segment: true })
      continue
    }
    for (const g of blocksFor(today, keyOf, noun))
      out.push(
        g.single
          ? { kind: 'task', task: g.tasks[0], start: d, end: next, allDay: true, segment: true }
          : { kind: 'group', group: { ...g.key, tasks: g.tasks, start: d, end: next, allDay: true } },
      )
  }
  return out
}
