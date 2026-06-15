import { Router } from 'express'
import * as budget from '../services/budget.service'

const router = Router()

router.get('/', async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
  const budgets = await budget.getBudgets(req.user.id, month)
  res.json(budgets)
})

router.put('/', async (req, res) => {
  const { month, categories } = req.body
  const result = await budget.upsertBudgets(req.user.id, month, categories)
  res.json(result)
})

router.get('/categories', async (req, res) => {
  const cats = await budget.getBudgetCategories(req.user.id)
  res.json(cats)
})

router.post('/categories', async (req, res) => {
  const cat = await budget.createBudgetCategory(req.user.id, req.body)
  res.json(cat)
})

export default router
