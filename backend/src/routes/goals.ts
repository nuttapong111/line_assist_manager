import { Router } from 'express'
import * as goal from '../services/goal.service'
import { verifyOwner } from '../middleware/ownership'

const router = Router()

router.get('/', async (req, res) => {
  const goals = await goal.getGoals(req.user.id)
  res.json(goals)
})

router.post('/', async (req, res) => {
  const g = await goal.createGoal(req.user.id, req.body)
  res.json(g)
})

router.put('/:id', async (req, res) => {
  if (!await verifyOwner('savingGoals', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  const g = await goal.updateGoal(req.user.id, req.params.id, req.body)
  res.json(g)
})

router.delete('/:id', async (req, res) => {
  if (!await verifyOwner('savingGoals', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  await goal.deleteGoal(req.user.id, req.params.id)
  res.json({ success: true })
})

router.post('/:id/contribute', async (req, res) => {
  if (!await verifyOwner('savingGoals', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  const g = await goal.contributeToGoal(req.params.id, req.user.id, req.body.amount, req.body.note)
  res.json(g)
})

router.get('/:id/history', async (req, res) => {
  const history = await goal.getGoalHistory(req.params.id, req.user.id)
  res.json(history)
})

export default router
