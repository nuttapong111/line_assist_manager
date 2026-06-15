import { db } from '../lib/db'
import { budgets, budgetCategories, transactions } from '../lib/schema'
import { eq, and, gte, lt } from 'drizzle-orm'
import { nextMonthStart } from '../lib/datetime'
import type { BudgetSummary } from '../types'

export async function getBudgetCategories(userId: string) {
  return db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.userId, userId))
    .orderBy(budgetCategories.sortOrder)
}

export async function createBudgetCategory(userId: string, data: { name: string; icon?: string; color?: string }) {
  const [cat] = await db.insert(budgetCategories).values({
    userId,
    name: data.name,
    icon: data.icon || '📦',
    color: data.color || '#2A5C45',
  }).returning()
  return cat
}

export async function getBudgets(userId: string, month: string) {
  const cats = await getBudgetCategories(userId)
  const budgetRows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.month, month)))

  const start = `${month}-01`
  const end = nextMonthStart(month)
  const txs = await db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      eq(transactions.type, 'EXPENSE'),
      gte(transactions.transactionDate, start),
      lt(transactions.transactionDate, end)
    ))

  return cats.map(cat => {
    const budget = budgetRows.find(b => b.categoryId === cat.id)
    const spent = txs
      .filter(t => t.categoryId === cat.id)
      .reduce((s, t) => s + Number(t.amount), 0)
    const budgetAmount = Number(budget?.amount ?? 0)
    return {
      ...cat,
      budget_id: budget?.id,
      budget_amount: budgetAmount,
      spent,
      remaining: budgetAmount - spent,
      pct_used: budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0,
    }
  })
}

export async function upsertBudgets(
  userId: string,
  month: string,
  categories: { category_id: string; amount: number }[]
) {
  for (const cat of categories) {
    const [existing] = await db
      .select()
      .from(budgets)
      .where(and(
        eq(budgets.userId, userId),
        eq(budgets.categoryId, cat.category_id),
        eq(budgets.month, month)
      ))
      .limit(1)

    if (existing) {
      await db.update(budgets).set({ amount: String(cat.amount) }).where(eq(budgets.id, existing.id))
    } else {
      await db.insert(budgets).values({
        userId,
        categoryId: cat.category_id,
        amount: String(cat.amount),
        month,
      })
    }
  }
  return getBudgets(userId, month)
}

export async function getBudgetSummaryByCategory(
  userId: string,
  categoryId: string,
  month: string
): Promise<BudgetSummary | null> {
  const [cat] = await db
    .select()
    .from(budgetCategories)
    .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.userId, userId)))
    .limit(1)
  if (!cat) return null

  const [budget] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.categoryId, categoryId), eq(budgets.month, month)))
    .limit(1)

  const start = `${month}-01`
  const end = nextMonthStart(month)
  const txs = await db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      eq(transactions.categoryId, categoryId),
      eq(transactions.type, 'EXPENSE'),
      gte(transactions.transactionDate, start),
      lt(transactions.transactionDate, end)
    ))

  const spent = txs.reduce((s, t) => s + Number(t.amount), 0)
  const budgetAmount = Number(budget?.amount ?? 0)

  return {
    category_id: categoryId,
    category_name: cat.name,
    icon: cat.icon || '📦',
    budget: budgetAmount,
    spent,
    remaining: budgetAmount - spent,
    pct_used: budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0,
  }
}

export async function findCategoryByName(userId: string, nameHint: string) {
  const cats = await getBudgetCategories(userId)
  const hint = nameHint.toLowerCase()
  return cats.find(c =>
    c.name.toLowerCase().includes(hint) ||
    hint.includes(c.name.toLowerCase())
  )
}

const CATEGORY_MAP: Record<string, string> = {
  FOOD: 'อาหาร',
  TRANSPORT: 'เดินทาง',
  SHOPPING: 'ช้อปปิ้ง',
  BILLS: 'บิล',
  HEALTH: 'สุขภาพ',
  OTHER: 'อื่นๆ',
}

export async function resolveCategoryId(userId: string, categoryKey: string) {
  const thaiName = CATEGORY_MAP[categoryKey] || categoryKey
  const cat = await findCategoryByName(userId, thaiName)
  return cat?.id
}
