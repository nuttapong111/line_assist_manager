import { Client } from '@line/bot-sdk'
import sharp from 'sharp'
import dotenv from 'dotenv'
import { normalizeUrl } from '../lib/url'

dotenv.config()

const client = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! })
const LIFF_URL = normalizeUrl(process.env.FRONTEND_URL || '')

const LABELS = [
  'เพิ่มนัดหมาย', 'บันทึกรายจ่าย', 'สแกนสลิป',
  'สรุปการเงิน', 'ตั้งเตือน', 'เปิดแอพ',
]

async function createPlaceholderImage(): Promise<Buffer> {
  const width = 2500
  const height = 843
  const cellW = 833
  const cellH = 421

  const svgLabels = LABELS.map((label, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = col * cellW + cellW / 2
    const y = row * cellH + cellH / 2
    return `<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="48" fill="white">${label}</text>`
  }).join('')

  const svg = `
    <svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#2A5C45"/>
      ${[0, 1, 2].map(col => `<line x1="${col * cellW}" y1="0" x2="${col * cellW}" y2="${height}" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>`).join('')}
      <line x1="0" y1="${cellH}" x2="${width}" y2="${cellH}" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      ${svgLabels}
    </svg>
  `

  return sharp(Buffer.from(svg)).png().toBuffer()
}

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
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is required')
  }
  if (!LIFF_URL.startsWith('https://')) {
    throw new Error('FRONTEND_URL must be a valid https URL (e.g. https://your-app.up.railway.app)')
  }

  console.log('Creating rich menu...')
  const mainId = await createMainMenu()

  console.log('Uploading menu image...')
  const image = await createPlaceholderImage()
  await client.setRichMenuImage(mainId, image)

  console.log('Setting as default rich menu...')
  await client.setDefaultRichMenu(mainId)

  console.log('✅ Rich menu ready:', mainId)
  console.log('เปิดแชท LINE OA แล้วกดแท็บ "เมนู" ด้านล่าง')
}

main().catch((err) => {
  console.error('Rich menu setup failed:', err)
  process.exit(1)
})
