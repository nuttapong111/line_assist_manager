import { db } from '../lib/db'
import { users, budgetCategories } from '../lib/schema'
import { eq } from 'drizzle-orm'
import type { User } from '../types'

const DEFAULT_CATEGORIES = [
  { name: 'อาหาร', icon: '🍜', color: '#2A5C45' },
  { name: 'เดินทาง', icon: '🚗', color: '#2655A0' },
  { name: 'ช้อปปิ้ง', icon: '🛍️', color: '#6344A0' },
  { name: 'บิล', icon: '📄', color: '#B8721A' },
  { name: 'สุขภาพ', icon: '💊', color: '#1A7A6B' },
  { name: 'อื่นๆ', icon: '📦', color: '#636259' },
]

export async function createUserIfNotExists(lineUserId: string): Promise<User> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.lineUserId, lineUserId))
    .limit(1)

  if (existing) return existing as User

  const [newUser] = await db
    .insert(users)
    .values({ lineUserId })
    .returning()

  await db.insert(budgetCategories).values(
    DEFAULT_CATEGORIES.map((c, i) => ({
      userId: newUser.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      sortOrder: i,
    }))
  )

  return newUser as User
}

export async function getUserById(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return user
}

export async function updateUserProfile(userId: string, data: { displayName?: string; pictureUrl?: string }) {
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()
  return updated
}

export async function deleteUserAccount(userId: string) {
  await db.delete(users).where(eq(users.id, userId))
}

export async function getUserStats(userId: string) {
  const month = new Date().toISOString().slice(0, 7)
  const today = new Date().toISOString().split('T')[0]

  const { transactions, appointments, reminders } = await import('../lib/schema')
  const { and, gte, lt, eq: eqOp } = await import('drizzle-orm')

  const txs = await db
    .select()
    .from(transactions)
    .where(and(
      eqOp(transactions.userId, userId),
      gte(transactions.transactionDate, `${month}-01`),
      lt(transactions.transactionDate, `${month}-32`)
    ))

  const expenses = txs.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + Number(t.amount), 0)
  const income = txs.filter(t => t.type === 'INCOME').reduce((s, t) => s + Number(t.amount), 0)

  const todayStart = new Date(today)
  const todayEnd = new Date(today + 'T23:59:59')
  const todayAppts = await db
    .select()
    .from(appointments)
    .where(and(
      eqOp(appointments.userId, userId),
      gte(appointments.startAt, todayStart),
      lt(appointments.startAt, todayEnd)
    ))

  const pendingReminders = await db
    .select()
    .from(reminders)
    .where(and(
      eqOp(reminders.userId, userId),
      eqOp(reminders.isDone, false)
    ))

  return {
    total_expenses_this_month: expenses,
    total_income_this_month: income,
    appointments_today: todayAppts.length,
    pending_reminders: pendingReminders.length,
  }
}
