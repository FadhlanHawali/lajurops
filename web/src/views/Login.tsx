import { CalendarDays, GanttChart, Layers, LogIn, Users } from 'lucide-react'
import { login } from '../lib/auth'

const FEATURES = [
  { icon: GanttChart, text: 'One timeline, from months down to the hour' },
  { icon: Layers, text: 'Projects, requests and deployments across every environment' },
  { icon: CalendarDays, text: 'Team calendar for releases and support windows' },
  { icon: Users, text: 'Weekly and monthly workload per person' },
]

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      Lajur<span className="text-sky-400">Ops</span>
    </span>
  )
}

export default function Login() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <div className="hidden flex-1 flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" className="h-8 w-8" alt="" />
          <Wordmark className="text-xl font-semibold tracking-tight" />
        </div>
        <div>
          <h1 className="max-w-md text-4xl leading-tight font-semibold">Plan every lane, down to the hour.</h1>
          <p className="mt-4 max-w-md text-slate-300">
            Open-source planning for ops teams: projects, requests and deployments on one timeline, across every environment.
          </p>
          <ul className="mt-8 space-y-3 text-slate-300">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-center gap-3">
                <f.icon size={18} className="text-sky-400" /> {f.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">LajurOps · open source</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" className="h-8 w-8" alt="" />
            <Wordmark className="text-xl font-semibold tracking-tight text-slate-900" />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-2 text-sm text-slate-500">Sign in with your organization account to continue.</p>
          <button
            onClick={login}
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <LogIn size={16} /> Sign in with Keycloak
          </button>
          <p className="mt-4 text-center text-xs text-slate-400">
            You'll enter your password on your organization's single sign-on page (Keycloak). Accounts are managed by your LajurOps administrator.
          </p>
        </div>
      </div>
    </div>
  )
}
