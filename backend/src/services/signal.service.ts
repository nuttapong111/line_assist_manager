import { db } from '../lib/db'
import { signalLog } from '../lib/schema'
import { fetchOHLCV } from './yahoo.service'
import { analyzeIndicators } from './technicals.service'
import { sendPushWithQuotaCheck } from './push.service'
import { users, watchedAssets } from '../lib/schema'
import { eq } from 'drizzle-orm'
import { INVESTMENT_DISCLAIMER } from '../types'

export async function analyzeSymbol(symbol: string) {
  const ohlcv = await fetchOHLCV(symbol, '1d', 200)
  if (ohlcv.length < 30) return null
  return analyzeIndicators(ohlcv)
}

export async function checkSignalAlerts() {
  const assets = await db.select().from(watchedAssets)

  for (const asset of assets) {
    const analysis = await analyzeSymbol(asset.symbol)
    if (!analysis || analysis.overall === 'NEUTRAL') continue

    const [user] = await db.select().from(users).where(eq(users.id, asset.userId)).limit(1)
    if (!user) continue

    const signalLabel = analysis.overall === 'BULLISH' ? 'สัญญาณซื้อ' : 'สัญญาณขาย'
    const text = `📈 ${asset.displayName} (${asset.symbol})\n${signalLabel} — Score: ${analysis.normalizedScore.toFixed(2)}\n\n${analysis.indicators.map(i => `• ${i.name}: ${i.signal} — ${i.reason}`).join('\n')}\n\n${INVESTMENT_DISCLAIMER}`

    await sendPushWithQuotaCheck(user.id, user.lineUserId, { type: 'text', text })

    await db.insert(signalLog).values({
      userId: asset.userId,
      symbol: asset.symbol,
      score: String(analysis.normalizedScore),
      overall: analysis.overall,
      timeframe: '1d',
    })
  }
}
