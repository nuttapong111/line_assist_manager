import { db } from '../lib/db'
import { eq } from 'drizzle-orm'
import * as schema from '../lib/schema'

type OwnedTable = 'transactions' | 'appointments' | 'reminders' | 'budgets' | 'priceAlerts' | 'savingGoals' | 'portfolioPositions'

const tableMap: Record<OwnedTable, { id: unknown; userId: unknown }> = {
  transactions: schema.transactions,
  appointments: schema.appointments,
  reminders: schema.reminders,
  budgets: schema.budgets,
  priceAlerts: schema.priceAlerts,
  savingGoals: schema.savingGoals,
  portfolioPositions: schema.portfolioPositions,
}

export async function verifyOwner(
  table: OwnedTable,
  id: string,
  userId: string
): Promise<boolean> {
  const t = tableMap[table]
  const [row] = await db
    .select({ userId: t.userId as typeof schema.transactions.userId })
    .from(t as typeof schema.transactions)
    .where(eq(t.id as typeof schema.transactions.id, id))
    .limit(1)
  return row?.userId === userId
}
