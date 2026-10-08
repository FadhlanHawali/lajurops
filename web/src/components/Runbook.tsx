import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { addMinutes, format, isSameDay } from 'date-fns'
import { ArrowDown, ArrowUp, CalendarDays, CalendarPlus, ChevronDown, ChevronRight, FileText, ListChecks, Pencil, Plus, Save, Trash2, Unlink, X } from 'lucide-react'
import { useReadOnly } from '../lib/access'
import { colorForId, dotStyle, pillStyle } from '../lib/colors'
import { formatDuration } from '../lib/dates'
import { DateField, DateTimeField } from './DateTimePicker'
import { userTimeZone, useRunbook, useRunbookMutations, useRunbookTemplates, type StepInput } from '../lib/queries'
import { statusLabel, type RunbookSection, type RunbookStep, type Task } from '../lib/types'
import { MarkdownEditor } from './Comments'
import { Markdown } from './Markdown'
import { Popover } from './Popover'
import { Button, Field, inputCls } from './ui'

/** Colours for the usual section names; others get a stable colour from their name. */
const SECTION_COLORS: Record<string, string> = {
  preparation: 'blue',
  implementation: 'red',
  verification: 'green',
  rollback: 'amber',
  communication: 'violet',
}
const sectionColor = (name: string) => SECTION_COLORS[name.trim().toLowerCase()] ?? colorForId(name.toLowerCase())
const SUGGESTED = ['Preparation', 'Implementation', 'Verification', 'Rollback']
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480, 1440]
const LOCAL = "yyyy-MM-dd'T'HH:mm"

const minutesOf = (steps: RunbookStep[]) => steps.reduce((a, s) => a + (s.duration_minutes ?? 0), 0)
const stepEnd = (s: RunbookStep) => (s.start_at ? addMinutes(new Date(s.start_at), s.duration_minutes ?? 0) : null)

/** "Tue Oct 6 – Fri Oct 9" for the steps that have a date. */
function spanOf(steps: RunbookStep[]): string {
  const timed = steps.filter((s) => s.start_at)
  if (!timed.length) return ''
  const a = new Date(Math.min(...timed.map((s) => Date.parse(s.start_at!))))
  const b = new Date(Math.max(...timed.map((s) => stepEnd(s)!.getTime())))
  return isSameDay(a, b) ? format(a, 'EEE MMM d') : `${format(a, 'EEE MMM d')} – ${format(b, 'EEE MMM d')}`
}

/** The day a step falls on, as YYYY-MM-DD ('' when it has no date). */
const dayOf = (s: RunbookStep) => (s.start_at ? format(new Date(s.start_at), 'yyyy-MM-dd') : '')

/**
 * An hourly task's runbook: named sections of steps, each step optionally
 * with a date, start time and duration. Times can be saved into a workspace
 * template relative to the task's start. A step can also be tracked as its
 * own daily task (e.g. preparation the day before); ticking one completes
 * the other.
 */
export function Runbook({ task, onOpen }: { task: Task; onOpen?: (id: string) => void }) {
  const { data: sections = [], isLoading } = useRunbook(task.id)
  const mut = useRunbookMutations(task.id, task.workspace_id)
  const readOnly = useReadOnly()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [newSection, setNewSection] = useState('')
  const [error, setError] = useState('')

  const steps = sections.flatMap((s) => s.steps)
  const done = steps.filter((s) => s.done).length
  const work = minutesOf(steps)
  const run = async (p: Promise<unknown>) => {
    setError('')
    try {
      await p
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const addSection = (name: string) => {
    const n = name.trim()
    if (!n) return setError('Name the section first')
    if (sections.some((s) => s.name.toLowerCase() === n.toLowerCase())) return setError('A section with that name already exists')
    setNewSection('')
    run(mut.addSection.mutateAsync(n))
  }
  const move = (i: number, d: -1 | 1) => {
    const ids = sections.map((s) => s.id)
    ;[ids[i], ids[i + d]] = [ids[i + d], ids[i]]
    run(mut.orderSections.mutateAsync(ids))
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <ListChecks size={15} /> Runbook
        </h3>
        {steps.length > 0 && (
          <span className="text-xs text-slate-500">
            {done} of {steps.length} steps done{work > 0 && ` · ${formatDuration(work)} of work`}
          </span>
        )}
        {!readOnly && (
          <span className="ml-auto flex items-center gap-1">
            <TemplatePicker task={task} onApply={(id) => run(mut.applyTemplate.mutateAsync(id))} onDelete={(id) => run(mut.deleteTemplate.mutateAsync(id))} />
            {sections.length > 0 && <SaveTemplate defaultName={task.title} onSave={(n) => mut.saveTemplate.mutateAsync(n)} />}
          </span>
        )}
      </div>

      {/* Work per section, as a bar. */}
      {work > 0 && (
        <div className="mb-1 flex h-2 overflow-hidden rounded bg-slate-100">
          {sections.map((s) => {
            const m = minutesOf(s.steps)
            return m ? <div key={s.id} title={`${s.name}: ${formatDuration(m)}`} className="border-r-2 border-white last:border-r-0" style={{ flex: m, ...dotStyle(sectionColor(s.name)), opacity: 0.55 }} /> : null
          })}
        </div>
      )}

      {isLoading ? (
        <div className="h-10 animate-pulse rounded-md bg-slate-100" />
      ) : sections.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">
          {readOnly ? 'No runbook for this task.' : 'No runbook yet. Add sections such as Preparation and Implementation below, or start from a template.'}
        </p>
      ) : (
        <div className="space-y-2">
          {sections.map((s, i) => (
            <Section
              key={s.id}
              section={s}
              task={task}
              first={i === 0}
              last={i === sections.length - 1}
              open={!collapsed.has(s.id)}
              onToggle={() =>
                setCollapsed((c) => {
                  const n = new Set(c)
                  if (!n.delete(s.id)) n.add(s.id)
                  return n
                })
              }
              onMove={(d) => move(i, d)}
              onRename={(name) => run(mut.updateSection.mutateAsync({ id: s.id, name }))}
              onNotes={(notes) => run(mut.updateSection.mutateAsync({ id: s.id, notes }))}
              onDelete={() => {
                if (s.steps.length && !confirm(`Remove "${s.name}" and its ${s.steps.length} step${s.steps.length === 1 ? '' : 's'}?`)) return
                run(mut.deleteSection.mutateAsync(s.id))
              }}
              onAddStep={(input) => run(mut.addStep.mutateAsync({ sectionId: s.id, input }))}
              onMakeTask={(id, day) => run(mut.makeTask.mutateAsync({ id, day }))}
              onUnlinkTask={(id) => run(mut.unlinkTask.mutateAsync(id))}
              onOpen={onOpen}
              onUpdateStep={(id, input) => run(mut.updateStep.mutateAsync({ id, input }))}
              onDeleteStep={(id) => run(mut.deleteStep.mutateAsync(id))}
            />
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <form
            className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 focus-within:border-blue-500"
            onSubmit={(e) => {
              e.preventDefault()
              addSection(newSection)
            }}
          >
            <Plus size={13} className="text-slate-400" />
            <input className="w-44 bg-transparent py-1 text-sm focus:outline-none" placeholder="Add a section…" value={newSection} onChange={(e) => setNewSection(e.target.value)} />
          </form>
          {SUGGESTED.filter((n) => !sections.some((s) => s.name.toLowerCase() === n.toLowerCase())).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => addSection(n)}
              className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:border-slate-400 hover:bg-slate-50"
            >
              + {n}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </section>
  )
}

function Section({
  section: s,
  task,
  first,
  last,
  open,
  onToggle,
  onMove,
  onRename,
  onNotes,
  onDelete,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  onMakeTask,
  onUnlinkTask,
  onOpen,
}: {
  section: RunbookSection
  task: Task
  first: boolean
  last: boolean
  open: boolean
  onToggle: () => void
  onMove: (d: -1 | 1) => void
  onRename: (name: string) => void
  onNotes: (notes: string) => void
  onDelete: () => void
  onAddStep: (input: StepInput) => void
  onUpdateStep: (id: string, input: StepInput) => void
  onDeleteStep: (id: string) => void
  onMakeTask: (id: string, day: string) => void
  onUnlinkTask: (id: string) => void
  onOpen?: (id: string) => void
}) {
  const readOnly = useReadOnly()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(s.name)
  // Steps share one grid per section, so columns fit its widest date and
  // duration and rows stay aligned. The add/edit step dialog: {} adds a
  // step, {step} edits one.
  const [dialog, setDialog] = useState<{ step?: RunbookStep } | null>(null)
  const [notesDraft, setNotesDraft] = useState<string | null>(null) // editing the section's notes
  const color = sectionColor(s.name)
  const done = s.steps.filter((x) => x.done).length
  const m = minutesOf(s.steps)
  const span = spanOf(s.steps)
  const icon = 'rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30'
  // The next step starts where the last one with a time ends (or at the task's start).
  const lastEnd = [...s.steps].reverse().map(stepEnd).find(Boolean) ?? (task.start_at ? new Date(task.start_at) : null)

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="group flex items-center gap-2 bg-slate-50 px-2 py-1.5 text-sm">
        <button type="button" className={icon} onClick={onToggle} aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={pillStyle(color)} />
        {renaming ? (
          <input
            autoFocus
            className="w-48 rounded border border-blue-500 px-1 text-sm focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false)
              if (name.trim() && name.trim() !== s.name) onRename(name.trim())
              else setName(s.name)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setName(s.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <button type="button" className="font-semibold text-slate-800" disabled={readOnly} onClick={() => setRenaming(true)} title={readOnly ? undefined : 'Rename'}>
            {s.name}
          </button>
        )}
        <span className="truncate text-xs text-slate-500">
          {done}/{s.steps.length}
          {m > 0 && ` · ${formatDuration(m)}`}
          {span && ` · ${span}`}
        </span>
        {!readOnly && (
          <span className="ml-auto flex items-center">
            <button type="button" className={icon} onClick={() => setNotesDraft(notesDraft === null ? s.notes : null)} title={s.notes ? 'Edit section notes' : 'Add section notes'}>
              <FileText size={13} />
            </button>
            <button type="button" className={icon} disabled={first} onClick={() => onMove(-1)} title="Move up">
              <ArrowUp size={13} />
            </button>
            <button type="button" className={icon} disabled={last} onClick={() => onMove(1)} title="Move down">
              <ArrowDown size={13} />
            </button>
            <button type="button" className={clsx(icon, 'hover:bg-red-50 hover:text-red-600')} onClick={onDelete} title="Remove section">
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>
      {open && notesDraft !== null && (
        <div className="border-b border-slate-100 p-2">
          <MarkdownEditor
            autoFocus
            value={notesDraft}
            onChange={setNotesDraft}
            onSubmit={() => {
              onNotes(notesDraft)
              setNotesDraft(null)
            }}
            placeholder="Notes for this section… Markdown supported (e.g. prerequisites, links)"
            footer={
              <>
                <Button type="button" variant="ghost" onClick={() => setNotesDraft(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    onNotes(notesDraft)
                    setNotesDraft(null)
                  }}
                >
                  Save notes
                </Button>
              </>
            }
          />
        </div>
      )}
      {open && notesDraft === null && s.notes.trim() && (
        <div className="border-b border-slate-100 bg-slate-50/50 px-3 py-1.5">
          <Markdown className="text-[13px]">{s.notes}</Markdown>
        </div>
      )}
      {open && (
        <ul className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] gap-x-2 divide-y divide-slate-100">
          {s.steps.map((st) => (
            <StepRow
              key={st.id}
              step={st}
              onToggle={(v) => onUpdateStep(st.id, { done: v })}
              onEdit={() => (st.task ? onOpen?.(st.task.id) : setDialog({ step: st }))}
              onDelete={() => {
                if (st.task && !confirm(`Remove this step? The daily task ${st.task.workspace_key}-${st.task.number} stays.`)) return
                onDeleteStep(st.id)
              }}
              onMakeTask={() => onMakeTask(st.id, dayOf(st))}
              onUnlinkTask={() => {
                if (confirm(`Make this a plain checklist item again? The daily task ${st.task!.workspace_key}-${st.task!.number} stays, but ticking one no longer ticks the other.`))
                  onUnlinkTask(st.id)
              }}
              onOpen={onOpen}
            />
          ))}
          {s.steps.length === 0 && <li className="col-span-full px-3 py-2 text-xs text-slate-400">No steps yet.</li>}
          {!readOnly && (
            <li className="col-span-full">
              <button
                type="button"
                className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-blue-600"
                onClick={() => setDialog({})}
              >
                <Plus size={13} /> Add step
              </button>
            </li>
          )}
        </ul>
      )}
      {dialog && (
        <StepDialog
          sectionName={s.name}
          initial={dialog.step}
          defaultStart={lastEnd}
          onSubmit={(input) => (dialog.step ? onUpdateStep(dialog.step.id, input) : onAddStep(input))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function StepRow({
  step: s,
  onToggle,
  onEdit,
  onDelete,
  onMakeTask,
  onUnlinkTask,
  onOpen,
}: {
  step: RunbookStep
  onToggle: (done: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onMakeTask: () => void
  onUnlinkTask: () => void
  onOpen?: (id: string) => void
}) {
  const readOnly = useReadOnly()
  const [showNotes, setShowNotes] = useState(false)
  const hasNotes = !!s.notes.trim()
  const t = s.task
  const key = t ? `${t.workspace_key}-${t.number}` : ''
  // A daily task is overdue once its day is over; a timed step once it should have started.
  const due = t ? t.end_at : s.start_at
  const overdue = !s.done && !!due && Date.parse(due) < Date.now()
  const action = 'rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
  return (
    <li className="group col-span-full grid grid-cols-subgrid">
    <div className="col-span-full grid grid-cols-subgrid items-center px-3 py-1.5 text-sm">
      <input
        type="checkbox"
        checked={s.done}
        disabled={readOnly}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={s.title}
        title={t ? `Ticking this marks ${key} done` : undefined}
      />
      <span className={clsx('text-xs tabular-nums', overdue ? 'font-medium text-red-600' : 'text-slate-500')} title={overdue ? 'Overdue' : undefined}>
        {t ? (s.start_at ? format(new Date(s.start_at), 'EEE MMM d') : 'no date yet') : s.start_at ? format(new Date(s.start_at), 'EEE MMM d · HH:mm') : 'no time'}
      </span>
      {t ? (
        <span className="flex items-center justify-center gap-0.5 rounded bg-blue-50 px-1 text-[11px] font-medium text-blue-700" title="Tracked as a daily task">
          <CalendarDays size={11} /> day
        </span>
      ) : (
        <span className="rounded bg-slate-100 px-1 text-center text-[11px] text-slate-600">{s.duration_minutes ? formatDuration(s.duration_minutes) : '—'}</span>
      )}
      <span className="flex min-w-0 items-center gap-1.5">
        {hasNotes ? (
          <button
            type="button"
            className={clsx('min-w-0 truncate text-left hover:underline', s.done ? 'text-slate-400 line-through' : 'text-slate-800')}
            title={showNotes ? 'Hide notes' : 'Show notes'}
            onClick={() => setShowNotes(!showNotes)}
          >
            {s.title}
          </button>
        ) : (
          <span className={clsx('truncate', s.done ? 'text-slate-400 line-through' : 'text-slate-800')} title={s.title}>
            {s.title}
          </span>
        )}
        {hasNotes && (
          <button
            type="button"
            className={clsx('shrink-0 rounded p-0.5', showNotes ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600')}
            title={showNotes ? 'Hide notes' : 'Show notes'}
            onClick={() => setShowNotes(!showNotes)}
          >
            <FileText size={13} />
          </button>
        )}
        {t && (
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-px text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-700"
            title={`Open the daily task ${key}`}
            onClick={() => onOpen?.(t.id)}
          >
            <span className="font-medium text-blue-600">{key}</span>
            <span className={clsx(t.status === 'done' ? 'text-green-700' : t.status === 'todo' ? 'text-slate-500' : 'text-amber-700')}>{statusLabel(t.status)}</span>
          </button>
        )}
      </span>
      {!readOnly ? (
        <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          {t ? (
            <button type="button" className={action} title="Make it a plain checklist item (the daily task stays)" onClick={onUnlinkTask}>
              <Unlink size={13} />
            </button>
          ) : (
            <button type="button" className={action} title="Track as a daily task" onClick={onMakeTask}>
              <CalendarPlus size={13} />
            </button>
          )}
          <button type="button" className={action} title={t ? `Edit in ${key}` : 'Edit step'} onClick={onEdit}>
            <Pencil size={13} />
          </button>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove step" onClick={onDelete}>
            <X size={13} />
          </button>
        </span>
      ) : (
        <span />
      )}
    </div>
    {hasNotes && showNotes && (
      <div className="col-span-full mx-3 mb-2 ml-[30px] rounded-md border border-slate-200 bg-white px-3 py-1.5">
        <Markdown className="text-[13px]">{s.notes}</Markdown>
      </div>
    )}
    </li>
  )
}

/**
 * Add or edit a step in a small dialog: what, when (optional) and for how
 * long (optional). A new step can instead be a daily task on a day.
 */
function StepDialog({
  sectionName,
  initial,
  defaultStart,
  onSubmit,
  onClose,
}: {
  sectionName: string
  initial?: RunbookStep
  defaultStart: Date | null
  onSubmit: (input: StepInput) => void
  onClose: () => void
}) {
  const start0 = initial ? (initial.start_at ? new Date(initial.start_at) : null) : defaultStart
  const [asTask, setAsTask] = useState(false)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [start, setStart] = useState(start0 ? format(start0, LOCAL) : '') // checklist: date & time
  const [day, setDay] = useState(start0 ? format(start0, 'yyyy-MM-dd') : '') // daily task: the day
  const [dur, setDur] = useState<number | null>(initial ? initial.duration_minutes : 30)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [withNotes, setWithNotes] = useState(!!initial?.notes)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  // Escape closes only this dialog, wherever the focus is, and not the task
  // dialog under it. While a date/time picker is open, Escape closes that.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[data-floating-ui-portal] > *')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  // Switching kind keeps the day/date in step and the cursor in the title.
  const switchKind = (task: boolean) => {
    setAsTask(task)
    if (task && start) setDay(start.slice(0, 10))
    if (!task && day && !start) setStart(`${day}T09:00`)
    titleRef.current?.focus()
  }

  /** Saves; with another, keeps the dialog open for the next step (starting where this one ends). */
  const submit = (another = false) => {
    if (!title.trim()) return setError('Enter what the step is first')
    const body = withNotes ? notes : ''
    if (asTask) {
      onSubmit({ title: title.trim(), notes: body, task: { day, tz: userTimeZone() } })
    } else {
      const startAt = start ? new Date(start).toISOString() : null
      onSubmit({ title: title.trim(), notes: body, start_at: startAt, duration_minutes: dur })
      if (another && startAt && dur) setStart(format(addMinutes(new Date(startAt), dur), LOCAL))
    }
    if (!another) return onClose()
    setTitle('')
    setNotes('')
    setWithNotes(false)
    setError('')
    titleRef.current?.focus()
  }

  const kind = (on: boolean) =>
    clsx('flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-sm', on ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
  const chip = (on: boolean) =>
    clsx(
      'rounded-full border px-2 py-0.5 text-[11px] font-medium transition',
      on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
    )

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 pt-[12vh]" onMouseDown={onClose}>
      <form
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">{initial ? 'Edit step' : `Add a step to ${sectionName}`}</h2>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          {!initial && (
            <div>
              <div className="flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Add as">
                <button type="button" className={kind(!asTask)} aria-pressed={!asTask} onClick={() => switchKind(false)}>
                  <ListChecks size={14} /> Checklist item
                </button>
                <button type="button" className={clsx(kind(asTask), 'border-l border-slate-300')} aria-pressed={asTask} onClick={() => switchKind(true)}>
                  <CalendarDays size={14} /> Daily task
                </button>
              </div>
              {asTask && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Creates a daily task on that day, with this task's project and assignees. This task then waits for it, and ticking the step marks it done.
                </p>
              )}
            </div>
          )}
          <Field label={asTask ? 'Daily task' : 'Step'}>
            <input
              ref={titleRef}
              autoFocus
              className={inputCls}
              placeholder={asTask ? 'e.g. Prepare the rollback scripts' : 'e.g. Run database migrations'}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setError('')
              }}
            />
          </Field>
          {asTask ? (
            <Field label="Day">
              <DateField value={day} onChange={setDay} placeholder="Plan later" />
            </Field>
          ) : (
            <>
              <Field label="Start">
                <DateTimeField value={start} onChange={setStart} placeholder="No time" />
              </Field>
              <Field label="Duration">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" className={chip(dur === null)} onClick={() => setDur(null)}>
                    None
                  </button>
                  {DURATIONS.map((m) => (
                    <button key={m} type="button" className={chip(dur === m)} onClick={() => setDur(m)}>
                      {m === 1440 ? '1 day' : formatDuration(m)}
                    </button>
                  ))}
                  {dur !== null && !DURATIONS.includes(dur) && <span className="text-[11px] font-medium text-slate-500">{formatDuration(dur)}</span>}
                </div>
              </Field>
            </>
          )}
          {withNotes ? (
            <Field label="Notes">
              <MarkdownEditor
                value={notes}
                onChange={setNotes}
                onSubmit={() => submit()}
                placeholder={'Markdown supported. Put commands in a code block:\n```bash\n./migrate up\n```'}
              />
            </Field>
          ) : (
            <button type="button" className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline" onClick={() => setWithNotes(true)}>
              <FileText size={12} /> Add notes
            </button>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!initial && (
            <Button type="button" onClick={() => submit(true)} title="Add this step and start the next one">
              Add & next
            </Button>
          )}
          <Button type="submit" variant="primary">
            {initial ? 'Save' : 'Add'}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

/** Start from (append) one of the workspace's templates. */
function TemplatePicker({ task, onApply, onDelete }: { task: Task; onApply: (id: string) => void; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const { data: templates = [] } = useRunbookTemplates(open ? task.workspace_id : undefined)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={(props) => (
        <button type="button" {...props} className="rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50">
          Templates
        </button>
      )}
    >
      <div className="w-72 p-1">
        <p className="px-2 pt-1 pb-1.5 text-[11px] text-slate-500">Add a template's sections to this runbook. Times move with the task's start; steps saved as daily tasks create new ones.</p>
        {templates.length === 0 && <p className="px-2 py-3 text-center text-xs text-slate-400">No templates in this workspace yet. Save a runbook as one.</p>}
        {templates.map((t) => (
          <div key={t.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                onApply(t.id)
                setOpen(false)
              }}
            >
              <span className="block truncate text-sm text-slate-800">{t.name}</span>
              <span className="block text-[11px] text-slate-400">
                {t.sections.map((s) => s.name).join(' · ')} · {t.step_count} steps
              </span>
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
              title="Delete template"
              onClick={() => confirm(`Delete the template "${t.name}"?`) && onDelete(t.id)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </Popover>
  )
}

/** Save this runbook as a workspace template (same name replaces it). */
function SaveTemplate({ defaultName, onSave }: { defaultName: string; onSave: (name: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [state, setState] = useState<'' | 'saving' | 'saved'>('')
  const [error, setError] = useState('')
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setName(defaultName)
          setState('')
          setError('')
        }
      }}
      trigger={(props) => (
        <button type="button" {...props} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50">
          <Save size={12} /> Save as template
        </button>
      )}
    >
      <form
        className="w-72 space-y-2 p-3"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return setError('Name the template first')
          setState('saving')
          try {
            await onSave(name.trim())
            setState('saved')
            setTimeout(() => setOpen(false), 700)
          } catch (err) {
            setState('')
            setError((err as Error).message)
          }
        }}
      >
        <label className="block text-xs font-medium text-slate-600">
          Template name
          <input autoFocus className="mt-1 h-8 w-full rounded border border-slate-300 px-2 text-sm focus:border-blue-500 focus:outline-none" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="text-[11px] text-slate-500">Saved for this workspace. Step times are kept relative to the task's start; a template with the same name is replaced.</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" className="h-7 px-2 text-xs" disabled={state === 'saving'}>
            {state === 'saved' ? 'Saved' : 'Save template'}
          </Button>
        </div>
      </form>
    </Popover>
  )
}
