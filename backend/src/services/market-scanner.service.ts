import { db } from '../lib/db'
import { marketSymbols, marketAnalysisCache, marketScanState } from '../lib/schema'
import { eq, desc, gte, sql, asc } from 'drizzle-orm'
import { MARKET_UNIVERSE, resolveYahooSymbol } from '../data/market-universe'
import { analyzeStock, BUY_SIGNAL_THRESHOLD } from './investment.service'
import { registerYahooSymbol, clearYahooSymbolMap } from './yahoo.service'
import { hasFinnhubKey } from './news.service'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const SCAN_BATCH_SIZE = Number(process.env.SCAN_BATCH_SIZE || '15')
const SCAN_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || '4')
const US_SYMBOL_LIMIT = Number(process.env.US_SCAN_LIMIT || '400')
const SCAN_STATE_ID = 'global'

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

async function fetchExchangeSymbols(exchange: 'SET' | 'US'): Promise<SymbolRow[]> {
  const items = await finnhubFetch(`/stock/symbol?exchange=${exchange}`) as Array<{
    symbol: string
    description?: string
    type?: string
    mic?: string
  }>

  let filtered = items.filter(s => !s.type || s.type === 'Common Stock' || s.type === 'EQS')
  if (exchange === 'US') {
    filtered = filtered.filter(s => ['XNAS', 'XNYS', 'ARCX', 'BATS'].includes(s.mic || ''))
    filtered = filtered.slice(0, US_SYMBOL_LIMIT)
  }

  return filtered.map((s, i) => ({
    symbol: s.symbol.toUpperCase(),
    exchange,
    displayName: s.description || s.symbol,
    yahooSymbol: exchange === 'SET' ? `${s.symbol.toUpperCase()}.BK` : s.symbol.toUpperCase(),
    sortOrder: exchange === 'SET' ? 10 + i : 20 + i,
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

export async function refreshMarketSymbolList(): Promise<number> {
  const merged = new Map<string, SymbolRow>()

  for (const row of buildStaticSymbolRows()) merged.set(row.symbol, row)

  if (hasFinnhubKey()) {
    try {
      const setRows = await fetchExchangeSymbols('SET')
      for (const row of setRows) {
        if (!merged.has(row.symbol)) merged.set(row.symbol, row)
      }
      const usRows = await fetchExchangeSymbols('US')
      for (const row of usRows) {
        if (!merged.has(row.symbol)) merged.set(row.symbol, row)
      }
      console.log(`[market-scan] Finnhub symbols: SET ${setRows.length}, US ${usRows.length}`)
    } catch (err) {
      console.error('[market-scan] Finnhub symbol fetch failed:', err)
    }
  } else {
    console.warn('[market-scan] No FINNHUB_API_KEY — using static universe only')
  }

  const all = [...merged.values()]
  for (const row of all) {
    await db.insert(marketSymbols).values({
      symbol: row.symbol,
      exchange: row.exchange,
      displayName: row.displayName,
      yahooSymbol: row.yahooSymbol,
      sortOrder: row.sortOrder,
    }).onConflictDoUpdate({
      target: marketSymbols.symbol,
      set: {
        exchange: row.exchange,
        displayName: row.displayName,
        yahooSymbol: row.yahooSymbol,
        sortOrder: row.sortOrder,
      },
    })
  }

  await db.insert(marketScanState).values({
    id: SCAN_STATE_ID,
    cursorIndex: 0,
    totalSymbols: all.length,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: marketScanState.id,
    set: {
      totalSymbols: all.length,
      cursorIndex: 0,
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

export async function runMarketScanBatch(): Promise<{ scanned: number; cursor: number; total: number }> {
  const [state] = await db.select().from(marketScanState).where(eq(marketScanState.id, SCAN_STATE_ID)).limit(1)
  if (!state || state.totalSymbols === 0) {
    const total = await refreshMarketSymbolList()
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
      await new Promise(r => setTimeout(r, 200))
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
}

export async function getMarketScanProgress() {
  const [state] = await db.select().from(marketScanState).where(eq(marketScanState.id, SCAN_STATE_ID)).limit(1)
  const [cached] = await db.select({ count: sql<number>`count(*)::int` }).from(marketAnalysisCache)
  return {
    total: state?.totalSymbols ?? 0,
    cursor: state?.cursorIndex ?? 0,
    cachedCount: Number(cached?.count ?? 0),
    lastCycleAt: state?.lastCycleAt ?? null,
  }
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
  if (!state || state.totalSymbols === 0) {
    await refreshMarketSymbolList()
  } else {
    await reloadYahooSymbolMap()
  }
}
