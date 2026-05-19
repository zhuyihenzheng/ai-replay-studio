# Contributing to AI Replay Studio

Thanks for taking the time to look at the code. The project is small and
opinionated; PRs that fit the spirit are welcome.

## Dev setup

```bash
git clone https://github.com/zhuyihenzheng/ai-replay-studio.git
cd ai-replay-studio
npm install
npm run dev -- --host 127.0.0.1
```

Open <http://127.0.0.1:5180/>. The dashboard shows a bundled demo dataset
out of the box. To work against your own transcripts:

```bash
npm run sync
```

This writes `src/data/claudeSessions.local.json` (gitignored) from
`~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl`.

## Before opening a PR

```bash
npm run typecheck
npm run build
```

Both must be green. CI runs them on Node 20 and Node 22.

## Regenerating screenshots

Playwright is not in `devDependencies` because most contributors don't
need it (it's ~200 MB with the Chromium binary). Install on demand:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run screenshots
```

The script boots its own Vite with `VITE_FORCE_DEMO=1`, so it captures
the bundled demo dataset only — never your real synced transcripts.

## Areas where contributions help most

- **New importers.** Cursor is the most-requested. Aider, custom in-house
  agents — also welcome. Importers are plain Node ESM; see
  `scripts/sync-claude-sessions.mjs` for the pattern. Each importer
  produces an array of `Session` objects (see `src/types/index.ts`).
- **Pricing-table updates.** Anthropic / OpenAI publish new model rates
  faster than this repo will keep up. The Claude rate table lives at the
  top of `scripts/sync-claude-sessions.mjs`. PRs updating rates with a
  source link are easy to review and merge.
- **Visualizations.** The cost analysis page has room for better
  per-tool-kind breakdowns and per-model attribution. The tool graph
  page is currently a flat React Flow; clustering by stage would help.
- **Sanitized export.** A way to redact prompts/paths/diffs in-place so
  a single session can be safely shared (issue tracker, blog post)
  without leaking the surrounding work. Listed on the roadmap.

## What we generally won't merge

- Features that require a server-side component. The project is
  intentionally local-first and zero-backend.
- "Cost guardrails" or auto-throttling — interesting but a different
  product.
- Mocked-but-real-looking session data dressed up as importer output.
  The bundled demo dataset is clearly fictional and stays that way.

## Style

- TypeScript strict mode, no `any`.
- Inline styles in pages are fine; the project is not chasing a CSS
  architecture rewrite.
- Tests aren't required for visualization work but very welcome for
  importer logic and cost classification.

## Privacy

Local transcripts can contain prompts, file paths, commands, diffs, and
tool outputs. **Never commit your synced data.** The screenshot script
(`npm run screenshots`) sets `VITE_FORCE_DEMO=1` and ignores local data
on purpose — please don't disable that.
