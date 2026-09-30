// Records README showcase videos from the isolated demo instance.
// Usage: node record.mjs <workspaceId> [scenario...]  (see README.md in this folder)
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:8095'
const W = process.argv[2]
const only = process.argv.slice(3)
const OUT = 'videos'
fs.mkdirSync(OUT, { recursive: true })

const SIZE = { width: 1440, height: 810 }

// A visible cursor, since headless recordings don't show the pointer.
const cursorScript = () => {
  const install = () => {
    if (document.getElementById('__cursor')) return
    const c = document.createElement('div')
    c.id = '__cursor'
    Object.assign(c.style, {
      position: 'fixed', left: '-40px', top: '-40px', width: '20px', height: '20px', borderRadius: '50%',
      background: 'rgba(37,99,235,.25)', border: '2px solid rgba(37,99,235,.9)', zIndex: '2147483647',
      pointerEvents: 'none', transform: 'translate(-50%,-50%)', transition: 'width .12s, height .12s, background .12s',
      boxShadow: '0 0 0 3px rgba(255,255,255,.7)',
    })
    document.documentElement.appendChild(c)
    const move = (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }
    addEventListener('mousemove', move, true)
    addEventListener('dragover', move, true)
    addEventListener('drag', (e) => e.clientX && move(e), true)
    addEventListener('mousedown', () => { c.style.width = '14px'; c.style.height = '14px'; c.style.background = 'rgba(37,99,235,.55)' }, true)
    addEventListener('mouseup', () => { c.style.width = '20px'; c.style.height = '20px'; c.style.background = 'rgba(37,99,235,.25)' }, true)
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install)
  else install()
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })

async function record(name, fn) {
  if (only.length && !only.includes(name)) return
  const ctx = await browser.newContext({ viewport: SIZE, locale: 'en-US', timezoneId: 'Asia/Jakarta', acceptDownloads: true })
  await ctx.addInitScript(cursorScript)
  const page = await ctx.newPage()
  // Capture frames with the DevTools screencast (no extra ffmpeg download);
  // each frame keeps its timestamp so holds play back at real speed.
  const frames = []
  const cdp = await ctx.newCDPSession(page)
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 })
  const h = helpers(page)
  try {
    await fn(page, h)
  } catch (e) {
    console.error(`[${name}] failed:`, e.message.split(String.fromCharCode(10))[0])
    await page.screenshot({ path: `${OUT}/${name}-error.png` })
  }
  await page.waitForTimeout(400)
  await cdp.send('Page.stopScreencast').catch(() => {})
  await ctx.close()

  const dir = `${OUT}/${name}`
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const lines = []
  frames.forEach((f, i) => {
    const file = `f${String(i).padStart(5, '0')}.jpg`
    fs.writeFileSync(`${dir}/${file}`, Buffer.from(f.data, 'base64'))
    const next = frames[i + 1]?.t ?? f.t + 1.2
    lines.push(`file '${file}'`, `duration ${Math.max(0.02, next - f.t).toFixed(3)}`)
  })
  lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`)
  fs.writeFileSync(`${dir}/frames.txt`, lines.join(String.fromCharCode(10)))
  console.log('recorded', name, frames.length, 'frames')
}

function helpers(page) {
  const wait = (ms) => page.waitForTimeout(ms)
  const center = async (loc) => {
    await loc.scrollIntoViewIfNeeded()
    const b = await loc.boundingBox()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const moveTo = async (loc, steps = 18) => {
    const p = await center(loc)
    await page.mouse.move(p.x, p.y, { steps })
    return p
  }
  const click = async (loc, pause = 350) => {
    await moveTo(loc)
    await wait(120)
    await page.mouse.down()
    await page.mouse.up()
    await wait(pause)
  }
  const drag = async (from, to, pause = 600) => {
    const a = await moveTo(from)
    await wait(150)
    await page.mouse.down()
    await page.mouse.move(a.x + 8, a.y + 8, { steps: 4 })
    const b = await center(to)
    await page.mouse.move(b.x, b.y, { steps: 30 })
    await wait(250)
    await page.mouse.up()
    await wait(pause)
  }
  const type = async (text, delay = 45) => page.keyboard.type(text, { delay })
  const go = async (path) => {
    await page.goto(BASE + path)
    await page.waitForLoadState('networkidle')
    await wait(700)
  }
  return { wait, moveTo, click, drag, type, go }
}

// 1. Board: drag between status columns, filter by environment.
await record('board', async (page, { go, wait, drag, click }) => {
  await go(`/w/${W}/board`)
  await wait(900)
  const card = page.locator('[data-card]', { hasText: 'Renew SSL certificates' })
  const inProgress = page.locator('div.rounded-lg.bg-slate-100', { hasText: 'In Progress' }).first()
  await drag(card, inProgress.locator('.space-y-2').first())
  await wait(900)
  const envSel = page.locator('select', { has: page.locator('option', { hasText: 'All environments' }) })
  await click(envSel, 200)
  await envSel.selectOption({ label: 'Production' })
  await wait(1800)
  await envSel.selectOption({ label: 'All environments' })
  await wait(600)
  const typeFilter = page.getByRole('button', { name: 'Hourly', exact: true })
  await click(typeFilter, 1600)
  await click(page.getByRole('button', { name: 'All types', exact: true }), 1200)
})

// 2. Projects by category; progress derived from tasks; stacked task dialogs.
await record('projects', async (page, { go, wait, click }) => {
  await go(`/w/${W}/board?type=project`)
  await wait(1800)
  await click(page.locator('[data-card]', { hasText: 'Core Banking Upgrade v5' }), 1500)
  const dlg = page.locator('.fixed .rounded-xl:not(.hidden)')
  await dlg.getByText('Tasks in this project').scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 250)
  await wait(1200)
  const uat = dlg.locator('section', { has: page.getByText('UAT', { exact: true }) }).last()
  await click(uat.getByRole('button', { name: /done/ }), 1200)
  await click(dlg.getByRole('button', { name: 'Create production VMs' }).first(), 1800)
  await page.mouse.wheel(0, 200)
  await wait(1500)
  await click(page.locator('.fixed .rounded-xl:not(.hidden) button[title="Back (Esc)"]'), 1500)
  await page.keyboard.press('Escape')
  await wait(700)
})

// 3. Timeline: zoom from weeks to hours, dependency arrows.
await record('timeline', async (page, { go, wait, click }) => {
  await go(`/w/${W}/timeline`)
  await click(page.getByRole('button', { name: 'Week', exact: true }), 1400)
  await click(page.getByRole('button', { name: 'Day', exact: true }), 1600)
  await click(page.getByRole('button', { name: 'Now' }), 1000)
  await click(page.getByRole('button', { name: '6 Hours', exact: true }), 1600)
  await click(page.getByRole('button', { name: 'Hour', exact: true }), 1200)
  await click(page.getByRole('button', { name: 'Now' }), 1800)
  await click(page.getByRole('button', { name: 'Day', exact: true }), 1500)
})

// 4. Calendar: week/month views, select a slot to create an hourly task.
await record('calendar', async (page, { go, wait, click }) => {
  await go(`/w/${W}/calendar`)
  await wait(1500)
  await click(page.getByRole('button', { name: 'Month', exact: true }), 1800)
  await click(page.getByRole('button', { name: 'Week', exact: true }), 1200)
  // An empty afternoon (Thu Oct 1, 13:00) so the drag selects instead of moving an event.
  const slot = page.locator('.fc-timegrid-slot-lane').nth(26)
  const b = await slot.boundingBox()
  const col = page.locator('.fc-timegrid-col[data-date="2026-10-01"]')
  const cb = await col.boundingBox()
  const x = cb.x + cb.width / 2
  await page.mouse.move(x, b.y + 4, { steps: 18 })
  await page.mouse.down()
  await page.mouse.move(x, b.y + 4 + 5 * b.height, { steps: 20 })
  await page.mouse.up()
  await wait(1200)
  await page.keyboard.type('Middleware patch deployment', { delay: 40 })
  await wait(1500)
  await page.keyboard.press('Escape')
  await wait(600)
})

// 5. Creating a task: type, parent search, environment, schedule, owners.
await record('create-task', async (page, { go, wait, click, type }) => {
  await go(`/w/${W}/board`)
  await click(page.getByRole('button', { name: 'Create', exact: true }), 900)
  await type('Rotate database credentials')
  await wait(300)
  const dlg = page.locator('.fixed .rounded-xl:not(.hidden)')
  await click(dlg.getByRole('button', { name: 'Hourly', exact: true }), 600)
  await click(dlg.locator('label', { hasText: 'Part of project' }).locator('button').first(), 700)
  await type('core')
  await wait(900)
  await page.keyboard.press('Enter')
  await wait(900)
  await click(dlg.getByRole('button', { name: 'Production', exact: true }), 700)
  await click(dlg.locator('button', { hasText: /^Start$/ }), 900)
  await click(page.locator('button', { hasText: /^Tomorrow$/ }), 500)
  await click(page.locator('button', { hasText: /^21:00/ }).first(), 900)
  await click(dlg.locator('button', { hasText: /^2h$/ }), 900)
  await click(dlg.locator('button', { hasText: /^Unassigned$/ }), 600)
  const people = page.locator('[role=dialog]').filter({ has: page.locator('input[placeholder="Search people…"]') })
  await click(people.getByRole('option', { name: /Arif Rahman/ }), 400)
  await click(people.getByRole('option', { name: /Budi Santoso/ }), 600)
  await page.keyboard.press('Escape')
  await wait(700)
  await click(dlg.getByRole('button', { name: 'Create', exact: true }), 2200)
  await page.keyboard.press('Escape')
  await wait(500)
})

// 6. Markdown comments.
await record('comments', async (page, { go, wait, click, type }) => {
  await go(`/w/${W}/board`)
  await click(page.locator('[data-card]', { hasText: 'Production go-live window' }), 1300)
  const dlg = page.locator('.fixed .rounded-xl:not(.hidden)')
  await dlg.getByText('Comments').first().scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 500)
  await wait(1600)
  await click(dlg.locator('textarea[placeholder^="Add a comment"]'), 300)
  await type('Dry run done on Pilot. ')
  await page.keyboard.press('Control+b')
  await type('All smoke tests passed', 30)
  await page.keyboard.press('End')
  await type(' - go-live approved by `@change-board`.', 30)
  await wait(500)
  await click(dlg.getByRole('button', { name: 'preview', exact: true }), 1400)
  await click(dlg.getByRole('button', { name: 'Comment', exact: true }), 1800)
  await page.keyboard.press('Escape')
  await wait(400)
})

// 7. Workload report.
await record('workload', async (page, { go, wait, click }) => {
  await go('/reports')
  await wait(1500)
  await click(page.locator('tbody tr', { hasText: 'Budi Santoso' }), 1800)
  await click(page.getByRole('button', { name: 'Monthly', exact: true }), 1600)
  await click(page.getByRole('button', { name: 'Weekly', exact: true }), 1000)
})

// 8. Backup: export, then import the file as a new workspace.
await record('backup', async (page, { go, wait, click }) => {
  await go(`/w/${W}/board`)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    click(page.locator('button[title^="Export a backup"]'), 800),
  ])
  const file = `${OUT}/${download.suggestedFilename()}`
  await download.saveAs(file)
  await click(page.locator('button[title="Import a workspace backup"]'), 900)
  await page.locator('.fixed input[type=file]').setInputFiles(file)
  await wait(2000)
  await click(page.getByRole('button', { name: /^Use OPS2$/ }), 1500)
  await click(page.getByRole('button', { name: 'Import as new workspace' }), 2200)
})

await browser.close()
