import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { format } from 'date-fns'
import { AlertTriangle, FileJson, Link2, Loader2, Upload, X } from 'lucide-react'
import { fetchBackupFromUrl, importWorkspace, queryClient } from '../lib/queries'
import type { ImportResult, WorkspaceBackup } from '../lib/types'
import { Button, Field, inputCls } from './ui'

const MAX_FILE_BYTES = 25 * 1024 * 1024

/** Restore a workspace backup (from a file or a URL) as a new workspace. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<'file' | 'url'>('file')
  const [doc, setDoc] = useState<WorkspaceBackup | null>(null)
  const [origin, setOrigin] = useState('')
  const [error, setError] = useState('')

  const accept = (d: unknown, from: string) => {
    const b = d as WorkspaceBackup
    if (!b || b.format !== 'open-planner-workspace') {
      setError("That isn't an Open Planner workspace backup.")
      return
    }
    setError('')
    setDoc(b)
    setOrigin(from)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">Import workspace</h2>
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        {!doc ? (
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-300 text-sm">
              {(
                [
                  ['file', 'From a file', Upload],
                  ['url', 'From a URL', Link2],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSource(id)
                    setError('')
                  }}
                  className={clsx('flex items-center justify-center gap-1.5 px-3 py-1.5', source === id ? 'bg-slate-800 text-white' : 'bg-white hover:bg-slate-50')}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            {source === 'file' ? <FilePicker onLoaded={accept} onError={setError} /> : <UrlPicker onLoaded={accept} onError={setError} />}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs text-slate-500">
              A backup is restored as a <b>new</b> workspace; nothing existing is changed. People are matched by username.
            </p>
          </div>
        ) : (
          <Preview doc={doc} origin={origin} onBack={() => setDoc(null)} onDone={onClose} />
        )}
      </div>
    </div>
  )
}

function FilePicker({ onLoaded, onError }: { onLoaded: (d: unknown, from: string) => void; onError: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const read = async (file?: File) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return onError('The file is larger than 25 MB.')
    try {
      onLoaded(JSON.parse(await file.text()), file.name)
    } catch {
      onError(`${file.name} is not valid JSON.`)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        read(e.dataTransfer.files[0])
      }}
      onClick={() => input.current?.click()}
      className={clsx(
        'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition',
        over ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50',
      )}
    >
      <FileJson size={28} className="text-slate-400" />
      <span className="font-medium text-slate-700">Drop a backup .json here, or click to choose</span>
      <span className="text-xs text-slate-500">Created with Export on a workspace page</span>
      <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={(e) => read(e.target.files?.[0])} />
    </div>
  )
}

function UrlPicker({ onLoaded, onError }: { onLoaded: (d: unknown, from: string) => void; onError: (m: string) => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true)
    onError('')
    try {
      onLoaded(await fetchBackupFromUrl(url.trim()), url.trim())
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={load} className="space-y-2">
      <Field label="Backup URL">
        <div className="flex gap-2">
          <input autoFocus className={inputCls} placeholder="https://files.example.com/backups/MI-2026-09-30.json" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy || !url.trim()}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            Fetch
          </Button>
        </div>
      </Field>
      <p className="text-xs text-slate-500">The planner server downloads the file. Private and internal addresses are blocked unless your admin allows them.</p>
    </form>
  )
}

function Preview({ doc, origin, onBack, onDone }: { doc: WorkspaceBackup; origin: string; onBack: () => void; onDone: () => void }) {
  const [key, setKey] = useState(doc.workspace.key)
  const [name, setName] = useState(doc.workspace.name)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const navigate = useNavigate()

  // Dry-run whenever the key/name change, to validate and count.
  useEffect(() => {
    let cancelled = false
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const r = await importWorkspace(doc, { key, name, dryRun: true })
        if (!cancelled) {
          setPreview(r)
          setError('')
        }
      } catch (e) {
        if (!cancelled) {
          setPreview(null)
          setError((e as Error).message)
        }
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [doc, key, name])

  const run = async () => {
    setImporting(true)
    try {
      const r = await importWorkspace(doc, { key, name, dryRun: false })
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      onDone()
      if (r.workspace) navigate(`/w/${r.workspace.id}/board`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const canImport = !!preview && !preview.key_taken && !checking && !importing

  return (
    <div className="space-y-4 p-5 text-sm">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <FileJson size={16} className="shrink-0 text-slate-500" />
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={origin}>
            {origin}
          </span>
          <button className="text-xs font-medium text-blue-600 hover:underline" onClick={onBack}>
            Choose another
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Backup of <b>{doc.workspace.name}</b> ({doc.workspace.key}) · exported {format(new Date(doc.exported_at), 'MMM d, yyyy HH:mm')}
          {doc.exported_by && ` by ${doc.exported_by}`}
        </p>
      </div>

      <div className="grid grid-cols-[120px_1fr] gap-3">
        <Field label="Key">
          <input className={clsx(inputCls, preview?.key_taken && 'border-red-400')} value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      {preview?.key_taken && (
        <p className="-mt-2 text-xs text-red-600">
          Key {preview.key} is already used by another workspace.{' '}
          <button className="font-semibold underline" onClick={() => setKey(`${key.slice(0, 9)}2`)}>
            Use {key.slice(0, 9)}2
          </button>
        </p>
      )}

      {checking && !preview && (
        <p className="flex items-center gap-2 text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Checking the backup…
        </p>
      )}
      {preview && (
        <div className={clsx('grid grid-cols-5 gap-2 text-center transition', checking && 'opacity-60')}>
          {(
            [
              ['Tasks', preview.tasks],
              ['Environments', preview.environments],
              ['Dependencies', preview.dependencies],
              ['Comments', preview.comments],
              ['Assignments', preview.assignments],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-md border border-slate-200 px-1 py-2">
              <div className="text-lg font-semibold text-slate-800">{n}</div>
              <div className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</div>
            </div>
          ))}
        </div>
      )}
      {preview && preview.unknown_users.length > 0 && (
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            Not in this planner: <b>{preview.unknown_users.join(', ')}</b>. Their assignments will be dropped and their comments will show as by a deleted user.
          </span>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={run} disabled={!canImport}>
          {importing && <Loader2 size={14} className="animate-spin" />}
          Import as new workspace
        </Button>
      </div>
    </div>
  )
}
