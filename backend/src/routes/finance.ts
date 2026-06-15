import { Router } from 'express'
import * as finance from '../services/finance.service'
import { verifyOwner } from '../middleware/ownership'

const router = Router()

router.get('/summary', async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
  const summary = await finance.getMonthlySummary(req.user.id, month)
  res.json(summary)
})

router.get('/transactions', async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
  const limit = Number(req.query.limit) || 20
  const offset = Number(req.query.offset) || 0
  const result = await finance.getTransactions(req.user.id, month, limit, offset)
  res.json(result)
})

router.post('/transactions', async (req, res) => {
  const tx = await finance.createTransaction(req.user.id, req.body)
  res.json(tx)
})

router.put('/transactions/:id', async (req, res) => {
  if (!await verifyOwner('transactions', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  const tx = await finance.updateTransaction(req.user.id, req.params.id, req.body)
  res.json(tx)
})

router.delete('/transactions/:id', async (req, res) => {
  if (!await verifyOwner('transactions', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  await finance.deleteTransaction(req.user.id, req.params.id)
  res.json({ success: true })
})

export default router
