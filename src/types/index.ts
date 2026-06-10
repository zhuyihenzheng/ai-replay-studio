export type AgentSource = 'claude-code' | 'cursor' | 'codex'
export type SessionStatus = 'success' | 'partial' | 'failed' | 'running'
export type BillingPayer = 'subscription' | 'api' | 'extra-usage' | 'unknown' | 'mixed'
export type BillingConfidence = 'high' | 'medium' | 'low'

export type ToolCallKind =
  | 'input'
  | 'analysis'
  | 'file-op'
  | 'command'
  | 'validation'
  | 'error'
  | 'output'

export interface ToolCall {
  id: string
  kind: ToolCallKind
  title: string
  description?: string
  status: 'success' | 'failed' | 'retried' | 'skipped'
  startedAt: number
  endedAt: number
  durationMs: number
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  model?: string
  usage?: TokenUsage
  costEstimate?: CostEstimate
  billing?: BillingBreakdown
  detail?: string
  retries?: number
  parentId?: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
  webSearchRequests: number
  webFetchRequests: number
}

export interface CostEstimate {
  apiEquivalentUsd: number
  inputUsd: number
  outputUsd: number
  cacheReadUsd: number
  cacheWriteUsd: number
  toolUseUsd: number
  currency: 'USD'
  pricingSource: string
  pricingVersion: string
  confidence: BillingConfidence
}

export interface BillingBreakdown {
  payer: BillingPayer
  actualBillableUsd: number
  includedUsdEquivalent: number
  apiBilledUsd: number
  extraUsageUsd: number
  unknownUsdEquivalent: number
  confidence: BillingConfidence
  evidence: string[]
}

export interface FileChange {
  id: string
  path: string
  language?: string
  additions: number
  deletions: number
  summary: string
  diff?: string
}

export type ArtifactKind =
  | 'code'
  | 'sql'
  | 'command'
  | 'markdown'
  | 'decision'
  | 'final-answer'

export interface Artifact {
  id: string
  kind: ArtifactKind
  title: string
  body: string
  language?: string
  tags: string[]
  favorite?: boolean
  createdAt: number
}

export interface Stage {
  id: string
  name: string
  startedAt: number
  endedAt: number
  durationMs: number
  costUsd: number
  apiEquivalentUsd?: number
  billableUsd?: number
  status: 'success' | 'partial' | 'failed'
  summary: string
  toolCallIds: string[]
}

export interface SessionBilling extends BillingBreakdown {
  mode: 'subscription' | 'api' | 'extra-usage' | 'unknown'
  planName?: string
  limitHit: boolean
  limitResetText?: string
}

export interface CostBreakdown {
  stageId: string
  stageName: string
  costUsd: number
  tokens: number
}

export interface Issue {
  id: string
  severity: 'info' | 'warning' | 'error'
  title: string
  description: string
  resolved: boolean
}

// --- Token profiler (scripts/token-profiler.mjs --export) -------------------
// Exact numbers come from API usage fields; *EstTokens fields are estimated
// from text length (~4 chars/token).

export interface ProfileUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export interface ProfileTurnRow {
  turn: number
  prompt: string
  isCommand: boolean
  apiCalls: number
  toolCalls: number
  failed: number
  usage: ProfileUsage
  resultEstTokens: number
  costUsd: number
}

export interface ProfilePhaseRow {
  phase: string
  toolCalls: number
  resultEstTokens: number
  outputTokens: number
  failed: number
}

export interface ProfileDupGroup {
  key: string
  count: number
  totalEstTokens: number
  wastedEstTokens: number
  turns: number[]
}

export interface ProfileCompact {
  ts: number | null
  trigger: string
  explicit: boolean
  preTokens: number | null
  postTokens: number | null
  summaryEstTokens: number
  reReadFiles: { file: string; reReadEstTokens: number }[]
  reReadEstTokens: number
}

export interface TokenProfile {
  sessionId: string
  file: string
  project: string
  title: string
  startedAt: number | null
  endedAt: number | null
  durationMs: number
  models: { model: string; calls: number }[]
  pricingVersion: string
  counts: {
    apiCalls: number
    mainApiCalls: number
    sidechainApiCalls: number
    turns: number
    toolCalls: number
    failedToolCalls: number
  }
  totals: {
    main: ProfileUsage
    sidechain: ProfileUsage
    grand: ProfileUsage
    cacheHitRate: number
    peakContext: number
    estCostUsd: number
  }
  contextSeries: number[]
  turnRows: ProfileTurnRow[]
  phases: ProfilePhaseRow[]
  waste: {
    repeatedReads: ProfileDupGroup[]
    repeatedCommands: ProfileDupGroup[]
    repeatedGreps: ProfileDupGroup[]
    repeatedReadWasteEstTokens: number
    failedCalls: { label: string; turn: number; resultEstTokens: number }[]
    topResults: { label: string; phase: string; turn: number; resultEstTokens: number; failed: boolean }[]
  }
  compacts: ProfileCompact[]
  expiryGaps: { ts: number; gapMs: number; rewriteTokens: number }[]
  // Structured so the UI can localize via `profiler.recs.<id>`; `text` is the
  // CLI-rendered fallback. Plain strings come from older exports.
  recommendations: (string | { id: string; params: Record<string, string | number>; text: string })[]
}

export interface Session {
  id: string
  title: string
  source: AgentSource
  status: SessionStatus
  startedAt: number
  endedAt: number
  durationMs: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  usage?: TokenUsage
  costEstimate?: CostEstimate
  billing?: SessionBilling
  retryCount: number
  toolCallCount: number
  changedFileCount: number
  summary: string
  taskGoal: string
  workSummary: string
  nextSteps: string[]
  issues: Issue[]
  stages: Stage[]
  toolCalls: ToolCall[]
  files: FileChange[]
  artifacts: Artifact[]
  miniTimeline: number[] // 0..1 normalized cost-or-activity per slot
}
