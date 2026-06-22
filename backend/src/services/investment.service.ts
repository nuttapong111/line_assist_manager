import { db } from '../lib/db'
import { users, watchedAssets, signalLog } from '../lib/schema'
import { eq, and, gte, desc } from 'drizzle-orm'
import { fetchOHLCV, fetchCurrentPrice } from './yahoo.service'
import { analyzeIndicators } from './technicals.service'
import { sendPushWithQuotaCheck } from './push.service'
import { addWatchedAsset, getWatchedAssets } from './portfolio.service'
import { INVESTMENT_DISCLAIMER } from '../types'
import { bangkokToday } from '../lib/datetime'
import {
  MARKET_SCAN_SYMBOLS,
  MARKET_UNIVERSE,
  getMarketAsset,
  formatAssetPrice,
  THAI_MARKET_SYMBOLS,
} from '../data/market-universe'
import { isThaiListedSymbol } from '../data/thai-set-symbols'
import { calcSupportResistance, type SupportResistanceLevels } from './support-resistance.service'
import { computeValueScore, computeViCompositeScore, getValueAnalysis, VI_VALUE_WEIGHT, VI_TECH_WEIGHT, formatScorePct } from './value-score.service'
import { computeViHorizons, computeViPhases, formatViHorizonsSection, formatViPhasesSection } from './vi-phase.service'
import { isViSymbol, isSuperinvestorSymbol } from '../data/vi-universe'

/** คะแนนรวม (normalized -1..1) ที่ถือว่ามีสัญญาณซื้อน่าพิจารณา */
export const BUY_SIGNAL_THRESHOLD = Number(process.env.SIGNAL_BUY_THRESHOLD || '0.35')
/** เวอร์ชันสูตรวิเคราะห์ — เปลี่ยนเมื่อปรับตัวชี้วัด แล้วบังคับ snapshot ใหม่ */
export const ANALYSIS_VERSION = Number(process.env.ANALYSIS_VERSION || '2')

/** @deprecated ใช้ MARKET_SCAN_SYMBOLS จาก market-universe */
export const DEFAULT_SCAN_SYMBOLS = MARKET_SCAN_SYMBOLS

export const SYMBOL_ALIASES: Record<string, string> = {
  nvidia: 'NVDA', nvda: 'NVDA', นวิดา: 'NVDA',
  apple: 'AAPL', aapl: 'AAPL',
  microsoft: 'MSFT', msft: 'MSFT',
  tesla: 'TSLA', tsla: 'TSLA',
  google: 'GOOGL', googl: 'GOOGL',
  amazon: 'AMZN', amzn: 'AMZN',
  meta: 'META', facebook: 'META',
  ptt: 'PTT', ปตท: 'PTT',
  kbank: 'KBANK', กสิกร: 'KBANK',
  scb: 'SCB', ไทยพาณิชย์: 'SCB',
  aot: 'AOT', สนามบิน: 'AOT',
  advanc: 'ADVANC', ais: 'ADVANC',
  set50: 'SET50', tdex: 'TDEX', '1div': '1DIV', sethd: '1DIV',
  gold: 'GOLD', ทอง: 'GOLD', ทองคำ: 'GOLD',
  spy: 'SPY', qqq: 'QQQ',
}

const KNOWN_SYMBOLS = new Set(MARKET_SCAN_SYMBOLS)

export interface StockAnalysis {
  symbol: string
  displayName: string
  price: number | null
  changePct: number | null
  overall: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  normalizedScore: number
  tieBreakScore: number
  indicators: ReturnType<typeof analyzeIndicators>['indicators']
  supportResistance?: SupportResistanceLevels | null
  valueScore?: number | null
  viCompositeScore?: number | null
  valueReasons?: string[]
}

export function extractSymbolFromText(text: string): string | null {
  const lower = text.toLowerCase()

  for (const [alias, symbol] of Object.entries(SYMBOL_ALIASES)) {
    if (lower.includes(alias)) return symbol
  }

  const tokens = text.toUpperCase().match(/[A-Z]{2,6}/g) || []
  for (const t of tokens) {
    if (KNOWN_SYMBOLS.has(t)) return t
  }

  return null
}

export function hasViIntent(text: string): boolean {
  return /แนว\s*vi|value\s*invest|(?:^|\s)vi(?:\s|$|ของ)/i.test(text)
}

export function isViFundRecommendText(text: string): boolean {
  if (isAddWatchlistText(text)) return false
  if (extractSymbolFromText(text)) return false
  return /กองทุน|\betf\b|rmf|ltf/i.test(text)
    && (hasViIntent(text) || /แนะนำ|ปันผล|ดัชนี|ตัวไหน|อะไรดี|น่าสน|ควร/i.test(text))
}

export function isDividendStockRecommendText(text: string): boolean {
  if (isAddWatchlistText(text)) return false
  if (extractSymbolFromText(text)) return false
  if (isViFundRecommendText(text)) return false
  if (hasViIntent(text)) return false
  return /หุ้น/i.test(text)
    && /ปันผล|dividend|income/i.test(text)
    && /แนะนำ|ตัวไหน|อะไรดี|น่าสน|ควร|ดีๆ|สูง|ควรซื้อ|แนะ/i.test(text)
}

export function isViStockRecommendText(text: string): boolean {
  if (isAddWatchlistText(text)) return false
  if (extractSymbolFromText(text)) return false
  if (isViFundRecommendText(text)) return false
  if (isDividendStockRecommendText(text)) return false
  return /หุ้น/i.test(text)
    && hasViIntent(text)
    && /แนะนำ|ตัวไหน|อะไรดี|น่าสน|ควร/i.test(text)
}

export function isViOnlyRecommendText(text: string): boolean {
  if (isViFundRecommendText(text) || isViStockRecommendText(text)) return false
  if (isAddWatchlistText(text)) return false
  if (extractSymbolFromText(text)) return false
  return hasViIntent(text)
    && /แนะนำ|ตัวไหน|อะไรดี|น่าสน|ควร/i.test(text)
    && !/หุ้น|กองทุน|\betf\b/i.test(text)
}

export function isViStockQueryText(text: string): boolean {
  const symbol = extractSymbolFromText(text)
  if (!symbol) return false
  if (isViFundRecommendText(text)) return false
  return /(?:^|\s)vi(?:\s|$|ของ)|แนว\s*vi|value\s*invest|มูลค่า(?:พื้นฐาน)?|แนว\s*value/i.test(text)
}

export function isSupportResistanceQueryText(text: string): boolean {
  const symbol = extractSymbolFromText(text)
  if (!symbol) return false
  if (isViStockQueryText(text)) return false
  return /แนวรับ|แนวต้าน|support|resistance/i.test(text)
}

export function isStockRecommendText(text: string): boolean {
  if (isAddWatchlistText(text)) return false
  if (extractSymbolFromText(text)) return false
  if (isViFundRecommendText(text)) return false
  if (isViStockRecommendText(text)) return false
  if (isViOnlyRecommendText(text)) return false
  if (isDividendStockRecommendText(text)) return false
  return /แนะนำ.*หุ้น|หุ้น.*แนะนำ|หุ้นตัวไหน|ตัวไหนดี|หุ้นอะไรดี|น่าสนใจ|ควรดูหุ้น|หุ้นวันนี้/i.test(text)
}

export function isStockRelatedText(text: string): boolean {
  if (extractSymbolFromText(text)) return true
  if (isViFundRecommendText(text)) return true
  if (isDividendStockRecommendText(text)) return true
  if (isViStockRecommendText(text)) return true
  if (isViOnlyRecommendText(text)) return true
  if (isStockRecommendText(text)) return true
  return /หุ้น|กองทุน|\betf\b|ราคา|วิเคราะห์|macd|rsi|น่าสน|เป็นอย่างไร|ตอนนี้|ลงทุน|portfolio|watchlist|ติดตามหุ้น|สัญญาณซื้อ|bollinger|แนว\s*vi/i.test(text)
}

export function isAddWatchlistText(text: string): boolean {
  const symbol = extractSymbolFromText(text)
  if (!symbol) return false
  return /ติดตาม|watchlist|เพิ่มหุ้น|เพิ่มในรายการ|^เพิ่ม\s+/i.test(text.trim())
}

export async function analyzeSymbol(symbol: string) {
  const ohlcv = await fetchOHLCV(symbol, '1d', 200)
  if (ohlcv.length < 30) return null
  return analyzeIndicators(ohlcv)
}

export async function analyzeStock(symbol: string, displayName?: string, options?: { includeVi?: boolean }): Promise<StockAnalysis | null> {
  const sym = symbol.toUpperCase()
  try {
    const ohlcv = await fetchOHLCV(sym, '1d', 200)
    if (ohlcv.length < 20) return null

    const analysis = analyzeIndicators(ohlcv)
    const priceData = await fetchCurrentPrice(sym)
    const price = priceData?.price ?? ohlcv[ohlcv.length - 1]?.close ?? null
    const supportResistance = calcSupportResistance(ohlcv, price ?? undefined)

    let valueScore: number | null = null
    let viCompositeScore: number | null = null
    let valueReasons: string[] | undefined
    const shouldIncludeVi = options?.includeVi || isViSymbol(sym) || isSuperinvestorSymbol(sym)
    if (shouldIncludeVi) {
      const value = await computeValueScore(sym, ohlcv)
      valueScore = value.score
      valueReasons = value.reasons
      viCompositeScore = computeViCompositeScore(value.score, analysis.normalizedScore)
    }

    return {
      symbol: sym,
      displayName: displayName || sym,
      price,
      changePct: priceData?.changePct ?? null,
      overall: analysis.overall,
      normalizedScore: analysis.normalizedScore,
      tieBreakScore: analysis.tieBreakScore,
      indicators: analysis.indicators,
      supportResistance,
      valueScore,
      viCompositeScore,
      valueReasons,
    }
  } catch (err) {
    console.error(`[investment] analyzeStock failed for ${sym}:`, err)
    return null
  }
}

function scoreLabel(score: number): string {
  const pct = (Math.round(score * 1000) / 10).toFixed(1)
  if (score >= BUY_SIGNAL_THRESHOLD) return `สัญญาณซื้อ (${pct}/100)`
  if (score <= -BUY_SIGNAL_THRESHOLD) return `สัญญาณขาย (${pct}/100)`
  return `กลางๆ (${pct}/100)`
}

const LINE_TEXT_MAX = 4600
const PICK_ANALYSIS_CONCURRENCY = 4

/** รายละเอียดแต่ละตัว — รูปแบบเดียวกับตอนถามรายตัว */
export function formatStockPickDetailBlock(a: StockAnalysis, rank: number, watchlist?: boolean): string {
  const tag = watchlist ? ' 📋' : ''
  const priceLine = a.price != null
    ? `ราคา: ${formatAssetPrice(a.symbol, a.price)}${a.changePct != null ? ` (${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(2)}%)` : ''}`
    : ''
  const srLine = a.supportResistance
    ? `📍 แนวรับ ${formatAssetPrice(a.symbol, a.supportResistance.support1)} / ${formatAssetPrice(a.symbol, a.supportResistance.support2)} | แนวต้าน ${formatAssetPrice(a.symbol, a.supportResistance.resistance1)} / ${formatAssetPrice(a.symbol, a.supportResistance.resistance2)}`
    : ''
  const valueReasonLine = a.valueReasons?.length
    ? `💡 มูลค่า: ${a.valueReasons.slice(0, 3).join(' · ')}`
    : ''

  return [
    `━━ ${rank}. ${a.displayName} (${a.symbol})${tag}`,
    priceLine,
    `ภาพรวม: ${a.overall} — ${scoreLabel(a.normalizedScore)}`,
    valueReasonLine,
    srLine,
    ...a.indicators.map(i => `• ${i.name}: ${i.signal} (${i.value})`),
    ...a.indicators.map(i => `  ${i.reason}`),
  ].filter(Boolean).join('\n')
}

export function splitIntoLineMessages(sections: string[], maxLen = LINE_TEXT_MAX): string[] {
  const messages: string[] = []
  let current = ''

  for (const section of sections) {
    const candidate = current ? `${current}\n\n${section}` : section
    if (candidate.length > maxLen && current) {
      messages.push(current)
      current = section
    } else {
      current = candidate
    }
  }

  if (current) messages.push(current)
  return messages.length ? messages : ['']
}

function annotateContinuedMessages(messages: string[], titlePrefix: string): string[] {
  if (messages.length <= 1) return messages
  return messages.map((msg, idx) => {
    if (idx === 0) return msg
    return `${titlePrefix} (ต่อ ${idx + 1}/${messages.length})\n\n${msg}`
  })
}

/** หัวข้อสถานะสแกน — ใช้ร่วมกันทุกคำสั่งแนะนำ */
export async function buildRecommendContextHeader(options: {
  candidateCount?: number | null
  rankingNote?: string
  snapshotUpdatedLabel?: string | null
  intervalHours?: number
} = {}): Promise<string> {
  const {
    getMarketScanProgress,
    formatScanBreakdownLabel,
    formatAnalysisProgressLabel,
    runMarketScanBatches,
  } = await import('./market-scanner.service')
  const {
    getRecommendationSnapshotForDisplay,
    ensureRecommendationSnapshotFresh,
  } = await import('./recommendation.service')

  runMarketScanBatches(3).catch(err => console.error('[investment] background scan failed:', err))
  ensureRecommendationSnapshotFresh().catch(err => console.error('[investment] snapshot refresh failed:', err))

  const progress = await getMarketScanProgress()
  const snapshot = await getRecommendationSnapshotForDisplay()
  const breakdown = progress.breakdown ? formatScanBreakdownLabel(progress.breakdown) : ''
  const cached = snapshot?.cachedCount ?? progress.cachedCount
  const total = snapshot?.totalSymbols ?? progress.total
  const candidateCount = options.candidateCount ?? snapshot?.candidateCount ?? null
  const updatedLabel = options.snapshotUpdatedLabel ?? snapshot?.updatedLabel ?? null

  return [
    formatAnalysisProgressLabel(cached, total),
    candidateCount != null ? `ผ่านเกณฑ์ ${candidateCount} ตัว` : '',
    breakdown ? `📋 ${breakdown}` : '',
    updatedLabel
      ? `📊 ${updatedLabel}${options.intervalHours ? ` (จัดอันดับทุก ${options.intervalHours} ชม.)` : ''}`
      : '',
    options.rankingNote,
  ].filter(Boolean).join('\n')
}

async function enrichPicksWithFullAnalysis(
  picks: { symbol: string; displayName: string }[],
): Promise<StockAnalysis[]> {
  const results: StockAnalysis[] = []
  for (let i = 0; i < picks.length; i += PICK_ANALYSIS_CONCURRENCY) {
    const batch = picks.slice(i, i + PICK_ANALYSIS_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(p => analyzeStock(p.symbol, p.displayName)),
    )
    for (const a of batchResults) {
      if (a) results.push(a)
    }
  }
  return results.sort((a, b) => {
    if (b.normalizedScore !== a.normalizedScore) return b.normalizedScore - a.normalizedScore
    return (b.tieBreakScore ?? 0) - (a.tieBreakScore ?? 0)
  })
}

function buildDetailedRecommendMessages(
  analyses: StockAnalysis[],
  options: {
    title: string
    sourceLabel: string
    pickLimit: number
    candidateCount?: number
    watchlistSymbols?: Set<string>
  },
): string[] {
  const thresholdPct = Math.round(BUY_SIGNAL_THRESHOLD * 100)
  const top = analyses
    .filter(a => a.normalizedScore >= BUY_SIGNAL_THRESHOLD)
    .slice(0, options.pickLimit)

  if (!top.length) {
    const best = analyses[0]
    const fallback = [
      options.title,
      options.sourceLabel,
      `ยังไม่มีหุ้นที่คะแนนเกิน ${thresholdPct}/100`,
      best ? `score สูงสุด: ${best.displayName} (${best.symbol}) — ${Math.round(best.normalizedScore * 100)}/100` : '',
      INVESTMENT_DISCLAIMER,
    ].filter(Boolean).join('\n')
    return [fallback]
  }

  const footer = [
    options.candidateCount != null && options.candidateCount > top.length
      ? `✅ แสดง Top ${top.length} จาก ${options.candidateCount} ตัวที่คะแนน ≥ ${thresholdPct}/100`
      : `✅ แสดง Top ${top.length} ตัวที่คะแนน ≥ ${thresholdPct}/100 (📋 = watchlist)`,
    'ดูรายตัวเพิ่ม: "NVDA ตอนนี้เป็นอย่างไร" | ติดตาม: "ติดตาม NVDA"',
    INVESTMENT_DISCLAIMER,
  ].join('\n')

  const header = `${options.title}\n${options.sourceLabel}`
  const pickBlocks = top.map((a, i) =>
    formatStockPickDetailBlock(a, i + 1, options.watchlistSymbols?.has(a.symbol)),
  )

  const messages = splitIntoLineMessages([header, ...pickBlocks, footer])
  if (messages.length <= 1) return messages

  return messages.map((msg, idx) => {
    if (idx === 0) return msg
    const contTitle = options.title.replace(/— Top \d+/, '').trim()
    return `📄 ${contTitle} (ต่อ ${idx + 1}/${messages.length})\n\n${msg}`
  })
}

export function formatStockAnalysisMessage(a: StockAnalysis): string {
  const priceLine = a.price != null
    ? `ราคา: ${formatAssetPrice(a.symbol, a.price)}${a.changePct != null ? ` (${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(2)}%)` : ''}`
    : ''

  const viLine = a.viCompositeScore != null
    ? `คะแนน VI: ${(Math.round(a.viCompositeScore * 1000) / 10).toFixed(1)}/100 (มูลค่า ${(Math.round((a.valueScore ?? 0) * 1000) / 10).toFixed(1)} / เทคนิค ${(Math.round(a.normalizedScore * 1000) / 10).toFixed(1)})`
    : ''

  const srLine = a.supportResistance
    ? `📍 แนวรับ ${formatAssetPrice(a.symbol, a.supportResistance.support1)} / ${formatAssetPrice(a.symbol, a.supportResistance.support2)} | แนวต้าน ${formatAssetPrice(a.symbol, a.supportResistance.resistance1)} / ${formatAssetPrice(a.symbol, a.supportResistance.resistance2)}`
    : ''

  const valueReasonLine = a.valueReasons?.length
    ? `💡 มูลค่า: ${a.valueReasons.slice(0, 3).join(' · ')}`
    : ''

  const lines = [
    `📈 ${a.displayName} (${a.symbol})`,
    priceLine,
    `ภาพรวม: ${a.overall} — ${scoreLabel(a.normalizedScore)}`,
    viLine,
    srLine,
    valueReasonLine,
    '',
    ...a.indicators.map(i => `• ${i.name}: ${i.signal} (${i.value})`),
    ...a.indicators.map(i => `  ${i.reason}`),
    '',
    INVESTMENT_DISCLAIMER,
  ].filter(Boolean)

  return lines.join('\n')
}

export function formatViStockAnalysisMessage(
  a: StockAnalysis,
  valueDetail: Awaited<ReturnType<typeof getValueAnalysis>>,
  phases: import('./vi-phase.service').ViPhasedResult,
  horizons: import('./vi-phase.service').ViHorizonResult,
): string {
  const valueScore = valueDetail.score
  const viComposite = computeViCompositeScore(valueScore, a.normalizedScore)
  const valuePct = Math.round(VI_VALUE_WEIGHT * 100)
  const techPct = Math.round(VI_TECH_WEIGHT * 100)

  const priceLine = a.price != null
    ? `ราคา: ${formatAssetPrice(a.symbol, a.price)}${a.changePct != null ? ` (${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(2)}%)` : ''}`
    : ''

  const srLine = a.supportResistance
    ? `📍 แนวรับ ${formatAssetPrice(a.symbol, a.supportResistance.support1)} / ${formatAssetPrice(a.symbol, a.supportResistance.support2)} | แนวต้าน ${formatAssetPrice(a.symbol, a.supportResistance.resistance1)} / ${formatAssetPrice(a.symbol, a.supportResistance.resistance2)}`
    : ''

  const metricLines = valueDetail.metrics.map(m => `• ${m.label}: ${m.value} — ${m.viNote}`)

  const techBrief = a.indicators
    .filter(i => ['RSI (14)', 'MACD (12,26,9)', 'SMA Trend'].includes(i.name))
    .map(i => `${i.name.split(' ')[0]} ${i.signal}`)
    .join(' | ')

  const lines = [
    `📊 ${a.displayName} (${a.symbol}) — มุมมองแนว VI`,
    priceLine,
    '',
    `คะแนน VI รวม: ${formatScorePct(viComposite)}/100`,
    `├ มูลค่าพื้นฐาน: ${formatScorePct(valueScore)}/100 (${valuePct}%)`,
    `└ จังหวะเทคนิค: ${formatScorePct(a.normalizedScore)}/100 (${techPct}%)`,
    `สไตล์: ${valueDetail.styleLabel}`,
    '',
    '📋 พื้นฐานธุรกิจ',
    ...metricLines,
    '',
    formatViPhasesSection(phases),
    '',
    formatViHorizonsSection(horizons),
    '',
    srLine,
    techBrief ? `\n⏱ จังหวะเทคนิค (ย่อ): ${techBrief}` : '',
    '',
    INVESTMENT_DISCLAIMER,
  ].filter(Boolean)

  return lines.join('\n')
}

export function formatSupportResistanceMessage(a: StockAnalysis): string {
  const priceLine = a.price != null
    ? `ราคา: ${formatAssetPrice(a.symbol, a.price)}${a.changePct != null ? ` (${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(2)}%)` : ''}`
    : ''
  const srLine = a.supportResistance
    ? `📍 แนวรับ ${formatAssetPrice(a.symbol, a.supportResistance.support1)} / ${formatAssetPrice(a.symbol, a.supportResistance.support2)} | แนวต้าน ${formatAssetPrice(a.symbol, a.supportResistance.resistance1)} / ${formatAssetPrice(a.symbol, a.supportResistance.resistance2)}`
    : 'ยังคำนวณแนวรับ/ต้านไม่ได้'

  return [
    `📈 ${a.displayName} (${a.symbol})`,
    priceLine,
    srLine,
    '',
    'คำนวณจาก pivot + swing high/low 60 วัน',
    INVESTMENT_DISCLAIMER,
  ].filter(Boolean).join('\n')
}

async function buildScanUniverse(userId: string) {
  const watched = await getWatchedAssets(userId)
  const watchlistSymbols = new Set(watched.map(w => w.symbol.toUpperCase()))
  const merged = new Map<string, string>()

  for (const asset of MARKET_UNIVERSE) merged.set(asset.symbol, asset.displayName)
  for (const w of watched) merged.set(w.symbol.toUpperCase(), w.displayName)

  return {
    symbols: [...merged.entries()].map(([symbol, displayName]) => ({ symbol, displayName })),
    watchlistSymbols,
    watchlistCount: watched.length,
    marketCount: MARKET_UNIVERSE.length,
  }
}

const SCAN_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || '8')

async function collectStockAnalyses(
  symbols: { symbol: string; displayName: string }[],
): Promise<StockAnalysis[]> {
  const results: StockAnalysis[] = []

  for (let i = 0; i < symbols.length; i += SCAN_CONCURRENCY) {
    const batch = symbols.slice(i, i + SCAN_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async ({ symbol, displayName }) => analyzeStock(symbol, displayName)),
    )
    for (const a of batchResults) {
      if (a) results.push(a)
    }
    if (i + SCAN_CONCURRENCY < symbols.length) {
      await new Promise(r => setTimeout(r, 150))
    }
  }

  return results
}

function formatTopStockPicks(
  results: (StockAnalysis | {
    symbol: string
    displayName: string
    normalizedScore: number
    tieBreakScore?: number
    price: number | null
    changePct: number | null
    supportResistance?: SupportResistanceLevels | null
  })[],
  options: {
    title: string
    sourceLabel: string
    requireBuySignal?: boolean
    watchlistSymbols?: Set<string>
    scannedCount?: number
    pickLimit?: number
    candidateCount?: number
  },
): string {
  if (!results.length) {
    return `ไม่สามารถดึงข้อมูลหุ้นได้ตอนนี้\nลองพิมพ์ชื่อหุ้น เช่น "NVDA ตอนนี้เป็นอย่างไร"\n\n${INVESTMENT_DISCLAIMER}`
  }

  const thresholdPct = Math.round(BUY_SIGNAL_THRESHOLD * 100)
  const sorted = [...results].sort((a, b) => {
    if (b.normalizedScore !== a.normalizedScore) return b.normalizedScore - a.normalizedScore
    return (b.tieBreakScore ?? 0) - (a.tieBreakScore ?? 0)
  })
  const buySignals = sorted.filter(s => s.normalizedScore >= BUY_SIGNAL_THRESHOLD)

  if (options.requireBuySignal && buySignals.length === 0) {
    const best = sorted[0]
    const lines = [
      options.title,
      `🔍 สแกน ${options.scannedCount ?? results.length} ตัวทั้งตลาด + watchlist`,
      `ยังไม่มีหุ้นที่คะแนนเกิน ${thresholdPct}/100 วันนี้`,
      best ? `score สูงสุด: ${best.displayName} (${best.symbol}) — ${Math.round(best.normalizedScore * 100)}/100` : '',
      '',
      'ลองถามใหม่พรุ่งนี้ หรือดูรายละเอียด "NVDA ตอนนี้เป็นอย่างไร"',
      'ติดตาม: "ติดตาม NVDA"',
      '',
      INVESTMENT_DISCLAIMER,
    ].filter(Boolean)
    return lines.join('\n')
  }

  const pickLimit = options.pickLimit ?? 20
  const top = options.requireBuySignal ? buySignals.slice(0, pickLimit) : (
    buySignals.length > 0 ? buySignals.slice(0, pickLimit) : sorted.slice(0, Math.min(3, pickLimit))
  )

  const lines = [
    options.title,
    options.sourceLabel,
    '',
    ...top.map((a, i) => {
      const ch = a.changePct != null ? ` ${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(1)}%` : ''
      const price = a.price != null ? ` ${formatAssetPrice(a.symbol, a.price)}` : ''
      const tag = options.watchlistSymbols?.has(a.symbol) ? ' 📋' : ''
      const main = `${i + 1}. ${a.displayName} (${a.symbol}) — ${scoreLabel(a.normalizedScore)}${price}${ch}${tag}`
      const sr = a.supportResistance
        ? `\n   📍 รับ ${formatAssetPrice(a.symbol, a.supportResistance.support1)} / ${formatAssetPrice(a.symbol, a.supportResistance.support2)} | ต้าน ${formatAssetPrice(a.symbol, a.supportResistance.resistance1)} / ${formatAssetPrice(a.symbol, a.supportResistance.resistance2)}`
        : ''
      return main + sr
    }),
    '',
    options.requireBuySignal
      ? options.candidateCount != null && options.candidateCount > top.length
        ? `✅ แสดง Top ${top.length} จาก ${options.candidateCount} ตัวที่คะแนน ≥ ${thresholdPct}/100 (📋 = watchlist)`
        : `✅ แสดงเฉพาะหุ้นที่คะแนน ≥ ${thresholdPct}/100 (📋 = อยู่ใน watchlist)`
      : buySignals.length === 0 ? `⚠️ ยังไม่มีสัญญาณซื้อชัดเจน — แสดง 3 ตัวที่ score สูงสุด` : '',
    options.candidateCount != null && options.candidateCount > top.length
      ? 'ดูรายการเต็ม: พิมพ์ "วันนี้แนะนำหุ้น" (Top 20)'
      : 'ดูรายละเอียด: "NVDA ตอนนี้เป็นอย่างไร"',
    'ติดตาม: "ติดตาม NVDA"',
    '',
    INVESTMENT_DISCLAIMER,
  ].filter(Boolean)

  return lines.join('\n')
}

async function buildViRecommendMessages(
  watchlistSymbols: Set<string>,
  mode: 'all' | 'funds' | 'stocks',
  title: string,
): Promise<string[] | null> {
  const { getEnrichedViPicks, formatViPickDetailBlock } = await import('./vi-recommend.service')
  const { VI_FUND_PICK_LIMIT, VI_STOCK_PICK_LIMIT, RECOMMENDATION_INTERVAL_HOURS } = await import('./recommendation.service')
  const { VI_VALUE_WEIGHT, VI_TECH_WEIGHT } = await import('./value-score.service')

  const { stocks, funds } = await getEnrichedViPicks()
  const showStocks = mode === 'all' || mode === 'stocks'
  const showFunds = mode === 'all' || mode === 'funds'

  if (mode === 'funds' && !funds.length) return null
  if (mode === 'stocks' && !stocks.length) return null
  if (mode === 'all' && !stocks.length && !funds.length) return null

  const valuePct = Math.round(VI_VALUE_WEIGHT * 100)
  const techPct = Math.round(VI_TECH_WEIGHT * 100)
  const thresholdPct = Math.round(Number(process.env.VI_COMPOSITE_THRESHOLD || '0.3') * 100)

  const pickBlocks: string[] = []
  if (showStocks && stocks.length) {
    for (const p of stocks) {
      pickBlocks.push(formatViPickDetailBlock(p, watchlistSymbols.has(p.symbol)))
    }
  }
  if (showFunds && funds.length) {
    for (const p of funds) {
      pickBlocks.push(formatViPickDetailBlock(p, watchlistSymbols.has(p.symbol)))
    }
  }

  const pickCount = (showStocks ? stocks.length : 0) + (showFunds ? funds.length : 0)
  const sourceLabel = await buildRecommendContextHeader({
    rankingNote: `✅ Top ${pickCount} | คะแนน VI ≥ ${thresholdPct}/100 (มูลค่า ${valuePct}% + เทคนิค ${techPct}%)`,
    intervalHours: RECOMMENDATION_INTERVAL_HOURS,
  })

  const footer = [
    '💡 VI ต้น = คุณภาพ | กลาง = มูลค่า | ปลาย = จังหวะ | ⏳ สั้น/กลาง/ยาว = คุ้มค่าตามเวลา',
    'ดูรายตัวเต็ม: "VI ของ PTT"',
    INVESTMENT_DISCLAIMER,
  ].join('\n')

  const header = `${title}\n${sourceLabel}`
  const messages = splitIntoLineMessages([header, ...pickBlocks, footer])
  if (messages.length <= 1) return messages

  return messages.map((msg, idx) => {
    if (idx === 0) return msg
    return `📄 ${title.replace(/— Top \d+/, '').trim()} (ต่อ ${idx + 1}/${messages.length})\n\n${msg}`
  })
}

export async function buildViFundRecommendReply(userId: string): Promise<string | string[]> {
  const watched = await getWatchedAssets(userId)
  const watchlistSymbols = new Set(watched.map(w => w.symbol.toUpperCase()))
  const { VI_FUND_PICK_LIMIT } = await import('./recommendation.service')
  const messages = await buildViRecommendMessages(
    watchlistSymbols,
    'funds',
    `📊 กองทุน/ETF แนว VI (${bangkokToday()}) — Top ${VI_FUND_PICK_LIMIT}`,
  )

  if (!messages) {
    const header = await buildRecommendContextHeader()
    return [
      `📊 กองทุน/ETF แนว VI (${bangkokToday()})`,
      header,
      'ยังไม่มีกองทุนที่ผ่านเกณฑ์ — ลองถามใหม่ใน 15–30 นาที',
      INVESTMENT_DISCLAIMER,
    ].join('\n')
  }

  return messages
}

export async function buildViStockRecommendReply(userId: string): Promise<string | string[]> {
  const watched = await getWatchedAssets(userId)
  const watchlistSymbols = new Set(watched.map(w => w.symbol.toUpperCase()))
  const { VI_STOCK_PICK_LIMIT } = await import('./recommendation.service')
  const messages = await buildViRecommendMessages(
    watchlistSymbols,
    'stocks',
    `📊 หุ้นแนว VI (${bangkokToday()}) — Top ${VI_STOCK_PICK_LIMIT}`,
  )

  if (!messages) {
    const header = await buildRecommendContextHeader()
    return [
      `📊 หุ้นแนว VI (${bangkokToday()})`,
      header,
      'ยังไม่มีหุ้นที่ผ่านเกณฑ์ — ลองถามใหม่ใน 15–30 นาที',
      INVESTMENT_DISCLAIMER,
    ].join('\n')
  }

  return messages
}

export async function buildViOnlyRecommendReply(userId: string): Promise<string | string[]> {
  const watched = await getWatchedAssets(userId)
  const watchlistSymbols = new Set(watched.map(w => w.symbol.toUpperCase()))
  const { VI_STOCK_PICK_LIMIT, VI_FUND_PICK_LIMIT } = await import('./recommendation.service')
  const messages = await buildViRecommendMessages(
    watchlistSymbols,
    'all',
    `📊 แนะนำแนว VI (${bangkokToday()}) — หุ้น Top ${VI_STOCK_PICK_LIMIT} + กองทุน Top ${VI_FUND_PICK_LIMIT}`,
  )

  if (!messages) {
    const header = await buildRecommendContextHeader()
    return [
      `📊 แนะนำแนว VI (${bangkokToday()})`,
      header,
      'ยังไม่มีรายการที่ผ่านเกณฑ์ — ลองถามใหม่ใน 15–30 นาที',
      INVESTMENT_DISCLAIMER,
    ].join('\n')
  }

  return messages
}

export async function buildDividendStockRecommendReply(userId: string): Promise<string | string[]> {
  const {
    DIVIDEND_MIN_YIELD_PCT,
    DIVIDEND_STOCK_PICK_LIMIT,
    getEnrichedDividendPicks,
  } = await import('./dividend-recommend.service')
  const { RECOMMENDATION_INTERVAL_HOURS } = await import('./recommendation.service')

  const watched = await getWatchedAssets(userId)
  const watchlistSymbols = new Set(watched.map(w => w.symbol.toUpperCase()))
  const picks = await getEnrichedDividendPicks()

  const sourceLabel = await buildRecommendContextHeader({
    rankingNote: `✅ Top ${DIVIDEND_STOCK_PICK_LIMIT} | ปันผล ≥ ${DIVIDEND_MIN_YIELD_PCT}% (อัตราปันผล 55% + คุณภาพ 30% + เทคนิค 15%)`,
    intervalHours: RECOMMENDATION_INTERVAL_HOURS,
  })

  if (!picks.length) {
    return [
      `💰 หุ้นปันผลแนะนำ (${bangkokToday()})`,
      sourceLabel,
      'ยังไม่มีหุ้นปันผลที่ผ่านเกณฑ์ — ลองถามใหม่ใน 15–30 นาที',
      INVESTMENT_DISCLAIMER,
    ].join('\n')
  }

  const analyses = await enrichPicksWithFullAnalysis(
    picks.map(p => ({ symbol: p.symbol, displayName: p.displayName })),
  )

  const title = `💰 หุ้นปันผลแนะนำ (${bangkokToday()}) — Top ${picks.length}`
  const pickBlocks = analyses.map((a, i) => {
    const pick = picks.find(p => p.symbol === a.symbol)
    const divLine = pick ? `${pick.dividendLabel} | คะแนนปันผล ${(Math.round((pick.dividendCompositeScore) * 1000) / 10).toFixed(1)}/100` : ''
    return [divLine, formatStockPickDetailBlock(a, i + 1, watchlistSymbols.has(a.symbol))].filter(Boolean).join('\n')
  })

  const footer = [
    '📌 หุ้นไทย ~ = ประมาณการปันผล | กองทุนปันผล: "แนะนำกองทุน vi"',
    'ดูรายตัวเต็ม: "VI ของ PTT"',
    INVESTMENT_DISCLAIMER,
  ].join('\n')

  const messages = splitIntoLineMessages([`${title}\n${sourceLabel}`, ...pickBlocks, footer])
  if (messages.length <= 1) return messages

  return messages.map((msg, idx) => {
    if (idx === 0) return msg
    return `📄 หุ้นปันผลแนะนำ (ต่อ ${idx + 1}/${messages.length})\n\n${msg}`
  })
}

export async function buildStockRecommendReply(userId: string): Promise<string | string[]> {
  const {
    getRecommendationSnapshotForDisplay,
    RECOMMENDATION_PICK_LIMIT,
    RECOMMENDATION_INTERVAL_HOURS,
  } = await import('./recommendation.service')

  const watched = await getWatchedAssets(userId)
  const watchlistSymbols = new Set(watched.map(w => w.symbol.toUpperCase()))
  const thresholdPct = Math.round(BUY_SIGNAL_THRESHOLD * 100)
  const snapshot = await getRecommendationSnapshotForDisplay()

  if (!snapshot || snapshot.picks.length === 0) {
    const progressLine = await buildRecommendContextHeader({
      rankingNote: `⏳ กำลังอัปเดตอันดับ — ลองถามใหม่ใน 15–30 นาที`,
    })

    const topRows = await (await import('./market-scanner.service')).getCachedTopScores(3)
    if (topRows.length > 0) {
      const best = topRows[0]
      return [
        `📈 หุ้นแนะนำวันนี้ (${bangkokToday()})`,
        progressLine,
        `ยังไม่มี snapshot ที่คำนวณเสร็จ — รอสักครู่แล้วถามใหม่`,
        `score สูงสุดชั่วคราว: ${best.displayName} (${best.symbol}) — ${Math.round(Number(best.normalizedScore) * 100)}/100`,
        INVESTMENT_DISCLAIMER,
      ].join('\n')
    }

    const { symbols } = await buildScanUniverse(userId)
    const results = await collectStockAnalyses(symbols.slice(0, RECOMMENDATION_PICK_LIMIT))
    const analyses = results.filter(Boolean) as StockAnalysis[]
    return buildDetailedRecommendMessages(analyses, {
      title: `📈 หุ้นแนะนำวันนี้ (${bangkokToday()}) — Top ${RECOMMENDATION_PICK_LIMIT}`,
      sourceLabel: progressLine,
      pickLimit: RECOMMENDATION_PICK_LIMIT,
      watchlistSymbols,
    })
  }

  const progressLine = await buildRecommendContextHeader({
    candidateCount: snapshot.candidateCount,
    rankingNote: `✅ Top ${RECOMMENDATION_PICK_LIMIT} | คะแนนเทคนิค ≥ ${thresholdPct}/100`,
    intervalHours: RECOMMENDATION_INTERVAL_HOURS,
  })

  const analyses = await enrichPicksWithFullAnalysis(
    snapshot.picks.slice(0, RECOMMENDATION_PICK_LIMIT).map(p => ({
      symbol: p.symbol,
      displayName: p.displayName,
    })),
  )

  return buildDetailedRecommendMessages(analyses, {
    title: `📈 หุ้นแนะนำ (${bangkokToday()}) — Top ${RECOMMENDATION_PICK_LIMIT}`,
    sourceLabel: progressLine,
    pickLimit: RECOMMENDATION_PICK_LIMIT,
    candidateCount: snapshot.candidateCount,
    watchlistSymbols,
  })
}

export function toLineTextMessages(text: string | string[]): { type: 'text'; text: string }[] {
  return (Array.isArray(text) ? text : [text]).map(t => ({ type: 'text' as const, text: t }))
}

export async function buildStockQueryReply(symbol: string): Promise<string> {
  const analysis = await analyzeStock(symbol)
  if (!analysis) {
    return `ไม่พบข้อมูลหุ้น ${symbol.toUpperCase()} ครับ\nลองสะกดเช่น PTT, NVDA, AAPL\n\n${INVESTMENT_DISCLAIMER}`
  }
  return formatStockAnalysisMessage(analysis)
}

export async function buildViStockQueryReply(symbol: string): Promise<string> {
  const sym = symbol.toUpperCase()
  const displayName = getMarketAsset(sym)?.displayName || sym
  const ohlcv = await fetchOHLCV(sym, '1d', 252)
  const analysis = await analyzeStock(sym, displayName, { includeVi: true })
  if (!analysis) {
    return `ไม่พบข้อมูล ${sym} ครับ\nลองสะกดเช่น PTT, NVDA, AAPL\n\n${INVESTMENT_DISCLAIMER}`
  }
  const valueDetail = await getValueAnalysis(sym, ohlcv)
  const phases = computeViPhases({
    symbol: sym,
    valueDetail,
    technicalScore: analysis.normalizedScore,
    price: analysis.price,
    ohlcv,
    supportResistance: analysis.supportResistance,
    indicators: analysis.indicators,
  })
  const horizons = computeViHorizons({
    symbol: sym,
    valueDetail,
    technicalScore: analysis.normalizedScore,
    price: analysis.price,
    changePct: analysis.changePct,
    supportResistance: analysis.supportResistance,
    indicators: analysis.indicators,
    phases,
  })
  return formatViStockAnalysisMessage(analysis, valueDetail, phases, horizons)
}

export async function buildSupportResistanceQueryReply(symbol: string): Promise<string> {
  const analysis = await analyzeStock(symbol)
  if (!analysis) {
    return `ไม่พบข้อมูลหุ้น ${symbol.toUpperCase()} ครับ\n\n${INVESTMENT_DISCLAIMER}`
  }
  return formatSupportResistanceMessage(analysis)
}

async function wasRecentlyAlerted(userId: string, symbol: string, hours = 24): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3600000)
  const [row] = await db
    .select()
    .from(signalLog)
    .where(and(
      eq(signalLog.userId, userId),
      eq(signalLog.symbol, symbol),
      gte(signalLog.sentAt, since),
    ))
    .orderBy(desc(signalLog.sentAt))
    .limit(1)
  return !!row
}

export async function checkWatchlistBuySignals(): Promise<void> {
  const assets = await db.select().from(watchedAssets)

  for (const asset of assets) {
    const analysis = await analyzeStock(asset.symbol, asset.displayName)
    if (!analysis) continue
    if (analysis.overall !== 'BULLISH') continue
    if (analysis.normalizedScore < BUY_SIGNAL_THRESHOLD) continue

    if (await wasRecentlyAlerted(asset.userId, asset.symbol)) continue

    const [user] = await db.select().from(users).where(eq(users.id, asset.userId)).limit(1)
    if (!user) continue

    const text = [
      `🔔 สัญญาณซื้อ — ${asset.displayName} (${asset.symbol})`,
      `คะแนนรวม: ${Math.round(analysis.normalizedScore * 100)}/100`,
      analysis.price != null ? `ราคา: ${formatAssetPrice(asset.symbol, analysis.price)}` : '',
      '',
      ...analysis.indicators.map(i => `• ${i.name}: ${i.signal} — ${i.reason}`),
      '',
      'เพิ่มใน watchlist แล้ว — indicator ชี้แนวโน้มซื้อน่าพิจารณา',
      INVESTMENT_DISCLAIMER,
    ].filter(Boolean).join('\n')

    const sent = await sendPushWithQuotaCheck(user.id, user.lineUserId, { type: 'text', text })
    if (!sent) continue

    await db.insert(signalLog).values({
      userId: asset.userId,
      symbol: asset.symbol,
      score: String(analysis.normalizedScore),
      overall: analysis.overall,
      timeframe: '1d',
    })

    await new Promise(r => setTimeout(r, 500))
  }
}

export async function buildMorningSummaryReply(userId: string): Promise<string | string[] | null> {
  const { getCachedTopScores } = await import('./market-scanner.service')
  const {
    getRecommendationSnapshotForDisplay,
    isGeneralMarketPick,
    RECOMMENDATION_PICK_LIMIT,
    RECOMMENDATION_INTERVAL_HOURS,
  } = await import('./recommendation.service')
  const { compareAnalysisRank } = await import('./analysis-ranking')

  const pickLimit = RECOMMENDATION_PICK_LIMIT
  const watched = await getWatchedAssets(userId)
  const watchlistSymbols = new Set(watched.map(w => w.symbol.toUpperCase()))
  const thresholdPct = Math.round(BUY_SIGNAL_THRESHOLD * 100)
  const snapshot = await getRecommendationSnapshotForDisplay()
  let picks: {
    symbol: string
    displayName: string
    normalizedScore: number
    tieBreakScore?: number
    price: number | null
    changePct: number | null
  }[] = []

  if (snapshot?.picks.length) {
    picks = snapshot.picks.slice(0, pickLimit).map(p => ({
      symbol: p.symbol,
      displayName: p.displayName,
      normalizedScore: p.normalizedScore,
      tieBreakScore: p.tieBreakScore,
      price: p.price,
      changePct: p.changePct,
    }))
  } else {
    const topRows = (await getCachedTopScores(pickLimit * 5))
      .filter(r => Number(r.analysisVersion ?? 1) >= ANALYSIS_VERSION)
      .filter(isGeneralMarketPick)
      .sort(compareAnalysisRank)
      .slice(0, pickLimit)
    picks = topRows.map(r => ({
      symbol: r.symbol,
      displayName: r.displayName || r.symbol,
      normalizedScore: Number(r.normalizedScore ?? 0),
      tieBreakScore: Number(r.tieBreakScore ?? 0),
      price: r.price != null ? Number(r.price) : null,
      changePct: r.changePct != null ? Number(r.changePct) : null,
    }))
  }

  if (!picks.length) return null

  const analyses = await enrichPicksWithFullAnalysis(
    picks.map(p => ({ symbol: p.symbol, displayName: p.displayName })),
  )
  if (!analyses.length) return null

  const sourceLabel = await buildRecommendContextHeader({
    candidateCount: snapshot?.candidateCount ?? null,
    rankingNote: `✅ สรุปเช้า Top ${pickLimit} (คะแนน ≥ ${thresholdPct}/100)`,
    intervalHours: RECOMMENDATION_INTERVAL_HOURS,
  })

  return buildDetailedRecommendMessages(analyses, {
    title: `☀️ สรุปหุ้นเช้านี้ (${bangkokToday()}) — Top ${pickLimit}`,
    sourceLabel,
    pickLimit,
    candidateCount: snapshot?.candidateCount ?? undefined,
    watchlistSymbols,
  })
}

export async function sendMorningInvestmentSummaries(): Promise<void> {
  const allUsers = await db.select().from(users)
  const enabledUsers = allUsers.filter(u => u.morningSummaryEnabled !== false)

  for (const user of enabledUsers) {
    try {
      const messages = await buildMorningSummaryReply(user.id)
      if (!messages) continue

      const texts = Array.isArray(messages) ? messages : [messages]
      for (const text of texts) {
        await sendPushWithQuotaCheck(user.id, user.lineUserId, { type: 'text', text })
        if (texts.length > 1) await new Promise(r => setTimeout(r, 400))
      }
    } catch (err) {
      console.error(`[investment] morning summary failed for ${user.id}:`, err)
    }
  }
}

export async function addSymbolToWatchlist(userId: string, symbol: string): Promise<string> {
  const sym = symbol.toUpperCase()
  const displayName = sym

  const existing = await getWatchedAssets(userId)
  if (existing.some(w => w.symbol.toUpperCase() === sym)) {
    return `✅ ${sym} อยู่ใน watchlist แล้วครับ — ระบบจะวิเคราะห์และแจ้งเตือนเมื่อคะแนนเกิน ${Math.round(BUY_SIGNAL_THRESHOLD * 100)}/100`
  }

  try {
    await addWatchedAsset(userId, {
      symbol: sym,
      display_name: displayName,
      asset_type: isThaiListedSymbol(sym) || THAI_MARKET_SYMBOLS.has(sym) || getMarketAsset(sym)?.category === 'TH_FUND' ? 'TH_STOCK' : 'US_STOCK',
      currency: getMarketAsset(sym)?.currency === 'THB' ? 'THB' : 'USD',
    })
  } catch (err) {
    console.error(`[investment] addWatchedAsset failed for ${sym}:`, err)
    throw new Error(`เพิ่ม ${sym} ไม่สำเร็จ — ลองใหม่อีกครั้ง`)
  }

  let scoreText = ''
  try {
    const analysis = await analyzeStock(sym, displayName)
    if (analysis) {
      scoreText = `\nคะแนนตอนนี้: ${Math.round(analysis.normalizedScore * 100)}/100 (${analysis.overall})`
      if (analysis.price != null) {
        scoreText += `\nราคา: ${formatAssetPrice(sym, analysis.price)}`
      }
    }
  } catch (err) {
    console.error(`[investment] post-add analysis failed for ${sym}:`, err)
  }

  return `✅ เพิ่ม ${sym} ใน watchlist แล้ว${scoreText}\nจะแจ้งเตือนเมื่อมีสัญญาณซื้อ (คะแนน ≥ ${Math.round(BUY_SIGNAL_THRESHOLD * 100)}/100)\n\n${INVESTMENT_DISCLAIMER}`
}
