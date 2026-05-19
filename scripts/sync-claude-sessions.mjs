#!/usr/bin/env node
// Reads Claude Code transcripts from ~/.claude/projects/*/<uuid>.jsonl and
// Codex transcripts from ~/.codex/sessions/**/rollout-*.jsonl
// and writes a normalized JSON file at src/data/claudeSessions.local.json.
//
// claudeSessions.local.json is gitignored so private prompts, paths, commands,
// diffs, and tool outputs from your real sessions never end up in commits.
// The tracked stub at src/data/claudeSessions.json stays as `[]` so the app
// builds cleanly on a fresh clone (and falls back to mock sessions for demos).
//
// Mapping:
//   user (string)            -> input event (also resets a "round" / stage)
//   user (tool_result)       -> closes a previously-opened tool call
//   assistant (tool_use)     -> tool call (pending, completed when matching result arrives)
//   assistant (text)         -> output / final-answer (last one becomes the session output)
//   assistant (thinking)     -> ignored (not part of session output)
//
// Cost model:
//   - costUsd remains the API-equivalent list-price estimate for backward compatibility.
//   - costEstimate carries the model-aware estimate and cost components.
//   - billing distinguishes subscription-included value from API/extra-usage billable spend.
//
// Billing env knobs:
//   CLAUDE_REPLAY_BILLING_MODE=subscription|api|extra-usage|unknown
//   CLAUDE_REPLAY_EXTRA_USAGE=true|false|unknown
//   CLAUDE_REPLAY_PLAN=Max|Pro|Team|API

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')
const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions')
const CODEX_SESSION_INDEX = path.join(os.homedir(), '.codex', 'session_index.jsonl')
const OUT_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'src',
  'data',
  'claudeSessions.local.json',
)

// Pricing rates live in scripts/pricing-table.mjs so they can be updated in
// one place. Run `npm run sync` after any change.
import {
  PRICING_SOURCE,
  PRICING_VERSION,
  MODEL_RATES,
  DEFAULT_RATE,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
  WEB_SEARCH_USD,
} from './pricing-table.mjs'

function normalizeBillingMode(value) {
  const v = String(value || '').trim().toLowerCase().replace(/_/g, '-')
  if (['subscription', 'api', 'extra-usage', 'unknown'].includes(v)) return v
  return 'subscription'
}

function normalizeTriState(value) {
  const v = String(value || '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(v)) return true
  if (['0', 'false', 'no', 'off', 'disabled'].includes(v)) return false
  return 'unknown'
}

const BILLING_PROFILE = {
  mode: normalizeBillingMode(
    process.env.CLAUDE_REPLAY_BILLING_MODE || process.env.AI_REPLAY_BILLING_MODE,
  ),
  extraUsage: normalizeTriState(
    process.env.CLAUDE_REPLAY_EXTRA_USAGE || process.env.AI_REPLAY_EXTRA_USAGE,
  ),
  planName: process.env.CLAUDE_REPLAY_PLAN || process.env.AI_REPLAY_PLAN || 'Claude subscription',
}

function rateForModel(model) {
  if (!model || model === '<synthetic>') return { ...DEFAULT_RATE, zero: true }
  const found = MODEL_RATES.find((r) => r.match.test(model))
  return found ?? DEFAULT_RATE
}

const FILE_OP_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const COMMAND_TOOLS = new Set(['Bash'])
const ANALYSIS_TOOLS = new Set([
  'Grep',
  'Glob',
  'WebSearch',
  'WebFetch',
  'ToolSearch',
  'TodoRead',
  'mcp__plugin_telegram_telegram__list',
])
const VALIDATION_TOOLS = new Set(['Test', 'TypeCheck'])

function classifyKind(toolName) {
  if (FILE_OP_TOOLS.has(toolName)) return 'file-op'
  if (COMMAND_TOOLS.has(toolName)) return 'command'
  if (ANALYSIS_TOOLS.has(toolName)) return 'analysis'
  if (VALIDATION_TOOLS.has(toolName)) return 'validation'
  if (toolName.startsWith('Task')) return 'analysis'
  if (toolName.startsWith('mcp__')) return 'command'
  return 'command'
}

function safeStr(v, fallback = '') {
  if (v == null) return fallback
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function summarizeToolUse(name, input) {
  if (!input || typeof input !== 'object') return name
  const inp = input
  switch (name) {
    case 'Bash':
      return inp.description || (inp.command ? `Bash: ${String(inp.command).slice(0, 80)}` : 'Bash')
    case 'Read':
      return `Read ${inp.file_path ?? ''}`
    case 'Write':
      return `Write ${inp.file_path ?? ''}`
    case 'Edit':
      return `Edit ${inp.file_path ?? ''}`
    case 'MultiEdit':
      return `MultiEdit ${inp.file_path ?? ''}`
    case 'Grep':
      return `Grep ${inp.pattern ?? ''}${inp.path ? ` in ${inp.path}` : ''}`
    case 'Glob':
      return `Glob ${inp.pattern ?? ''}`
    case 'WebSearch':
      return `WebSearch: ${String(inp.query ?? '').slice(0, 80)}`
    case 'WebFetch':
      return `WebFetch ${inp.url ?? ''}`
    case 'ToolSearch':
      return `ToolSearch: ${String(inp.query ?? '').slice(0, 60)}`
    case 'Task':
      return `Subagent: ${String(inp.description ?? '').slice(0, 60)}`
    default:
      return name
  }
}

function detailFromInput(name, input) {
  if (!input || typeof input !== 'object') return ''
  switch (name) {
    case 'Bash':
      return String(input.command ?? '').slice(0, 800)
    case 'Edit':
      return [
        input.file_path ? `file: ${input.file_path}` : '',
        input.old_string ? `\n--- old (truncated)\n${String(input.old_string).slice(0, 280)}` : '',
        input.new_string ? `\n+++ new (truncated)\n${String(input.new_string).slice(0, 280)}` : '',
      ]
        .filter(Boolean)
        .join('')
    case 'Write':
      return [
        input.file_path ? `file: ${input.file_path}` : '',
        input.content ? `\n--- content (truncated)\n${String(input.content).slice(0, 480)}` : '',
      ]
        .filter(Boolean)
        .join('')
    case 'Grep':
      return safeStr({ pattern: input.pattern, path: input.path, output_mode: input.output_mode })
    case 'WebSearch':
      return String(input.query ?? '')
    case 'WebFetch':
      return `${input.url ?? ''}\n${String(input.prompt ?? '').slice(0, 200)}`
    case 'ToolSearch':
      return String(input.query ?? '')
    case 'Task':
      return `${input.description ?? ''}\n${String(input.prompt ?? '').slice(0, 280)}`
    default:
      return safeStr(input).slice(0, 500)
  }
}

function toolResultText(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  return String(content)
}

function classifyResultStatus(toolResultUserEvent) {
  const inner = toolResultUserEvent?.message?.content
  if (!Array.isArray(inner)) return 'success'
  for (const c of inner) {
    if (c?.type === 'tool_result' && c?.is_error === true) return 'failed'
  }
  return 'success'
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
  }
}

function addUsage(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    webFetchRequests: a.webFetchRequests + b.webFetchRequests,
  }
}

function usageFromAnthropic(usage) {
  if (!usage) return emptyUsage()
  const cacheCreation = usage.cache_creation ?? {}
  const explicit5m = cacheCreation.ephemeral_5m_input_tokens
  const explicit1h = cacheCreation.ephemeral_1h_input_tokens
  const fallbackCacheWrite = usage.cache_creation_input_tokens ?? 0
  const serverToolUse = usage.server_tool_use ?? {}
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWrite5mTokens:
      explicit5m == null && explicit1h == null ? fallbackCacheWrite : explicit5m ?? 0,
    cacheWrite1hTokens: explicit1h ?? 0,
    webSearchRequests: serverToolUse.web_search_requests ?? 0,
    webFetchRequests: serverToolUse.web_fetch_requests ?? 0,
  }
}

function emptyCostEstimate(confidence = 'medium') {
  return {
    apiEquivalentUsd: 0,
    inputUsd: 0,
    outputUsd: 0,
    cacheReadUsd: 0,
    cacheWriteUsd: 0,
    toolUseUsd: 0,
    currency: 'USD',
    pricingSource: PRICING_SOURCE,
    pricingVersion: PRICING_VERSION,
    confidence,
  }
}

function addCostEstimate(a, b) {
  return {
    ...a,
    apiEquivalentUsd: a.apiEquivalentUsd + b.apiEquivalentUsd,
    inputUsd: a.inputUsd + b.inputUsd,
    outputUsd: a.outputUsd + b.outputUsd,
    cacheReadUsd: a.cacheReadUsd + b.cacheReadUsd,
    cacheWriteUsd: a.cacheWriteUsd + b.cacheWriteUsd,
    toolUseUsd: a.toolUseUsd + b.toolUseUsd,
    confidence: a.confidence === 'low' || b.confidence === 'low' ? 'low' : a.confidence,
  }
}

function estimateUsageCost(model, anthropicUsage) {
  const usage = usageFromAnthropic(anthropicUsage)
  const rate = rateForModel(model)
  if (rate.zero) return { usage, costEstimate: emptyCostEstimate('high') }

  const inputUsd = (usage.inputTokens * rate.inputPerMTok) / 1_000_000
  const outputUsd = (usage.outputTokens * rate.outputPerMTok) / 1_000_000
  const cacheReadUsd =
    (usage.cacheReadTokens * rate.inputPerMTok * CACHE_READ_MULTIPLIER) / 1_000_000
  const cacheWriteUsd =
    (usage.cacheWrite5mTokens * rate.inputPerMTok * CACHE_WRITE_5M_MULTIPLIER +
      usage.cacheWrite1hTokens * rate.inputPerMTok * CACHE_WRITE_1H_MULTIPLIER) /
    1_000_000
  const toolUseUsd = usage.webSearchRequests * WEB_SEARCH_USD
  const apiEquivalentUsd = inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd + toolUseUsd

  return {
    usage,
    costEstimate: {
      apiEquivalentUsd,
      inputUsd,
      outputUsd,
      cacheReadUsd,
      cacheWriteUsd,
      toolUseUsd,
      currency: 'USD',
      pricingSource: PRICING_SOURCE,
      pricingVersion: PRICING_VERSION,
      confidence: rate === DEFAULT_RATE ? 'low' : 'medium',
    },
  }
}

function emptyBilling(payer = 'unknown', confidence = 'low') {
  return {
    payer,
    actualBillableUsd: 0,
    includedUsdEquivalent: 0,
    apiBilledUsd: 0,
    extraUsageUsd: 0,
    unknownUsdEquivalent: 0,
    confidence,
    evidence: [],
  }
}

function addBilling(a, b) {
  const payer = a.payer === b.payer ? a.payer : a.payer === 'unknown' ? b.payer : b.payer === 'unknown' ? a.payer : 'mixed'
  return {
    payer,
    actualBillableUsd: a.actualBillableUsd + b.actualBillableUsd,
    includedUsdEquivalent: a.includedUsdEquivalent + b.includedUsdEquivalent,
    apiBilledUsd: a.apiBilledUsd + b.apiBilledUsd,
    extraUsageUsd: a.extraUsageUsd + b.extraUsageUsd,
    unknownUsdEquivalent: a.unknownUsdEquivalent + b.unknownUsdEquivalent,
    confidence:
      a.confidence === 'low' || b.confidence === 'low'
        ? 'low'
        : a.confidence === 'medium' || b.confidence === 'medium'
          ? 'medium'
          : 'high',
    evidence: Array.from(new Set([...a.evidence, ...b.evidence])).slice(0, 8),
  }
}

function classifyBilling(apiEquivalentUsd, ts, limitState) {
  const evidence = []
  if (BILLING_PROFILE.mode === 'api') {
    evidence.push('Billing mode is API/pay-as-you-go.')
    return {
      ...emptyBilling('api', 'medium'),
      actualBillableUsd: apiEquivalentUsd,
      apiBilledUsd: apiEquivalentUsd,
      evidence,
    }
  }
  if (BILLING_PROFILE.mode === 'extra-usage') {
    evidence.push('Billing mode is forced to extra usage.')
    return {
      ...emptyBilling('extra-usage', 'medium'),
      actualBillableUsd: apiEquivalentUsd,
      extraUsageUsd: apiEquivalentUsd,
      evidence,
    }
  }
  if (BILLING_PROFILE.mode === 'unknown') {
    evidence.push('Billing mode is unknown.')
    return {
      ...emptyBilling('unknown', 'low'),
      unknownUsdEquivalent: apiEquivalentUsd,
      evidence,
    }
  }

  const inLimitWindow =
    limitState.limitHitAt != null &&
    ts != null &&
    ts >= limitState.limitHitAt &&
    (limitState.limitResetAt == null || ts <= limitState.limitResetAt)

  if (inLimitWindow && BILLING_PROFILE.extraUsage === true) {
    evidence.push('Claude Code limit was hit and extra usage is enabled.')
    return {
      ...emptyBilling('extra-usage', 'low'),
      actualBillableUsd: apiEquivalentUsd,
      extraUsageUsd: apiEquivalentUsd,
      evidence,
    }
  }
  if (inLimitWindow && BILLING_PROFILE.extraUsage === 'unknown') {
    evidence.push('Claude Code limit was hit; extra usage state is unknown.')
    return {
      ...emptyBilling('unknown', 'low'),
      unknownUsdEquivalent: apiEquivalentUsd,
      evidence,
    }
  }

  evidence.push('Claude Code subscription usage is treated as included plan value.')
  return {
    ...emptyBilling('subscription', inLimitWindow ? 'low' : 'medium'),
    includedUsdEquivalent: apiEquivalentUsd,
    evidence,
  }
}

function zeroPricedMessage(base) {
  return {
    model: base?.model,
    usage: emptyUsage(),
    costEstimate: emptyCostEstimate(base?.costEstimate?.confidence ?? 'medium'),
    billing: emptyBilling(base?.billing?.payer ?? 'unknown', base?.billing?.confidence ?? 'low'),
  }
}

function extractTextContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => (typeof c === 'string' ? c : c?.text || ''))
    .filter(Boolean)
    .join('\n')
}

function parseLimitResetAt(text, ts) {
  const m = text.match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!m || !ts) return null
  let hour = Number(m[1])
  const minute = Number(m[2] ?? 0)
  const ap = m[3]?.toLowerCase()
  if (ap === 'pm' && hour < 12) hour += 12
  if (ap === 'am' && hour === 12) hour = 0

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
      .formatToParts(new Date(ts))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  )
  let resetAt = Date.UTC(parts.year, parts.month - 1, parts.day, hour - 9, minute, 0)
  if (resetAt <= ts) resetAt += 24 * 60 * 60 * 1000
  return resetAt
}

function detectLimitEvent(ev, ts) {
  if (!ev.isApiErrorMessage) return null
  const text = extractTextContent(ev.content ?? ev.message?.content ?? ev.error)
  if (!/hit your limit|usage limit|resets/i.test(text)) return null
  return {
    at: ts ?? Date.now(),
    text: text.replace(/\s+/g, ' ').trim(),
    resetAt: parseLimitResetAt(text, ts),
  }
}

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(fp, predicate, out)
    else if (predicate(fp)) out.push(fp)
  }
  return out
}

function readCodexSessionIndex() {
  const map = new Map()
  if (!fs.existsSync(CODEX_SESSION_INDEX)) return map
  for (const line of fs.readFileSync(CODEX_SESSION_INDEX, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (row.id && row.thread_name) map.set(row.id, row.thread_name)
    } catch {
      // skip bad index rows
    }
  }
  return map
}

function extractCodexText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => c?.text || c?.content || '')
    .filter(Boolean)
    .join('\n')
}

function cleanCodexUserText(text) {
  const raw = String(text || '')
  const requestMarker = raw.match(/## My request for Codex:\s*([\s\S]*)$/)
  if (requestMarker) return requestMarker[1].trim()
  return raw
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
    .replace(/# Context from my IDE setup:[\s\S]*?## My request for Codex:/, '')
    .trim()
}

function deriveCodexToolTitle(name, args) {
  if (name === 'shell_command' || name === 'exec_command') {
    return args?.command ? `Command: ${String(args.command).slice(0, 96)}` : 'Command'
  }
  if (name === 'apply_patch') return 'Apply patch'
  if (name === 'update_plan') return 'Update plan'
  if (name === 'spawn_agent') return `Spawn agent${args?.agent_type ? `: ${args.agent_type}` : ''}`
  return name || 'Tool call'
}

function classifyCodexToolKind(name) {
  if (name === 'apply_patch') return 'file-op'
  if (name === 'shell_command' || name === 'exec_command') return 'command'
  if (name === 'update_plan' || name === 'spawn_agent' || name === 'wait_agent') return 'analysis'
  return 'command'
}

function codexUsageFromTokenCount(info) {
  const usage = info?.last_token_usage || info?.total_token_usage
  if (!usage) return emptyUsage()
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0),
    cacheReadTokens: usage.cached_input_tokens ?? 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
  }
}

function codexTotalUsageFromTokenCount(info) {
  const usage = info?.total_token_usage
  if (!usage) return null
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0),
    cacheReadTokens: usage.cached_input_tokens ?? 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
  }
}

function codexUsageBilling(planType) {
  const plan = planType ? `Codex ${planType}` : 'Codex'
  return {
    ...emptyBilling('unknown', 'low'),
    evidence: [
      `${plan} logs expose token usage locally, but this importer does not infer dollar billing.`,
    ],
  }
}

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') return {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function codexOutputFailed(output) {
  return /Exit code:\s*[1-9]\d*/.test(String(output || ''))
}

function decodeProjectName(folderName) {
  // ~/.claude/projects encodes paths by replacing slashes and dots with hyphens.
  // We reverse to a readable label by taking the last segment.
  const stripped = folderName.replace(/^-Users-zhengying-/, '').replace(/^-/, '')
  return stripped || folderName
}

function buildMiniTimeline(toolCalls, slots = 24) {
  if (toolCalls.length === 0) return Array.from({ length: slots }, () => 0.1)
  const start = toolCalls[0].startedAt
  const end = toolCalls[toolCalls.length - 1].endedAt
  const span = Math.max(1, end - start)
  const bins = new Array(slots).fill(0)
  for (const tc of toolCalls) {
    const idx = Math.min(slots - 1, Math.floor(((tc.startedAt - start) / span) * slots))
    bins[idx] += (tc.costUsd ?? 0) + (tc.durationMs ?? 0) / 60000
  }
  const max = Math.max(...bins, 0.0001)
  return bins.map((b) => Math.max(0.08, b / max))
}

function deriveTitle(firstUserText, sessionId) {
  if (!firstUserText) return `Session ${sessionId.slice(0, 6)}`
  const cleaned = firstUserText
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return `Session ${sessionId.slice(0, 6)}`
  return cleaned.length > 80 ? cleaned.slice(0, 80) + '…' : cleaned
}

function deriveSummary(firstUserText, lastAssistantText) {
  if (lastAssistantText) {
    const t = lastAssistantText.replace(/\s+/g, ' ').trim()
    return t.length > 220 ? t.slice(0, 220) + '…' : t
  }
  if (firstUserText) {
    const t = firstUserText.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    return t.length > 220 ? t.slice(0, 220) + '…' : t
  }
  return 'No summary available.'
}

function parseTranscript(filePath, projectFolder) {
  const text = fs.readFileSync(filePath, 'utf8')
  const lines = text.split('\n').filter(Boolean)

  const events = []
  for (const line of lines) {
    try {
      events.push(JSON.parse(line))
    } catch {
      // skip bad lines
    }
  }
  if (events.length === 0) return null

  const sessionId = events[0]?.sessionId ?? path.basename(filePath, '.jsonl')

  // Build tool calls by pairing tool_use with tool_result.
  const pendingByToolUseId = new Map()
  const toolCalls = []
  const fileEdits = new Map() // path -> { additions, deletions, summary }
  const artifacts = []
  const issues = []

  let firstUserText = ''
  let lastAssistantText = ''
  let firstTs = null
  let lastTs = null
  let totalIn = 0
  let totalOut = 0
  let totalCacheCreate = 0
  let totalCacheRead = 0
  let totalCost = 0
  let totalUsage = emptyUsage()
  let totalCostEstimate = emptyCostEstimate()
  let totalBilling = emptyBilling('unknown', 'medium')
  let retryCount = 0
  const countedMessageIds = new Set()
  const messagePricingCache = new Map() // msgId -> priced message metadata
  const visibleMessageCostAssigned = new Set()
  const limitEvents = []
  const limitState = {
    limitHitAt: null,
    limitResetAt: null,
    limitResetText: '',
  }

  // Round boundaries (each user-text starts a new round; we'll convert to stages later)
  const rounds = [] // array of { startedAt, endedAt, toolCallIds, label }
  let currentRound = null

  function newRound(ts, label) {
    if (currentRound) currentRound.endedAt = ts
    currentRound = {
      startedAt: ts,
      endedAt: ts,
      toolCallIds: [],
      label: label || `Round ${rounds.length + 1}`,
    }
    rounds.push(currentRound)
  }

  function priceAssistantMessage(msg, ts) {
    const model = msg?.model
    const { usage, costEstimate } = estimateUsageCost(model, msg?.usage)
    const billing = classifyBilling(costEstimate.apiEquivalentUsd, ts, limitState)
    return { model, usage, costEstimate, billing }
  }

  function claimVisiblePricing(msgId, pricing) {
    if (!pricing) return zeroPricedMessage()
    if (!msgId) return pricing
    if (visibleMessageCostAssigned.has(msgId)) return zeroPricedMessage(pricing)
    visibleMessageCostAssigned.add(msgId)
    return pricing
  }

  for (const ev of events) {
    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null
    if (ts) {
      if (firstTs == null) firstTs = ts
      lastTs = ts
    }

    const limitEvent = detectLimitEvent(ev, ts)
    if (limitEvent) {
      limitEvents.push(limitEvent)
      limitState.limitHitAt = limitEvent.at
      limitState.limitResetAt = limitEvent.resetAt
      limitState.limitResetText = limitEvent.text
    }

    if (ev.type === 'user') {
      const content = ev.message?.content
      if (typeof content === 'string') {
        // user text
        if (!firstUserText) firstUserText = content
        const id = `${sessionId}-input-${toolCalls.length}`
        const ttl = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'User input'
        toolCalls.push({
          id,
          kind: 'input',
          title: ttl,
          status: 'success',
          startedAt: ts ?? Date.now(),
          endedAt: ts ?? Date.now(),
          durationMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          detail: content.slice(0, 600),
        })
        newRound(ts ?? Date.now(), ttl.slice(0, 50))
        currentRound.toolCallIds.push(id)
      } else if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_result' && c?.tool_use_id) {
            const pending = pendingByToolUseId.get(c.tool_use_id)
            if (pending) {
              pending.endedAt = ts ?? pending.startedAt
              pending.durationMs = pending.endedAt - pending.startedAt
              const isErr = c.is_error === true
              pending.status = isErr ? 'failed' : 'success'
              if (isErr) {
                retryCount += 1
                issues.push({
                  id: `${sessionId}-iss-${issues.length}`,
                  severity: 'warning',
                  title: `Tool failure: ${pending.title}`,
                  description: toolResultText(c.content).slice(0, 240),
                  resolved: false,
                })
              }
              pendingByToolUseId.delete(c.tool_use_id)
            }
          }
        }
      }
    } else if (ev.type === 'assistant') {
      const msgId = ev.message?.id
      const usage = ev.message?.usage
      const isFirstSeenMsg = msgId ? !countedMessageIds.has(msgId) : true
      if (msgId) countedMessageIds.add(msgId)
      if (usage && isFirstSeenMsg) {
        totalIn += usage.input_tokens ?? 0
        totalOut += usage.output_tokens ?? 0
        totalCacheCreate += usage.cache_creation_input_tokens ?? 0
        totalCacheRead += usage.cache_read_input_tokens ?? 0
      }

      let messagePricing
      if (msgId && messagePricingCache.has(msgId)) {
        messagePricing = messagePricingCache.get(msgId)
      } else {
        messagePricing = priceAssistantMessage(ev.message, ts)
        if (msgId) messagePricingCache.set(msgId, messagePricing)
      }
      if (usage && isFirstSeenMsg) {
        totalUsage = addUsage(totalUsage, messagePricing.usage)
        totalCostEstimate = addCostEstimate(totalCostEstimate, messagePricing.costEstimate)
        totalBilling = addBilling(totalBilling, messagePricing.billing)
        totalCost += messagePricing.costEstimate.apiEquivalentUsd
      }

      const content = ev.message?.content
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use') {
            const visiblePricing = claimVisiblePricing(msgId, messagePricing)
            const name = c.name
            const kind = classifyKind(name)
            const callId = c.id || `${sessionId}-tc-${toolCalls.length}`
            const tc = {
              id: callId,
              kind,
              title: summarizeToolUse(name, c.input),
              status: 'success', // optimistic; updated on tool_result
              startedAt: ts ?? Date.now(),
              endedAt: ts ?? Date.now(),
              durationMs: 0,
              tokensIn:
                visiblePricing.usage.inputTokens +
                visiblePricing.usage.cacheReadTokens +
                visiblePricing.usage.cacheWrite5mTokens +
                visiblePricing.usage.cacheWrite1hTokens,
              tokensOut: visiblePricing.usage.outputTokens,
              costUsd: visiblePricing.costEstimate.apiEquivalentUsd,
              model: visiblePricing.model,
              usage: visiblePricing.usage,
              costEstimate: visiblePricing.costEstimate,
              billing: visiblePricing.billing,
              detail: detailFromInput(name, c.input).slice(0, 800),
            }
            toolCalls.push(tc)
            pendingByToolUseId.set(callId, tc)
            if (currentRound) currentRound.toolCallIds.push(callId)

            // file change tracking
            if (name === 'Edit' || name === 'MultiEdit') {
              const fp = c.input?.file_path
              if (fp) {
                const old = String(c.input?.old_string ?? '')
                const neu = String(c.input?.new_string ?? '')
                const adds = neu.split('\n').length
                const dels = old.split('\n').length
                const entry =
                  fileEdits.get(fp) || { additions: 0, deletions: 0, summary: '', diffs: [] }
                entry.additions += adds
                entry.deletions += dels
                if (entry.diffs.length < 6 && (old || neu)) {
                  entry.diffs.push(
                    `@@ edit ${entry.diffs.length + 1}\n${old
                      .split('\n')
                      .map((l) => '-' + l)
                      .join('\n')}\n${neu
                      .split('\n')
                      .map((l) => '+' + l)
                      .join('\n')}`,
                  )
                }
                if (!entry.summary) entry.summary = `Modified by ${name}.`
                fileEdits.set(fp, entry)
              }
            }
            if (name === 'Write') {
              const fp = c.input?.file_path
              if (fp) {
                const content2 = String(c.input?.content ?? '')
                const adds = content2.split('\n').length
                const entry =
                  fileEdits.get(fp) || { additions: 0, deletions: 0, summary: '', diffs: [] }
                entry.additions += adds
                if (entry.diffs.length < 4) {
                  entry.diffs.push(
                    content2
                      .split('\n')
                      .slice(0, 40)
                      .map((l) => '+' + l)
                      .join('\n'),
                  )
                }
                if (!entry.summary) entry.summary = 'Created/overwritten via Write.'
                fileEdits.set(fp, entry)
              }
            }
          } else if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            const visiblePricing = claimVisiblePricing(msgId, messagePricing)
            lastAssistantText = c.text
            // Add output event (we'll keep the last one as the final answer)
            const id = `${sessionId}-out-${toolCalls.length}`
            toolCalls.push({
              id,
              kind: ev.isApiErrorMessage ? 'error' : 'output',
              title: c.text.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Assistant message',
              status: ev.isApiErrorMessage ? 'failed' : 'success',
              startedAt: ts ?? Date.now(),
              endedAt: ts ?? Date.now(),
              durationMs: 0,
              tokensIn:
                visiblePricing.usage.inputTokens +
                visiblePricing.usage.cacheReadTokens +
                visiblePricing.usage.cacheWrite5mTokens +
                visiblePricing.usage.cacheWrite1hTokens,
              tokensOut: visiblePricing.usage.outputTokens,
              costUsd: visiblePricing.costEstimate.apiEquivalentUsd,
              model: visiblePricing.model,
              usage: visiblePricing.usage,
              costEstimate: visiblePricing.costEstimate,
              billing: visiblePricing.billing,
              detail: c.text.slice(0, 800),
            })
            if (currentRound) currentRound.toolCallIds.push(id)
          }
        }
      }
    }
  }

  // Close any pending tool calls that never got a result (treat as success at last-known time)
  for (const tc of pendingByToolUseId.values()) {
    if (!tc.durationMs && lastTs) {
      tc.endedAt = lastTs
      tc.durationMs = Math.max(0, lastTs - tc.startedAt)
    }
  }

  if (toolCalls.length === 0) return null

  const startedAt = firstTs ?? toolCalls[0].startedAt
  const endedAt = lastTs ?? toolCalls[toolCalls.length - 1].endedAt
  const durationMs = endedAt - startedAt

  // One stage per user turn — collapsing distorts the labels (the first
  // turn's prompt would stand in for unrelated tail turns) and the trace UI
  // already scrolls vertically, so there is no visual reason to compress.
  const stages = []
  for (const r of rounds) {
    const ids = new Set(r.toolCallIds)
    const calls = toolCalls.filter((tc) => ids.has(tc.id))
    const stageCost = calls.reduce((a, tc) => a + (tc.costUsd ?? 0), 0)
    const stageBillable = calls.reduce((a, tc) => a + (tc.billing?.actualBillableUsd ?? 0), 0)
    const failed = calls.filter((tc) => tc.status === 'failed').length
    stages.push({
      id: `${sessionId}-st-${stages.length}`,
      name: r.label || `Stage ${stages.length + 1}`,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationMs: Math.max(0, r.endedAt - r.startedAt),
      costUsd: stageCost,
      apiEquivalentUsd: stageCost,
      billableUsd: stageBillable,
      status: failed > 0 ? 'partial' : 'success',
      summary:
        calls.length === 0
          ? 'No tool activity recorded for this stage.'
          : `${calls.length} step${calls.length !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.`,
      toolCallIds: [...ids],
    })
  }
  if (stages.length === 0) {
    stages.push({
      id: `${sessionId}-st-0`,
      name: 'Execution',
      startedAt,
      endedAt,
      durationMs,
      costUsd: totalCost,
      apiEquivalentUsd: totalCost,
      billableUsd: totalBilling.actualBillableUsd,
      status: retryCount > 0 ? 'partial' : 'success',
      summary: `${toolCalls.length} steps recorded.`,
      toolCallIds: toolCalls.map((tc) => tc.id),
    })
  }

  // Files
  const files = []
  let fIdx = 0
  for (const [fp, entry] of fileEdits.entries()) {
    const lang = (() => {
      const ext = path.extname(fp).slice(1)
      const map = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        sql: 'sql',
        md: 'markdown',
        py: 'python',
        json: 'json',
        css: 'css',
        html: 'html',
      }
      return map[ext] ?? ext ?? undefined
    })()
    files.push({
      id: `${sessionId}-f-${fIdx++}`,
      path: fp,
      language: lang,
      additions: entry.additions,
      deletions: entry.deletions,
      summary: entry.summary || 'Edited.',
      diff: entry.diffs.join('\n\n').slice(0, 4000) || undefined,
    })
  }

  // Artifacts: take final assistant text as final-answer; collect bash commands
  if (lastAssistantText) {
    artifacts.push({
      id: `${sessionId}-a-final`,
      kind: 'final-answer',
      title: 'Assistant final message',
      body: lastAssistantText.slice(0, 4000),
      tags: ['summary'],
      favorite: true,
      createdAt: endedAt,
    })
  }
  // Pull a couple of representative Bash commands as command artifacts
  const bashCmds = toolCalls
    .filter((tc) => tc.kind === 'command' && tc.detail)
    .slice(0, 3)
  for (const tc of bashCmds) {
    artifacts.push({
      id: `${sessionId}-a-${artifacts.length}`,
      kind: 'command',
      title: tc.title.slice(0, 80),
      body: tc.detail,
      tags: ['bash'],
      createdAt: tc.startedAt,
    })
  }

  if (limitEvents.length > 0) {
    const latestLimit = limitEvents[limitEvents.length - 1]
    issues.push({
      id: `${sessionId}-iss-${issues.length}`,
      severity: 'warning',
      title: 'Claude usage limit hit',
      description: latestLimit.text || 'Claude Code reported that the usage limit was hit.',
      resolved: false,
    })
  }

  // Status
  let status = 'success'
  if (retryCount > 5) status = 'failed'
  else if (retryCount > 0) status = 'partial'
  else if (limitEvents.length > 0) status = 'partial'
  // If session has no assistant text and at least one failed call, mark as failed
  if (!lastAssistantText && retryCount > 0) status = 'failed'

  // Source
  // Claude Code stores transcripts under ~/.claude/projects, so source is always claude-code
  const source = 'claude-code'

  // Title / summary
  const title = deriveTitle(firstUserText, sessionId)
  const summary = deriveSummary(firstUserText, lastAssistantText)
  const sessionBilling = {
    ...totalBilling,
    mode: BILLING_PROFILE.mode,
    planName: BILLING_PROFILE.planName,
    limitHit: limitEvents.length > 0,
    limitResetText: limitState.limitResetText || undefined,
  }

  return {
    id: sessionId,
    title,
    source,
    status,
    startedAt,
    endedAt,
    durationMs,
    tokensIn: totalIn + totalCacheCreate + totalCacheRead,
    tokensOut: totalOut,
    costUsd: totalCost,
    usage: totalUsage,
    costEstimate: totalCostEstimate,
    billing: sessionBilling,
    retryCount,
    toolCallCount: toolCalls.length,
    changedFileCount: files.length,
    summary,
    taskGoal: firstUserText
      ? firstUserText.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240)
      : 'No explicit task goal recorded.',
    workSummary: deriveSummary(firstUserText, lastAssistantText),
    nextSteps: ['Review the artifacts and file changes above for next actions.'],
    issues,
    stages,
    toolCalls,
    files,
    artifacts,
    miniTimeline: buildMiniTimeline(toolCalls),
    _project: decodeProjectName(projectFolder),
  }
}

function parseCodexTranscript(filePath, titleIndex) {
  const text = fs.readFileSync(filePath, 'utf8')
  const lines = text.split('\n').filter(Boolean)
  const events = []
  for (const line of lines) {
    try {
      events.push(JSON.parse(line))
    } catch {
      // skip bad lines
    }
  }
  if (events.length === 0) return null

  const metaEvent = events.find((ev) => ev.type === 'session_meta')
  const meta = metaEvent?.payload ?? {}
  const sessionId = meta.id ?? path.basename(filePath, '.jsonl').replace(/^rollout-[^-]+-/, '')
  const cwd = meta.cwd ?? ''

  const toolCalls = []
  const artifacts = []
  const issues = []
  const pendingByCallId = new Map()
  const rounds = []
  let currentRound = null
  let firstUserText = ''
  let lastAssistantText = ''
  let firstTs = null
  let lastTs = null
  let model = meta.model ?? ''
  let planType = null
  let retryCount = 0
  let finalUsage = emptyUsage()
  let latestUsage = emptyUsage()
  const seenMessages = new Set()

  function eventTs(ev) {
    return ev.timestamp ? new Date(ev.timestamp).getTime() : Date.now()
  }

  function newRound(ts, label) {
    if (currentRound) currentRound.endedAt = ts
    currentRound = {
      startedAt: ts,
      endedAt: ts,
      toolCallIds: [],
      label: label || `Round ${rounds.length + 1}`,
    }
    rounds.push(currentRound)
  }

  function pushCall(call) {
    toolCalls.push(call)
    if (currentRound) currentRound.toolCallIds.push(call.id)
  }

  function claimMessage(role, msg, ts) {
    const key = `${role}:${ts}:${String(msg || '').replace(/\s+/g, ' ').slice(0, 220)}`
    if (seenMessages.has(key)) return false
    seenMessages.add(key)
    return true
  }

  for (const ev of events) {
    const ts = eventTs(ev)
    if (firstTs == null) firstTs = ts
    lastTs = ts

    if (ev.type === 'turn_context') {
      if (ev.payload?.model) model = ev.payload.model
      continue
    }

    if (ev.type === 'event_msg' && ev.payload?.type === 'token_count') {
      const usage = codexTotalUsageFromTokenCount(ev.payload.info)
      if (usage) finalUsage = usage
      latestUsage = codexUsageFromTokenCount(ev.payload.info)
      if (ev.payload.rate_limits?.plan_type) planType = ev.payload.rate_limits.plan_type
      continue
    }

    if (ev.type === 'event_msg' && ev.payload?.type === 'user_message') {
      const cleaned = cleanCodexUserText(ev.payload.message)
      if (!cleaned) continue
      if (!claimMessage('user', cleaned, ts)) continue
      if (!firstUserText) firstUserText = cleaned
      const id = `${sessionId}-input-${toolCalls.length}`
      const title = cleaned.replace(/\s+/g, ' ').slice(0, 80) || 'User input'
      const call = {
        id,
        kind: 'input',
        title,
        status: 'success',
        startedAt: ts,
        endedAt: ts,
        durationMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        model,
        usage: emptyUsage(),
        costEstimate: emptyCostEstimate('low'),
        billing: codexUsageBilling(planType),
        detail: cleaned.slice(0, 900),
      }
      pushCall(call)
      newRound(ts, title.slice(0, 50))
      currentRound.toolCallIds.push(id)
      continue
    }

    if (ev.type === 'event_msg' && ev.payload?.type === 'agent_message') {
      const msg = String(ev.payload.message || '').trim()
      if (!msg) continue
      if (!claimMessage('assistant', msg, ts)) continue
      lastAssistantText = msg
      pushCall({
        id: `${sessionId}-out-${toolCalls.length}`,
        kind: 'output',
        title: msg.replace(/\s+/g, ' ').slice(0, 80) || 'Assistant message',
        status: 'success',
        startedAt: ts,
        endedAt: ts,
        durationMs: 0,
        tokensIn: latestUsage.inputTokens + latestUsage.cacheReadTokens,
        tokensOut: latestUsage.outputTokens,
        costUsd: 0,
        model,
        usage: latestUsage,
        costEstimate: emptyCostEstimate('low'),
        billing: codexUsageBilling(planType),
        detail: msg.slice(0, 1200),
      })
      continue
    }

    if (ev.type !== 'response_item') continue
    const payload = ev.payload ?? {}

    if (payload.type === 'message') {
      const role = payload.role
      const msgText = role === 'user' ? cleanCodexUserText(extractCodexText(payload.content)) : extractCodexText(payload.content)
      if (!msgText) continue
      if (role === 'user') {
        if (!firstUserText && !msgText.startsWith('<environment_context>')) firstUserText = msgText
        if (msgText.startsWith('<environment_context>')) continue
        if (!claimMessage('user', msgText, ts)) continue
        const id = `${sessionId}-input-${toolCalls.length}`
        const title = msgText.replace(/\s+/g, ' ').slice(0, 80) || 'User input'
        pushCall({
          id,
          kind: 'input',
          title,
          status: 'success',
          startedAt: ts,
          endedAt: ts,
          durationMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          model,
          usage: emptyUsage(),
          costEstimate: emptyCostEstimate('low'),
          billing: codexUsageBilling(planType),
          detail: msgText.slice(0, 900),
        })
        newRound(ts, title.slice(0, 50))
        currentRound.toolCallIds.push(id)
      } else if (role === 'assistant') {
        if (!claimMessage('assistant', msgText, ts)) continue
        lastAssistantText = msgText
        pushCall({
          id: `${sessionId}-out-${toolCalls.length}`,
          kind: 'output',
          title: msgText.replace(/\s+/g, ' ').slice(0, 80) || 'Assistant message',
          status: 'success',
          startedAt: ts,
          endedAt: ts,
          durationMs: 0,
          tokensIn: latestUsage.inputTokens + latestUsage.cacheReadTokens,
          tokensOut: latestUsage.outputTokens,
          costUsd: 0,
          model,
          usage: latestUsage,
          costEstimate: emptyCostEstimate('low'),
          billing: codexUsageBilling(planType),
          detail: msgText.slice(0, 1200),
        })
      }
      continue
    }

    if (payload.type === 'function_call') {
      const args = parseJsonMaybe(payload.arguments)
      const callId = payload.call_id || `${sessionId}-tool-${toolCalls.length}`
      const detail = args?.command || payload.arguments || ''
      const tc = {
        id: callId,
        kind: classifyCodexToolKind(payload.name),
        title: deriveCodexToolTitle(payload.name, args),
        status: 'success',
        startedAt: ts,
        endedAt: ts,
        durationMs: 0,
        tokensIn: latestUsage.inputTokens + latestUsage.cacheReadTokens,
        tokensOut: latestUsage.outputTokens,
        costUsd: 0,
        model,
        usage: latestUsage,
        costEstimate: emptyCostEstimate('low'),
        billing: codexUsageBilling(planType),
        detail: String(detail).slice(0, 1000),
      }
      pushCall(tc)
      pendingByCallId.set(callId, tc)
      continue
    }

    if (payload.type === 'function_call_output') {
      const pending = pendingByCallId.get(payload.call_id)
      if (!pending) continue
      pending.endedAt = ts
      pending.durationMs = Math.max(0, pending.endedAt - pending.startedAt)
      pending.detail = [pending.detail, String(payload.output || '').slice(0, 1200)]
        .filter(Boolean)
        .join('\n\n--- output ---\n')
      if (codexOutputFailed(payload.output)) {
        pending.status = 'failed'
        retryCount += 1
        issues.push({
          id: `${sessionId}-iss-${issues.length}`,
          severity: 'warning',
          title: `Tool failure: ${pending.title}`,
          description: String(payload.output || '').slice(0, 240),
          resolved: false,
        })
      }
      pendingByCallId.delete(payload.call_id)
    }
  }

  if (toolCalls.length === 0) return null

  const startedAt = firstTs ?? toolCalls[0].startedAt
  const endedAt = lastTs ?? toolCalls[toolCalls.length - 1].endedAt
  const durationMs = Math.max(0, endedAt - startedAt)
  const modelLabel = model || 'codex'
  const totalTokensIn = finalUsage.inputTokens + finalUsage.cacheReadTokens
  const totalTokensOut = finalUsage.outputTokens

  const stages = []
  for (const r of rounds.length ? rounds : [{ label: 'Conversation', startedAt, endedAt, toolCallIds: toolCalls.map((tc) => tc.id) }]) {
    const ids = new Set(r.toolCallIds)
    const calls = toolCalls.filter((tc) => ids.has(tc.id))
    const failed = calls.filter((tc) => tc.status === 'failed').length
    stages.push({
      id: `${sessionId}-st-${stages.length}`,
      name: r.label || `Stage ${stages.length + 1}`,
      startedAt: r.startedAt,
      endedAt: r.endedAt ?? endedAt,
      durationMs: Math.max(0, (r.endedAt ?? endedAt) - r.startedAt),
      costUsd: 0,
      apiEquivalentUsd: 0,
      billableUsd: 0,
      status: failed > 0 ? 'partial' : 'success',
      summary: `${calls.length} Codex event${calls.length !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.`,
      toolCallIds: [...ids],
    })
  }

  const finalTitle = titleIndex.get(sessionId) || deriveTitle(firstUserText, sessionId)
  const summary = deriveSummary(firstUserText, lastAssistantText)
  const commandArtifacts = toolCalls.filter((tc) => tc.kind === 'command' && tc.detail).slice(0, 3)
  for (const tc of commandArtifacts) {
    artifacts.push({
      id: `${sessionId}-a-${artifacts.length}`,
      kind: 'command',
      title: tc.title.slice(0, 80),
      body: tc.detail,
      tags: ['codex', 'command'],
      createdAt: tc.startedAt,
    })
  }
  if (lastAssistantText) {
    artifacts.push({
      id: `${sessionId}-a-final`,
      kind: 'final-answer',
      title: 'Codex final message',
      body: lastAssistantText.slice(0, 4000),
      tags: ['codex', 'summary'],
      favorite: true,
      createdAt: endedAt,
    })
  }

  const billing = {
    ...codexUsageBilling(planType),
    mode: 'unknown',
    planName: planType ? `Codex ${planType}` : 'Codex',
    limitHit: false,
  }
  const costEstimate = {
    ...emptyCostEstimate('low'),
    pricingSource: 'codex-local-token-log',
    pricingVersion: 'unknown',
  }

  return {
    id: `codex-${sessionId}`,
    title: finalTitle,
    source: 'codex',
    status: retryCount > 0 ? 'partial' : 'success',
    startedAt,
    endedAt,
    durationMs,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    costUsd: 0,
    usage: finalUsage,
    costEstimate,
    billing,
    retryCount,
    toolCallCount: toolCalls.length,
    changedFileCount: 0,
    summary,
    taskGoal: firstUserText
      ? firstUserText.replace(/\s+/g, ' ').trim().slice(0, 240)
      : 'No explicit task goal recorded.',
    workSummary: summary,
    nextSteps: ['Review the Codex conversation and command outputs for next actions.'],
    issues,
    stages,
    toolCalls,
    files: [],
    artifacts,
    miniTimeline: buildMiniTimeline(toolCalls),
    _project: cwd,
    _model: modelLabel,
  }
}

function main() {
  const sessions = []
  let totalLines = 0

  if (fs.existsSync(PROJECTS_DIR)) {
    const projects = fs.readdirSync(PROJECTS_DIR).filter((f) =>
      fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory(),
    )
    for (const proj of projects) {
      const dir = path.join(PROJECTS_DIR, proj)
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      for (const f of files) {
        const fp = path.join(dir, f)
        const lc = fs.readFileSync(fp, 'utf8').split('\n').length
        totalLines += lc
        try {
          const s = parseTranscript(fp, proj)
          if (s) sessions.push(s)
        } catch (err) {
          console.warn(`Failed to parse Claude transcript ${fp}: ${err.message}`)
        }
      }
    }
  } else {
    console.warn(`No Claude Code projects dir at ${PROJECTS_DIR}`)
  }

  const codexTitleIndex = readCodexSessionIndex()
  const codexFiles = walkFiles(CODEX_SESSIONS_DIR, (fp) => fp.endsWith('.jsonl'))
  for (const fp of codexFiles) {
    const lc = fs.readFileSync(fp, 'utf8').split('\n').length
    totalLines += lc
    try {
      const s = parseCodexTranscript(fp, codexTitleIndex)
      if (s) sessions.push(s)
    } catch (err) {
      console.warn(`Failed to parse Codex transcript ${fp}: ${err.message}`)
    }
  }

  // Sort newest first
  sessions.sort((a, b) => b.startedAt - a.startedAt)

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(sessions, null, 2))
  console.log(
    `Wrote ${sessions.length} sessions (${totalLines} JSONL lines parsed; ${codexFiles.length} Codex files scanned) to ${OUT_FILE}`,
  )
}

main()
