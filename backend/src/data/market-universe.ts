export type AssetCategory = 'TH_STOCK' | 'US_STOCK' | 'TH_FUND' | 'US_ETF' | 'COMMODITY'

export interface MarketAsset {
  symbol: string
  displayName: string
  category: AssetCategory
  /** Yahoo Finance ticker (ถ้าไม่ใส่ จะใช้ SYMBOL.BK สำหรับหุ้นไทย) */
  yahoo?: string
  currency: 'THB' | 'USD'
}

/** รายการสแกนตลาด — ขยายได้เรื่อยๆ โดยเพิ่มในไฟล์นี้ */
export const MARKET_UNIVERSE: MarketAsset[] = [
  // ── หุ้นไทย (SET) ──
  { symbol: 'PTT', displayName: 'ปตท.', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'KBANK', displayName: 'กสิกรไทย', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'SCB', displayName: 'ไทยพาณิชย์', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'BBL', displayName: 'กรุงเทพ', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'TTB', displayName: 'ทหารไทยธนชาต', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'AOT', displayName: 'ท่าอากาศยานไทย', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'ADVANC', displayName: 'AIS', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'TRUE', displayName: 'ทรู', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'CPALL', displayName: 'ซีพี ออลล์', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'BDMS', displayName: 'โรงพยาบาลกรุงเทพ', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'DELTA', displayName: 'เดลต้า', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'SCC', displayName: 'ปูนซิเมนต์ไทย', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'GULF', displayName: 'GULF', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'PTTGC', displayName: 'PTTGC', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'MINT', displayName: 'ไมเนอร์', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'CRC', displayName: 'เซ็นทรัล รีเทล', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'HMPRO', displayName: 'โฮมโปร', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'IVL', displayName: 'IVL', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'OR', displayName: 'ปตท. น้ำมัน', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'WHA', displayName: 'WHA', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'RATCH', displayName: 'ราชกรุ๊ป', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'CP', displayName: 'เจริญโภคภัณฑ์', category: 'TH_STOCK', currency: 'THB' },
  { symbol: 'MTC', displayName: 'เมืองไทยแคป', category: 'TH_STOCK', currency: 'THB' },

  // ── กองทุน / ETF ไทย ──
  { symbol: 'SET50', displayName: 'SET50 ETF', category: 'TH_FUND', yahoo: 'SET50.BK', currency: 'THB' },
  { symbol: 'TDEX', displayName: 'TDEX ETF', category: 'TH_FUND', yahoo: 'TDEX.BK', currency: 'THB' },
  { symbol: '1DIV', displayName: 'ThaiDEX SET High Dividend ETF', category: 'TH_FUND', yahoo: '1DIV.BK', currency: 'THB' },
  { symbol: 'KFSDIV', displayName: 'กองทุน K DIV', category: 'TH_FUND', yahoo: 'KFSDIV-A.BK', currency: 'THB' },
  { symbol: 'KFGGRM', displayName: 'กองทุน K Global', category: 'TH_FUND', yahoo: 'KFGGRM-A.BK', currency: 'THB' },
  { symbol: 'SCBSEMI', displayName: 'SCB Semiconductor', category: 'TH_FUND', yahoo: 'SCBSEMI.BK', currency: 'THB' },
  { symbol: 'UOBSET50', displayName: 'UOB SET50', category: 'TH_FUND', yahoo: 'UOBSET50.BK', currency: 'THB' },
  { symbol: 'K-US500X', displayName: 'K US500 ETF', category: 'TH_FUND', yahoo: 'K-US500XRMF.BK', currency: 'THB' },
  { symbol: 'KT-AGRI', displayName: 'KT Agriculture', category: 'TH_FUND', yahoo: 'KT-AGRI.BK', currency: 'THB' },
  { symbol: 'K-INDIA', displayName: 'K India Fund', category: 'TH_FUND', yahoo: 'K-INDIA-A.BK', currency: 'THB' },
  { symbol: 'KFS100-A', displayName: 'K SET100', category: 'TH_FUND', yahoo: 'KFS100-A.BK', currency: 'THB' },

  // ── หุ้น US ──
  { symbol: 'NVDA', displayName: 'NVIDIA', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'AAPL', displayName: 'Apple', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'MSFT', displayName: 'Microsoft', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'GOOGL', displayName: 'Alphabet', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'AMZN', displayName: 'Amazon', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'META', displayName: 'Meta', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'TSLA', displayName: 'Tesla', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'AMD', displayName: 'AMD', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'AVGO', displayName: 'Broadcom', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'NFLX', displayName: 'Netflix', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'JPM', displayName: 'JPMorgan', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'V', displayName: 'Visa', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'MA', displayName: 'Mastercard', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'COIN', displayName: 'Coinbase', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'BRK-B', displayName: 'Berkshire', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'KO', displayName: 'Coca-Cola', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'BAC', displayName: 'Bank of America', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'CVX', displayName: 'Chevron', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'OXY', displayName: 'Occidental', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'AXP', displayName: 'American Express', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'PG', displayName: 'Procter & Gamble', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'JNJ', displayName: 'Johnson & Johnson', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'WMT', displayName: 'Walmart', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'UNH', displayName: 'UnitedHealth', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'HD', displayName: 'Home Depot', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'COST', displayName: 'Costco', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'DHR', displayName: 'Danaher', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'CMCSA', displayName: 'Comcast', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'CSCO', displayName: 'Cisco', category: 'US_STOCK', currency: 'USD' },
  { symbol: 'MCO', displayName: 'Moodys', category: 'US_STOCK', currency: 'USD' },

  // ── ETF US ──
  { symbol: 'SPY', displayName: 'S&P 500 ETF', category: 'US_ETF', currency: 'USD' },
  { symbol: 'QQQ', displayName: 'Nasdaq 100 ETF', category: 'US_ETF', currency: 'USD' },
  { symbol: 'VOO', displayName: 'Vanguard S&P 500', category: 'US_ETF', currency: 'USD' },
  { symbol: 'JEPQ', displayName: 'JPMorgan Nasdaq Equity Premium Income', category: 'US_ETF', currency: 'USD' },
  { symbol: 'JEPI', displayName: 'JPMorgan Equity Premium Income', category: 'US_ETF', currency: 'USD' },
  { symbol: 'VTI', displayName: 'Vanguard Total Stock Market', category: 'US_ETF', currency: 'USD' },
  { symbol: 'SCHD', displayName: 'Schwab US Dividend Equity', category: 'US_ETF', currency: 'USD' },
  { symbol: 'GLD', displayName: 'Gold ETF', category: 'US_ETF', currency: 'USD' },
  { symbol: 'IWM', displayName: 'Russell 2000 ETF', category: 'US_ETF', currency: 'USD' },
  { symbol: 'EEM', displayName: 'Emerging Markets ETF', category: 'US_ETF', currency: 'USD' },

  // ── สินค้าโภคภัณฑ์ ──
  { symbol: 'GOLD', displayName: 'ทองคำ', category: 'COMMODITY', yahoo: 'GC=F', currency: 'USD' },
]

const assetBySymbol = new Map(MARKET_UNIVERSE.map(a => [a.symbol.toUpperCase(), a]))

export const MARKET_SCAN_SYMBOLS = MARKET_UNIVERSE.map(a => a.symbol)

export function getMarketAsset(symbol: string): MarketAsset | undefined {
  return assetBySymbol.get(symbol.toUpperCase())
}

export function resolveYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase()
  const asset = assetBySymbol.get(upper)
  if (asset?.yahoo) return asset.yahoo
  if (asset?.category === 'TH_STOCK' || asset?.category === 'TH_FUND') {
    return `${upper}.BK`
  }
  return upper
}

export function formatAssetPrice(symbol: string, price: number): string {
  const asset = getMarketAsset(symbol)
  if (asset?.currency === 'THB') return `฿${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

export function getUniverseScanLabel(): string {
  const counts = MARKET_UNIVERSE.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const parts = [
    counts.TH_STOCK ? `หุ้นไทย ${counts.TH_STOCK}` : '',
    counts.TH_FUND ? `กองทุน/ETF ไทย ${counts.TH_FUND}` : '',
    counts.US_STOCK ? `หุ้น US ${counts.US_STOCK}` : '',
    counts.US_ETF ? `ETF US ${counts.US_ETF}` : '',
    counts.COMMODITY ? `ทองคำ ${counts.COMMODITY}` : '',
  ].filter(Boolean)

  return parts.join(' + ')
}

export const THAI_MARKET_SYMBOLS = new Set(
  MARKET_UNIVERSE.filter(a => a.currency === 'THB').map(a => a.symbol),
)
