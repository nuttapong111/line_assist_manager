import { Router } from 'express'
import * as gcal from '../services/gcal.service'

const router = Router()

router.get('/status', async (req, res) => {
  const status = await gcal.getSyncStatus(req.user.id)
  res.json(status)
})

router.get('/auth', async (req, res) => {
  const url = gcal.getAuthUrl(req.user.id)
  res.json({ url })
})

router.delete('/disconnect', async (req, res) => {
  await gcal.disconnectGoogle(req.user.id)
  res.json({ success: true })
})

export default router
