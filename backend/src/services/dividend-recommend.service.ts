import { db } from '../lib/db'
import { marketAnalysisCache } from '../lib/schema'
import { and, eq } from 'drizzle-orm'
import { getMarketAsset, formatAssetPrice } from '../data/market-universe'
import { isThaiListedSymbol } from '../data/thai-set-symbols'
import { VI_STOCK_SYMBOLS_TH } from '../data/vi-universe'
import { ANALYSIS_VERSION } from './investment.service'
import { isRecommendableCandidate } from './recommendation.service'
import { calcSupportResistance, type SupportResistanceLevels } from './support-resistance.service'
import { getValueAnalysis, type ValueAnalysisDetail } from './value-score.service'
import { fetchOHLCV } from './yahoo.service'

export const DIVIDEND_STOCK_PICK_LIMIT = Number(process.env.DIVIDEND_STOCK_PICK_LIMIT || '10')
export const DIVIDEND_MIN_YIELD_PCT = Number(process.env.DIVIDEND_MIN_YIELD_PCT || '2')
const ENRICH_CONCURRENCY = 4

/** ประมาณการอัตราปันผลหุ้นไทยหลัก (indicated) — ใช้จัดอันดับเมื่อไม่มี Finnhub */
const THAI_DIVIDEND_YIELD_PROXY: Record<string, number> = {
  KBANK: 5.0, SCB: 4.5, BBL: 4.8, TTB: 6.5,
  PTT: 5.2, PTTGC: 4.0, OR: 4.5,
  ADVANC: 3.5, AOT: 3.8, CPALL: 2.8,
  BDMS: 2.5, MINT: 1.5, CRC: 3.0,
  SCC: 4.2, DELTA: 1.2, GULF: 2.8,
  HMPRO: 3.5, MTC: 3.0, RATCH: 4.5, WHA: 3.2,
}

const viThaiSet = new Set<string>(VI_STOCK_SYMBOLS_TH)

export interface EnrichedDividendPick {
  rank: number
  symbol: string
  displayName: string
  exchange: string | null
  price: number | null
  changePct: number | null
  dividendYieldPct: number | null
  dividendLabel: string
  dividendCompositeScore: number
  valueScore: number
  technicalScore: number
  valueReasons: string[]
  supportResistance: SupportResistanceLevels | null
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function pct(score: number): string {
  return (Math.round(score * 1000) / 10).toFixed(1)
}

function extractDividendYieldPct(detail: ValueAnalysisDetail, symbol: string): number | null {
  const metric = detail.metrics.find(m => m.label === 'ปันผล')
  if (metric) {
    const n = parseFloat(metric.value.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(n) && n > 0) return n
  }
  const proxy = THAI_DIVIDEND_YIELD_PROXY[symbol.toUpperCase()]
  if (proxy != null) return proxy
  if (detail.styleLabel.includes('ปันผล') || detail.reasons.some(r => r.includes('ปันผล'))) {
    return DIVIDEND_MIN_YIELD_PCT
  }
  return null
}

function scoreYieldPct(dy: number): number {
  if (dy >= 6) return 0.9
  if (dy >= 4) return 0.75
  if (dy >= 3) return 0.6
  if (dy >= 2) return 0.45
  if (dy > 0) return 0.2
  return 0
}

function computeDividendComposite(dy: number, valueScore: number, technicalScore: number, isViThai: boolean): number {
  let composite = scoreYieldPct(dy) * 0.55 + clamp(valueScore, -1, 1) * 0.3 + clamp(technicalScore, -1, 1) * 0.15
  if (isViThai && dy >= DIVIDEND_MIN_YIELD_PCT) composite += 0.05
  return clamp(composite, -1, 1)
}

function formatDividendLabel(dy: number | null, usedProxy: boolean): string {
  if (dy == null) return 'ปันผล: ไม่ทราบ'
  const prefix = usedProxy ? '~' : ''
  return `ปันผล ${prefix}${dy.toFixed(1)}%`
}

function isDividendStockRow(row: {
  symbol: string
  displayName?: string | null
  exchange?: string | null
  price?: string | number | null
}): boolean {
  if (!isRecommendableCandidate(row)) return false
  const exchange = row.exchange || getMarketAsset(row.symbol)?.category || ''
  if (exchange !== 'TH_STOCK' && exchange !== 'US_STOCK') return false
  if (viThaiSet.has(row.symbol.toUpperCase())) return true
  return true
}

export function formatDividendPickLine(pick: EnrichedDividendPick, watchlistSymbols?: Set<string>): string {
  const ch = pick.changePct != null ? ` ${pick.changePct >= 0 ? '+' : ''}${pick.changePct.toFixed(1)}%` : ''
  const price = pick.price != null ? ` ${formatAssetPrice(pick.symbol, pick.price)}` : ''
  const tag = watchlistSymbols?.has(pick.symbol) ? ' 📋' : ''
  const main = `${pick.rank}. ${pick.displayName} (${pick.symbol}) — ${pick.dividendLabel} | คะแนน ${pct(pick.dividendCompositeScore)} (คุณภาพ ${pct(pick.valueScore)} / เทคนิค ${pct(pick.technicalScore)})${price}${ch}${tag}`
  const srLine = pick.supportResistance
    ? `   📍 รับ ${formatAssetPrice(pick.symbol, pick.supportResistance.support1)} | ต้าน ${formatAssetPrice(pick.symbol, pick.supportResistance.resistance1)}`
    : ''
  return [main, srLine].filter(Boolean).join('\n')
}

async function enrichDividendCandidate(row: {
  symbol: string
  displayName: string | null
  exchange: string | null
  normalizedScore: string | null
  price: string | null
  changePct: string | null
}): Promise<EnrichedDividendPick | null> {
  const sym = row.symbol.toUpperCase()
  const technicalScore = Number(row.normalizedScore ?? 0)
  const price = row.price != null ? Number(row.price) : null

  try {
    const ohlcv = await fetchOHLCV(sym, '1d', 120)
    const supportResistance = calcSupportResistance(ohlcv, price ?? undefined)
    const valueDetail = await getValueAnalysis(sym, ohlcv)
    const metric = valueDetail.metrics.find(m => m.label === 'ปันผล')
    const hasMetric = metric != null && parseFloat(metric.value) > 0
    const dividendYieldPct = extractDividendYieldPct(valueDetail, sym)

    const isViThai = viThaiSet.has(sym)
    if (dividendYieldPct == null || dividendYieldPct < DIVIDEND_MIN_YIELD_PCT) {
      if (!isViThai) return null
      const proxy = THAI_DIVIDEND_YIELD_PROXY[sym]
      if (proxy == null || proxy < DIVIDEND_MIN_YIELD_PCT) return null
    }

    const dy = dividendYieldPct ?? THAI_DIVIDEND_YIELD_PROXY[sym] ?? DIVIDEND_MIN_YIELD_PCT
    const usedProxy = !hasMetric && isThaiListedSymbol(sym)
    const dividendCompositeScore = computeDividendComposite(dy, valueDetail.score, technicalScore, isViThai)

    return {
      rank: 0,
      symbol: sym,
      displayName: row.displayName || sym,
      exchange: row.exchange,
      price,
      changePct: row.changePct != null ? Number(row.changePct) : null,
      dividendYieldPct: dy,
      dividendLabel: formatDividendLabel(dy, usedProxy),
      dividendCompositeScore,
      valueScore: valueDetail.score,
      technicalScore,
      valueReasons: valueDetail.reasons,
      supportResistance,
    }
  } catch (err) {
    console.error(`[dividend-recommend] enrich failed for ${sym}:`, err)
    return null
  }
}

async function enrichBatch<T>(
  items: T[],
  fn: (item: T) => Promise<EnrichedDividendPick | null>,
): Promise<EnrichedDividendPick[]> {
  const results: EnrichedDividendPick[] = []
  for (let i = 0; i < items.length; i += ENRICH_CONCURRENCY) {
    const batch = items.slice(i, i + ENRICH_CONCURRENCY)
    const batchResults = await Promise.all(batch.map(fn))
    for (const r of batchResults) {
      if (r) results.push(r)
    }
  }
  return results.sort((a, b) =>
    b.dividendCompositeScore - a.dividendCompositeScore
    || (b.dividendYieldPct ?? 0) - (a.dividendYieldPct ?? 0)
    || b.technicalScore - a.technicalScore,
  )
}

export async function getEnrichedDividendPicks(): Promise<EnrichedDividendPick[]> {
  const rows = await db
    .select()
    .from(marketAnalysisCache)
    .where(eq(marketAnalysisCache.analysisVersion, ANALYSIS_VERSION))

  const candidates = rows
    .filter(isDividendStockRow)
    .sort((a, b) => Number(b.normalizedScore ?? 0) - Number(a.normalizedScore ?? 0))

  const viThaiFirst = [
    ...candidates.filter(r => viThaiSet.has(r.symbol.toUpperCase())),
    ...candidates.filter(r => !viThaiSet.has(r.symbol.toUpperCase())),
  ]

  const poolSize = Math.min(viThaiFirst.length, DIVIDEND_STOCK_PICK_LIMIT * 8)
  let picks = await enrichBatch(viThaiFirst.slice(0, poolSize), enrichDividendCandidate)

  if (picks.length < DIVIDEND_STOCK_PICK_LIMIT) {
    const missing = VI_STOCK_SYMBOLS_TH.filter(s => !picks.some(p => p.symbol === s))
    const fallbackRows = missing.map(symbol => ({
      symbol,
      displayName: getMarketAsset(symbol)?.displayName || symbol,
      exchange: 'TH_STOCK' as const,
      normalizedScore: '0.2',
      price: null,
      changePct: null,
    }))
    const fallback = await enrichBatch(fallbackRows, enrichDividendCandidate)
    picks = [...picks, ...fallback]
      .sort((a, b) =>
        b.dividendCompositeScore - a.dividendCompositeScore
        || (b.dividendYieldPct ?? 0) - (a.dividendYieldPct ?? 0),
      )
  }

  return picks.slice(0, DIVIDEND_STOCK_PICK_LIMIT).map((p, i) => ({ ...p, rank: i + 1 }))
}
