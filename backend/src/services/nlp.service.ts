import { uploadSlip } from '../lib/storage'
import { getGeminiModel, parseJsonFromText, hasGeminiKey } from '../lib/gemini'
import { bangkokToday, bangkokTomorrow, parseBangkokDateTime } from '../lib/datetime'
import type { NLPResult } from '../types'
import type { ChatMode } from './chat-context.service'
import { extractSymbolFromText, isStockRelatedText, isAddWatchlistText } from './investment.service'

export const NLP_SYSTEM_PROMPT = `
You are a Thai personal assistant that extracts structured data from Thai text messages.
Today's date is: {{TODAY_DATE}} (use this to resolve relative dates like "พรุ่งนี้", "วันนี้", "สัปดาห์หน้า")
Current time: {{CURRENT_TIME}}

CRITICAL: Respond with ONLY valid JSON. No explanation. No markdown. No code blocks.

Classify as EXPENSE when text contains spending + amount in baht (e.g. กาแฟ 85, ซื้อ 500)
Do NOT classify as EXPENSE when number is a time (11โมง, 10:30, บ่ายสอง)
Classify as INCOME when text contains income + number
Classify as APPOINTMENT when text contains meal/meeting/doctor + time (ทานข้าว 11โมง, นัดหมอ 10 โมง)
If appointment time has already passed today and no explicit date, use tomorrow
Classify as REMINDER when text contains เตือน/อย่าลืม + time
Classify as QUERY when asking ใช้ไปเท่าไหร่, สรุป, ดูนัด

For EXPENSE / INCOME respond:
{ "intent": "EXPENSE", "confidence": 0.9, "data": { "type": "EXPENSE", "amount": 85, "description": "กาแฟ", "category": "FOOD", "date": "YYYY-MM-DD" } }

For APPOINTMENT:
{ "intent": "APPOINTMENT", "confidence": 0.9, "data": { "title": "ทานข้าว", "date": "YYYY-MM-DD", "time": "11:00", "category": "PERSONAL", "reminderMinutes": 60 } }

For UNKNOWN:
{ "intent": "UNKNOWN", "confidence": 0.0, "data": null }
`.trim()

const CATEGORY_MAP: Record<string, string> = {
  อาหาร: 'FOOD', กาแฟ: 'FOOD', กิน: 'FOOD', ข้าว: 'FOOD', ทาน: 'FOOD',
  เดินทาง: 'TRANSPORT', bts: 'TRANSPORT', mrt: 'TRANSPORT', แท็กซี่: 'TRANSPORT',
  ช้อป: 'SHOPPING', ช้อปปิ้ง: 'SHOPPING',
  บิล: 'BILLS', ไฟ: 'BILLS', น้ำ: 'BILLS',
  สุขภาพ: 'HEALTH', หมอ: 'HEALTH', ยา: 'HEALTH',
}

const TIME_HINT = /โมง|น\.|บ่าย|เช้า|ค่ำ|:\d{2}|am|pm/i

function buildSystemPrompt(): string {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0]
  const time = now.toTimeString().slice(0, 5)

  return NLP_SYSTEM_PROMPT
    .replace('{{TODAY_DATE}}', today)
    .replace('{{TOMORROW_DATE}}', tomorrow)
    .replace('{{CURRENT_TIME}}', time)
}

function detectCategory(text: string): string {
  const lower = text.toLowerCase()
  for (const [keyword, cat] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword.toLowerCase())) return cat
  }
  return 'OTHER'
}

function todayStr(): string {
  return bangkokToday()
}

function tomorrowStr(): string {
  return bangkokTomorrow()
}

function padTime(h: number, m = 0): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** แยกเวลาจากข้อความไทย เช่น 11โมง, บ่ายสอง, 10:30 */
export function parseTimeFromText(text: string): { hour: number; minute: number; cleaned: string } | null {
  let hour: number | null = null
  let minute = 0
  let cleaned = text

  const colon = text.match(/(\d{1,2}):(\d{2})/)
  if (colon) {
    hour = parseInt(colon[1], 10)
    minute = parseInt(colon[2], 10)
    cleaned = cleaned.replace(colon[0], '').trim()
    return { hour, minute, cleaned }
  }

  const moong = text.match(/(\d{1,2})\s*โมง/)
  if (moong) {
    hour = parseInt(moong[1], 10)
    cleaned = cleaned.replace(moong[0], '').trim()
    return { hour, minute, cleaned }
  }

  const nMatch = text.match(/(\d{1,2})\s*น\.?/)
  if (nMatch) {
    hour = parseInt(nMatch[1], 10)
    cleaned = cleaned.replace(nMatch[0], '').trim()
    return { hour, minute, cleaned }
  }

  const afternoon = text.match(/บ่าย\s*(สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|\d{1,2})/)
  if (afternoon) {
    const word = afternoon[1]
    const thaiNums: Record<string, number> = {
      สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10,
    }
    const n = thaiNums[word] ?? parseInt(word, 10)
    hour = n <= 5 ? n + 12 : n
    cleaned = cleaned.replace(afternoon[0], '').trim()
    return { hour, minute, cleaned }
  }

  return null
}

function resolveAppointmentDate(text: string): string {
  if (/พรุ่งนี้/.test(text)) return tomorrowStr()
  if (/วันนี้/.test(text)) return todayStr()
  if (/วันเสาร์|เสาร์/.test(text)) {
    const today = bangkokToday()
    const base = parseBangkokDateTime(today, '12:00')
    const day = base.getUTCDay() // Sunday=0 ... but getUTCDay on +07:00 noon might be ok
    // หาเสาร์ถัดไป (Bangkok)
    const now = new Date()
    const bangkokDay = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).getDay()
    const daysUntil = (6 - bangkokDay + 7) % 7 || 7
    const d = parseBangkokDateTime(today, '12:00')
    d.setTime(d.getTime() + daysUntil * 86400000)
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
  }
  return todayStr()
}

/** ถ้าไม่ระบุวัน และเวลานัดผ่านแล้ว → พรุ่งนี้ (ยกเว้นพิม "วันนี้" ชัดเจน) */
function resolveAppointmentDateTime(text: string, hour: number, minute: number): { date: string; time: string } {
  const time = padTime(hour, minute)
  const explicitToday = /วันนี้/.test(text)
  const explicitTomorrow = /พรุ่งนี้/.test(text)
  const explicitWeekday = /วันเสาร์|เสาร์/.test(text)

  let date = resolveAppointmentDate(text)

  if (!explicitToday && !explicitTomorrow && !explicitWeekday) {
    const candidate = parseBangkokDateTime(date, time)
    if (candidate.getTime() <= Date.now()) {
      date = tomorrowStr()
    }
  }

  return { date, time }
}

/** ถามสรุปรายรับ-รายจ่าย */
export function parseExpenseQueryLocal(text: string): NLPResult | null {
  const t = text.trim()
  if (isStockRelatedText(t)) return null
  if (!/สรุป|ใช้ไป|รายจ่าย|รายรับ|การเงิน|งบ|เท่าไหร่|เหลือเท่าไหร่/i.test(t)) return null

  if (/วันนี้|พรุ่งนี้/.test(t)) {
    const date = /พรุ่งนี้/.test(t) ? tomorrowStr() : todayStr()
    return {
      intent: 'QUERY',
      confidence: 0.92,
      data: { queryType: 'DAILY_SUMMARY', date },
    }
  }

  if (/เดือนนี้|สรุป|งบ|ใช้ไป|เท่าไหร่/.test(t)) {
    return {
      intent: 'QUERY',
      confidence: 0.88,
      data: { queryType: 'MONTHLY_SUMMARY', period: 'this_month' },
    }
  }

  return null
}

export function isExpenseQueryText(text: string): boolean {
  return parseExpenseQueryLocal(text) !== null
}

export function isAppointmentQueryText(text: string): boolean {
  const t = text.trim()
  if (!/นัด|นัดหมาย|ประชุม/i.test(t)) return false

  const isQuestion = /อะไรบ้าง|มีอะไร|มีนัด|ดูนัด|เช็คนัด|ไหม|มั้ย|บ้าง\s*$|มีกี่/i.test(t)
  const isListByDay = /(?:วันนี้|พรุ่งนี้|วันเสาร์|สัปดาห์หน้า).*(?:นัด|นัดหมาย|ประชุม)/.test(t)
    && /(?:อะไร|บ้าง|มี|ดู|ไหม|มั้ย)/.test(t)

  if (!isQuestion && !isListByDay) return false

  // มีเวลาชัดเจน → น่าจะเป็นการสร้างนัด เช่น "นัดหมอพรุ่งนี้ 10 โมง"
  if (parseTimeFromText(t)) return false
  return true
}

export function parseAppointmentQueryLocal(text: string): NLPResult | null {
  if (!isAppointmentQueryText(text)) return null
  return {
    intent: 'QUERY',
    confidence: 0.92,
    data: { queryType: 'APPOINTMENTS', date: resolveAppointmentDate(text) },
  }
}

/** มีตัวเลขที่น่าจะเป็นจำนวนเงิน (ไม่ใช่เวลา) */
function hasExpenseAmount(text: string): boolean {
  if (TIME_HINT.test(text)) return false
  return /(\d+(?:\.\d+)?)\s*(?:บาท|บ\.?)?(?!\s*โมง)/.test(text)
}

/** Rule-based นัดหมาย */
export function parseAppointmentLocal(text: string): NLPResult | null {
  const trimmed = text.trim()
  if (isAppointmentQueryText(trimmed)) return null

  const time = parseTimeFromText(trimmed)
  // "ข้าว 150", "กาแฟ 85" → รายจ่าย ไม่ใช่นัดหมาย
  if (!time && hasExpenseAmount(trimmed)) return null

  const hasAppointmentHint = /นัด|ประชุม|หมอ|พบ|ทาน|กิน|เตือน|meeting|appointment/i.test(trimmed)

  if (!time && !hasAppointmentHint) return null
  if (!time && hasAppointmentHint) {
    return {
      intent: 'APPOINTMENT',
      confidence: 0.7,
      data: {
        title: trimmed,
        date: resolveAppointmentDate(trimmed),
        time: '09:00',
        category: 'PERSONAL',
        reminderMinutes: 60,
      },
    }
  }

  if (!time) return null

  const title = time.cleaned.replace(/พรุ่งนี้|วันนี้|วันเสาร์|เสาร์/g, '').trim() || trimmed
  const { date, time: timeStr } = resolveAppointmentDateTime(trimmed, time.hour, time.minute)

  return {
    intent: 'APPOINTMENT',
    confidence: 0.88,
    data: {
      title,
      date,
      time: timeStr,
      category: /หมอ|ฟัน|สุขภาพ/.test(trimmed) ? 'HEALTH' : 'PERSONAL',
      reminderMinutes: 60,
    },
  }
}

/** Rule-based รายรับ/รายจ่าย — ไม่จับเลขที่เป็นช่วงเวลา */
export function parseExpenseLocal(text: string): NLPResult | null {
  const today = todayStr()
  const trimmed = text.trim()

  if (TIME_HINT.test(trimmed)) return null

  const numMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:บาท|บ\.?)?(?!\s*โมง)/)
  if (!numMatch) return null

  const amount = parseFloat(numMatch[1])
  const isIncome = /รับ|ได้|เงินเดือน|โบนัส|income/i.test(trimmed)
  const isExpense = /กิน|ซื้อ|จ่าย|ค่า|ช้อป|กาแฟ|อาหาร|ข้าว|bts|mrt|แท็กซี่/i.test(trimmed) || !isIncome

  if (isIncome) {
    return {
      intent: 'INCOME',
      confidence: 0.8,
      data: { type: 'INCOME', amount, description: trimmed, category: 'OTHER', date: today },
    }
  }

  if (isExpense) {
    const desc = trimmed.replace(numMatch[0], '').replace(/บาท|บ\.?/g, '').trim() || trimmed
    return {
      intent: 'EXPENSE',
      confidence: 0.85,
      data: {
        type: 'EXPENSE',
        amount,
        description: desc,
        category: detectCategory(trimmed),
        date: today,
      },
    }
  }

  return null
}

/** Rule-based fallback เมื่อไม่มี Gemini API key หรือ Gemini error */
export function parseMessageLocal(text: string, mode?: ChatMode): NLPResult | null {
  const trimmed = text.trim()

  const apptQuery = parseAppointmentQueryLocal(trimmed)
  if (apptQuery) return apptQuery

  const expenseQuery = parseExpenseQueryLocal(trimmed)
  if (expenseQuery) return expenseQuery

  if (/ใช้ไป|สรุป|งบเหลือ|เท่าไหร่/.test(trimmed) && !isStockRelatedText(trimmed)) {
    return { intent: 'QUERY', confidence: 0.85, data: { queryType: 'MONTHLY_SUMMARY', period: 'this_month' } }
  }

  if (isAddWatchlistText(trimmed)) {
    const symbol = extractSymbolFromText(trimmed)
    if (symbol) return { intent: 'ADD_WATCHLIST', confidence: 0.9, data: { symbol } }
  }

  if (isStockRelatedText(trimmed)) {
    const symbol = extractSymbolFromText(trimmed)
    if (symbol) return { intent: 'STOCK_QUERY', confidence: 0.9, data: { symbol } }
  }

  if (mode === 'EXPENSE') {
    const expense = parseExpenseLocal(trimmed)
    if (expense) return expense
  }

  if (!mode) {
    const expense = parseExpenseLocal(trimmed)
    if (expense) return expense
    const appt = parseAppointmentLocal(trimmed)
    if (appt) return appt
  }

  if (mode === 'APPOINTMENT' || mode === 'REMINDER' || TIME_HINT.test(trimmed)) {
    const appt = parseAppointmentLocal(trimmed)
    if (appt) return appt
  }

  return parseExpenseLocal(trimmed)
}

export async function parseMessage(text: string, mode?: ChatMode): Promise<NLPResult> {
  const expenseQuery = parseExpenseQueryLocal(text)
  if (expenseQuery) {
    expenseQuery.raw_text = text
    return expenseQuery
  }

  const apptQuery = parseAppointmentQueryLocal(text)
  if (apptQuery) {
    apptQuery.raw_text = text
    return apptQuery
  }

  // หุ้น / watchlist → local ก่อนเสมอ
  if (isAddWatchlistText(text)) {
    const symbol = extractSymbolFromText(text)
    if (symbol) return { intent: 'ADD_WATCHLIST', confidence: 0.9, data: { symbol }, raw_text: text }
  }
  if (isStockRelatedText(text)) {
    const symbol = extractSymbolFromText(text)
    if (symbol) return { intent: 'STOCK_QUERY', confidence: 0.9, data: { symbol }, raw_text: text }
  }

  // รายจ่าย — จับก่อนเสมอเมื่อมีจำนวนเงินชัดเจน (แม้อยู่ในโหมดนัดหมาย)
  if (hasExpenseAmount(text) && !TIME_HINT.test(text)) {
    const expense = parseExpenseLocal(text)
    if (expense) {
      expense.raw_text = text
      return expense
    }
  }

  // นัดหมาย + เวลาไทย → ใช้ local ก่อนเสมอ (แม่นกว่า Gemini)
  if (mode === 'APPOINTMENT' || mode === 'REMINDER' || TIME_HINT.test(text)) {
    const appt = parseAppointmentLocal(text)
    if (appt) {
      appt.raw_text = text
      return appt
    }
  }

  if (!hasGeminiKey()) {
    const local = parseMessageLocal(text, mode)
    if (local) {
      local.raw_text = text
      return local
    }
    return { intent: 'UNKNOWN', confidence: 0, data: null, raw_text: text }
  }

  const hint = mode === 'APPOINTMENT'
    ? 'User is adding an appointment. Parse as APPOINTMENT if possible.'
    : mode === 'EXPENSE'
      ? 'User is adding an expense. Parse as EXPENSE if possible.'
      : ''

  try {
    const model = getGeminiModel(true, buildSystemPrompt())
    const result = await model.generateContent(hint ? `${hint}\n\n${text}` : text)
    const responseText = result.response.text()
    const parsed = parseJsonFromText(responseText) as NLPResult
    parsed.raw_text = text

    const needsLocalFallback =
      parsed.intent === 'UNKNOWN'
      || parsed.confidence < 0.6
      || (TIME_HINT.test(text) && parsed.intent !== 'APPOINTMENT')
      || (mode === 'APPOINTMENT' && parsed.intent !== 'APPOINTMENT')
      || (hasExpenseAmount(text) && !TIME_HINT.test(text) && parsed.intent !== 'EXPENSE' && parsed.intent !== 'INCOME')

    if (needsLocalFallback) {
      const local = parseMessageLocal(text, mode)
      if (local) return { ...local, raw_text: text }
    }

    return parsed
  } catch (err) {
    console.error('NLP parse error (Gemini):', err)
    const local = parseMessageLocal(text, mode)
    if (local) {
      local.raw_text = text
      return local
    }
    return { intent: 'UNKNOWN', confidence: 0, data: null, raw_text: text }
  }
}

export async function scanSlip(userId: string, buffer: Buffer, mimetype: string) {
  if (!hasGeminiKey()) {
    throw new Error('GEMINI_API_KEY is required for slip OCR. Set it in Railway Variables.')
  }

  const imageUrl = await uploadSlip(userId, buffer, mimetype)
  const base64 = buffer.toString('base64')
  const mimeType = mimetype === 'image/png' ? 'image/png' : 'image/jpeg'

  const model = getGeminiModel(true)
  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType } },
    { text: 'อ่านสลิปโอนเงินนี้ ตอบ JSON เท่านั้น: { "amount": number, "date": "YYYY-MM-DD", "time": "HH:MM", "merchant_name": string, "sender_bank": string, "slip_type": string }' },
  ])

  const parsed = parseJsonFromText(result.response.text()) as Record<string, unknown>
  return { ...parsed, image_url: imageUrl }
}
