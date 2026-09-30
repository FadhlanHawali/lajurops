import { X } from 'lucide-react'
import { useCategories, useSetCategories } from '../lib/queries'
import { EnvironmentListEditor, type ListEditorText } from './Environments'
import { Button } from './ui'

const CATEGORY_TEXT: ListEditorText = {
  noun: 'category',
  usedBy: 'project(s)',
  empty: 'No categories yet. Projects will all be "Uncategorized".',
  presets: [
    { name: 'KPI Project', color: 'violet' },
    { name: 'Enhancement Project', color: 'blue' },
    { name: 'Ad Hoc Project', color: 'amber' },
    { name: 'Maintenance Project', color: 'teal' },
    { name: 'Research Project', color: 'pink' },
  ],
  starter: { label: 'Use KPI / Enhancement / Ad Hoc', names: ['KPI Project', 'Enhancement Project', 'Ad Hoc Project'] },
}

/** Edit a workspace's project categories; changes save immediately. */
export function ProjectCategoriesDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { data = [], isLoading } = useCategories(workspaceId)
  const save = useSetCategories(workspaceId)
  const items = data.map((c) => ({ id: c.id, name: c.name, color: c.color, task_count: c.project_count }))
  const colorFor = (name: string) => CATEGORY_TEXT.presets.find((p) => p.name.toLowerCase() === name.toLowerCase())?.color
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="font-semibold">Project categories</h2>
            <p className="text-xs text-slate-500">Columns of the Projects board. Rename, recolour (click the dot), reorder or add your own.</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="h-10 animate-pulse rounded bg-slate-100" />
          ) : (
            <EnvironmentListEditor
              items={items}
              onChange={(list) => save.mutate(list.map((c) => (c.id ? c : { ...c, color: colorFor(c.name) ?? c.color })))}
              busy={save.isPending}
              text={CATEGORY_TEXT}
            />
          )}
          {save.error && <p className="mt-2 text-xs text-red-600">{save.error.message}</p>}
        </div>
      </div>
    </div>
  )
}
