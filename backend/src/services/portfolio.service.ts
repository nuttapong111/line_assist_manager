import { db } from '../lib/db'
import { portfolioPositions, portfolioTrades, watchedAssets } from '../lib/schema'
import { eq, and, desc } from 'drizzle-orm'

export async function getPositions(userId: string) {
  const positions = await db
    .select()
    .from(portfolioPositions)
    .where(eq(portfolioPositions.userId, userId))
    .orderBy(desc(portfolioPositions.updatedAt))

  return positions.map(p => {
    const qty = Number(p.quantity)
    const avgCost = Number(p.avgCost)
    const costBasis = qty * avgCost
    return {
      ...p,
      cost_basis: costBasis,
      market_value: costBasis, // updated by price service in production
      unrealized_pnl: 0,
      unrealized_pnl_pct: 0,
    }
  })
}

export async function buyPosition(userId: string, data: {
  symbol: string
  display_name: string
  asset_type: string
  quantity: number
  price: number
  fee?: number
  note?: string
}) {
  const [existing] = await db
    .select()
    .from(portfolioPositions)
    .where(and(eq(portfolioPositions.userId, userId), eq(portfolioPositions.symbol, data.symbol)))
    .limit(1)

  let positionId: string

  if (existing) {
    const oldQty = Number(existing.quantity)
    const oldAvg = Number(existing.avgCost)
    const newQty = oldQty + data.quantity
    const newAvg = (oldQty * oldAvg + data.quantity * data.price) / newQty

    const [updated] = await db
      .update(portfolioPositions)
      .set({
        quantity: String(newQty),
        avgCost: String(newAvg),
        updatedAt: new Date(),
      })
      .where(eq(portfolioPositions.id, existing.id))
      .returning()
    positionId = updated!.id
  } else {
    const [newPos] = await db.insert(portfolioPositions).values({
      userId,
      symbol: data.symbol,
      displayName: data.display_name,
      assetType: data.asset_type,
      quantity: String(data.quantity),
      avgCost: String(data.price),
    }).returning()
    positionId = newPos.id
  }

  await db.insert(portfolioTrades).values({
    positionId,
    userId,
    tradeType: 'BUY',
    quantity: String(data.quantity),
    price: String(data.price),
    fee: String(data.fee || 0),
    note: data.note,
  })

  return getPositions(userId)
}

export async function sellPosition(userId: string, data: {
  symbol: string
  quantity: number
  price: number
  fee?: number
  note?: string
}) {
  const [position] = await db
    .select()
    .from(portfolioPositions)
    .where(and(eq(portfolioPositions.userId, userId), eq(portfolioPositions.symbol, data.symbol)))
    .limit(1)
  if (!position) throw new Error('Position not found')

  const currentQty = Number(position.quantity)
  if (data.quantity > currentQty) throw new Error('Insufficient quantity')

  const newQty = currentQty - data.quantity

  if (newQty <= 0) {
    await db.delete(portfolioPositions).where(eq(portfolioPositions.id, position.id))
  } else {
    await db
      .update(portfolioPositions)
      .set({ quantity: String(newQty), updatedAt: new Date() })
      .where(eq(portfolioPositions.id, position.id))
  }

  await db.insert(portfolioTrades).values({
    positionId: position.id,
    userId,
    tradeType: 'SELL',
    quantity: String(data.quantity),
    price: String(data.price),
    fee: String(data.fee || 0),
    note: data.note,
  })

  return getPositions(userId)
}

export async function getWatchedAssets(userId: string) {
  return db
    .select()
    .from(watchedAssets)
    .where(eq(watchedAssets.userId, userId))
    .orderBy(watchedAssets.sortOrder)
}

export async function addWatchedAsset(userId: string, data: {
  symbol: string
  display_name: string
  asset_type: string
  currency?: string
}) {
  const [asset] = await db.insert(watchedAssets).values({
    userId,
    symbol: data.symbol,
    displayName: data.display_name,
    assetType: data.asset_type,
    currency: data.currency || 'THB',
  }).returning()
  return asset
}

export async function getTrades(userId: string, positionId?: string) {
  const conditions = positionId
    ? and(eq(portfolioTrades.userId, userId), eq(portfolioTrades.positionId, positionId))
    : eq(portfolioTrades.userId, userId)

  return db
    .select()
    .from(portfolioTrades)
    .where(conditions)
    .orderBy(desc(portfolioTrades.tradeDate))
}
