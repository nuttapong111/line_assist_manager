# LINE Rich Menu, Webhook & Scheduler Spec
## backend/src/services/line.service.ts + scheduler.ts

---

## Rich Menu Structure

```
LINE Rich Menu: 2500 × 843 px
Grid: 3 columns × 2 rows  |  Cell: 833 × 421 px

Tab 1 "หลัก":     เพิ่มนัดหมาย | บันทึกรายจ่าย | สแกนสลิป
                   สรุปการเงิน   | ตั้งเตือน      | เปิดแอพ

Tab 2 "การเงิน":  บันทึกรายรับ  | บันทึกรายจ่าย | สแกนสลิป
                   สรุปเดือนนี้  | งบประมาณ       | Export CSV

Tab 3 "นัดหมาย": เพิ่มนัดหมาย  | นัดวันนี้      | สัปดาห์นี้
                   ดูทั้งหมด     | ตั้งเตือน      | เปิดปฏิทิน
```

---

## Rich Menu Setup Script

```typescript
// backend/src/scripts/setup-richmenu.ts
// รัน: npx ts-node src/scripts/setup-richmenu.ts

import { Client } from '@line/bot-sdk'
import fs from 'fs'

const client = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! })
const LIFF_URL = process.env.FRONTEND_URL!

async function main() {
  const mainId  = await createMainMenu()
  const finId   = await createFinanceMenu()
  const apptId  = await createAppointmentMenu()

  // Upload PNG images (สร้าง design/richmenu-main.png, finance.png, appt.png แยก)
  await uploadImage(mainId,  'design/richmenu-main.png')
  await uploadImage(finId,   'design/richmenu-finance.png')
  await uploadImage(apptId,  'design/richmenu-appt.png')

  // Set default (main menu)
  await client.setDefaultRichMenu(mainId)
  console.log('Done:', { mainId, finId, apptId })
}

async function createMainMenu() {
  return client.createRichMenu({
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'MyAssist Main',
    chatBarText: 'เมนู',
    areas: [
      { bounds: { x:    0, y:  0, width: 833, height: 421 }, action: { type: 'postback', data: 'action=ADD_APPOINTMENT',  displayText: 'เพิ่มนัดหมาย'   } },
      { bounds: { x:  833, y:  0, width: 834, height: 421 }, action: { type: 'postback', data: 'action=ADD_EXPENSE',      displayText: 'บันทึกรายจ่าย'  } },
      { bounds: { x: 1667, y:  0, width: 833, height: 421 }, action: { type: 'uri',      uri: `${LIFF_URL}/slip`,        label: 'สแกนสลิป'             } },
      { bounds: { x:    0, y:421, width: 833, height: 422 }, action: { type: 'postback', data: 'action=SUMMARY',          displayText: 'ดูสรุปการเงิน'  } },
      { bounds: { x:  833, y:421, width: 834, height: 422 }, action: { type: 'postback', data: 'action=ADD_REMINDER',     displayText: 'ตั้งเตือน'      } },
      { bounds: { x: 1667, y:421, width: 833, height: 422 }, action: { type: 'uri',      uri: LIFF_URL,                  label: 'เปิดแอพ'              } },
    ]
  })
}

// Finance + Appointment menus: สร้างแบบเดียวกัน เปลี่ยน areas
async function createFinanceMenu() { /* ... */ return '' }
async function createAppointmentMenu() { /* ... */ return '' }

async function uploadImage(richMenuId: string, imagePath: string) {
  const buffer = fs.readFileSync(imagePath)
  await client.setRichMenuImage(richMenuId, buffer, 'image/png')
}

main().catch(console.error)
```

---

## Webhook Handler (Multi-tenant ready)

```typescript
// backend/src/routes/webhook.ts
import { Router } from 'express'
import { middleware, Client, WebhookEvent } from '@line/bot-sdk'
import { createUserIfNotExists } from '../services/user.service'
import { parseMessage } from '../services/nlp.service'
import { buildConfirmFlexMessage, buildSuccessMessage, buildQueryReply } from '../services/flex.service'
import { sendPushWithQuotaCheck } from '../services/push.service'
import { getBudgetSummaryByCategory } from '../services/budget.service'
import { createTransaction } from '../services/finance.service'
import { createAppointment } from '../services/appointment.service'

const router = Router()
export const lineClient = new Client({
  channelSecret:      process.env.LINE_CHANNEL_SECRET!,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
})

router.post('/',
  middleware({ channelSecret: process.env.LINE_CHANNEL_SECRET! }),
  async (req, res) => {
    res.sendStatus(200)   // ตอบ LINE ก่อนเสมอ ไม่เกิน 1 วิ
    await Promise.allSettled(req.body.events.map(handleEvent))
  }
)

async function handleEvent(event: WebhookEvent) {
  // ทุก event ต้องมี userId — ถ้าไม่มีให้ skip
  const lineUserId = event.source?.userId
  if (!lineUserId) return

  // createUserIfNotExists ทำงาน idempotent — safe to call every time
  const user = await createUserIfNotExists(lineUserId)

  if (event.type === 'message' && event.message.type === 'text') {
    await handleTextMessage(event, user, lineUserId)
  } else if (event.type === 'postback') {
    await handlePostback(event, user, lineUserId)
  } else if (event.type === 'message' && event.message.type === 'image') {
    await handleImageMessage(event, lineUserId)
  } else if (event.type === 'follow') {
    await handleFollow(event, user, lineUserId)
  }
}

async function handleTextMessage(event: any, user: any, lineUserId: string) {
  const text: string = event.message.text.trim()
  const nlp = await parseMessage(text)

  if (nlp.intent === 'UNKNOWN' || nlp.confidence < 0.6) {
    await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ขอโทษครับ ไม่เข้าใจ 😅\nลองพิม เช่น:\n"นัดหมอพรุ่งนี้ 10 โมง"\n"กาแฟ 85 อาหาร"\n"ใช้ไปเท่าไหร่เดือนนี้"'
    })
    return
  }

  if (nlp.intent === 'QUERY') {
    const reply = await buildQueryReply(user.id, nlp.data)
    await lineClient.replyMessage(event.replyToken, reply)
    return
  }

  await lineClient.replyMessage(event.replyToken, buildConfirmFlexMessage(nlp))
}

async function handlePostback(event: any, user: any, lineUserId: string) {
  const params = new URLSearchParams(event.postback.data)
  const action = params.get('action')

  switch (action) {
    case 'CONFIRM_EXPENSE': {
      const payload = JSON.parse(params.get('payload') || '{}')
      const tx = await createTransaction(user.id, { ...payload, source: 'CHAT' })
      const budget = await getBudgetSummaryByCategory(user.id, payload.category_id,
        new Date().toISOString().slice(0, 7))
      await lineClient.replyMessage(event.replyToken, buildSuccessMessage('expense', payload, budget))

      // Push budget warning ถ้าใกล้เกิน (แยกจาก reply — ส่งหลัง)
      if (budget && budget.pct_used >= 80) {
        await sendPushWithQuotaCheck(user.id, lineUserId, {
          type: 'text',
          text: `⚠️ หมวด${budget.category_name}: ใช้ไป ${budget.pct_used}% แล้วนะครับ (เหลือ ฿${budget.remaining.toLocaleString()})`
        })
      }
      break
    }
    case 'CONFIRM_APPOINTMENT': {
      const payload = JSON.parse(params.get('payload') || '{}')
      await createAppointment(user.id, { ...payload, source: 'CHAT' })
      await lineClient.replyMessage(event.replyToken, buildSuccessMessage('appointment', payload))
      break
    }
    case 'ADD_APPOINTMENT':
      await lineClient.replyMessage(event.replyToken, {
        type: 'text', text: '📅 พิมนัดหมายได้เลยครับ\n"นัดประชุมพรุ่งนี้บ่ายสอง"\n"หมอฟันวันเสาร์ 10 โมง ที่คลินิกสยาม"'
      })
      break
    case 'ADD_EXPENSE':
      await lineClient.replyMessage(event.replyToken, {
        type: 'text', text: '💸 พิมรายจ่ายได้เลยครับ\n"กาแฟ 85"\n"ค่าน้ำมัน 500 เดินทาง"\n"ค่าไฟ 980 บิล"'
      })
      break
    case 'SUMMARY': {
      const month = new Date().toISOString().slice(0, 7)
      const reply = await buildQueryReply(user.id, { queryType: 'MONTHLY_SUMMARY', period: 'this_month' })
      await lineClient.replyMessage(event.replyToken, reply)
      break
    }
  }
}

async function handleImageMessage(event: any, lineUserId: string) {
  const liffUrl = `${process.env.FRONTEND_URL}/slip?source=camera`
  await lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: `📷 รับสลิปแล้ว! กดลิงก์เพื่ออ่านและบันทึก:\n${liffUrl}`
  })
}

async function handleFollow(event: any, user: any, lineUserId: string) {
  // ส่ง welcome message ครั้งแรก
  await lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: `สวัสดีครับ! 👋 ยินดีต้อนรับสู่ MyAssist\n\nพิมได้เลย เช่น:\n📅 "นัดหมอพรุ่งนี้บ่าย 2"\n💸 "กาแฟ 85 อาหาร"\n📊 "ใช้ไปเท่าไหร่เดือนนี้"\n\nหรือกด เมนู ด้านล่าง`
  })
}

export default router
```

---

## Scheduler (Cron — scoped per user)

```typescript
// backend/src/services/scheduler.ts
import cron from 'node-cron'
import { supabaseAdmin } from '../lib/supabase'
import { lineClient } from '../routes/webhook'
import { sendPushWithQuotaCheck } from './push.service'

export function startScheduler() {
  // รันทุก 1 นาที
  cron.schedule('* * * * *', async () => {
    await sendReminders()
    await sendAppointmentReminders()
    await resetMonthlyQuotas()
  })
  console.log('[Scheduler] Started')
}

// ส่งเตือน reminders ที่ถึงเวลา — loop per user (ไม่ mix ข้าม user)
async function sendReminders() {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + 60 * 1000)  // +1 นาที

  const { data: reminders } = await supabaseAdmin
    .from('reminders')
    .select('*, users!inner(id, line_user_id)')  // join users
    .lte('remind_at', windowEnd.toISOString())
    .eq('is_done', false)
    .limit(50)                 // batch size — ป้องกัน overload

  for (const reminder of reminders ?? []) {
    const userId     = reminder.users.id
    const lineUserId = reminder.users.line_user_id

    // ส่ง push พร้อมตรวจ quota ต่อ user
    const sent = await sendPushWithQuotaCheck(userId, lineUserId, {
      type: 'text',
      text: `🔔 ${reminder.message}`
    })

    if (sent) {
      // mark done หรือตั้ง next remind_at ถ้า repeat
      if (reminder.repeat_type === 'NONE') {
        await supabaseAdmin.from('reminders').update({ is_done: true }).eq('id', reminder.id)
      } else {
        const nextAt = calcNextRemindAt(reminder.remind_at, reminder.repeat_type)
        await supabaseAdmin.from('reminders').update({ remind_at: nextAt }).eq('id', reminder.id)
      }
    }
  }
}

// แจ้งเตือนนัดหมายล่วงหน้า reminder_min นาที
async function sendAppointmentReminders() {
  const now = new Date()

  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('*, users!inner(id, line_user_id)')
    .eq('is_reminded', false)
    .limit(50)

  for (const appt of appointments ?? []) {
    const startAt     = new Date(appt.start_at)
    const remindAt    = new Date(startAt.getTime() - appt.reminder_min * 60 * 1000)
    const diffSeconds = (remindAt.getTime() - now.getTime()) / 1000

    if (diffSeconds > -30 && diffSeconds < 90) {   // window ±30s
      const sent = await sendPushWithQuotaCheck(
        appt.users.id,
        appt.users.line_user_id,
        {
          type: 'text',
          text: `📅 แจ้งเตือน: "${appt.title}" อีก ${appt.reminder_min} นาที\n${appt.location ? `📍 ${appt.location}` : ''}`
        }
      )
      if (sent) {
        await supabaseAdmin.from('appointments').update({ is_reminded: true }).eq('id', appt.id)
      }
    }
  }
}

// reset push_log count ต้นเดือน (สำรองไว้ — Supabase ก็ทำได้ด้วย cron extension)
async function resetMonthlyQuotas() {
  const now = new Date()
  if (now.getDate() !== 1 || now.getHours() !== 0 || now.getMinutes() !== 0) return

  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString().slice(0, 7)

  await supabaseAdmin.from('push_log').delete().eq('month', prevMonth)
  console.log('[Scheduler] Reset quota for', prevMonth)
}

function calcNextRemindAt(current: string, repeat: string): string {
  const d = new Date(current)
  if (repeat === 'DAILY')   d.setDate(d.getDate() + 1)
  if (repeat === 'WEEKLY')  d.setDate(d.getDate() + 7)
  if (repeat === 'MONTHLY') d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}
```

---

## Flex Message Templates

```typescript
// backend/src/services/flex.service.ts
import { NLPResult, BudgetSummary } from '../types'

export function buildConfirmFlexMessage(nlp: NLPResult) {
  const isExpense = nlp.intent === 'EXPENSE' || nlp.intent === 'INCOME'
  const d = nlp.data as any
  const action = isExpense ? 'CONFIRM_EXPENSE' : 'CONFIRM_APPOINTMENT'
  const payload = encodeURIComponent(JSON.stringify(d))

  const fields = isExpense
    ? [
        { label: 'รายการ',  value: d.description },
        { label: 'ยอด',     value: `฿${Number(d.amount).toLocaleString()}` },
        { label: 'หมวด',    value: categoryLabel(d.category) },
        { label: 'วันที่',  value: formatDateTH(d.date) },
      ]
    : [
        { label: 'เรื่อง',  value: d.title },
        { label: 'วันที่',  value: formatDateTH(d.date) },
        { label: 'เวลา',    value: d.time },
        { label: 'สถานที่', value: d.location || '-' },
      ]

  return {
    type: 'flex',
    altText: isExpense ? `บันทึกรายจ่าย ฿${d.amount}?` : `บันทึกนัด: ${d.title}?`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'horizontal', paddingAll: '14px', backgroundColor: '#F7F6F2',
        contents: [
          { type: 'box', layout: 'vertical', flex: 1, contents: [
              { type: 'text', text: isExpense ? 'บันทึกรายจ่าย' : 'บันทึกนัดหมาย', weight: 'bold', size: 'sm', color: '#18170F' },
              { type: 'text', text: 'ตรวจสอบก่อนบันทึก', size: 'xxs', color: '#9B9A94', margin: 'xs' }
          ]},
          { type: 'text', text: 'AI', size: 'xxs', weight: 'bold', color: '#2A5C45',
            backgroundColor: '#E6F0EB', cornerRadius: '20px', paddingAll: '4px' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'md',
        contents: fields.map(f => ({
          type: 'box', layout: 'horizontal',
          contents: [
            { type: 'text', text: f.label, size: 'xs', color: '#9B9A94', flex: 2 },
            { type: 'text', text: f.value, size: 'sm', weight: 'bold', color: '#18170F', flex: 3, align: 'end', wrap: true }
          ]
        }))
      },
      footer: {
        type: 'box', layout: 'horizontal', paddingAll: '0px',
        contents: [
          { type: 'button', action: { type: 'postback', label: '✏️ แก้ไข', data: `action=EDIT&type=${nlp.intent}`, displayText: 'แก้ไข' }, style: 'secondary', height: 'sm', flex: 1, color: '#636259' },
          { type: 'button', action: { type: 'postback', label: '✓ บันทึก', data: `action=${action}&payload=${payload}`, displayText: 'บันทึกแล้ว' }, style: 'primary', height: 'sm', flex: 1, color: '#2A5C45' }
        ]
      }
    }
  }
}

export function buildSuccessMessage(type: 'expense' | 'appointment', data: any, budget?: BudgetSummary | null) {
  let text = type === 'expense'
    ? `✅ บันทึก ${data.description} ฿${Number(data.amount).toLocaleString()} แล้ว`
    : `✅ บันทึกนัด "${data.title}" วัน${formatDateTH(data.date)} เวลา ${data.time} แล้ว`

  if (type === 'expense' && budget) {
    text += `\n\n${budget.category_name}: ใช้ ${budget.pct_used}% (เหลือ ฿${budget.remaining.toLocaleString()})`
    if (budget.pct_used >= 100) text += '\n🚨 เกินงบแล้ว!'
    else if (budget.pct_used >= 80) text += '\n⚠️ ใกล้เต็มงบแล้ว'
  }

  if (type === 'appointment') text += `\n🔔 จะแจ้งเตือนก่อน ${data.reminderMinutes ?? 60} นาที`

  return { type: 'text' as const, text }
}

function formatDateTH(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('th-TH', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  })
}

function categoryLabel(cat: string): string {
  return ({ FOOD:'🍜 อาหาร', TRANSPORT:'🚗 เดินทาง', SHOPPING:'🛍️ ช้อปปิ้ง',
            BILLS:'📄 บิล', HEALTH:'💊 สุขภาพ', OTHER:'📦 อื่นๆ',
            WORK:'💼 งาน', PERSONAL:'👤 ส่วนตัว', HEALTH2:'💊 สุขภาพ' } as any)[cat] ?? cat
}
```

---

## OCR Slip Service

```typescript
// backend/src/services/ocr.service.ts
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '../lib/supabase'

const client = new Anthropic()

const OCR_PROMPT = `Extract payment slip information from this image.
Respond with ONLY valid JSON. No explanation.
{
  "amount": number (Thai Baht, null if not found),
  "date": "YYYY-MM-DD" (null if not found),
  "time": "HH:MM" (null if not found),
  "merchant_name": "string or null",
  "sender_bank": "string or null",
  "receiver_bank": "string or null",
  "transaction_ref": "string or null",
  "slip_type": "PROMPTPAY | BANK_TRANSFER | RECEIPT | UNKNOWN"
}`

export async function extractSlipData(imageBase64: string, mediaType = 'image/jpeg') {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType as any, data: imageBase64 } },
        { type: 'text', text: OCR_PROMPT }
      ]
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  return JSON.parse(text)
}

// Upload slip image scoped to userId
export async function uploadSlipImage(userId: string, buffer: Buffer, mimetype: string): Promise<string> {
  const path = `${userId}/${Date.now()}.jpg`    // ← แยก folder ต่อ user
  const { error } = await supabaseAdmin.storage.from('slips').upload(path, buffer, { contentType: mimetype })
  if (error) throw error
  const { data } = supabaseAdmin.storage.from('slips').getPublicUrl(path)
  return data.publicUrl
}
```
