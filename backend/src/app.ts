import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
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
import { Router } from 'express'
import * as gcal from './services/gcal.service'
import { startScheduler } from './services/scheduler'
import { verifyOAuthState } from './lib/oauth-state'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

const corsOrigins: string[] = []
if (process.env.FRONTEND_URL) corsOrigins.push(process.env.FRONTEND_URL)
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
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// Webhook ต้องอยู่ก่อน express.json() — LINE ต้องใช้ raw body ตรวจ signature
app.use('/webhook', webhookRouter)

app.use(express.json({ limit: '1mb' }))

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

app.listen(PORT, () => {
  console.log(`🚀 MyAssist backend running on port ${PORT}`)
  startScheduler()
})

export default app
