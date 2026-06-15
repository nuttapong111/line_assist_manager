import { db } from '../lib/db'
import { users, watchedAssets, signalLog } from '../lib/schema'
import { eq, and, gte, desc } from 'drizzle-orm'
import { fetchOHLCV, fetchCurrentPrice, resolveSymbol } from './yahoo.service'
import { analyzeIndicators } from './technicals.service'
import { sendPushWithQuotaCheck } from './push.service'
import { addWatchedAsset, getWatchedAssets } from './portfolio.service'
import { INVESTMENT_DISCLAIMER } from '../types'
import { bangkokToday } from '../lib/datetime'

/** คะแนนรวม (normalized -1..1) ที่ถือว่ามีสัญญาณซื้อน่าพิจารณา */
export const BUY_SIGNAL_THRESHOLD = Number(process.env.SIGNAL_BUY_THRESHOLD || '0.35')

/** หุ้นสแกนตอนเช้าเมื่อยังไม่มี watchlist */
export const DEFAULT_SCAN_SYMBOLS = ['PTT', 'KBANK', 'NVDA', 'AAPL', 'GOLD'] as const

export const SYMBOL_ALIASES: Record<string, string> = {
  nvidia: 'NVDA', nvda: 'NVDA', นวิดา: 'NVDA',
  apple: 'AAPL', aapl: 'AAPL',
  microsoft: 'MSFT', msft: 'MSFT',
  tesla: 'TSLA', tsla: 'TSLA',
  ptt: 'PTT', ปตท: 'PTT',
  kbank: 'KBANK', กสิกร: 'KBANK',
  scb: 'SCB', ไทยพาณิชย์: 'SCB',
  aot: 'AOT', สนามบิน: 'AOT',
  advanc: 'ADVANC', ais: 'ADVANC',
  gold: 'GOLD', ทอง: 'GOLD', ทองคำ: 'GOLD',
}

const KNOWN_SYMBOLS = new Set([
  'PTT', 'SCB', 'AOT', 'ADVANC', 'KBANK', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'GOLD', 'KFSDIV',
])

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

export function isStockRelatedText(text: string): boolean {
  if (extractSymbolFromText(text)) return true
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
  const ohlcv = await fetchOHLCV(sym, '1d', 200)
  if (ohlcv.length < 30) return null

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
}

function scoreLabel(score: number): string {
  const pct = Math.round(score * 100)
  if (score >= BUY_SIGNAL_THRESHOLD) return `สัญญาณซื้อ (${pct}/100)`
  if (score <= -BUY_SIGNAL_THRESHOLD) return `สัญญาณขาย (${pct}/100)`
  return `กลางๆ (${pct}/100)`
}

export function formatStockAnalysisMessage(a: StockAnalysis): string {
  const priceLine = a.price != null
    ? `ราคา: $${a.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}${a.changePct != null ? ` (${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(2)}%)` : ''}`
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
      analysis.price != null ? `ราคา: $${analysis.price.toLocaleString()}` : '',
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
      const watched = await getWatchedAssets(user.id)
      const symbols = watched.length > 0
        ? watched.map(w => ({ symbol: w.symbol, displayName: w.displayName }))
        : DEFAULT_SCAN_SYMBOLS.map(s => ({ symbol: s, displayName: s }))

      const results: StockAnalysis[] = []
      for (const { symbol, displayName } of symbols.slice(0, 8)) {
        const a = await analyzeStock(symbol, displayName)
        if (a) results.push(a)
        await new Promise(r => setTimeout(r, 400))
      }

      if (!results.length) continue

      const sorted = [...results].sort((a, b) => b.normalizedScore - a.normalizedScore)
      const interesting = sorted.filter(s => s.normalizedScore >= 0.15).slice(0, 5)
      const top = interesting.length > 0 ? interesting : sorted.slice(0, 3)

      const lines = [
        `☀️ สรุปหุ้นเช้านี้ (${bangkokToday()})`,
        watched.length > 0 ? '📋 จาก watchlist ของคุณ' : '📋 หุ้นยอดนิยม (เพิ่ม watchlist ในแอปเพื่อติดตามเฉพาะตัว)',
        '',
        ...top.map((a, i) => {
          const ch = a.changePct != null ? ` ${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(1)}%` : ''
          return `${i + 1}. ${a.displayName} (${a.symbol}) — ${scoreLabel(a.normalizedScore)}${ch}`
        }),
        '',
        'พิมพ์ชื่อหุ้นในแชทได้เลย เช่น "NVDA ตอนนี้เป็นอย่างไร"',
        'เพิ่ม watchlist: "ติดตาม NVDA"',
        '',
        INVESTMENT_DISCLAIMER,
      ]

      await sendPushWithQuotaCheck(user.id, user.lineUserId, { type: 'text', text: lines.join('\n') })
    } catch (err) {
      console.error(`[investment] morning summary failed for ${user.id}:`, err)
    }
  }
}

export async function addSymbolToWatchlist(userId: string, symbol: string): Promise<string> {
  const sym = symbol.toUpperCase()
  const resolved = resolveSymbol(sym).replace('.BK', '')
  const displayName = SYMBOL_ALIASES[resolved.toLowerCase()] ? sym : sym

  const existing = await getWatchedAssets(userId)
  if (existing.some(w => w.symbol.toUpperCase() === sym)) {
    return `✅ ${sym} อยู่ใน watchlist แล้วครับ — ระบบจะวิเคราะห์และแจ้งเตือนเมื่อคะแนนเกิน ${Math.round(BUY_SIGNAL_THRESHOLD * 100)}/100`
  }

  await addWatchedAsset(userId, {
    symbol: sym,
    display_name: displayName,
    asset_type: sym.endsWith('BK') || ['PTT', 'KBANK', 'SCB', 'AOT', 'ADVANC', 'KFSDIV'].includes(sym) ? 'TH_STOCK' : 'US_STOCK',
    currency: sym.includes('GOLD') ? 'USD' : 'THB',
  })

  const analysis = await analyzeStock(sym, displayName)
  const scoreText = analysis
    ? `\nคะแนนตอนนี้: ${Math.round(analysis.normalizedScore * 100)}/100 (${analysis.overall})`
    : ''

  return `✅ เพิ่ม ${sym} ใน watchlist แล้ว${scoreText}\nจะแจ้งเตือนเมื่อมีสัญญาณซื้อ (คะแนน ≥ ${Math.round(BUY_SIGNAL_THRESHOLD * 100)}/100)\n\n${INVESTMENT_DISCLAIMER}`
}
