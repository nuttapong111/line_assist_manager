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
import { normalizeUrl, isLiffFrontend } from './lib/url'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

const frontendUrl = normalizeUrl(process.env.FRONTEND_URL || '')
const corsOrigins: string[] = []
if (frontendUrl) corsOrigins.push(frontendUrl)
if (process.env.NODE_ENV !== 'production') {
  corsOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173')
}

function landingHtml(): string {
  const liffId = process.env.LIFF_ID || ''
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MyAssist API</title>
  <style>
    body { font-family: -apple-system, sans-serif; background:#F7F6F2; color:#18170F; padding:24px; line-height:1.6; }
    .card { background:#fff; border-radius:14px; padding:20px; max-width:400px; margin:auto; border:1px solid rgba(0,0,0,0.07); }
    h1 { color:#2A5C45; font-size:20px; margin:0 0 8px; }
    p { font-size:14px; color:#636259; margin:0 0 12px; }
    code { background:#EEEDE8; padding:2px 6px; border-radius:6px; font-size:12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>MyAssist API</h1>
    <p>นี่คือ <strong>backend API</strong> ไม่ใช่หน้าแอป LIFF</p>
    <p>เปิดแอปจาก <strong>LINE OA</strong> → กดแท็บ 「เมนู」 ด้านล่าง</p>
    <p>ตั้ง <code>FRONTEND_URL</code> บน Railway เป็น URL Vercel (LIFF) ไม่ใช่ URL Railway</p>
    ${liffId ? `<p>LIFF ID: <code>${liffId}</code></p>` : ''}
    <p><a href="/health">/health</a></p>
  </div>
</body>
</html>`
}

app.get('/', (_req, res) => {
  if (isLiffFrontend(frontendUrl)) {
    return res.redirect(frontendUrl)
  }
  res.type('html').send(landingHtml())
})

app.get('/slip', (req, res) => {
  if (isLiffFrontend(frontendUrl)) {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
    return res.redirect(`${frontendUrl}/slip${query}`)
  }
  res.type('html').send(landingHtml())
})

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
