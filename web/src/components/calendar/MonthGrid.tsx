import clsx from 'clsx'
import { addDays, format, isSameMonth, isToday, startOfDay } from 'date-fns'
import type { CalendarItem, TaskGroup } from '../../lib/calendarGroups'
import { itemId, itemStart, itemTasks, layoutLanes, moreGroup } from '../../lib/calendarLayout'
import type { Task } from '../../lib/types'
import { hhmm, itemStyle, itemTitle, TaskLabel } from './items'

const LANE = 20
const MAX_LANES = 3
const HEAD = 24

/** Six weeks from `start` (a Monday): multi-day bars, timed tasks as dots, "+N more" per day. */
export function MonthGrid({
  start,
  month,
  items,
  onOpenTask,
  onOpenGroup,
  onCreate,
  onPickDay,
}: {
  start: Date
  month: Date
  items: CalendarItem[]
  onOpenTask: (t: Task) => void
  onOpenGroup: (g: TaskGroup) => void
  onCreate: ((start: Date, end: Date, allDay: boolean) => void) | null
  onPickDay: (d: Date) => void
}) {
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
  const open = (it: CalendarItem) => (it.kind === 'group' ? onOpenGroup(it.group) : onOpenTask(it.task))

  return (
    <div className="flex h-full flex-col select-none">
      <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs font-medium text-slate-500">
        {weeks[0].map((d) => (
          <div key={d.toISOString()} className="py-1.5">
            {format(d, 'EEE')}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6">
        {weeks.map((days) => {
          const lanes = layoutLanes(items, days)
          return (
            <div key={days[0].toISOString()} className="relative grid min-h-[104px] grid-cols-7 border-b border-slate-200 last:border-b-0">
              {days.map((d, i) => {
                const hidden = lanes.filter((l) => l.lane >= MAX_LANES && l.from <= i && l.to > i)
                return (
                  <div
                    key={d.toISOString()}
                    className={clsx('relative border-l border-slate-200 first:border-l-0', !isSameMonth(d, month) && 'bg-slate-50/70', onCreate && 'cursor-pointer hover:bg-slate-50')}
                    onClick={() => onCreate?.(startOfDay(d), addDays(startOfDay(d), 1), true)}
                    title={onCreate ? 'Click to add a daily task' : undefined}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPickDay(d)
                      }}
                      className={clsx(
                        'absolute top-1 right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs hover:bg-slate-200',
                        isToday(d) ? 'bg-blue-600 font-semibold text-white hover:bg-blue-700' : isSameMonth(d, month) ? 'text-slate-700' : 'text-slate-400',
                      )}
                      title="Open this day"
                    >
                      {format(d, 'd')}
                    </button>
                    {hidden.length > 0 && (
                      <button
                        type="button"
                        className="absolute left-1 rounded px-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200"
                        style={{ top: HEAD + MAX_LANES * LANE }}
                        onClick={(e) => {
                          e.stopPropagation()
                          const day = startOfDay(d)
                          const all = lanes.filter((l) => l.from <= i && l.to > i).flatMap((l) => itemTasks(l.item))
                          onOpenGroup({ ...moreGroup(all, day, addDays(day, 1), true), label: format(day, 'EEEE d MMMM') })
                        }}
                      >
                        +{hidden.length} more
                      </button>
                    )}
                  </div>
                )
              })}
              {lanes
                .filter((l) => l.lane < MAX_LANES)
                .map((l) => {
                  const timed = l.item.kind === 'task' && !l.item.allDay
                  return (
                    <button
                      key={itemId(l.item)}
                      type="button"
                      title={itemTitle(l.item)}
                      onClick={(e) => {
                        e.stopPropagation()
                        open(l.item)
                      }}
                      className={clsx('absolute truncate rounded px-1.5 text-left text-[11px] leading-[18px]', timed ? 'text-slate-700 hover:bg-slate-100' : 'hover:brightness-95')}
                      style={{
                        ...(timed ? {} : itemStyle(l.item)),
                        top: HEAD + l.lane * LANE,
                        height: LANE - 2,
                        left: `calc(${(l.from / 7) * 100}% + 2px)`,
                        width: `calc(${((l.to - l.from) / 7) * 100}% - 4px)`,
                      }}
                    >
                      {timed && l.item.kind === 'task' ? (
                        <>
                          <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: itemStyle(l.item).backgroundColor }} />
                          <span className="mr-1 text-slate-500 tabular-nums">{hhmm(new Date(itemStart(l.item)))}</span>
                          <TaskLabel task={l.item.task} withKey={false} />
                        </>
                      ) : l.item.kind === 'group' ? (
                        <>
                          <b className="font-semibold">{l.item.group.label}</b> · {l.item.group.tasks.length}
                        </>
                      ) : (
                        <TaskLabel task={l.item.task} />
                      )}
                    </button>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
