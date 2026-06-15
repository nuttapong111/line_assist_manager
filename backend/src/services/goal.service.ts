import { db } from '../lib/db'
import { savingGoals, goalContributions } from '../lib/schema'
import { eq, and, desc } from 'drizzle-orm'

function computeGoalMeta(goal: typeof savingGoals.$inferSelect) {
  const target = Number(goal.targetAmount)
  const current = Number(goal.currentAmount ?? 0)
  const pct = target > 0 ? Math.round((current / target) * 100) : 0

  let monthsLeft = 0
  let etaMonth = ''
  if (goal.deadline) {
    const deadline = new Date(goal.deadline)
    const now = new Date()
    monthsLeft = Math.max(0, (deadline.getFullYear() - now.getFullYear()) * 12 + deadline.getMonth() - now.getMonth())
    if (current < target && monthsLeft > 0) {
      etaMonth = deadline.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
    }
  }

  return { pct_complete: pct, months_left: monthsLeft, eta_month: etaMonth }
}

export async function getGoals(userId: string) {
  const goals = await db
    .select()
    .from(savingGoals)
    .where(eq(savingGoals.userId, userId))
    .orderBy(desc(savingGoals.createdAt))

  return goals.map(g => ({ ...g, ...computeGoalMeta(g) }))
}

export async function createGoal(userId: string, data: {
  name: string
  target_amount: number
  icon?: string
  deadline?: string
  color?: string
}) {
  let monthlyTarget: string | undefined
  if (data.deadline) {
    const deadline = new Date(data.deadline)
    const now = new Date()
    const months = Math.max(1, (deadline.getFullYear() - now.getFullYear()) * 12 + deadline.getMonth() - now.getMonth())
    monthlyTarget = String(data.target_amount / months)
  }

  const [goal] = await db.insert(savingGoals).values({
    userId,
    name: data.name,
    targetAmount: String(data.target_amount),
    icon: data.icon || '🎯',
    deadline: data.deadline,
    monthlyTarget,
    color: data.color || '#2A5C45',
  }).returning()

  return { ...goal, ...computeGoalMeta(goal) }
}

export async function updateGoal(userId: string, id: string, data: Partial<{
  name: string
  targetAmount: string
  deadline: string
  icon: string
}>) {
  const [updated] = await db
    .update(savingGoals)
    .set(data)
    .where(and(eq(savingGoals.id, id), eq(savingGoals.userId, userId)))
    .returning()
  return updated ? { ...updated, ...computeGoalMeta(updated) } : null
}

export async function deleteGoal(userId: string, id: string) {
  await db.delete(savingGoals).where(and(eq(savingGoals.id, id), eq(savingGoals.userId, userId)))
}

export async function contributeToGoal(goalId: string, userId: string, amount: number, note?: string) {
  const [goal] = await db
    .select()
    .from(savingGoals)
    .where(and(eq(savingGoals.id, goalId), eq(savingGoals.userId, userId)))
    .limit(1)
  if (!goal) throw new Error('Goal not found')

  await db.insert(goalContributions).values({
    goalId,
    userId,
    amount: String(amount),
    note,
  })

  const newAmount = Number(goal.currentAmount ?? 0) + amount
  const target = Number(goal.targetAmount)
  const [updated] = await db
    .update(savingGoals)
    .set({
      currentAmount: String(newAmount),
      isCompleted: newAmount >= target,
    })
    .where(eq(savingGoals.id, goalId))
    .returning()

  return { ...updated!, ...computeGoalMeta(updated!) }
}

export async function getGoalHistory(goalId: string, userId: string) {
  return db
    .select()
    .from(goalContributions)
    .where(and(eq(goalContributions.goalId, goalId), eq(goalContributions.userId, userId)))
    .orderBy(desc(goalContributions.contribDate))
}

export async function findGoalByHint(userId: string, hint: string) {
  const goals = await getGoals(userId)
  const h = hint.toLowerCase()
  return goals.find(g => g.name.toLowerCase().includes(h) || h.includes(g.name.toLowerCase()))
}
