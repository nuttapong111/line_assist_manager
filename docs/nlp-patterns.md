# NLP Patterns — Claude API Prompt Spec
## backend/src/services/nlp.service.ts

---

## System Prompt (วาง verbatim ใน code)

```typescript
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

## Date/Time Resolution
- วันนี้ → {{TODAY_DATE}}
- พรุ่งนี้ → {{TOMORROW_DATE}}
- มะรืน → {{DAY_AFTER_TOMORROW}}
- วันจันทร์ → next Monday from today
- เช้า → 08:00, สาย → 10:00, เที่ยง → 12:00, บ่าย → 14:00, เย็น → 17:00, ค่ำ → 19:00
- บ่ายสอง → 14:00, บ่ายสาม → 15:00
- 10 โมง → 10:00, 3 โมงเย็น → 15:00

## Category Mapping (Thai → English key)
EXPENSE categories:
- อาหาร, กิน, กาแฟ, ชา, ข้าว, ร้าน → FOOD
- BTS, MRT, แท็กซี่, grab, ค่าน้ำมัน, รถ, ทาง → TRANSPORT
- ช้อป, lazada, shopee, ซื้อ, เสื้อ, รองเท้า → SHOPPING
- ไฟ, น้ำ, เน็ต, internet, โทรศัพท์, ค่าเช่า → BILLS
- หมอ, ยา, ฟิตเนส, โรงพยาบาล → HEALTH
- else → OTHER

APPOINTMENT categories:
- ประชุม, meeting, งาน, work → WORK
- หมอ, พยาบาล, ฟัน, ทันตแพทย์ → HEALTH
- else → PERSONAL

## Response Schema

For APPOINTMENT:
{
  "intent": "APPOINTMENT",
  "confidence": 0.95,
  "data": {
    "title": "string - ชื่อนัด เช่น 'หมอฟัน' หรือ 'ประชุมทีม'",
    "date": "YYYY-MM-DD",
    "time": "HH:MM",
    "location": "string | null",
    "category": "WORK | PERSONAL | HEALTH | OTHER",
    "reminderMinutes": 60
  }
}

For EXPENSE / INCOME:
{
  "intent": "EXPENSE",
  "confidence": 0.92,
  "data": {
    "type": "EXPENSE",
    "amount": 85,
    "description": "กาแฟ",
    "category": "FOOD | TRANSPORT | SHOPPING | BILLS | HEALTH | OTHER",
    "date": "YYYY-MM-DD"
  }
}

For REMINDER:
{
  "intent": "REMINDER",
  "confidence": 0.88,
  "data": {
    "message": "string",
    "datetime": "YYYY-MM-DDTHH:MM:00",
    "repeat": "NONE | DAILY | WEEKLY | MONTHLY"
  }
}

For QUERY:
{
  "intent": "QUERY",
  "confidence": 0.90,
  "data": {
    "queryType": "MONTHLY_SUMMARY | BUDGET_STATUS | APPOINTMENTS | GENERAL",
    "period": "this_month | last_month | this_week | today | null"
  }
}

For ambiguous / unrecognized:
{
  "intent": "UNKNOWN",
  "confidence": 0.0,
  "data": null
}
`.trim()
```

---

## NLP Service Code

```typescript
// backend/src/services/nlp.service.ts
import Anthropic from '@anthropic-ai/sdk'
import { NLPResult } from '../types'

const client = new Anthropic()

function buildSystemPrompt(): string {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const tomorrow = new Date(now.setDate(now.getDate() + 1)).toISOString().split('T')[0]
  const dayAfter = new Date(now.setDate(now.getDate() + 1)).toISOString().split('T')[0]
  const time = now.toTimeString().slice(0, 5)

  return NLP_SYSTEM_PROMPT
    .replace('{{TODAY_DATE}}', today)
    .replace('{{TOMORROW_DATE}}', tomorrow)
    .replace('{{DAY_AFTER_TOMORROW}}', dayAfter)
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
```

---

## Example Input/Output

```json
// Input: "นัดหมอฟันพรุ่งนี้ 10 โมง ที่คลินิกสยาม"
{
  "intent": "APPOINTMENT",
  "confidence": 0.97,
  "data": {
    "title": "หมอฟัน",
    "date": "2026-06-08",
    "time": "10:00",
    "location": "คลินิกสยาม",
    "category": "HEALTH",
    "reminderMinutes": 60
  }
}

// Input: "กาแฟ 85 อาหาร"
{
  "intent": "EXPENSE",
  "confidence": 0.94,
  "data": {
    "type": "EXPENSE",
    "amount": 85,
    "description": "กาแฟ",
    "category": "FOOD",
    "date": "2026-06-07"
  }
}

// Input: "ประชุม zoom วันจันทร์บ่ายสอง"
{
  "intent": "APPOINTMENT",
  "confidence": 0.95,
  "data": {
    "title": "ประชุม zoom",
    "date": "2026-06-08",
    "time": "14:00",
    "location": null,
    "category": "WORK",
    "reminderMinutes": 60
  }
}

// Input: "ใช้ไปเท่าไหร่เดือนนี้"
{
  "intent": "QUERY",
  "confidence": 0.93,
  "data": {
    "queryType": "MONTHLY_SUMMARY",
    "period": "this_month"
  }
}
```
