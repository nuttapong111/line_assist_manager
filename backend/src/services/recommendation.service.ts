import { db } from '../lib/db'
import { marketAnalysisCache, marketRecommendationSnapshots } from '../lib/schema'
import { desc, eq, gte, and } from 'drizzle-orm'
import { BUY_SIGNAL_THRESHOLD, ANALYSIS_VERSION } from './investment.service'
import { formatBangkokDate, formatBangkokTime } from '../lib/datetime'
import { getMarketScanProgress } from './market-scanner.service'
import { compareAnalysisRank } from './analysis-ranking'
import { isViFundSymbol, isViStockSymbol } from '../data/vi-universe'

export const RECOMMENDATION_PICK_LIMIT = Number(process.env.RECOMMENDATION_PICK_LIMIT || '20')
export const VI_FUND_PICK_LIMIT = Number(process.env.VI_FUND_PICK_LIMIT || '5')
export const VI_STOCK_PICK_LIMIT = Number(process.env.VI_STOCK_PICK_LIMIT || '5')
export const RECOMMENDATION_INTERVAL_HOURS = Number(process.env.RECOMMENDATION_INTERVAL_HOURS || '8')

export interface RecommendationPick {
  rank: number
  symbol: string
  displayName: string
  exchange: string | null
  normalizedScore: number
  tieBreakScore: number
  price: number | null
  changePct: number | null
}

const JUNK_NAME = /\b(WARRANT|WARRANTS|-\s*RIGHTS?|UNITS?|SUBSCRIPTION RECEIPT|DEPOSITARY SHARES? EACH REPRESENTING)\b/i

/** กรอง warrant / หุ้นราคาต่ำ / กองทุน mutual fund / OTC ต่างประเทศ ออกจากรายการแนะนำ */
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
    // OTC / foreign ordinary มักลงท้าย F หรือ Y (เช่น MCDIF, REVXF) — สภาพคล่องต่ำ
    if (exchange === 'US_STOCK' && sym.length === 5 && /[FY]$/.test(sym)) return false
  }

  const price = row.price != null ? Number(row.price) : null
  if (price != null && !Number.isNaN(price) && price < 2) return false

  return true
}

/** รายการแนะนำหุ้น/ETF ทั่วไป — ไม่รวมกองทุนไทย (แยกไว้ในแนว VI) */
export function isGeneralMarketPick(row: {
  symbol: string
  displayName?: string | null
  exchange?: string | null
  price?: string | number | null
}): boolean {
  if (row.exchange === 'TH_FUND') return false
  return isRecommendableCandidate(row)
}

function toPick(row: {
  symbol: string
  displayName: string | null
  exchange: string | null
  normalizedScore: string | null
  tieBreakScore?: string | null
  price: string | null
  changePct: string | null
}, rank: number): RecommendationPick {
  return {
    rank,
    symbol: row.symbol,
    displayName: row.displayName || row.symbol,
    exchange: row.exchange,
    normalizedScore: Number(row.normalizedScore ?? 0),
    tieBreakScore: Number(row.tieBreakScore ?? 0),
    price: row.price != null ? Number(row.price) : null,
    changePct: row.changePct != null ? Number(row.changePct) : null,
  }
}

export async function getViPicksFromCache(): Promise<{ stocks: RecommendationPick[]; funds: RecommendationPick[] }> {
  const rows = await db
    .select()
    .from(marketAnalysisCache)
    .where(and(
      gte(marketAnalysisCache.normalizedScore, String(BUY_SIGNAL_THRESHOLD)),
      eq(marketAnalysisCache.analysisVersion, ANALYSIS_VERSION),
    ))

  const stockRows = rows
    .filter(r => isViStockSymbol(r.symbol) && isRecommendableCandidate(r))
    .sort(compareAnalysisRank)
    .slice(0, VI_STOCK_PICK_LIMIT)
    .map((row, i) => toPick(row, i + 1))

  const fundRows = rows
    .filter(r => isViFundSymbol(r.symbol) && isRecommendableCandidate(r))
    .sort(compareAnalysisRank)
    .slice(0, VI_FUND_PICK_LIMIT)
    .map((row, i) => toPick(row, i + 1))

  return { stocks: stockRows, funds: fundRows }
}

let snapshotLock = false

async function rankAllCachedPicks(
  limit: number,
  minScore = BUY_SIGNAL_THRESHOLD,
): Promise<{ picks: RecommendationPick[]; candidateCount: number; cachedCount: number; totalSymbols: number }> {
  const progress = await getMarketScanProgress()
  const rows = await db
    .select()
    .from(marketAnalysisCache)
    .where(and(
      gte(marketAnalysisCache.normalizedScore, String(minScore)),
      eq(marketAnalysisCache.analysisVersion, ANALYSIS_VERSION),
    ))

  const filtered = rows
    .filter(isGeneralMarketPick)
    .sort(compareAnalysisRank)
  const picks = filtered
    .slice(0, limit)
    .map((row, i) => toPick(row, i + 1))

  return {
    picks,
    candidateCount: filtered.length,
    cachedCount: progress.cachedCount,
    totalSymbols: progress.total,
  }
}

/** คำนวณอันดับจาก cache ทั้งตลาด แล้วบันทึก snapshot */
export async function computeRecommendationSnapshot(): Promise<string | null> {
  if (snapshotLock) {
    console.log('[recommendation] Snapshot already running — skip')
    return null
  }

  snapshotLock = true
  const [running] = await db.insert(marketRecommendationSnapshots).values({
    status: 'running',
    picks: [],
    pickLimit: RECOMMENDATION_PICK_LIMIT,
    scoringVersion: ANALYSIS_VERSION,
  }).returning({ id: marketRecommendationSnapshots.id })

  const snapshotId = running.id

  try {
    console.log('[recommendation] Computing snapshot from full market cache...')
    const { picks, candidateCount, cachedCount, totalSymbols } = await rankAllCachedPicks(RECOMMENDATION_PICK_LIMIT)

    await db.update(marketRecommendationSnapshots).set({
      status: 'completed',
      picks,
      candidateCount,
      cachedCount,
      totalSymbols,
      scoringVersion: ANALYSIS_VERSION,
      completedAt: new Date(),
    }).where(eq(marketRecommendationSnapshots.id, snapshotId))

    console.log(`[recommendation] Snapshot done: top ${picks.length} from ${candidateCount} candidates (${cachedCount}/${totalSymbols} analyzed)`)
    return snapshotId
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.update(marketRecommendationSnapshots).set({
      status: 'failed',
      errorMessage: message,
      completedAt: new Date(),
    }).where(eq(marketRecommendationSnapshots.id, snapshotId))
    console.error('[recommendation] Snapshot failed:', err)
    throw err
  } finally {
    snapshotLock = false
  }
}

export async function getLatestCompletedSnapshot() {
  const [row] = await db
    .select()
    .from(marketRecommendationSnapshots)
    .where(eq(marketRecommendationSnapshots.status, 'completed'))
    .orderBy(desc(marketRecommendationSnapshots.completedAt))
    .limit(1)

  return row ?? null
}

export function formatSnapshotUpdatedLabel(completedAt: Date | string | null): string {
  if (!completedAt) return 'ยังไม่มีข้อมูลอัปเดต'
  const d = typeof completedAt === 'string' ? new Date(completedAt) : completedAt
  return `อัปเดตล่าสุด: ${formatBangkokDate(d)} ${formatBangkokTime(d)} น.`
}

export async function ensureRecommendationSnapshotFresh(): Promise<void> {
  const latest = await getLatestCompletedSnapshot()
  const maxAgeMs = RECOMMENDATION_INTERVAL_HOURS * 60 * 60 * 1000
  const versionStale = !latest || (latest.scoringVersion ?? 1) < ANALYSIS_VERSION
  const timeStale = !latest?.completedAt
    || (Date.now() - new Date(latest.completedAt).getTime() > maxAgeMs)

  if ((versionStale || timeStale) && !snapshotLock) {
    if (versionStale) {
      console.log(`[recommendation] Scoring version ${latest?.scoringVersion ?? 1} → ${ANALYSIS_VERSION}, recomputing snapshot`)
    }
    computeRecommendationSnapshot().catch(err => {
      console.error('[recommendation] Background snapshot failed:', err)
    })
  }
}

export async function getRecommendationSnapshotForDisplay() {
  const latest = await getLatestCompletedSnapshot()
  if (!latest) return null

  const picks = (latest.picks as RecommendationPick[]) || []
  return {
    snapshotId: latest.id,
    picks: picks.slice(0, RECOMMENDATION_PICK_LIMIT),
    candidateCount: latest.candidateCount,
    cachedCount: latest.cachedCount,
    totalSymbols: latest.totalSymbols,
    completedAt: latest.completedAt,
    updatedLabel: formatSnapshotUpdatedLabel(latest.completedAt),
  }
}

/** @deprecated ใช้ getRecommendationSnapshotForDisplay แทน */
export async function getStableDailyBuySignals(limit = RECOMMENDATION_PICK_LIMIT) {
  const snapshot = await getRecommendationSnapshotForDisplay()
  if (!snapshot) return { picks: [], lockedForToday: false }
  return {
    picks: snapshot.picks.slice(0, limit).map(p => ({
      symbol: p.symbol,
      displayName: p.displayName,
      exchange: p.exchange,
      normalizedScore: String(p.normalizedScore),
      overall: null,
      price: p.price != null ? String(p.price) : null,
      changePct: p.changePct != null ? String(p.changePct) : null,
    })),
    lockedForToday: true,
  }
}

export function clearDailyPicksCache(): void {
  // no-op — snapshots เก็บใน DB แล้ว
}
