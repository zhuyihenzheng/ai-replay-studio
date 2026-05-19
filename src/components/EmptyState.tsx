import { Info } from 'lucide-react'

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ padding: '64px 24px', textAlign: 'center', color: '#8d836b' }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: '#efece5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
        }}
      >
        <Info size={20} />
      </div>
      <div
        style={{
          fontFamily: '"Source Serif 4", serif',
          fontSize: 18,
          color: '#2a2620',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {description && <div style={{ fontSize: 13, color: '#8d836b' }}>{description}</div>}
    </div>
  )
}
