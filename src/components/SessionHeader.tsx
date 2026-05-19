import { Link } from 'react-router-dom'
import { ChevronLeft, Clock, Coins, Wrench, FileDiff } from 'lucide-react'
import type { Session } from '@/types'
import { formatCost, formatDuration } from '@/lib/format'
import { apiEquivalentFor, billingValue } from '@/lib/cost'
import { SourceBadge, StatusBadge } from './Badge'
import { useT } from '@/i18n'

export function SessionHeader({ session }: { session: Session }) {
  const t = useT()
  return (
    <div style={{ background: 'white', borderBottom: '1px solid #efece5', padding: '16px 24px' }}>
      <div className="min-w-0">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-xs mb-1"
          style={{ color: '#8d836b' }}
        >
          <ChevronLeft size={12} />
          {t('session.back_to_all')}
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <SourceBadge source={session.source} />
          <StatusBadge status={session.status} />
        </div>
        <h1
          className="font-serif font-semibold mt-1.5 leading-tight"
          style={{ fontSize: 20, color: '#0f0d0a' }}
        >
          {session.title}
        </h1>
        <div
          className="flex items-center flex-wrap mt-1.5"
          style={{ fontSize: 12, color: '#8d836b', gap: 16 }}
        >
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {formatDuration(session.durationMs)}
          </span>
          <span className="flex items-center gap-1">
            <Coins size={12} />
            {session.billing ? billingValue(session.billing, t) : formatCost(apiEquivalentFor(session))}
          </span>
          <span className="flex items-center gap-1">
            <Wrench size={12} />
            {t('session_card.calls', { n: session.toolCallCount })}
          </span>
          <span className="flex items-center gap-1">
            <FileDiff size={12} />
            {t('session_card.files', { n: session.changedFileCount })}
          </span>
        </div>
      </div>
    </div>
  )
}
