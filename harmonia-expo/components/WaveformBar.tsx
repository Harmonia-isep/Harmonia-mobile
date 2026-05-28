import React, { useMemo } from 'react'
import Svg, { Line } from 'react-native-svg'
import { theme } from '../constants/theme'

function seededRng(seed: number) {
  let s = seed
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
}

interface Props {
  seed?:   number
  width?:  number
  height?: number
}

export default function WaveformBar({ seed = 1, width = 300, height = 72 }: Props) {
  const lines = useMemo(() => {
    const rng = seededRng(seed)
    const mid  = height / 2
    const barW = width / 60
    return Array.from({ length: 60 }, (_, i) => {
      const amp = (rng() * 0.8 + 0.1) * (mid - 4)
      const x   = Math.round(i * barW + barW / 2)
      return { x, y1: Math.round(mid - amp), y2: Math.round(mid + amp) }
    })
  }, [seed, width, height])

  return (
    <Svg width={width} height={height}>
      {lines.map((l, i) => (
        <Line key={i} x1={l.x} y1={l.y1} x2={l.x} y2={l.y2}
          stroke={theme.ACCENT} strokeWidth={2} />
      ))}
    </Svg>
  )
}
