import { db } from '../lib/db'
import { priceAlerts, watchedAssets, priceCache } from '../lib/schema'
import { eq, and } from 'drizzle-orm'
import { fetchCurrentPrice } from './yahoo.service'
import { sendPushWithQuotaCheck } from './push.service'
import { users } from '../lib/schema'
import { INVESTMENT_DISCLAIMER } from '../types'

export async function getPriceAlerts(userId: string) {
  const alerts = await db
    .select({
      id: priceAlerts.id,
      conditionType: priceAlerts.conditionType,
      targetValue: priceAlerts.targetValue,
      repeatMode: priceAlerts.repeatMode,
      isActive: priceAlerts.isActive,
      isTriggered: priceAlerts.isTriggered,
      note: priceAlerts.note,
      symbol: watchedAssets.symbol,
      displayName: watchedAssets.displayName,
    })
    .from(priceAlerts)
    .innerJoin(watchedAssets, eq(priceAlerts.assetId, watchedAssets.id))
    .where(eq(priceAlerts.userId, userId))

  return alerts
}

export async function createPriceAlert(userId: string, data: {
  asset_id: string
  condition_type: string
  target_value: number
  repeat_mode?: string
  note?: string
}) {
  const [alert] = await db.insert(priceAlerts).values({
    userId,
    assetId: data.asset_id,
    conditionType: data.condition_type,
    targetValue: String(data.target_value),
    repeatMode: data.repeat_mode || 'ONCE',
    note: data.note,
  }).returning()
  return alert
}

export async function deletePriceAlert(userId: string, id: string) {
  await db.delete(priceAlerts).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, userId)))
}

export async function checkPriceAlerts() {
  const activeAlerts = await db
    .select({
      alert: priceAlerts,
      asset: watchedAssets,
      user: users,
    })
    .from(priceAlerts)
    .innerJoin(watchedAssets, eq(priceAlerts.assetId, watchedAssets.id))
    .innerJoin(users, eq(priceAlerts.userId, users.id))
    .where(and(eq(priceAlerts.isActive, true), eq(priceAlerts.isTriggered, false)))

  for (const { alert, asset, user } of activeAlerts) {
    const priceData = await fetchCurrentPrice(asset.symbol)
    if (!priceData) continue

    const target = Number(alert.targetValue)
    const price = priceData.price
    let triggered = false

    if (alert.conditionType === 'ABOVE' && price >= target) triggered = true
    if (alert.conditionType === 'BELOW' && price <= target) triggered = true
    if (alert.conditionType === 'CHANGE_PCT' && Math.abs(priceData.changePct) >= target) triggered = true

    if (triggered) {
      const text = `🔔 ${asset.displayName} (${asset.symbol})\nราคา: ฿${price.toLocaleString()} (${priceData.changePct.toFixed(2)}%)\nเงื่อนไข: ${alert.conditionType} ${target}\n\n${INVESTMENT_DISCLAIMER}`

      await sendPushWithQuotaCheck(user.id, user.lineUserId, { type: 'text', text })

      await db.update(priceAlerts).set({
        isTriggered: alert.repeatMode === 'ONCE',
        lastTriggered: new Date(),
        isActive: alert.repeatMode !== 'ONCE',
      }).where(eq(priceAlerts.id, alert.id))
    }

    await db.insert(priceCache).values({
      symbol: asset.symbol,
      price: String(price),
      changePct: String(priceData.changePct),
    }).onConflictDoUpdate({
      target: priceCache.symbol,
      set: { price: String(price), changePct: String(priceData.changePct), fetchedAt: new Date() },
    })
  }
}
