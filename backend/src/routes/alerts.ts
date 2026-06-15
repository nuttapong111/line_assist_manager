import { Router } from 'express'
import * as priceAlert from '../services/price-alert.service'
import { verifyOwner } from '../middleware/ownership'
import { analyzeSymbol } from '../services/signal.service'
import { fetchOHLCV } from '../services/yahoo.service'

const router = Router()

router.get('/', async (req, res) => {
  const alerts = await priceAlert.getPriceAlerts(req.user.id)
  res.json(alerts)
})

router.post('/', async (req, res) => {
  const alert = await priceAlert.createPriceAlert(req.user.id, req.body)
  res.json(alert)
})

router.delete('/:id', async (req, res) => {
  if (!await verifyOwner('priceAlerts', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  await priceAlert.deletePriceAlert(req.user.id, req.params.id)
  res.json({ success: true })
})

router.get('/analyze/:symbol', async (req, res) => {
  const analysis = await analyzeSymbol(req.params.symbol)
  if (!analysis) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'No data' })
  res.json(analysis)
})

router.get('/price/:symbol', async (req, res) => {
  const data = await fetchOHLCV(req.params.symbol, '1d', 30)
  res.json(data)
})

export default router
