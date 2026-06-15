import { db } from '../lib/db'
import { newsCache, watchedAssets, portfolioPositions, priceAlerts } from '../lib/schema'
import { eq, and, desc, gte } from 'drizzle-orm'
import { resolveSymbol } from './yahoo.service'
import { getGeminiModel, hasGeminiKey } from '../lib/gemini'
import { bangkokToday } from '../lib/datetime'
import { INVESTMENT_DISCLAIMER } from '../types'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const AI_SUMMARY_HEADLINE = '__AI_SUMMARY__'
const CACHE_HOURS = 12

export interface NewsItem {
  headline: string
  summary: string
  url: string
  datetime: string
  source: string
}

export interface SymbolNewsBundle {
  symbol: string
  displayName: string
  aiSummary: string | null
  articles: NewsItem[]
  fetchedAt: string | null
}

export function hasFinnhubKey(): boolean {
  return !!process.env.FINNHUB_API_KEY?.trim()
}

function finnhubSymbol(symbol: string): string {
  return resolveSymbol(symbol).replace('.BK', '')
}

function dateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

async function finnhubFetch(path: string): Promise<unknown> {
  const key = process.env.FINNHUB_API_KEY
  if (!key) throw new Error('FINNHUB_API_KEY is not set')

  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${FINNHUB_BASE}${path}${sep}token=${key}`, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Finnhub ${res.status}: ${text.slice(0, 120)}`)
  }

  return res.json()
}

export async function fetchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
  const sym = finnhubSymbol(symbol)
  const items = await finnhubFetch(
    `/company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}`,
  ) as Array<{
    headline?: string
    summary?: string
    url?: string
    datetime?: number
    source?: string
  }>

  if (!Array.isArray(items)) return []

  return items.slice(0, 8).map(i => ({
    headline: i.headline || '(ไม่มีหัวข้อ)',
    summary: i.summary || '',
    url: i.url || '',
    datetime: i.datetime ? new Date(i.datetime * 1000).toISOString() : new Date().toISOString(),
    source: i.source || 'Finnhub',
  }))
}

export async function fetchMarketNews(category = 'general'): Promise<NewsItem[]> {
  const items = await finnhubFetch(`/news?category=${category}`) as Array<{
    headline?: string
    summary?: string
    url?: string
    datetime?: number
    source?: string
  }>

  if (!Array.isArray(items)) return []

  return items.slice(0, 10).map(i => ({
    headline: i.headline || '(ไม่มีหัวข้อ)',
    summary: i.summary || '',
    url: i.url || '',
    datetime: i.datetime ? new Date(i.datetime * 1000).toISOString() : new Date().toISOString(),
    source: i.source || 'Finnhub',
  }))
}

export async function summarizeNews(
  symbol: string,
  displayName: string,
  news: NewsItem[],
): Promise<string> {
  if (!news.length) {
    return `${displayName} (${symbol}): ไม่มีข่าวใหม่ในช่วง 7 วันที่ผ่านมา`
  }

  if (!hasGeminiKey()) {
    const top = news.slice(0, 3).map(n => `• ${n.headline}`).join('\n')
    return `${displayName} (${symbol}) — ข่าวล่าสุด:\n${top}`
  }

  const newsText = news
    .slice(0, 5)
    .map((n, i) => `${i + 1}. ${n.headline}\n${n.summary || '(ไม่มีสรุป)'}`)
    .join('\n\n')

  const model = getGeminiModel()
  const result = await model.generateContent(
    `สรุปข่าวของ ${displayName} (${symbol}) เป็นภาษาไทย 2-3 ประโยค
อธิบายว่าข่าวเหล่านี้อาจส่งผลต่อราคาหุ้นอย่างไร
ห้ามใช้คำว่า "ควรซื้อ" "ควรขาย" "แนะนำ"
ใช้คำว่า "อาจส่งผล" "น่าติดตาม" "ปัจจัยที่ควรพิจารณา" แทน

ข่าว:
${newsText}`,
  )

  const text = result.response.text().trim()
  return `📰 ${displayName}: ${text}`
}

async function getCachedRows(symbol: string) {
  const since = new Date(Date.now() - CACHE_HOURS * 3600000)
  return db
    .select()
    .from(newsCache)
    .where(and(eq(newsCache.symbol, symbol.toUpperCase()), gte(newsCache.fetchedAt, since)))
    .orderBy(desc(newsCache.fetchedAt))
}

function rowsToBundle(symbol: string, displayName: string, rows: typeof newsCache.$inferSelect[]): SymbolNewsBundle | null {
  if (!rows.length) return null

  const aiRow = rows.find(r => r.headline === AI_SUMMARY_HEADLINE)
  const articles = rows
    .filter(r => r.headline !== AI_SUMMARY_HEADLINE)
    .map(r => ({
      headline: r.headline,
      summary: r.summary || '',
      url: r.url || '',
      datetime: r.fetchedAt?.toISOString() || new Date().toISOString(),
      source: r.source || 'Finnhub',
    }))

  return {
    symbol: symbol.toUpperCase(),
    displayName,
    aiSummary: aiRow?.summary || null,
    articles,
    fetchedAt: rows[0]?.fetchedAt?.toISOString() || null,
  }
}

export async function getCachedNews(symbol: string, displayName: string): Promise<SymbolNewsBundle | null> {
  const rows = await getCachedRows(symbol)
  return rowsToBundle(symbol, displayName, rows)
}

export async function fetchAndCacheNews(symbol: string, displayName: string): Promise<SymbolNewsBundle> {
  const sym = symbol.toUpperCase()
  const from = dateDaysAgo(7)
  const to = bangkokToday()

  let articles = await fetchCompanyNews(sym, from, to)

  if (articles.length === 0 && sym.endsWith('.BK') === false) {
    try {
      articles = await fetchCompanyNews(`${sym}.BK`, from, to)
    } catch {
      // Thai symbol fallback — ignore
    }
  }

  const aiSummary = await summarizeNews(sym, displayName, articles)

  await db.delete(newsCache).where(eq(newsCache.symbol, sym))

  const now = new Date()
  if (articles.length > 0) {
    await db.insert(newsCache).values(
      articles.map(a => ({
        symbol: sym,
        headline: a.headline,
        summary: a.summary,
        source: a.source,
        url: a.url,
        fetchedAt: now,
      })),
    )
  }

  await db.insert(newsCache).values({
    symbol: sym,
    headline: AI_SUMMARY_HEADLINE,
    summary: aiSummary,
    source: 'Gemini',
    url: to,
    fetchedAt: now,
  })

  return {
    symbol: sym,
    displayName,
    aiSummary,
    articles,
    fetchedAt: now.toISOString(),
  }
}

export async function getNewsForSymbol(symbol: string, displayName: string, force = false): Promise<SymbolNewsBundle> {
  if (!force) {
    const cached = await getCachedNews(symbol, displayName)
    if (cached && (cached.articles.length > 0 || cached.aiSummary)) return cached
  }
  return fetchAndCacheNews(symbol, displayName)
}

export async function getUserSymbolList(userId: string): Promise<Array<{ symbol: string; displayName: string }>> {
  const map = new Map<string, string>()

  const watched = await db.select().from(watchedAssets).where(eq(watchedAssets.userId, userId))
  for (const a of watched) map.set(a.symbol.toUpperCase(), a.displayName)

  const positions = await db.select().from(portfolioPositions).where(eq(portfolioPositions.userId, userId))
  for (const p of positions) map.set(p.symbol.toUpperCase(), p.displayName)

  const alerts = await db
    .select({ symbol: watchedAssets.symbol, displayName: watchedAssets.displayName })
    .from(priceAlerts)
    .innerJoin(watchedAssets, eq(priceAlerts.assetId, watchedAssets.id))
    .where(eq(priceAlerts.userId, userId))

  for (const a of alerts) map.set(a.symbol.toUpperCase(), a.displayName)

  return Array.from(map.entries()).map(([symbol, displayName]) => ({ symbol, displayName }))
}

export async function getNewsFeedForUser(userId: string): Promise<{
  bundles: SymbolNewsBundle[]
  market: NewsItem[]
  disclaimer: string
}> {
  if (!hasFinnhubKey()) {
    return { bundles: [], market: [], disclaimer: INVESTMENT_DISCLAIMER }
  }

  const symbols = await getUserSymbolList(userId)
  const bundles: SymbolNewsBundle[] = []

  for (const { symbol, displayName } of symbols) {
    try {
      const bundle = await getNewsForSymbol(symbol, displayName)
      bundles.push(bundle)
    } catch (err) {
      console.error(`[news] feed failed for ${symbol}:`, err)
    }
  }

  let market: NewsItem[] = []
  try {
    market = await fetchMarketNews('general')
  } catch (err) {
    console.error('[news] market fetch failed:', err)
  }

  return { bundles, market, disclaimer: INVESTMENT_DISCLAIMER }
}

export async function refreshNewsForUser(userId: string): Promise<SymbolNewsBundle[]> {
  const symbols = await getUserSymbolList(userId)
  const results: SymbolNewsBundle[] = []

  for (const { symbol, displayName } of symbols) {
    try {
      results.push(await fetchAndCacheNews(symbol, displayName))
    } catch (err) {
      console.error(`[news] refresh failed for ${symbol}:`, err)
    }
  }

  return results
}

export async function fetchAndCacheAllWatchedNews(): Promise<void> {
  if (!hasFinnhubKey()) {
    console.warn('[news] FINNHUB_API_KEY not set — skip daily fetch')
    return
  }

  const assets = await db.select().from(watchedAssets)
  const positions = await db.select().from(portfolioPositions)

  const map = new Map<string, string>()
  for (const a of assets) map.set(a.symbol.toUpperCase(), a.displayName)
  for (const p of positions) map.set(p.symbol.toUpperCase(), p.displayName)

  console.log(`[news] Daily fetch for ${map.size} symbols`)

  for (const [symbol, displayName] of map) {
    try {
      await fetchAndCacheNews(symbol, displayName)
      await new Promise(r => setTimeout(r, 1100))
    } catch (err) {
      console.error(`[news] daily fetch failed for ${symbol}:`, err)
    }
  }
}
