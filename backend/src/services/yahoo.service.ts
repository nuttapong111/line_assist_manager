import { resolveYahooSymbol } from '../data/market-universe'

export interface OHLCV {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function resolveSymbol(symbol: string): string {
  return resolveYahooSymbol(symbol)
}

export async function fetchOHLCV(symbol: string, interval = '1d', count = 200): Promise<OHLCV[]> {
  const yahooSymbol = resolveSymbol(symbol)
  const period1 = Math.floor((Date.now() - count * 86400000) / 1000)
  const period2 = Math.floor(Date.now() / 1000)

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=${interval}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    })
    const json = await res.json() as {
      chart?: { result?: Array<{
        timestamp?: number[]
        indicators?: { quote?: Array<{
          open?: number[]
          high?: number[]
          low?: number[]
          close?: number[]
          volume?: number[]
        }> }
      }> }
    }

    const result = json.chart?.result?.[0]
    if (!result) return []

    const timestamps = result.timestamp || []
    const quote = result.indicators?.quote?.[0] || {}

    return timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      open: quote.open?.[i] ?? 0,
      high: quote.high?.[i] ?? 0,
      low: quote.low?.[i] ?? 0,
      close: quote.close?.[i] ?? 0,
      volume: quote.volume?.[i] ?? 0,
    })).filter(d => d.close > 0)
  } catch (err) {
    console.error('Yahoo fetch error:', yahooSymbol, err)
    return []
  }
}

export async function fetchCurrentPrice(symbol: string): Promise<{ price: number; changePct: number } | null> {
  const data = await fetchOHLCV(symbol, '1d', 5)
  if (data.length < 2) return null
  const last = data[data.length - 1]
  const prev = data[data.length - 2]
  const changePct = prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0
  return { price: last.close, changePct }
}
