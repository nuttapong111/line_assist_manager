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
  getUniverseScanLabel,
  formatAssetPrice,
  THAI_MARKET_SYMBOLS,
} from '../data/market-universe'

/** คะแนนรวม (normalized -1..1) ที่ถือว่ามีสัญญาณซื้อน่าพิจารณา */
export const BUY_SIGNAL_THRESHOLD = Number(process.env.SIGNAL_BUY_THRESHOLD || '0.35')

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
  set50: 'SET50', tdex: 'TDEX',
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
  indicators: ReturnType<typeof analyzeIndicators>['indicators']
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

export function isStockRecommendText(text: string): boolean {
  if (isAddWatchlistText(text)) return false
  if (extractSymbolFromText(text)) return false
  return /แนะนำ.*หุ้น|หุ้น.*แนะนำ|หุ้นตัวไหน|ตัวไหนดี|หุ้นอะไรดี|น่าสนใจ|ควรดูหุ้น|หุ้นวันนี้/i.test(text)
}

export function isStockRelatedText(text: string): boolean {
  if (extractSymbolFromText(text)) return true
  if (isStockRecommendText(text)) return true
  return /หุ้น|ราคา|วิเคราะห์|macd|rsi|น่าสน|เป็นอย่างไร|ตอนนี้|ลงทุน|portfolio|watchlist|ติดตามหุ้น|สัญญาณซื้อ|bollinger/i.test(text)
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

export async function analyzeStock(symbol: string, displayName?: string): Promise<StockAnalysis | null> {
  const sym = symbol.toUpperCase()
  try {
    const ohlcv = await fetchOHLCV(sym, '1d', 200)
    if (ohlcv.length < 20) return null

    const analysis = analyzeIndicators(ohlcv)
    const priceData = await fetchCurrentPrice(sym)

    return {
      symbol: sym,
      displayName: displayName || sym,
      price: priceData?.price ?? ohlcv[ohlcv.length - 1]?.close ?? null,
      changePct: priceData?.changePct ?? null,
      overall: analysis.overall,
      normalizedScore: analysis.normalizedScore,
      indicators: analysis.indicators,
    }
  } catch (err) {
    console.error(`[investment] analyzeStock failed for ${sym}:`, err)
    return null
  }
}

function scoreLabel(score: number): string {
  const pct = Math.round(score * 100)
  if (score >= BUY_SIGNAL_THRESHOLD) return `สัญญาณซื้อ (${pct}/100)`
  if (score <= -BUY_SIGNAL_THRESHOLD) return `สัญญาณขาย (${pct}/100)`
  return `กลางๆ (${pct}/100)`
}

export function formatStockAnalysisMessage(a: StockAnalysis): string {
  const priceLine = a.price != null
    ? `ราคา: ${formatAssetPrice(a.symbol, a.price)}${a.changePct != null ? ` (${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(2)}%)` : ''}`
    : ''

  const lines = [
    `📈 ${a.displayName} (${a.symbol})`,
    priceLine,
    `ภาพรวม: ${a.overall} — ${scoreLabel(a.normalizedScore)}`,
    '',
    ...a.indicators.map(i => `• ${i.name}: ${i.signal} (${i.value})`),
    ...a.indicators.map(i => `  ${i.reason}`),
    '',
    INVESTMENT_DISCLAIMER,
  ].filter(Boolean)

  return lines.join('\n')
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

const SCAN_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || '6')

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
  results: StockAnalysis[],
  options: {
    title: string
    sourceLabel: string
    requireBuySignal?: boolean
    watchlistSymbols?: Set<string>
    scannedCount?: number
  },
): string {
  if (!results.length) {
    return `ไม่สามารถดึงข้อมูลหุ้นได้ตอนนี้\nลองพิมพ์ชื่อหุ้น เช่น "NVDA ตอนนี้เป็นอย่างไร"\n\n${INVESTMENT_DISCLAIMER}`
  }

  const thresholdPct = Math.round(BUY_SIGNAL_THRESHOLD * 100)
  const sorted = [...results].sort((a, b) => b.normalizedScore - a.normalizedScore)
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

  const top = options.requireBuySignal ? buySignals.slice(0, 5) : (
    buySignals.length > 0 ? buySignals.slice(0, 5) : sorted.slice(0, 3)
  )

  const lines = [
    options.title,
    options.sourceLabel,
    '',
    ...top.map((a, i) => {
      const ch = a.changePct != null ? ` ${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(1)}%` : ''
      const price = a.price != null ? ` ${formatAssetPrice(a.symbol, a.price)}` : ''
      const tag = options.watchlistSymbols?.has(a.symbol) ? ' 📋' : ''
      return `${i + 1}. ${a.displayName} (${a.symbol}) — ${scoreLabel(a.normalizedScore)}${price}${ch}${tag}`
    }),
    '',
    options.requireBuySignal
      ? `✅ แสดงเฉพาะหุ้นที่คะแนน ≥ ${thresholdPct}/100 (📋 = อยู่ใน watchlist)`
      : buySignals.length === 0 ? `⚠️ ยังไม่มีสัญญาณซื้อชัดเจน — แสดง 3 ตัวที่ score สูงสุด` : '',
    'ดูรายละเอียด: "NVDA ตอนนี้เป็นอย่างไร"',
    'ติดตาม: "ติดตาม NVDA"',
    '',
    INVESTMENT_DISCLAIMER,
  ].filter(Boolean)

  return lines.join('\n')
}

export async function buildStockRecommendReply(userId: string): Promise<string> {
  const {
    getCachedBuySignals,
    getCachedTopScores,
    getMarketScanProgress,
    formatScanBreakdownLabel,
    runMarketScanBatch,
  } = await import('./market-scanner.service')

  const watched = await getWatchedAssets(userId)
  const watchlistSymbols = new Set(watched.map(w => w.symbol.toUpperCase()))
  const progress = await getMarketScanProgress()
  const thresholdPct = Math.round(BUY_SIGNAL_THRESHOLD * 100)
  const breakdownLabel = progress.breakdown ? formatScanBreakdownLabel(progress.breakdown) : ''

  // เร่งสแกน batch ถัดไปในพื้นหลัง (ไม่รอ)
  runMarketScanBatch().catch(err => console.error('[investment] background scan failed:', err))

  const buyRows = await getCachedBuySignals(5)
  const progressLine = progress.total > 0
    ? `🔄 วิเคราะห์แล้ว ${progress.cachedCount}/${progress.total} ตัว\n📋 ${breakdownLabel}`
    : '🔄 กำลังเริ่มสแกนทั้งตลาดในพื้นหลัง...'

  const toAnalysis = (row: typeof buyRows[0]): StockAnalysis => ({
    symbol: row.symbol,
    displayName: row.displayName || row.symbol,
    price: row.price != null ? Number(row.price) : null,
    changePct: row.changePct != null ? Number(row.changePct) : null,
    overall: (row.overall as StockAnalysis['overall']) || 'NEUTRAL',
    normalizedScore: Number(row.normalizedScore ?? 0),
    indicators: [],
  })

  if (buyRows.length > 0) {
    const results = buyRows.map(toAnalysis)
    return formatTopStockPicks(results, {
      title: `📈 หุ้นแนะนำวันนี้ (${bangkokToday()})`,
      sourceLabel: `${progressLine}\n✅ จากข้อมูลสแกนทั้งตลาด — คะแนน ≥ ${thresholdPct}/100`,
      requireBuySignal: true,
      watchlistSymbols,
      scannedCount: progress.cachedCount,
    })
  }

  const topRows = await getCachedTopScores(3)
  if (topRows.length > 0) {
    const best = topRows[0]
    const lines = [
      `📈 หุ้นแนะนำวันนี้ (${bangkokToday()})`,
      progressLine,
      `ยังไม่มีหุ้นที่คะแนนเกิน ${thresholdPct}/100 จากที่สแกนแล้ว`,
      `score สูงสุด: ${best.displayName} (${best.symbol}) — ${Math.round(Number(best.normalizedScore) * 100)}/100`,
      '',
      ...topRows.map((r, i) => {
        const score = Math.round(Number(r.normalizedScore) * 100)
        const tag = watchlistSymbols.has(r.symbol) ? ' 📋' : ''
        return `${i + 1}. ${r.displayName} (${r.symbol}) — ${score}/100${tag}`
      }),
      '',
      'ระบบสแกนต่อเนื่องทุก 5 นาที — ลองถามใหม่ภายหลัง',
      'ดูรายละเอียด: "NVDA ตอนนี้เป็นอย่างไร"',
      INVESTMENT_DISCLAIMER,
    ]
    return lines.join('\n')
  }

  // cache ยังว่าง — fallback สแกนเร็วจากรายการหลัก
  const { symbols, watchlistCount, marketCount } = await buildScanUniverse(userId)
  const results = await collectStockAnalyses(symbols.slice(0, 20))
  return formatTopStockPicks(results, {
    title: `📈 หุ้นแนะนำวันนี้ (${bangkokToday()})`,
    sourceLabel: `⏳ กำลังสแกนทั้งตลาด (${progress.total || marketCount}+ ตัว) — แสดงผลเบื้องต้น ${results.length} ตัว`,
    requireBuySignal: true,
    watchlistSymbols,
    scannedCount: results.length,
  })
}

export async function buildStockQueryReply(symbol: string): Promise<string> {
  const analysis = await analyzeStock(symbol)
  if (!analysis) {
    return `ไม่พบข้อมูลหุ้น ${symbol.toUpperCase()} ครับ\nลองสะกดเช่น PTT, NVDA, AAPL\n\n${INVESTMENT_DISCLAIMER}`
  }
  return formatStockAnalysisMessage(analysis)
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

export async function sendMorningInvestmentSummaries(): Promise<void> {
  const allUsers = await db.select().from(users)
  const enabledUsers = allUsers.filter(u => u.morningSummaryEnabled !== false)

  for (const user of enabledUsers) {
    try {
      const { symbols, watchlistSymbols } = await buildScanUniverse(user.id)
      const results = await collectStockAnalyses(symbols)
      if (!results.length) continue

      const text = formatTopStockPicks(results, {
        title: `☀️ สรุปหุ้นเช้านี้ (${bangkokToday()})`,
        sourceLabel: `🔍 สแกน ${symbols.length} ตัว (${getUniverseScanLabel()})`,
        watchlistSymbols,
      })

      await sendPushWithQuotaCheck(user.id, user.lineUserId, { type: 'text', text })
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
      asset_type: THAI_MARKET_SYMBOLS.has(sym) || getMarketAsset(sym)?.category === 'TH_FUND' ? 'TH_STOCK' : 'US_STOCK',
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
