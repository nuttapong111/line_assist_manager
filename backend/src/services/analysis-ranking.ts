export interface RankableAnalysisRow {
  symbol: string
  normalizedScore: string | number | null
  tieBreakScore?: string | number | null
  exchange?: string | null
}

export function exchangePriority(exchange: string | null | undefined): number {
  switch (exchange) {
    case 'TH_STOCK': return 4
    case 'TH_FUND': return 3
    case 'US_ETF': return 2
    case 'US_STOCK': return 1
    default: return 0
  }
}

/** จัดอันดับ: คะแนนหลัก → tie-break → ประเภทสินทรัพย์ → สัญลักษณ์ */
export function compareAnalysisRank(a: RankableAnalysisRow, b: RankableAnalysisRow): number {
  const scoreA = Number(a.normalizedScore ?? 0)
  const scoreB = Number(b.normalizedScore ?? 0)
  if (scoreB !== scoreA) return scoreB - scoreA

  const tieA = Number(a.tieBreakScore ?? 0)
  const tieB = Number(b.tieBreakScore ?? 0)
  if (tieB !== tieA) return tieB - tieA

  const exDiff = exchangePriority(b.exchange) - exchangePriority(a.exchange)
  if (exDiff !== 0) return exDiff

  return a.symbol.localeCompare(b.symbol)
}
