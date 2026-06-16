import { MARKET_UNIVERSE, getMarketAsset } from './market-universe'

/** หุ้น US ที่มักปรากฏในพอร์ตนักลงทุนชื่อดาน (Buffett, 13F overlap) */
export const SUPERINVESTOR_US_SYMBOLS = [
  'AAPL', 'KO', 'BAC', 'CVX', 'OXY', 'AXP', 'MCO', 'PG', 'JNJ', 'WMT',
  'V', 'MA', 'JPM', 'UNH', 'HD', 'COST', 'BRK-B', 'DHR', 'CMCSA', 'CSCO',
] as const

/** กองทุน/ETF แนว VI — ดัชนี / ปันผล / ระยะยาว */
export const VI_FUND_SYMBOLS = [
  'SET50', 'TDEX', '1DIV', 'KFSDIV', 'UOBSET50', 'KFS100-A', 'K-US500X', 'KFGGRM',
  'VOO', 'VTI', 'SPY', 'SCHD', 'JEPI', 'JEPQ',
] as const

/** หุ้นไทยคุณภาพ — ปันผล / พื้นฐานดี */
export const VI_STOCK_SYMBOLS_TH = [
  'KBANK', 'SCB', 'BBL', 'TTB',
  'PTT', 'PTTGC', 'OR',
  'ADVANC', 'AOT', 'CPALL',
  'BDMS', 'MINT', 'CRC',
  'SCC', 'DELTA', 'GULF',
  'HMPRO', 'MTC', 'RATCH', 'WHA',
] as const

export const VI_STOCK_SYMBOLS_US = SUPERINVESTOR_US_SYMBOLS

export const VI_STOCK_SYMBOLS = [
  ...VI_STOCK_SYMBOLS_TH,
  ...VI_STOCK_SYMBOLS_US,
] as const

const viFundSet = new Set<string>(VI_FUND_SYMBOLS)
const viStockSet = new Set<string>(VI_STOCK_SYMBOLS)
const superinvestorSet = new Set<string>(SUPERINVESTOR_US_SYMBOLS)

export function isViFundSymbol(symbol: string): boolean {
  return viFundSet.has(symbol.toUpperCase())
}

export function isViStockSymbol(symbol: string): boolean {
  return viStockSet.has(symbol.toUpperCase())
}

export function isSuperinvestorSymbol(symbol: string): boolean {
  return superinvestorSet.has(symbol.toUpperCase())
}

export function isViSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase()
  return viFundSet.has(s) || viStockSet.has(s)
}

export function getViFundDisplayName(symbol: string): string {
  return getMarketAsset(symbol)?.displayName || symbol
}

export function getViStockDisplayName(symbol: string): string {
  return getMarketAsset(symbol)?.displayName || symbol
}

export function getRegisteredViFunds() {
  return VI_FUND_SYMBOLS.filter(s => MARKET_UNIVERSE.some(a => a.symbol === s))
}
