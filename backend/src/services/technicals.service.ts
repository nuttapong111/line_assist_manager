import * as TI from 'technicalindicators'
import type { IndicatorResult } from '../types'
import type { OHLCV } from './yahoo.service'

const MACD_NEUTRAL: IndicatorResult = {
  name: 'MACD (12,26,9)', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 2.5,
}

function cleanCloses(closes: number[]): number[] {
  return closes.filter(c => Number.isFinite(c) && c > 0)
}

function neutral(name: string, weight: number): IndicatorResult {
  return { name, signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight }
}

export function calcMACD(closes: number[]): IndicatorResult & { histogram?: number } {
  const values = cleanCloses(closes)
  if (values.length < 35) return MACD_NEUTRAL

  try {
    const result = TI.MACD.calculate({
      values, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false,
    })
    if (!result?.length || result.length < 2) return MACD_NEUTRAL

    const last = result[result.length - 1]
    const prev = result[result.length - 2]
    if (!last || !prev) return MACD_NEUTRAL

    const lastHist = last.histogram ?? 0
    const prevHist = prev.histogram ?? 0
    const crossedUp = prevHist <= 0 && lastHist > 0
    const crossedDown = prevHist >= 0 && lastHist < 0

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let score = 0
    let reason = 'MACD ยังไม่ให้สัญญาณชัดเจน'

    if (crossedUp) {
      signal = 'BULLISH'; score = 2.5
      reason = 'MACD line ตัดขึ้นผ่าน signal line (bullish crossover)'
    } else if (crossedDown) {
      signal = 'BEARISH'; score = -2.5
      reason = 'MACD line ตัดลงผ่าน signal line (bearish crossover)'
    } else if (lastHist > 0 && lastHist > prevHist) {
      signal = 'BULLISH'; score = 1.0
      reason = 'MACD histogram เป็นบวกและเพิ่มขึ้น'
    } else if (lastHist < 0 && lastHist < prevHist) {
      signal = 'BEARISH'; score = -1.0
      reason = 'MACD histogram เป็นลบและลดลง'
    }

    return {
      name: 'MACD (12,26,9)', signal, score,
      value: `Hist: ${lastHist.toFixed(3)}`,
      reason, weight: 2.5,
      histogram: lastHist,
    }
  } catch (err) {
    console.error('[technicals] MACD error:', err)
    return MACD_NEUTRAL
  }
}

export function calcRSI(closes: number[]): IndicatorResult & { rsi?: number } {
  const values = cleanCloses(closes)
  if (values.length < 16) return { ...neutral('RSI (14)', 2.0) }

  try {
    const result = TI.RSI.calculate({ values, period: 14 })
    if (!result?.length) return { ...neutral('RSI (14)', 2.0) }

    const rsi = result[result.length - 1]
    if (!Number.isFinite(rsi)) return { ...neutral('RSI (14)', 2.0) }

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let score = 0
    let reason = `RSI อยู่ที่ ${rsi.toFixed(1)}`

    if (rsi < 30) { signal = 'BULLISH'; score = 1.5; reason = `RSI oversold (${rsi.toFixed(1)})` }
    else if (rsi < 40) { signal = 'BULLISH'; score = 0.75; reason = `RSI ใกล้ oversold (${rsi.toFixed(1)})` }
    else if (rsi > 70) { signal = 'BEARISH'; score = -1.5; reason = `RSI overbought (${rsi.toFixed(1)})` }
    else if (rsi > 60) { signal = 'BEARISH'; score = -0.75; reason = `RSI ใกล้ overbought (${rsi.toFixed(1)})` }

    return { name: 'RSI (14)', signal, score, value: rsi.toFixed(1), reason, weight: 2.0, rsi }
  } catch (err) {
    console.error('[technicals] RSI error:', err)
    return { ...neutral('RSI (14)', 2.0) }
  }
}

export function calcBollinger(closes: number[]): IndicatorResult {
  const values = cleanCloses(closes)
  if (values.length < 21) return neutral('Bollinger Bands', 1.5)

  try {
    const result = TI.BollingerBands.calculate({ period: 20, values, stdDev: 2 })
    if (!result?.length) return neutral('Bollinger Bands', 1.5)

    const last = result[result.length - 1]
    const price = values[values.length - 1]
    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let score = 0
    let reason = 'ราคาอยู่ใน Bollinger Bands'

    if (last.lower != null && price <= last.lower) {
      signal = 'BULLISH'; score = 1.5; reason = 'ราคาแตะ lower band'
    } else if (last.upper != null && price >= last.upper) {
      signal = 'BEARISH'; score = -1.5; reason = 'ราคาแตะ upper band'
    } else if (last.lower != null && last.upper != null) {
      const mid = (last.upper + last.lower) / 2
      const range = last.upper - last.lower
      if (range > 0 && price < mid - range * 0.15) {
        signal = 'BULLISH'; score = 0.75; reason = 'ราคาอยู่ใกล้ lower band'
      } else if (price > mid + range * 0.15) {
        signal = 'BEARISH'; score = -0.75; reason = 'ราคาอยู่ใกล้ upper band'
      }
    }

    return { name: 'Bollinger Bands', signal, score, value: `Price: ${price.toFixed(2)}`, reason, weight: 1.5 }
  } catch (err) {
    console.error('[technicals] Bollinger error:', err)
    return neutral('Bollinger Bands', 1.5)
  }
}

export function calcSMATrend(closes: number[]): IndicatorResult {
  const values = cleanCloses(closes)
  if (values.length < 55) return neutral('SMA Trend', 1.5)

  try {
    const sma20 = TI.SMA.calculate({ period: 20, values })
    const sma50 = TI.SMA.calculate({ period: 50, values })
    if (!sma20.length || !sma50.length) return neutral('SMA Trend', 1.5)

    const price = values[values.length - 1]
    const s20 = sma20[sma20.length - 1]
    const s50 = sma50[sma50.length - 1]

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let score = 0
    let reason = 'SMA ยังไม่ชัดเจน'

    if (price > s20 && s20 > s50) {
      signal = 'BULLISH'; score = 1.5; reason = 'เทรนขึ้น: ราคา > SMA20 > SMA50'
    } else if (price > s50) {
      signal = 'BULLISH'; score = 0.75; reason = 'ราคาอยู่เหนือ SMA50'
    } else if (price < s20 && s20 < s50) {
      signal = 'BEARISH'; score = -1.5; reason = 'เทรนลง: ราคา < SMA20 < SMA50'
    } else if (price < s50) {
      signal = 'BEARISH'; score = -0.75; reason = 'ราคาอยู่ใต้ SMA50'
    }

    return { name: 'SMA Trend', signal, score, value: `S20:${s20.toFixed(2)} S50:${s50.toFixed(2)}`, reason, weight: 1.5 }
  } catch (err) {
    console.error('[technicals] SMA error:', err)
    return neutral('SMA Trend', 1.5)
  }
}

export function calcStochastic(ohlcv: OHLCV[]): IndicatorResult {
  if (ohlcv.length < 20) return neutral('Stochastic', 1.0)

  try {
    const result = TI.Stochastic.calculate({
      high: ohlcv.map(d => d.high),
      low: ohlcv.map(d => d.low),
      close: ohlcv.map(d => d.close),
      period: 14,
      signalPeriod: 3,
    })
    if (!result?.length) return neutral('Stochastic', 1.0)

    const last = result[result.length - 1]
    const k = last.k ?? 50

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let score = 0
    let reason = `Stochastic %K = ${k.toFixed(1)}`

    if (k < 20) { signal = 'BULLISH'; score = 1.0; reason = `Stochastic oversold (${k.toFixed(1)})` }
    else if (k < 30) { signal = 'BULLISH'; score = 0.5; reason = `Stochastic ใกล้ oversold (${k.toFixed(1)})` }
    else if (k > 80) { signal = 'BEARISH'; score = -1.0; reason = `Stochastic overbought (${k.toFixed(1)})` }
    else if (k > 70) { signal = 'BEARISH'; score = -0.5; reason = `Stochastic ใกล้ overbought (${k.toFixed(1)})` }

    return { name: 'Stochastic', signal, score, value: `%K: ${k.toFixed(1)}`, reason, weight: 1.0 }
  } catch (err) {
    console.error('[technicals] Stochastic error:', err)
    return neutral('Stochastic', 1.0)
  }
}

export function calcMFI(ohlcv: OHLCV[]): IndicatorResult {
  if (ohlcv.length < 20) return neutral('MFI (14)', 1.0)

  try {
    const result = TI.MFI.calculate({
      high: ohlcv.map(d => d.high),
      low: ohlcv.map(d => d.low),
      close: ohlcv.map(d => d.close),
      volume: ohlcv.map(d => d.volume),
      period: 14,
    })
    if (!result?.length) return neutral('MFI (14)', 1.0)

    const mfi = result[result.length - 1]
    if (!Number.isFinite(mfi)) return neutral('MFI (14)', 1.0)

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let score = 0
    let reason = `MFI = ${mfi.toFixed(1)}`

    if (mfi < 20) { signal = 'BULLISH'; score = 1.0; reason = `MFI oversold (${mfi.toFixed(1)})` }
    else if (mfi < 30) { signal = 'BULLISH'; score = 0.5; reason = `MFI ใกล้ oversold (${mfi.toFixed(1)})` }
    else if (mfi > 80) { signal = 'BEARISH'; score = -1.0; reason = `MFI overbought (${mfi.toFixed(1)})` }
    else if (mfi > 70) { signal = 'BEARISH'; score = -0.5; reason = `MFI ใกล้ overbought (${mfi.toFixed(1)})` }

    return { name: 'MFI (14)', signal, score, value: mfi.toFixed(1), reason, weight: 1.0 }
  } catch (err) {
    console.error('[technicals] MFI error:', err)
    return neutral('MFI (14)', 1.0)
  }
}

/** คะแนนรอง 0–1 สำหรับจัดอันดับเมื่อ normalizedScore เท่ากัน */
export function computeTieBreakScore(
  ohlcv: OHLCV[],
  closes: number[],
  rsi: number | null,
  macdHistogram: number | null,
): number {
  let score = 0

  if (rsi != null && rsi < 50) {
    score += ((50 - rsi) / 50) * 0.3
  }

  if (macdHistogram != null && macdHistogram > 0) {
    score += Math.min(macdHistogram / 1.5, 1) * 0.25
  }

  const volumes = ohlcv.map(d => d.volume).filter(v => v > 0)
  if (volumes.length >= 21) {
    const avg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
    const last = volumes[volumes.length - 1]
    if (avg > 0 && last > avg) {
      score += Math.min((last / avg - 1) / 1.5, 1) * 0.25
    }
  }

  if (closes.length >= 20) {
    const sma20 = TI.SMA.calculate({ period: 20, values: closes })
    const s20 = sma20[sma20.length - 1]
    const price = closes[closes.length - 1]
    if (s20 > 0 && price > s20) {
      score += Math.min((price / s20 - 1) * 8, 1) * 0.2
    }
  }

  return Math.round(Math.min(Math.max(score, 0), 1) * 10000) / 10000
}

export function analyzeIndicators(ohlcv: OHLCV[]) {
  const closes = ohlcv.map(d => d.close)
  const macd = calcMACD(closes)
  const rsi = calcRSI(closes)
  const indicators = [
    macd,
    rsi,
    calcBollinger(closes),
    calcSMATrend(closes),
    calcStochastic(ohlcv),
    calcMFI(ohlcv),
  ]

  const totalScore = indicators.reduce((s, i) => s + i.score, 0)
  const maxScore = indicators.reduce((s, i) => s + i.weight, 0) || 1

  let overall: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
  if (totalScore > maxScore * 0.3) overall = 'BULLISH'
  else if (totalScore < -maxScore * 0.3) overall = 'BEARISH'

  const tieBreakScore = computeTieBreakScore(
    ohlcv,
    closes,
    'rsi' in rsi ? rsi.rsi ?? null : null,
    'histogram' in macd ? macd.histogram ?? null : null,
  )

  return {
    indicators,
    totalScore,
    maxScore,
    overall,
    normalizedScore: totalScore / maxScore,
    tieBreakScore,
  }
}
