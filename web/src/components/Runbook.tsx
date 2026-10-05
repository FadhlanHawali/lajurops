import { useState } from 'react'
import clsx from 'clsx'
import { addMinutes, format, isSameDay } from 'date-fns'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock, FileText, ListChecks, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { useReadOnly } from '../lib/access'
import { colorForId, dotStyle, pillStyle } from '../lib/colors'
import { formatDuration } from '../lib/dates'
import { useRunbook, useRunbookMutations, useRunbookTemplates, type StepInput } from '../lib/queries'
import type { RunbookSection, RunbookStep, Task } from '../lib/types'
import { MarkdownEditor } from './Comments'
import { Markdown } from './Markdown'
import { Popover } from './Popover'
import { Button } from './ui'

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

/**
 * A task's runbook: named sections of steps, each step optionally with a
 * date, start time and duration. Times can be saved into a workspace template
 * relative to the task's start.
 */
export function Runbook({ task }: { task: Task }) {
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
}) {
  const readOnly = useReadOnly()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(s.name)
  const [editing, setEditing] = useState<string | null>(null)
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
        <ul className="divide-y divide-slate-100">
          {s.steps.map((st) =>
            editing === st.id ? (
              <li key={st.id}>
                <StepForm
                  initial={st}
                  defaultStart={st.start_at ? new Date(st.start_at) : lastEnd}
                  submitLabel="Save"
                  onSubmit={(input) => {
                    onUpdateStep(st.id, input)
                    setEditing(null)
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <StepRow key={st.id} step={st} onToggle={(v) => onUpdateStep(st.id, { done: v })} onEdit={() => setEditing(st.id)} onDelete={() => onDeleteStep(st.id)} />
            ),
          )}
          {s.steps.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">No steps yet.</li>}
          {!readOnly && (
            <li>
              <StepForm defaultStart={lastEnd} placeholder={`Add a step to ${s.name}`} submitLabel="Add" onSubmit={onAddStep} />
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function StepRow({ step: s, onToggle, onEdit, onDelete }: { step: RunbookStep; onToggle: (done: boolean) => void; onEdit: () => void; onDelete: () => void }) {
  const readOnly = useReadOnly()
  const [showNotes, setShowNotes] = useState(false)
  const hasNotes = !!s.notes.trim()
  const overdue = !s.done && !!s.start_at && Date.parse(s.start_at) < Date.now()
  return (
    <li className="group">
    <div className="grid grid-cols-[18px_128px_52px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-sm">
      <input type="checkbox" checked={s.done} disabled={readOnly} onChange={(e) => onToggle(e.target.checked)} aria-label={s.title} />
      <span className={clsx('text-xs tabular-nums', overdue ? 'font-medium text-red-600' : 'text-slate-500')} title={overdue ? 'Overdue' : undefined}>
        {s.start_at ? format(new Date(s.start_at), 'EEE MMM d · HH:mm') : 'no time'}
      </span>
      <span className="rounded bg-slate-100 px-1 text-center text-[11px] text-slate-600">{s.duration_minutes ? formatDuration(s.duration_minutes) : '—'}</span>
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
      </span>
      {!readOnly ? (
        <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit step" onClick={onEdit}>
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
      <div className="mx-3 mb-2 ml-[30px] rounded-md border border-slate-200 bg-white px-3 py-1.5">
        <Markdown className="text-[13px]">{s.notes}</Markdown>
      </div>
    )}
    </li>
  )
}

/** Add or edit a step: what, when (optional) and for how long (optional). */
function StepForm({
  initial,
  defaultStart,
  placeholder = 'Step',
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: RunbookStep
  defaultStart: Date | null
  placeholder?: string
  submitLabel: string
  onSubmit: (input: StepInput) => void
  onCancel?: () => void
}) {
  const start = initial ? (initial.start_at ? new Date(initial.start_at) : null) : defaultStart
  const [title, setTitle] = useState(initial?.title ?? '')
  const [date, setDate] = useState(start ? format(start, 'yyyy-MM-dd') : '')
  const [time, setTime] = useState(start ? format(start, 'HH:mm') : '')
  const [dur, setDur] = useState(initial ? String(initial.duration_minutes ?? '') : '30')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [withNotes, setWithNotes] = useState(!!initial?.notes)
  const [error, setError] = useState('')

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!title.trim()) return setError('Enter what the step is first')
    if (time && !date) return setError('Pick a date for that time')
    const startAt = date ? new Date(`${date}T${time || '00:00'}`).toISOString() : null
    onSubmit({ title: title.trim(), notes: withNotes ? notes : '', start_at: startAt, duration_minutes: dur ? Number(dur) : null })
    setError('')
    if (!initial) {
      setTitle('')
      setNotes('')
      setWithNotes(false)
      // Chain the next step after this one.
      if (startAt && dur) {
        const next = addMinutes(new Date(startAt), Number(dur))
        setDate(format(next, 'yyyy-MM-dd'))
        setTime(format(next, 'HH:mm'))
      }
    }
  }

  const input = 'h-7 rounded border border-slate-200 bg-white px-1.5 text-xs focus:border-blue-500 focus:outline-none'
  return (
    <form onSubmit={submit} className={clsx('px-3 py-1.5', initial && 'bg-blue-50/40')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          autoFocus={!!initial}
          className={clsx(input, 'min-w-40 flex-1 text-sm')}
          placeholder={placeholder}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setError('')
          }}
          onKeyDown={(e) => e.key === 'Escape' && onCancel && (e.stopPropagation(), onCancel())}
        />
        <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input type="time" className={input} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Start time" />
        <span className="flex items-center gap-1 text-slate-400">
          <Clock size={12} />
          <select className={input} value={dur} onChange={(e) => setDur(e.target.value)} aria-label="Duration">
            <option value="">no duration</option>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m === 1440 ? '1 day' : formatDuration(m)}
              </option>
            ))}
          </select>
        </span>
        {!withNotes && (
          <button type="button" className="flex items-center gap-1 px-1 text-xs font-medium text-blue-600 hover:underline" onClick={() => setWithNotes(true)}>
            <FileText size={12} /> Add notes
          </button>
        )}
        <Button type="submit" className="h-7 px-2 text-xs">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {withNotes && (
        <div className="mt-1.5">
          <MarkdownEditor
            value={notes}
            onChange={setNotes}
            onSubmit={() => submit()}
            placeholder={'Notes… Markdown supported. Put commands in a code block:\n```bash\n./migrate up\n```'}
          />
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </form>
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
        <p className="px-2 pt-1 pb-1.5 text-[11px] text-slate-500">Add a template's sections to this runbook. Times move with the task's start.</p>
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
