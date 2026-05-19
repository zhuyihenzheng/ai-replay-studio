import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { SessionShell, SESSION_MAX_WIDTH, SESSION_GUTTER } from '@/components/SessionShell'
import { EmptyState } from '@/components/EmptyState'
import { formatDuration, formatElapsed, formatTokens } from '@/lib/format'
import { useT } from '@/i18n'
import type { TFunction } from '@/i18n'
import type { Session, ToolCall, ToolCallKind } from '@/types'

// Muted status palette — designed to coexist on the bar chart without competing.
// Kept distinct on purpose: failed reads red, retried reads gold — they must
// not be confusable on a 6px dot or a thin bar segment.
const STATUS_COLOR: Record<string, string> = {
  success: '#5e8b6a',
  failed: '#d23f57',
  retried: '#b5801a',
  skipped: '#94a3b8',
  partial: '#b5801a',
}

const KIND_LABEL_KEY: Record<ToolCallKind, string> = {
  input: 'graph.kind.input',
  analysis: 'graph.kind.analysis',
  'file-op': 'graph.kind.file_op',
  command: 'graph.kind.command',
  validation: 'graph.kind.validation',
  error: 'graph.kind.error',
  output: 'graph.kind.output',
}

const IMPORTANT_KINDS: ToolCallKind[] = ['input', 'output', 'analysis']

function retriesOf(call: ToolCall): number {
  if (call.status === 'retried') return Math.max(1, call.retries ?? 1)
  return call.retries ?? 0
}

// The sync script fills empty summaries with a "N steps, M failed." placeholder.
// That just duplicates the step-count meta + failure pill, so don't render it.
const PLACEHOLDER_SUMMARY = /^\s*\d+\s+steps?(\s*,\s*\d+\s+failed)?\s*\.?\s*$/i
function realSummary(s?: string): string | undefined {
  const v = s?.trim()
  return v && !PLACEHOLDER_SUMMARY.test(v) ? v : undefined
}

interface StageGroup {
  id: string
  name: string
  status: string
  startedAt: number
  durationMs: number
  summary?: string
  isUnstaged: boolean
  calls: ToolCall[]
  widthPct: number
  idx: number
}

function buildGroups(session: Session): StageGroup[] {
  const callById = new Map(session.toolCalls.map((c) => [c.id, c]))
  const sessionStart = session.startedAt
  // Segment width is proportional to step count, not duration: durations are
  // unreliable for long/idle-heavy sessions (a 40-step stage can log 0 ms),
  // while step counts always exist and reflect where the work actually was.
  const totalSteps = Math.max(session.toolCalls.length, 1)
  const assigned = new Set<string>()

  const raw: Omit<StageGroup, 'idx'>[] = []

  for (const stage of session.stages ?? []) {
    const calls = stage.toolCallIds
      .map((cid) => callById.get(cid))
      .filter((c): c is ToolCall => Boolean(c))
      .sort((a, b) => a.startedAt - b.startedAt)
    calls.forEach((c) => assigned.add(c.id))
    raw.push(makeGroup(stage.id, stage.name, stage.status, stage.startedAt, stage.durationMs, stage.summary, false, calls, totalSteps))
  }

  const unassigned = session.toolCalls
    .filter((c) => !assigned.has(c.id))
    .sort((a, b) => a.startedAt - b.startedAt)
  if (unassigned.length > 0 || raw.length === 0) {
    const calls = raw.length === 0 ? [...session.toolCalls].sort((a, b) => a.startedAt - b.startedAt) : unassigned
    const startedAt = calls.length ? Math.min(...calls.map((c) => c.startedAt)) : sessionStart
    const endedAt = calls.length ? Math.max(...calls.map((c) => c.endedAt)) : sessionStart
    raw.push(
      makeGroup('__unstaged__', '', 'success', startedAt, Math.max(endedAt - startedAt, 0), undefined, true, calls, totalSteps),
    )
  }

  return raw.map((g, idx) => ({ ...g, idx }))
}

function makeGroup(
  id: string,
  name: string,
  status: string,
  startedAt: number,
  durationMs: number,
  summary: string | undefined,
  isUnstaged: boolean,
  calls: ToolCall[],
  totalSteps: number,
): Omit<StageGroup, 'idx'> {
  return {
    id,
    name,
    status,
    startedAt,
    durationMs,
    summary,
    isUnstaged,
    calls,
    widthPct: calls.length / totalSteps,
  }
}

export function ToolGraphPage() {
  const { id = '' } = useParams()
  const session = useAppStore((s) => s.getSession(id))
  const t = useT()
  const [activeStageId, setActiveStageId] = useState<string | null>(null)

  const groups = useMemo(
    () => (session && session.toolCalls.length > 0 ? buildGroups(session) : null),
    [session],
  )

  const selectStage = useCallback((next: string | null) => {
    setActiveStageId(next)
    if (next) {
      setTimeout(() => {
        document
          .getElementById(`stage-${next}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 0)
    }
  }, [])

  // Deep link from the Cost page's "top expensive steps": ?call=<id>
  // opens and scrolls to the stage containing that step.
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const callId = searchParams.get('call')
    if (!callId || !groups) return
    const g = groups.find((grp) => grp.calls.some((c) => c.id === callId))
    if (!g) return
    setActiveStageId(g.id)
    const timer = setTimeout(() => {
      document
        .getElementById(`stage-${g.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
    return () => clearTimeout(timer)
  }, [searchParams, groups])

  if (!session) return <EmptyState title={t('graph.empty_session_not_found')} />
  if (!groups) {
    return (
      <SessionShell session={session}>
        <EmptyState title={t('graph.no_tool_calls')} />
      </SessionShell>
    )
  }

  return (
    <SessionShell session={session}>
      <StepList
        session={session}
        groups={groups}
        activeStageId={activeStageId}
        onSelectStage={selectStage}
        t={t}
      />
    </SessionShell>
  )
}

function StepList({
  session,
  groups,
  activeStageId,
  onSelectStage,
  t,
}: {
  session: Session
  groups: StageGroup[]
  activeStageId: string | null
  onSelectStage: (id: string | null) => void
  t: TFunction
}) {
  const tok = (c?: ToolCall) => (c ? (c.tokensIn ?? 0) + (c.tokensOut ?? 0) : 0)
  const stageTok = (g: StageGroup) => g.calls.reduce((a, c) => a + tok(c), 0)
  const maxStageTok = Math.max(...groups.map(stageTok), 1)
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: `16px ${SESSION_GUTTER}px ${SESSION_GUTTER}px` }}>
      <div
        className="card"
        style={{ maxWidth: SESSION_MAX_WIDTH, margin: '0 auto', padding: '6px 22px' }}
      >
        {groups.map((stage, i) => {
          const isActive = activeStageId === stage.id
          const failedCount = stage.calls.filter((c) => c.status === 'failed').length
          const retryCount = stage.calls.filter((c) => retriesOf(c) > 0).length
          const statusColor = STATUS_COLOR[stage.status] ?? '#94a3b8'
          const isLast = i === groups.length - 1
          const stTok = stageTok(stage)
          const tokPct = (stTok / maxStageTok) * 100

          return (
            <section
              key={stage.id}
              id={`stage-${stage.id}`}
              style={{
                borderBottom: isLast ? 'none' : '1px solid #ece8de',
                paddingTop: 18,
                paddingBottom: isActive ? 24 : 18,
                scrollMarginTop: 24,
              }}
            >
              <button
                type="button"
                onClick={() => onSelectStage(isActive ? null : stage.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  padding: '4px 0',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    fontFamily: '"Source Serif 4", serif',
                    fontSize: 32,
                    fontWeight: 600,
                    color: isActive ? '#0f0d0a' : '#dcd6c8',
                    lineHeight: 1,
                    letterSpacing: '-0.02em',
                    minWidth: 42,
                    paddingTop: 1,
                    flexShrink: 0,
                    transition: 'color 0.15s',
                  }}
                >
                  {String(stage.idx + 1).padStart(2, '0')}
                </span>

                <div
                  style={{ width: 84, flexShrink: 0, paddingTop: 9 }}
                  title={t('session_card.tokens', { n: formatTokens(stTok) })}
                >
                  <div
                    style={{
                      height: 6,
                      background: '#efece5',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(2, tokPct)}%`,
                        height: '100%',
                        background: statusColor,
                        borderRadius: 3,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span
                      style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }}
                    />
                    <h2
                      style={{
                        fontFamily: '"Source Serif 4", serif',
                        fontSize: 18,
                        fontWeight: 600,
                        color: '#0f0d0a',
                        lineHeight: 1.2,
                      }}
                    >
                      {stage.isUnstaged ? t('graph.unstaged_section') : stage.name}
                    </h2>
                    {(failedCount > 0 || retryCount > 0) && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: STATUS_COLOR.retried,
                          background: '#fdf4e6',
                          padding: '1px 7px',
                          borderRadius: 9999,
                          flexShrink: 0,
                        }}
                      >
                        {failedCount > 0 ? `${failedCount}f` : ''}
                        {failedCount > 0 && retryCount > 0 ? ' · ' : ''}
                        {retryCount > 0 ? `↺${retryCount}` : ''}
                      </span>
                    )}
                  </div>
                  {realSummary(stage.summary) && (
                    <p
                      style={{
                        fontSize: 13,
                        color: '#8d836b',
                        lineHeight: 1.5,
                        overflow: isActive ? 'visible' : 'hidden',
                        display: isActive ? 'block' : '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {realSummary(stage.summary)}
                    </p>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 18,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 12,
                    color: '#5e5644',
                    alignItems: 'center',
                    flexShrink: 0,
                    paddingTop: 4,
                    minWidth: 210,
                    justifyContent: 'flex-end',
                  }}
                >
                  <span style={{ color: '#8d836b' }}>
                    {t('graph.timeline2.n_steps', { n: stage.calls.length })}
                  </span>
                  <span style={{ color: '#0f0d0a' }}>
                    {t('session_card.tokens', { n: formatTokens(stTok) })}
                  </span>
                  <span>{formatDuration(stage.durationMs)}</span>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 6,
                      background: '#faf8f3',
                      color: '#8d836b',
                      transition: 'transform 0.2s',
                      transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                  >
                    <ChevronRight size={12} strokeWidth={2.5} />
                  </span>
                </div>
              </button>

              {isActive && (
                <div style={{ marginTop: 18, animation: 'fade-in 0.2s ease-out' }}>
                  <StageSteps stage={stage} session={session} t={t} />
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

type StepItem =
  | { type: 'call'; call: ToolCall }
  | { type: 'group'; kind: ToolCallKind; calls: ToolCall[]; key: string }

function StageSteps({ stage, session, t }: { stage: StageGroup; session: Session; t: TFunction }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const items = useMemo<StepItem[]>(() => {
    const calls = stage.calls
    const out: StepItem[] = []
    let i = 0
    while (i < calls.length) {
      const c = calls[i]
      if ((c.kind === 'file-op' || c.kind === 'command') && c.status === 'success' && !retriesOf(c)) {
        let j = i + 1
        while (
          j < calls.length &&
          calls[j].kind === c.kind &&
          calls[j].status === 'success' &&
          !retriesOf(calls[j])
        )
          j++
        if (j - i >= 3) {
          out.push({ type: 'group', kind: c.kind, calls: calls.slice(i, j), key: `g-${stage.id}-${i}` })
          i = j
          continue
        }
      }
      out.push({ type: 'call', call: c })
      i++
    }
    return out
  }, [stage])

  return (
    <div style={{ paddingLeft: 56, display: 'flex', flexDirection: 'column' }}>
      {items.map((item) =>
        item.type === 'group' ? (
          <GroupedRow
            key={item.key}
            group={item}
            session={session}
            expanded={!!expanded[item.key]}
            onToggle={() => setExpanded((s) => ({ ...s, [item.key]: !s[item.key] }))}
            t={t}
          />
        ) : (
          <StepRow key={item.call.id} call={item.call} session={session} t={t} />
        ),
      )}
    </div>
  )
}

function StepRow({ call, session, t }: { call: ToolCall; session: Session; t: TFunction }) {
  const [hover, setHover] = useState(false)
  const statusColor = STATUS_COLOR[call.status] ?? '#94a3b8'
  const retries = retriesOf(call)
  const isImportant = IMPORTANT_KINDS.includes(call.kind)
  const isProblem = call.status === 'failed' || retries > 0
  const isLarge = isImportant || isProblem

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '8px 12px',
        marginLeft: -12,
        marginRight: -12,
        marginBottom: 2,
        borderRadius: 6,
        background: hover ? '#fffdf7' : 'transparent',
        borderLeft: isProblem
          ? `2px solid ${call.status === 'failed' ? STATUS_COLOR.failed : STATUS_COLOR.retried}`
          : '2px solid transparent',
        transition: 'background 0.1s',
      }}
    >
      <div
        style={{
          minWidth: 42,
          paddingTop: 3,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          color: '#bdb39c',
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {formatElapsed(call.startedAt, session.startedAt)}
      </div>

      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: call.status === 'failed' ? statusColor : 'transparent',
          border: `1.5px solid ${statusColor}`,
          flexShrink: 0,
          marginTop: 6,
        }}
      />

      <div
        style={{
          minWidth: 50,
          paddingTop: 3,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#8d836b',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}
      >
        {t(KIND_LABEL_KEY[call.kind])}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#0f0d0a', fontWeight: isLarge ? 500 : 400, lineHeight: 1.5 }}>
          {call.title}
          {call.status === 'failed' && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 600,
                color: STATUS_COLOR.failed,
                background: '#fbeaef',
                padding: '1px 7px',
                borderRadius: 9999,
              }}
            >
              {t('graph.timeline2.failed_pill')}
            </span>
          )}
          {retries > 0 && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 600,
                color: STATUS_COLOR.retried,
                background: '#fdf4e6',
                padding: '1px 7px',
                borderRadius: 9999,
              }}
            >
              ↺{retries}
            </span>
          )}
        </div>
        {call.detail && call.detail.trim() && (
          <div
            style={{
              marginTop: 6,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11,
              color: '#5e5644',
              background: '#f6f3eb',
              border: '1px solid #ece8de',
              borderRadius: 5,
              padding: '6px 10px',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {call.detail}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          minWidth: 80,
          paddingTop: 3,
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: '#5e5644' }}>
          {formatDuration(call.durationMs)}
        </span>
      </div>
    </div>
  )
}

function GroupedRow({
  group,
  session,
  expanded,
  onToggle,
  t,
}: {
  group: { kind: ToolCallKind; calls: ToolCall[] }
  session: Session
  expanded: boolean
  onToggle: () => void
  t: TFunction
}) {
  const calls = group.calls
  const totalDur = calls.reduce((a, c) => a + c.durationMs, 0)

  return (
    <div style={{ marginBottom: 2 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '8px 12px',
          marginLeft: -12,
          marginRight: -12,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#f6f3eb')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <div
          style={{
            minWidth: 42,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10,
            color: '#bdb39c',
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {formatElapsed(calls[0].startedAt, session.startedAt)}
        </div>
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'transparent',
            border: '1.5px dashed #bdb39c',
            flexShrink: 0,
          }}
        />
        <div
          style={{
            minWidth: 50,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: '#8d836b',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          {t(KIND_LABEL_KEY[group.kind])}
        </div>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#5e5644' }}>
          <strong style={{ color: '#0f0d0a' }}>
            {t('graph.timeline2.grouped_ops', {
              n: calls.length,
              kind: t(KIND_LABEL_KEY[group.kind]),
            })}
          </strong>
          <span style={{ marginLeft: 6, fontSize: 11, color: '#bdb39c' }}>
            — {expanded ? t('graph.timeline2.hide') : t('graph.timeline2.show_all')}
          </span>
        </div>
        <div
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 80, flexShrink: 0 }}
        >
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: '#5e5644' }}>
            {formatDuration(totalDur)}
          </span>
        </div>
      </button>

      {expanded && (
        <div
          style={{
            paddingLeft: 62,
            borderLeft: '1px dashed #dcd6c8',
            marginLeft: 48,
            marginTop: 4,
            marginBottom: 6,
          }}
        >
          {calls.map((c) => (
            <div
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', fontSize: 12 }}
            >
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  color: '#bdb39c',
                  minWidth: 36,
                }}
              >
                {formatElapsed(c.startedAt, session.startedAt)}
              </span>
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: STATUS_COLOR[c.status] ?? '#94a3b8',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  color: '#3f3a2d',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.title}
              </span>
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: '#bdb39c' }}>
                {formatDuration(c.durationMs)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
