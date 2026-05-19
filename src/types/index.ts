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
