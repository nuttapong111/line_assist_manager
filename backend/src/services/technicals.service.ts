import * as TI from 'technicalindicators'
import type { IndicatorResult } from '../types'
import type { OHLCV } from './yahoo.service'

const MACD_NEUTRAL: IndicatorResult = {
  name: 'MACD (12,26,9)', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 2.5,
}

function cleanCloses(closes: number[]): number[] {
  return closes.filter(c => Number.isFinite(c) && c > 0)
}

export function calcMACD(closes: number[]): IndicatorResult {
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
    }

    return {
      name: 'MACD (12,26,9)', signal, score,
      value: `Hist: ${lastHist.toFixed(3)}`,
      reason, weight: 2.5,
    }
  } catch (err) {
    console.error('[technicals] MACD error:', err)
    return MACD_NEUTRAL
  }
}

export function calcRSI(closes: number[]): IndicatorResult {
  const values = cleanCloses(closes)
  if (values.length < 16) {
    return { name: 'RSI (14)', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 2.0 }
  }

  try {
    const result = TI.RSI.calculate({ values, period: 14 })
    if (!result?.length) {
      return { name: 'RSI (14)', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 2.0 }
    }

    const rsi = result[result.length - 1]
    if (!Number.isFinite(rsi)) {
      return { name: 'RSI (14)', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 2.0 }
    }

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let score = 0
    let reason = `RSI อยู่ที่ ${rsi.toFixed(1)}`

    if (rsi < 30) { signal = 'BULLISH'; score = 1.5; reason = `RSI oversold (${rsi.toFixed(1)})` }
    else if (rsi > 70) { signal = 'BEARISH'; score = -1.5; reason = `RSI overbought (${rsi.toFixed(1)})` }

    return { name: 'RSI (14)', signal, score, value: rsi.toFixed(1), reason, weight: 2.0 }
  } catch (err) {
    console.error('[technicals] RSI error:', err)
    return { name: 'RSI (14)', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 2.0 }
  }
}

export function calcBollinger(closes: number[]): IndicatorResult {
  const values = cleanCloses(closes)
  if (values.length < 21) {
    return { name: 'Bollinger Bands', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 1.5 }
  }

  try {
    const result = TI.BollingerBands.calculate({ period: 20, values, stdDev: 2 })
    if (!result?.length) {
      return { name: 'Bollinger Bands', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 1.5 }
    }

    const last = result[result.length - 1]
    const price = values[values.length - 1]
    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let score = 0
    let reason = 'ราคาอยู่ใน Bollinger Bands'

    if (last.lower != null && price <= last.lower) { signal = 'BULLISH'; score = 1.5; reason = 'ราคาแตะ lower band' }
    else if (last.upper != null && price >= last.upper) { signal = 'BEARISH'; score = -1.5; reason = 'ราคาแตะ upper band' }

    return { name: 'Bollinger Bands', signal, score, value: `Price: ${price.toFixed(2)}`, reason, weight: 1.5 }
  } catch (err) {
    console.error('[technicals] Bollinger error:', err)
    return { name: 'Bollinger Bands', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 1.5 }
  }
}

export function analyzeIndicators(ohlcv: OHLCV[]) {
  const closes = ohlcv.map(d => d.close)
  const indicators = [calcMACD(closes), calcRSI(closes), calcBollinger(closes)]
  const totalScore = indicators.reduce((s, i) => s + i.score, 0)
  const maxScore = indicators.reduce((s, i) => s + i.weight, 0) || 1

  let overall: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
  if (totalScore > maxScore * 0.3) overall = 'BULLISH'
  else if (totalScore < -maxScore * 0.3) overall = 'BEARISH'

  return { indicators, totalScore, overall, normalizedScore: totalScore / maxScore }
}
