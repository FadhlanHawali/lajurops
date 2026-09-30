// Static screenshots for the README: hero (timeline) and sign-in page.
import { chromium } from 'playwright'

const W = process.argv[2]
const b = await chromium.launch({ channel: 'msedge', headless: true })
const opts = { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'Asia/Jakarta' }

// Hero: timeline at day zoom, centred on "now", with dependency arrows.
{
  const p = await b.newPage(opts)
  await p.goto(`http://localhost:8095/w/${W}/timeline`)
  await p.waitForLoadState('networkidle')
  await p.getByRole('button', { name: 'Day', exact: true }).click()
  await p.waitForTimeout(400)
  await p.getByRole('button', { name: 'Now' }).click()
  await p.waitForTimeout(800)
  await p.screenshot({ path: 'shots/hero-timeline.png' })
  await p.close()
}

// Sign-in page from the real (Keycloak-enabled) instance, signed out.
{
  const p = await b.newPage(opts)
  await p.goto('http://localhost:8080/')
  await p.getByRole('button', { name: /Sign in/ }).waitFor({ timeout: 20000 })
  await p.waitForTimeout(500)
  await p.screenshot({ path: 'shots/sign-in.png' })
  await p.close()
}
await b.close()
