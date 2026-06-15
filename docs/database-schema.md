# Database Schema — Supabase (PostgreSQL)
## Claude Code: รัน SQL นี้ใน Supabase SQL editor ตามลำดับทุก block

---

## ⚠️ Multi-tenant Design Rules (อ่านก่อน code ทุกครั้ง)

```
กฎเหล็ก: ทุก table มี user_id column และทุก query ต้อง filter ด้วย user_id เสมอ

LINE สร้าง userId unique ต่อคน ต่อ OA อัตโนมัติ
→ ไม่ต้องทำ login system เพิ่ม
→ แค่ดึง event.source.userId จาก webhook / liff.getProfile().userId จาก LIFF

ห้าม query ข้าม user_id ในทุกกรณี
ห้ามทำ SELECT * FROM transactions โดยไม่มี WHERE user_id = $1
```

---

## Block 1 — Tables

```sql
-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text unique not null,
  display_name  text,
  picture_url   text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─────────────────────────────────────────
-- BUDGET CATEGORIES
-- ─────────────────────────────────────────
create table budget_categories (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid references users(id) on delete cascade not null,
  name      text not null,
  icon      text default '📦',
  color     text default '#2A5C45',
  sort_order int default 0
);

-- ─────────────────────────────────────────
-- BUDGETS (monthly)
-- ─────────────────────────────────────────
create table budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade not null,
  category_id uuid references budget_categories(id) on delete cascade,
  amount      numeric(12,2) not null,
  month       text not null,          -- format: 'YYYY-MM'
  created_at  timestamptz default now(),
  unique(user_id, category_id, month)
);

-- ─────────────────────────────────────────
-- TRANSACTIONS
-- ─────────────────────────────────────────
create table transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references users(id) on delete cascade not null,
  category_id      uuid references budget_categories(id),
  type             text not null check (type in ('EXPENSE','INCOME')),
  amount           numeric(12,2) not null,
  description      text,
  merchant_name    text,
  transaction_date date default current_date,
  slip_image_url   text,
  source           text default 'MANUAL' check (source in ('MANUAL','OCR','CHAT')),
  created_at       timestamptz default now()
);

-- ─────────────────────────────────────────
-- APPOINTMENTS
-- ─────────────────────────────────────────
create table appointments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete cascade not null,
  title        text not null,
  location     text,
  category     text default 'PERSONAL'
               check (category in ('WORK','PERSONAL','HEALTH','OTHER')),
  start_at     timestamptz not null,
  end_at       timestamptz,
  reminder_min int default 60,
  is_reminded  boolean default false,
  source       text default 'MANUAL' check (source in ('MANUAL','CHAT')),
  created_at   timestamptz default now()
);

-- ─────────────────────────────────────────
-- REMINDERS
-- ─────────────────────────────────────────
create table reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade not null,
  message     text not null,
  remind_at   timestamptz not null,
  repeat_type text default 'NONE'
              check (repeat_type in ('NONE','DAILY','WEEKLY','MONTHLY')),
  is_done     boolean default false,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────
-- PUSH QUOTA LOG (ป้องกัน LINE free tier เกิน 500/เดือน)
-- ─────────────────────────────────────────
create table push_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete cascade not null,
  month      text not null,           -- 'YYYY-MM'
  push_count int default 0,
  updated_at timestamptz default now(),
  unique(user_id, month)
);
```

---

## Block 2 — Indexes

```sql
create index idx_transactions_user_date
  on transactions(user_id, transaction_date desc);

create index idx_transactions_user_month
  on transactions(user_id, date_trunc('month', transaction_date));

create index idx_appointments_user_start
  on appointments(user_id, start_at);

create index idx_reminders_pending
  on reminders(user_id, remind_at) where is_done = false;

create index idx_appointments_reminder_pending
  on appointments(user_id, start_at) where is_reminded = false;
```

---

## Block 3 — Views

```sql
create view v_monthly_budget_summary as
select
  b.user_id,
  b.month,
  bc.id   as category_id,
  bc.name as category_name,
  bc.icon,
  b.amount as budget_amount,
  coalesce(sum(t.amount) filter (where t.type = 'EXPENSE'), 0) as spent_amount,
  b.amount - coalesce(sum(t.amount) filter (where t.type = 'EXPENSE'), 0) as remaining,
  round(
    coalesce(sum(t.amount) filter (where t.type = 'EXPENSE'), 0)
    / nullif(b.amount, 0) * 100, 1
  ) as pct_used
from budgets b
join budget_categories bc on bc.id = b.category_id
left join transactions t
  on t.user_id = b.user_id
  and t.category_id = b.category_id
  and to_char(t.transaction_date, 'YYYY-MM') = b.month
where b.user_id = bc.user_id   -- ← ป้องกัน cross-user join
group by b.user_id, b.month, bc.id, bc.name, bc.icon, b.amount;
```

---

## Block 4 — Row Level Security (รันหลัง tables และ views)

```sql
-- เปิด RLS ทุก table
alter table users              enable row level security;
alter table budget_categories  enable row level security;
alter table budgets            enable row level security;
alter table transactions       enable row level security;
alter table appointments       enable row level security;
alter table reminders          enable row level security;
alter table push_log           enable row level security;

-- users: ดูได้แค่แถวของตัวเอง
create policy "users_self_only" on users
  for all using (line_user_id = auth.uid());

-- ทุก table อื่น: ต้องเป็น user_id ของตัวเอง
-- (ใช้ service_role key ใน backend ที่ bypass RLS ได้ — ดู Block 5)
create policy "own_data_only" on budget_categories
  for all using (
    user_id = (select id from users where line_user_id = auth.uid())
  );

create policy "own_data_only" on budgets
  for all using (
    user_id = (select id from users where line_user_id = auth.uid())
  );

create policy "own_data_only" on transactions
  for all using (
    user_id = (select id from users where line_user_id = auth.uid())
  );

create policy "own_data_only" on appointments
  for all using (
    user_id = (select id from users where line_user_id = auth.uid())
  );

create policy "own_data_only" on reminders
  for all using (
    user_id = (select id from users where line_user_id = auth.uid())
  );

create policy "own_data_only" on push_log
  for all using (
    user_id = (select id from users where line_user_id = auth.uid())
  );
```

---

## Block 5 — Supabase Client Setup (Backend ใช้ service_role)

```typescript
// backend/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

// service_role key: bypass RLS — ใช้ใน backend เท่านั้น
// ห้าม expose ใน frontend หรือ commit ใน git
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!   // ← service_role key
)

// anon key: ใช้ใน frontend (LIFF) — ถูก RLS block ถ้าไม่ auth
export const supabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!      // ← anon key
)

// Backend ใช้ supabaseAdmin เสมอ
// Frontend ใช้ supabaseClient (optional — ส่วนใหญ่เรียกผ่าน backend API แทน)
```

---

## Block 6 — user.service.ts (Multi-tenant core)

```typescript
// backend/src/services/user.service.ts
import { supabaseAdmin } from '../lib/supabase'
import { User } from '../types'

// ฟังก์ชันนี้ถูกเรียกทุก webhook event และทุก API request
// upsert: ถ้ามีอยู่แล้ว return user เดิม, ถ้าใหม่ insert แล้ว return
export async function createUserIfNotExists(lineUserId: string): Promise<User> {
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('line_user_id', lineUserId)
    .single()

  if (existing) return existing

  // First-time user: insert + สร้าง default categories
  const { data: newUser, error } = await supabaseAdmin
    .from('users')
    .insert({ line_user_id: lineUserId })
    .select()
    .single()

  if (error || !newUser) throw new Error(`Cannot create user: ${error?.message}`)

  await insertDefaultCategories(newUser.id)
  return newUser
}

// เรียกครั้งเดียวตอน user ใหม่สมัคร
async function insertDefaultCategories(userId: string) {
  const defaults = [
    { name: 'อาหาร',    icon: '🍜', color: '#B8721A', sort_order: 1 },
    { name: 'เดินทาง',  icon: '🚗', color: '#2655A0', sort_order: 2 },
    { name: 'ช้อปปิ้ง', icon: '🛍️', color: '#B83232', sort_order: 3 },
    { name: 'บิล',      icon: '📄', color: '#6344A0', sort_order: 4 },
    { name: 'สุขภาพ',   icon: '💊', color: '#2A5C45', sort_order: 5 },
    { name: 'อื่นๆ',   icon: '📦', color: '#636259', sort_order: 6 },
  ]
  await supabaseAdmin
    .from('budget_categories')
    .insert(defaults.map(d => ({ ...d, user_id: userId })))
}

// อัปเดตชื่อ/รูปจาก LINE profile (เรียกตอน LIFF init)
export async function updateUserProfile(
  lineUserId: string,
  profile: { displayName: string; pictureUrl?: string }
) {
  await supabaseAdmin
    .from('users')
    .update({
      display_name: profile.displayName,
      picture_url: profile.pictureUrl ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('line_user_id', lineUserId)
}
```

---

## Block 7 — TypeScript Types

```typescript
// backend/src/types/index.ts

export interface User {
  id: string
  line_user_id: string
  display_name: string | null
  picture_url:  string | null
  created_at:   string
  updated_at:   string
}

export interface BudgetCategory {
  id:         string
  user_id:    string
  name:       string
  icon:       string
  color:      string
  sort_order: number
}

export interface Budget {
  id:          string
  user_id:     string
  category_id: string
  amount:      number
  month:       string   // 'YYYY-MM'
}

export interface Transaction {
  id:               string
  user_id:          string
  category_id:      string | null
  type:             'EXPENSE' | 'INCOME'
  amount:           number
  description:      string | null
  merchant_name:    string | null
  transaction_date: string          // 'YYYY-MM-DD'
  slip_image_url:   string | null
  source:           'MANUAL' | 'OCR' | 'CHAT'
  created_at:       string
  category?:        BudgetCategory
}

export interface Appointment {
  id:          string
  user_id:     string
  title:       string
  location:    string | null
  category:    'WORK' | 'PERSONAL' | 'HEALTH' | 'OTHER'
  start_at:    string
  end_at:      string | null
  reminder_min: number
  is_reminded: boolean
  source:      'MANUAL' | 'CHAT'
  created_at:  string
}

export interface Reminder {
  id:          string
  user_id:     string
  message:     string
  remind_at:   string
  repeat_type: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
  is_done:     boolean
  created_at:  string
}

export interface BudgetSummary {
  category_id:   string
  category_name: string
  icon:          string
  budget_amount: number
  spent_amount:  number
  remaining:     number
  pct_used:      number
}

export interface PushQuota {
  user_id:    string
  month:      string
  push_count: number
}

// NLP types
export type NLPIntent = 'APPOINTMENT' | 'EXPENSE' | 'INCOME' | 'REMINDER' | 'QUERY' | 'UNKNOWN'

export interface NLPResult {
  intent:     NLPIntent
  confidence: number
  data:       AppointmentData | ExpenseData | ReminderData | QueryData | null
  raw_text:   string
}

export interface AppointmentData {
  title:           string
  date:            string   // 'YYYY-MM-DD'
  time:            string   // 'HH:MM'
  location:        string | null
  category:        Appointment['category']
  reminderMinutes: number
}

export interface ExpenseData {
  amount:      number
  description: string
  category:    string
  date:        string
  type:        'EXPENSE' | 'INCOME'
}

export interface ReminderData {
  message:  string
  datetime: string
  repeat:   Reminder['repeat_type']
}

export interface QueryData {
  queryType: 'MONTHLY_SUMMARY' | 'BUDGET_STATUS' | 'APPOINTMENTS' | 'GENERAL'
  period?:   'this_month' | 'last_month' | 'this_week' | 'today'
}

// Express augmentation — req.user ทุก route
declare global {
  namespace Express {
    interface Request {
      user: User
    }
  }
}
```

---

## Block 8 — Price Alert Tables (เพิ่มหลัง Block 1–4)

```sql
-- ─────────────────────────────────────────
-- WATCHED ASSETS (สินทรัพย์ที่ user ติดตาม)
-- ─────────────────────────────────────────
create table watched_assets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade not null,
  symbol      text not null,          -- 'PTT.BK', 'NVDA', 'GC=F', 'KFSDIV-A.BK'
  display_name text not null,         -- 'PTT', 'Nvidia', 'ทองคำ', 'KFSDIV'
  asset_type  text not null           -- 'TH_STOCK' | 'US_STOCK' | 'FUND' | 'GOLD' | 'CRYPTO'
              check (asset_type in ('TH_STOCK','US_STOCK','FUND','GOLD','CRYPTO')),
  currency    text default 'THB',     -- 'THB' | 'USD'
  sort_order  int default 0,
  created_at  timestamptz default now(),
  unique(user_id, symbol)
);

-- ─────────────────────────────────────────
-- PRICE ALERTS (เงื่อนไขที่ user ตั้งไว้)
-- ─────────────────────────────────────────
create table price_alerts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) on delete cascade not null,
  asset_id        uuid references watched_assets(id) on delete cascade not null,
  condition_type  text not null
                  check (condition_type in ('PRICE_ABOVE','PRICE_BELOW','PCT_CHANGE_UP','PCT_CHANGE_DOWN')),
  target_value    numeric(18,4) not null,   -- ราคาหรือ % ขึ้นอยู่กับ condition_type
  repeat_mode     text default 'ONCE'
                  check (repeat_mode in ('ONCE','ALWAYS','DAILY')),
  is_active       boolean default true,
  is_triggered    boolean default false,    -- เคย trigger แล้ว (สำหรับ ONCE)
  last_triggered  timestamptz,
  note            text,                     -- user note ส่วนตัว
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────
-- PRICE CACHE (เก็บราคาล่าสุดจาก Yahoo)
-- ─────────────────────────────────────────
create table price_cache (
  symbol       text primary key,
  price        numeric(18,4) not null,
  change_pct   numeric(8,4),            -- % เปลี่ยนแปลงวันนี้
  open         numeric(18,4),
  high         numeric(18,4),
  low          numeric(18,4),
  volume       bigint,
  currency     text default 'THB',
  fetched_at   timestamptz default now()
);

-- Indexes สำหรับ alert checker
create index idx_price_alerts_active
  on price_alerts(is_active, asset_id) where is_active = true;

create index idx_watched_assets_user
  on watched_assets(user_id);

-- RLS
alter table watched_assets enable row level security;
alter table price_alerts    enable row level security;

create policy "own_data_only" on watched_assets
  for all using (user_id = (select id from users where line_user_id = auth.uid()));

create policy "own_data_only" on price_alerts
  for all using (user_id = (select id from users where line_user_id = auth.uid()));

-- price_cache ไม่ต้อง RLS (shared ทุกคน ไม่มีข้อมูล user)
```

---

## Block 9 — Price Alert TypeScript Types

```typescript
// เพิ่มใน backend/src/types/index.ts

export type AssetType = 'TH_STOCK' | 'US_STOCK' | 'FUND' | 'GOLD' | 'CRYPTO'
export type AlertCondition = 'PRICE_ABOVE' | 'PRICE_BELOW' | 'PCT_CHANGE_UP' | 'PCT_CHANGE_DOWN'
export type RepeatMode = 'ONCE' | 'ALWAYS' | 'DAILY'

export interface WatchedAsset {
  id:           string
  user_id:      string
  symbol:       string       // Yahoo Finance ticker
  display_name: string
  asset_type:   AssetType
  currency:     'THB' | 'USD'
  sort_order:   number
  created_at:   string
}

export interface PriceAlert {
  id:             string
  user_id:        string
  asset_id:       string
  condition_type: AlertCondition
  target_value:   number
  repeat_mode:    RepeatMode
  is_active:      boolean
  is_triggered:   boolean
  last_triggered: string | null
  note:           string | null
  created_at:     string
  asset?:         WatchedAsset
}

export interface PriceCache {
  symbol:      string
  price:       number
  change_pct:  number | null
  open:        number | null
  high:        number | null
  low:         number | null
  volume:      number | null
  currency:    string
  fetched_at:  string
}

// Yahoo Finance fetch result
export interface YahooQuote {
  symbol:          string
  regularMarketPrice:       number
  regularMarketChangePercent: number
  regularMarketOpen:        number
  regularMarketDayHigh:     number
  regularMarketDayLow:      number
  regularMarketVolume:      number
  currency:        string
}
```

---

## Block 10 — Signal Log Table

```sql
-- เก็บประวัติการส่ง signal ป้องกัน spam
create table signal_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete cascade not null,
  symbol     text not null,
  score      numeric(4,2),
  overall    text,        -- 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  timeframe  text,
  sent_at    timestamptz default now()
);
create index idx_signal_log on signal_log(user_id, symbol, sent_at desc);
alter table signal_log enable row level security;
create policy "own_data_only" on signal_log
  for all using (user_id = (select id from users where line_user_id = auth.uid()));
```

---

## Block 11 — New Features Tables (รัน Block นี้หลัง Block 1–4)

ดูรายละเอียด SQL ใน docs/new-features-spec.md sections:
- saving_goals + goal_contributions
- portfolio_positions + portfolio_trades
- google_calendar_tokens
- ALTER users ADD morning_summary_enabled, morning_summary_time, timezone
- ALTER appointments ADD gcal_event_id, gcal_calendar_id, source_updated
