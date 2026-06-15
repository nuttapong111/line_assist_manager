import { Router } from 'express'
import * as userService from '../services/user.service'
import * as finance from '../services/finance.service'
import { getPushQuota } from '../services/push.service'

const router = Router()

router.get('/profile', async (req, res) => {
  res.json(req.user)
})

router.patch('/profile', async (req, res) => {
  const updated = await userService.updateUserProfile(req.user.id, req.body)
  res.json(updated)
})

router.get('/stats', async (req, res) => {
  const stats = await userService.getUserStats(req.user.id)
  res.json(stats)
})

router.delete('/account', async (req, res) => {
  await userService.deleteUserAccount(req.user.id)
  res.json({ success: true })
})

router.get('/export', async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
  const csv = await finance.exportTransactionsCSV(req.user.id, month)
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename=transactions-${month}.csv`)
  res.send(csv)
})

router.get('/quota', async (req, res) => {
  const quota = await getPushQuota(req.user.id)
  res.json(quota)
})

export default router
