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

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }))
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/webhook', webhookRouter)

const gcalCallbackRouter = Router()
gcalCallbackRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query
  if (code && state) {
    await gcal.handleCallback(code as string, state as string)
    res.send('Google Calendar connected! You can close this window.')
  } else {
    res.status(400).send('Missing code or state')
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
