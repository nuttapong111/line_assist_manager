import { Client } from '@line/bot-sdk'
import { db } from '../lib/db'
import { pushLog } from '../lib/schema'
import { eq, and } from 'drizzle-orm'

export const lineClient = new Client({
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
})

const MONTHLY_LIMIT = 500

export async function sendPushWithQuotaCheck(
  userId: string,
  lineUserId: string,
  message: Parameters<Client['pushMessage']>[1]
): Promise<boolean> {
  const month = new Date().toISOString().slice(0, 7)

  const [quota] = await db
    .select()
    .from(pushLog)
    .where(and(eq(pushLog.userId, userId), eq(pushLog.month, month)))
    .limit(1)

  const currentCount = quota?.pushCount ?? 0

  if (currentCount >= MONTHLY_LIMIT) {
    console.warn(`[QUOTA] User ${userId} reached ${MONTHLY_LIMIT} pushes for ${month}`)
    return false
  }

  await lineClient.pushMessage(lineUserId, message)

  if (quota) {
    await db
      .update(pushLog)
      .set({ pushCount: currentCount + 1, updatedAt: new Date() })
      .where(eq(pushLog.id, quota.id))
  } else {
    await db.insert(pushLog).values({ userId, month, pushCount: 1 })
  }

  return true
}

export async function getPushQuota(userId: string) {
  const month = new Date().toISOString().slice(0, 7)
  const [quota] = await db
    .select()
    .from(pushLog)
    .where(and(eq(pushLog.userId, userId), eq(pushLog.month, month)))
    .limit(1)

  const pushCount = quota?.pushCount ?? 0
  return { month, push_count: pushCount, limit: MONTHLY_LIMIT, remaining: MONTHLY_LIMIT - pushCount }
}
