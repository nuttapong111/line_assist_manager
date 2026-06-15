import { db } from '../lib/db'
import { googleCalendarTokens } from '../lib/schema'
import { eq } from 'drizzle-orm'
import { google } from 'googleapis'
import { createAppointment } from './appointment.service'
import { signOAuthState } from '../lib/oauth-state'

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BACKEND_URL}/api/gcal/callback`
  )
}

export function getAuthUrl(userId: string) {
  const oauth2 = getOAuth2Client()
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state: signOAuthState(userId),
    prompt: 'consent',
  })
}

export async function handleCallback(code: string, userId: string) {
  const oauth2 = getOAuth2Client()
  const { tokens } = await oauth2.getToken(code)

  await db.insert(googleCalendarTokens).values({
    userId,
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token!,
    expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
    syncEnabled: true,
  }).onConflictDoUpdate({
    target: googleCalendarTokens.userId,
    set: {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token || undefined,
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
    },
  })
}

export async function syncFromGoogle() {
  const tokens = await db.select().from(googleCalendarTokens).where(eq(googleCalendarTokens.syncEnabled, true))

  for (const token of tokens) {
    try {
      const oauth2 = getOAuth2Client()
      oauth2.setCredentials({
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
      })

      const calendar = google.calendar({ version: 'v3', auth: oauth2 })
      const now = new Date()
      const weekLater = new Date(now.getTime() + 7 * 86400000)

      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: weekLater.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      })

      for (const event of res.data.items || []) {
        if (!event.start?.dateTime) continue
        await createAppointment(token.userId, {
          title: event.summary || 'Google Calendar Event',
          location: event.location || undefined,
          startAt: event.start.dateTime,
          endAt: event.end?.dateTime || undefined,
          source: 'GCAL',
        })
      }

      await db.update(googleCalendarTokens)
        .set({ lastSynced: new Date() })
        .where(eq(googleCalendarTokens.userId, token.userId))
    } catch (err) {
      console.error('GCal sync error:', err)
    }
  }
}

export async function getSyncStatus(userId: string) {
  const [token] = await db
    .select()
    .from(googleCalendarTokens)
    .where(eq(googleCalendarTokens.userId, userId))
    .limit(1)

  return {
    connected: !!token,
    sync_enabled: token?.syncEnabled ?? false,
    last_synced: token?.lastSynced,
  }
}

export async function disconnectGoogle(userId: string) {
  await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.userId, userId))
}
