import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { X, type LucideIcon } from 'lucide-react'

/** A click-to-open popover anchored to its trigger, flipped/shifted to stay on screen. */
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  matchWidth = false,
}: {
  trigger: (props: Record<string, unknown>, open: boolean) => ReactNode
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Make the popover at least as wide as the trigger. */
  matchWidth?: boolean
}) {
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply: ({ availableHeight, rects, elements }) => {
          elements.floating.style.maxHeight = `${Math.max(availableHeight, 260)}px`
          if (matchWidth) elements.floating.style.minWidth = `${Math.max(rects.reference.width, 320)}px`
        },
      }),
    ],
  })
  // Escape is handled below so it closes only the popover, not the task dialog.
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context, { escapeKey: false }), useRole(context, { role: 'dialog' })])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      onOpenChange(false)
    }
  }

  return (
    <>
      {trigger({ ref: refs.setReference, ...getReferenceProps({ onKeyDown }) }, open)}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps({ onKeyDown })}
              className="z-[70] overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5"
            >
              {children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}

export function TriggerButton({
  icon: Icon,
  children,
  placeholder,
  open,
  onClear,
  className,
  ...props
}: {
  icon: LucideIcon
  children?: ReactNode
  placeholder: string
  open: boolean
  onClear?: () => void
  className?: string
} & Record<string, unknown>) {
  return (
    <div className={clsx('group relative', className)}>
      <button
        type="button"
        {...props}
        className={clsx(
          'flex w-full items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-left text-sm shadow-sm transition',
          open ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-300 hover:border-slate-400',
        )}
      >
        <Icon size={15} className="shrink-0 text-slate-400" />
        {children ?? <span className="text-slate-400">{placeholder}</span>}
      </button>
      {onClear && children && (
        <button
          type="button"
          title="Clear"
          onClick={onClear}
          className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded p-0.5 text-slate-400 group-hover:block hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
