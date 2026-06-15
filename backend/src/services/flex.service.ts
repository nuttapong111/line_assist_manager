import type { NLPResult } from '../types'
import { getMonthlySummary } from './finance.service'
import { getBudgets } from './budget.service'
import { getTodayAppointments } from './appointment.service'
import { INVESTMENT_DISCLAIMER } from '../types'

export function buildConfirmFlexMessage(nlp: NLPResult) {
  const data = nlp.data || {}
  const payload = JSON.stringify(data)

  if (nlp.intent === 'EXPENSE' || nlp.intent === 'INCOME') {
    return {
      type: 'flex' as const,
      altText: `ยืนยัน${nlp.intent === 'EXPENSE' ? 'รายจ่าย' : 'รายรับ'} ${data.amount} บาท`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `ยืนยัน${nlp.intent === 'EXPENSE' ? 'รายจ่าย' : 'รายรับ'}`, weight: 'bold', size: 'lg' },
            { type: 'text', text: `฿${data.amount}`, size: 'xl', weight: 'bold', color: '#2A5C45' },
            { type: 'text', text: String(data.description || ''), margin: 'md' },
            { type: 'text', text: `หมวด: ${data.category || 'OTHER'}`, size: 'sm', color: '#636259' },
          ],
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'button',
              action: {
                type: 'postback',
                label: 'ยืนยัน',
                data: `action=CONFIRM_EXPENSE&payload=${encodeURIComponent(payload)}`,
                displayText: 'ยืนยัน',
              },
              style: 'primary',
              color: '#2A5C45',
            },
            {
              type: 'button',
              action: { type: 'postback', label: 'ยกเลิก', data: 'action=CANCEL', displayText: 'ยกเลิก' },
            },
          ],
        },
      },
    }
  }

  if (nlp.intent === 'APPOINTMENT') {
    return {
      type: 'flex' as const,
      altText: `ยืนยันนัดหมาย: ${data.title}`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ยืนยันนัดหมาย', weight: 'bold', size: 'lg' },
            { type: 'text', text: String(data.title || ''), size: 'md', weight: 'bold' },
            { type: 'text', text: `${data.date} ${data.time}`, size: 'sm', color: '#636259' },
            ...(data.location ? [{ type: 'text' as const, text: String(data.location), size: 'sm', color: '#636259' }] : []),
          ],
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'button',
              action: {
                type: 'postback',
                label: 'ยืนยัน',
                data: `action=CONFIRM_APPOINTMENT&payload=${encodeURIComponent(payload)}`,
                displayText: 'ยืนยัน',
              },
              style: 'primary',
              color: '#2A5C45',
            },
            {
              type: 'button',
              action: { type: 'postback', label: 'ยกเลิก', data: 'action=CANCEL', displayText: 'ยกเลิก' },
            },
          ],
        },
      },
    }
  }

  return { type: 'text' as const, text: 'ไม่รู้จัก intent นี้ครับ' }
}

export function buildSuccessMessage(type: string, data: Record<string, unknown>, budget?: { pct_used: number; remaining: number; category_name: string } | null) {
  if (type === 'expense') {
    let text = `✅ บันทึกรายจ่าย ฿${data.amount} แล้วครับ`
    if (budget && budget.pct_used >= 80) {
      text += `\n⚠️ หมวด${budget.category_name}: ใช้ไป ${budget.pct_used}% (เหลือ ฿${budget.remaining.toLocaleString()})`
    }
    return { type: 'text' as const, text }
  }
  if (type === 'appointment') {
    return {
      type: 'text' as const,
      text: `✅ บันทึกนัดหมาย "${data.title}" แล้วครับ\n📅 ${data.date} ${data.time}`,
    }
  }
  return { type: 'text' as const, text: '✅ บันทึกแล้วครับ' }
}

export async function buildQueryReply(userId: string, data: Record<string, unknown> | null) {
  const queryType = data?.queryType || 'MONTHLY_SUMMARY'
  const month = new Date().toISOString().slice(0, 7)

  if (queryType === 'MONTHLY_SUMMARY' || queryType === 'BUDGET_STATUS') {
    const summary = await getMonthlySummary(userId, month)
    const budgets = await getBudgets(userId, month)
    const totalBudget = budgets.reduce((s, b) => s + (b.budget_amount || 0), 0)

    let text = `📊 สรุปเดือนนี้ (${month})\n`
    text += `รายรับ: ฿${summary.income.toLocaleString()}\n`
    text += `รายจ่าย: ฿${summary.expenses.toLocaleString()}\n`
    text += `คงเหลือ: ฿${summary.balance.toLocaleString()}\n`
    if (totalBudget > 0) {
      text += `งบรวม: ฿${totalBudget.toLocaleString()} (ใช้ ${Math.round((summary.expenses / totalBudget) * 100)}%)\n`
    }
    text += `\n${INVESTMENT_DISCLAIMER}`
    return { type: 'text' as const, text }
  }

  if (queryType === 'APPOINTMENTS') {
    const appts = await getTodayAppointments(userId)
    if (appts.length === 0) return { type: 'text' as const, text: '📅 ไม่มีนัดหมายวันนี้ครับ' }
    const lines = appts.map(a => {
      const time = new Date(a.startAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
      return `• ${time} ${a.title}`
    })
    return { type: 'text' as const, text: `📅 นัดหมายวันนี้:\n${lines.join('\n')}` }
  }

  return { type: 'text' as const, text: 'ไม่พบข้อมูลที่ต้องการครับ' }
}
