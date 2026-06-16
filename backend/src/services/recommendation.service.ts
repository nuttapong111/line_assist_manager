import { db } from '../lib/db'
import { marketAnalysisCache } from '../lib/schema'
import { desc, gte } from 'drizzle-orm'
import { BUY_SIGNAL_THRESHOLD } from './investment.service'
import { bangkokToday } from '../lib/datetime'

export interface RecommendableRow {
  symbol: string
  displayName: string | null
  exchange: string | null
  normalizedScore: string | null
  overall: string | null
  price: string | null
  changePct: string | null
}

const JUNK_NAME = /\b(WARRANT|WARRANTS|-\s*RIGHTS?|UNITS?|SUBSCRIPTION RECEIPT|DEPOSITARY SHARES? EACH REPRESENTING)\b/i

/** กรอง warrant / หุ้นราคาต่ำ / กองทุน mutual fund ออกจากรายการแนะนำ */
export function isRecommendableCandidate(row: {
  symbol: string
  displayName?: string | null
  exchange?: string | null
  price?: string | number | null
}): boolean {
  const sym = row.symbol.toUpperCase()
  const name = row.displayName || ''
  const exchange = row.exchange || ''

  if (exchange === 'US_FUND' || exchange === 'COMMODITY') return false

  if (JUNK_NAME.test(name)) return false

  if (exchange === 'US_STOCK' || exchange === 'US_ETF') {
    if (sym.endsWith('WS') || sym.endsWith('WT') || sym.endsWith('RT') || sym.endsWith('RW')) return false
    if (sym.endsWith('U') && /\bUNIT/i.test(name)) return false
    if (sym.endsWith('R') && /\bRIGHT/i.test(name)) return false
    if (sym.endsWith('W') && sym.length >= 5 && /\bWARRANT/i.test(name)) return false
  }

  const price = row.price != null ? Number(row.price) : null
  if (price != null && !Number.isNaN(price) && price < 2) return false

  return true
}

function scoreOf(row: RecommendableRow): number {
  return Number(row.normalizedScore ?? 0)
}

/** เลือกหุ้นไทย + ETF + หุ้น US ให้สมดุล ไม่เอาแต่ตัวเดียวกันซ้ำประเภท */
export function selectDiversifiedPicks(candidates: RecommendableRow[], limit: number): RecommendableRow[] {
  const sorted = [...candidates].sort((a, b) => scoreOf(b) - scoreOf(a))
  const picked: RecommendableRow[] = []
  const used = new Set<string>()

  const tryPick = (pred: (r: RecommendableRow) => boolean) => {
    const row = sorted.find(r => pred(r) && !used.has(r.symbol))
    if (row) {
      picked.push(row)
      used.add(row.symbol)
    }
  }

  tryPick(r => r.exchange === 'TH_STOCK')
  tryPick(r => r.exchange === 'TH_FUND')
  tryPick(r => r.exchange === 'US_ETF')

  for (const row of sorted) {
    if (picked.length >= limit) break
    if (!used.has(row.symbol)) {
      picked.push(row)
      used.add(row.symbol)
    }
  }

  return picked.slice(0, limit)
}

let dailyPicksCache: { date: string; picks: RecommendableRow[] } | null = null

export function clearDailyPicksCache(): void {
  dailyPicksCache = null
}

/** รายการแนะนำที่ล็อกตลอดวัน (ตามเวลาไทย) — ไม่เปลี่ยนทุกครั้งที่ถาม */
export async function getStableDailyBuySignals(
  limit = 5,
  minScore = BUY_SIGNAL_THRESHOLD,
): Promise<{ picks: RecommendableRow[]; lockedForToday: boolean }> {
  const today = bangkokToday()
  if (dailyPicksCache?.date === today && dailyPicksCache.picks.length > 0) {
    return { picks: dailyPicksCache.picks.slice(0, limit), lockedForToday: true }
  }

  const rows = await db
    .select()
    .from(marketAnalysisCache)
    .where(gte(marketAnalysisCache.normalizedScore, String(minScore)))
    .orderBy(desc(marketAnalysisCache.normalizedScore))
    .limit(200)

  const filtered = rows.filter(isRecommendableCandidate)
  const picks = selectDiversifiedPicks(filtered, Math.max(limit, 5))

  if (picks.length > 0) {
    dailyPicksCache = { date: today, picks }
  }

  return { picks: picks.slice(0, limit), lockedForToday: false }
}
