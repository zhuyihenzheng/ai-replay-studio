# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **local-first**, zero-backend React/Vite dashboard that replays AI coding-agent
transcripts (Claude Code, Codex) the agent already wrote to disk. It reads local
JSONL, normalizes it to a `Session` shape, and renders a scrubbable dashboard:
timeline replay, a stage trace, file diffs, kept artifacts, and a token/cache
usage breakdown. **No transcript data ever leaves the machine, and there is no
server component** — PRs that add one are explicitly out of scope (see
CONTRIBUTING.md).

## Commands

```bash
npm install
npm run dev -- --host 127.0.0.1   # dev server on http://127.0.0.1:5180/
npm run typecheck                 # tsc -b --noEmit
npm run build                     # tsc -b && vite build — must be green before a PR
npm run sync                      # import YOUR real ~/.claude + ~/.codex transcripts
npm run screenshots               # regenerate per-tab stills (needs Playwright, see below)
```

CI (`.github/workflows/ci.yml`) runs **only** `npm run typecheck` and
`npm run build` on Node 20 and 22. There is **no test runner and no linter**
configured — "green" means typecheck + build pass. TypeScript is `strict`; the
project convention is **no `any`** (`noUnusedLocals`/`noUnusedParameters` are
intentionally off in tsconfig, so unused vars won't fail the build, but keep them
clean).

Playwright is deliberately **not** in `devDependencies` (~200 MB). Install on
demand before `npm run screenshots`:
`npm install --no-save playwright && npx playwright install chromium`.

## Data source resolution (read before touching the store)

`src/store/index.ts` picks the session array at module load, in this order:

1. `VITE_FORCE_DEMO=1` → always the bundled fictional demo (`src/data/mockSessions.ts`).
   The screenshot script sets this so captures never include real transcripts.
2. **Dev only** → `src/data/claudeSessions.local.json` (gitignored, may be absent).
3. Tracked stub `src/data/claudeSessions.json` (kept as `[]`).
4. Bundled demo dataset.

The local-sync glob is gated on `import.meta.env.DEV` **on purpose**:
`import.meta.glob({ eager: true })` resolves at build time, so importing it in
production would bundle real transcripts into `dist/`. Vite tree-shakes the
DEV branch out of production builds. **Do not make this glob unconditional** —
that silently leaks private transcripts through any deployed build.

## Naming mismatch — routes/files vs. UI labels

The product was renamed but the code paths were not. When a task says "Trace"
or "Usage," it maps to legacy names:

| README / UI label | Route (`src/App.tsx`) | Page file | i18n key |
|---|---|---|---|
| Trace | `/sessions/:id/graph` | `src/pages/ToolGraphPage.tsx` | `tabs.tool_graph` |
| Usage | `/sessions/:id/cost` | `src/pages/CostAnalysisPage.tsx` | `tabs.cost` |

Tabs are defined in `src/components/SessionTabs.tsx`; the displayed text comes
from i18n, not the route. Don't assume "Cost"/"Graph" filenames are dead code.

## Tokens, not dollars (and dormant billing code)

The UI deliberately shows **tokens, never dollar amounts** — local logs can't
prove what was actually billed. However, an older billing/cost-classification
layer still exists and computes dollar estimates that **nothing in the UI
reads**: `scripts/pricing-table.mjs`, the `CostEstimate`/`BillingBreakdown`/
`SessionBilling` types in `src/types/index.ts`, and helpers in `src/lib/cost.ts`.
It's on the roadmap to prune. Treat it as dormant — don't surface dollars in the
UI, and don't assume billing fields are load-bearing.

## Architecture map

```text
scripts/sync-claude-sessions.mjs   Importer. Plain Node ESM, no build step, no deps.
                                   Maps JSONL events → Session[]; writes the gitignored
                                   *.local.json. user(string)→new stage; assistant(tool_use)
                                   →tool call; tool_result→closes it; last assistant text→output.
scripts/pricing-table.mjs          Model rate table consumed by the importer (dormant in UI).
src/types/index.ts                 Single source of truth: Session, Stage, ToolCall, TokenUsage…
src/store/index.ts                 Zustand store; source resolution (see above).
src/i18n/                          en/zh/ja dictionaries + typed t(); EN is the fallback locale.
src/components/SessionShell.tsx    Shared per-tab frame: fixed header+tabs, one canvas, one
                                   max-width (1080), one scroll region. All session tabs use it.
src/pages/                         dashboard, replay, graph(Trace), cost(Usage), files,
                                   artifacts, report.
```

**Stage boundaries** come from user turns in the transcript, not the model's
self-narration — a new `user` string event starts a new `Stage`.

## Importer convention

Adding a new agent source (Cursor, Aider, etc.) means writing a Node-ESM
importer in `scripts/` that emits `Session[]` matching `src/types/index.ts`.
Follow `sync-claude-sessions.mjs` as the reference. `AgentSource` in the types
file already includes `'cursor'`.

## i18n

All user-facing chrome is translated via `useT()` / `t('some.key')`; transcript
**content is never translated**. Add keys to all three dictionaries
(`src/i18n/dictionaries/{en,zh,ja}.ts`); missing keys fall back to `en` and warn
once in dev. Locale is auto-detected from `navigator.language`, persisted in
`localStorage`, and switchable.

## Privacy guardrails (hard rules)

- `claudeSessions.local.json` is gitignored. **Never commit synced data.**
- The tracked stub `src/data/claudeSessions.json` stays `[]`.
- Demos/screenshots use only the bundled fictional dataset (`VITE_FORCE_DEMO=1`).
  Don't disable that flag in the screenshot path.

## Styling

Tailwind is configured, but pages use **inline styles** liberally — that's an
accepted choice, not tech debt to refactor. Charts and the trace timeline are
hand-rolled SVG/CSS; `reactflow` and `recharts` are in `package.json` but
tree-shaken out / slated for removal — prefer the hand-rolled approach over
reintroducing a charting lib.
