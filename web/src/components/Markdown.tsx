import { useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import clsx from 'clsx'
import { Check, Copy } from 'lucide-react'

/**
 * Renders user-written Markdown (GitHub flavoured). Raw HTML in the source is
 * not rendered, so comments cannot inject markup or scripts.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={clsx(
        'prose prose-sm prose-slate max-w-none break-words',
        'prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-blockquote:my-2',
        'prose-a:text-blue-600 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:bg-slate-900 prose-pre:text-slate-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 prose-table:my-2 prose-th:px-2 prose-td:px-2',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          pre: ({ node: _node, children, ...props }) => <CodeBlock {...props}>{children}</CodeBlock>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

/** A code block with a Copy button (handy for commands in runbooks). */
function CodeBlock({ children, ...props }: { children?: ReactNode } & React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      // No trailing newline: pasted into a terminal, it would run the command at once.
      await navigator.clipboard.writeText((ref.current?.innerText ?? '').replace(/\n+$/, ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable (e.g. not https): nothing to do
    }
  }
  return (
    <div className="group/code relative">
      <pre ref={ref} {...props}>
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded bg-slate-700/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-100 opacity-0 transition group-hover/code:opacity-100 hover:bg-slate-600 focus:opacity-100"
        title="Copy to clipboard"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
