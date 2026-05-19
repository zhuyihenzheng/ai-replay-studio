import { NavLink } from 'react-router-dom'
import { Play, TrendingUp, BarChart3, FileDiff, Sparkles, BookOpen } from 'lucide-react'
import { useT } from '@/i18n'

const tabs = [
  { to: '', labelKey: 'tabs.replay', icon: Play, end: true },
  { to: 'graph', labelKey: 'tabs.tool_graph', icon: TrendingUp, end: false },
  { to: 'cost', labelKey: 'tabs.cost', icon: BarChart3, end: false },
  { to: 'files', labelKey: 'tabs.files', icon: FileDiff, end: false },
  { to: 'artifacts', labelKey: 'tabs.artifacts', icon: Sparkles, end: false },
  { to: 'report', labelKey: 'tabs.client_report', icon: BookOpen, end: false },
]

export function SessionTabs({ sessionId }: { sessionId: string }) {
  const t = useT()
  return (
    <div
      style={{
        borderBottom: '1px solid #efece5',
        paddingLeft: 24,
        background: 'white',
        display: 'flex',
        gap: 0,
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <NavLink
            key={tab.labelKey}
            to={tab.to ? `/sessions/${sessionId}/${tab.to}` : `/sessions/${sessionId}`}
            end={tab.end}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? '#0f0d0a' : '#8d836b',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderBottom: isActive ? '2px solid #1a1814' : '2px solid transparent',
              marginBottom: -1,
              textDecoration: 'none',
              transition: 'color 0.15s',
            })}
          >
            <Icon size={13} />
            {t(tab.labelKey)}
          </NavLink>
        )
      })}
    </div>
  )
}
