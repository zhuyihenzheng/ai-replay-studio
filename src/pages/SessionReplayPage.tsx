import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Pause,
  Play,
  SkipForward,
  SkipBack,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { SessionShell } from '@/components/SessionShell'
import { EmptyState } from '@/components/EmptyState'
import { formatDuration, formatTokens } from '@/lib/format'
import { useT } from '@/i18n'
import type { Session, ToolCall, ToolCallKind } from '@/types'

const KIND_STYLES: Record<
  ToolCallKind,
  { dot: string; chip: { background: string; color: string }; labelKey: string }
> = {
  input: { dot: '#38bdf8', chip: { background: '#f0f9ff', color: '#0369a1' }, labelKey: 'graph.kind.input' },
  analysis: { dot: '#a78bfa', chip: { background: '#f5f3ff', color: '#6d28d9' }, labelKey: 'graph.kind.analysis' },
  'file-op': { dot: '#34d399', chip: { background: '#ecfdf5', color: '#065f46' }, labelKey: 'graph.kind.file_op' },
  command: { dot: '#94a3b8', chip: { background: '#f8f7f4', color: '#5e5644' }, labelKey: 'graph.kind.command' },
  validation: { dot: '#2dd4bf', chip: { background: '#f0fdfa', color: '#115e59' }, labelKey: 'graph.kind.validation' },
  error: { dot: '#f87171', chip: { background: '#fff1f2', color: '#9f1239' }, labelKey: 'graph.kind.error' },
  output: { dot: '#fbbf24', chip: { background: '#fffbeb', color: '#92400e' }, labelKey: 'graph.kind.output' },
}

export function SessionReplayPage() {
  const t = useT()
  const { id = '' } = useParams()
  const session = useAppStore((s) => s.getSession(id))

  const [currentIndex, setCurrentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    setCurrentIndex(0)
    setPlaying(false)
  }, [id])

  useEffect(() => {
    if (!playing || !session) return
    intervalRef.current = window.setInterval(() => {
      setCurrentIndex((i) => {
        if (i >= session.toolCalls.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, 800)
    return () => {
      if (intervalRef.current != null) window.clearInterval(intervalRef.current)
    }
  }, [playing, session])

  if (!session) {
    return <EmptyState title={t('session.not_found')} description={t('session.not_found_desc')} />
  }

  const current = session.toolCalls[currentIndex]
  const progress = ((currentIndex + 1) / session.toolCalls.length) * 100

  return (
    <SessionShell session={session}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '260px 1fr 280px',
            gap: 16,
            padding: 20,
          }}
        >
        <aside>
          <div
            className="card"
            style={{
              padding: '16px 12px',
              position: 'sticky',
              top: 0,
              maxHeight: 'calc(100vh - 200px)',
              overflowY: 'auto',
            }}
          >
            <div className="section-label" style={{ marginBottom: 12, paddingLeft: 6 }}>
              {t('replay.timeline')}
            </div>
            <ol style={{ position: 'relative', listStyle: 'none' }}>
              <span
                aria-hidden
                style={{ position: 'absolute', left: 9, top: 6, bottom: 6, width: 1, background: '#efece5' }}
              />
              {session.toolCalls.map((tc, i) => {
                const k = KIND_STYLES[tc.kind] ?? KIND_STYLES.command
                const active = i === currentIndex
                return (
                  <li key={tc.id} style={{ position: 'relative', paddingLeft: 24, paddingBottom: 10 }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: 3,
                        top: 5,
                        width: 13,
                        height: 13,
                        borderRadius: '50%',
                        background: k.dot,
                        border: '2px solid white',
                        boxShadow: active ? `0 0 0 2px ${k.dot}` : 'none',
                        transform: active ? 'scale(1.15)' : 'scale(1)',
                        transition: 'all 0.2s',
                      }}
                    />
                    <button
                      onClick={() => {
                        setCurrentIndex(i)
                        setPlaying(false)
                      }}
                      style={{
                        background: active ? '#f8f7f4' : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                        borderRadius: 6,
                        padding: '4px 6px',
                        color: active ? '#0f0d0a' : '#5e5644',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: active ? 600 : 400,
                          lineHeight: 1.4,
                        }}
                      >
                        {tc.title}
                      </div>
                      <div style={{ fontSize: 10, color: '#bdb39c', marginTop: 1 }}>
                        {formatDuration(tc.durationMs)}
                        {tc.retries ? ` · ↺${tc.retries}` : ''}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        </aside>

        <section>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 12, color: '#8d836b' }}>
                {t('replay.step_of', {
                  current: currentIndex + 1,
                  total: session.toolCalls.length,
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="btn"
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  title={t('replay.previous')}
                >
                  <SkipBack size={13} />
                </button>
                <button className="btn-primary" onClick={() => setPlaying((p) => !p)}>
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                  {playing ? t('replay.pause') : t('replay.play')}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    setCurrentIndex((i) => Math.min(session.toolCalls.length - 1, i + 1))
                  }
                  title={t('replay.next')}
                >
                  <SkipForward size={13} />
                </button>
              </div>
            </div>

            <div
              style={{
                height: 4,
                background: '#efece5',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: '#1a1814',
                  borderRadius: 4,
                  transition: 'width 0.3s',
                }}
              />
            </div>

            <CurrentEventCard call={current} />
          </div>

          <StagesCard session={session} current={current} />
        </section>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: 16 }}>
            <div className="section-label" style={{ marginBottom: 8 }}>
              {t('replay.summary')}
            </div>
            <p style={{ fontSize: 13, color: '#3f3a2d', lineHeight: 1.6 }}>
              {session.workSummary}
            </p>
          </div>

          <InsightsCard session={session} />

          <CostSnapshotCard session={session} />
        </aside>
        </div>
      </div>
    </SessionShell>
  )
}

function CurrentEventCard({ call }: { call: ToolCall | undefined }) {
  const t = useT()
  if (!call) return null
  const k = KIND_STYLES[call.kind] ?? KIND_STYLES.command
  const statusColor =
    call.status === 'success' ? '#10b981' : call.status === 'failed' ? '#f43f5e' : '#f59e0b'

  return (
    <div
      style={{
        border: '1px solid #efece5',
        borderRadius: 10,
        padding: 16,
        background: '#fafaf8',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            ...k.chip,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 9999,
          }}
        >
          {t(k.labelKey)}
        </span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
        <span style={{ fontSize: 11, color: '#8d836b' }}>
          {formatDuration(call.durationMs)}
          {call.retries ? ` · ↺${call.retries}` : ''}
        </span>
      </div>
      <div
        style={{
          fontFamily: '"Source Serif 4", serif',
          fontSize: 17,
          fontWeight: 600,
          color: '#0f0d0a',
          lineHeight: 1.35,
          marginBottom: 10,
        }}
      >
        {call.title}
      </div>
      {call.detail && (
        <pre
          style={{
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
            background: 'white',
            border: '1px solid #efece5',
            borderRadius: 6,
            padding: 10,
            color: '#3f3a2d',
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
          }}
        >
          {call.detail}
        </pre>
      )}
    </div>
  )
}

function StagesCard({
  session,
  current,
}: {
  session: Session
  current: ToolCall | undefined
}) {
  const t = useT()
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="section-label" style={{ marginBottom: 12 }}>
        {t('replay.execution_stages')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {session.stages.map((st) => {
          const isActive = !!(current && st.toolCallIds.includes(current.id))
          const statusColor =
            st.status === 'success' ? '#10b981' : st.status === 'failed' ? '#f43f5e' : '#f59e0b'
          return (
            <div
              key={st.id}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${isActive ? '#dcd6c8' : '#efece5'}`,
                background: isActive ? '#f8f7f4' : 'white',
                transition: 'all 0.2s',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: statusColor,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#0f0d0a' }}>{st.name}</span>
                </div>
                <span style={{ fontSize: 11, color: '#8d836b', whiteSpace: 'nowrap' }}>
                  {formatDuration(st.durationMs)}
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#8d836b', marginTop: 4 }}>{st.summary}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InsightsCard({ session }: { session: Session }) {
  const t = useT()
  const colors: Record<string, string> = {
    error: '#f43f5e',
    warning: '#f59e0b',
    info: '#38bdf8',
  }
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>
        {t('replay.issues')}
      </div>
      {session.issues.length === 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: '#065f46',
          }}
        >
          <CheckCircle2 size={14} />
          {t('replay.no_issues')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {session.issues.map((iss) => (
            <div key={iss.id} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
              <AlertTriangle
                size={14}
                style={{ color: colors[iss.severity], flexShrink: 0, marginTop: 1 }}
              />
              <div>
                <div style={{ fontWeight: 600, color: '#1a1814' }}>{iss.title}</div>
                <div style={{ color: '#8d836b', marginTop: 2, lineHeight: 1.4 }}>
                  {iss.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #efece5' }}>
        <div className="section-label" style={{ marginBottom: 8 }}>
          {t('replay.next_steps')}
        </div>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {session.nextSteps.map((n, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                gap: 6,
                fontSize: 12,
                color: '#3f3a2d',
                lineHeight: 1.5,
              }}
            >
              <ArrowRight size={12} style={{ color: '#bdb39c', flexShrink: 0, marginTop: 2 }} />
              {n}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CostSnapshotCard({ session }: { session: Session }) {
  const t = useT()
  const callById = new Map(session.toolCalls.map((c) => [c.id, c]))
  const tok = (c?: ToolCall) => (c ? (c.tokensIn ?? 0) + (c.tokensOut ?? 0) : 0)
  const total = session.tokensIn + session.tokensOut
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>
        {t('replay.cost_snapshot')}
      </div>
      {session.stages.map((st) => {
        const stTok = st.toolCallIds.reduce((a, id) => a + tok(callById.get(id)), 0)
        const pct = total > 0 ? (stTok / total) * 100 : 0
        return (
          <div key={st.id} style={{ marginBottom: 8 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                marginBottom: 3,
              }}
            >
              <span style={{ color: '#5e5644' }}>{st.name}</span>
              <span style={{ color: '#8d836b', fontVariantNumeric: 'tabular-nums' }}>
                {t('session_card.tokens', { n: formatTokens(stTok) })}
              </span>
            </div>
            <div style={{ height: 3, background: '#efece5', borderRadius: 2 }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, pct)}%`,
                  background: '#5e8b6a',
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
