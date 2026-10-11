import { useLocation, useNavigate } from 'react-router-dom'
import { FolderX, MapPinOff, Search } from 'lucide-react'
import { useSearchPalette } from './SearchPalette'
import { Button } from './ui'

/**
 * Shown instead of silently redirecting: an address that isn't a page, or a
 * workspace link that doesn't work for you. (The server answers "not found"
 * both when a workspace doesn't exist and when you can't see it, so nobody can
 * probe for other teams' workspaces; this page can't tell the two apart either.)
 */
export function NotFound({ kind = 'page' }: { kind?: 'page' | 'workspace' }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { openSearch } = useSearchPalette()
  const Icon = kind === 'workspace' ? FolderX : MapPinOff
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon size={22} />
        </span>
        <h1 className="mt-3 text-lg font-semibold text-slate-800">{kind === 'workspace' ? 'Workspace not available' : 'Page not found'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {kind === 'workspace'
            ? 'This workspace doesn’t exist, or you don’t have access to it. If someone shared the link with you, ask an administrator to give you access.'
            : 'There’s nothing at this address. The link may be mistyped or out of date.'}
        </p>
        <p className="mt-2 truncate font-mono text-xs text-slate-400" title={pathname}>
          {pathname}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={openSearch}>
            <Search size={14} /> Search
          </Button>
          <Button variant="primary" onClick={() => navigate('/', { replace: true })}>
            Go to your board
          </Button>
        </div>
      </div>
    </div>
  )
}
