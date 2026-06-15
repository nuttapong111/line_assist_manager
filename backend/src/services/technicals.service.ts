import TI from 'technicalindicators'
import type { IndicatorResult } from '../types'
import type { OHLCV } from './yahoo.service'

export function calcMACD(closes: number[]): IndicatorResult {
  const result = TI.MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  })
  if (result.length < 2) return { name: 'MACD (12,26,9)', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 2.5 }

  const last = result[result.length - 1]
  const prev = result[result.length - 2]
  const crossedUp = prev.histogram! <= 0 && last.histogram! > 0
  const crossedDown = prev.histogram! >= 0 && last.histogram! < 0

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
    value: `Hist: ${last.histogram?.toFixed(3)}`,
    reason, weight: 2.5,
  }
}

export function calcRSI(closes: number[]): IndicatorResult {
  const result = TI.RSI.calculate({ values: closes, period: 14 })
  if (result.length < 2) return { name: 'RSI (14)', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 2.0 }

  const rsi = result[result.length - 1]
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
  let score = 0
  let reason = `RSI อยู่ที่ ${rsi.toFixed(1)}`

  if (rsi < 30) { signal = 'BULLISH'; score = 1.5; reason = `RSI oversold (${rsi.toFixed(1)})` }
  else if (rsi > 70) { signal = 'BEARISH'; score = -1.5; reason = `RSI overbought (${rsi.toFixed(1)})` }

  return { name: 'RSI (14)', signal, score, value: rsi.toFixed(1), reason, weight: 2.0 }
}

export function calcBollinger(closes: number[]): IndicatorResult {
  const result = TI.BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 })
  if (!result.length) return { name: 'Bollinger Bands', signal: 'NEUTRAL', score: 0, value: 'N/A', reason: 'ข้อมูลไม่เพียงพอ', weight: 1.5 }

  const last = result[result.length - 1]
  const price = closes[closes.length - 1]
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
  let score = 0
  let reason = 'ราคาอยู่ใน Bollinger Bands'

  if (price <= last.lower) { signal = 'BULLISH'; score = 1.5; reason = 'ราคาแตะ lower band' }
  else if (price >= last.upper) { signal = 'BEARISH'; score = -1.5; reason = 'ราคาแตะ upper band' }

  return { name: 'Bollinger Bands', signal, score, value: `Price: ${price.toFixed(2)}`, reason, weight: 1.5 }
}

export function analyzeIndicators(ohlcv: OHLCV[]) {
  const closes = ohlcv.map(d => d.close)
  const indicators = [calcMACD(closes), calcRSI(closes), calcBollinger(closes)]
  const totalScore = indicators.reduce((s, i) => s + i.score, 0)
  const maxScore = indicators.reduce((s, i) => s + i.weight, 0)

  let overall: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
  if (totalScore > maxScore * 0.3) overall = 'BULLISH'
  else if (totalScore < -maxScore * 0.3) overall = 'BEARISH'

  return { indicators, totalScore, overall, normalizedScore: totalScore / maxScore }
}
