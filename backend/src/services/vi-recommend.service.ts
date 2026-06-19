import { db } from '../lib/db'
import { marketAnalysisCache } from '../lib/schema'
import { and, eq, gte } from 'drizzle-orm'
import { getMarketAsset, formatAssetPrice } from '../data/market-universe'
import { isViFundSymbol, isViStockSymbol, VI_FUND_SYMBOLS, VI_STOCK_SYMBOLS } from '../data/vi-universe'
import { ANALYSIS_VERSION, analyzeStock } from './investment.service'
import { isRecommendableCandidate, VI_FUND_PICK_LIMIT, VI_STOCK_PICK_LIMIT } from './recommendation.service'
import { calcSupportResistance, type SupportResistanceLevels } from './support-resistance.service'
import { computeValueScore, computeViCompositeScore, getValueAnalysis } from './value-score.service'
import { computeViHorizons, computeViPhases, formatViHorizonsCompact, formatViPhasesCompact, type ViHorizonResult, type ViPhasedResult } from './vi-phase.service'
import { fetchOHLCV } from './yahoo.service'

export interface EnrichedViPick {
  rank: number
  symbol: string
  displayName: string
  exchange: string | null
  price: number | null
  changePct: number | null
  technicalScore: number
  valueScore: number
  viCompositeScore: number
  valueReasons: string[]
  supportResistance: SupportResistanceLevels | null
  viPhases: ViPhasedResult | null
  viHorizons: ViHorizonResult | null
}

const VI_COMPOSITE_THRESHOLD = Number(process.env.VI_COMPOSITE_THRESHOLD || '0.3')
const ENRICH_CONCURRENCY = 4

function pct(score: number): string {
  return (Math.round(score * 1000) / 10).toFixed(1)
}

export function formatSupportResistanceLine(symbol: string, levels: SupportResistanceLevels | null): string {
  if (!levels) return ''
  return `   📍 รับ ${formatAssetPrice(symbol, levels.support1)} / ${formatAssetPrice(symbol, levels.support2)} | ต้าน ${formatAssetPrice(symbol, levels.resistance1)} / ${formatAssetPrice(symbol, levels.resistance2)}`
}

export function formatViPickLine(pick: EnrichedViPick, watchlistSymbols?: Set<string>): string {
  const ch = pick.changePct != null ? ` ${pick.changePct >= 0 ? '+' : ''}${pick.changePct.toFixed(1)}%` : ''
  const price = pick.price != null ? ` ${formatAssetPrice(pick.symbol, pick.price)}` : ''
  const tag = watchlistSymbols?.has(pick.symbol) ? ' 📋' : ''
  const viLine = `${pick.rank}. ${pick.displayName} (${pick.symbol}) — VI ${pct(pick.viCompositeScore)} (มูลค่า ${pct(pick.valueScore)} / เทคนิค ${pct(pick.technicalScore)})${price}${ch}${tag}`
  const phaseLine = pick.viPhases ? `   ${formatViPhasesCompact(pick.viPhases)}` : ''
  const horizonLine = pick.viHorizons ? `   ${formatViHorizonsCompact(pick.viHorizons)}` : ''
  const srLine = formatSupportResistanceLine(pick.symbol, pick.supportResistance)
  const lines = [viLine, phaseLine, horizonLine, srLine].filter(Boolean)
  return lines.join('\n')
}

async function enrichCandidate(row: {
  symbol: string
  displayName: string | null
  exchange: string | null
  normalizedScore: string | null
  price: string | null
  changePct: string | null
}): Promise<EnrichedViPick | null> {
  const sym = row.symbol.toUpperCase()
  const technicalScore = Number(row.normalizedScore ?? 0)
  const price = row.price != null ? Number(row.price) : null

  try {
    const ohlcv = await fetchOHLCV(sym, '1d', 120)
    const supportResistance = calcSupportResistance(ohlcv, price ?? undefined)
    const { score: valueScore, reasons } = await computeValueScore(sym, ohlcv)
    const viCompositeScore = computeViCompositeScore(valueScore, technicalScore)
    const valueDetail = await getValueAnalysis(sym, ohlcv)

    if (viCompositeScore < VI_COMPOSITE_THRESHOLD) return null

    const changePct = row.changePct != null ? Number(row.changePct) : null
    const viPhases = computeViPhases({
      symbol: sym,
      valueDetail,
      technicalScore,
      price,
      ohlcv,
      supportResistance,
      indicators: [],
    })
    const viHorizons = computeViHorizons({
      symbol: sym,
      valueDetail,
      technicalScore,
      price,
      changePct,
      supportResistance,
      indicators: [],
      phases: viPhases,
    })

    return {
      rank: 0,
      symbol: sym,
      displayName: row.displayName || sym,
      exchange: row.exchange,
      price,
      changePct,
      technicalScore,
      valueScore,
      viCompositeScore,
      valueReasons: reasons,
      supportResistance,
      viPhases,
      viHorizons,
    }
  } catch (err) {
    console.error(`[vi-recommend] enrich failed for ${sym}:`, err)
    return null
  }
}

async function enrichFromAnalyze(symbol: string, displayName: string): Promise<EnrichedViPick | null> {
  const analysis = await analyzeStock(symbol, displayName)
  if (!analysis) return null

  const { score: valueScore, reasons } = await computeValueScore(symbol)
  const viCompositeScore = computeViCompositeScore(valueScore, analysis.normalizedScore)
  if (viCompositeScore < VI_COMPOSITE_THRESHOLD) return null

  const ohlcv = await fetchOHLCV(symbol, '1d', 252)
  const valueDetail = await getValueAnalysis(symbol, ohlcv)
  const viPhases = computeViPhases({
    symbol: analysis.symbol,
    valueDetail,
    technicalScore: analysis.normalizedScore,
    price: analysis.price,
    ohlcv,
    supportResistance: analysis.supportResistance,
    indicators: analysis.indicators,
  })
  const viHorizons = computeViHorizons({
    symbol: analysis.symbol,
    valueDetail,
    technicalScore: analysis.normalizedScore,
    price: analysis.price,
    changePct: analysis.changePct,
    supportResistance: analysis.supportResistance,
    indicators: analysis.indicators,
    phases: viPhases,
  })

  return {
    rank: 0,
    symbol: analysis.symbol,
    displayName: analysis.displayName,
    exchange: getMarketAsset(symbol)?.category ?? null,
    price: analysis.price,
    changePct: analysis.changePct,
    technicalScore: analysis.normalizedScore,
    valueScore,
    viCompositeScore,
    valueReasons: reasons,
    supportResistance: analysis.supportResistance ?? null,
    viPhases,
    viHorizons,
  }
}

async function enrichBatch<T>(
  items: T[],
  fn: (item: T) => Promise<EnrichedViPick | null>,
): Promise<EnrichedViPick[]> {
  const results: EnrichedViPick[] = []
  for (let i = 0; i < items.length; i += ENRICH_CONCURRENCY) {
    const batch = items.slice(i, i + ENRICH_CONCURRENCY)
    const batchResults = await Promise.all(batch.map(fn))
    for (const r of batchResults) {
      if (r) results.push(r)
    }
  }
  return results.sort((a, b) => b.viCompositeScore - a.viCompositeScore || b.technicalScore - a.technicalScore)
}

export async function getEnrichedViPicks(): Promise<{ stocks: EnrichedViPick[]; funds: EnrichedViPick[] }> {
  const rows = await db
    .select()
    .from(marketAnalysisCache)
    .where(and(
      eq(marketAnalysisCache.analysisVersion, ANALYSIS_VERSION),
    ))

  const stockCandidates = rows.filter(r => isViStockSymbol(r.symbol) && isRecommendableCandidate(r))
  const fundCandidates = rows.filter(r => isViFundSymbol(r.symbol) && isRecommendableCandidate(r))

  let stocks = await enrichBatch(stockCandidates, enrichCandidate)
  let funds = await enrichBatch(fundCandidates, enrichCandidate)

  if (stocks.length < VI_STOCK_PICK_LIMIT) {
    const missing = VI_STOCK_SYMBOLS.filter(s => !stocks.some(p => p.symbol === s))
    const fallback = await enrichBatch(
      missing.slice(0, VI_STOCK_PICK_LIMIT * 2),
      s => enrichFromAnalyze(s, getMarketAsset(s)?.displayName || s),
    )
    stocks = [...stocks, ...fallback]
      .sort((a, b) => b.viCompositeScore - a.viCompositeScore || b.technicalScore - a.technicalScore)
      .slice(0, VI_STOCK_PICK_LIMIT)
  } else {
    stocks = stocks.slice(0, VI_STOCK_PICK_LIMIT)
  }

  if (funds.length < VI_FUND_PICK_LIMIT) {
    const missing = VI_FUND_SYMBOLS.filter(s => !funds.some(p => p.symbol === s))
    const fallback = await enrichBatch(
      missing.slice(0, VI_FUND_PICK_LIMIT * 2),
      s => enrichFromAnalyze(s, getMarketAsset(s)?.displayName || s),
    )
    funds = [...funds, ...fallback]
      .sort((a, b) => b.viCompositeScore - a.viCompositeScore || b.technicalScore - a.technicalScore)
      .slice(0, VI_FUND_PICK_LIMIT)
  } else {
    funds = funds.slice(0, VI_FUND_PICK_LIMIT)
  }

  stocks = stocks.map((p, i) => ({ ...p, rank: i + 1 }))
  funds = funds.map((p, i) => ({ ...p, rank: i + 1 }))

  return { stocks, funds }
}

export async function enrichPicksWithSupportResistance<T extends { symbol: string; price: number | null }>(
  picks: T[],
): Promise<(T & { supportResistance: SupportResistanceLevels | null })[]> {
  const results: (T & { supportResistance: SupportResistanceLevels | null })[] = []
  for (let i = 0; i < picks.length; i += ENRICH_CONCURRENCY) {
    const batch = picks.slice(i, i + ENRICH_CONCURRENCY)
    const enriched = await Promise.all(batch.map(async p => {
      try {
        const ohlcv = await fetchOHLCV(p.symbol, '1d', 120)
        return {
          ...p,
          supportResistance: calcSupportResistance(ohlcv, p.price ?? undefined),
        }
      } catch {
        return { ...p, supportResistance: null }
      }
    }))
    results.push(...enriched)
  }
  return results
}
