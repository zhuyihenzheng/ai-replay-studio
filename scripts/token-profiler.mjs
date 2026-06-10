#!/usr/bin/env node
// token-profiler — offline token-usage profiler for Claude Code sessions.
//
// Reads ~/.claude/projects/**/<uuid>.jsonl and produces a comprehensive
// token report: composition (fresh / cache read / cache write / output),
// cache hit rate and expiry gaps, per-turn distribution, explore/edit/test
// phase shares, repeated file reads, repeated commands, failed-call cost,
// top context consumers, compact events (what got dropped and what had to
// be re-read), and actionable recommendations.
//
// It never calls the network and never modifies the transcripts.
//
// Usage:
//   node scripts/token-profiler.mjs                    # overview of recent sessions
//   node scripts/token-profiler.mjs --session <id>     # deep-dive one session
//   node scripts/token-profiler.mjs --project replay   # filter by project folder
//   node scripts/token-profiler.mjs --since 7          # last 7 days
//   node scripts/token-profiler.mjs --json | jq .      # machine-readable
//   node scripts/token-profiler.mjs --md > report.md   # markdown report
//
// Token sizes that come from the API `usage` field are exact. Sizes of tool
// results / prompts are estimated at ~4 chars per token and always labeled
// "est.".

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'

import {
  MODEL_RATES,
  DEFAULT_RATE,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
  PRICING_VERSION,
} from './pricing-table.mjs'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    dir: path.join(os.homedir(), '.claude', 'projects'),
    project: null,
    session: null,
    since: null, // ms timestamp
    last: null,
    top: 10,
    format: 'pretty', // pretty | json | md
    all: false,
    color: process.stdout.isTTY && !process.env.NO_COLOR,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--dir':
        args.dir = argv[++i]
        break
      case '--project':
      case '-p':
        args.project = argv[++i]
        break
      case '--session':
      case '-s':
        args.session = argv[++i]
        break
      case '--since': {
        const v = argv[++i]
        const days = Number(v)
        args.since = Number.isFinite(days) && v !== ''
          ? Date.now() - days * 24 * 3600 * 1000
          : new Date(v).getTime()
        break
      }
      case '--last':
        args.last = Number(argv[++i])
        break
      case '--top':
        args.top = Number(argv[++i]) || 10
        break
      case '--json':
        args.format = 'json'
        break
      case '--md':
      case '--markdown':
        args.format = 'md'
        break
      case '--all':
        args.all = true
        break
      case '--no-color':
        args.color = false
        break
      case '-h':
      case '--help':
        printHelp()
        process.exit(0)
        break
      default:
        if (!a.startsWith('-') && !args.session) args.session = a
        else {
          console.error(`Unknown option: ${a}`)
          process.exit(2)
        }
    }
  }
  if (args.format !== 'pretty') args.color = false
  return args
}

function printHelp() {
  console.log(`token-profiler — offline token-usage profiler for Claude Code sessions

Reads ~/.claude/projects/**/*.jsonl and reports where tokens went and where
they were wasted: cache efficiency, per-turn distribution, explore/edit/test
phase shares, repeated file reads, compact losses, failed-call cost.

Usage:
  token-profiler [options] [session-id]

Options:
  --dir <path>       Transcript root (default: ~/.claude/projects)
  --project, -p <s>  Only projects whose folder name contains <s>
  --session, -s <id> Deep-dive one session (id prefix is enough)
  --since <n|date>   Only sessions started in the last <n> days, or after <date>
  --last <n>         Only the <n> most recent sessions
  --top <n>          Rows in "top" lists (default 10)
  --all              Print a detailed report for every matched session
  --json             Machine-readable JSON output
  --md, --markdown   Markdown report output
  --no-color         Disable ANSI colors
  -h, --help         Show this help`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EST_CHARS_PER_TOKEN = 4

function estTokens(text) {
  if (!text) return 0
  return Math.round(String(text).length / EST_CHARS_PER_TOKEN)
}

function rateForModel(model) {
  if (!model || model === '<synthetic>') return null
  return MODEL_RATES.find((r) => r.match.test(model)) ?? DEFAULT_RATE
}

function usageCostUsd(model, u) {
  const rate = rateForModel(model)
  if (!rate) return 0
  return (
    (u.input * rate.inputPerMTok +
      u.output * rate.outputPerMTok +
      u.cacheRead * rate.inputPerMTok * CACHE_READ_MULTIPLIER +
      u.cacheWrite5m * rate.inputPerMTok * CACHE_WRITE_5M_MULTIPLIER +
      u.cacheWrite1h * rate.inputPerMTok * CACHE_WRITE_1H_MULTIPLIER) /
    1_000_000
  )
}

function blankUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
}

function addUsage(a, b) {
  a.input += b.input
  a.output += b.output
  a.cacheRead += b.cacheRead
  a.cacheWrite5m += b.cacheWrite5m
  a.cacheWrite1h += b.cacheWrite1h
  return a
}

function usageFromMessage(usage) {
  if (!usage) return blankUsage()
  const cc = usage.cache_creation ?? {}
  const w5 = cc.ephemeral_5m_input_tokens
  const w1 = cc.ephemeral_1h_input_tokens
  const fallback = usage.cache_creation_input_tokens ?? 0
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite5m: w5 == null && w1 == null ? fallback : w5 ?? 0,
    cacheWrite1h: w1 ?? 0,
  }
}

function contextSize(u) {
  return u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h
}

function textOf(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c?.text ?? c?.content ?? ''))
      .filter((s) => typeof s === 'string' && s)
      .join('\n')
  }
  return ''
}

// ---------------------------------------------------------------------------
// Phase classification — explore / edit / execute / test / subagent / other
// ---------------------------------------------------------------------------

const EXPLORE_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch', 'TodoRead', 'NotebookRead', 'LS',
])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TEST_COMMAND_RE =
  /\b(test|tests|jest|vitest|pytest|unittest|mocha|tsc|typecheck|type-check|eslint|lint|ruff|flake8|mypy|prettier --check|cargo\s+(test|check|clippy)|go\s+(test|vet)|mvn\s+(test|verify)|gradle\w*\s+(test|check)|rspec|phpunit)\b/i

function classifyPhase(name, input) {
  if (!name) return 'other'
  if (EXPLORE_TOOLS.has(name)) return 'explore'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (name === 'Task' || name === 'Agent' || name === 'Explore') return 'subagent'
  if (name === 'Bash' || name === 'BashOutput') {
    const cmd = String(input?.command ?? '')
    return TEST_COMMAND_RE.test(cmd) ? 'test' : 'execute'
  }
  if (name.startsWith('mcp__')) return 'mcp'
  return 'other'
}

const PHASE_ORDER = ['explore', 'edit', 'execute', 'test', 'subagent', 'mcp', 'other', 'respond']

function toolUseLabel(name, input) {
  if (!input || typeof input !== 'object') return name
  switch (name) {
    case 'Read':
      return `Read ${input.file_path ?? ''}`
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return `${name} ${input.file_path ?? ''}`
    case 'Bash':
      return `Bash: ${String(input.command ?? input.description ?? '').replace(/\s+/g, ' ').slice(0, 70)}`
    case 'Grep':
      return `Grep ${input.pattern ?? ''}${input.path ? ` in ${input.path}` : ''}`
    case 'Glob':
      return `Glob ${input.pattern ?? ''}`
    case 'WebFetch':
      return `WebFetch ${input.url ?? ''}`
    case 'WebSearch':
      return `WebSearch: ${String(input.query ?? '').slice(0, 60)}`
    case 'Task':
      return `Subagent: ${String(input.description ?? '').slice(0, 60)}`
    default:
      return name
  }
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

function decodeProjectName(folderName) {
  // Folder names encode absolute paths with '-' separators, e.g.
  // "-home-user-ai-replay-studio". Strip the home-dir prefix and keep the rest.
  const stripped = folderName
    .replace(/^-(home|Users)-[^-]+-/, '')
    .replace(/^-/, '')
  return stripped || folderName
}

/**
 * Parse one session transcript into a profile object.
 * Returns null when the file holds no analyzable API usage.
 */
function profileTranscript(filePath, projectFolder) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }

  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      /* skip unparseable lines */
    }
  }
  if (events.length === 0) return null

  const sessionId = events.find((e) => e.sessionId)?.sessionId ?? path.basename(filePath, '.jsonl')

  // -- accumulators ---------------------------------------------------------
  const apiCalls = [] // { ts, model, usage, turn, sidechain, msgId, toolNames, hasText }
  const seenMsgIds = new Set()
  const toolUses = new Map() // tool_use_id -> record
  const turns = [] // { index, ts, prompt, isCommand }
  const compacts = [] // { ts, trigger, preTokens, explicit, summaryEstTokens }
  let firstUserText = ''
  let firstTs = null
  let lastTs = null
  let models = new Map() // model -> apiCall count
  let failedResults = 0
  let sidechainCalls = 0

  let currentTurn = -1
  let lastEventWasCompactBoundary = false

  for (const ev of events) {
    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null
    if (ts) {
      if (firstTs == null) firstTs = ts
      lastTs = ts
    }
    const sidechain = ev.isSidechain === true

    // Explicit compact boundary (system event written by Claude Code).
    if (ev.type === 'system' && ev.subtype === 'compact_boundary') {
      compacts.push({
        ts,
        trigger: ev.compactMetadata?.trigger ?? 'unknown',
        preTokens: ev.compactMetadata?.preTokens ?? null,
        explicit: true,
        summaryEstTokens: 0,
      })
      lastEventWasCompactBoundary = true
      continue
    }

    if (ev.type === 'user' && !sidechain) {
      const content = ev.message?.content
      const isToolResult =
        Array.isArray(content) && content.some((c) => c?.type === 'tool_result')

      if (isToolResult) {
        for (const c of content) {
          if (c?.type !== 'tool_result' || !c.tool_use_id) continue
          const rec = toolUses.get(c.tool_use_id)
          const resultText = textOf(c.content)
          if (rec) {
            rec.resultEstTokens = estTokens(resultText)
            rec.failed = c.is_error === true
            rec.endedTs = ts
            if (rec.failed) failedResults++
          }
        }
        continue
      }

      // Compact summary appears as a user message flagged isCompactSummary.
      if (ev.isCompactSummary === true || (lastEventWasCompactBoundary && ev.isMeta !== true)) {
        const summaryText = textOf(content)
        const target = compacts[compacts.length - 1]
        if (ev.isCompactSummary === true && (!target || target.summaryEstTokens)) {
          compacts.push({ ts, trigger: 'unknown', preTokens: null, explicit: true, summaryEstTokens: estTokens(summaryText) })
        } else if (target) {
          target.summaryEstTokens = estTokens(summaryText)
        }
        lastEventWasCompactBoundary = false
        continue
      }
      lastEventWasCompactBoundary = false

      if (ev.isMeta === true) continue
      const promptText = textOf(content)
      if (!promptText.trim()) continue

      const isCommand = /^<command-name>/.test(promptText.trim())
      currentTurn = turns.length
      turns.push({
        index: currentTurn,
        ts,
        prompt: promptText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90),
        promptEstTokens: estTokens(promptText),
        isCommand,
      })
      if (!firstUserText && !isCommand) firstUserText = promptText
      continue
    }

    if (ev.type === 'assistant') {
      const msg = ev.message
      if (!msg) continue
      const msgId = msg.id
      const firstSeen = msgId ? !seenMsgIds.has(msgId) : true
      if (msgId) seenMsgIds.add(msgId)

      let call = null
      if (firstSeen && msg.usage) {
        call = {
          ts,
          model: msg.model,
          usage: usageFromMessage(msg.usage),
          turn: sidechain ? -1 : currentTurn,
          sidechain,
          msgId,
          toolPhases: [],
          hasText: false,
        }
        apiCalls.push(call)
        if (sidechain) sidechainCalls++
        if (msg.model && msg.model !== '<synthetic>') {
          models.set(msg.model, (models.get(msg.model) ?? 0) + 1)
        }
      } else if (msgId) {
        // streamed continuation of an already-counted message
        call = apiCalls.find((c) => c.msgId === msgId)
      }

      const content = msg.content
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use') {
            const id = c.id || `${sessionId}-tu-${toolUses.size}`
            const rec = {
              id,
              name: c.name,
              phase: classifyPhase(c.name, c.input),
              label: toolUseLabel(c.name, c.input),
              filePath:
                c.name === 'Read' || EDIT_TOOLS.has(c.name) ? c.input?.file_path ?? null : null,
              readRange:
                c.name === 'Read'
                  ? `${c.input?.offset ?? 0}+${c.input?.limit ?? 'all'}`
                  : null,
              command: c.name === 'Bash' ? String(c.input?.command ?? '') : null,
              grepKey:
                c.name === 'Grep'
                  ? `${c.input?.pattern ?? ''} @ ${c.input?.path ?? '.'}`
                  : null,
              turn: sidechain ? -1 : currentTurn,
              sidechain,
              ts,
              endedTs: ts,
              resultEstTokens: 0,
              failed: false,
            }
            toolUses.set(id, rec)
            if (call) call.toolPhases.push(rec.phase)
          } else if (c?.type === 'text' && c.text?.trim()) {
            if (call) call.hasText = true
          }
        }
      }
    }
  }

  const mainCalls = apiCalls.filter((c) => !c.sidechain)
  if (apiCalls.length === 0) return null

  // -- totals ---------------------------------------------------------------
  const totals = blankUsage()
  const sideTotals = blankUsage()
  let costUsd = 0
  for (const c of apiCalls) {
    addUsage(c.sidechain ? sideTotals : totals, c.usage)
    costUsd += usageCostUsd(c.model, c.usage)
  }
  const grand = addUsage(addUsage(blankUsage(), totals), sideTotals)
  const cacheWrite = grand.cacheWrite5m + grand.cacheWrite1h
  const inputSide = grand.input + grand.cacheRead + cacheWrite
  const cacheHitRate = inputSide > 0 ? grand.cacheRead / inputSide : 0

  // -- context growth & implicit compaction / cache-expiry gaps --------------
  const contextSeries = mainCalls.map((c) => contextSize(c.usage))
  const peakContext = Math.max(0, ...contextSeries)

  // implicit compacts: big context drop without an explicit boundary
  const implicitCompacts = []
  for (let i = 1; i < mainCalls.length; i++) {
    const prev = contextSize(mainCalls[i - 1].usage)
    const cur = contextSize(mainCalls[i].usage)
    if (prev > 30000 && cur < prev * 0.55 && prev - cur > 25000) {
      const near = compacts.some(
        (k) => k.ts && mainCalls[i].ts && Math.abs(k.ts - mainCalls[i].ts) < 5 * 60 * 1000,
      )
      if (!near) {
        implicitCompacts.push({
          ts: mainCalls[i].ts,
          trigger: 'inferred',
          preTokens: prev,
          postTokens: cur,
          explicit: false,
          summaryEstTokens: 0,
        })
      }
    }
  }
  // postTokens for explicit compacts = context of the first call after the boundary
  for (const k of compacts) {
    if (k.ts == null) continue
    const after = mainCalls.find((c) => c.ts != null && c.ts >= k.ts)
    if (after) k.postTokens = contextSize(after.usage)
    const before = [...mainCalls].reverse().find((c) => c.ts != null && c.ts < k.ts)
    if (before && k.preTokens == null) k.preTokens = contextSize(before.usage)
  }
  const allCompacts = [...compacts, ...implicitCompacts].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))

  // cache-expiry gaps: >5 minutes between consecutive main-chain calls means
  // the 5m cache likely expired and the next call pays a full cache re-write.
  const expiryGaps = []
  for (let i = 1; i < mainCalls.length; i++) {
    const a = mainCalls[i - 1].ts
    const b = mainCalls[i].ts
    if (a && b && b - a > 5 * 60 * 1000) {
      expiryGaps.push({
        ts: b,
        gapMs: b - a,
        rewriteTokens: mainCalls[i].usage.cacheWrite5m + mainCalls[i].usage.cacheWrite1h,
      })
    }
  }

  // -- per-turn breakdown -----------------------------------------------------
  const turnRows = turns.map((t) => ({
    ...t,
    calls: 0,
    toolCalls: 0,
    usage: blankUsage(),
    resultEstTokens: 0,
    costUsd: 0,
    failed: 0,
  }))
  for (const c of mainCalls) {
    const row = turnRows[c.turn]
    if (!row) continue
    row.calls++
    addUsage(row.usage, c.usage)
    row.costUsd += usageCostUsd(c.model, c.usage)
  }
  for (const tu of toolUses.values()) {
    if (tu.sidechain) continue
    const row = turnRows[tu.turn]
    if (!row) continue
    row.toolCalls++
    row.resultEstTokens += tu.resultEstTokens
    if (tu.failed) row.failed++
  }

  // -- phase breakdown --------------------------------------------------------
  const phases = new Map() // phase -> { toolCalls, resultEstTokens, outputTokens, failed }
  for (const p of PHASE_ORDER) {
    phases.set(p, { phase: p, toolCalls: 0, resultEstTokens: 0, outputTokens: 0, failed: 0 })
  }
  for (const tu of toolUses.values()) {
    if (tu.sidechain) continue
    const ph = phases.get(tu.phase) ?? phases.get('other')
    ph.toolCalls++
    ph.resultEstTokens += tu.resultEstTokens
    if (tu.failed) ph.failed++
  }
  // attribute each message's output tokens across the phases of its tool calls
  for (const c of mainCalls) {
    if (c.toolPhases.length === 0) {
      phases.get('respond').outputTokens += c.usage.output
      continue
    }
    const share = c.usage.output / c.toolPhases.length
    for (const phase of c.toolPhases) {
      const ph = phases.get(phase) ?? phases.get('other')
      ph.outputTokens += share
    }
  }
  const phaseRows = [...phases.values()]
    .map((p) => ({ ...p, outputTokens: Math.round(p.outputTokens) }))
    .filter((p) => p.toolCalls > 0 || p.outputTokens > 0)

  // -- waste: repeated reads / repeated commands / repeated greps -------------
  function dupGroups(keyFn) {
    const byKey = new Map()
    for (const tu of toolUses.values()) {
      if (tu.sidechain || tu.failed) continue
      const key = keyFn(tu)
      if (!key) continue
      const g = byKey.get(key) ?? { key, count: 0, totalEstTokens: 0, maxEstTokens: 0, turns: new Set() }
      g.count++
      g.totalEstTokens += tu.resultEstTokens
      g.maxEstTokens = Math.max(g.maxEstTokens, tu.resultEstTokens)
      g.turns.add(tu.turn)
      byKey.set(key, g)
    }
    return [...byKey.values()]
      .filter((g) => g.count > 1)
      .map((g) => ({
        key: g.key,
        count: g.count,
        totalEstTokens: g.totalEstTokens,
        // first occurrence was necessary; the rest is the waste candidate
        wastedEstTokens: g.totalEstTokens - g.maxEstTokens,
        turns: [...g.turns].filter((t) => t >= 0).map((t) => t + 1),
      }))
      .sort((a, b) => b.wastedEstTokens - a.wastedEstTokens)
  }

  const repeatedReads = dupGroups((tu) => (tu.name === 'Read' ? tu.filePath : null))
  const repeatedCommands = dupGroups((tu) =>
    tu.command ? tu.command.replace(/\s+/g, ' ').trim() : null,
  )
  const repeatedGreps = dupGroups((tu) => tu.grepKey)

  // -- failed calls ------------------------------------------------------------
  const failedCalls = [...toolUses.values()]
    .filter((tu) => tu.failed && !tu.sidechain)
    .map((tu) => ({ label: tu.label, turn: tu.turn + 1, resultEstTokens: tu.resultEstTokens }))
    .sort((a, b) => b.resultEstTokens - a.resultEstTokens)

  // -- top context consumers ----------------------------------------------------
  const topResults = [...toolUses.values()]
    .filter((tu) => !tu.sidechain && tu.resultEstTokens > 0)
    .sort((a, b) => b.resultEstTokens - a.resultEstTokens)
    .slice(0, 25)
    .map((tu) => ({
      label: tu.label,
      phase: tu.phase,
      turn: tu.turn + 1,
      resultEstTokens: tu.resultEstTokens,
      failed: tu.failed,
    }))

  // -- compact loss: files read before a compact and re-read after --------------
  for (const k of allCompacts) {
    if (k.ts == null) continue
    const before = new Set()
    const reRead = new Map()
    for (const tu of toolUses.values()) {
      if (tu.sidechain || tu.name !== 'Read' || !tu.filePath || tu.ts == null) continue
      if (tu.ts < k.ts) before.add(tu.filePath)
      else if (before.has(tu.filePath)) {
        reRead.set(tu.filePath, (reRead.get(tu.filePath) ?? 0) + tu.resultEstTokens)
      }
    }
    k.reReadFiles = [...reRead.entries()]
      .map(([file, tokens]) => ({ file, reReadEstTokens: tokens }))
      .sort((a, b) => b.reReadEstTokens - a.reReadEstTokens)
    k.reReadEstTokens = k.reReadFiles.reduce((a, f) => a + f.reReadEstTokens, 0)
  }

  // -- recommendations ------------------------------------------------------------
  const recommendations = []
  const repeatWaste = repeatedReads.reduce((a, r) => a + r.wastedEstTokens, 0)
  if (repeatWaste > 4000) {
    const top = repeatedReads[0]
    recommendations.push(
      `Repeated file reads cost ~${fmtTokens(repeatWaste)} est. tokens (top: ${top.key} ×${top.count}). ` +
        'Read with offset/limit, or summarize stable files in CLAUDE.md so they are not re-read each turn.',
    )
  }
  if (mainCalls.length >= 10 && cacheHitRate < 0.5) {
    recommendations.push(
      `Cache hit rate is ${(cacheHitRate * 100).toFixed(1)}% — most input tokens were paid at full/write price. ` +
        'Long pauses (>5 min) and frequent system-prompt changes invalidate the cache.',
    )
  }
  if (expiryGaps.length > 0) {
    const rewrite = expiryGaps.reduce((a, g) => a + g.rewriteTokens, 0)
    recommendations.push(
      `${expiryGaps.length} pause(s) longer than 5 minutes likely expired the prompt cache; ` +
        `the following calls re-wrote ~${fmtTokens(rewrite)} cache tokens at 1.25–2× input price.`,
    )
  }
  const hugeResults = topResults.filter((r) => r.resultEstTokens > 15000)
  if (hugeResults.length > 0) {
    recommendations.push(
      `${hugeResults.length} tool result(s) over ~15k est. tokens (largest: ${hugeResults[0].label}, ~${fmtTokens(hugeResults[0].resultEstTokens)}). ` +
        'Use Read offset/limit, Grep head_limit, or delegate bulk exploration to a subagent that returns only conclusions.',
    )
  }
  if (failedCalls.length >= 3) {
    recommendations.push(
      `${failedCalls.length} tool calls failed; each failure still pays for its context and a retry. ` +
        'Check the failed-calls list for permission errors or repeated bad paths.',
    )
  }
  for (const k of allCompacts) {
    if ((k.reReadEstTokens ?? 0) > 3000) {
      recommendations.push(
        `After the ${k.trigger} compact, ${k.reReadFiles.length} file(s) had to be re-read (~${fmtTokens(k.reReadEstTokens)} est. tokens). ` +
          'Consider /compact at a natural milestone yourself, after which fewer files are still needed.',
      )
    }
  }
  if (sideTotals.output + sideTotals.input + sideTotals.cacheRead > 0) {
    const sideCtx = sideTotals.input + sideTotals.cacheRead + sideTotals.cacheWrite5m + sideTotals.cacheWrite1h
    recommendations.push(
      `Subagents consumed ~${fmtTokens(sideCtx)} input-side and ${fmtTokens(sideTotals.output)} output tokens in ${sidechainCalls} calls — ` +
        'this kept the main context smaller (good); it is included in cost totals.',
    )
  }

  return {
    sessionId,
    file: filePath,
    project: decodeProjectName(projectFolder),
    title: firstUserText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || `Session ${sessionId.slice(0, 8)}`,
    startedAt: firstTs,
    endedAt: lastTs,
    durationMs: firstTs != null && lastTs != null ? lastTs - firstTs : 0,
    models: [...models.entries()].map(([model, calls]) => ({ model, calls })),
    pricingVersion: PRICING_VERSION,
    counts: {
      apiCalls: apiCalls.length,
      mainApiCalls: mainCalls.length,
      sidechainApiCalls: sidechainCalls,
      turns: turns.length,
      toolCalls: toolUses.size,
      failedToolCalls: failedResults,
    },
    totals: {
      main: totals,
      sidechain: sideTotals,
      grand,
      cacheHitRate,
      peakContext,
      estCostUsd: costUsd,
    },
    contextSeries,
    turnRows: turnRows.map((r) => ({
      turn: r.index + 1,
      prompt: r.prompt,
      isCommand: r.isCommand,
      apiCalls: r.calls,
      toolCalls: r.toolCalls,
      failed: r.failed,
      usage: r.usage,
      resultEstTokens: r.resultEstTokens,
      costUsd: r.costUsd,
    })),
    phases: phaseRows,
    waste: {
      repeatedReads,
      repeatedCommands,
      repeatedGreps,
      repeatedReadWasteEstTokens: repeatWaste,
      failedCalls,
      topResults,
    },
    compacts: allCompacts.map((k) => ({
      ts: k.ts,
      trigger: k.trigger,
      explicit: k.explicit,
      preTokens: k.preTokens ?? null,
      postTokens: k.postTokens ?? null,
      summaryEstTokens: k.summaryEstTokens ?? 0,
      reReadFiles: k.reReadFiles ?? [],
      reReadEstTokens: k.reReadEstTokens ?? 0,
    })),
    expiryGaps,
    recommendations,
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtTokens(n) {
  if (n == null) return '–'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 10_000) return Math.round(n / 1000) + 'k'
  if (n >= 1_000) return (n / 1000).toFixed(1) + 'k'
  return String(Math.round(n))
}

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US')
}

function fmtCost(n) {
  return '$' + n.toFixed(n >= 10 ? 2 : n >= 0.1 ? 3 : 4)
}

function fmtPct(x) {
  return (x * 100).toFixed(1) + '%'
}

function fmtTime(ts) {
  if (!ts) return '–'
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16)
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '–'
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

function sparkline(series, width = 48) {
  if (!series.length) return ''
  const ticks = '▁▂▃▄▅▆▇█'
  const bucketed = []
  const per = Math.max(1, Math.ceil(series.length / width))
  for (let i = 0; i < series.length; i += per) {
    bucketed.push(Math.max(...series.slice(i, i + per)))
  }
  const max = Math.max(...bucketed, 1)
  return bucketed.map((v) => ticks[Math.min(7, Math.floor((v / max) * 8))]).join('')
}

function makeColor(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s))
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    cyan: wrap('36'),
    yellow: wrap('33'),
    red: wrap('31'),
    green: wrap('32'),
    magenta: wrap('35'),
  }
}

function table(rows, { headers, aligns = [], indent = '  ' } = {}) {
  const all = headers ? [headers, ...rows] : rows
  const widths = []
  for (const row of all) {
    row.forEach((cell, i) => {
      // eslint-disable-next-line no-control-regex
      const len = String(cell).replace(/\x1b\[\d+m/g, '').length
      widths[i] = Math.max(widths[i] ?? 0, len)
    })
  }
  const fmtRow = (row) =>
    indent +
    row
      .map((cell, i) => {
        const s = String(cell)
        // eslint-disable-next-line no-control-regex
        const visible = s.replace(/\x1b\[\d+m/g, '').length
        const pad = ' '.repeat(widths[i] - visible)
        return aligns[i] === 'r' ? pad + s : s + pad
      })
      .join('  ')
  const out = []
  if (headers) {
    out.push(fmtRow(headers))
    out.push(indent + widths.map((w) => '─'.repeat(w)).join('──'))
  }
  for (const row of rows) out.push(fmtRow(row))
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Pretty (terminal) renderer — single session
// ---------------------------------------------------------------------------

function renderSessionPretty(p, opts) {
  const c = makeColor(opts.color)
  const out = []
  const g = p.totals.grand
  const cacheWrite = g.cacheWrite5m + g.cacheWrite1h
  const inputSide = g.input + g.cacheRead + cacheWrite

  out.push(
    c.bold(`TOKEN PROFILE · ${p.sessionId.slice(0, 8)} · ${p.project}`),
  )
  out.push(
    c.dim(
      `"${p.title}" · ${fmtTime(p.startedAt)} → ${fmtTime(p.endedAt)} (${fmtDuration(p.durationMs)}) · ` +
        `${p.models.map((m) => m.model).join(', ') || 'unknown model'} · pricing ${p.pricingVersion}`,
    ),
  )
  out.push('')

  // Totals
  out.push(c.bold('TOTALS'))
  out.push(
    table(
      [
        ['API calls', fmtInt(p.counts.apiCalls), `(${p.counts.sidechainApiCalls} in subagents)`],
        ['User turns', fmtInt(p.counts.turns), ''],
        ['Tool calls', fmtInt(p.counts.toolCalls), p.counts.failedToolCalls ? c.red(`${p.counts.failedToolCalls} failed`) : ''],
        ['Fresh input', fmtInt(g.input), c.dim(inputSide ? fmtPct(g.input / inputSide) + ' of input side' : '')],
        ['Cache write', fmtInt(cacheWrite), c.dim(`5m ${fmtTokens(g.cacheWrite5m)} / 1h ${fmtTokens(g.cacheWrite1h)}`)],
        ['Cache read', fmtInt(g.cacheRead), c.green(`hit rate ${fmtPct(p.totals.cacheHitRate)}`)],
        ['Output', fmtInt(g.output), ''],
        ['Peak context', fmtInt(p.totals.peakContext), c.dim('input+cache of largest call')],
        ['Est. API cost', fmtCost(p.totals.estCostUsd), c.dim('list-price equivalent')],
      ],
      { aligns: ['l', 'r', 'l'] },
    ),
  )
  out.push('')

  // Context growth
  if (p.contextSeries.length > 1) {
    out.push(c.bold('CONTEXT GROWTH') + c.dim('  (input+cache per call)'))
    out.push('  ' + c.cyan(sparkline(p.contextSeries)) + c.dim(`  peak ${fmtTokens(p.totals.peakContext)}`))
    if (p.compacts.length) {
      out.push(c.dim(`  ${p.compacts.length} compact(s) detected — see COMPACTS below`))
    }
    out.push('')
  }

  // Per-turn
  if (p.turnRows.length) {
    out.push(c.bold('PER-TURN BREAKDOWN'))
    const totalCost = p.turnRows.reduce((a, r) => a + r.costUsd, 0) || 1
    out.push(
      table(
        p.turnRows.map((r) => [
          `#${r.turn}`,
          (r.isCommand ? c.dim('[cmd] ') : '') + r.prompt.slice(0, 46),
          fmtInt(r.toolCalls),
          fmtTokens(r.usage.input),
          fmtTokens(r.usage.cacheWrite5m + r.usage.cacheWrite1h),
          fmtTokens(r.usage.cacheRead),
          fmtTokens(r.usage.output),
          fmtTokens(r.resultEstTokens),
          fmtCost(r.costUsd),
          fmtPct(r.costUsd / totalCost),
          r.failed ? c.red(`${r.failed}✗`) : '',
        ]),
        {
          headers: ['turn', 'prompt', 'tools', 'fresh', 'cache-w', 'cache-r', 'out', 'results*', 'cost', 'share', ''],
          aligns: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
        },
      ),
    )
    out.push(c.dim('  *results = est. tokens injected into context by tool results (chars/4)'))
    out.push('')
  }

  // Phases
  if (p.phases.length) {
    out.push(c.bold('PHASE BREAKDOWN') + c.dim('  (explore / edit / execute / test / …)'))
    const totalResult = p.phases.reduce((a, r) => a + r.resultEstTokens, 0) || 1
    out.push(
      table(
        p.phases.map((r) => [
          r.phase,
          fmtInt(r.toolCalls),
          fmtTokens(r.resultEstTokens),
          fmtPct(r.resultEstTokens / totalResult),
          fmtTokens(r.outputTokens),
          r.failed ? c.red(`${r.failed}✗`) : '',
        ]),
        {
          headers: ['phase', 'tool calls', 'result tokens*', 'share', 'output tokens', ''],
          aligns: ['l', 'r', 'r', 'r', 'r', 'l'],
        },
      ),
    )
    out.push('')
  }

  // Waste signals
  out.push(c.bold('WASTE SIGNALS'))
  if (p.waste.repeatedReads.length) {
    out.push('  ' + c.yellow('Repeated file reads') + c.dim(` — est. ${fmtTokens(p.waste.repeatedReadWasteEstTokens)} wasted`))
    out.push(
      table(
        p.waste.repeatedReads.slice(0, opts.top).map((r) => [
          `${r.count}×`,
          r.key,
          fmtTokens(r.totalEstTokens),
          fmtTokens(r.wastedEstTokens),
          c.dim(`turns ${r.turns.join(',')}`),
        ]),
        { headers: ['reads', 'file', 'total est', 'wasted est', ''], aligns: ['r', 'l', 'r', 'r', 'l'], indent: '    ' },
      ),
    )
  } else {
    out.push(c.dim('  No file was read more than once. ✓'))
  }
  if (p.waste.repeatedCommands.length) {
    out.push('  ' + c.yellow('Repeated identical commands'))
    out.push(
      table(
        p.waste.repeatedCommands.slice(0, 5).map((r) => [`${r.count}×`, r.key.slice(0, 70), fmtTokens(r.totalEstTokens)]),
        { aligns: ['r', 'l', 'r'], indent: '    ' },
      ),
    )
  }
  if (p.waste.repeatedGreps.length) {
    out.push('  ' + c.yellow('Repeated identical greps'))
    out.push(
      table(
        p.waste.repeatedGreps.slice(0, 5).map((r) => [`${r.count}×`, r.key.slice(0, 70), fmtTokens(r.totalEstTokens)]),
        { aligns: ['r', 'l', 'r'], indent: '    ' },
      ),
    )
  }
  if (p.waste.failedCalls.length) {
    out.push('  ' + c.red(`Failed tool calls (${p.waste.failedCalls.length})`))
    out.push(
      table(
        p.waste.failedCalls.slice(0, opts.top).map((r) => [r.label.slice(0, 70), `turn ${r.turn}`, fmtTokens(r.resultEstTokens)]),
        { aligns: ['l', 'l', 'r'], indent: '    ' },
      ),
    )
  }
  out.push('  ' + c.bold('Top context consumers') + c.dim(' (largest tool results)'))
  out.push(
    table(
      p.waste.topResults.slice(0, opts.top).map((r) => [
        fmtTokens(r.resultEstTokens),
        r.phase,
        (r.failed ? c.red('✗ ') : '') + r.label.slice(0, 64),
        c.dim(`turn ${r.turn}`),
      ]),
      { headers: ['est tokens', 'phase', 'tool call', ''], aligns: ['r', 'l', 'l', 'l'], indent: '    ' },
    ),
  )
  out.push('')

  // Compacts
  if (p.compacts.length) {
    out.push(c.bold('COMPACTS'))
    for (const k of p.compacts) {
      const head = `  ${fmtTime(k.ts)} · ${k.trigger}${k.explicit ? '' : ' (inferred from context drop)'}`
      const drop =
        k.preTokens != null && k.postTokens != null
          ? ` — context ${fmtTokens(k.preTokens)} → ${fmtTokens(k.postTokens)} (dropped ~${fmtTokens(Math.max(0, k.preTokens - k.postTokens))})`
          : ''
      out.push(c.magenta(head) + c.dim(drop))
      if (k.summaryEstTokens) out.push(c.dim(`    summary kept ~${fmtTokens(k.summaryEstTokens)} est. tokens`))
      if (k.reReadFiles.length) {
        out.push(c.dim(`    lost & re-read afterwards (~${fmtTokens(k.reReadEstTokens)} est. tokens):`))
        for (const f of k.reReadFiles.slice(0, opts.top)) {
          out.push(c.dim(`      • ${f.file} (~${fmtTokens(f.reReadEstTokens)})`))
        }
      } else {
        out.push(c.dim('    nothing previously read was re-read afterwards ✓'))
      }
    }
    out.push('')
  }

  // Cache-expiry gaps
  if (p.expiryGaps.length) {
    out.push(c.bold('CACHE-EXPIRY GAPS') + c.dim('  (pauses >5m; the next call re-writes the cache)'))
    for (const gp of p.expiryGaps.slice(0, opts.top)) {
      out.push(c.dim(`  ${fmtTime(gp.ts)} after a ${fmtDuration(gp.gapMs)} pause — re-wrote ~${fmtTokens(gp.rewriteTokens)} cache tokens`))
    }
    out.push('')
  }

  // Recommendations
  if (p.recommendations.length) {
    out.push(c.bold('RECOMMENDATIONS'))
    for (const r of p.recommendations) out.push('  • ' + r)
    out.push('')
  }

  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Pretty renderer — multi-session overview
// ---------------------------------------------------------------------------

function renderOverviewPretty(profiles, opts) {
  const c = makeColor(opts.color)
  const out = []
  out.push(c.bold(`TOKEN PROFILER · ${profiles.length} session(s)`))
  out.push('')

  const rows = profiles.map((p) => {
    const g = p.totals.grand
    return [
      p.sessionId.slice(0, 8),
      p.project.slice(0, 18),
      fmtTime(p.startedAt),
      p.title.slice(0, 36),
      fmtInt(p.counts.turns),
      fmtInt(p.counts.toolCalls),
      fmtTokens(g.input),
      fmtTokens(g.cacheWrite5m + g.cacheWrite1h),
      fmtTokens(g.cacheRead),
      fmtPct(p.totals.cacheHitRate),
      fmtTokens(g.output),
      fmtTokens(p.waste.repeatedReadWasteEstTokens),
      String(p.compacts.length || ''),
      fmtCost(p.totals.estCostUsd),
    ]
  })
  const sum = (fn) => profiles.reduce((a, p) => a + fn(p), 0)
  rows.push([
    c.bold('TOTAL'), '', '', '',
    c.bold(fmtInt(sum((p) => p.counts.turns))),
    c.bold(fmtInt(sum((p) => p.counts.toolCalls))),
    c.bold(fmtTokens(sum((p) => p.totals.grand.input))),
    c.bold(fmtTokens(sum((p) => p.totals.grand.cacheWrite5m + p.totals.grand.cacheWrite1h))),
    c.bold(fmtTokens(sum((p) => p.totals.grand.cacheRead))),
    '',
    c.bold(fmtTokens(sum((p) => p.totals.grand.output))),
    c.bold(fmtTokens(sum((p) => p.waste.repeatedReadWasteEstTokens))),
    c.bold(String(sum((p) => p.compacts.length) || '')),
    c.bold(fmtCost(sum((p) => p.totals.estCostUsd))),
  ])
  out.push(
    table(rows, {
      headers: ['session', 'project', 'started', 'title', 'turns', 'tools', 'fresh', 'cache-w', 'cache-r', 'hit%', 'out', 'rewaste*', 'cmp', 'est cost'],
      aligns: ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    }),
  )
  out.push(c.dim('  *rewaste = est. tokens wasted on repeated file reads · cmp = compacts'))
  out.push('')

  // Cross-session repeated-read leaderboard
  const byFile = new Map()
  for (const p of profiles) {
    for (const r of p.waste.repeatedReads) {
      const g = byFile.get(r.key) ?? { file: r.key, reads: 0, wastedEstTokens: 0, sessions: 0 }
      g.reads += r.count
      g.wastedEstTokens += r.wastedEstTokens
      g.sessions++
      byFile.set(r.key, g)
    }
  }
  const leaderboard = [...byFile.values()].sort((a, b) => b.wastedEstTokens - a.wastedEstTokens)
  if (leaderboard.length) {
    out.push(c.bold('MOST RE-READ FILES ACROSS SESSIONS'))
    out.push(
      table(
        leaderboard.slice(0, opts.top).map((r) => [
          `${r.reads}×`,
          r.file,
          fmtTokens(r.wastedEstTokens),
          c.dim(`${r.sessions} session(s)`),
        ]),
        { headers: ['reads', 'file', 'wasted est', ''], aligns: ['r', 'l', 'r', 'l'] },
      ),
    )
    out.push('')
  }

  out.push(c.dim(`Run with --session <id> for the per-turn / phase / compact deep-dive.`))
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function mdTable(headers, rows) {
  const line = (cells) => '| ' + cells.map((x) => String(x).replace(/\|/g, '\\|')).join(' | ') + ' |'
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n')
}

function renderSessionMd(p, opts) {
  const g = p.totals.grand
  const cacheWrite = g.cacheWrite5m + g.cacheWrite1h
  const out = []
  out.push(`## Token profile · \`${p.sessionId.slice(0, 8)}\` · ${p.project}`)
  out.push('')
  out.push(`> ${p.title}`)
  out.push('')
  out.push(`*${fmtTime(p.startedAt)} → ${fmtTime(p.endedAt)} (${fmtDuration(p.durationMs)}) · ${p.models.map((m) => m.model).join(', ')} · pricing ${p.pricingVersion}*`)
  out.push('')
  out.push('### Totals')
  out.push('')
  out.push(
    mdTable(
      ['metric', 'value', 'note'],
      [
        ['API calls', fmtInt(p.counts.apiCalls), `${p.counts.sidechainApiCalls} in subagents`],
        ['User turns', fmtInt(p.counts.turns), ''],
        ['Tool calls', fmtInt(p.counts.toolCalls), p.counts.failedToolCalls ? `${p.counts.failedToolCalls} failed` : ''],
        ['Fresh input', fmtInt(g.input), ''],
        ['Cache write', fmtInt(cacheWrite), `5m ${fmtTokens(g.cacheWrite5m)} / 1h ${fmtTokens(g.cacheWrite1h)}`],
        ['Cache read', fmtInt(g.cacheRead), `hit rate ${fmtPct(p.totals.cacheHitRate)}`],
        ['Output', fmtInt(g.output), ''],
        ['Peak context', fmtInt(p.totals.peakContext), ''],
        ['Est. API cost', fmtCost(p.totals.estCostUsd), 'list-price equivalent'],
      ],
    ),
  )
  out.push('')
  if (p.turnRows.length) {
    out.push('### Per-turn breakdown')
    out.push('')
    out.push(
      mdTable(
        ['turn', 'prompt', 'tools', 'fresh', 'cache-w', 'cache-r', 'out', 'results (est.)', 'cost'],
        p.turnRows.map((r) => [
          r.turn,
          r.prompt.slice(0, 60),
          r.toolCalls,
          fmtTokens(r.usage.input),
          fmtTokens(r.usage.cacheWrite5m + r.usage.cacheWrite1h),
          fmtTokens(r.usage.cacheRead),
          fmtTokens(r.usage.output),
          fmtTokens(r.resultEstTokens),
          fmtCost(r.costUsd),
        ]),
      ),
    )
    out.push('')
  }
  if (p.phases.length) {
    out.push('### Phase breakdown')
    out.push('')
    const totalResult = p.phases.reduce((a, r) => a + r.resultEstTokens, 0) || 1
    out.push(
      mdTable(
        ['phase', 'tool calls', 'result tokens (est.)', 'share', 'output tokens'],
        p.phases.map((r) => [r.phase, r.toolCalls, fmtTokens(r.resultEstTokens), fmtPct(r.resultEstTokens / totalResult), fmtTokens(r.outputTokens)]),
      ),
    )
    out.push('')
  }
  out.push('### Waste signals')
  out.push('')
  if (p.waste.repeatedReads.length) {
    out.push(`**Repeated file reads** — est. ${fmtTokens(p.waste.repeatedReadWasteEstTokens)} wasted`)
    out.push('')
    out.push(
      mdTable(
        ['reads', 'file', 'total (est.)', 'wasted (est.)', 'turns'],
        p.waste.repeatedReads.slice(0, opts.top).map((r) => [`${r.count}×`, `\`${r.key}\``, fmtTokens(r.totalEstTokens), fmtTokens(r.wastedEstTokens), r.turns.join(', ')]),
      ),
    )
    out.push('')
  }
  if (p.waste.failedCalls.length) {
    out.push(`**Failed tool calls (${p.waste.failedCalls.length})**`)
    out.push('')
    out.push(
      mdTable(
        ['tool call', 'turn', 'result (est.)'],
        p.waste.failedCalls.slice(0, opts.top).map((r) => [r.label.slice(0, 70), r.turn, fmtTokens(r.resultEstTokens)]),
      ),
    )
    out.push('')
  }
  out.push('**Top context consumers**')
  out.push('')
  out.push(
    mdTable(
      ['est. tokens', 'phase', 'tool call', 'turn'],
      p.waste.topResults.slice(0, opts.top).map((r) => [fmtTokens(r.resultEstTokens), r.phase, r.label.slice(0, 70), r.turn]),
    ),
  )
  out.push('')
  if (p.compacts.length) {
    out.push('### Compacts')
    out.push('')
    for (const k of p.compacts) {
      out.push(`- **${fmtTime(k.ts)}** · ${k.trigger}${k.explicit ? '' : ' (inferred)'} — context ${fmtTokens(k.preTokens)} → ${fmtTokens(k.postTokens)}${k.reReadFiles.length ? `; re-read afterwards: ${k.reReadFiles.map((f) => `\`${f.file}\` (~${fmtTokens(f.reReadEstTokens)})`).join(', ')}` : ''}`)
    }
    out.push('')
  }
  if (p.recommendations.length) {
    out.push('### Recommendations')
    out.push('')
    for (const r of p.recommendations) out.push(`- ${r}`)
    out.push('')
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function discoverTranscripts(rootDir, projectFilter) {
  const found = []
  if (!fs.existsSync(rootDir)) return found
  for (const proj of fs.readdirSync(rootDir)) {
    const dir = path.join(rootDir, proj)
    let stat
    try {
      stat = fs.statSync(dir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    if (projectFilter && !proj.toLowerCase().includes(projectFilter.toLowerCase())) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.jsonl')) found.push({ file: path.join(dir, f), project: proj })
    }
  }
  return found
}

function main() {
  const opts = parseArgs(process.argv.slice(2))

  const transcripts = discoverTranscripts(opts.dir, opts.project)
  if (transcripts.length === 0) {
    console.error(`No transcripts found under ${opts.dir}${opts.project ? ` (project filter: ${opts.project})` : ''}`)
    process.exit(1)
  }

  let profiles = []
  for (const t of transcripts) {
    try {
      const p = profileTranscript(t.file, t.project)
      if (p) profiles.push(p)
    } catch (err) {
      console.error(`Failed to profile ${t.file}: ${err.message}`)
    }
  }

  if (opts.session) {
    profiles = profiles.filter(
      (p) => p.sessionId.startsWith(opts.session) || path.basename(p.file).startsWith(opts.session),
    )
    if (profiles.length === 0) {
      console.error(`No session matching "${opts.session}".`)
      process.exit(1)
    }
  }
  if (opts.since) profiles = profiles.filter((p) => (p.startedAt ?? 0) >= opts.since)
  profiles.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  if (opts.last) profiles = profiles.slice(0, opts.last)

  if (profiles.length === 0) {
    console.error('No sessions matched the given filters.')
    process.exit(1)
  }

  const detail = opts.all || profiles.length === 1

  if (opts.format === 'json') {
    const payload = detail && profiles.length === 1 ? profiles[0] : profiles
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    return
  }

  if (opts.format === 'md') {
    if (detail) {
      process.stdout.write(profiles.map((p) => renderSessionMd(p, opts)).join('\n---\n\n') + '\n')
    } else {
      // overview as markdown
      const rows = profiles.map((p) => [
        `\`${p.sessionId.slice(0, 8)}\``,
        p.project,
        fmtTime(p.startedAt),
        p.title.slice(0, 40),
        p.counts.turns,
        p.counts.toolCalls,
        fmtTokens(p.totals.grand.input),
        fmtTokens(p.totals.grand.cacheRead),
        fmtPct(p.totals.cacheHitRate),
        fmtTokens(p.totals.grand.output),
        fmtTokens(p.waste.repeatedReadWasteEstTokens),
        fmtCost(p.totals.estCostUsd),
      ])
      process.stdout.write(
        `# Token profiler — ${profiles.length} session(s)\n\n` +
          mdTable(['session', 'project', 'started', 'title', 'turns', 'tools', 'fresh', 'cache-r', 'hit%', 'out', 'rewaste', 'est cost'], rows) +
          '\n',
      )
    }
    return
  }

  if (detail) {
    process.stdout.write(profiles.map((p) => renderSessionPretty(p, opts)).join('\n' + '═'.repeat(70) + '\n\n') + '\n')
  } else {
    process.stdout.write(renderOverviewPretty(profiles, opts) + '\n')
  }
}

main()
