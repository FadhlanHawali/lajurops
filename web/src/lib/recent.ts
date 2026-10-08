// Recently opened tasks (ids, newest first), shown by the search palette
// before you type. Kept in this browser only; storage can be unavailable
// (private windows, blocked site data), which just means no recents.

const KEY = 'lajurops.recentTasks'
const MAX = 8

export function recentTaskIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

export function rememberTask(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...recentTaskIds().filter((x) => x !== id)].slice(0, MAX)))
  } catch {
    // no storage: nothing to remember
  }
}
