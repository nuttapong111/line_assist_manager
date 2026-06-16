import { getMarketAsset } from '../data/market-universe'
import {
  isSuperinvestorSymbol,
  isViFundSymbol,
  isViStockSymbol,
} from '../data/vi-universe'
import { hasFinnhubKey } from './news.service'
import { fetchOHLCV, type OHLCV } from './yahoo.service'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface ValueScoreResult {
  score: number
  reasons: string[]
}

const valueCache = new Map<string, ValueScoreResult & { at: number }>()

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

async function finnhubMetric(symbol: string): Promise<Record<string, number>> {
  const key = process.env.FINNHUB_API_KEY
  if (!key) return {}
  const res = await fetch(
    `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${key}`,
    { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } },
  )
  if (!res.ok) return {}
  const json = await res.json() as { metric?: Record<string, number> }
  return json.metric || {}
}

function scorePe(pe: number): number {
  if (pe <= 0) return -0.3
  if (pe < 12) return 0.8
  if (pe < 20) return 0.5
  if (pe < 30) return 0.15
  return -0.25
}

function scorePb(pb: number): number {
  if (pb < 1.2) return 0.6
  if (pb < 2.5) return 0.25
  if (pb < 5) return 0
  return -0.2
}

function scoreDividendYield(dy: number): number {
  if (dy >= 0.05) return 0.75
  if (dy >= 0.03) return 0.5
  if (dy >= 0.015) return 0.25
  if (dy > 0) return 0.1
  return 0
}

function scoreRoe(roe: number): number {
  if (roe >= 0.2) return 0.65
  if (roe >= 0.12) return 0.35
  if (roe > 0) return 0.05
  return -0.25
}

function computeFundValueScore(symbol: string): ValueScoreResult {
  const sym = symbol.toUpperCase()
  const indexFunds = new Set(['VOO', 'VTI', 'SPY', 'SET50', 'TDEX', 'UOBSET50', 'KFS100-A', 'K-US500X'])
  const dividendFunds = new Set(['1DIV', 'KFSDIV', 'SCHD', 'JEPI', 'JEPQ'])

  let score = 0.25
  const reasons: string[] = ['กองทุน/ETF ระยะยาว']

  if (indexFunds.has(sym)) {
    score = 0.65
    reasons.push('ดัชนีต่ำค่าธรรมเนียม (แนว Bogle)')
  } else if (dividendFunds.has(sym)) {
    score = 0.72
    reasons.push('เน้นปันผล/คุณภาพ (แนว VI ไทย)')
  } else if (sym === 'KFGGRM') {
    score = 0.35
    reasons.push('กองทุนโลก — กระจายความเสี่ยง')
  }

  return { score: clamp(score, -1, 1), reasons }
}

function computeThaiValueProxy(symbol: string, ohlcv: OHLCV[]): ValueScoreResult {
  const closes = ohlcv.map(d => d.close).filter(c => c > 0)
  const reasons: string[] = []
  let score = 0.25

  if (isViStockSymbol(symbol)) {
    score += 0.2
    reasons.push('อยู่ในกลุ่มหุ้นคุณภาพ VI ไทย')
  }

  if (closes.length >= 60) {
    const slice = closes.slice(-Math.min(252, closes.length))
    const high = Math.max(...slice)
    const low = Math.min(...slice)
    const current = closes[closes.length - 1]
    if (high > low) {
      const position = (current - low) / (high - low)
      const rangeScore = 0.6 - position * 0.8
      score += rangeScore
      if (position < 0.35) reasons.push('ราคาใกล้จุดต่ำ 52 สัปดาห์ (margin of safety)')
      else if (position > 0.75) reasons.push('ราคาสูงในกรอบ 52 สัปดาห์ — รอ pullback')
      else reasons.push('ราคาอยู่กลางกรอบ 52 สัปดาห์')
    }
  }

  return { score: clamp(score, -1, 1), reasons }
}

async function computeUsFundamentalScore(symbol: string): Promise<ValueScoreResult> {
  const reasons: string[] = []
  let total = 0
  let weight = 0

  if (isSuperinvestorSymbol(symbol)) {
    total += 0.35
    weight += 1
    reasons.push('อยู่ในพอร์ตนักลงทุนชื่อดานระดับโลก')
  }

  if (!hasFinnhubKey()) {
    const score = weight > 0 ? total / weight : 0
    return { score: clamp(score, -1, 1), reasons: reasons.length ? reasons : ['ไม่มี FINNHUB — ใช้เฉพาะรายชื่อ VI'] }
  }

  try {
    const m = await finnhubMetric(symbol)
    if (m.peNormalizedAnnual != null) {
      total += scorePe(m.peNormalizedAnnual)
      weight += 1
      reasons.push(`P/E ${m.peNormalizedAnnual.toFixed(1)}`)
    }
    if (m.pbQuarterly != null) {
      total += scorePb(m.pbQuarterly)
      weight += 1
      reasons.push(`P/B ${m.pbQuarterly.toFixed(2)}`)
    }
    if (m.dividendYieldIndicatedAnnual != null) {
      total += scoreDividendYield(m.dividendYieldIndicatedAnnual)
      weight += 1
      reasons.push(`ปันผล ${(m.dividendYieldIndicatedAnnual * 100).toFixed(1)}%`)
    }
    if (m.roeTTM != null) {
      total += scoreRoe(m.roeTTM)
      weight += 1
      reasons.push(`ROE ${(m.roeTTM * 100).toFixed(0)}%`)
    }
  } catch (err) {
    console.error(`[value-score] Finnhub failed for ${symbol}:`, err)
  }

  const score = weight > 0 ? total / weight : (isSuperinvestorSymbol(symbol) ? 0.3 : 0)
  return { score: clamp(score, -1, 1), reasons }
}

export const VI_VALUE_WEIGHT = Number(process.env.VI_VALUE_WEIGHT || '0.6')
export const VI_TECH_WEIGHT = Number(process.env.VI_TECH_WEIGHT || '0.4')

export function computeViCompositeScore(valueScore: number, technicalScore: number): number {
  const composite = valueScore * VI_VALUE_WEIGHT + technicalScore * VI_TECH_WEIGHT
  return clamp(composite, -1, 1)
}

export async function computeValueScore(symbol: string, ohlcv?: OHLCV[]): Promise<ValueScoreResult> {
  const sym = symbol.toUpperCase()
  const cached = valueCache.get(sym)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { score: cached.score, reasons: cached.reasons }
  }

  const asset = getMarketAsset(sym)
  let result: ValueScoreResult

  if (isViFundSymbol(sym) || asset?.category === 'TH_FUND' || asset?.category === 'US_ETF') {
    result = computeFundValueScore(sym)
  } else if (asset?.category === 'US_STOCK' || isSuperinvestorSymbol(sym)) {
    result = await computeUsFundamentalScore(sym)
  } else {
    const bars = ohlcv?.length ? ohlcv : await fetchOHLCV(sym, '1d', 252)
    result = computeThaiValueProxy(sym, bars)
  }

  valueCache.set(sym, { ...result, at: Date.now() })
  return result
}
