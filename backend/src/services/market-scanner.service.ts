import { db } from '../lib/db'
import { marketSymbols, marketAnalysisCache, marketScanState } from '../lib/schema'
import { eq, desc, gte, sql, asc } from 'drizzle-orm'
import { MARKET_UNIVERSE, resolveYahooSymbol } from '../data/market-universe'
import { THAI_SET_SYMBOLS } from '../data/thai-set-symbols'
import { fetchUsSymbolsFromNasdaqTrader } from './us-market-symbols.service'
import { analyzeStock, BUY_SIGNAL_THRESHOLD } from './investment.service'
import { registerYahooSymbol, clearYahooSymbolMap } from './yahoo.service'
import { hasFinnhubKey } from './news.service'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const SCAN_BATCH_SIZE = Number(process.env.SCAN_BATCH_SIZE || '40')
const SCAN_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || '8')
const US_SYMBOL_LIMIT = Number(process.env.US_SCAN_LIMIT || '0')
const DB_UPSERT_BATCH = Number(process.env.DB_UPSERT_BATCH || '500')
const SCAN_STATE_ID = 'global'
let scanLock = false

async function withScanLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (scanLock) return null
  scanLock = true
  try {
    return await fn()
  } finally {
    scanLock = false
  }
}

interface SymbolRow {
  symbol: string
  exchange: string
  displayName: string
  yahooSymbol: string
  sortOrder: number
}

async function finnhubFetch(path: string): Promise<unknown> {
  const key = process.env.FINNHUB_API_KEY
  if (!key) throw new Error('FINNHUB_API_KEY is not set')
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${FINNHUB_BASE}${path}${sep}token=${key}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path}`)
  return res.json()
}

function buildThaiSetSymbolRows(): SymbolRow[] {
  return THAI_SET_SYMBOLS.map((s, i) => ({
    symbol: s.symbol,
    exchange: 'TH_STOCK',
    displayName: s.displayName,
    yahooSymbol: s.yahooSymbol,
    sortOrder: 5 + i,
  }))
}

async function fetchThaiMarketSymbolsFromFinnhub(): Promise<SymbolRow[]> {
  for (const exchange of ['BK', 'SET'] as const) {
    try {
      const rows = await fetchExchangeSymbols(exchange)
      if (rows.length > 0) {
        console.log(`[market-scan] Thai symbols via Finnhub ${exchange}: ${rows.length}`)
        return rows
      }
    } catch (err) {
      console.error(`[market-scan] Finnhub ${exchange} fetch failed:`, err)
    }
  }
  return []
}

function classifyUsExchange(type?: string): 'US_STOCK' | 'US_ETF' | 'US_FUND' {
  const t = (type || '').toLowerCase()
  if (t.includes('mutual') || t === 'fund') return 'US_FUND'
  if (t.includes('etf') || t.includes('etp') || t.includes('closed-end')) return 'US_ETF'
  return 'US_STOCK'
}

const US_ALLOWED_TYPES = new Set([
  'Common Stock', 'EQS', 'ETP', 'ETF', 'ADR', 'ADRC', 'ADRP', 'ADRW',
  'Closed-End Fund', 'CEF', 'Mutual Fund', 'FUND', 'Fund',
])

const US_ALLOWED_MICS = new Set(['XNAS', 'XNYS', 'ARCX', 'BATS', 'XASE', 'OTC', 'OTCM', 'OOTC'])

async function fetchExchangeSymbols(exchange: 'BK' | 'SET' | 'US'): Promise<SymbolRow[]> {
  const items = await finnhubFetch(`/stock/symbol?exchange=${exchange}`) as Array<{
    symbol: string
    description?: string
    type?: string
    mic?: string
  }>

  if (!Array.isArray(items) || items.length === 0) {
    console.warn(`[market-scan] Finnhub returned empty list for ${exchange}`)
    return []
  }

  let filtered = items
  if (exchange === 'BK' || exchange === 'SET') {
    filtered = items.filter(s => {
      const t = (s.type || '').toLowerCase()
      if (!t) return true
      if (t.includes('warrant') || t.includes('unit') || t.includes('right')) return false
      return true
    })
  } else {
    filtered = items.filter(s => {
      if (!s.type) return true
      if (US_ALLOWED_TYPES.has(s.type)) return true
      const t = s.type.toLowerCase()
      return t.includes('stock') || t.includes('etf') || t.includes('fund')
    })
    filtered = filtered.filter(s => !s.mic || US_ALLOWED_MICS.has(s.mic))
    if (US_SYMBOL_LIMIT > 0) filtered = filtered.slice(0, US_SYMBOL_LIMIT)
  }

  return filtered.map((s, i) => {
    const raw = s.symbol.toUpperCase()
    const appSymbol = raw.replace(/\.BK$/i, '')
    const yahooSymbol = exchange === 'US'
      ? raw
      : (raw.includes('.') ? raw : `${appSymbol}.BK`)
    const usExchange = exchange === 'US' ? classifyUsExchange(s.type) : 'TH_STOCK'
    return {
      symbol: appSymbol,
      exchange: exchange === 'US' ? usExchange : 'TH_STOCK',
      displayName: s.description || appSymbol,
      yahooSymbol,
      sortOrder: exchange === 'US' ? 25000 + i : 10 + i,
    }
  })
}

async function buildUsNasdaqRows(): Promise<SymbolRow[]> {
  const symbols = await fetchUsSymbolsFromNasdaqTrader()
  return symbols.map((s, i) => ({
    symbol: s.symbol,
    exchange: s.category,
    displayName: s.displayName,
    yahooSymbol: s.yahooSymbol,
    sortOrder: (s.category === 'US_ETF' ? 20000 : 10000) + i,
  }))
}

function buildStaticSymbolRows(): SymbolRow[] {
  return MARKET_UNIVERSE.map((a, i) => ({
    symbol: a.symbol,
    exchange: a.category,
    displayName: a.displayName,
    yahooSymbol: a.yahoo || resolveYahooSymbol(a.symbol),
    sortOrder: i,
  }))
}

export async function reloadYahooSymbolMap(): Promise<void> {
  clearYahooSymbolMap()
  const rows = await db.select().from(marketSymbols)
  for (const row of rows) {
    registerYahooSymbol(row.symbol, row.yahooSymbol)
  }
}

export async function refreshMarketSymbolList(resetCursor = false): Promise<number> {
  const [prevState] = await db.select().from(marketScanState).where(eq(marketScanState.id, SCAN_STATE_ID)).limit(1)
  const merged = new Map<string, SymbolRow>()

  for (const row of buildStaticSymbolRows()) merged.set(row.symbol, row)

  const thaiSetRows = buildThaiSetSymbolRows()
  for (const row of thaiSetRows) {
    if (!merged.has(row.symbol)) merged.set(row.symbol, row)
  }
  console.log(`[market-scan] Thai SET/MAI static list: ${thaiSetRows.length} symbols`)

  try {
    const usNasdaqRows = await buildUsNasdaqRows()
    for (const row of usNasdaqRows) {
      if (!merged.has(row.symbol)) merged.set(row.symbol, row)
    }
    const usStocks = usNasdaqRows.filter(r => r.exchange === 'US_STOCK').length
    const usEtfs = usNasdaqRows.filter(r => r.exchange === 'US_ETF').length
    console.log(`[market-scan] US NASDAQ/NYSE list: ${usNasdaqRows.length} (${usStocks} stocks + ${usEtfs} ETFs)`)
  } catch (err) {
    console.error('[market-scan] US NASDAQ list fetch failed:', err)
  }

  if (hasFinnhubKey()) {
    const finnhubThaiRows = await fetchThaiMarketSymbolsFromFinnhub()
    for (const row of finnhubThaiRows) {
      if (!merged.has(row.symbol)) merged.set(row.symbol, row)
    }
    try {
      const usRows = await fetchExchangeSymbols('US')
      for (const row of usRows) {
        if (!merged.has(row.symbol)) merged.set(row.symbol, row)
      }
      console.log(`[market-scan] Finnhub US: ${usRows.length} symbols`)
    } catch (err) {
      console.error('[market-scan] Finnhub US fetch failed:', err)
    }
  } else {
    console.warn('[market-scan] No FINNHUB_API_KEY — using static universe only')
  }

  const all = [...merged.values()]
  const symbolSet = new Set(all.map(r => r.symbol))
  const prevCursor = prevState?.cursorIndex ?? 0
  const nextCursor = resetCursor ? 0 : Math.min(prevCursor, Math.max(all.length - 1, 0))

  const existing = await db.select({ symbol: marketSymbols.symbol }).from(marketSymbols)
  for (const row of existing) {
    if (!symbolSet.has(row.symbol)) {
      await db.delete(marketSymbols).where(eq(marketSymbols.symbol, row.symbol))
      await db.delete(marketAnalysisCache).where(eq(marketAnalysisCache.symbol, row.symbol))
    }
  }

  for (let i = 0; i < all.length; i += DB_UPSERT_BATCH) {
    const chunk = all.slice(i, i + DB_UPSERT_BATCH)
    await db.insert(marketSymbols).values(chunk.map(row => ({
      symbol: row.symbol,
      exchange: row.exchange,
      displayName: row.displayName,
      yahooSymbol: row.yahooSymbol,
      sortOrder: row.sortOrder,
    }))).onConflictDoUpdate({
      target: marketSymbols.symbol,
      set: {
        exchange: sql`excluded.exchange`,
        displayName: sql`excluded.display_name`,
        yahooSymbol: sql`excluded.yahoo_symbol`,
        sortOrder: sql`excluded.sort_order`,
      },
    })
  }

  await db.insert(marketScanState).values({
    id: SCAN_STATE_ID,
    cursorIndex: nextCursor,
    totalSymbols: all.length,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: marketScanState.id,
    set: {
      totalSymbols: all.length,
      cursorIndex: nextCursor,
      updatedAt: new Date(),
    },
  })

  await reloadYahooSymbolMap()
  console.log(`[market-scan] Symbol list refreshed: ${all.length} symbols`)
  return all.length
}

async function upsertAnalysisCache(
  analysis: NonNullable<Awaited<ReturnType<typeof analyzeStock>>>,
  exchange: string,
) {
  await db.insert(marketAnalysisCache).values({
    symbol: analysis.symbol,
    displayName: analysis.displayName,
    exchange,
    normalizedScore: String(analysis.normalizedScore),
    overall: analysis.overall,
    price: analysis.price != null ? String(analysis.price) : null,
    changePct: analysis.changePct != null ? String(analysis.changePct) : null,
    scannedAt: new Date(),
  }).onConflictDoUpdate({
    target: marketAnalysisCache.symbol,
    set: {
      displayName: analysis.displayName,
      exchange,
      normalizedScore: String(analysis.normalizedScore),
      overall: analysis.overall,
      price: analysis.price != null ? String(analysis.price) : null,
      changePct: analysis.changePct != null ? String(analysis.changePct) : null,
      scannedAt: new Date(),
    },
  })
}

export async function runMarketScanBatch(): Promise<{ scanned: number; cursor: number; total: number } | null> {
  return withScanLock(async () => {
  const [state] = await db.select().from(marketScanState).where(eq(marketScanState.id, SCAN_STATE_ID)).limit(1)
  if (!state || state.totalSymbols === 0) {
    const total = await refreshMarketSymbolList(false)
    return { scanned: 0, cursor: 0, total }
  }

  const batch = await db
    .select()
    .from(marketSymbols)
    .orderBy(asc(marketSymbols.sortOrder), asc(marketSymbols.symbol))
    .limit(SCAN_BATCH_SIZE)
    .offset(state.cursorIndex)

  if (!batch.length) {
    await db.update(marketScanState).set({
      cursorIndex: 0,
      lastCycleAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(marketScanState.id, SCAN_STATE_ID))
    return { scanned: 0, cursor: 0, total: state.totalSymbols }
  }

  let scanned = 0
  for (let i = 0; i < batch.length; i += SCAN_CONCURRENCY) {
    const chunk = batch.slice(i, i + SCAN_CONCURRENCY)
    await Promise.all(chunk.map(async (row) => {
      registerYahooSymbol(row.symbol, row.yahooSymbol)
      try {
        const analysis = await analyzeStock(row.symbol, row.displayName || row.symbol)
        if (analysis) {
          await upsertAnalysisCache(analysis, row.exchange)
          scanned++
        }
      } catch (err) {
        console.error(`[market-scan] ${row.symbol} failed:`, err)
      }
    }))
    if (i + SCAN_CONCURRENCY < batch.length) {
      await new Promise(r => setTimeout(r, 100))
    }
  }

  const nextCursor = state.cursorIndex + batch.length
  const wrapped = nextCursor >= state.totalSymbols

  await db.update(marketScanState).set({
    cursorIndex: wrapped ? 0 : nextCursor,
    lastCycleAt: wrapped ? new Date() : state.lastCycleAt,
    updatedAt: new Date(),
  }).where(eq(marketScanState.id, SCAN_STATE_ID))

  console.log(`[market-scan] Batch done: ${scanned}/${batch.length}, cursor ${wrapped ? 0 : nextCursor}/${state.totalSymbols}`)
  return { scanned, cursor: wrapped ? 0 : nextCursor, total: state.totalSymbols }
  })
}

/** รันหลาย batch ต่อรอบ — ใช้ใน cron เพื่อให้ progress เร็วขึ้น */
export async function runMarketScanBatches(count = Number(process.env.SCAN_BATCHES_PER_CRON || '8')): Promise<void> {
  for (let i = 0; i < count; i++) {
    const result = await runMarketScanBatch()
    if (!result) break
    if (i < count - 1) await new Promise(r => setTimeout(r, 150))
  }
}

export async function getMarketScanProgress() {
  const [state] = await db.select().from(marketScanState).where(eq(marketScanState.id, SCAN_STATE_ID)).limit(1)
  const [cached] = await db.select({ count: sql<number>`count(*)::int` }).from(marketAnalysisCache)
  const breakdownRows = await db
    .select({
      exchange: marketSymbols.exchange,
      count: sql<number>`count(*)::int`,
    })
    .from(marketSymbols)
    .groupBy(marketSymbols.exchange)

  const breakdown: Record<string, number> = {}
  for (const row of breakdownRows) {
    breakdown[row.exchange] = Number(row.count)
  }

  const thaiStocks = breakdown.TH_STOCK ?? 0
  const thaiFunds = breakdown.TH_FUND ?? 0
  const usStocks = breakdown.US_STOCK ?? 0
  const usEtfs = breakdown.US_ETF ?? 0
  const usFunds = breakdown.US_FUND ?? 0
  const commodity = breakdown.COMMODITY ?? 0
  const listedTotal = thaiStocks + thaiFunds + usStocks + usEtfs + usFunds + commodity

  return {
    total: state?.totalSymbols ?? listedTotal,
    cursor: state?.cursorIndex ?? 0,
    cachedCount: Number(cached?.count ?? 0),
    scannedPosition: Math.min(state?.cursorIndex ?? 0, state?.totalSymbols ?? listedTotal),
    lastCycleAt: state?.lastCycleAt ?? null,
    updatedAt: state?.updatedAt ?? null,
    breakdown: {
      thaiStocks,
      thaiFunds,
      usStocks,
      usEtfs,
      usFunds,
      commodity,
      raw: breakdown,
    },
  }
}

export function formatScanBreakdownLabel(b: NonNullable<Awaited<ReturnType<typeof getMarketScanProgress>>['breakdown']>): string {
  const parts = [
    b.thaiStocks ? `หุ้นไทยในระบบ ${b.thaiStocks}` : '',
    b.thaiFunds ? `กองทุน/ETF ไทย ${b.thaiFunds}` : '',
    b.usStocks ? `หุ้น US ${b.usStocks}` : '',
    b.usEtfs ? `ETF US ${b.usEtfs}` : '',
    b.usFunds ? `กองทุน US ${b.usFunds}` : '',
    b.commodity ? `ทองคำ ${b.commodity}` : '',
  ].filter(Boolean)
  return parts.join(' + ') || 'กำลังโหลดรายการ...'
}

export async function getCachedBuySignals(limit = 5, minScore = BUY_SIGNAL_THRESHOLD) {
  return db
    .select()
    .from(marketAnalysisCache)
    .where(gte(marketAnalysisCache.normalizedScore, String(minScore)))
    .orderBy(desc(marketAnalysisCache.normalizedScore))
    .limit(limit)
}

export async function getCachedTopScores(limit = 3) {
  return db
    .select()
    .from(marketAnalysisCache)
    .orderBy(desc(marketAnalysisCache.normalizedScore))
    .limit(limit)
}

export async function ensureMarketScanInitialized(): Promise<void> {
  const [state] = await db.select().from(marketScanState).where(eq(marketScanState.id, SCAN_STATE_ID)).limit(1)
  const progress = await getMarketScanProgress()
  const thaiStocks = progress.breakdown?.thaiStocks ?? 0
  const usStocks = progress.breakdown?.usStocks ?? 0
  const usFunds = progress.breakdown?.usFunds ?? 0
  const needsRefresh = thaiStocks < 100 || usStocks < 5000 || usFunds > 0

  if (!state || state.totalSymbols === 0 || needsRefresh) {
    if (needsRefresh && state && state.totalSymbols > 0) {
      console.log(`[market-scan] Refresh needed (TH:${thaiStocks} US:${usStocks} legacyFunds:${usFunds})`)
    }
    await refreshMarketSymbolList(needsRefresh)
  } else {
    await reloadYahooSymbolMap()
  }
}
