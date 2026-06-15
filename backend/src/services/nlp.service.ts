import Anthropic from '@anthropic-ai/sdk'
import { uploadSlip } from '../lib/storage'
import type { NLPResult } from '../types'

const client = new Anthropic()

export const NLP_SYSTEM_PROMPT = `
You are a Thai personal assistant that extracts structured data from Thai text messages.
Today's date is: {{TODAY_DATE}} (use this to resolve relative dates like "พรุ่งนี้", "วันนี้", "สัปดาห์หน้า")
Current time: {{CURRENT_TIME}}

CRITICAL: Respond with ONLY valid JSON. No explanation. No markdown. No code blocks.

## Intent Detection Rules

Classify as APPOINTMENT when text contains:
- นัด, ประชุม, พบ, เจอ, หมอ, ทันตแพทย์, dentist, meeting, zoom
- + วัน/เวลา (พรุ่งนี้, วันจันทร์, 10 โมง, บ่ายสอง)

Classify as EXPENSE when text contains:
- กิน, ซื้อ, จ่าย, ค่า, ช้อป, โอนให้ + ตัวเลข
- ตัวเลขเด่นๆ + หมวด (กาแฟ 85, BTS 44)

Classify as INCOME when text contains:
- รับ, ได้, เงินเดือน, โบนัส, ฟรีแลนซ์, income + ตัวเลข

Classify as REMINDER when text contains:
- เตือน, remind, อย่าลืม, จำ + เวลา

Classify as QUERY when text contains:
- ใช้ไปเท่าไหร่, สรุป, ดูนัด, มีอะไรบ้าง, งบเหลือ

For ambiguous / unrecognized:
{ "intent": "UNKNOWN", "confidence": 0.0, "data": null }
`.trim()

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

export async function parseMessage(text: string): Promise<NLPResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: text }],
    })

    const content = response.content[0]
    if (content.type !== 'text') throw new Error('Unexpected response type')

    const result = JSON.parse(content.text) as NLPResult
    result.raw_text = text
    return result
  } catch (err) {
    console.error('NLP parse error:', err)
    return { intent: 'UNKNOWN', confidence: 0, data: null, raw_text: text }
  }
}

export async function scanSlip(userId: string, buffer: Buffer, mimetype: string) {
  const imageUrl = await uploadSlip(userId, buffer, mimetype)
  const base64 = buffer.toString('base64')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimetype as 'image/jpeg' | 'image/png', data: base64 },
        },
        {
          type: 'text',
          text: 'อ่านสลิปโอนเงินนี้ ตอบ JSON เท่านั้น: { "amount": number, "date": "YYYY-MM-DD", "time": "HH:MM", "merchant_name": string, "sender_bank": string, "slip_type": string }',
        },
      ],
    }],
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('OCR failed')

  const parsed = JSON.parse(content.text)
  return { ...parsed, image_url: imageUrl }
}
