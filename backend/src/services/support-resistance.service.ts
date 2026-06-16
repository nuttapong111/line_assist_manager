import type { OHLCV } from './yahoo.service'

export interface SupportResistanceLevels {
  pivot: number
  support1: number
  support2: number
  resistance1: number
  resistance2: number
}

function findSwingLevels(bars: OHLCV[], window = 3): { supports: number[]; resistances: number[] } {
  const supports: number[] = []
  const resistances: number[] = []
  if (bars.length < window * 2 + 1) return { supports, resistances }

  for (let i = window; i < bars.length - window; i++) {
    const low = bars[i].low
    const high = bars[i].high
    let isLow = true
    let isHigh = true
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue
      if (bars[j].low <= low) isLow = false
      if (bars[j].high >= high) isHigh = false
    }
    if (isLow) supports.push(low)
    if (isHigh) resistances.push(high)
  }
  return { supports, resistances }
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b)
}

function pickSupportsBelow(price: number, levels: number[]): [number, number] {
  const below = uniqueSorted(levels).filter(l => l < price * 0.999)
  if (below.length === 0) return [price * 0.95, price * 0.9]
  const s1 = below[below.length - 1]
  const s2 = below.length >= 2 ? below[below.length - 2] : s1 * 0.97
  return [s1, Math.min(s2, s1)]
}

function pickResistancesAbove(price: number, levels: number[]): [number, number] {
  const above = uniqueSorted(levels).filter(l => l > price * 1.001)
  if (above.length === 0) return [price * 1.05, price * 1.1]
  const r1 = above[0]
  const r2 = above.length >= 2 ? above[1] : r1 * 1.03
  return [r1, Math.max(r2, r1)]
}

/** คำนวณแนวรับ/แนวต้านจาก pivot + swing high/low */
export function calcSupportResistance(ohlcv: OHLCV[], currentPrice?: number): SupportResistanceLevels | null {
  if (ohlcv.length < 20) return null

  const price = currentPrice ?? ohlcv[ohlcv.length - 1].close
  if (!Number.isFinite(price) || price <= 0) return null

  const last = ohlcv[ohlcv.length - 1]
  const pivot = (last.high + last.low + last.close) / 3
  const pivotS1 = 2 * pivot - last.high
  const pivotS2 = pivot - (last.high - last.low)
  const pivotR1 = 2 * pivot - last.low
  const pivotR2 = pivot + (last.high - last.low)

  const swings = findSwingLevels(ohlcv.slice(-60))
  const allSupports = [...swings.supports, pivotS1, pivotS2]
  const allResistances = [...swings.resistances, pivotR1, pivotR2]

  const [support1, support2] = pickSupportsBelow(price, allSupports)
  const [resistance1, resistance2] = pickResistancesAbove(price, allResistances)

  return { pivot, support1, support2, resistance1, resistance2 }
}
