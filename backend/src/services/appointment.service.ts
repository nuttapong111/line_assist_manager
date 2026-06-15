import { db } from '../lib/db'
import { appointments } from '../lib/schema'
import { eq, and, gte, lt, desc } from 'drizzle-orm'

export async function getTodayAppointments(userId: string) {
  const today = new Date().toISOString().split('T')[0]
  const start = new Date(today)
  const end = new Date(today + 'T23:59:59')

  return db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.userId, userId),
      gte(appointments.startAt, start),
      lt(appointments.startAt, end)
    ))
    .orderBy(appointments.startAt)
}

export async function getAppointmentsRange(userId: string, from: string, to: string) {
  const start = new Date(from)
  const end = new Date(to + 'T23:59:59')

  return db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.userId, userId),
      gte(appointments.startAt, start),
      lt(appointments.startAt, end)
    ))
    .orderBy(appointments.startAt)
}

export async function createAppointment(userId: string, data: {
  title: string
  location?: string | null
  category?: string
  start_at?: string
  startAt?: Date | string
  end_at?: string
  endAt?: Date | string
  reminder_min?: number
  reminderMin?: number
  source?: string
}) {
  const startAt = data.startAt || data.start_at
  const [appt] = await db.insert(appointments).values({
    userId,
    title: data.title,
    location: data.location,
    category: data.category || 'PERSONAL',
    startAt: new Date(startAt!),
    endAt: data.endAt || data.end_at ? new Date(data.endAt || data.end_at!) : null,
    reminderMin: data.reminderMin || data.reminder_min || 60,
    source: data.source || 'MANUAL',
  }).returning()
  return appt
}

export async function updateAppointment(userId: string, id: string, data: Partial<{
  title: string
  location: string
  category: string
  startAt: Date
  endAt: Date
  reminderMin: number
}>) {
  const [updated] = await db
    .update(appointments)
    .set(data)
    .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
    .returning()
  return updated
}

export async function deleteAppointment(userId: string, id: string) {
  await db.delete(appointments).where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
}

export async function getUpcomingReminders(userId: string) {
  const { reminders } = await import('../lib/schema')
  return db
    .select()
    .from(reminders)
    .where(and(
      eq(reminders.userId, userId),
      eq(reminders.isDone, false),
      gte(reminders.remindAt, new Date())
    ))
    .orderBy(reminders.remindAt)
}

export async function createReminder(userId: string, data: { message: string; remind_at?: string; remindAt?: string; repeat_type?: string }) {
  const { reminders } = await import('../lib/schema')
  const [reminder] = await db.insert(reminders).values({
    userId,
    message: data.message,
    remindAt: new Date(data.remindAt || data.remind_at!),
    repeatType: data.repeat_type || 'NONE',
  }).returning()
  return reminder
}

export async function markReminderDone(userId: string, id: string) {
  const { reminders } = await import('../lib/schema')
  const [updated] = await db
    .update(reminders)
    .set({ isDone: true })
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
    .returning()
  return updated
}

export async function deleteReminder(userId: string, id: string) {
  const { reminders } = await import('../lib/schema')
  await db.delete(reminders).where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
}

export async function getPendingAppointmentReminders() {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)

  return db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.isReminded, false),
      gte(appointments.startAt, now),
      lt(appointments.startAt, inOneHour)
    ))
}

export async function markAppointmentReminded(id: string) {
  await db.update(appointments).set({ isReminded: true }).where(eq(appointments.id, id))
}

export async function getPendingReminders() {
  const { reminders } = await import('../lib/schema')
  const now = new Date()
  const inOneMin = new Date(now.getTime() + 60 * 1000)

  return db
    .select()
    .from(reminders)
    .where(and(
      eq(reminders.isDone, false),
      gte(reminders.remindAt, now),
      lt(reminders.remindAt, inOneMin)
    ))
}
