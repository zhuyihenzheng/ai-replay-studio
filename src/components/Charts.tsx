interface ChartDatum {
  [key: string]: string | number
}

interface HorizontalBarRow {
  label: string
  value: number
  color?: string
  status?: 'success' | 'partial' | 'failed' | string
}

export function HorizontalBarChart({
  data,
  formatY,
  labelWidth = 168,
  valueWidth = 76,
}: {
  data: HorizontalBarRow[]
  formatY?: (v: number) => string
  labelWidth?: number
  valueWidth?: number
}) {
  const max = Math.max(...data.map((d) => d.value), 0.0001)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d, i) => {
        const pct = (d.value / max) * 100
        const dotColor =
          d.status === 'failed' ? '#f43f5e' : d.status === 'partial' ? '#f59e0b' : '#10b981'
        const barColor = d.color ?? '#b25515'
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 12,
            }}
          >
            <div
              style={{
                width: labelWidth,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: '#3f3a2d',
                flexShrink: 0,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dotColor,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={d.label}
              >
                {d.label}
              </span>
            </div>
            <div
              style={{
                flex: 1,
                height: 18,
                background: '#f8f7f4',
                borderRadius: 4,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(0.5, pct)}%`,
                  background: barColor,
                  borderRadius: 4,
                  opacity: 0.85,
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <div
              style={{
                width: valueWidth,
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                color: '#5e5644',
                flexShrink: 0,
              }}
            >
              {formatY ? formatY(d.value) : d.value}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface StackedAreaProps {
  perStep: { stageIndex: number; cost: number }[]
  stages: { name: string; color: string }[]
  formatY?: (v: number) => string
  height?: number
}

export function StackedAreaChart({ perStep, stages, formatY, height = 220 }: StackedAreaProps) {
  const N = perStep.length
  const K = stages.length
  if (N === 0 || K === 0) return null

  const pl = 52
  const pr = 16
  const pt = 12
  const pb = 36
  const W = 480
  const H = height
  const chartW = W - pl - pr
  const chartH = H - pt - pb

  // stageCum[k][i] — cumulative cost of stage k up to step i (inclusive)
  const stageCum: number[][] = Array.from({ length: K }, () => new Array(N).fill(0))
  for (let k = 0; k < K; k++) {
    let acc = 0
    for (let i = 0; i < N; i++) {
      if (perStep[i].stageIndex === k) acc += perStep[i].cost
      stageCum[k][i] = acc
    }
  }
  // cumStack[k][i] — top of stage k area at step i = sum_{j<=k} stageCum[j][i]
  const cumStack: number[][] = Array.from({ length: K }, () => new Array(N).fill(0))
  for (let i = 0; i < N; i++) {
    let top = 0
    for (let k = 0; k < K; k++) {
      top += stageCum[k][i]
      cumStack[k][i] = top
    }
  }
  const maxY = Math.max(cumStack[K - 1][N - 1], 0.0001)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, v: maxY * t }))

  const xAt = (i: number) => pl + (i / Math.max(1, N - 1)) * chartW
  const yAt = (v: number) => pt + chartH * (1 - v / maxY)

  const paths = stages.map((_, k) => {
    let p = ''
    for (let i = 0; i < N; i++) {
      const cmd = i === 0 ? 'M' : 'L'
      p += `${cmd}${xAt(i).toFixed(2)},${yAt(cumStack[k][i]).toFixed(2)}`
    }
    for (let i = N - 1; i >= 0; i--) {
      const bottomVal = k > 0 ? cumStack[k - 1][i] : 0
      p += `L${xAt(i).toFixed(2)},${yAt(bottomVal).toFixed(2)}`
    }
    p += 'Z'
    return p
  })

  let topLine = ''
  for (let i = 0; i < N; i++) {
    const cmd = i === 0 ? 'M' : 'L'
    topLine += `${cmd}${xAt(i).toFixed(2)},${yAt(cumStack[K - 1][i]).toFixed(2)}`
  }

  const xMarkers = Array.from(new Set([0, Math.floor(N / 4), Math.floor(N / 2), Math.floor((3 * N) / 4), N - 1])).filter(
    (i) => i >= 0 && i < N,
  )

  return (
    <div style={{ width: '100%' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {yTicks.map(({ t, v }) => {
          const y = pt + chartH * (1 - t)
          return (
            <g key={t}>
              <line x1={pl} y1={y} x2={pl + chartW} y2={y} stroke="#efece5" strokeWidth="1" />
              <text
                x={pl - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#8d836b"
                fontFamily="Inter, sans-serif"
              >
                {formatY ? formatY(v) : v.toFixed(2)}
              </text>
            </g>
          )
        })}
        {paths.map((d, k) => (
          <path key={k} d={d} fill={stages[k].color} opacity={0.78} />
        ))}
        <path d={topLine} fill="none" stroke="#1a1814" strokeWidth="1.5" />
        {xMarkers.map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={H - pb + 14}
            textAnchor="middle"
            fontSize="10"
            fill="#8d836b"
            fontFamily="Inter, sans-serif"
          >
            {i + 1}
          </text>
        ))}
      </svg>
      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid #efece5',
        }}
      >
        {stages.map((s, k) => (
          <span
            key={k}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: '#5e5644',
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: s.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 140,
              }}
              title={s.name}
            >
              {s.name}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

interface BarChartProps {
  data: ChartDatum[]
  xKey: string
  yKey: string
  formatY?: (v: number) => string
  color?: string
  height?: number
}

export function BarChart({ data, xKey, yKey, formatY, color = '#b25515', height = 220 }: BarChartProps) {
  const maxY = Math.max(...data.map((d) => Number(d[yKey])), 0.0001)
  const pl = 52
  const pr = 16
  const pt = 12
  const pb = 48
  const W = 440
  const H = height
  const chartW = W - pl - pr
  const chartH = H - pt - pb
  const barW = Math.max(8, (chartW / Math.max(1, data.length)) * 0.55)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, v: maxY * t }))

  return (
    <div style={{ width: '100%' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {yTicks.map(({ t, v }) => {
          const y = pt + chartH * (1 - t)
          return (
            <g key={t}>
              <line x1={pl} y1={y} x2={pl + chartW} y2={y} stroke="#efece5" strokeWidth="1" />
              <text
                x={pl - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#8d836b"
                fontFamily="Inter, sans-serif"
              >
                {formatY ? formatY(v) : v.toFixed(2)}
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const v = Number(d[yKey])
          const barH = Math.max(2, (v / maxY) * chartH)
          const x = pl + (i / data.length) * chartW + (chartW / data.length - barW) / 2
          const y = pt + chartH - barH
          const label = String(d[xKey])
          const shortLabel = label.length > 10 ? label.slice(0, 10) + '…' : label
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} fill={color} rx={3} opacity={0.85} />
              <text
                x={x + barW / 2}
                y={H - pb + 14}
                textAnchor="middle"
                fontSize="10"
                fill="#5e5644"
                fontFamily="Inter, sans-serif"
              >
                {shortLabel}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface LineChartProps {
  data: ChartDatum[]
  xKey: string
  yKey: string
  formatY?: (v: number) => string
  color?: string
  height?: number
}

export function LineChart({
  data,
  xKey,
  yKey,
  formatY,
  color = '#2a2620',
  height = 220,
}: LineChartProps) {
  const maxY = Math.max(...data.map((d) => Number(d[yKey])), 0.0001)
  const pl = 52
  const pr = 16
  const pt = 12
  const pb = 36
  const W = 440
  const H = height
  const chartW = W - pl - pr
  const chartH = H - pt - pb
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, v: maxY * t }))

  const points = data.map((d, i) => {
    const x = pl + (i / Math.max(1, data.length - 1)) * chartW
    const y = pt + chartH * (1 - Number(d[yKey]) / maxY)
    return [x, y] as const
  })
  const pathD = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ')
  const last = points[points.length - 1]
  const areaD =
    points.length > 1 ? `${pathD} L${last[0]},${pt + chartH} L${pl},${pt + chartH} Z` : ''
  const gradId = `areaGrad-${Math.random().toString(36).slice(2, 8)}`

  return (
    <div style={{ width: '100%' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {yTicks.map(({ t, v }) => {
          const y = pt + chartH * (1 - t)
          return (
            <g key={t}>
              <line x1={pl} y1={y} x2={pl + chartW} y2={y} stroke="#efece5" strokeWidth="1" />
              <text
                x={pl - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#8d836b"
                fontFamily="Inter, sans-serif"
              >
                {formatY ? formatY(v) : v.toFixed(2)}
              </text>
            </g>
          )
        })}
        {points.length > 1 && <path d={areaD} fill={`url(#${gradId})`} />}
        {points.length > 1 && (
          <path d={pathD} stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round" />
        )}
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill={color} />
        ))}
        {[0, Math.floor(data.length / 2), data.length - 1]
          .filter((i, idx, arr) => arr.indexOf(i) === idx && data[i] !== undefined)
          .map((i) => {
            const [x] = points[i]
            return (
              <text
                key={i}
                x={x}
                y={H - pb + 14}
                textAnchor="middle"
                fontSize="10"
                fill="#8d836b"
                fontFamily="Inter, sans-serif"
              >
                {String(data[i][xKey])}
              </text>
            )
          })}
      </svg>
    </div>
  )
}
