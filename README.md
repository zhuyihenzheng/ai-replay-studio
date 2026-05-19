# AI Replay Studio

> **See what your AI coding agents actually did — and how many tokens it burned.**
> Point it at your local Claude Code / Codex transcripts and get a
> scrubbable session dashboard: timeline replay, a step trace, file diffs,
> kept artifacts, and a token & cache‑usage breakdown. 100% local.

<p align="center">
  <a href="https://github.com/zhuyihenzheng/ai-replay-studio/actions"><img alt="CI" src="https://github.com/zhuyihenzheng/ai-replay-studio/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-1a1814.svg" /></a>
  <img alt="Status" src="https://img.shields.io/badge/status-alpha-b25515.svg" />
  <img alt="Local-first" src="https://img.shields.io/badge/data-stays%20on%20device-5e8b6a.svg" />
  <img alt="i18n" src="https://img.shields.io/badge/UI-EN%20%2F%20%E4%B8%AD%E6%96%87%20%2F%20%E6%97%A5%E6%9C%AC%E8%AA%9E-6d28d9.svg" />
</p>

<p align="center">
  <img src="docs/demo.gif" width="900"
       alt="AI Replay Studio walkthrough: dashboard token + cache-hit summary, the collapsible Trace stage list, and the per-session Usage breakdown — all on the bundled fictional demo data." />
</p>

Run it locally in ~30 seconds — [**Quick start**](#quick-start). It ships
with a fictional demo dataset so the dashboard is populated on first run.

---

## Why you'd want this

Coding agents do a lot of work autonomously, and the moment it scrolls off
your terminal it's effectively gone:

- **What did it actually do?** 60 tool calls flew by; tomorrow you have a
  vague memory and a dirty working tree.
- **What ate my token budget?** Claude Code limits hit fast, and you
  rarely know *which task* burned the quota — or how much of it was cheap
  prompt‑cache hits vs. expensive fresh input.
- **What do I tell the stakeholder?** "Scroll this 200 MB JSONL" is not a
  status update.

AI Replay Studio turns the transcripts your agent **already writes** into
something you can replay, reason about, and hand off — without sending a
single byte off your machine.

It deliberately shows **tokens, not dollars**. Local logs can't prove what
your card or subscription was actually charged, and there's no public price
list for every model — so rather than fabricate a dollar figure, it counts
tokens (the one thing the logs *do* record precisely) and treats Claude and
Codex the same. Honest beats impressive.

---

## What's inside

| View | What it answers |
|---|---|
| **Dashboard** | Across sessions: success rate, **total tokens**, **cache‑hit share**, saved artifacts. Filter by source, status, and time range (defaults to the last 7 days); search by title. |
| **Session replay** | Step-by-step: prompt → tool calls → outputs → retries → final answer. Stage boundaries come from your user‑turns, not the model's self‑narration. |
| **Trace** | A collapsible stage list. Each stage row carries a slim **token‑share bar** (length = its share of tokens, colored by status) plus step / token / duration counts; expand a stage to walk its steps. Routine same‑kind runs auto‑group; failures/retries are flagged. Scales cleanly from 3 stages to 300. |
| **Usage** | Token totals, **token composition** (fresh input / output / cache read / cache write), tokens by stage, cumulative tokens over steps, the most token‑heavy stage, and retry‑wasted tokens. |
| **File changes** | Every file the agent touched, with a captured diff. |
| **Artifacts** | Final answers, decisions, code snippets, commands worth keeping. Favoritable. |
| **Client report** | Hides the raw tool stream and shows the deliverable — for the person who signs off, not the person who debugs. |

Every tab shares one frame (fixed header + tabs, one canvas, one content
width), so switching never shifts the layout. UI ships in **English /
简体中文 / 日本語**, auto‑detected and switchable — your transcript content
is never translated, only the chrome.

> The demo above is recorded entirely on the **bundled fictional dataset**
> — never real transcripts. Static per-tab screenshots aren't committed
> (the UI moves fast and stale images mislead); `npm run screenshots`
> regenerates them locally on the same demo data if you want stills.

---

## Token & cache usage

This is the part that makes the project worth running when you're fighting
a usage limit.

For every session, stage and tool call the importer records the token
usage the agent already logged, split into:

- **Fresh input** — full‑price input tokens.
- **Output** — generated tokens.
- **Cache read (hit)** — prompt‑cache hits. Providers bill these at
  roughly **1/10** of fresh input, so a high cache share means a much
  cheaper run for the same amount of work.
- **Cache write** — 5‑minute / 1‑hour prompt‑cache writes.

The **Usage** tab surfaces this composition, tokens by stage, the most
token‑heavy stage, and how many tokens were wasted on retries; the
**Trace** tab shows the same proportions inline per stage — so when you
hit a limit you can see *where* the budget went and which kind of task to
trim.

What it does **not** do, on purpose: it doesn't price anything in dollars,
doesn't know your remaining Anthropic/ChatGPT quota, and doesn't claim to
be a bill. It counts tokens from local logs and stops there. Codex and
Claude are treated identically (no fabricated numbers for models without a
public rate card).

> Note: `scripts/sync-*` still computes a dormant internal billing
> classification from earlier versions; nothing in the UI reads it. It's
> on the roadmap to prune.

---

## Quick start

```bash
npm install
npm run dev -- --host 127.0.0.1
# open http://127.0.0.1:5180/
```

A fresh clone ships a built‑in **demo dataset** (fictional sessions across
Claude Code and Codex, anchored to "now" so it's never empty) so the
dashboard is populated immediately.

Use your own real sessions:

```bash
npm run sync
```

That writes a **gitignored** `src/data/claudeSessions.local.json` from
`~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl`. Tracked
files never contain your transcripts.

---

## Supported sources

| Source | Status | Notes |
|---|---|---|
| **Claude Code** | ✅ Supported | Reads `~/.claude/projects/*/*.jsonl` |
| **Codex** | ✅ Supported | Reads `~/.codex/sessions/**/*.jsonl`. Tokens (incl. cache) captured and shown the same as Claude. |
| **Cursor** | 🛠 Planned | Needs a dedicated importer for Cursor's export format |

---

## Tech stack

Vite · React 18 · TypeScript · Zustand · Tailwind CSS · React Router ·
Lucide. Charts and the trace timeline are hand‑rolled SVG/CSS — no
charting library. The importer is plain Node ESM: no build step, no native
deps. Production JS is a single ~300 KB chunk.

<details>
<summary><b>Architecture</b> (click to expand)</summary>

```text
scripts/sync-claude-sessions.mjs
  Reads Claude Code / Codex JSONL, normalizes token usage to the Session
  shape, writes src/data/claudeSessions.local.json (gitignored).

src/types/index.ts        Session, Stage, ToolCall, TokenUsage…
src/store/index.ts        Local synced data → tracked empty stub → demo data
src/pages/*               dashboard, replay, trace, usage, files, artifacts, report
src/components/SessionShell.tsx   shared per-tab frame (one canvas, one width)
src/i18n/*                EN / 简体中文 / 日本語 + typed t() + locale detect
```

</details>

---

## Roadmap

- [ ] Cursor importer
- [ ] Sanitized export: redact prompts/paths/diffs in place so a session
      can be shared safely
- [ ] Streaming view for long-running sessions
- [ ] Prune the dormant billing classification from `scripts/sync-*` and
      `src/lib/cost.ts` (no longer used by the UI)
- [ ] Prune now-unused deps (`reactflow`, `recharts`) from `package.json`
      (already tree-shaken out of the build — housekeeping, not a size fix)

---

## Privacy

Local transcripts can contain prompts, file paths, commands, diffs, and
tool outputs. `npm run sync` writes them to `claudeSessions.local.json`,
which is **gitignored**; the tracked stub `src/data/claudeSessions.json`
stays `[]`. **Never commit your synced data.** To share a demo, use the
bundled fictional dataset — not your own sessions.

---

## Contributing

Issues and PRs welcome — especially new importers (Cursor, Aider, custom
agents) and better token/usage and trace visualizations. See
[CONTRIBUTING.md](CONTRIBUTING.md); security issues follow
[SECURITY.md](SECURITY.md).

---

## License

[MIT](LICENSE) © 2026 AI Replay Studio contributors.
