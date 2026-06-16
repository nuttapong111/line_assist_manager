import rawFunds from './us-mutual-funds.json'

export interface UsMutualFundSymbol {
  symbol: string
  displayName: string
  yahooSymbol: string
}

export const US_MUTUAL_FUNDS: UsMutualFundSymbol[] = rawFunds as UsMutualFundSymbol[]
export const US_MUTUAL_FUND_COUNT = US_MUTUAL_FUNDS.length

const bySymbol = new Map(US_MUTUAL_FUNDS.map(f => [f.symbol.toUpperCase(), f]))

export function getUsMutualFund(symbol: string): UsMutualFundSymbol | undefined {
  return bySymbol.get(symbol.toUpperCase())
}

export function isUsMutualFund(symbol: string): boolean {
  return bySymbol.has(symbol.toUpperCase())
}
