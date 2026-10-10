import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import { Bold, Code, Italic, Link2, List, ListChecks, ListOrdered, Loader2, MessageSquare, Pencil, Quote, Trash2 } from 'lucide-react'
import { useReadOnly } from '../lib/access'
import { useCommentMutations, useComments, useMe, useUsers } from '../lib/queries'
import type { Comment } from '../lib/types'
import { Markdown } from './Markdown'
import { Avatar, Button, userName } from './ui'

export function Comments({ taskId }: { taskId: string }) {
  const { data: comments = [], isLoading } = useComments(taskId)
  const { create } = useCommentMutations(taskId)
  const readOnly = useReadOnly()
  const [draft, setDraft] = useState('')

  const post = async () => {
    if (!draft.trim()) return
    await create.mutateAsync(draft)
    setDraft('')
  }

  return (
    <section>
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <MessageSquare size={15} /> Comments
        {comments.length > 0 && <span className="font-normal text-slate-400">{comments.length}</span>}
      </h3>

      {isLoading && <div className="h-10 animate-pulse rounded-md bg-slate-100" />}
      <ol className="space-y-4">
        {comments.map((c) => (
          <CommentItem key={c.id} comment={c} taskId={taskId} />
        ))}
      </ol>

      {readOnly ? (
        comments.length === 0 && !isLoading && <p className="text-xs text-slate-400">No comments yet.</p>
      ) : (
      <div className="mt-4">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          onSubmit={post}
          mentions
          placeholder="Add a comment… Markdown supported, @name to mention someone"
          footer={
            <>
              {create.error && <span className="mr-auto text-xs text-red-600">{create.error.message}</span>}
              <Button variant="primary" onClick={post} disabled={!draft.trim() || create.isPending}>
                {create.isPending && <Loader2 size={14} className="animate-spin" />}
                Comment
              </Button>
            </>
          }
        />
      </div>
      )}
    </section>
  )
}

function CommentItem({ comment: c, taskId }: { comment: Comment; taskId: string }) {
  const { byId } = useUsers()
  const me = useMe().data
  const { update, remove } = useCommentMutations(taskId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.body)
  const author = c.author_id ? byId.get(c.author_id) : undefined
  const readOnly = useReadOnly()
  const mine = !!me && c.author_id === me.id && !readOnly
  const edited = new Date(c.updated_at).getTime() - new Date(c.created_at).getTime() > 1000

  const save = async () => {
    if (!draft.trim()) return
    await update.mutateAsync({ id: c.id, body: draft })
    setEditing(false)
  }

  return (
    <li className="group flex gap-2.5">
      <Avatar user={author} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-medium text-slate-800">{author ? userName(author) : 'Deleted user'}</span>
          <time className="text-xs text-slate-400" title={format(new Date(c.created_at), 'PPpp')}>
            {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
          </time>
          {edited && (
            <span className="text-xs text-slate-400" title={`Edited ${format(new Date(c.updated_at), 'PPpp')}`}>
              (edited)
            </span>
          )}
          {!editing && !readOnly && (mine || me?.is_admin) && (
            <span className="ml-auto flex gap-0.5 opacity-0 transition group-hover:opacity-100">
              {mine && (
                <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Edit" onClick={() => setEditing(true)}>
                  <Pencil size={13} />
                </button>
              )}
              <button
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Delete"
                onClick={() => confirm('Delete this comment?') && remove.mutate(c.id)}
              >
                <Trash2 size={13} />
              </button>
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1.5">
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              onSubmit={save}
              mentions
              autoFocus
              footer={
                <>
                  {update.error && <span className="mr-auto text-xs text-red-600">{update.error.message}</span>}
                  <Button
                    onClick={() => {
                      setDraft(c.body)
                      setEditing(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={save} disabled={!draft.trim() || update.isPending}>
                    Save
                  </Button>
                </>
              }
            />
          </div>
        ) : (
          <div className="mt-1 rounded-lg rounded-tl-none border border-slate-200 bg-slate-50/60 px-3 py-2">
            <Markdown>{c.body}</Markdown>
          </div>
        )}
      </div>
    </li>
  )
}

// --- editor -------------------------------------------------------------------

type Edit = { text: string; selStart: number; selEnd: number }

/** Wraps the selection (or a placeholder) in before/after markers. */
function wrap(v: string, s: number, e: number, before: string, after: string, placeholder: string): Edit {
  const selected = v.slice(s, e) || placeholder
  const text = v.slice(0, s) + before + selected + after + v.slice(e)
  return { text, selStart: s + before.length, selEnd: s + before.length + selected.length }
}

/** Prefixes every selected line (e.g. "- ", "1. ", "> "). */
function prefixLines(v: string, s: number, e: number, prefix: (i: number) => string): Edit {
  const lineStart = v.lastIndexOf('\n', s - 1) + 1
  const lines = v.slice(lineStart, e).split('\n')
  const block = lines.map((l, i) => prefix(i) + l).join('\n')
  const text = v.slice(0, lineStart) + block + v.slice(e)
  return { text, selStart: lineStart + block.length, selEnd: lineStart + block.length }
}

const TOOLS: { icon: typeof Bold; title: string; key?: string; apply: (v: string, s: number, e: number) => Edit }[] = [
  { icon: Bold, title: 'Bold (Ctrl+B)', key: 'b', apply: (v, s, e) => wrap(v, s, e, '**', '**', 'bold text') },
  { icon: Italic, title: 'Italic (Ctrl+I)', key: 'i', apply: (v, s, e) => wrap(v, s, e, '_', '_', 'italic text') },
  {
    icon: Code,
    title: 'Code (Ctrl+E)',
    key: 'e',
    apply: (v, s, e) => (v.slice(s, e).includes('\n') ? wrap(v, s, e, '```\n', '\n```', 'code') : wrap(v, s, e, '`', '`', 'code')),
  },
  { icon: Link2, title: 'Link (Ctrl+K)', key: 'k', apply: (v, s, e) => wrap(v, s, e, '[', '](https://)', 'link text') },
  { icon: Quote, title: 'Quote', apply: (v, s, e) => prefixLines(v, s, e, () => '> ') },
  { icon: List, title: 'Bulleted list', apply: (v, s, e) => prefixLines(v, s, e, () => '- ') },
  { icon: ListOrdered, title: 'Numbered list', apply: (v, s, e) => prefixLines(v, s, e, (i) => `${i + 1}. `) },
  { icon: ListChecks, title: 'Checklist', apply: (v, s, e) => prefixLines(v, s, e, () => '- [ ] ') },
]

/** Below the text box when there's room, else above the whole editor. */
function mentionPlace(text: HTMLTextAreaElement, editor: HTMLDivElement | null): React.CSSProperties {
  const r = text.getBoundingClientRect()
  if (window.innerHeight - r.bottom > 240) return { left: r.left + 8, top: r.bottom + 4 }
  return { left: r.left + 8, bottom: window.innerHeight - (editor ?? text).getBoundingClientRect().top + 4 }
}

/** The "@name" being typed just before the caret, if any. */
function mentionAt(value: string, caret: number): { start: number; query: string } | null {
  const m = /(^|[^\w@./-])@([\w.-]*)$/.exec(value.slice(0, caret))
  return m ? { start: caret - m[2].length - 1, query: m[2].toLowerCase() } : null
}

export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  footer,
  autoFocus,
  mentions,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder?: string
  footer?: React.ReactNode
  autoFocus?: boolean
  /** Suggest people while typing @name (comments; they get notified). */
  mentions?: boolean
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const ref = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const { data: users = [] } = useUsers()
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [pick, setPick] = useState(0)
  // Where the caret goes once an inserted mention is rendered (set before
  // the next keystroke, so fast typing lands after the mention).
  const caretAfter = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caretAfter.current !== null && ref.current) {
      ref.current.focus()
      ref.current.setSelectionRange(caretAfter.current, caretAfter.current)
      caretAfter.current = null
    }
  }, [value])
  const suggestions = useMemo(() => {
    if (!mentions || !mention) return []
    const q = mention.query
    return users
      .filter((u) => u.active && !u.deleted_at)
      .filter((u) => !q || u.username.toLowerCase().startsWith(q) || u.display_name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
      .slice(0, 6)
  }, [mentions, mention, users])
  const track = (el: HTMLTextAreaElement) => {
    if (!mentions) return
    const m = mentionAt(el.value, el.selectionStart)
    setMention(m)
    if (m?.query !== mention?.query) setPick(0)
  }
  const insertMention = (username: string) => {
    const el = ref.current
    if (!el || !mention) return
    const end = el.selectionStart
    const text = value.slice(0, mention.start) + '@' + username + ' ' + value.slice(end)
    caretAfter.current = mention.start + username.length + 2
    onChange(text)
    setMention(null)
  }

  const apply = (tool: (typeof TOOLS)[number]) => {
    const el = ref.current
    if (!el) return
    const r = tool.apply(value, el.selectionStart, el.selectionEnd)
    onChange(r.text)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(r.selStart, r.selEnd)
    })
  }

  return (
    <div ref={box} className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-1.5 py-1">
        {(['write', 'preview'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx('rounded px-2.5 py-1 text-xs font-medium capitalize', tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            {t}
          </button>
        ))}
        {tab === 'write' && (
          <div className="ml-auto flex items-center">
            {TOOLS.map((t) => (
              <button key={t.title} type="button" title={t.title} onClick={() => apply(t)} className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800">
                <t.icon size={14} />
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'write' ? (
        <div className="relative">
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          rows={Math.min(14, Math.max(3, value.split('\n').length + 1))}
          className="block w-full resize-y px-3 py-2 text-sm focus:outline-none"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            track(e.target)
          }}
          onClick={(e) => track(e.currentTarget)}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                insertMention(suggestions[pick].username)
                return
              }
              if (e.key === 'Escape') {
                // Close the suggestions only, not the dialog.
                e.preventDefault()
                e.stopPropagation()
                setMention(null)
                return
              }
            }
            const mod = e.ctrlKey || e.metaKey
            if (mod && e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation() // don't also save the task dialog
              onSubmit()
              return
            }
            const tool = mod && !e.shiftKey && !e.altKey ? TOOLS.find((t) => t.key === e.key.toLowerCase()) : undefined
            if (tool) {
              e.preventDefault()
              apply(tool)
            }
          }}
          onKeyUp={(e) => (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') && track(e.currentTarget)}
        />
        {suggestions.length > 0 && ref.current && createPortal(
          // Floats below the text box (the editor clips its contents), above dialogs.
          <ul
            className="fixed z-[75] w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={mentionPlace(ref.current, box.current)}
            role="listbox"
            aria-label="Mention someone"
          >
            <li className="px-3 pt-0.5 pb-1 text-[11px] text-slate-400">Mention someone · they’ll be notified</li>
            {suggestions.map((u, i) => (
              <li key={u.id} role="option" aria-selected={i === pick}>
                <button
                  type="button"
                  className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === pick ? 'bg-blue-50' : 'hover:bg-slate-50')}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertMention(u.username)
                  }}
                  onMouseEnter={() => setPick(i)}
                >
                  <Avatar user={u} />
                  <span className="min-w-0 flex-1 truncate">{u.display_name || u.username}</span>
                  <span className="truncate text-xs text-slate-400">@{u.username}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
        </div>
      ) : (
        <div className="min-h-[76px] px-3 py-2">{value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-slate-400">Nothing to preview</p>}</div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-2 py-1.5">
        <span className="mr-auto pl-1 text-[11px] text-slate-400">
          Markdown supported{mentions && ' · @name to mention'} · <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">Enter</kbd> to post
        </span>
        {footer}
      </div>
    </div>
  )
}
