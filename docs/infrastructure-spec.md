# Infrastructure Spec
## Railway PostgreSQL + Drizzle ORM + Cloudflare R2
## อ่านไฟล์นี้ก่อน code ทุกอย่าง — แทนที่ทุก mention ของ Supabase ในไฟล์อื่น

---

## Stack ทั้งหมด

```
Frontend  : React 18 + TypeScript + Vite → deploy บน Vercel
Backend   : Express + TypeScript         → deploy บน Railway
Database  : PostgreSQL                   → Railway PostgreSQL plugin (same project)
ORM       : Drizzle ORM                  → type-safe, migration ง่าย
Storage   : Cloudflare R2                → เก็บรูปสลิป, ฟรี 10GB egress ฟรีตลอด
```

---

## ทำไมถึงเลือกแต่ละตัว

```
Railway PostgreSQL:
  - backend + DB อยู่ใน project เดียวกัน → latency ต่ำ
  - billing ที่เดียว ง่ายกว่า
  - DATABASE_URL inject ให้อัตโนมัติ ไม่ต้อง config

Drizzle ORM:
  - type-safe ทุก query — TypeScript รู้ทันทีถ้า column ผิด
  - migration ด้วย drizzle-kit generate + migrate
  - drizzle-kit studio เป็น GUI ดู/แก้ data แทน Supabase dashboard

Cloudflare R2:
  - ฟรี 10GB storage + 1M PUT + 10M GET ต่อเดือน ตลอดไป (ไม่มีหมดอายุ)
  - egress (ดาวน์โหลด) ฟรีทุกกรณี — สำคัญมากเพราะ user ดูสลิปใน LIFF
  - S3-compatible API ใช้ @aws-sdk/client-s3 เดียวกันได้เลย
  - เก็บเงินผ่าน Cloudflare account (บัตรเครดิต) รายเดือน
    เกิน free tier ค่อยเสีย: $0.015/GB, $4.50/M Class A ops
  - สำหรับ project นี้ (สลิป ~300KB/ใบ) → free tier รองรับได้ ~33,000 รูป
```

---

## Dependencies

```bash
# ORM + DB
npm i drizzle-orm pg
npm i -D drizzle-kit @types/pg

# Storage (R2 ใช้ S3-compatible SDK)
npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# อื่นๆ (เหมือนเดิม)
npm i @line/bot-sdk @line/liff node-cron multer
npm i googleapis technicalindicators
npm i @anthropic-ai/sdk
```

---

## Environment Variables (ครบทั้งหมด)

```bash
# .env.example

# ─── LINE ────────────────────────────────
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LIFF_ID=

# ─── Anthropic ───────────────────────────
ANTHROPIC_API_KEY=

# ─── Database ────────────────────────────
# Railway inject ให้อัตโนมัติเมื่อเพิ่ม PostgreSQL plugin
# copy จาก Railway dashboard → myassist-db → Connect
DATABASE_URL=postgresql://user:pass@host:5432/railway

# ─── Cloudflare R2 ───────────────────────
# dash.cloudflare.com → R2 → Manage R2 API Tokens
CF_ACCOUNT_ID=                    # หน้าหลัก R2 จะเห็น Account ID
R2_ACCESS_KEY_ID=                 # จาก API Token ที่สร้าง
R2_SECRET_ACCESS_KEY=             # จาก API Token ที่สร้าง
R2_BUCKET_NAME=myassist-slips
R2_PUBLIC_URL=https://pub-xxx.r2.dev   # เปิด Public Access ใน bucket settings

# ─── Google Calendar (optional) ──────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ─── App ─────────────────────────────────
FRONTEND_URL=https://your-liff.vercel.app
BACKEND_URL=https://your-app.railway.app
PORT=3000
NODE_ENV=production
```

---

## Cloudflare R2 Setup (ทำครั้งเดียว ~5 นาที)

```
1. ไปที่ dash.cloudflare.com → R2 Object Storage
2. Create bucket → ชื่อ: myassist-slips → region: APAC
3. Settings → Public Access → Allow Access (เพื่อให้ LIFF เปิดรูปได้)
   จะได้ public URL: https://pub-xxx.r2.dev
4. R2 → Manage R2 API Tokens → Create API Token
   Permission: Object Read & Write
   Bucket: myassist-slips
   จะได้ Access Key ID + Secret Access Key
5. copy ค่าทั้งหมดใส่ .env
```

---

## Database Client

```typescript
// backend/src/lib/db.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
})

export const db = drizzle(pool, { schema })
export { pool }
```

---

## Drizzle Config

```typescript
// backend/drizzle.config.ts
import type { Config } from 'drizzle-kit'

export default {
  schema:    './src/lib/schema.ts',
  out:       './drizzle',
  dialect:   'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

---

## Schema (ทุก table รวมในไฟล์เดียว)

```typescript
// backend/src/lib/schema.ts
import {
  pgTable, uuid, text, numeric, boolean,
  timestamp, date, integer, unique
} from 'drizzle-orm/pg-core'

// ─── USERS ───────────────────────────────
export const users = pgTable('users', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  lineUserId:            text('line_user_id').unique().notNull(),
  displayName:           text('display_name'),
  pictureUrl:            text('picture_url'),
  morningSummaryEnabled: boolean('morning_summary_enabled').default(true),
  morningSummaryTime:    text('morning_summary_time').default('08:00'),
  timezone:              text('timezone').default('Asia/Bangkok'),
  createdAt:             timestamp('created_at').defaultNow(),
  updatedAt:             timestamp('updated_at').defaultNow(),
})

// ─── BUDGET CATEGORIES ────────────────────
export const budgetCategories = pgTable('budget_categories', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  icon:      text('icon').default('📦'),
  color:     text('color').default('#2A5C45'),
  sortOrder: integer('sort_order').default(0),
})

// ─── BUDGETS ─────────────────────────────
export const budgets = pgTable('budgets', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => budgetCategories.id, { onDelete: 'cascade' }),
  amount:     numeric('amount', { precision: 12, scale: 2 }).notNull(),
  month:      text('month').notNull(),
  createdAt:  timestamp('created_at').defaultNow(),
}, t => ({ uniq: unique().on(t.userId, t.categoryId, t.month) }))

// ─── TRANSACTIONS ─────────────────────────
export const transactions = pgTable('transactions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId:      uuid('category_id').references(() => budgetCategories.id),
  type:            text('type').notNull(),               // EXPENSE | INCOME
  amount:          numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description:     text('description'),
  merchantName:    text('merchant_name'),
  transactionDate: date('transaction_date').defaultNow(),
  slipImageUrl:    text('slip_image_url'),               // R2 public URL
  source:          text('source').default('MANUAL'),     // MANUAL | OCR | CHAT
  createdAt:       timestamp('created_at').defaultNow(),
})

// ─── APPOINTMENTS ─────────────────────────
export const appointments = pgTable('appointments', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title:          text('title').notNull(),
  location:       text('location'),
  category:       text('category').default('PERSONAL'),
  startAt:        timestamp('start_at').notNull(),
  endAt:          timestamp('end_at'),
  reminderMin:    integer('reminder_min').default(60),
  isReminded:     boolean('is_reminded').default(false),
  gcalEventId:    text('gcal_event_id').unique(),
  gcalCalendarId: text('gcal_calendar_id'),
  sourceUpdated:  text('source_updated').default('MYASSIST'),
  source:         text('source').default('MANUAL'),
  createdAt:      timestamp('created_at').defaultNow(),
})

// ─── REMINDERS ────────────────────────────
export const reminders = pgTable('reminders', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  message:    text('message').notNull(),
  remindAt:   timestamp('remind_at').notNull(),
  repeatType: text('repeat_type').default('NONE'),
  isDone:     boolean('is_done').default(false),
  createdAt:  timestamp('created_at').defaultNow(),
})

// ─── PUSH QUOTA ───────────────────────────
export const pushLog = pgTable('push_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  month:     text('month').notNull(),
  pushCount: integer('push_count').default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
}, t => ({ uniq: unique().on(t.userId, t.month) }))

// ─── WATCHED ASSETS ───────────────────────
export const watchedAssets = pgTable('watched_assets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol:      text('symbol').notNull(),
  displayName: text('display_name').notNull(),
  assetType:   text('asset_type').notNull(),
  currency:    text('currency').default('THB'),
  sortOrder:   integer('sort_order').default(0),
  createdAt:   timestamp('created_at').defaultNow(),
}, t => ({ uniq: unique().on(t.userId, t.symbol) }))

// ─── PRICE ALERTS ─────────────────────────
export const priceAlerts = pgTable('price_alerts', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assetId:       uuid('asset_id').notNull().references(() => watchedAssets.id, { onDelete: 'cascade' }),
  conditionType: text('condition_type').notNull(),
  targetValue:   numeric('target_value', { precision: 18, scale: 4 }).notNull(),
  repeatMode:    text('repeat_mode').default('ONCE'),
  isActive:      boolean('is_active').default(true),
  isTriggered:   boolean('is_triggered').default(false),
  lastTriggered: timestamp('last_triggered'),
  note:          text('note'),
  createdAt:     timestamp('created_at').defaultNow(),
})

// ─── PRICE CACHE ──────────────────────────
export const priceCache = pgTable('price_cache', {
  symbol:    text('symbol').primaryKey(),
  price:     numeric('price', { precision: 18, scale: 4 }).notNull(),
  changePct: numeric('change_pct', { precision: 8, scale: 4 }),
  open:      numeric('open', { precision: 18, scale: 4 }),
  high:      numeric('high', { precision: 18, scale: 4 }),
  low:       numeric('low', { precision: 18, scale: 4 }),
  volume:    numeric('volume', { precision: 20, scale: 0 }),
  currency:  text('currency').default('THB'),
  fetchedAt: timestamp('fetched_at').defaultNow(),
})

// ─── SAVING GOALS ─────────────────────────
export const savingGoals = pgTable('saving_goals', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  icon:          text('icon').default('🎯'),
  targetAmount:  numeric('target_amount', { precision: 14, scale: 2 }).notNull(),
  currentAmount: numeric('current_amount', { precision: 14, scale: 2 }).default('0'),
  deadline:      date('deadline'),
  monthlyTarget: numeric('monthly_target', { precision: 14, scale: 2 }),
  color:         text('color').default('#2A5C45'),
  isCompleted:   boolean('is_completed').default(false),
  createdAt:     timestamp('created_at').defaultNow(),
})

// ─── GOAL CONTRIBUTIONS ───────────────────
export const goalContributions = pgTable('goal_contributions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  goalId:      uuid('goal_id').notNull().references(() => savingGoals.id, { onDelete: 'cascade' }),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount:      numeric('amount', { precision: 14, scale: 2 }).notNull(),
  note:        text('note'),
  contribDate: date('contrib_date').defaultNow(),
  createdAt:   timestamp('created_at').defaultNow(),
})

// ─── PORTFOLIO POSITIONS ──────────────────
export const portfolioPositions = pgTable('portfolio_positions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assetId:     uuid('asset_id').references(() => watchedAssets.id),
  symbol:      text('symbol').notNull(),
  displayName: text('display_name').notNull(),
  assetType:   text('asset_type').notNull(),
  quantity:    numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  avgCost:     numeric('avg_cost', { precision: 18, scale: 4 }).notNull(),
  currency:    text('currency').default('THB'),
  createdAt:   timestamp('created_at').defaultNow(),
  updatedAt:   timestamp('updated_at').defaultNow(),
})

// ─── PORTFOLIO TRADES ─────────────────────
export const portfolioTrades = pgTable('portfolio_trades', {
  id:         uuid('id').primaryKey().defaultRandom(),
  positionId: uuid('position_id').notNull().references(() => portfolioPositions.id, { onDelete: 'cascade' }),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tradeType:  text('trade_type').notNull(),   // BUY | SELL
  quantity:   numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  price:      numeric('price', { precision: 18, scale: 4 }).notNull(),
  fee:        numeric('fee', { precision: 10, scale: 2 }).default('0'),
  tradeDate:  date('trade_date').defaultNow(),
  note:       text('note'),
  createdAt:  timestamp('created_at').defaultNow(),
})

// ─── GOOGLE CALENDAR TOKENS ───────────────
export const googleCalendarTokens = pgTable('google_calendar_tokens', {
  userId:       uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  accessToken:  text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt:    timestamp('expires_at').notNull(),
  calendarIds:  text('calendar_ids').array(),
  syncEnabled:  boolean('sync_enabled').default(true),
  lastSynced:   timestamp('last_synced'),
  createdAt:    timestamp('created_at').defaultNow(),
})

// ─── SIGNAL LOG ───────────────────────────
export const signalLog = pgTable('signal_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol:    text('symbol').notNull(),
  score:     numeric('score', { precision: 4, scale: 2 }),
  overall:   text('overall'),
  timeframe: text('timeframe'),
  sentAt:    timestamp('sent_at').defaultNow(),
})
```

---

## Cloudflare R2 Storage Service

```typescript
// backend/src/lib/storage.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// R2 ใช้ S3-compatible API — SDK เดียวกันกับ AWS S3
export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.R2_BUCKET_NAME!

// path ต้องขึ้นด้วย userId เสมอ — แยก folder ต่อ user
export async function uploadSlip(
  userId: string,
  buffer: Buffer,
  mimetype: string
): Promise<string> {
  const key = `slips/${userId}/${Date.now()}.jpg`
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: buffer, ContentType: mimetype,
  }))
  return `${process.env.R2_PUBLIC_URL}/${key}`   // public URL สำหรับแสดงใน LIFF
}
```

---

## Ownership Check (แทน Supabase RLS)

```typescript
// backend/src/middleware/ownership.ts
import { db } from '../lib/db'
import { eq } from 'drizzle-orm'
import * as schema from '../lib/schema'

type OwnedTable = keyof typeof tableMap
const tableMap = {
  transactions:        schema.transactions,
  appointments:        schema.appointments,
  reminders:           schema.reminders,
  budgets:             schema.budgets,
  priceAlerts:         schema.priceAlerts,
  savingGoals:         schema.savingGoals,
  portfolioPositions:  schema.portfolioPositions,
} as const

export async function verifyOwner(
  table: OwnedTable, id: string, userId: string
): Promise<boolean> {
  const t = tableMap[table] as any
  const [row] = await db.select({ userId: t.userId })
    .from(t).where(eq(t.id, id)).limit(1)
  return row?.userId === userId
}

// ใช้ใน route:
// if (!await verifyOwner('transactions', id, req.user.id)) {
//   return res.status(403).json({ error: true, code: 'FORBIDDEN' })
// }
```

---

## Query Pattern (Drizzle แทน Supabase)

```typescript
import { db } from '../lib/db'
import { transactions } from '../lib/schema'
import { eq, and, gte, lt, desc } from 'drizzle-orm'

// ✅ ถูก — ทุก query ต้องมี eq(table.userId, userId)
const data = await db
  .select()
  .from(transactions)
  .where(and(
    eq(transactions.userId, userId),
    gte(transactions.transactionDate, startDate),
    lt(transactions.transactionDate, endDate)
  ))
  .orderBy(desc(transactions.createdAt))
  .limit(20)

// Insert
await db.insert(transactions).values({
  userId, categoryId, type: 'EXPENSE',
  amount: '350.00', description: 'กาแฟ',
  source: 'CHAT',
})

// Update — ต้อง verify owner ก่อนเสมอ
await db.update(transactions)
  .set({ description: 'กาแฟ Amazon' })
  .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))

// Delete — ต้อง verify owner ก่อนเสมอ
await db.delete(transactions)
  .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
```

---

## Migration & Scripts

```json
// backend/package.json
{
  "scripts": {
    "dev":           "ts-node-dev --respawn src/app.ts",
    "build":         "tsc",
    "start":         "node dist/app.js",
    "db:generate":   "drizzle-kit generate",
    "db:migrate":    "ts-node src/lib/migrate.ts",
    "db:studio":     "drizzle-kit studio",
    "setup:richmenu":"ts-node src/scripts/setup-richmenu.ts"
  }
}
```

```typescript
// backend/src/lib/migrate.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  console.log('✅ Migration complete')
  await pool.end()
}
main().catch(console.error)
```

---

## Railway Deployment

```toml
# backend/railway.toml
[build]
buildCommand = "npm run build && npm run db:migrate"

[deploy]
startCommand = "node dist/app.js"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

```
Railway setup steps:
1. สร้าง project ใน Railway
2. Add service → GitHub repo (backend/)
3. Add plugin → PostgreSQL → DATABASE_URL inject อัตโนมัติ
4. Variables → ใส่ทุก env var ใน .env.example
5. Deploy → Railway รัน build + migrate อัตโนมัติ
```

---

## Cost Summary (ประมาณการ)

```
Railway Hobby plan:     $5/เดือน  (backend + PostgreSQL รวม)
Cloudflare R2:          ฟรี       (ถ้าสลิปไม่เกิน ~33,000 รูป)
Vercel (frontend):      ฟรี       (Hobby plan)
LINE Messaging API:     ฟรี       (500 push/เดือน/user)
Anthropic API:          ~$2-5/เดือน (claude-sonnet-4-5, ขึ้นกับ usage)
Google Calendar API:    ฟรี
Finnhub (ข่าวหุ้น):     ฟรี (60 req/นาที)
Anthropic API:          ~$1-2/เดือน/user

รวมประมาณ: $7-10/เดือน
```
