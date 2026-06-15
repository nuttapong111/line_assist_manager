import { uploadSlip } from '../lib/storage'
import { getGeminiModel, parseJsonFromText, hasGeminiKey } from '../lib/gemini'
import type { NLPResult } from '../types'

export const NLP_SYSTEM_PROMPT = `
You are a Thai personal assistant that extracts structured data from Thai text messages.
Today's date is: {{TODAY_DATE}} (use this to resolve relative dates like "พรุ่งนี้", "วันนี้", "สัปดาห์หน้า")
Current time: {{CURRENT_TIME}}

CRITICAL: Respond with ONLY valid JSON. No explanation. No markdown. No code blocks.

Classify as EXPENSE when text contains spending + number (e.g. กาแฟ 85, ซื้อ 500)
Classify as INCOME when text contains income + number
Classify as APPOINTMENT when text contains นัด/ประชุม/หมอ + time/date
Classify as REMINDER when text contains เตือน/อย่าลืม + time
Classify as QUERY when asking ใช้ไปเท่าไหร่, สรุป, ดูนัด

For EXPENSE / INCOME respond:
{ "intent": "EXPENSE", "confidence": 0.9, "data": { "type": "EXPENSE", "amount": 85, "description": "กาแฟ", "category": "FOOD", "date": "YYYY-MM-DD" } }

For UNKNOWN:
{ "intent": "UNKNOWN", "confidence": 0.0, "data": null }
`.trim()

const CATEGORY_MAP: Record<string, string> = {
  อาหาร: 'FOOD', กาแฟ: 'FOOD', กิน: 'FOOD', ข้าว: 'FOOD',
  เดินทาง: 'TRANSPORT', bts: 'TRANSPORT', mrt: 'TRANSPORT', แท็กซี่: 'TRANSPORT',
  ช้อป: 'SHOPPING', ช้อปปิ้ง: 'SHOPPING',
  บิล: 'BILLS', ไฟ: 'BILLS', น้ำ: 'BILLS',
  สุขภาพ: 'HEALTH', หมอ: 'HEALTH', ยา: 'HEALTH',
}

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

/** Rule-based fallback เมื่อไม่มี Gemini API key หรือ Gemini error */
export function parseMessageLocal(text: string): NLPResult | null {
  const today = new Date().toISOString().split('T')[0]
  const trimmed = text.trim()

  if (/ใช้ไป|สรุป|งบเหลือ|ดูนัด|เท่าไหร่/.test(trimmed)) {
    return { intent: 'QUERY', confidence: 0.85, data: { queryType: 'MONTHLY_SUMMARY', period: 'this_month' } }
  }

  const numMatch = trimmed.match(/(\d+(?:\.\d+)?)/)
  if (!numMatch) return null

  const amount = parseFloat(numMatch[1])
  const isIncome = /รับ|ได้|เงินเดือน|โบนัส|income/i.test(trimmed)
  const isExpense = /กิน|ซื้อ|จ่าย|ค่า|ช้อป|กาแฟ|อาหาร|bts|mrt|แท็กซี่|ค่า/i.test(trimmed) || !isIncome

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

export async function parseMessage(text: string): Promise<NLPResult> {
  if (!hasGeminiKey()) {
    const local = parseMessageLocal(text)
    if (local) {
      local.raw_text = text
      return local
    }
    return { intent: 'UNKNOWN', confidence: 0, data: null, raw_text: text }
  }

  try {
    const model = getGeminiModel(true, buildSystemPrompt())
    const result = await model.generateContent(text)
    const responseText = result.response.text()
    const parsed = parseJsonFromText(responseText) as NLPResult
    parsed.raw_text = text
    return parsed
  } catch (err) {
    console.error('NLP parse error (Gemini):', err)
    const local = parseMessageLocal(text)
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
