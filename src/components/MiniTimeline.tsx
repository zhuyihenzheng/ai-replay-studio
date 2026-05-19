interface Props {
  values: number[]
  highlightStatus?: 'success' | 'partial' | 'failed' | 'running'
}

const colorFor = (status: Props['highlightStatus']) => {
  if (status === 'failed') return '#f43f5e'
  if (status === 'running') return '#3b82f6'
  if (status === 'partial') return '#f59e0b'
  return '#2a2620'
}

export function MiniTimeline({ values, highlightStatus = 'success' }: Props) {
  if (!values || values.length === 0) return null
  const maxV = Math.max(...values)
  const color = colorFor(highlightStatus)
  const barW = 4
  const gap = 2
  const totalW = values.length * (barW + gap)
  return (
    <svg width="100%" height="28" viewBox={`0 0 ${totalW} 28`} preserveAspectRatio="none">
      {values.map((v, i) => {
        const h = Math.max(3, Math.round((v / maxV) * 26))
        const opacity =
          highlightStatus === 'running' && i === values.length - 1 ? 1 : 0.55 + (v / maxV) * 0.45
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={28 - h}
            width={barW}
            height={h}
            rx={1.5}
            fill={color}
            opacity={opacity}
          />
        )
      })}
    </svg>
  )
}
