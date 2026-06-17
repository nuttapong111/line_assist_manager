import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { authMiddleware } from './middleware/auth'
import webhookRouter from './routes/webhook'
import financeRouter from './routes/finance'
import budgetRouter from './routes/budget'
import appointmentsRouter from './routes/appointments'
import remindersRouter from './routes/reminders'
import ocrRouter from './routes/ocr'
import userRouter from './routes/user'
import alertsRouter from './routes/alerts'
import goalsRouter from './routes/goals'
import portfolioRouter from './routes/portfolio'
import gcalRouter from './routes/gcal'
import newsRouter from './routes/news'
import { Router } from 'express'
import * as gcal from './services/gcal.service'
import { startScheduler } from './services/scheduler'
import { verifyOAuthState } from './lib/oauth-state'
import { normalizeUrl, isExternalFrontend } from './lib/url'
import { hasFinnhubKey } from './services/news.service'
import { getMarketScanProgress } from './services/market-scanner.service'
import { db } from './lib/db'
import { users } from './lib/schema'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

const publicDir = path.join(__dirname, 'public')
const hasFrontend = fs.existsSync(path.join(publicDir, 'index.html'))

const backendUrl = normalizeUrl(
  process.env.BACKEND_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ''),
)
const frontendUrl = normalizeUrl(process.env.FRONTEND_URL || backendUrl)

const corsOrigins: string[] = []
if (frontendUrl) corsOrigins.push(frontendUrl)
if (backendUrl && backendUrl !== frontendUrl) corsOrigins.push(backendUrl)
if (process.env.NODE_ENV !== 'production') {
  corsOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173')
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(null, false)
    }
  },
  credentials: true,
}))
app.get('/health', async (_req, res) => {
  let marketScan: Awaited<ReturnType<typeof getMarketScanProgress>> | null = null
  try {
    marketScan = await getMarketScanProgress()
  } catch {
    marketScan = null
  }
  res.json({
    status: 'ok',
    features: ['stock-chat', 'watchlist-chat', 'morning-summary', 'market-scan'],
    build: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    finnhub: hasFinnhubKey(),
    marketScan,
  })
})

app.post('/internal/cron/morning-summary', express.json(), async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const { buildMorningSummaryReply, sendMorningInvestmentSummaries } = await import('./services/investment.service')
    if (req.query.preview === '1') {
      const allUsers = await db.select().from(users)
      const previews = await Promise.all(allUsers.map(async user => ({
        lineUserId: user.lineUserId,
        text: await buildMorningSummaryReply(user.id),
      })))
      return res.json({ ok: true, previews })
    }
    await sendMorningInvestmentSummaries()
    return res.json({ ok: true, sent: true })
  } catch (err) {
    console.error('[cron] morning-summary trigger failed:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Webhook ต้องอยู่ก่อน express.json() — LINE ต้องใช้ raw body ตรวจ signature
app.use('/webhook', webhookRouter)

app.use(express.json({ limit: '1mb' }))

app.get('/api/public/config', (_req, res) => {
  res.json({ liffId: process.env.LIFF_ID || '' })
})

const gcalCallbackRouter = Router()
gcalCallbackRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    return res.status(400).send('Missing code or state')
  }
  try {
    const userId = verifyOAuthState(state)
    await gcal.handleCallback(code, userId)
    res.send('Google Calendar connected! You can close this window.')
  } catch (err) {
    console.error('[gcal] callback error:', err)
    res.status(400).send('Invalid or expired authorization request')
  }
})
app.use('/api/gcal', gcalCallbackRouter)

app.use('/api', authMiddleware)
app.use('/api/finance', financeRouter)
app.use('/api/budget', budgetRouter)
app.use('/api/appointments', appointmentsRouter)
app.use('/api/reminders', remindersRouter)
app.use('/api/ocr', ocrRouter)
app.use('/api/user', userRouter)
app.use('/api/push', userRouter)
app.use('/api/alerts', alertsRouter)
app.use('/api/goals', goalsRouter)
app.use('/api/portfolio', portfolioRouter)
app.use('/api/gcal', gcalRouter)
app.use('/api/news', newsRouter)

if (hasFrontend) {
  app.use(express.static(publicDir, { index: false }))
  app.get(/^(?!\/api|\/webhook|\/health).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })
} else if (isExternalFrontend(frontendUrl, backendUrl)) {
  app.get('/', (_req, res) => res.redirect(frontendUrl))
  app.get('/slip', (req, res) => {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
    res.redirect(`${frontendUrl}/slip${query}`)
  })
}

app.listen(PORT, () => {
  console.log(`🚀 MyAssist running on port ${PORT}${hasFrontend ? ' (API + LIFF)' : ' (API only)'}`)
  startScheduler()
})

export default app
