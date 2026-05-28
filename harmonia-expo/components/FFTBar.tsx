import React, { useMemo } from 'react'
import Svg, { Rect } from 'react-native-svg'
import { theme } from '../constants/theme'

function seededRng(seed: number) {
  let s = seed
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
}

interface Props {
  seed?:       number
  width?:      number
  height?:     number
  color?:      string
  magnitudes?: number[]
}

const BARS = 48

export default function FFTBar({ seed = 1, width = 300, height = 64, color = theme.INFO, magnitudes }: Props) {
  const bars = useMemo(() => {
    const rng  = seededRng(seed + 1000)
    const barW = width / BARS
    return Array.from({ length: BARS }, (_, i) => {
      let amp: number
      if (magnitudes && magnitudes.length > 0) {
        const step = Math.max(1, Math.floor(magnitudes.length / BARS))
        const val  = magnitudes[i * step] ?? 0
        const mx   = Math.max(...magnitudes) || 1
        amp = val / mx
      } else {
        const env = Math.max(0.05, 1 - Math.abs(i / BARS - 0.3) * 1.2)
        amp = rng() * env
      }
      const barH = Math.max(3, Math.round(amp * (height - 4)))
      return {
        x:  Math.round(i * barW),
        y:  height - barH,
        w:  Math.max(1, Math.floor(barW) - 1),
        h:  barH,
        op: 0.6 + (barH / height) * 0.4,
      }
    })
  }, [seed, width, height, magnitudes])

  return (
    <Svg width={width} height={height}>
      {bars.map((b, i) => (
        <Rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={2} fill={color} opacity={b.op} />
      ))}
    </Svg>
  )
}
