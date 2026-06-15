import { Client } from '@line/bot-sdk'
import dotenv from 'dotenv'

dotenv.config()

const client = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! })
const LIFF_URL = process.env.FRONTEND_URL!

async function createMainMenu() {
  return client.createRichMenu({
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'MyAssist Main',
    chatBarText: 'เมนู',
    areas: [
      { bounds: { x: 0, y: 0, width: 833, height: 421 }, action: { type: 'postback', data: 'action=ADD_APPOINTMENT', displayText: 'เพิ่มนัดหมาย' } },
      { bounds: { x: 833, y: 0, width: 834, height: 421 }, action: { type: 'postback', data: 'action=ADD_EXPENSE', displayText: 'บันทึกรายจ่าย' } },
      { bounds: { x: 1667, y: 0, width: 833, height: 421 }, action: { type: 'uri', uri: `${LIFF_URL}/slip`, label: 'สแกนสลิป' } },
      { bounds: { x: 0, y: 421, width: 833, height: 422 }, action: { type: 'postback', data: 'action=SUMMARY', displayText: 'ดูสรุปการเงิน' } },
      { bounds: { x: 833, y: 421, width: 834, height: 422 }, action: { type: 'postback', data: 'action=ADD_REMINDER', displayText: 'ตั้งเตือน' } },
      { bounds: { x: 1667, y: 421, width: 833, height: 422 }, action: { type: 'uri', uri: LIFF_URL, label: 'เปิดแอพ' } },
    ],
  })
}

async function main() {
  const mainId = await createMainMenu()
  await client.setDefaultRichMenu(mainId)
  console.log('✅ Rich menu created:', mainId)
}

main().catch(console.error)
