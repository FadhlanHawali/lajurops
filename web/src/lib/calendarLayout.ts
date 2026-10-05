import { differenceInCalendarDays } from 'date-fns'
import type { CalendarItem, TaskGroup } from './calendarGroups'
import type { Task } from './types'

/** Start/end of an item, in ms. */
export const itemStart = (it: CalendarItem) => (it.kind === 'group' ? it.group.start : it.start).getTime()
export const itemEnd = (it: CalendarItem) => (it.kind === 'group' ? it.group.end : it.end).getTime()
export const itemTasks = (it: CalendarItem): Task[] => (it.kind === 'group' ? it.group.tasks : [it.task])
export const itemId = (it: CalendarItem) => (it.kind === 'group' ? `g:${it.group.key}@${it.group.start.getTime()}` : `t:${it.task.id}@${it.start.getTime()}`)

/** A "+N more" pseudo group holding tasks that didn't fit. */
export const moreGroup = (tasks: Task[], start: Date, end: Date, allDay: boolean): TaskGroup => ({
  key: `more@${start.getTime()}`,
  label: `+${tasks.length} more`,
  color: 'slate',
  tasks,
  start,
  end,
  allDay,
})

export interface Placed {
  item: CalendarItem
  col: number
  ncol: number
}

/**
 * Side-by-side layout of one day's timed items: overlapping items share the
 * width of their cluster. A cluster needing more than maxCols columns shows
 * maxCols - 1 of them and a "+N more" block in the last.
 */
export function layoutTimed(items: CalendarItem[], maxCols: number): Placed[] {
  const sorted = [...items].sort((a, b) => itemStart(a) - itemStart(b) || itemEnd(b) - itemEnd(a))
  const out: Placed[] = []
  let cluster: { item: CalendarItem; col: number }[] = []
  let colEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    if (!cluster.length) return
    const ncol = colEnds.length
    if (ncol <= maxCols) {
      for (const c of cluster) out.push({ item: c.item, col: c.col, ncol })
    } else {
      const hidden = cluster.filter((c) => c.col >= maxCols - 1)
      for (const c of cluster) if (c.col < maxCols - 1) out.push({ item: c.item, col: c.col, ncol: maxCols })
      const start = Math.min(...hidden.map((c) => itemStart(c.item)))
      const end = Math.max(...hidden.map((c) => itemEnd(c.item)))
      out.push({
        item: { kind: 'group', group: moreGroup(hidden.flatMap((c) => itemTasks(c.item)), new Date(start), new Date(end), false) },
        col: maxCols - 1,
        ncol: maxCols,
      })
    }
    cluster = []
    colEnds = []
  }
  for (const item of sorted) {
    const s = itemStart(item)
    const e = Math.max(itemEnd(item), s + 15 * 60_000)
    if (s >= clusterEnd) flush()
    let col = colEnds.findIndex((end) => end <= s)
    if (col < 0) {
      col = colEnds.length
      colEnds.push(e)
    } else colEnds[col] = e
    cluster.push({ item, col })
    clusterEnd = cluster.length === 1 ? e : Math.max(clusterEnd, e)
  }
  flush()
  return out
}

export interface Laned {
  item: CalendarItem
  /** First and last+1 day column covered, within the row. */
  from: number
  to: number
  lane: number
}

/**
 * Lane layout of items across a row of days (the all-day row, or a month
 * week): each item gets the lowest lane free over all the days it covers.
 */
export function layoutLanes(items: CalendarItem[], days: Date[]): Laned[] {
  const first = days[0]
  const n = days.length
  const placed = items
    .map((item) => {
      const from = Math.max(0, differenceInCalendarDays(new Date(itemStart(item)), first))
      // The end is exclusive: a task ending at midnight doesn't cover that day.
      const to = Math.min(n, differenceInCalendarDays(new Date(itemEnd(item) - 1), first) + 1)
      return { item, from, to, lane: 0 }
    })
    .filter((p) => p.to > p.from)
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from) || itemStart(a.item) - itemStart(b.item))
  const lanes: number[][] = [] // lane -> end column of its last item
  for (const p of placed) {
    let lane = lanes.findIndex((ends) => ends.every((end) => end <= p.from))
    if (lane < 0) {
      lane = lanes.length
      lanes.push([])
    }
    lanes[lane].push(p.to)
    p.lane = lane
  }
  return placed
}
