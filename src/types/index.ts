export type AgentSource = 'claude-code' | 'cursor' | 'codex'
export type SessionStatus = 'success' | 'partial' | 'failed' | 'running'

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
  model?: string
  usage?: TokenUsage
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
  status: 'success' | 'partial' | 'failed'
  summary: string
  toolCallIds: string[]
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
  usage?: TokenUsage
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
  miniTimeline: number[] // 0..1 normalized activity per slot
}
