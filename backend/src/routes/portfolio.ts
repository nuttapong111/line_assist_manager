import { Router } from 'express'
import * as portfolio from '../services/portfolio.service'

const router = Router()

router.get('/positions', async (req, res) => {
  const positions = await portfolio.getPositions(req.user.id)
  res.json(positions)
})

router.post('/buy', async (req, res) => {
  const positions = await portfolio.buyPosition(req.user.id, req.body)
  res.json(positions)
})

router.post('/sell', async (req, res) => {
  const positions = await portfolio.sellPosition(req.user.id, req.body)
  res.json(positions)
})

router.get('/watched', async (req, res) => {
  const assets = await portfolio.getWatchedAssets(req.user.id)
  res.json(assets)
})

router.post('/watched', async (req, res) => {
  const asset = await portfolio.addWatchedAsset(req.user.id, req.body)
  res.json(asset)
})

router.get('/trades', async (req, res) => {
  const trades = await portfolio.getTrades(req.user.id, req.query.position_id as string)
  res.json(trades)
})

export default router
