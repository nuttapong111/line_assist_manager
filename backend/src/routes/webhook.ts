import { Router } from 'express'
import { middleware, WebhookEvent } from '@line/bot-sdk'
import { createUserIfNotExists } from '../services/user.service'
import { parseMessage } from '../services/nlp.service'
import { buildConfirmFlexMessage, buildSuccessMessage, buildQueryReply } from '../services/flex.service'
import { sendPushWithQuotaCheck, lineClient } from '../services/push.service'
import { getBudgetSummaryByCategory, resolveCategoryId } from '../services/budget.service'
import { createTransaction } from '../services/finance.service'
import { createAppointment } from '../services/appointment.service'

const router = Router()

router.post('/',
  middleware({ channelSecret: process.env.LINE_CHANNEL_SECRET! }),
  async (req, res) => {
    res.sendStatus(200)
    await Promise.allSettled((req.body.events as WebhookEvent[]).map(handleEvent))
  }
)

async function handleEvent(event: WebhookEvent) {
  const lineUserId = event.source?.userId
  if (!lineUserId) return

  const user = await createUserIfNotExists(lineUserId)

  if (event.type === 'message' && event.message.type === 'text') {
    await handleTextMessage(event, user, lineUserId)
  } else if (event.type === 'postback') {
    await handlePostback(event, user, lineUserId)
  } else if (event.type === 'message' && event.message.type === 'image') {
    await handleImageMessage(event, lineUserId)
  } else if (event.type === 'follow') {
    await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'สวัสดีครับ! 👋 ยินดีต้อนรับสู่ MyAssist\nพิมข้อความธรรมชาติได้เลย เช่น:\n"กาแฟ 85"\n"นัดหมอพรุ่งนี้ 10 โมง"',
    })
  }
}

async function handleTextMessage(event: any, user: any, lineUserId: string) {
  const text: string = event.message.text.trim()
  const nlp = await parseMessage(text)

  if (nlp.intent === 'UNKNOWN' || nlp.confidence < 0.6) {
    await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ขอโทษครับ ไม่เข้าใจ 😅\nลองพิม เช่น:\n"นัดหมอพรุ่งนี้ 10 โมง"\n"กาแฟ 85 อาหาร"\n"ใช้ไปเท่าไหร่เดือนนี้"',
    })
    return
  }

  if (nlp.intent === 'QUERY') {
    const reply = await buildQueryReply(user.id, nlp.data)
    await lineClient.replyMessage(event.replyToken, reply)
    return
  }

  await lineClient.replyMessage(event.replyToken, buildConfirmFlexMessage(nlp) as any)
}

async function handlePostback(event: any, user: any, lineUserId: string) {
  const params = new URLSearchParams(event.postback.data)
  const action = params.get('action')

  switch (action) {
    case 'CONFIRM_EXPENSE': {
      const payload = JSON.parse(params.get('payload') || '{}')
      const categoryId = await resolveCategoryId(user.id, payload.category || 'OTHER')
      const tx = await createTransaction(user.id, {
        type: payload.type || 'EXPENSE',
        amount: payload.amount,
        description: payload.description,
        categoryId,
        transactionDate: payload.date,
        source: 'CHAT',
      })
      const month = new Date().toISOString().slice(0, 7)
      const budget = categoryId
        ? await getBudgetSummaryByCategory(user.id, categoryId, month)
        : null
      await lineClient.replyMessage(event.replyToken, buildSuccessMessage('expense', payload, budget))
      if (budget && budget.pct_used >= 80) {
        await sendPushWithQuotaCheck(user.id, lineUserId, {
          type: 'text',
          text: `⚠️ หมวด${budget.category_name}: ใช้ไป ${budget.pct_used}% แล้วนะครับ (เหลือ ฿${budget.remaining.toLocaleString()})`,
        })
      }
      break
    }
    case 'CONFIRM_APPOINTMENT': {
      const payload = JSON.parse(params.get('payload') || '{}')
      const startAt = `${payload.date}T${payload.time}:00`
      await createAppointment(user.id, {
        title: payload.title,
        location: payload.location,
        category: payload.category,
        startAt,
        reminderMin: payload.reminderMinutes || 60,
        source: 'CHAT',
      })
      await lineClient.replyMessage(event.replyToken, buildSuccessMessage('appointment', payload))
      break
    }
    case 'ADD_APPOINTMENT':
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '📅 พิมนัดหมายได้เลยครับ\n"นัดประชุมพรุ่งนี้บ่ายสอง"\n"หมอฟันวันเสาร์ 10 โมง"',
      })
      break
    case 'ADD_EXPENSE':
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '💸 พิมรายจ่ายได้เลยครับ\n"กาแฟ 85"\n"ค่าน้ำมัน 500 เดินทาง"',
      })
      break
    case 'SUMMARY': {
      const reply = await buildQueryReply(user.id, { queryType: 'MONTHLY_SUMMARY', period: 'this_month' })
      await lineClient.replyMessage(event.replyToken, reply)
      break
    }
    case 'ADD_REMINDER':
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '🔔 พิมเตือนได้เลยครับ\n"เตือนจ่ายค่าไฟวันที่ 15"\n"อย่าลืมประชุม 14:00"',
      })
      break
    default:
      break
  }
}

async function handleImageMessage(event: any, lineUserId: string) {
  const liffUrl = `${process.env.FRONTEND_URL}/slip?source=camera`
  await lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: `📷 รับสลิปแล้ว! กดลิงก์เพื่ออ่านและบันทึก:\n${liffUrl}`,
  })
}

export default router
