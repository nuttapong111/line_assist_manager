# MyAssist — LINE Personal Assistant
## Claude Code Master Prompt

> วิธีใช้: วาง file นี้ไว้ใน root ของ project แล้วพิมใน Claude Code ว่า
> **"อ่าน CLAUDE.md และ docs/ ทั้งหมดก่อน แล้วสร้าง project ตาม spec"**

---

## 🎯 Project Overview

LINE Personal Assistant สำหรับผู้ใช้หลายคนพร้อมกัน ทำงานผ่าน:
1. **LINE Chat** — พิมข้อความธรรมชาติ → AI parse → confirm card
2. **LINE Rich Menu** — 3 แท็บ × 6 ปุ่ม quick actions
3. **LIFF Mini App** — UI เต็มรูปแบบสำหรับดูข้อมูลและตั้งค่า

---

## 🏗️ Tech Stack (ห้ามเปลี่ยน)

```
Frontend   : React 18 + TypeScript + Vite
Styling    : Tailwind CSS v3           (tokens → docs/design-system.md)
Backend    : Node.js + Express + TypeScript
Database   : Railway PostgreSQL + Drizzle ORM
Storage    : Cloudflare R2             (S3-compatible, egress ฟรี)
AI         : Anthropic Claude API      (claude-sonnet-4-5)
LINE       : @line/bot-sdk + @line/liff
Scheduler  : node-cron
Deploy     : Vercel (frontend) + Railway (backend + PostgreSQL)
```

> ⚠️ ไม่ใช้ Supabase — ใช้ Railway PostgreSQL + Drizzle ORM + Cloudflare R2 แทน
> อ่าน docs/infrastructure-spec.md ก่อนเริ่ม Phase 3

---

## 👥 Multi-tenant Rules (อ่านก่อน code ทุก service)

```
กฎเหล็ก 5 ข้อ ห้ามละเมิดเด็ดขาด:

1. ทุก webhook event → ดึง event.source.userId ก่อนสิ่งใด
2. เรียก createUserIfNotExists(lineUserId) ทุก request
3. ทุก DB query ต้องมี .where(eq(table.userId, userId)) เสมอ
4. ทุก service รับ userId เป็น parameter แรก
5. R2 Storage path ต้องขึ้นด้วย slips/{userId}/ เสมอ

ละเมิดข้อใด = ข้อมูล user A ไหลไป user B = Security Bug ร้ายแรง
verifyOwner() ต้องเรียกก่อน PUT/DELETE ทุก route (แทน RLS)
```

---

## 📁 Project Structure

```
myassist/
├── CLAUDE.md
├── README.md
├── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── screens/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Finance.tsx
│   │   │   ├── SlipConfirm.tsx
│   │   │   ├── BudgetSetup.tsx
│   │   │   ├── Appointments.tsx
│   │   │   ├── PriceAlerts.tsx
│   │   │   ├── SavingGoals.tsx
│   │   │   ├── Portfolio.tsx
│   │   │   └── Settings.tsx
│   │   ├── hooks/
│   │   └── lib/
│   │       ├── liff.ts
│   │       └── api.ts
│   ├── tailwind.config.ts
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── middleware/
│   │   │   ├── auth.ts           ← authMiddleware (x-line-user-id header)
│   │   │   └── ownership.ts      ← verifyOwner() แทน RLS
│   │   ├── routes/
│   │   │   ├── webhook.ts
│   │   │   ├── finance.ts
│   │   │   ├── appointments.ts
│   │   │   ├── budget.ts
│   │   │   ├── ocr.ts
│   │   │   ├── alerts.ts
│   │   │   ├── goals.ts
│   │   │   ├── portfolio.ts
│   │   │   ├── gcal.ts
│   │   │   └── user.ts
│   │   ├── services/
│   │   │   ├── user.service.ts
│   │   │   ├── nlp.service.ts
│   │   │   ├── flex.service.ts
│   │   │   ├── push.service.ts
│   │   │   ├── finance.service.ts
│   │   │   ├── budget.service.ts
│   │   │   ├── appointment.service.ts
│   │   │   ├── ocr.service.ts
│   │   │   ├── yahoo.service.ts
│   │   │   ├── technicals.service.ts
│   │   │   ├── signal.service.ts
│   │   │   ├── price-alert.service.ts
│   │   │   ├── goal.service.ts
│   │   │   ├── portfolio.service.ts
│   │   │   ├── gcal.service.ts
│   │   │   └── scheduler.ts
│   │   ├── lib/
│   │   │   ├── db.ts             ← drizzle client
│   │   │   ├── schema.ts         ← ทุก table definitions (รวม news_cache)
│   │   │   ├── migrate.ts
│   │   │   └── storage.ts        ← Cloudflare R2
│   │   └── types/
│   │       └── index.ts
│   ├── drizzle/                  ← generated migrations
│   ├── drizzle.config.ts
│   ├── railway.toml
│   └── package.json
│
├── design/
│   └── visual-reference.html     ← เปิดใน browser ดู UI ที่ต้องการ
│
└── docs/
    ├── infrastructure-spec.md    ← อ่านก่อน! Railway + Drizzle + R2
    ├── design-system.md          ← CSS tokens, component specs
    ├── database-schema.md        ← SQL reference (ใช้ Drizzle แทน)
    ├── nlp-patterns.md           ← NLP system prompt
    ├── line-richmenu-spec.md     ← Webhook, Flex, Scheduler, OCR
    ├── price-alert-spec.md       ← Yahoo Finance, signal analysis
    ├── new-features-spec.md      ← Saving Goal, Portfolio, Morning Summary, GCal
    └── api-spec.md               ← REST endpoints
```

---

## ⚡ Build Order

```
Phase 1 — อ่าน spec
  [ ] อ่าน docs/ ทุกไฟล์ก่อน code อะไรเลย
  [ ] เปิด design/visual-reference.html ดู UI ที่ต้องการ

Phase 2 — Project Setup
  [ ] สร้าง structure ตามด้านบน
  [ ] npm install ทุก dependency จาก docs/infrastructure-spec.md
  [ ] Setup Tailwind + CSS vars จาก docs/design-system.md
  [ ] สร้าง .env จาก .env.example

Phase 3 — Database (อ่าน docs/infrastructure-spec.md ก่อน)
  [ ] Railway: เพิ่ม PostgreSQL plugin ใน project
  [ ] สร้าง schema.ts จาก docs/infrastructure-spec.md (ทุก table)
  [ ] สร้าง db.ts, drizzle.config.ts, migrate.ts, storage.ts
  [ ] รัน: npm run db:generate && npm run db:migrate
  [ ] สร้าง types/index.ts

Phase 4 — Backend Auth + Services
  [ ] middleware/auth.ts + middleware/ownership.ts
  [ ] app.ts (authMiddleware ก่อน routes)
  [ ] user.service.ts (createUserIfNotExists)
  [ ] push.service.ts (sendPushWithQuotaCheck)
  [ ] finance, budget, appointment, ocr services

Phase 5 — LINE Integration
  [ ] webhook.ts + flex.service.ts
  [ ] nlp.service.ts (prompt จาก docs/nlp-patterns.md)
  [ ] scheduler.ts:
       cron * * * * *      → reminders + appointment alerts
       cron */5 * * * *   → checkPriceAlerts + checkSignalAlerts
       cron */15 * * * *  → syncFromGoogle
       cron 0 7 * * *    → fetchAndCacheAllNews (Finnhub → Claude Haiku สรุป)
       cron 0 8 * * *    → sendMorningSummaries (รวมข่าว)
       cron 30 8 1 * *   → sendMonthlySummaries (Claude Sonnet สรุปเดือน)

Phase 6 — Price Alerts + Signal Analysis
  [ ] yahoo.service.ts + technicals.service.ts
  [ ] signal.service.ts + price-alert.service.ts
  [ ] routes/alerts.ts

Phase 7 — New Features
  [ ] goal.service.ts + routes/goals.ts
  [ ] portfolio.service.ts + routes/portfolio.ts
  [ ] gcal.service.ts + routes/gcal.ts

Phase 8 — Frontend Screens
  [ ] liff.ts + api.ts
  [ ] 9 screens ตาม pixel-perfect spec ใน docs/design-system.md
  [ ] Skeleton loaders + Empty states + Error handling

Phase 9 — Deploy
  [ ] railway.toml ใน backend/
  [ ] vercel.json ใน frontend/
  [ ] ตั้ง env vars ใน Railway + Vercel
  [ ] npm run setup:richmenu
```

---

## 🎨 Design Rules

```
อ่านรายละเอียดใน docs/design-system.md + เปิด design/visual-reference.html

Background:  #F7F6F2  (warm white)
Surface:     #FFFFFF  + border 1px rgba(0,0,0,0.07)
Accent:      #2A5C45  (forest green)
Font TH:     Noto Sans Thai
Font EN:     DM Sans
Font Mono:   DM Mono  (ตัวเลขเงิน, เวลา)
Radius card: 14px | large: 20px
Shadow:      shadow-sm เท่านั้น (ยกเว้น FAB)
Tab bar:     68px, active icon = bg-accent + scale(1.08)
```

---

## 🤖 NLP Intents ทั้งหมด

```
APPOINTMENT    · EXPENSE     · INCOME
REMINDER       · QUERY       · PRICE_ALERT
ANALYZE        · GOAL_CONTRIBUTE · GOAL_CREATE
GOAL_QUERY     · PORTFOLIO_BUY  · PORTFOLIO_SELL
PORTFOLIO_QUERY · UNKNOWN

ดู system prompt ใน docs/nlp-patterns.md
ดู PRICE_ALERT + ANALYZE ใน docs/price-alert-spec.md
ดู GOAL_* + PORTFOLIO_* ใน docs/new-features-spec.md
```

---

## 📋 Environment Variables

```bash
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LIFF_ID=
ANTHROPIC_API_KEY=
DATABASE_URL=               # Railway inject อัตโนมัติ
CF_ACCOUNT_ID=              # Cloudflare R2
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=myassist-slips
R2_PUBLIC_URL=              # https://pub-xxx.r2.dev
FINNHUB_API_KEY=              # สมัครฟรีที่ finnhub.io
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FRONTEND_URL=https://your-liff.vercel.app
BACKEND_URL=https://your-app.railway.app
PORT=3000
NODE_ENV=production
```

---

## ✅ Security Checklist (ก่อน deploy)

```
[ ] ทุก route ใต้ /api มี authMiddleware
[ ] ทุก service รับ userId เป็น param แรก
[ ] ทุก DB query มี .where(eq(table.userId, userId))
[ ] ทุก PUT/DELETE มี verifyOwner() ก่อน
[ ] R2 path ขึ้นด้วย slips/{userId}/
[ ] DATABASE_URL + R2 credentials อยู่ใน backend เท่านั้น
[ ] Google refresh_token เก็บใน DB ไม่ expose ใน response
[ ] GCal sync ไม่ทับ appointments ที่ user สร้างเอง
[ ] price alert push message มี disclaimer ทุกข้อความ
[ ] ไม่มีคำว่า "แนะนำให้ซื้อ/ขาย" ในโค้ดทั้งหมด
```
