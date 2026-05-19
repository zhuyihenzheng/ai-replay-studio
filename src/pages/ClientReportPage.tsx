import { useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Clock,
  Hash,
  Share2,
  Printer,
  Sparkles,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { SessionShell, SessionDoc } from '@/components/SessionShell'
import { EmptyState } from '@/components/EmptyState'
import { formatDateTime, formatDuration, formatTokens } from '@/lib/format'
import { useT } from '@/i18n'
import type { SessionStatus } from '@/types'

const statusSummaryMap: Record<
  SessionStatus,
  { color: string; bg: string }
> = {
  success: { color: '#10b981', bg: '#ecfdf5' },
  partial: { color: '#d97706', bg: '#fffbeb' },
  failed: { color: '#f43f5e', bg: '#fff1f2' },
  running: { color: '#3b82f6', bg: '#eff6ff' },
}

const stageStatusColor: Record<string, string> = {
  success: '#10b981',
  partial: '#d97706',
  failed: '#f43f5e',
}

const issueColors: Record<string, { color: string; bg: string }> = {
  error: { color: '#f43f5e', bg: '#fff1f2' },
  warning: { color: '#d97706', bg: '#fffbeb' },
  info: { color: '#3b82f6', bg: '#eff6ff' },
}

export function ClientReportPage() {
  const t = useT()
  const { id = '' } = useParams()
  const session = useAppStore((s) => s.getSession(id))
  const [copied, setCopied] = useState(false)

  if (!session) return <EmptyState title={t('session.not_found')} />

  const statusSummary = statusSummaryMap[session.status]
  const notableArtifacts = session.artifacts.filter((a) =>
    ['final-answer', 'decision', 'markdown'].includes(a.kind),
  )
  const hasDeliverables = session.files.length > 0 || notableArtifacts.length > 0

  async function onShare() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* noop */
    }
  }

  return (
    <SessionShell session={session}>
      <SessionDoc>
        <div
          className="card"
          style={{ padding: 40, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              marginBottom: 32,
            }}
          >
            <div>
              <div className="section-label" style={{ marginBottom: 4 }}>
                {t('client_report.work_report')}
              </div>
              <div style={{ fontSize: 12, color: '#bdb39c' }}>
                {formatDateTime(session.startedAt)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => window.print()}>
                <Printer size={13} /> {t('client_report.print')}
              </button>
              <button className="btn-primary" onClick={onShare}>
                <Share2 size={13} />
                {copied ? t('client_report.copied') : t('client_report.share_link')}
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 9999,
              background: statusSummary.bg,
              color: statusSummary.color,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 20,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: statusSummary.color,
              }}
            />
            {t(`client_report.status.${session.status}`)}
          </div>

          <h1
            style={{
              fontFamily: '"Source Serif 4", serif',
              fontSize: 28,
              fontWeight: 600,
              color: '#0f0d0a',
              lineHeight: 1.25,
              marginBottom: 12,
            }}
          >
            {session.title}
          </h1>
          <p style={{ fontSize: 15, color: '#5e5644', lineHeight: 1.7, margin: 0 }}>
            {session.taskGoal}
          </p>

          <ReportSection title={t('client_report.what_was_done')}>
            <p style={{ fontSize: 14, color: '#3f3a2d', lineHeight: 1.75 }}>
              {session.workSummary}
            </p>
          </ReportSection>

          <ReportSection title={t('client_report.how_it_unfolded')}>
            <ol
              style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              {session.stages.map((st, i) => {
                const col = stageStatusColor[st.status] ?? '#94a3b8'
                return (
                  <li
                    key={st.id}
                    style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: '#f8f7f4',
                        border: `2px solid ${col}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 600,
                        color: col,
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </div>
                    <div style={{ paddingTop: 3 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: '#0f0d0a',
                          marginBottom: 2,
                        }}
                      >
                        {st.name}
                      </div>
                      <div style={{ fontSize: 13, color: '#8d836b', lineHeight: 1.5 }}>
                        {st.summary}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </ReportSection>

          <ReportSection title={t('client_report.what_was_delivered')}>
            {!hasDeliverables ? (
              <p style={{ fontSize: 13, color: '#8d836b' }}>{t('client_report.no_deliverables')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {session.files.map((f) => (
                  <div
                    key={f.id}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}
                  >
                    <CheckCircle2
                      size={15}
                      style={{ color: '#10b981', flexShrink: 0, marginTop: 1 }}
                    />
                    <div>
                      <code
                        style={{
                          fontSize: 12,
                          fontFamily: '"JetBrains Mono", monospace',
                          color: '#3f3a2d',
                          background: '#f8f7f4',
                          padding: '1px 5px',
                          borderRadius: 4,
                        }}
                      >
                        {f.path}
                      </code>
                      <div style={{ fontSize: 12, color: '#8d836b', marginTop: 2 }}>
                        {f.summary}
                      </div>
                    </div>
                  </div>
                ))}
                {notableArtifacts.map((a) => (
                  <div
                    key={a.id}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}
                  >
                    <Sparkles
                      size={15}
                      style={{ color: '#d96f1e', flexShrink: 0, marginTop: 1 }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1814' }}>
                        {a.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#8d836b',
                          marginTop: 2,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {a.body}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ReportSection>

          {session.issues.length > 0 && (
            <ReportSection title={t('client_report.issues_encountered')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {session.issues.map((iss) => {
                  const c = issueColors[iss.severity] ?? issueColors.info
                  return (
                    <div
                      key={iss.id}
                      style={{
                        display: 'flex',
                        gap: 10,
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: c.bg,
                      }}
                    >
                      <AlertTriangle
                        size={14}
                        style={{ color: c.color, flexShrink: 0, marginTop: 1 }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1814' }}>
                          {iss.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#5e5644',
                            marginTop: 2,
                            lineHeight: 1.5,
                          }}
                        >
                          {iss.description}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ReportSection>
          )}

          <ReportSection title={t('client_report.cost_time')}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ReportStat
                icon={<Clock size={12} />}
                label={t('client_report.time_spent')}
                value={formatDuration(session.durationMs)}
              />
              <ReportStat
                icon={<Hash size={12} />}
                label={t('client_report.billable_estimate')}
                value={formatTokens(session.tokensIn + session.tokensOut)}
              />
            </div>
          </ReportSection>

          <ReportSection title={t('client_report.recommended_next_steps')}>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {session.nextSteps.map((n, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontSize: 13,
                    color: '#3f3a2d',
                    lineHeight: 1.6,
                  }}
                >
                  <ArrowRight
                    size={13}
                    style={{ color: '#bdb39c', flexShrink: 0, marginTop: 3 }}
                  />
                  {n}
                </li>
              ))}
            </ul>
          </ReportSection>

          <div
            style={{
              marginTop: 40,
              paddingTop: 20,
              borderTop: '1px solid #efece5',
              fontSize: 11,
              color: '#bdb39c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <span>{t('client_report.generated_by')}</span>
            <span style={{ minWidth: 0 }}>
              {t('client_report.session_id', { id: session.id })}
            </span>
          </div>
        </div>
      </SessionDoc>
    </SessionShell>
  )
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 32 }}>
      <div className="section-label" style={{ marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </section>
  )
}

function ReportStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div style={{ border: '1px solid #efece5', borderRadius: 10, padding: '14px 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: '#8d836b',
          marginBottom: 6,
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          fontFamily: '"Source Serif 4", serif',
          fontSize: 22,
          fontWeight: 600,
          color: '#0f0d0a',
        }}
      >
        {value}
      </div>
    </div>
  )
}
