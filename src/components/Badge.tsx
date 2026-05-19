import type { ReactNode } from 'react'
import type { AgentSource, SessionStatus } from '@/types'
import { useT } from '@/i18n'

const statusMap: Record<SessionStatus, { bg: string; color: string }> = {
  success: { bg: '#ecfdf5', color: '#065f46' },
  partial: { bg: '#fffbeb', color: '#92400e' },
  failed: { bg: '#fff1f2', color: '#9f1239' },
  running: { bg: '#eff6ff', color: '#1e40af' },
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const t = useT()
  const m = statusMap[status]
  return (
    <span className="badge" style={{ background: m.bg, color: m.color }}>
      {status === 'running' && (
        <span
          className="inline-block animate-pulse-dot"
          style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }}
        />
      )}
      {t(`badges.status.${status}`)}
    </span>
  )
}

const sourceMap: Record<AgentSource, { bg: string; color: string }> = {
  'claude-code': { bg: '#f5f3ff', color: '#6d28d9' },
  cursor: { bg: '#eff6ff', color: '#1d4ed8' },
  codex: { bg: '#ecfdf5', color: '#065f46' },
}

function sourceKey(source: AgentSource) {
  return source.replace('-', '_')
}

export function SourceBadge({ source }: { source: AgentSource }) {
  const t = useT()
  const m = sourceMap[source]
  return (
    <span className="badge" style={{ background: m.bg, color: m.color }}>
      {t(`badges.source.${sourceKey(source)}`)}
    </span>
  )
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`badge ${className}`}
      style={{ background: '#f8f7f4', color: '#5e5644', border: '1px solid #efece5' }}
    >
      {children}
    </span>
  )
}
