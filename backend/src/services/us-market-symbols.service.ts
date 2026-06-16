const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'

export interface UsMarketSymbol {
  symbol: string
  displayName: string
  category: 'US_STOCK' | 'US_ETF'
  yahooSymbol: string
}

function isValidUsSymbol(symbol: string): boolean {
  if (!symbol || symbol.includes('$') || symbol.includes('.')) return false
  if (symbol.length > 6) return false
  return /^[A-Z0-9-]+$/.test(symbol)
}

function isJunkUsListing(symbol: string, name: string): boolean {
  const n = name.toUpperCase()
  if (/\b(WARRANT|WARRANTS|RIGHTS?|UNITS?)\b/.test(n)) return true
  const sym = symbol.toUpperCase()
  if (sym.endsWith('WS') || sym.endsWith('WT') || sym.endsWith('RT') || sym.endsWith('RW')) return true
  if (sym.endsWith('U') && n.includes('UNIT')) return true
  if (sym.endsWith('R') && n.includes('RIGHT')) return true
  return false
}

function parseNasdaqListed(text: string): UsMarketSymbol[] {
  const rows: UsMarketSymbol[] = []
  const lines = text.trim().split('\n')
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('|')
    if (parts.length < 8) continue
    const [symbol, name, , testIssue, , , etfFlag] = parts
    if (testIssue === 'Y' || !isValidUsSymbol(symbol) || isJunkUsListing(symbol, name)) continue
    rows.push({
      symbol,
      displayName: name.slice(0, 120),
      category: etfFlag === 'Y' ? 'US_ETF' : 'US_STOCK',
      yahooSymbol: symbol,
    })
  }
  return rows
}

function parseOtherListed(text: string): UsMarketSymbol[] {
  const rows: UsMarketSymbol[] = []
  const lines = text.trim().split('\n')
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('|')
    if (parts.length < 8) continue
    const [symbol, name, , , etfFlag, , testIssue] = parts
    if (testIssue === 'Y' || !isValidUsSymbol(symbol) || isJunkUsListing(symbol, name)) continue
    rows.push({
      symbol,
      displayName: name.slice(0, 120),
      category: etfFlag === 'Y' ? 'US_ETF' : 'US_STOCK',
      yahooSymbol: symbol,
    })
  }
  return rows
}

export async function fetchUsSymbolsFromNasdaqTrader(): Promise<UsMarketSymbol[]> {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; MyAssist/1.0)' }
  const [nasdaqRes, otherRes] = await Promise.all([
    fetch(NASDAQ_LISTED_URL, { signal: AbortSignal.timeout(30000), headers }),
    fetch(OTHER_LISTED_URL, { signal: AbortSignal.timeout(30000), headers }),
  ])
  if (!nasdaqRes.ok) throw new Error(`NASDAQ listed fetch failed: ${nasdaqRes.status}`)
  if (!otherRes.ok) throw new Error(`Other listed fetch failed: ${otherRes.status}`)

  const merged = new Map<string, UsMarketSymbol>()
  for (const row of [...parseNasdaqListed(await nasdaqRes.text()), ...parseOtherListed(await otherRes.text())]) {
    if (!merged.has(row.symbol)) merged.set(row.symbol, row)
  }
  return [...merged.values()]
}
