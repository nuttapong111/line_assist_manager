import { db } from '../lib/db'
import { transactions, budgetCategories } from '../lib/schema'
import { eq, and, gte, lt, desc, sql } from 'drizzle-orm'

export async function getTransactions(
  userId: string,
  month: string,
  limit = 20,
  offset = 0
) {
  const start = `${month}-01`
  const end = `${month}-32`

  const rows = await db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      categoryId: transactions.categoryId,
      type: transactions.type,
      amount: transactions.amount,
      description: transactions.description,
      merchantName: transactions.merchantName,
      transactionDate: transactions.transactionDate,
      slipImageUrl: transactions.slipImageUrl,
      source: transactions.source,
      createdAt: transactions.createdAt,
      categoryName: budgetCategories.name,
      categoryIcon: budgetCategories.icon,
    })
    .from(transactions)
    .leftJoin(budgetCategories, eq(transactions.categoryId, budgetCategories.id))
    .where(and(
      eq(transactions.userId, userId),
      gte(transactions.transactionDate, start),
      lt(transactions.transactionDate, end)
    ))
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset)

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      gte(transactions.transactionDate, start),
      lt(transactions.transactionDate, end)
    ))

  return { transactions: rows, total: Number(countResult?.count ?? 0) }
}

export async function createTransaction(userId: string, data: {
  type: string
  amount: number | string
  description?: string
  categoryId?: string
  category_id?: string
  transactionDate?: string
  transaction_date?: string
  merchantName?: string
  slipImageUrl?: string
  source?: string
}) {
  const [tx] = await db.insert(transactions).values({
    userId,
    type: data.type,
    amount: String(data.amount),
    description: data.description,
    categoryId: data.categoryId || data.category_id,
    transactionDate: data.transactionDate || data.transaction_date || new Date().toISOString().split('T')[0],
    merchantName: data.merchantName,
    slipImageUrl: data.slipImageUrl,
    source: data.source || 'MANUAL',
  }).returning()
  return tx
}

export async function updateTransaction(userId: string, id: string, data: Partial<{
  type: string
  amount: string
  description: string
  categoryId: string
  transactionDate: string
}>) {
  const [updated] = await db
    .update(transactions)
    .set(data)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .returning()
  return updated
}

export async function deleteTransaction(userId: string, id: string) {
  await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
}

export async function getMonthlySummary(userId: string, month: string) {
  const start = `${month}-01`
  const end = `${month}-32`

  const txs = await db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      gte(transactions.transactionDate, start),
      lt(transactions.transactionDate, end)
    ))

  const expenses = txs.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + Number(t.amount), 0)
  const income = txs.filter(t => t.type === 'INCOME').reduce((s, t) => s + Number(t.amount), 0)

  return { expenses, income, balance: income - expenses, transaction_count: txs.length }
}

export async function exportTransactionsCSV(userId: string, month: string) {
  const { transactions: txs } = await getTransactions(userId, month, 10000, 0)
  const header = 'date,type,amount,description,category\n'
  const rows = txs.map(t =>
  `${t.transactionDate},${t.type},${t.amount},"${t.description || ''}","${t.categoryName || ''}"`
  ).join('\n')
  return header + rows
}
