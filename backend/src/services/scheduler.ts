import cron from 'node-cron'
import {
  getPendingAppointmentReminders,
  markAppointmentReminded,
  getPendingReminders,
} from './appointment.service'
import { sendPushWithQuotaCheck } from './push.service'
import { db } from '../lib/db'
import { users } from '../lib/schema'
import { eq } from 'drizzle-orm'
import { checkPriceAlerts } from './price-alert.service'
import { checkWatchlistBuySignals } from './investment.service'
import { syncFromGoogle } from './gcal.service'
import { formatBangkokTime } from '../lib/datetime'
import { fetchAndCacheAllWatchedNews } from './news.service'
import { sendMorningInvestmentSummaries } from './investment.service'
import {
  ensureMarketScanInitialized,
  runMarketScanBatches,
  refreshMarketSymbolList,
} from './market-scanner.service'
import {
  computeRecommendationSnapshot,
  ensureRecommendationSnapshotFresh,
} from './recommendation.service'

export function startScheduler() {
  // เริ่มสแกนตลาดทั้งหมดแบบ batch
  ensureMarketScanInitialized()
    .then(() => runMarketScanBatches(4))
    .then(() => ensureRecommendationSnapshotFresh())
    .catch(err => console.error('[market-scan] init failed:', err))
  // Reminders + appointment alerts every minute
  cron.schedule('* * * * *', async () => {
    try {
      const appts = await getPendingAppointmentReminders()
      for (const appt of appts) {
        const [user] = await db.select().from(users).where(eq(users.id, appt.userId)).limit(1)
        if (!user) continue
        const time = formatBangkokTime(appt.startAt)
        await sendPushWithQuotaCheck(user.id, user.lineUserId, {
          type: 'text',
          text: `📅 เตือนนัดหมาย: ${appt.title}\nเวลา ${time}${appt.location ? `\n📍 ${appt.location}` : ''}`,
        })
        await markAppointmentReminded(appt.id)
      }

      const reminders = await getPendingReminders()
      for (const reminder of reminders) {
        const [user] = await db.select().from(users).where(eq(users.id, reminder.userId)).limit(1)
        if (!user) continue
        await sendPushWithQuotaCheck(user.id, user.lineUserId, {
          type: 'text',
          text: `🔔 เตือน: ${reminder.message}`,
        })
        const { reminders: remindersTable } = await import('../lib/schema')
        await db.update(remindersTable).set({ isDone: true }).where(eq(remindersTable.id, reminder.id))
      }
    } catch (err) {
      console.error('Reminder cron error:', err)
    }
  })

  // Price alerts every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try { await checkPriceAlerts() } catch (err) { console.error('Price alert cron error:', err) }
  })

  // Watchlist buy signals every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try { await checkWatchlistBuySignals() } catch (err) { console.error('Signal cron error:', err) }
  })

  // จัดอันดับหุ้นแนะนำจาก cache ทั้งตลาด ทุก 8 ชม. (00:00 / 08:00 / 16:00 ไทย)
  cron.schedule('0 */8 * * *', async () => {
    try { await computeRecommendationSnapshot() } catch (err) { console.error('Recommendation snapshot cron error:', err) }
  }, { timezone: 'Asia/Bangkok' })

  // Morning investment summary 08:00 Bangkok
  cron.schedule('0 8 * * *', async () => {
    try { await sendMorningInvestmentSummaries() } catch (err) { console.error('Morning summary cron error:', err) }
  }, { timezone: 'Asia/Bangkok' })

  // Google Calendar sync every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try { await syncFromGoogle() } catch (err) { console.error('GCal sync cron error:', err) }
  })

  // News fetch daily 07:00 Bangkok
  cron.schedule('0 7 * * *', async () => {
    try { await fetchAndCacheAllWatchedNews() } catch (err) { console.error('News cron error:', err) }
  }, { timezone: 'Asia/Bangkok' })

  // สแกนหุ้นทั้งตลาดเป็นชุดทุก 2 นาที (หลาย batch ต่อรอบ)
  cron.schedule('*/2 * * * *', async () => {
    try { await runMarketScanBatches() } catch (err) { console.error('Market scan cron error:', err) }
  })

  // รีเฟรชรายชื่อหุ้นจาก Finnhub ทุกเช้า 06:00
  cron.schedule('0 6 * * *', async () => {
    try { await refreshMarketSymbolList(true) } catch (err) { console.error('Market symbol refresh error:', err) }
  }, { timezone: 'Asia/Bangkok' })

  console.log('✅ Scheduler started')
}
