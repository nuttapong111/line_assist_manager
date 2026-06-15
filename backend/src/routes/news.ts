import { Router } from 'express'
import {
  getNewsFeedForUser,
  getNewsForSymbol,
  refreshNewsForUser,
  fetchMarketNews,
  hasFinnhubKey,
  getUserSymbolList,
} from '../services/news.service'
import { INVESTMENT_DISCLAIMER } from '../types'

const router = Router()

router.get('/status', (_req, res) => {
  res.json({
    finnhub_configured: hasFinnhubKey(),
    disclaimer: INVESTMENT_DISCLAIMER,
  })
})

router.get('/market', async (_req, res) => {
  if (!hasFinnhubKey()) {
    return res.status(503).json({
      error: true,
      code: 'FINNHUB_NOT_CONFIGURED',
      message: 'ตั้ง FINNHUB_API_KEY บน Railway ก่อนใช้งานข่าว',
    })
  }
  try {
    const market = await fetchMarketNews('general')
    res.json({ market, disclaimer: INVESTMENT_DISCLAIMER })
  } catch (err) {
    console.error('[news] market error:', err)
    res.status(502).json({ error: true, code: 'UPSTREAM_ERROR', message: 'ดึงข่าวตลาดไม่สำเร็จ' })
  }
})

router.get('/', async (req, res) => {
  if (!hasFinnhubKey()) {
    return res.status(503).json({
      error: true,
      code: 'FINNHUB_NOT_CONFIGURED',
      message: 'ตั้ง FINNHUB_API_KEY บน Railway ก่อนใช้งานข่าว',
    })
  }
  try {
    const feed = await getNewsFeedForUser(req.user.id)
    res.json(feed)
  } catch (err) {
    console.error('[news] feed error:', err)
    res.status(500).json({ error: true, code: 'INTERNAL', message: 'โหลดข่าวไม่สำเร็จ' })
  }
})

router.post('/refresh', async (req, res) => {
  if (!hasFinnhubKey()) {
    return res.status(503).json({
      error: true,
      code: 'FINNHUB_NOT_CONFIGURED',
      message: 'ตั้ง FINNHUB_API_KEY บน Railway ก่อนใช้งานข่าว',
    })
  }
  try {
    const bundles = await refreshNewsForUser(req.user.id)
    res.json({ bundles, disclaimer: INVESTMENT_DISCLAIMER })
  } catch (err) {
    console.error('[news] refresh error:', err)
    res.status(500).json({ error: true, code: 'INTERNAL', message: 'รีเฟรชข่าวไม่สำเร็จ' })
  }
})

router.get('/symbols', async (req, res) => {
  const symbols = await getUserSymbolList(req.user.id)
  res.json(symbols)
})

router.get('/:symbol', async (req, res) => {
  if (!hasFinnhubKey()) {
    return res.status(503).json({
      error: true,
      code: 'FINNHUB_NOT_CONFIGURED',
      message: 'ตั้ง FINNHUB_API_KEY บน Railway ก่อนใช้งานข่าว',
    })
  }

  const symbol = req.params.symbol.toUpperCase()
  const force = req.query.refresh === '1'
  const symbols = await getUserSymbolList(req.user.id)
  const match = symbols.find(s => s.symbol === symbol)
  const displayName = match?.displayName || symbol

  try {
    const bundle = await getNewsForSymbol(symbol, displayName, force)
    res.json({ ...bundle, disclaimer: INVESTMENT_DISCLAIMER })
  } catch (err) {
    console.error(`[news] symbol ${symbol} error:`, err)
    res.status(502).json({ error: true, code: 'UPSTREAM_ERROR', message: 'ดึงข่าวไม่สำเร็จ' })
  }
})

export default router
