import { useRef, useState } from 'react'
import clsx from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import { Bold, Code, Italic, Link2, List, ListChecks, ListOrdered, Loader2, MessageSquare, Pencil, Quote, Trash2 } from 'lucide-react'
import { useCommentMutations, useComments, useMe, useUsers } from '../lib/queries'
import type { Comment } from '../lib/types'
import { Markdown } from './Markdown'
import { Avatar, Button, userName } from './ui'

export function Comments({ taskId }: { taskId: string }) {
  const { data: comments = [], isLoading } = useComments(taskId)
  const { create } = useCommentMutations(taskId)
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

      <div className="mt-4">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          onSubmit={post}
          placeholder="Add a comment… Markdown supported"
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
  const mine = !!me && c.author_id === me.id
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
          {!editing && (mine || me?.is_admin) && (
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

export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  footer,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder?: string
  footer?: React.ReactNode
  autoFocus?: boolean
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const ref = useRef<HTMLTextAreaElement>(null)

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
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
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
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          rows={Math.min(14, Math.max(3, value.split('\n').length + 1))}
          className="block w-full resize-y px-3 py-2 text-sm focus:outline-none"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
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
        />
      ) : (
        <div className="min-h-[76px] px-3 py-2">{value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-slate-400">Nothing to preview</p>}</div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-2 py-1.5">
        <span className="mr-auto pl-1 text-[11px] text-slate-400">
          Markdown supported · <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">Enter</kbd> to post
        </span>
        {footer}
      </div>
    </div>
  )
}
