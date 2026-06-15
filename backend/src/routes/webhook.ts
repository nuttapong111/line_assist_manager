import { Router } from 'express'
import { middleware, WebhookEvent } from '@line/bot-sdk'
import { createUserIfNotExists } from '../services/user.service'
import { parseMessage, isAppointmentQueryText, parseAppointmentQueryLocal } from '../services/nlp.service'
import { buildConfirmFlexMessage, buildSuccessMessage, buildQueryReply } from '../services/flex.service'
import { sendPushWithQuotaCheck, lineClient } from '../services/push.service'
import { getBudgetSummaryByCategory, resolveCategoryId } from '../services/budget.service'
import { createTransaction } from '../services/finance.service'
import { createAppointment } from '../services/appointment.service'
import {
  setChatMode,
  setPendingConfirm,
  getChatContext,
  clearChatContext,
  isConfirmText,
  isCancelText,
  type PendingType,
} from '../services/chat-context.service'
import { buildStockQueryReply, addSymbolToWatchlist, isAddWatchlistText, isStockRelatedText, extractSymbolFromText } from '../services/investment.service'

const router = Router()

router.post('/',
  (req, res, next) => {
    if (!process.env.LINE_CHANNEL_SECRET) {
      console.error('[webhook] LINE_CHANNEL_SECRET is not set')
      return res.status(500).send('LINE_CHANNEL_SECRET not configured')
    }
    next()
  },
  middleware({ channelSecret: process.env.LINE_CHANNEL_SECRET as string }),
  async (req, res) => {
    res.sendStatus(200)
    const events = req.body?.events as WebhookEvent[] | undefined
    if (!events?.length) return
    const results = await Promise.allSettled(events.map(handleEvent))
    for (const r of results) {
      if (r.status === 'rejected') console.error('[webhook] event handler failed:', r.reason)
    }
  }
)

function parsePostbackPayload(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(decodeURIComponent(raw))
    } catch {
      console.error('[webhook] Failed to parse postback payload:', raw)
      return {}
    }
  }
}

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

async function confirmExpense(
  replyToken: string,
  user: { id: string },
  lineUserId: string,
  payload: Record<string, unknown>,
) {
  const categoryId = await resolveCategoryId(user.id, String(payload.category || 'OTHER'))
  await createTransaction(user.id, {
    type: String(payload.type || 'EXPENSE'),
    amount: Number(payload.amount),
    description: String(payload.description || ''),
    categoryId,
    transactionDate: String(payload.date || new Date().toISOString().split('T')[0]),
    source: 'CHAT',
  })
  const month = new Date().toISOString().slice(0, 7)
  const budget = categoryId
    ? await getBudgetSummaryByCategory(user.id, categoryId, month)
    : null
  await lineClient.replyMessage(replyToken, buildSuccessMessage('expense', payload, budget))
  if (budget && budget.pct_used >= 80) {
    await sendPushWithQuotaCheck(user.id, lineUserId, {
      type: 'text',
      text: `⚠️ หมวด${budget.category_name}: ใช้ไป ${budget.pct_used}% แล้วนะครับ (เหลือ ฿${budget.remaining.toLocaleString()})`,
    })
  }
}

async function confirmAppointment(replyToken: string, user: { id: string }, payload: Record<string, unknown>) {
  const date = String(payload.date || new Date().toISOString().split('T')[0])
  const time = String(payload.time || '09:00')
  const startAt = `${date}T${time}:00`
  await createAppointment(user.id, {
    title: String(payload.title || 'นัดหมาย'),
    location: payload.location ? String(payload.location) : undefined,
    category: String(payload.category || 'PERSONAL'),
    startAt,
    reminderMin: Number(payload.reminderMinutes || 60),
    source: 'CHAT',
  })
  await lineClient.replyMessage(replyToken, buildSuccessMessage('appointment', payload))
}

async function handleTextMessage(event: any, user: any, lineUserId: string) {
  const text: string = event.message.text.trim()
  const ctx = getChatContext(lineUserId)

  try {
    if (isCancelText(text)) {
      clearChatContext(lineUserId)
      await lineClient.replyMessage(event.replyToken, { type: 'text', text: 'ยกเลิกแล้วครับ' })
      return
    }

    if (isConfirmText(text) && !ctx?.pending) {
      return
    }

    if (isConfirmText(text) && ctx?.pending) {
      const { type, data } = ctx.pending
      if (type === 'EXPENSE' || type === 'INCOME') {
        await confirmExpense(event.replyToken, user, lineUserId, data)
      } else if (type === 'APPOINTMENT') {
        await confirmAppointment(event.replyToken, user, data)
      }
      clearChatContext(lineUserId)
      return
    }

    // หุ้น / watchlist — จับตรงๆ ก่อน NLP (ไม่พึ่ง Gemini)
    if (isAddWatchlistText(text)) {
      const symbol = extractSymbolFromText(text)
      if (symbol) {
        const reply = await addSymbolToWatchlist(user.id, symbol)
        await lineClient.replyMessage(event.replyToken, { type: 'text', text: reply })
        return
      }
    }

    if (isAppointmentQueryText(text)) {
      clearChatContext(lineUserId)
      const reply = await buildQueryReply(user.id, parseAppointmentQueryLocal(text)?.data ?? null)
      await lineClient.replyMessage(event.replyToken, reply)
      return
    }

    const stockSymbol = extractSymbolFromText(text)
    if (stockSymbol && isStockRelatedText(text) && !isAddWatchlistText(text)) {
      const reply = await buildStockQueryReply(stockSymbol)
      await lineClient.replyMessage(event.replyToken, { type: 'text', text: reply })
      return
    }

    const nlp = await parseMessage(text, ctx?.mode)

    if (nlp.intent === 'UNKNOWN' || nlp.confidence < 0.6) {
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ขอโทษครับ ไม่เข้าใจ 😅\nลองพิม เช่น:\n"NVDA ตอนนี้เป็นอย่างไร"\n"ติดตาม PTT"\n"นัดหมอพรุ่งนี้ 10 โมง"\n"กาแฟ 85 อาหาร"',
      })
      return
    }

    if (nlp.intent === 'QUERY') {
      clearChatContext(lineUserId)
      const reply = await buildQueryReply(user.id, nlp.data)
      await lineClient.replyMessage(event.replyToken, reply)
      return
    }

    if (nlp.intent === 'STOCK_QUERY') {
      const symbol = String(nlp.data?.symbol || '')
      const text = await buildStockQueryReply(symbol)
      await lineClient.replyMessage(event.replyToken, { type: 'text', text })
      return
    }

    if (nlp.intent === 'ADD_WATCHLIST') {
      const symbol = String(nlp.data?.symbol || '')
      const text = await addSymbolToWatchlist(user.id, symbol)
      await lineClient.replyMessage(event.replyToken, { type: 'text', text })
      return
    }

    const pendingType: PendingType =
      nlp.intent === 'INCOME' ? 'INCOME'
        : nlp.intent === 'APPOINTMENT' ? 'APPOINTMENT'
          : 'EXPENSE'

    setPendingConfirm(lineUserId, pendingType, nlp.data || {})
    await lineClient.replyMessage(event.replyToken, buildConfirmFlexMessage(nlp) as any)
  } catch (err) {
    console.error('[webhook] handleTextMessage failed:', text, err)
    try {
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ระบบมีปัญหาชั่วคราวครับ ลองพิมใหม่อีกครั้งนะครับ',
      })
    } catch (replyErr) {
      console.error('[webhook] error reply failed:', replyErr)
    }
  }
}

async function handlePostback(event: any, user: any, lineUserId: string) {
  const params = new URLSearchParams(event.postback.data)
  const action = params.get('action')

  try {
    switch (action) {
      case 'CONFIRM_EXPENSE': {
        const ctx = getChatContext(lineUserId)
        const payload = ctx?.pending?.type === 'EXPENSE' || ctx?.pending?.type === 'INCOME'
          ? ctx.pending.data
          : parsePostbackPayload(params.get('payload'))
        if (!payload?.amount) throw new Error('Missing expense payload — พิมรายการใหม่แล้วกดยืนยันอีกครั้ง')
        await confirmExpense(event.replyToken, user, lineUserId, payload)
        clearChatContext(lineUserId)
        break
      }
      case 'CONFIRM_APPOINTMENT': {
        const ctx = getChatContext(lineUserId)
        const payload = ctx?.pending?.type === 'APPOINTMENT'
          ? ctx.pending.data
          : parsePostbackPayload(params.get('payload'))
        if (!payload?.title && !payload?.date) {
          throw new Error('Missing appointment payload — พิมนัดหมายใหม่แล้วกดยืนยันอีกครั้ง')
        }
        await confirmAppointment(event.replyToken, user, payload)
        clearChatContext(lineUserId)
        break
      }
      case 'CANCEL':
        clearChatContext(lineUserId)
        await lineClient.replyMessage(event.replyToken, { type: 'text', text: 'ยกเลิกแล้วครับ' })
        break
      case 'ADD_APPOINTMENT':
        setChatMode(lineUserId, 'APPOINTMENT')
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '📅 พิมนัดหมายได้เลยครับ\n"นัดประชุมพรุ่งนี้บ่ายสอง"\n"ทานข้าว 11โมง"\n"หมอฟันวันเสาร์ 10 โมง"',
        })
        break
      case 'ADD_EXPENSE':
        setChatMode(lineUserId, 'EXPENSE')
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '💸 พิมรายจ่ายได้เลยครับ\n"กาแฟ 85"\n"ค่าน้ำมัน 500 เดินทาง"',
        })
        break
      case 'SUMMARY': {
        clearChatContext(lineUserId)
        const reply = await buildQueryReply(user.id, { queryType: 'MONTHLY_SUMMARY', period: 'this_month' })
        await lineClient.replyMessage(event.replyToken, reply)
        break
      }
      case 'ADD_REMINDER':
        setChatMode(lineUserId, 'REMINDER')
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '🔔 พิมเตือนได้เลยครับ\n"เตือนจ่ายค่าไฟวันที่ 15"\n"อย่าลืมประชุม 14:00"',
        })
        break
      case 'ADD_WATCHLIST':
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '📈 พิมติดตามหุ้นได้เลยครับ\n"ติดตาม NVDA"\n"ติดตาม PTT"\n"watchlist AAPL"\n\nดูวิเคราะห์: "NVDA ตอนนี้เป็นอย่างไร"',
        })
        break
      default:
        break
    }
  } catch (err) {
    console.error('[webhook] postback error:', action, err)
    await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'บันทึกไม่สำเร็จครับ ลองพิมรายการใหม่อีกครั้งนะครับ',
    })
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
