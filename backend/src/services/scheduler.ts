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
import { checkSignalAlerts } from './signal.service'
import { syncFromGoogle } from './gcal.service'
import { formatBangkokTime } from '../lib/datetime'

export function startScheduler() {
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

  // Signal alerts every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try { await checkSignalAlerts() } catch (err) { console.error('Signal cron error:', err) }
  })

  // Google Calendar sync every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try { await syncFromGoogle() } catch (err) { console.error('GCal sync cron error:', err) }
  })

  console.log('✅ Scheduler started')
}
