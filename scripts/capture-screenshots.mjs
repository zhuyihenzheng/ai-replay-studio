#!/usr/bin/env node
// Captures dashboard screenshots from a running dev server.
//
// IMPORTANT: This script forces the dashboard to use the bundled demo
// dataset (VITE_FORCE_DEMO=1) and starts its own dev server. It will
// never capture your real synced transcripts, even if
// `src/data/claudeSessions.local.json` exists.
//
// Setup (Playwright is intentionally not in devDependencies — it's a
// 200 MB download with chromium and most contributors won't need it):
//
//     npm install --no-save playwright
//     npx playwright install chromium
//
// Then: `npm run screenshots` (or `node scripts/capture-screenshots.mjs`)

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error(
    'Playwright is not installed. Run:\n' +
      '  npm install --no-save playwright\n' +
      '  npx playwright install chromium\n' +
      'then re-run `npm run screenshots`.',
  )
  process.exit(1)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'docs', 'screenshots')
const PORT = process.env.SCREENSHOT_PORT ?? '5181'
const BASE = `http://127.0.0.1:${PORT}`

const shots = [
  { name: 'dashboard', path: '/', wait: 'h1' },
  { name: 'session-replay', path: '/sessions/sess-006', wait: 'h1, h2' },
  { name: 'cost-analysis', path: '/sessions/sess-006/cost', wait: 'svg' },
  { name: 'tool-graph', path: '/sessions/sess-006/graph', wait: '.react-flow__node, h1' },
  { name: 'file-changes', path: '/sessions/sess-001/files', wait: 'pre, h1' },
  { name: 'artifacts', path: '/sessions/sess-001/artifacts', wait: 'h1' },
  { name: 'client-report', path: '/sessions/sess-006/report', wait: 'h1' },
]

mkdirSync(OUT_DIR, { recursive: true })

console.log(`Starting Vite on :${PORT} with VITE_FORCE_DEMO=1 ...`)
const vite = spawn(
  'npx',
  ['vite', '--host', '127.0.0.1', '--port', PORT, '--strictPort'],
  {
    cwd: join(__dirname, '..'),
    env: { ...process.env, VITE_FORCE_DEMO: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
vite.stderr.on('data', (chunk) => process.stderr.write(chunk))

let viteReady = false
vite.stdout.on('data', (chunk) => {
  if (!viteReady && chunk.toString().includes('ready in')) viteReady = true
})

let browser
let exitCode = 0
try {
  const start = Date.now()
  while (!viteReady && Date.now() - start < 15_000) await sleep(200)
  if (!viteReady) throw new Error('Vite did not become ready in 15s.')

  browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()

  let failures = 0
  for (const shot of shots) {
    const url = `${BASE}${shot.path}`
    process.stdout.write(`Capturing ${shot.name} ← ${url} ... `)
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 })
      // Selector wait must succeed — a missed selector would otherwise
      // produce a blank screenshot that silently overwrites a good one.
      await page.waitForSelector(shot.wait, { timeout: 8_000 })
      await page.waitForTimeout(600)
      await page.screenshot({
        path: join(OUT_DIR, `${shot.name}.png`),
        fullPage: false,
      })
      console.log('ok')
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failures += 1
    }
  }

  console.log(
    `\nWrote ${shots.length - failures}/${shots.length} screenshots to ${OUT_DIR}`,
  )
  if (failures > 0) exitCode = 1
} catch (err) {
  console.error(`\nFatal: ${err.message}`)
  exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  vite.kill()
  process.exit(exitCode)
}
