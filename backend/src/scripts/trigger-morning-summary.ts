import dotenv from 'dotenv'
dotenv.config()

import { db } from '../lib/db'
import { users } from '../lib/schema'
import { buildMorningSummaryReply, sendMorningInvestmentSummaries } from '../services/investment.service'

async function main() {
  const preview = process.argv.includes('--preview')

  if (preview) {
    const allUsers = await db.select().from(users)
    if (!allUsers.length) {
      console.log('ไม่มี user ในระบบ')
      process.exit(1)
    }
    for (const user of allUsers) {
      const reply = await buildMorningSummaryReply(user.id)
      const messages = reply ? (Array.isArray(reply) ? reply : [reply]) : []
      console.log(`\n--- ${user.lineUserId} (${messages.length} ข้อความ) ---\n`)
      messages.forEach((text, i) => {
        console.log(`[${i + 1}/${messages.length}]\n${text}`)
      })
      if (!messages.length) console.log('(ไม่มีข้อมูลสรุป)')
    }
    process.exit(0)
  }

  await sendMorningInvestmentSummaries()
  console.log('ส่งสรุปหุ้นเช้าเรียบร้อย')
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
