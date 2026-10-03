import { useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type { EventContentArg, EventInput, EventDropArg, DatesSetArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { useTaskModal } from '../components/TaskModal'
import { FilterBar, userName } from '../components/ui'
import { useTaskFilters, useTasks, useUpdateTask, useUsers } from '../lib/queries'
import type { Task } from '../lib/types'

const COLORS = {
  project: { bg: '#f59e0b', border: '#d97706' },
  shortProject: { bg: '#fb923c', border: '#f97316' },
  hourly: { bg: '#8b5cf6', border: '#7c3aed' },
  daily: { bg: '#0ea5e9', border: '#0284c7' },
  done: { bg: '#10b981', border: '#059669' },
}

export default function Calendar({ workspaceId }: { workspaceId?: string }) {
  const { assignee, type } = useTaskFilters()
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  // Projects span weeks and would bury the actual work; show them only when filtered for.
  const { data: tasks = [] } = useTasks({ workspace_id: workspaceId, assignee_id: assignee, type: type || 'daily,hourly', ...range }, !!range)
  const update = useUpdateTask()
  const modal = useTaskModal()
  const { byId } = useUsers()

  const events = useMemo<EventInput[]>(
    () =>
      tasks
        .filter((t) => t.start_at)
        .map((t) => {
          const c = t.status === 'done' ? COLORS.done : t.project_kind === 'short' ? COLORS.shortProject : COLORS[t.type]
          const who = t.assignee_ids.map((id) => userName(byId.get(id))).join(', ')
          return {
            id: t.id,
            title: `${t.environment_name ? `[${t.environment_name}] ` : ''}${t.key} ${t.title}${who ? ` · ${who}` : ''}`,
            start: t.start_at!,
            end: t.end_at ?? undefined,
            allDay: t.type !== 'hourly',
            backgroundColor: c.bg,
            borderColor: c.border,
            classNames: t.status === 'done' ? ['opacity-60'] : [],
            extendedProps: { task: t },
          }
        }),
    [tasks, byId],
  )

  // Dropping into the all-day row turns a task daily; into the time grid, hourly.
  const persist = (arg: EventDropArg | EventResizeDoneArg) => {
    const ev = arg.event
    const task = ev.extendedProps.task as Task
    const start = ev.start!
    let end = ev.end
    if (!end) end = new Date(start.getTime() + (ev.allDay ? 86_400_000 : 2 * 3_600_000))
    update.mutate(
      {
        id: task.id,
        patch: { start_at: start.toISOString(), end_at: end.toISOString(), type: ev.allDay ? 'daily' : 'hourly' },
      },
      { onError: () => arg.revert() },
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <FilterBar />
      <div className="planner-calendar min-h-0 flex-1 rounded-lg border border-slate-200 bg-white p-3">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' }}
          height="100%"
          firstDay={1}
          nowIndicator
          editable
          selectable
          selectMirror
          dayMaxEvents={4}
          slotDuration="00:30:00"
          scrollTime="07:00:00"
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          events={events}
          datesSet={(arg: DatesSetArg) => setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() })}
          eventContent={renderEvent}
          eventClick={(arg) => modal.openTask(arg.event.id)}
          eventDrop={persist}
          eventResize={persist}
          select={(arg) => {
            modal.createTask({
              title: '',
              workspace_id: workspaceId,
              type: arg.allDay ? 'daily' : 'hourly',
              start_at: arg.start.toISOString(),
              end_at: arg.end.toISOString(),
              assignee_ids: assignee ? [assignee] : [],
            })
            arg.view.calendar.unselect()
          }}
        />
      </div>
    </div>
  )
}

/** Done tasks read "[DONE] ~~title~~"; everything else uses FullCalendar's default rendering. */
function renderEvent(arg: EventContentArg) {
  if ((arg.event.extendedProps.task as Task).status !== 'done') return true
  const title = (
    <>
      <b className="mr-1 no-underline">[DONE]</b>
      <span className="line-through">{arg.event.title}</span>
    </>
  )
  // The list view lays out time and title itself; only the title is ours there.
  if (arg.view.type.startsWith('list')) return title
  // Timed events in the month grid are a dot + time + title on one line.
  if (arg.view.type === 'dayGridMonth' && !arg.event.allDay)
    return (
      <>
        <div className="fc-daygrid-event-dot" style={{ borderColor: arg.event.backgroundColor }} />
        {arg.timeText && <div className="fc-event-time">{arg.timeText}</div>}
        <div className="fc-event-title">{title}</div>
      </>
    )
  return (
    <div className="fc-event-main-frame">
      {arg.timeText && <div className="fc-event-time">{arg.timeText}</div>}
      <div className="fc-event-title-container">
        <div className="fc-event-title fc-sticky">{title}</div>
      </div>
    </div>
  )
}
