# New Features Spec
## Saving Goal · Portfolio Tracker · Morning Summary · Google Calendar Sync

---

## 1. Saving Goal

### Database (เพิ่มใน Block 1 ของ database-schema.md)

```sql
create table saving_goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete cascade not null,
  name         text not null,
  icon         text default '🎯',
  target_amount numeric(14,2) not null,
  current_amount numeric(14,2) default 0,
  deadline     date,
  monthly_target numeric(14,2),   -- คำนวณจาก target - current / เดือนที่เหลือ
  color        text default '#2A5C45',
  is_completed boolean default false,
  created_at   timestamptz default now()
);

create table goal_contributions (
  id         uuid primary key default gen_random_uuid(),
  goal_id    uuid references saving_goals(id) on delete cascade not null,
  user_id    uuid references users(id) on delete cascade not null,
  amount     numeric(14,2) not null,
  note       text,
  contrib_date date default current_date,
  created_at timestamptz default now()
);

alter table saving_goals        enable row level security;
alter table goal_contributions  enable row level security;
create policy "own_data_only" on saving_goals
  for all using (user_id = (select id from users where line_user_id = auth.uid()));
create policy "own_data_only" on goal_contributions
  for all using (user_id = (select id from users where line_user_id = auth.uid()));
```

### TypeScript Types

```typescript
export interface SavingGoal {
  id:             string
  user_id:        string
  name:           string
  icon:           string
  target_amount:  number
  current_amount: number
  deadline:       string | null   // 'YYYY-MM-DD'
  monthly_target: number | null
  color:          string
  is_completed:   boolean
  created_at:     string
  pct_complete?:  number          // computed: current/target*100
  months_left?:   number          // computed
  eta_month?:     string          // computed: เดือนที่คาดว่าจะถึงเป้า
}

export interface GoalContribution {
  id:          string
  goal_id:     string
  user_id:     string
  amount:      number
  note:        string | null
  contrib_date: string
  created_at:  string
}
```

### REST Endpoints

```
GET    /api/goals                → SavingGoal[] พร้อม pct_complete + eta
POST   /api/goals                → สร้าง goal ใหม่
PUT    /api/goals/:id            → แก้ไข ⚠️ verify owner
DELETE /api/goals/:id            → ⚠️ verify owner

POST   /api/goals/:id/contribute → { amount, note? } → บันทึก + อัปเดต current_amount
GET    /api/goals/:id/history    → GoalContribution[] รายเดือน
```

### NLP Patterns

```
เพิ่มใน NLP_SYSTEM_PROMPT:
Classify as GOAL_CONTRIBUTE:
- "ออม [ชื่อ goal หรือ fuzzy match] [จำนวน] บาท"
- "เก็บเงิน iPhone 500"
- "โอนเข้าเป้าเที่ยวญี่ปุ่น 2000"
→ { intent: "GOAL_CONTRIBUTE", data: { goal_hint: "iPhone", amount: 500 } }

Classify as GOAL_CREATE:
- "ตั้งเป้าเก็บเงิน [ชื่อ] [จำนวน]"
- "อยากซื้อ [ชื่อ] [จำนวน] บาท"
→ { intent: "GOAL_CREATE", data: { name, target_amount, deadline? } }

Classify as GOAL_QUERY:
- "iPhone goal เป็นยังไง" / "ออมไปเท่าไหร่แล้ว"
→ { intent: "GOAL_QUERY", data: { goal_hint } }
```

### Webhook Handler

```typescript
case 'GOAL_CONTRIBUTE': {
  const { goal_hint, amount } = nlp.data
  // fuzzy match goal name ด้วย goal_hint
  const goal = await findGoalByHint(user.id, goal_hint)
  if (!goal) {
    await lineClient.replyMessage(replyToken, {
      type: 'text', text: `ไม่พบเป้าหมาย "${goal_hint}" ครับ มีเป้าหมาย: ${goalNames}`
    })
    return
  }
  await contributeToGoal(goal.id, user.id, amount)
  const updated = await getGoal(goal.id, user.id)
  await lineClient.replyMessage(replyToken, {
    type: 'text',
    text: `✅ บันทึก +${amount.toLocaleString()} บ. ใน "${goal.name}" แล้ว\n` +
          `ออมไปแล้ว ${updated.current_amount.toLocaleString()} บ. (${updated.pct_complete?.toFixed(0)}%)\n` +
          (updated.eta_month ? `ถึงเป้าประมาณ ${updated.eta_month}` : '')
  })
  break
}
```

### Frontend — SavingGoals.tsx Screen

```
Layout:
- Page header: "เป้าหมายการออม" + จำนวนเป้า + ปุ่ม ＋
- Goal cards (scroll vertical):
    icon + name + deadline
    pct badge (สี: <50%=red, 50-79%=amber, ≥80%=accent)
    progress bar 6px (animated on mount)
    row: ออมไปแล้ว X / เหลือ Y
    monthly bar chart (4 เดือนล่าสุด, bar width = ratio vs monthly_target)
    footer: "ต้องออม X/เดือน" + ปุ่ม "+ ออมเพิ่ม"

- Bottom sheet "ออมเพิ่ม":
    เลือก goal (ถ้ามีหลายอัน)
    กรอกจำนวน
    หมายเหตุ (ไม่บังคับ)
    บันทึก

- Bottom sheet "สร้างเป้าหมาย":
    ชื่อ + icon picker
    ยอดเป้าหมาย
    วันครบกำหนด (optional)
    ระบบคำนวณ monthly_target ให้อัตโนมัติ
```

---

## 2. Portfolio Tracker

### Database

```sql
create table portfolio_positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade not null,
  asset_id      uuid references watched_assets(id),   -- link กับ price alert
  symbol        text not null,
  display_name  text not null,
  asset_type    text not null,   -- same as watched_assets
  quantity      numeric(18,6) not null,               -- หุ้น / หน่วย / บาทหนัก
  avg_cost      numeric(18,4) not null,               -- ราคาเฉลี่ยต่อหน่วย
  currency      text default 'THB',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table portfolio_trades (
  id           uuid primary key default gen_random_uuid(),
  position_id  uuid references portfolio_positions(id) on delete cascade not null,
  user_id      uuid references users(id) on delete cascade not null,
  trade_type   text not null check (trade_type in ('BUY','SELL')),
  quantity     numeric(18,6) not null,
  price        numeric(18,4) not null,
  fee          numeric(10,2) default 0,
  trade_date   date default current_date,
  note         text,
  created_at   timestamptz default now()
);

alter table portfolio_positions enable row level security;
alter table portfolio_trades    enable row level security;
create policy "own_data_only" on portfolio_positions
  for all using (user_id = (select id from users where line_user_id = auth.uid()));
create policy "own_data_only" on portfolio_trades
  for all using (user_id = (select id from users where line_user_id = auth.uid()));
```

### Portfolio Service

```typescript
// backend/src/services/portfolio.service.ts

export interface PortfolioItem {
  position:      PortfolioPosition
  current_price: number
  market_value:  number         // quantity * current_price
  cost_basis:    number         // quantity * avg_cost
  unrealized_pnl: number        // market_value - cost_basis
  pnl_pct:       number         // unrealized_pnl / cost_basis * 100
  signal?:       SignalSummary  // จาก signal.service ถ้ามี
}

export interface PortfolioSummary {
  total_value:    number
  total_cost:     number
  total_pnl:      number
  total_pnl_pct:  number
  items:          PortfolioItem[]
  best_performer: PortfolioItem | null
  worst_performer: PortfolioItem | null
  updated_at:     string
}

export async function getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
  const positions = await getPositions(userId)
  // ดึงราคาปัจจุบันจาก price_cache
  const symbols = positions.map(p => p.symbol)
  const prices  = await getPriceCache(symbols)

  const items: PortfolioItem[] = positions.map(pos => {
    const currentPrice = prices.get(pos.symbol) ?? pos.avg_cost
    const marketValue  = pos.quantity * currentPrice
    const costBasis    = pos.quantity * pos.avg_cost
    const pnl          = marketValue - costBasis
    const pnlPct       = (pnl / costBasis) * 100
    return { position: pos, current_price: currentPrice,
             market_value: marketValue, cost_basis: costBasis,
             unrealized_pnl: pnl, pnl_pct: pnlPct }
  })

  const totalValue = items.reduce((s, i) => s + i.market_value, 0)
  const totalCost  = items.reduce((s, i) => s + i.cost_basis, 0)
  const sortedPnl  = [...items].sort((a,b) => b.pnl_pct - a.pnl_pct)

  return {
    total_value: totalValue, total_cost: totalCost,
    total_pnl: totalValue - totalCost,
    total_pnl_pct: ((totalValue - totalCost) / totalCost) * 100,
    items,
    best_performer:  sortedPnl[0] ?? null,
    worst_performer: sortedPnl[sortedPnl.length - 1] ?? null,
    updated_at: new Date().toISOString(),
  }
}

// คำนวณ avg cost แบบ weighted average เมื่อซื้อเพิ่ม
export async function recordTrade(userId: string, trade: NewTrade) {
  const pos = await findOrCreatePosition(userId, trade)
  if (trade.trade_type === 'BUY') {
    const newQty  = pos.quantity + trade.quantity
    const newCost = ((pos.quantity * pos.avg_cost) + (trade.quantity * trade.price)) / newQty
    await updatePosition(pos.id, { quantity: newQty, avg_cost: newCost })
  } else {
    // SELL: ลด quantity (avg_cost ไม่เปลี่ยน)
    const newQty = pos.quantity - trade.quantity
    if (newQty <= 0) await deletePosition(pos.id)
    else await updatePosition(pos.id, { quantity: newQty })
  }
  await insertTrade({ ...trade, position_id: pos.id, user_id: userId })
}
```

### NLP Patterns

```
Classify as PORTFOLIO_BUY:
- "ซื้อ PTT 500 หุ้น ราคา 35"
- "buy NVDA 10 shares $95"
- "ซื้อทอง 1 บาทหนัก 43500"
→ { intent: "PORTFOLIO_BUY", data: { symbol, quantity, price, fee? } }

Classify as PORTFOLIO_SELL:
- "ขาย NVDA 5 หุ้น ราคา 120"
→ { intent: "PORTFOLIO_SELL", data: { symbol, quantity, price, fee? } }

Classify as PORTFOLIO_QUERY:
- "พอร์ตวันนี้เป็นยังไง" / "กำไรขาดทุนรวม"
→ { intent: "PORTFOLIO_QUERY", data: { queryType: 'SUMMARY' | 'POSITION' } }
```

### REST Endpoints

```
GET  /api/portfolio              → PortfolioSummary (real-time prices)
GET  /api/portfolio/positions    → PortfolioPosition[]
POST /api/portfolio/trades       → { symbol, trade_type, quantity, price, fee?, note? }
GET  /api/portfolio/trades       → PortfolioTrade[] (ประวัติ)
DELETE /api/portfolio/positions/:id  → ⚠️ verify owner
```

### Frontend — Portfolio screen (เพิ่มใน Tab หรือ ส่วนของ PriceAlerts)

```
Summary row (4 metric cards):
  มูลค่าพอร์ต · กำไร/ขาดทุน (สี: บวก=teal, ลบ=red) · ต้นทุนรวม · %PnL

Position list:
  แต่ละ row: symbol + จำนวน / ต้นทุน · ราคาปัจจุบัน / PnL (THB) + %
  + signal badge ถ้ามี (สัญญาณซื้อ/ขาย จาก signal.service)
  กด row → trade history ของ position นั้น

FAB → bottom sheet "บันทึกซื้อ/ขาย":
  BUY / SELL toggle
  ค้นหา symbol
  จำนวน + ราคา + ค่าธรรมเนียม (ไม่บังคับ)
```

---

## 3. Morning Summary

### Scheduler (เพิ่มใน scheduler.ts)

```typescript
// ส่ง morning summary ทุกวัน 08:00 น. (เฉพาะ active users)
cron.schedule('0 8 * * *', async () => {
  await sendMorningSummaries()
}, { timezone: 'Asia/Bangkok' })

async function sendMorningSummaries() {
  // ดึง user ทั้งหมดที่เปิด morning_summary (settings)
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, line_user_id')
    .eq('morning_summary_enabled', true)

  for (const user of users ?? []) {
    try {
      const summary = await buildMorningSummary(user.id)
      await sendPushWithQuotaCheck(user.id, user.line_user_id, {
        type: 'text', text: summary
      })
    } catch (err) {
      console.error(`[Morning] failed for user ${user.id}:`, err)
    }
  }
}

async function buildMorningSummary(userId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const month = today.slice(0, 7)

  // ดึงข้อมูลพร้อมกัน
  const [appts, yesterdayTx, budgets, goals, portfolio, signals] = await Promise.allSettled([
    getTodayAppointments(userId),
    getDayTransactions(userId, yesterday),
    getBudgetSummaries(userId, month),
    getActiveGoals(userId),
    getPortfolioSummary(userId),
    getWatchlistSignals(userId),   // top 2 signals จาก watched_assets
  ])

  const lines: string[] = []
  const dayTH = formatDateTH(today)

  lines.push(`🌅 สรุปเช้า ${dayTH}`)
  lines.push('')

  // นัดหมายวันนี้
  const apptData = appts.status === 'fulfilled' ? appts.value : []
  if (apptData.length > 0) {
    lines.push(`📅 วันนี้: ${apptData.length} นัด`)
    apptData.slice(0, 3).forEach(a => {
      lines.push(`   · ${a.start_time} ${a.title}`)
    })
  } else {
    lines.push('📅 วันนี้: ไม่มีนัด')
  }

  // รายจ่ายเมื่อวาน
  const txData = yesterdayTx.status === 'fulfilled' ? yesterdayTx.value : null
  if (txData) {
    lines.push(`💸 เมื่อวาน: ใช้จ่าย ฿${txData.total_expense.toLocaleString()}`)
    // งบที่เหลือน้อยที่สุด
    const budgetData = budgets.status === 'fulfilled' ? budgets.value : []
    const lowestBudget = budgetData.sort((a, b) => a.remaining - b.remaining)[0]
    if (lowestBudget && lowestBudget.pct_used >= 70) {
      lines.push(`🎯 งบ${lowestBudget.category_name}เหลือ ฿${lowestBudget.remaining.toLocaleString()} (${lowestBudget.pct_used.toFixed(0)}%)`)
    }
  }

  // Portfolio summary
  const portData = portfolio.status === 'fulfilled' ? portfolio.value : null
  if (portData && portData.items.length > 0) {
    const pnlSign = portData.total_pnl >= 0 ? '+' : ''
    lines.push(`📊 พอร์ต: ${pnlSign}฿${portData.total_pnl.toLocaleString()} (${pnlSign}${portData.total_pnl_pct.toFixed(2)}%)`)
  }

  // Signal สั้นๆ (top 1-2 จาก watchlist)
  const sigData = signals.status === 'fulfilled' ? signals.value : []
  sigData.slice(0, 2).forEach(sig => {
    const icon = sig.overall === 'BULLISH' ? '📈' : sig.overall === 'BEARISH' ? '📉' : '📊'
    lines.push(`${icon} ${sig.symbol}: สัญญาณ${sig.overall === 'BULLISH' ? 'ซื้อ' : sig.overall === 'BEARISH' ? 'ขาย' : 'Neutral'} ${sig.confidence}`)
  })

  // Saving goals ที่ใกล้ถึง
  const goalData = goals.status === 'fulfilled' ? goals.value : []
  const nearGoal = goalData.find(g => g.pct_complete && g.pct_complete >= 80 && !g.is_completed)
  if (nearGoal) {
    lines.push(`💰 ${nearGoal.name}: ${nearGoal.pct_complete?.toFixed(0)}% (ใกล้ถึงเป้า!)`)
  }

  lines.push('')
  lines.push('─────────────────────')
  lines.push('วิเคราะห์จาก technical indicators เท่านั้น ไม่ใช่คำแนะนำลงทุน')

  return lines.join('\n')
}
```

### Settings — เปิด/ปิด Morning Summary

```sql
-- เพิ่มใน users table
alter table users add column morning_summary_enabled boolean default true;
alter table users add column morning_summary_time    text default '08:00';  -- HH:MM
alter table users add column timezone text default 'Asia/Bangkok';
```

### REST Endpoint

```
GET   /api/user/morning-summary-preview   → preview ข้อความที่จะส่งวันนี้
PATCH /api/user/settings
  Body: { morning_summary_enabled?, morning_summary_time? }
```

---

## 4. Google Calendar Sync

### OAuth Flow

```
1. User กด "เชื่อมต่อ Google Calendar" ใน LIFF settings
2. LIFF redirect → GET /api/gcal/auth → Google OAuth URL
3. User login Google → callback → GET /api/gcal/callback?code=...
4. แลก code → access_token + refresh_token → เก็บใน DB
5. LIFF กลับมา → sync ครั้งแรก
```

### Database

```sql
create table google_calendar_tokens (
  user_id       uuid primary key references users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  calendar_ids  text[],          -- ปฏิทินที่เลือก sync (null = ทุกอัน)
  sync_enabled  boolean default true,
  last_synced   timestamptz,
  created_at    timestamptz default now()
);

-- เพิ่มใน appointments table
alter table appointments add column gcal_event_id text unique;    -- Google event ID
alter table appointments add column gcal_calendar_id text;        -- ปฏิทินที่มาจาก
alter table appointments add column source_updated text default 'MYASSIST'
  check (source_updated in ('MYASSIST','GOOGLE'));

alter table google_calendar_tokens enable row level security;
create policy "own_data_only" on google_calendar_tokens
  for all using (user_id = (select id from users where line_user_id = auth.uid()));
```

### Google Calendar Service

```typescript
// backend/src/services/gcal.service.ts
import { google } from 'googleapis'
import { supabaseAdmin } from '../lib/supabase'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.BACKEND_URL}/api/gcal/callback`
)

export function getAuthUrl(userId: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: userId,    // ส่ง userId กลับมาใน callback
    prompt: 'consent',
  })
}

// Sync: Google → MyAssist (import events)
export async function syncFromGoogle(userId: string) {
  const tokens = await getTokens(userId)
  if (!tokens) return

  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  })

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  const now   = new Date()
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)  // 30 วัน

  // ดึง events ทุก calendar ที่เลือก
  const calIds = tokens.calendar_ids ?? ['primary']
  for (const calId of calIds) {
    const res = await calendar.events.list({
      calendarId: calId,
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    })

    for (const event of res.data.items ?? []) {
      if (!event.id || !event.summary) continue
      const startAt = event.start?.dateTime ?? event.start?.date
      if (!startAt) continue

      // upsert ใน appointments (ไม่ทับ event ที่ user สร้างเอง)
      await supabaseAdmin.from('appointments').upsert({
        user_id:         userId,
        title:           event.summary,
        location:        event.location ?? null,
        start_at:        startAt,
        end_at:          event.end?.dateTime ?? null,
        gcal_event_id:   event.id,
        gcal_calendar_id: calId,
        source_updated:  'GOOGLE',
        category:        'OTHER',
      }, { onConflict: 'gcal_event_id' })
    }
  }

  await supabaseAdmin.from('google_calendar_tokens')
    .update({ last_synced: new Date().toISOString() })
    .eq('user_id', userId)
}

// Sync: MyAssist → Google (export new appointments)
export async function pushToGoogle(userId: string, appointment: Appointment) {
  if (appointment.gcal_event_id) return  // มาจาก Google อยู่แล้ว ไม่ต้องส่งกลับ

  const tokens = await getTokens(userId)
  if (!tokens) return

  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  })

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  const event = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary:  appointment.title,
      location: appointment.location ?? undefined,
      start:    { dateTime: appointment.start_at, timeZone: 'Asia/Bangkok' },
      end:      { dateTime: appointment.end_at ?? appointment.start_at, timeZone: 'Asia/Bangkok' },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: appointment.reminder_min }],
      },
    },
  })

  // บันทึก gcal_event_id กลับใน DB
  await supabaseAdmin.from('appointments')
    .update({ gcal_event_id: event.data.id })
    .eq('id', appointment.id)
}
```

### Sync Scheduler

```typescript
// เพิ่มใน scheduler.ts
// sync ทุก 15 นาที สำหรับ user ที่เชื่อมต่อ Google Calendar
cron.schedule('*/15 * * * *', async () => {
  const { data: tokens } = await supabaseAdmin
    .from('google_calendar_tokens')
    .select('user_id')
    .eq('sync_enabled', true)

  for (const { user_id } of tokens ?? []) {
    try { await syncFromGoogle(user_id) }
    catch (err) { console.error(`[GCal] sync failed for ${user_id}:`, err) }
  }
})
```

### REST Endpoints

```
GET  /api/gcal/auth              → { url: string } (Google OAuth URL)
GET  /api/gcal/callback?code=&state=userId  → แลก token + sync ครั้งแรก
POST /api/gcal/sync              → force sync ทันที
DELETE /api/gcal/disconnect      → ลบ tokens + clear gcal_event_id ทุก appt
GET  /api/gcal/calendars         → รายการ calendars ใน Google account
PATCH /api/gcal/settings         → { sync_enabled?, calendar_ids? }
```

### Dependencies เพิ่ม

```json
// backend/package.json
"googleapis": "^140.0.0"
```

### Environment Variables เพิ่ม

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BACKEND_URL=https://your-railway.railway.app
```

---

## Frontend Updates

### Tab Bar — เพิ่ม Saving Goal

```
Tab 5 ปัจจุบัน: 🎯 งบ (BudgetSetup)
เปลี่ยนเป็น 2 tab แยก หรือรวมใน tab เดิม:
Option A: รวม Budget + Goals ใน tab เดียว (scroll sections)
Option B: เปลี่ยน tab 5 เป็น "เป้าหมาย" ย้าย Budget ไปอยู่ใน Finance tab

แนะนำ Option A — ประหยัด tab
```

### Settings Screen (เพิ่ม)

```
หน้า Settings (เข้าจาก ⚙️ ใน Dashboard):
  ─ บัญชี
    ชื่อ · รูป (sync จาก LINE)
  ─ การแจ้งเตือน
    Morning Summary: toggle + เลือกเวลา
    Budget alerts: toggle
    Price alerts: toggle
  ─ เชื่อมต่อ
    Google Calendar: [เชื่อมต่อ / ยกเลิก] + สถานะ sync ล่าสุด
  ─ ข้อมูล
    Export ข้อมูลทั้งหมด (CSV)
    ลบบัญชีและข้อมูลทั้งหมด (danger zone)
```
