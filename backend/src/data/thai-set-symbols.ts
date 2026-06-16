import rawSymbols from './thai-set-symbols.json'

export interface ThaiSetSymbol {
  symbol: string
  displayName: string
  market: 'SET' | 'MAI' | string
  yahooSymbol: string
}

/** รายชื่อหุ้น SET + MAI (~730 ตัว) — แหล่งข้อมูลจาก SET/MAI listed companies */
export const THAI_SET_SYMBOLS: ThaiSetSymbol[] = rawSymbols as ThaiSetSymbol[]

export const THAI_SET_SYMBOL_COUNT = THAI_SET_SYMBOLS.length

const bySymbol = new Map(THAI_SET_SYMBOLS.map(s => [s.symbol.toUpperCase(), s]))

export function getThaiSetSymbol(symbol: string): ThaiSetSymbol | undefined {
  return bySymbol.get(symbol.toUpperCase())
}

export function isThaiListedSymbol(symbol: string): boolean {
  return bySymbol.has(symbol.toUpperCase())
}
