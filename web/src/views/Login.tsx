import { CalendarDays, Clock, GanttChart, LogIn, Users } from 'lucide-react'
import { login } from '../lib/auth'

const FEATURES = [
  { icon: GanttChart, text: 'Timeline down to the hour' },
  { icon: CalendarDays, text: 'Team calendar' },
  { icon: Clock, text: 'Track hourly support time' },
  { icon: Users, text: 'Weekly and monthly workload per member' },
]

export default function Login() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <div className="hidden flex-1 flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" className="h-8 w-8" alt="" />
          <span className="text-xl font-semibold">Open Planner</span>
        </div>
        <div>
          <h1 className="max-w-md text-4xl leading-tight font-semibold">Plan deployments, support and deliverables in one place.</h1>
          <ul className="mt-8 space-y-3 text-slate-300">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-center gap-3">
                <f.icon size={18} className="text-blue-400" /> {f.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">Open Planner</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" className="h-8 w-8" alt="" />
            <span className="text-xl font-semibold">Open Planner</span>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-2 text-sm text-slate-500">Sign in with your organization account to continue.</p>
          <button
            onClick={login}
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <LogIn size={16} /> Sign in
          </button>
          <p className="mt-4 text-center text-xs text-slate-400">
            You'll enter your password on your organization's single sign-on page (Keycloak). Accounts are managed by your planner administrator.
          </p>
        </div>
      </div>
    </div>
  )
}
