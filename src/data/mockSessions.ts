import type {
  Artifact,
  BillingBreakdown,
  CostEstimate,
  FileChange,
  Issue,
  Session,
  SessionBilling,
  Stage,
  TokenUsage,
  ToolCall,
} from '@/types'

// Sanitized demo data.
//
// These sessions are entirely fictional. They are NOT extracted from any real
// transcript. They exist so a fresh clone of `npm run dev` shows the dashboard,
// timeline, tool graph, and cost analysis with realistic shape — including the
// API-equivalent vs. billable separation, which is the part that makes this
// project useful.

const minute = 60_000
const second = 1_000
const hour = 60 * minute

// Demo sessions are anchored relative to "now" so a fresh clone always
// shows recent, non-empty data — including under the dashboard's default
// "last 7 days" filter. Order/spacing preserved (s6 newest … s7 oldest).
const now = Date.now()

function buildMiniTimeline(seed: number, length = 24): number[] {
  const arr: number[] = []
  let v = (seed % 100) / 100
  for (let i = 0; i < length; i++) {
    v = (v * 1.7 + i * 0.13 + 0.31) % 1
    arr.push(Math.max(0.05, v))
  }
  return arr
}

// ---- Billing helpers -------------------------------------------------------

interface BillingSpec {
  mode: SessionBilling['mode']
  planName?: string
  limitHit?: boolean
  limitResetText?: string
  extraUsageRatio?: number // 0..1 portion of session value that is extra-usage spend
  evidence?: string[]
}

function buildUsage(tokensIn: number, tokensOut: number): TokenUsage {
  // Approximate split: most input is cached on subsequent rounds.
  const cacheRead = Math.round(tokensIn * 0.55)
  const cacheWrite5m = Math.round(tokensIn * 0.18)
  const fresh = tokensIn - cacheRead - cacheWrite5m
  return {
    inputTokens: Math.max(0, fresh),
    outputTokens: tokensOut,
    cacheReadTokens: cacheRead,
    cacheWrite5mTokens: cacheWrite5m,
    cacheWrite1hTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
  }
}

function buildCostEstimate(apiEquivalentUsd: number): CostEstimate {
  return {
    apiEquivalentUsd,
    inputUsd: apiEquivalentUsd * 0.18,
    outputUsd: apiEquivalentUsd * 0.42,
    cacheReadUsd: apiEquivalentUsd * 0.06,
    cacheWriteUsd: apiEquivalentUsd * 0.34,
    toolUseUsd: 0,
    currency: 'USD',
    pricingSource: 'anthropic-public-pricing',
    pricingVersion: '2026-04-27',
    confidence: 'medium',
  }
}

function buildBilling(
  apiEquivalentUsd: number,
  spec: BillingSpec,
): SessionBilling {
  const base: BillingBreakdown = {
    payer: 'unknown',
    actualBillableUsd: 0,
    includedUsdEquivalent: 0,
    apiBilledUsd: 0,
    extraUsageUsd: 0,
    unknownUsdEquivalent: 0,
    confidence: 'medium',
    evidence: spec.evidence ?? [],
  }
  if (spec.mode === 'subscription') {
    if (spec.limitHit && (spec.extraUsageRatio ?? 0) > 0) {
      const extra = apiEquivalentUsd * (spec.extraUsageRatio ?? 0)
      const included = apiEquivalentUsd - extra
      Object.assign(base, {
        payer: 'mixed' as const,
        actualBillableUsd: extra,
        includedUsdEquivalent: included,
        extraUsageUsd: extra,
        evidence: spec.evidence ?? [
          'Claude Code limit was hit during this session.',
          'Extra usage flag is on; usage after the limit is treated as billable.',
        ],
      })
    } else {
      Object.assign(base, {
        payer: 'subscription' as const,
        includedUsdEquivalent: apiEquivalentUsd,
        evidence: spec.evidence ?? [
          'Claude Code subscription usage is treated as included plan value.',
        ],
      })
    }
  } else if (spec.mode === 'api') {
    Object.assign(base, {
      payer: 'api' as const,
      actualBillableUsd: apiEquivalentUsd,
      apiBilledUsd: apiEquivalentUsd,
      evidence: spec.evidence ?? ['Billing mode is API/pay-as-you-go.'],
    })
  } else if (spec.mode === 'extra-usage') {
    Object.assign(base, {
      payer: 'extra-usage' as const,
      actualBillableUsd: apiEquivalentUsd,
      extraUsageUsd: apiEquivalentUsd,
      evidence: spec.evidence ?? ['All usage classified as subscription extra-usage.'],
    })
  } else {
    Object.assign(base, {
      payer: 'unknown' as const,
      unknownUsdEquivalent: apiEquivalentUsd,
      confidence: 'low' as const,
      evidence: spec.evidence ?? [
        'Local logs expose token usage but do not prove billing source.',
      ],
    })
  }
  return {
    ...base,
    mode: spec.mode,
    planName: spec.planName,
    limitHit: spec.limitHit ?? false,
    limitResetText: spec.limitResetText,
  }
}

function enrich(session: Session, spec: BillingSpec): Session {
  const apiEq = session.costUsd
  return {
    ...session,
    usage: buildUsage(session.tokensIn, session.tokensOut),
    costEstimate: buildCostEstimate(apiEq),
    billing: buildBilling(apiEq, spec),
  }
}

// ---------- Session 1: Claude Code, success, subscription-included ----------
const s1Start = now - 44 * hour

const s1Tools: ToolCall[] = [
  { id: 't1-0', kind: 'input', title: 'User prompt received', status: 'success', startedAt: s1Start, endedAt: s1Start + 2 * second, durationMs: 2 * second, tokensIn: 412, tokensOut: 0, costUsd: 0.001, detail: 'Add CSV export to /api/sessions endpoint with filters' },
  { id: 't1-1', kind: 'analysis', title: 'Plan: locate sessions API', status: 'success', startedAt: s1Start + 3 * second, endedAt: s1Start + 18 * second, durationMs: 15 * second, tokensIn: 1820, tokensOut: 480, costUsd: 0.018 },
  { id: 't1-2', kind: 'command', title: 'rg "/api/sessions" src/', status: 'success', startedAt: s1Start + 19 * second, endedAt: s1Start + 22 * second, durationMs: 3 * second, costUsd: 0.0008, detail: 'matched 3 files' },
  { id: 't1-3', kind: 'file-op', title: 'Read src/routes/sessions.ts', status: 'success', startedAt: s1Start + 23 * second, endedAt: s1Start + 26 * second, durationMs: 3 * second, tokensIn: 2400, costUsd: 0.0061 },
  { id: 't1-4', kind: 'analysis', title: 'Design CSV serializer', status: 'success', startedAt: s1Start + 27 * second, endedAt: s1Start + 70 * second, durationMs: 43 * second, tokensIn: 3100, tokensOut: 1100, costUsd: 0.034 },
  { id: 't1-5', kind: 'file-op', title: 'Edit src/routes/sessions.ts', status: 'success', startedAt: s1Start + 71 * second, endedAt: s1Start + 92 * second, durationMs: 21 * second, tokensIn: 2200, tokensOut: 950, costUsd: 0.022 },
  { id: 't1-6', kind: 'file-op', title: 'Create src/lib/csv.ts', status: 'success', startedAt: s1Start + 93 * second, endedAt: s1Start + 110 * second, durationMs: 17 * second, tokensIn: 800, tokensOut: 720, costUsd: 0.014 },
  { id: 't1-7', kind: 'command', title: 'npm test -- routes/sessions', status: 'success', startedAt: s1Start + 112 * second, endedAt: s1Start + 134 * second, durationMs: 22 * second, costUsd: 0.0011, detail: '12 passed' },
  { id: 't1-8', kind: 'validation', title: 'Type check', status: 'success', startedAt: s1Start + 135 * second, endedAt: s1Start + 144 * second, durationMs: 9 * second, costUsd: 0.0006 },
  { id: 't1-9', kind: 'output', title: 'Summary delivered to user', status: 'success', startedAt: s1Start + 145 * second, endedAt: s1Start + 147 * second, durationMs: 2 * second, tokensOut: 320, costUsd: 0.005 },
]

const s1Stages: Stage[] = [
  { id: 's1-st1', name: 'Understand request', startedAt: s1Start, endedAt: s1Start + 22 * second, durationMs: 22 * second, costUsd: 0.0198, status: 'success', summary: 'Parsed the request and located the sessions API.', toolCallIds: ['t1-0', 't1-1', 't1-2'] },
  { id: 's1-st2', name: 'Design solution', startedAt: s1Start + 23 * second, endedAt: s1Start + 70 * second, durationMs: 47 * second, costUsd: 0.0401, status: 'success', summary: 'Read existing route handler and designed a CSV serializer.', toolCallIds: ['t1-3', 't1-4'] },
  { id: 's1-st3', name: 'Implement', startedAt: s1Start + 71 * second, endedAt: s1Start + 110 * second, durationMs: 39 * second, costUsd: 0.036, status: 'success', summary: 'Edited the route handler and added a small csv helper.', toolCallIds: ['t1-5', 't1-6'] },
  { id: 's1-st4', name: 'Validate', startedAt: s1Start + 112 * second, endedAt: s1Start + 144 * second, durationMs: 32 * second, costUsd: 0.0017, status: 'success', summary: 'Ran tests and type check — both clean.', toolCallIds: ['t1-7', 't1-8'] },
  { id: 's1-st5', name: 'Wrap up', startedAt: s1Start + 145 * second, endedAt: s1Start + 147 * second, durationMs: 2 * second, costUsd: 0.005, status: 'success', summary: 'Summarized the change and listed follow-ups.', toolCallIds: ['t1-9'] },
]

const s1Files: FileChange[] = [
  {
    id: 's1-f1', path: 'src/routes/sessions.ts', language: 'typescript', additions: 24, deletions: 3,
    summary: 'Added CSV branch to the existing JSON handler, gated by `?format=csv`.',
    diff: `@@\n-router.get('/sessions', async (req, res) => {\n-  const data = await listSessions(req.query)\n-  res.json(data)\n-})\n+router.get('/sessions', async (req, res) => {\n+  const data = await listSessions(req.query)\n+  if (req.query.format === 'csv') {\n+    res.setHeader('Content-Type', 'text/csv')\n+    res.setHeader('Content-Disposition', 'attachment; filename=\"sessions.csv\"')\n+    return res.send(toCsv(data))\n+  }\n+  res.json(data)\n+})`,
  },
  {
    id: 's1-f2', path: 'src/lib/csv.ts', language: 'typescript', additions: 38, deletions: 0,
    summary: 'New helper that streams a list of records to CSV with safe quoting.',
    diff: `+export function toCsv(rows: Record<string, unknown>[]): string {\n+  if (rows.length === 0) return ''\n+  const headers = Object.keys(rows[0])\n+  const escape = (v: unknown) => {\n+    const s = v == null ? '' : String(v)\n+    return /[",\\n]/.test(s) ? '\"' + s.replace(/\"/g, '\"\"') + '\"' : s\n+  }\n+  const lines = [headers.join(',')]\n+  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','))\n+  return lines.join('\\n')\n+}`,
  },
  {
    id: 's1-f3', path: 'src/routes/__tests__/sessions.test.ts', language: 'typescript', additions: 28, deletions: 1,
    summary: 'Added a test for the CSV path and a test for the special-character escaping.',
    diff: `+it('returns csv when format=csv', async () => {\n+  const res = await request(app).get('/sessions?format=csv')\n+  expect(res.headers['content-type']).toMatch(/text\\/csv/)\n+  expect(res.text.split('\\n').length).toBeGreaterThan(1)\n+})`,
  },
]

const s1Artifacts: Artifact[] = [
  {
    id: 's1-a1', kind: 'code', language: 'typescript', title: 'CSV helper (src/lib/csv.ts)',
    body: `export function toCsv(rows: Record<string, unknown>[]): string {\n  if (rows.length === 0) return ''\n  const headers = Object.keys(rows[0])\n  const escape = (v: unknown) => {\n    const s = v == null ? '' : String(v)\n    return /[\",\\n]/.test(s) ? '\"' + s.replace(/\"/g, '\"\"') + '\"' : s\n  }\n  const lines = [headers.join(',')]\n  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','))\n  return lines.join('\\n')\n}`,
    tags: ['csv', 'helper'], favorite: true, createdAt: s1Start + 110 * second,
  },
  {
    id: 's1-a2', kind: 'decision', title: 'Why a query flag, not a new route',
    body: 'Chose `?format=csv` instead of `/sessions.csv` to keep the existing route registry small and avoid duplicate query parsing. Trade-off: clients must opt in by passing a flag, but the change is fully backward compatible.',
    tags: ['design'], createdAt: s1Start + 70 * second,
  },
  {
    id: 's1-a3', kind: 'final-answer', title: 'Summary for the user',
    body: 'CSV export is now available at `GET /api/sessions?format=csv`. Filters (`status`, `source`, `from`, `to`) are honored exactly as in the JSON path. Tests and types are clean. Suggested next step: add a "Download CSV" button to the dashboard.',
    tags: ['summary'], createdAt: s1Start + 147 * second,
  },
]

const session1: Session = enrich({
  id: 'sess-001',
  title: 'Add CSV export to /api/sessions',
  source: 'claude-code',
  status: 'success',
  startedAt: s1Start,
  endedAt: s1Start + 147 * second,
  durationMs: 147 * second,
  tokensIn: 12_932,
  tokensOut: 3_570,
  costUsd: 0.103,
  retryCount: 0,
  toolCallCount: s1Tools.length,
  changedFileCount: s1Files.length,
  summary: 'Added CSV export to the sessions endpoint with full test coverage.',
  taskGoal: 'Allow customers to download a session list as CSV from the dashboard.',
  workSummary: 'Located the existing JSON handler, added an opt-in CSV branch behind a query flag, introduced a small CSV helper with safe quoting, and added two tests covering the new path.',
  nextSteps: [
    'Add a "Download CSV" button to the Sessions table.',
    'Consider streaming for exports larger than 10k rows.',
  ],
  issues: [],
  stages: s1Stages,
  toolCalls: s1Tools,
  files: s1Files,
  artifacts: s1Artifacts,
  miniTimeline: buildMiniTimeline(7),
}, { mode: 'subscription', planName: 'Max' })

// ---------- Session 2: Cursor (planned source), partial / retried ----------
const s2Start = now - 38 * hour

const s2Tools: ToolCall[] = [
  { id: 't2-0', kind: 'input', title: 'User prompt received', status: 'success', startedAt: s2Start, endedAt: s2Start + 1 * second, durationMs: 1 * second, tokensIn: 220, costUsd: 0.0006, detail: 'Migrate users table to add email_verified_at' },
  { id: 't2-1', kind: 'analysis', title: 'Inspect existing migrations', status: 'success', startedAt: s2Start + 2 * second, endedAt: s2Start + 25 * second, durationMs: 23 * second, tokensIn: 4100, tokensOut: 600, costUsd: 0.041 },
  { id: 't2-2', kind: 'file-op', title: 'Create db/migrations/0042_email_verified.sql', status: 'success', startedAt: s2Start + 26 * second, endedAt: s2Start + 38 * second, durationMs: 12 * second, tokensIn: 800, tokensOut: 280, costUsd: 0.011 },
  { id: 't2-3', kind: 'command', title: 'npm run migrate:up', status: 'failed', startedAt: s2Start + 40 * second, endedAt: s2Start + 51 * second, durationMs: 11 * second, costUsd: 0.0009, detail: 'ERROR: column "email_verified_at" cannot be NOT NULL on existing rows' },
  { id: 't2-4', kind: 'analysis', title: 'Diagnose failure → use NULL default', status: 'success', startedAt: s2Start + 52 * second, endedAt: s2Start + 78 * second, durationMs: 26 * second, tokensIn: 1900, tokensOut: 540, costUsd: 0.022, retries: 1 },
  { id: 't2-5', kind: 'file-op', title: 'Edit migration: drop NOT NULL', status: 'success', startedAt: s2Start + 79 * second, endedAt: s2Start + 88 * second, durationMs: 9 * second, tokensIn: 700, tokensOut: 200, costUsd: 0.009, retries: 1 },
  { id: 't2-6', kind: 'command', title: 'npm run migrate:up (retry)', status: 'success', startedAt: s2Start + 89 * second, endedAt: s2Start + 96 * second, durationMs: 7 * second, costUsd: 0.0007 },
  { id: 't2-7', kind: 'validation', title: 'Verify column on staging', status: 'success', startedAt: s2Start + 98 * second, endedAt: s2Start + 110 * second, durationMs: 12 * second, costUsd: 0.0011 },
  { id: 't2-8', kind: 'output', title: 'Summary + warning about backfill', status: 'success', startedAt: s2Start + 112 * second, endedAt: s2Start + 114 * second, durationMs: 2 * second, tokensOut: 410, costUsd: 0.006 },
]

const s2Stages: Stage[] = [
  { id: 's2-st1', name: 'Plan migration', startedAt: s2Start, endedAt: s2Start + 25 * second, durationMs: 25 * second, costUsd: 0.0416, status: 'success', summary: 'Read prior migrations to match conventions.', toolCallIds: ['t2-0', 't2-1'] },
  { id: 's2-st2', name: 'First attempt', startedAt: s2Start + 26 * second, endedAt: s2Start + 51 * second, durationMs: 25 * second, costUsd: 0.0119, status: 'failed', summary: 'Migration failed because the column was NOT NULL on a populated table.', toolCallIds: ['t2-2', 't2-3'] },
  { id: 's2-st3', name: 'Recover', startedAt: s2Start + 52 * second, endedAt: s2Start + 96 * second, durationMs: 44 * second, costUsd: 0.0317, status: 'success', summary: 'Switched to NULL default and backfill plan, then re-ran the migration.', toolCallIds: ['t2-4', 't2-5', 't2-6'] },
  { id: 's2-st4', name: 'Verify + report', startedAt: s2Start + 98 * second, endedAt: s2Start + 114 * second, durationMs: 16 * second, costUsd: 0.0078, status: 'success', summary: 'Confirmed column exists on staging and warned the user about the backfill.', toolCallIds: ['t2-7', 't2-8'] },
]

const s2Files: FileChange[] = [
  {
    id: 's2-f1', path: 'db/migrations/0042_email_verified.sql', language: 'sql', additions: 6, deletions: 0,
    summary: 'New migration. Adds nullable `email_verified_at` to the users table.',
    diff: `+ALTER TABLE users\n+  ADD COLUMN email_verified_at TIMESTAMPTZ NULL;\n+\n+CREATE INDEX users_email_verified_at_idx\n+  ON users (email_verified_at);`,
  },
]

const s2Artifacts: Artifact[] = [
  {
    id: 's2-a1', kind: 'sql', language: 'sql', title: 'Final migration SQL',
    body: `ALTER TABLE users\n  ADD COLUMN email_verified_at TIMESTAMPTZ NULL;\n\nCREATE INDEX users_email_verified_at_idx\n  ON users (email_verified_at);`,
    tags: ['migration', 'users'], favorite: true, createdAt: s2Start + 88 * second,
  },
  {
    id: 's2-a2', kind: 'decision', title: 'Why nullable instead of NOT NULL DEFAULT now()',
    body: 'A NOT NULL column on a 4M-row table would have rewritten the whole table and held an exclusive lock. Made it NULL-able and left the backfill to a follow-up script that can run in batches.',
    tags: ['design', 'safety'], createdAt: s2Start + 78 * second,
  },
  {
    id: 's2-a3', kind: 'final-answer', title: 'Summary for the user',
    body: 'Migration applied successfully on staging after one retry. The column is nullable on purpose — production will need a follow-up backfill, which I have NOT run.',
    tags: ['summary'], createdAt: s2Start + 114 * second,
  },
]

const s2Issues: Issue[] = [
  { id: 's2-i1', severity: 'warning', title: 'Backfill not run', description: 'Existing rows have a NULL `email_verified_at`. A batched backfill script is needed before any product code starts gating on this field.', resolved: false },
  { id: 's2-i2', severity: 'info', title: 'One retry consumed', description: 'First migration attempt failed (NOT NULL violation). Retried after switching to a nullable column.', resolved: true },
]

const session2: Session = enrich({
  id: 'sess-002',
  title: 'Add email_verified_at column to users',
  source: 'cursor',
  status: 'partial',
  startedAt: s2Start,
  endedAt: s2Start + 114 * second,
  durationMs: 114 * second,
  tokensIn: 9_840,
  tokensOut: 2_030,
  costUsd: 0.093,
  retryCount: 1,
  toolCallCount: s2Tools.length,
  changedFileCount: s2Files.length,
  summary: 'Added the column on staging after one failed attempt; backfill is still pending.',
  taskGoal: 'Add an `email_verified_at` column so the auth flow can mark verified emails.',
  workSummary: 'Wrote a new migration, hit a NOT NULL violation on the populated table, switched to a nullable column with a planned backfill, and re-ran the migration successfully on staging.',
  nextSteps: [
    'Run a batched backfill before turning on the new auth gate in production.',
    'Add a reminder issue to drop the index if usage stays low after 30 days.',
  ],
  issues: s2Issues,
  stages: s2Stages,
  toolCalls: s2Tools,
  files: s2Files,
  artifacts: s2Artifacts,
  miniTimeline: buildMiniTimeline(31),
}, { mode: 'api', planName: 'Cursor', evidence: ['Cursor importer is planned; demo session priced as API usage.'] })

// ---------- Session 3: Codex, failed, billing unknown -----------------------
const s3Start = now - 26 * hour

const s3Tools: ToolCall[] = [
  { id: 't3-0', kind: 'input', title: 'User prompt received', status: 'success', startedAt: s3Start, endedAt: s3Start + 1 * second, durationMs: 1 * second, tokensIn: 320, costUsd: 0.0008, detail: 'Refactor billing module to use new Stripe SDK' },
  { id: 't3-1', kind: 'analysis', title: 'Survey billing module', status: 'success', startedAt: s3Start + 2 * second, endedAt: s3Start + 60 * second, durationMs: 58 * second, tokensIn: 9200, tokensOut: 1100, costUsd: 0.094 },
  { id: 't3-2', kind: 'file-op', title: 'Refactor src/billing/charge.ts', status: 'success', startedAt: s3Start + 62 * second, endedAt: s3Start + 100 * second, durationMs: 38 * second, tokensIn: 3300, tokensOut: 1700, costUsd: 0.041 },
  { id: 't3-3', kind: 'file-op', title: 'Refactor src/billing/refund.ts', status: 'success', startedAt: s3Start + 101 * second, endedAt: s3Start + 130 * second, durationMs: 29 * second, tokensIn: 2500, tokensOut: 1200, costUsd: 0.033 },
  { id: 't3-4', kind: 'command', title: 'npm run typecheck', status: 'failed', startedAt: s3Start + 132 * second, endedAt: s3Start + 150 * second, durationMs: 18 * second, costUsd: 0.0014, detail: '14 type errors — Stripe type signatures changed' },
  { id: 't3-5', kind: 'analysis', title: 'Plan type fix-up', status: 'failed', startedAt: s3Start + 151 * second, endedAt: s3Start + 200 * second, durationMs: 49 * second, tokensIn: 2900, tokensOut: 800, costUsd: 0.029, retries: 2 },
  { id: 't3-6', kind: 'file-op', title: 'Patch types (attempt 1)', status: 'retried', startedAt: s3Start + 201 * second, endedAt: s3Start + 240 * second, durationMs: 39 * second, tokensIn: 2100, tokensOut: 900, costUsd: 0.026, retries: 1 },
  { id: 't3-7', kind: 'command', title: 'npm run typecheck (retry 1)', status: 'failed', startedAt: s3Start + 241 * second, endedAt: s3Start + 258 * second, durationMs: 17 * second, costUsd: 0.0013, detail: 'still 9 errors' },
  { id: 't3-8', kind: 'file-op', title: 'Patch types (attempt 2)', status: 'retried', startedAt: s3Start + 259 * second, endedAt: s3Start + 300 * second, durationMs: 41 * second, tokensIn: 2400, tokensOut: 950, costUsd: 0.029, retries: 2 },
  { id: 't3-9', kind: 'command', title: 'npm run typecheck (retry 2)', status: 'failed', startedAt: s3Start + 301 * second, endedAt: s3Start + 318 * second, durationMs: 17 * second, costUsd: 0.0014, detail: '5 errors remain in webhook handler' },
  { id: 't3-10', kind: 'error', title: 'Aborted: type errors persist', status: 'failed', startedAt: s3Start + 319 * second, endedAt: s3Start + 322 * second, durationMs: 3 * second, costUsd: 0.0008 },
  { id: 't3-11', kind: 'output', title: 'Summary with handoff plan', status: 'success', startedAt: s3Start + 323 * second, endedAt: s3Start + 326 * second, durationMs: 3 * second, tokensOut: 540, costUsd: 0.008 },
]

const s3Stages: Stage[] = [
  { id: 's3-st1', name: 'Survey + refactor', startedAt: s3Start, endedAt: s3Start + 130 * second, durationMs: 130 * second, costUsd: 0.169, status: 'success', summary: 'Refactored charge and refund modules to the new Stripe API.', toolCallIds: ['t3-0', 't3-1', 't3-2', 't3-3'] },
  { id: 's3-st2', name: 'Type check loop', startedAt: s3Start + 132 * second, endedAt: s3Start + 318 * second, durationMs: 186 * second, costUsd: 0.0867, status: 'failed', summary: 'Two retries of type fix-ups still left 5 errors in the webhook handler.', toolCallIds: ['t3-4', 't3-5', 't3-6', 't3-7', 't3-8', 't3-9'] },
  { id: 's3-st3', name: 'Abort + handoff', startedAt: s3Start + 319 * second, endedAt: s3Start + 326 * second, durationMs: 7 * second, costUsd: 0.0088, status: 'failed', summary: 'Stopped and produced a handoff note for a human reviewer.', toolCallIds: ['t3-10', 't3-11'] },
]

const s3Files: FileChange[] = [
  { id: 's3-f1', path: 'src/billing/charge.ts', language: 'typescript', additions: 84, deletions: 51, summary: 'Refactored to use the v18 Stripe SDK. Idempotency keys are now passed as request options rather than top-level fields.' },
  { id: 's3-f2', path: 'src/billing/refund.ts', language: 'typescript', additions: 41, deletions: 28, summary: 'Refactored to use the new refunds endpoint. Removed deprecated reason enum.' },
  { id: 's3-f3', path: 'src/billing/webhook.ts', language: 'typescript', additions: 12, deletions: 6, summary: 'Partial type updates. Five errors remain — see issues.' },
]

const s3Artifacts: Artifact[] = [
  {
    id: 's3-a1', kind: 'markdown', title: 'Handoff note',
    body: '## Handoff: Stripe SDK upgrade (incomplete)\n\nCharge and refund modules are migrated and pass type check.\n\nThe webhook handler still has 5 type errors:\n\n1. `Stripe.Event.Data.Object` is no longer a discriminated union; we destructure `customer` directly.\n2. `Stripe.Subscription.Status` removed `incomplete_expired` from the public type.\n3. `Stripe.Invoice` no longer exposes `subscription` directly — use `lines.data[0].subscription`.\n\nRecommend a 1-2 hour follow-up by someone familiar with the webhook contract.',
    tags: ['handoff', 'stripe'], favorite: true, createdAt: s3Start + 326 * second,
  },
  {
    id: 's3-a2', kind: 'final-answer', title: 'Summary for the user',
    body: 'Charge and refund modules are upgraded and clean. The webhook handler still has 5 type errors related to Stripe v18 type changes — I aborted after two retries to avoid making things worse. Recommend a human reviewer.',
    tags: ['summary'], createdAt: s3Start + 326 * second,
  },
]

const s3Issues: Issue[] = [
  { id: 's3-i1', severity: 'error', title: '5 type errors remain in webhook handler', description: 'Stripe v18 changed several public type signatures used in src/billing/webhook.ts. Two automated patch attempts did not fully resolve them.', resolved: false },
  { id: 's3-i2', severity: 'warning', title: 'Refund reason enum removed', description: 'Any callers passing the old reason enum will need updating in product code (not in scope for this session).', resolved: false },
]

const session3: Session = enrich({
  id: 'sess-003',
  title: 'Refactor billing module to Stripe SDK v18',
  source: 'codex',
  status: 'failed',
  startedAt: s3Start,
  endedAt: s3Start + 326 * second,
  durationMs: 326 * second,
  tokensIn: 22_720,
  tokensOut: 7_190,
  costUsd: 0.265,
  retryCount: 2,
  toolCallCount: s3Tools.length,
  changedFileCount: s3Files.length,
  summary: 'Charge and refund modules done; webhook handler aborted with 5 type errors after two retries.',
  taskGoal: 'Upgrade the billing module from Stripe SDK v15 to v18 across the entire codebase.',
  workSummary: 'Refactored the two main billing entry points to the new SDK. Hit type signature changes in the webhook handler that two automated retries did not resolve, so the agent stopped to avoid making things worse and produced a handoff note.',
  nextSteps: [
    'Have a human reviewer finish the webhook handler types (~1-2h).',
    "Run a smoke test against Stripe's test endpoint before deploying.",
  ],
  issues: s3Issues,
  stages: s3Stages,
  toolCalls: s3Tools,
  files: s3Files,
  artifacts: s3Artifacts,
  miniTimeline: buildMiniTimeline(53),
}, {
  mode: 'unknown',
  planName: 'Codex Plus',
  evidence: ['Codex local logs expose token usage but do not prove dollar billing.'],
})

// ---------- Session 4: Claude Code, success (fast) --------------------------
const s4Start = now - 80 * hour

const s4Tools: ToolCall[] = [
  { id: 't4-0', kind: 'input', title: 'User prompt received', status: 'success', startedAt: s4Start, endedAt: s4Start + 1 * second, durationMs: 1 * second, tokensIn: 180, costUsd: 0.0005, detail: 'Fix typo "recieve" -> "receive" project-wide' },
  { id: 't4-1', kind: 'command', title: 'rg -n "recieve" .', status: 'success', startedAt: s4Start + 2 * second, endedAt: s4Start + 4 * second, durationMs: 2 * second, costUsd: 0.0006, detail: '7 matches in 5 files' },
  { id: 't4-2', kind: 'file-op', title: 'Apply replace_all in 5 files', status: 'success', startedAt: s4Start + 5 * second, endedAt: s4Start + 18 * second, durationMs: 13 * second, tokensIn: 1100, tokensOut: 320, costUsd: 0.011 },
  { id: 't4-3', kind: 'validation', title: 'rg -n "recieve" .', status: 'success', startedAt: s4Start + 19 * second, endedAt: s4Start + 21 * second, durationMs: 2 * second, costUsd: 0.0006, detail: '0 matches' },
  { id: 't4-4', kind: 'output', title: 'Summary delivered', status: 'success', startedAt: s4Start + 22 * second, endedAt: s4Start + 23 * second, durationMs: 1 * second, tokensOut: 90, costUsd: 0.001 },
]

const s4Stages: Stage[] = [
  { id: 's4-st1', name: 'Find', startedAt: s4Start, endedAt: s4Start + 4 * second, durationMs: 4 * second, costUsd: 0.0011, status: 'success', summary: 'Searched for the misspelling.', toolCallIds: ['t4-0', 't4-1'] },
  { id: 's4-st2', name: 'Fix', startedAt: s4Start + 5 * second, endedAt: s4Start + 18 * second, durationMs: 13 * second, costUsd: 0.011, status: 'success', summary: 'Replaced 7 occurrences.', toolCallIds: ['t4-2'] },
  { id: 's4-st3', name: 'Verify', startedAt: s4Start + 19 * second, endedAt: s4Start + 23 * second, durationMs: 4 * second, costUsd: 0.0016, status: 'success', summary: 'Confirmed zero remaining matches.', toolCallIds: ['t4-3', 't4-4'] },
]

const s4Files: FileChange[] = [
  { id: 's4-f1', path: 'src/components/EmailForm.tsx', language: 'typescript', additions: 1, deletions: 1, summary: 'Typo in label.' },
  { id: 's4-f2', path: 'src/server/notify.ts', language: 'typescript', additions: 2, deletions: 2, summary: 'Two typos in inline docs.' },
  { id: 's4-f3', path: 'README.md', language: 'markdown', additions: 1, deletions: 1, summary: 'Typo in setup section.' },
  { id: 's4-f4', path: 'docs/onboarding.md', language: 'markdown', additions: 2, deletions: 2, summary: 'Two typos in step list.' },
  { id: 's4-f5', path: 'CHANGELOG.md', language: 'markdown', additions: 1, deletions: 1, summary: 'Typo in 0.4.0 entry.' },
]

const s4Artifacts: Artifact[] = [
  {
    id: 's4-a1', kind: 'final-answer', title: 'Summary for the user',
    body: 'Fixed 7 occurrences of "recieve" → "receive" across 5 files. Re-ran the search to confirm 0 remaining.',
    tags: ['summary'], createdAt: s4Start + 23 * second,
  },
]

const session4: Session = enrich({
  id: 'sess-004',
  title: 'Fix "recieve" → "receive" project-wide',
  source: 'claude-code',
  status: 'success',
  startedAt: s4Start,
  endedAt: s4Start + 23 * second,
  durationMs: 23 * second,
  tokensIn: 1_280,
  tokensOut: 410,
  costUsd: 0.0143,
  retryCount: 0,
  toolCallCount: s4Tools.length,
  changedFileCount: s4Files.length,
  summary: 'Trivial typo fix across 5 files, verified clean.',
  taskGoal: 'Replace every "recieve" with "receive".',
  workSummary: 'Searched the repo, applied a project-wide replacement, and verified zero remaining occurrences.',
  nextSteps: ['None — change is self-contained.'],
  issues: [],
  stages: s4Stages,
  toolCalls: s4Tools,
  files: s4Files,
  artifacts: s4Artifacts,
  miniTimeline: buildMiniTimeline(11),
}, { mode: 'subscription', planName: 'Pro' })

// ---------- Session 5: Cursor (planned), currently running ------------------
const s5Start = now - 18 * hour

const s5Tools: ToolCall[] = [
  { id: 't5-0', kind: 'input', title: 'User prompt received', status: 'success', startedAt: s5Start, endedAt: s5Start + 1 * second, durationMs: 1 * second, tokensIn: 410, costUsd: 0.001, detail: 'Generate React components from Figma design' },
  { id: 't5-1', kind: 'analysis', title: 'Parse design tokens', status: 'success', startedAt: s5Start + 2 * second, endedAt: s5Start + 30 * second, durationMs: 28 * second, tokensIn: 5400, tokensOut: 800, costUsd: 0.054 },
  { id: 't5-2', kind: 'file-op', title: 'Write tailwind.config.ts', status: 'success', startedAt: s5Start + 31 * second, endedAt: s5Start + 45 * second, durationMs: 14 * second, tokensIn: 600, tokensOut: 380, costUsd: 0.009 },
  { id: 't5-3', kind: 'file-op', title: 'Write src/components/Button.tsx', status: 'success', startedAt: s5Start + 46 * second, endedAt: s5Start + 70 * second, durationMs: 24 * second, tokensIn: 800, tokensOut: 540, costUsd: 0.013 },
  { id: 't5-4', kind: 'file-op', title: 'Write src/components/Card.tsx', status: 'success', startedAt: s5Start + 71 * second, endedAt: s5Start + 95 * second, durationMs: 24 * second, tokensIn: 750, tokensOut: 510, costUsd: 0.012 },
  { id: 't5-5', kind: 'file-op', title: 'Write src/components/Input.tsx', status: 'success', startedAt: s5Start + 96 * second, endedAt: s5Start + 120 * second, durationMs: 24 * second, tokensIn: 700, tokensOut: 470, costUsd: 0.012 },
]

const s5Stages: Stage[] = [
  { id: 's5-st1', name: 'Parse design', startedAt: s5Start, endedAt: s5Start + 30 * second, durationMs: 30 * second, costUsd: 0.055, status: 'success', summary: 'Parsed tokens from the Figma file.', toolCallIds: ['t5-0', 't5-1'] },
  { id: 's5-st2', name: 'Generate components', startedAt: s5Start + 31 * second, endedAt: s5Start + 120 * second, durationMs: 89 * second, costUsd: 0.046, status: 'success', summary: 'Wrote the first 3 of 12 components.', toolCallIds: ['t5-2', 't5-3', 't5-4', 't5-5'] },
]

const s5Files: FileChange[] = [
  { id: 's5-f1', path: 'tailwind.config.ts', language: 'typescript', additions: 56, deletions: 0, summary: 'Design tokens (color, spacing, font) imported from Figma.' },
  { id: 's5-f2', path: 'src/components/Button.tsx', language: 'typescript', additions: 64, deletions: 0, summary: 'Primary, secondary, ghost variants with size scale.' },
  { id: 's5-f3', path: 'src/components/Card.tsx', language: 'typescript', additions: 38, deletions: 0, summary: 'Surface card with header/body/footer slots.' },
  { id: 's5-f4', path: 'src/components/Input.tsx', language: 'typescript', additions: 52, deletions: 0, summary: 'Text input with prefix/suffix and error state.' },
]

const s5Artifacts: Artifact[] = [
  {
    id: 's5-a1', kind: 'code', language: 'typescript', title: 'Button component (preview)',
    body: `export function Button({ variant = 'primary', size = 'md', children, ...rest }: ButtonProps) {\n  return (\n    <button className={cx(buttonBase, buttonVariants[variant], buttonSizes[size])} {...rest}>\n      {children}\n    </button>\n  )\n}`,
    tags: ['component'], createdAt: s5Start + 70 * second,
  },
]

const session5: Session = enrich({
  id: 'sess-005',
  title: 'Generate React components from Figma',
  source: 'cursor',
  status: 'running',
  startedAt: s5Start,
  endedAt: s5Start + 120 * second,
  durationMs: 120 * second,
  tokensIn: 8_660,
  tokensOut: 2_700,
  costUsd: 0.101,
  retryCount: 0,
  toolCallCount: s5Tools.length,
  changedFileCount: s5Files.length,
  summary: 'In progress — 3 of 12 components written so far.',
  taskGoal: 'Generate React + Tailwind components for the new design system.',
  workSummary: 'Parsed Figma tokens into a Tailwind config and started generating components in dependency order.',
  nextSteps: ['Continue generating remaining 9 components.'],
  issues: [],
  stages: s5Stages,
  toolCalls: s5Tools,
  files: s5Files,
  artifacts: s5Artifacts,
  miniTimeline: buildMiniTimeline(83),
}, { mode: 'api', planName: 'Cursor' })

// ---------- Session 6: Claude Code, hit subscription limit, mixed billing ---
const s6Start = now - 5 * hour
const s6LimitAt = s6Start + 380 * second

const s6Tools: ToolCall[] = [
  { id: 't6-0', kind: 'input', title: 'User prompt received', status: 'success', startedAt: s6Start, endedAt: s6Start + 1 * second, durationMs: 1 * second, tokensIn: 720, costUsd: 0.002, detail: 'Production /login is failing for 3% of users since the SSO refactor — find the cause' },
  { id: 't6-1', kind: 'analysis', title: 'Read recent /login logs', status: 'success', startedAt: s6Start + 2 * second, endedAt: s6Start + 60 * second, durationMs: 58 * second, tokensIn: 18_400, tokensOut: 1100, costUsd: 0.119 },
  { id: 't6-2', kind: 'analysis', title: 'Diff the SSO refactor PR', status: 'success', startedAt: s6Start + 62 * second, endedAt: s6Start + 130 * second, durationMs: 68 * second, tokensIn: 12_200, tokensOut: 900, costUsd: 0.082 },
  { id: 't6-3', kind: 'file-op', title: 'Read src/auth/sso.ts', status: 'success', startedAt: s6Start + 132 * second, endedAt: s6Start + 150 * second, durationMs: 18 * second, tokensIn: 4400, costUsd: 0.018 },
  { id: 't6-4', kind: 'analysis', title: 'Hypothesize: timezone-sensitive nonce', status: 'success', startedAt: s6Start + 152 * second, endedAt: s6Start + 240 * second, durationMs: 88 * second, tokensIn: 6800, tokensOut: 1600, costUsd: 0.071 },
  { id: 't6-5', kind: 'command', title: 'grep nonce src/auth', status: 'success', startedAt: s6Start + 242 * second, endedAt: s6Start + 248 * second, durationMs: 6 * second, costUsd: 0.0009 },
  { id: 't6-6', kind: 'file-op', title: 'Read src/auth/nonce.ts', status: 'success', startedAt: s6Start + 250 * second, endedAt: s6Start + 268 * second, durationMs: 18 * second, tokensIn: 3100, costUsd: 0.013 },
  { id: 't6-7', kind: 'analysis', title: 'Confirm: 3% of users are in non-UTC zones around DST boundary', status: 'success', startedAt: s6Start + 270 * second, endedAt: s6Start + 360 * second, durationMs: 90 * second, tokensIn: 9200, tokensOut: 2100, costUsd: 0.094 },
  { id: 't6-8', kind: 'output', title: 'Root cause identified', status: 'success', startedAt: s6Start + 362 * second, endedAt: s6Start + 378 * second, durationMs: 16 * second, tokensOut: 720, costUsd: 0.011 },
  { id: 't6-9', kind: 'error', title: 'Hit Claude Code limit', status: 'failed', startedAt: s6LimitAt, endedAt: s6LimitAt + 2 * second, durationMs: 2 * second, costUsd: 0, detail: "You've hit your usage limit. Resets 9pm." },
  { id: 't6-10', kind: 'file-op', title: 'Edit src/auth/nonce.ts (fix)', status: 'success', startedAt: s6LimitAt + 4 * second, endedAt: s6LimitAt + 28 * second, durationMs: 24 * second, tokensIn: 2200, tokensOut: 800, costUsd: 0.022 },
  { id: 't6-11', kind: 'command', title: 'npm test -- auth/nonce', status: 'success', startedAt: s6LimitAt + 30 * second, endedAt: s6LimitAt + 50 * second, durationMs: 20 * second, costUsd: 0.0011, detail: '8 passed, 1 added' },
  { id: 't6-12', kind: 'file-op', title: 'Add regression test', status: 'success', startedAt: s6LimitAt + 52 * second, endedAt: s6LimitAt + 80 * second, durationMs: 28 * second, tokensIn: 1800, tokensOut: 600, costUsd: 0.018 },
  { id: 't6-13', kind: 'output', title: 'Summary + risk assessment', status: 'success', startedAt: s6LimitAt + 82 * second, endedAt: s6LimitAt + 90 * second, durationMs: 8 * second, tokensOut: 540, costUsd: 0.008 },
]

const s6Stages: Stage[] = [
  { id: 's6-st1', name: 'Investigation', startedAt: s6Start, endedAt: s6Start + 360 * second, durationMs: 360 * second, costUsd: 0.398, status: 'success', summary: 'Read logs, diffed the SSO PR, traced the nonce flow.', toolCallIds: ['t6-0', 't6-1', 't6-2', 't6-3', 't6-4', 't6-5', 't6-6', 't6-7'] },
  { id: 's6-st2', name: 'Root cause', startedAt: s6Start + 362 * second, endedAt: s6Start + 378 * second, durationMs: 16 * second, costUsd: 0.011, status: 'success', summary: 'Identified DST boundary mishandling in nonce generation.', toolCallIds: ['t6-8'] },
  { id: 's6-st3', name: 'Limit + fix', startedAt: s6LimitAt, endedAt: s6LimitAt + 90 * second, durationMs: 90 * second, costUsd: 0.05, status: 'partial', summary: 'Hit subscription limit mid-session. Continued via extra usage and shipped a fix with a regression test.', toolCallIds: ['t6-9', 't6-10', 't6-11', 't6-12', 't6-13'] },
]

const s6Files: FileChange[] = [
  {
    id: 's6-f1', path: 'src/auth/nonce.ts', language: 'typescript', additions: 11, deletions: 4,
    summary: 'Nonce expiry now uses UTC consistently rather than the server local clock.',
    diff: `@@ generateNonce\n-  const expiresAt = new Date()\n-  expiresAt.setMinutes(expiresAt.getMinutes() + 5)\n+  const now = Date.now()\n+  const expiresAt = new Date(now + 5 * 60 * 1000)\n@@ verifyNonce\n-  if (expiresAt < new Date()) throw new InvalidNonceError()\n+  if (expiresAt.getTime() < Date.now()) throw new InvalidNonceError()`,
  },
  {
    id: 's6-f2', path: 'src/auth/__tests__/nonce.test.ts', language: 'typescript', additions: 18, deletions: 0,
    summary: 'Regression test simulating a DST forward jump while the nonce is in flight.',
  },
]

const s6Artifacts: Artifact[] = [
  {
    id: 's6-a1', kind: 'decision', title: 'Why this only affected 3% of users',
    body: 'The bug only fired for users whose login attempt straddled a daylight-saving forward jump in their server-local zone. That window is small in normal weeks, but production runs in a non-UTC region and 3% of yesterday\'s logins fell in the affected window.',
    tags: ['root-cause'], createdAt: s6Start + 360 * second,
  },
  {
    id: 's6-a2', kind: 'final-answer', title: 'Summary for the user',
    body: 'Root cause: nonce expiry was computed against server local time, which jumped backwards during DST and made fresh nonces look already-expired. Fixed by computing expiry purely in epoch ms. Regression test added. The fix is small and safe to ship.',
    tags: ['summary'], favorite: true, createdAt: s6LimitAt + 90 * second,
  },
]

const s6Issues: Issue[] = [
  { id: 's6-i1', severity: 'warning', title: 'Claude usage limit hit', description: "You've hit your usage limit. Resets 9pm.", resolved: false },
]

const session6: Session = enrich({
  id: 'sess-006',
  title: 'Debug 3% /login regression after SSO refactor',
  source: 'claude-code',
  status: 'partial',
  startedAt: s6Start,
  endedAt: s6LimitAt + 90 * second,
  durationMs: s6LimitAt + 90 * second - s6Start,
  tokensIn: 58_820,
  tokensOut: 8_460,
  costUsd: 0.4593,
  retryCount: 0,
  toolCallCount: s6Tools.length,
  changedFileCount: s6Files.length,
  summary: 'Found and fixed a DST-related nonce bug. Hit the subscription limit mid-session; the post-limit work is billable as extra usage.',
  taskGoal: 'Find and fix the cause of a 3% /login failure rate that started after the SSO refactor.',
  workSummary: 'Read logs, diffed the recent SSO PR, traced the nonce flow, and identified that nonce expiry was computed against server-local time and broke around a DST boundary. Hit the Claude Code limit while preparing the fix and continued via extra usage to ship a safe patch with a regression test.',
  nextSteps: [
    'Roll out the fix in canary first; the change touches authentication.',
    'Audit other auth paths for similar local-time arithmetic.',
  ],
  issues: s6Issues,
  stages: s6Stages,
  toolCalls: s6Tools,
  files: s6Files,
  artifacts: s6Artifacts,
  miniTimeline: buildMiniTimeline(67),
}, {
  mode: 'subscription',
  planName: 'Max',
  limitHit: true,
  limitResetText: "You've hit your usage limit. Resets 9pm.",
  extraUsageRatio: 0.11,
  evidence: [
    'Claude Code subscription usage is treated as included plan value.',
    'Claude Code limit was hit and extra usage is enabled.',
  ],
})

// ---------- Session 7: Codex, integration test run, billing unknown ---------
const s7Start = now - 120 * hour

const s7Tools: ToolCall[] = [
  { id: 't7-0', kind: 'input', title: 'User prompt received', status: 'success', startedAt: s7Start, endedAt: s7Start + 1 * second, durationMs: 1 * second, tokensIn: 240, costUsd: 0.0006, detail: 'Run the integration suite against staging and triage failures' },
  { id: 't7-1', kind: 'command', title: 'kubectl get pods -n staging', status: 'success', startedAt: s7Start + 2 * second, endedAt: s7Start + 5 * second, durationMs: 3 * second, costUsd: 0.0006, detail: 'all 12 pods Ready' },
  { id: 't7-2', kind: 'command', title: 'pytest -q tests/integration', status: 'failed', startedAt: s7Start + 8 * second, endedAt: s7Start + 188 * second, durationMs: 180 * second, costUsd: 0.0024, detail: '46 passed, 3 failed (test_billing_webhook, test_email_dispatch, test_search_pagination)' },
  { id: 't7-3', kind: 'analysis', title: 'Triage failures', status: 'success', startedAt: s7Start + 190 * second, endedAt: s7Start + 280 * second, durationMs: 90 * second, tokensIn: 8200, tokensOut: 1600, costUsd: 0.071 },
  { id: 't7-4', kind: 'command', title: 'kubectl logs deploy/api -n staging --tail=200', status: 'success', startedAt: s7Start + 282 * second, endedAt: s7Start + 290 * second, durationMs: 8 * second, costUsd: 0.0011 },
  { id: 't7-5', kind: 'analysis', title: 'Classify each failure', status: 'success', startedAt: s7Start + 292 * second, endedAt: s7Start + 360 * second, durationMs: 68 * second, tokensIn: 5400, tokensOut: 1200, costUsd: 0.052 },
  { id: 't7-6', kind: 'output', title: 'Triage report', status: 'success', startedAt: s7Start + 362 * second, endedAt: s7Start + 376 * second, durationMs: 14 * second, tokensOut: 920, costUsd: 0.013 },
]

const s7Stages: Stage[] = [
  { id: 's7-st1', name: 'Run suite', startedAt: s7Start, endedAt: s7Start + 188 * second, durationMs: 188 * second, costUsd: 0.0036, status: 'partial', summary: 'Three integration tests failed against staging.', toolCallIds: ['t7-0', 't7-1', 't7-2'] },
  { id: 's7-st2', name: 'Triage', startedAt: s7Start + 190 * second, endedAt: s7Start + 360 * second, durationMs: 170 * second, costUsd: 0.124, status: 'success', summary: 'Classified each failure: 1 flake, 1 staging-only config drift, 1 real bug.', toolCallIds: ['t7-3', 't7-4', 't7-5'] },
  { id: 's7-st3', name: 'Report', startedAt: s7Start + 362 * second, endedAt: s7Start + 376 * second, durationMs: 14 * second, costUsd: 0.013, status: 'success', summary: 'Wrote a triage report grouped by category.', toolCallIds: ['t7-6'] },
]

const s7Artifacts: Artifact[] = [
  {
    id: 's7-a1', kind: 'markdown', title: 'Integration triage report',
    body: '## Integration triage — staging\n\n**1 flake** — `test_search_pagination`\nIntermittent `connection reset` against the search service. Re-ran cleanly. Recommend tagging as known-flaky and adding retry.\n\n**1 staging-only drift** — `test_email_dispatch`\nThe staging SMTP relay is configured with the wrong sender domain. This is config drift, not a code bug. Filed as INFRA-2188.\n\n**1 real bug** — `test_billing_webhook`\nWebhook signature verification fails for events with non-ASCII metadata. Reproduced locally. Fix is straightforward.',
    tags: ['triage', 'integration'], favorite: true, createdAt: s7Start + 376 * second,
  },
  {
    id: 's7-a2', kind: 'final-answer', title: 'Summary',
    body: 'Of 3 integration failures: 1 flake, 1 environment drift (filed as INFRA-2188), 1 real bug (webhook signature verification on non-ASCII metadata). Recommend fixing the bug first, then chasing the infra ticket.',
    tags: ['summary'], createdAt: s7Start + 376 * second,
  },
]

const session7: Session = enrich({
  id: 'sess-007',
  title: 'Run integration tests against staging and triage failures',
  source: 'codex',
  status: 'success',
  startedAt: s7Start,
  endedAt: s7Start + 376 * second,
  durationMs: 376 * second,
  tokensIn: 14_320,
  tokensOut: 3_980,
  costUsd: 0.1407,
  retryCount: 0,
  toolCallCount: s7Tools.length,
  changedFileCount: 0,
  summary: 'Triaged 3 failures into flake / infra drift / real bug, with a written report.',
  taskGoal: 'Run the integration suite against staging and triage any failures.',
  workSummary: 'Verified staging health, ran the suite, classified each of the three failures, and wrote a triage report grouped by category so the team can route them appropriately.',
  nextSteps: [
    'Fix the webhook signature bug (real bug).',
    'Follow up with infra on INFRA-2188 (env drift).',
    'Add retry tagging for the search flake.',
  ],
  issues: [],
  stages: s7Stages,
  toolCalls: s7Tools,
  files: [],
  artifacts: s7Artifacts,
  miniTimeline: buildMiniTimeline(101),
}, {
  mode: 'unknown',
  planName: 'Codex Plus',
  evidence: [
    'Codex local logs expose token usage but do not infer dollar billing.',
    'Token usage is real; dollar attribution is left to the Codex/OpenAI account-level report.',
  ],
})

export const mockSessions: Session[] = [
  session5, // running, top of dashboard
  session6, // limit-hit, demonstrates extra-usage breakdown
  session3, // failed Codex
  session2, // partial Cursor
  session1, // clean success Claude
  session7, // Codex success
  session4, // trivial fast success
]
