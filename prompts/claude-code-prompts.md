# Claude Code Prompts — 9 Phases
## Copy-paste ทีละ prompt ใน VS Code Claude Code

> เริ่มด้วย PROMPT 0 ก่อนเสมอ

---

## PROMPT 0 — อ่านก่อนเริ่ม (บังคับ)

```
อ่านไฟล์เหล่านี้ตามลำดับก่อนทำอะไรทั้งนั้น:
1. CLAUDE.md — overview + rules + build order
2. docs/infrastructure-spec.md — stack ที่ใช้ (Railway + Drizzle + R2)
3. docs/design-system.md — design tokens + component specs
4. เปิด design/visual-reference.html ใน browser ดู UI ที่ต้องการ

สิ่งสำคัญที่ต้องจำ:
- ใช้ Railway PostgreSQL + Drizzle ORM (ไม่ใช้ Supabase)
- Storage ใช้ Cloudflare R2 (ไม่ใช้ S3 หรือ Supabase Storage)
- ทุก DB query ต้องมี .where(eq(table.userId, userId)) เสมอ
- verifyOwner() ก่อน PUT/DELETE ทุก route

บอกฉันเมื่ออ่านครบแล้ว
```

---

## PROMPT 1 — Project Setup

```
สร้าง project structure ตาม CLAUDE.md:

frontend/:
  npm create vite@latest frontend -- --template react-ts
  npm i @line/liff tailwindcss postcss autoprefixer
  setup Tailwind จาก docs/design-system.md (tailwind.config.ts + index.css CSS vars)

backend/:
  npm init -y
  npm i express @line/bot-sdk drizzle-orm pg
  npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
  npm i node-cron multer googleapis technicalindicators @anthropic-ai/sdk
  npm i -D typescript ts-node ts-node-dev drizzle-kit @types/node @types/express @types/pg @types/multer

สร้าง:
  backend/drizzle.config.ts จาก docs/infrastructure-spec.md
  backend/railway.toml จาก docs/infrastructure-spec.md
  .env.example จาก CLAUDE.md section Environment Variables
  frontend/vercel.json: { "rewrites": [{"source":"/(.*)", "destination":"/index.html"}] }

สร้างไฟล์เปล่าทุกไฟล์ใน structure ก่อน — ยังไม่ต้องใส่ logic
```

---

## PROMPT 2 — Database Schema + Migration

```
อ่าน docs/infrastructure-spec.md section Schema ก่อน

1. สร้าง backend/src/lib/schema.ts
   copy schema ทุก table จาก docs/infrastructure-spec.md ทั้งหมด:
   users, budgetCategories, budgets, transactions, appointments,
   reminders, pushLog, watchedAssets, priceAlerts, priceCache,
   savingGoals, goalContributions, portfolioPositions, portfolioTrades,
   googleCalendarTokens, signalLog

2. สร้าง backend/src/lib/db.ts
   drizzle(pool) + ssl ใน production

3. สร้าง backend/src/lib/migrate.ts
   ใช้ drizzle migrate จาก docs/infrastructure-spec.md

4. รัน: npm run db:generate แล้ว npm run db:migrate

5. สร้าง backend/src/lib/storage.ts
   Cloudflare R2 uploadSlip(userId, buffer, mimetype) → public URL
   path ต้องขึ้นด้วย slips/{userId}/ เสมอ

6. สร้าง backend/src/types/index.ts
   ทุก interface: User, Transaction, Appointment, Budget, BudgetCategory,
   Reminder, WatchedAsset, PriceAlert, PriceCache, SavingGoal,
   GoalContribution, PortfolioPosition, PortfolioTrade, SignalSummary,
   IndicatorResult, NLPResult + ทุก intent data types
   รวม Express augmentation: declare global namespace Express Request { user: User }
```

---

## PROMPT 3 — Auth + Core Services

```
อ่าน docs/api-spec.md ก่อน

1. backend/src/middleware/auth.ts
   - รับ x-line-user-id จาก header → createUserIfNotExists → req.user = user
   - return 401 ถ้าไม่มี header

2. backend/src/middleware/ownership.ts
   - verifyOwner(table, id, userId): Promise<boolean>
   - ใช้ตาม docs/infrastructure-spec.md section Ownership Check

3. backend/src/app.ts
   - app.use('/api', authMiddleware) ก่อน routes ทุกตัว
   - cors({ origin: process.env.FRONTEND_URL })
   - GET /health → { status: 'ok', timestamp }
   - startScheduler()

4. backend/src/services/user.service.ts
   - createUserIfNotExists(lineUserId): upsert + insertDefaultCategories ถ้าใหม่
   - insertDefaultCategories: 6 หมวด default
   - updateUserProfile

5. backend/src/services/push.service.ts
   - sendPushWithQuotaCheck(userId, lineUserId, message)
   - อ่าน pushLog → ถ้า count >= 500 return false
   - upsert pushLog count+1

6. สร้าง services ทั้งหมด (ทุกฟังก์ชัน userId เป็น param แรก):
   finance.service.ts, budget.service.ts, appointment.service.ts, ocr.service.ts
   pattern: .where(and(eq(table.userId, userId), ...)) ทุก query
```

---

## PROMPT 4 — REST Routes

```
อ่าน docs/api-spec.md section Endpoints

สร้าง routes ทุกไฟล์ใน backend/src/routes/:
  finance.ts, budget.ts, appointments.ts, ocr.ts, user.ts

ownership check pattern สำหรับ PUT/DELETE:
  if (!await verifyOwner('transactions', id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN' })
  }

OCR route:
  multer memoryStorage → buffer → ocr.service.extractSlipData(base64) → storage.uploadSlip(userId, buffer)
```

---

## PROMPT 5 — LINE Webhook + NLP + Scheduler

```
อ่าน docs/nlp-patterns.md + docs/line-richmenu-spec.md

1. backend/src/services/nlp.service.ts
   NLP_SYSTEM_PROMPT verbatim จาก docs/nlp-patterns.md
   inject TODAY_DATE, TOMORROW_DATE, CURRENT_TIME ก่อนส่ง

2. backend/src/services/flex.service.ts
   buildConfirmFlexMessage, buildSuccessMessage, buildQueryReply

3. backend/src/routes/webhook.ts จาก docs/line-richmenu-spec.md
   handleEvent → createUserIfNotExists ก่อนเสมอ
   route ตาม intent ทุกตัว (APPOINTMENT, EXPENSE, INCOME, REMINDER, QUERY)

4. backend/src/services/scheduler.ts
   cron '* * * * *'    → sendReminders() + sendAppointmentReminders()
   cron '*/5 * * * *'  → checkPriceAlerts()
   cron '*/15 * * * *' → syncFromGoogle() ทุก user ที่เปิด
   cron '0 8 * * *' Asia/Bangkok → sendMorningSummaries()
   cron '*/30 7-17 * * 1-5' → checkSignalAlerts()

5. backend/src/scripts/setup-richmenu.ts
   3 rich menus: main, finance, appointments
```

---

## PROMPT 6 — Price Alerts + AI Signal Analysis + News

```
อ่าน docs/price-alert-spec.md ทั้งหมด

1. npm i technicalindicators (ถ้ายังไม่ได้ติดตั้ง)

2. backend/src/services/yahoo.service.ts
   fetchPrice(symbol), fetchPrices(symbols[]), getGoldBahtPerBahtNak()
   SYMBOL_MAP: PTT → PTT.BK, GOLD → GC=F ฯลฯ

3. backend/src/services/technicals.service.ts
   calcMACD, calcRSI, calcBollinger, calcEMA, calcVolume
   ทุกฟังก์ชัน return IndicatorResult { signal, score, value, reason, weight }
   reason ภาษาไทย 1-2 ประโยค

4. backend/src/services/signal.service.ts
   analyzeSignal(symbol, timeframe): normalize score 0-10 → Claude AI explain
   generateExplanation: ห้ามใช้ "แนะนำซื้อ/ขาย" ใน prompt

5. backend/src/services/price-alert.service.ts
   checkPriceAlerts(): batch fetch → ตรวจ condition → fireAlert
   ทุก push ต้องมี disclaimer

6. เพิ่ม PRICE_ALERT + ANALYZE intents ใน nlp.service.ts + webhook.ts

7. backend/src/routes/alerts.ts
   GET /assets, POST /assets, GET /prices, GET /quote/:symbol,
   GET /, POST /, PUT /:id (verify owner), DELETE /:id (verify owner)

8. backend/src/services/news.service.ts จาก docs/price-alert-spec.md section News:
   - fetchCompanyNews(symbol, from, to): Finnhub API → NewsItem[]
   - summarizeNews(symbol, displayName, news): Claude Haiku → สรุปภาษาไทย 2-3 ประโยค
   - buildMonthlySummary(userId, month, items): Claude Sonnet → สรุปภาพรวม watchlist
   - ห้ามใช้ "ควรซื้อ/ขาย/แนะนำ" ใน prompt ทั้งสองฟังก์ชัน

9. เพิ่มใน schema.ts: newsCache table (symbol, summary, date, unique)
   รัน: npm run db:generate && npm run db:migrate

10. เพิ่มใน scheduler.ts:
    cron '0 7 * * *' Asia/Bangkok → fetchAndCacheAllNews() (Haiku สรุป)
    cron '30 8 1 * *' Asia/Bangkok → sendMonthlySummaries() (Sonnet สรุปเดือน)

11. อัปเดต buildMorningSummary ให้รวมข่าวจาก news_cache (top 3 assets)

12. backend/src/routes/news.ts:
    GET /api/news/:symbol, GET /api/news/summary/monthly, POST /api/news/refresh

13. ENV เพิ่ม: FINNHUB_API_KEY (สมัครฟรีที่ finnhub.io)
```

---

## PROMPT 7 — New Features (Goal + Portfolio + GCal)

```
อ่าน docs/new-features-spec.md ทั้งหมด

Goal (Saving):
  goal.service.ts: createGoal, contributeToGoal, getGoals (+ pct_complete + eta_month),
    findGoalByHint (fuzzy match)
  NLP: GOAL_CONTRIBUTE, GOAL_CREATE, GOAL_QUERY
  routes/goals.ts: CRUD + POST /:id/contribute + GET /:id/history

Portfolio:
  portfolio.service.ts: recordTrade (weighted avg cost), getPortfolioSummary
  NLP: PORTFOLIO_BUY, PORTFOLIO_SELL, PORTFOLIO_QUERY
  routes/portfolio.ts: GET /, GET /positions, POST /trades, GET /trades, DELETE /positions/:id

Morning Summary:
  scheduler.ts เพิ่ม sendMorningSummaries() ที่ทำงาน 08:00 BKK
  buildMorningSummary(userId): รวมข้อมูลทุก module พร้อมกัน

Google Calendar:
  npm i googleapis
  gcal.service.ts: getAuthUrl, syncFromGoogle, pushToGoogle, refreshTokenIfNeeded
  routes/gcal.ts: GET /auth, GET /callback, POST /sync, DELETE /disconnect
  scheduler: cron */15 → syncFromGoogle ทุก user ที่เปิด
  เพิ่ม ENV: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BACKEND_URL
```

---

## PROMPT 8 — Frontend Screens

```
อ่าน docs/design-system.md + เปิด design/visual-reference.html เปรียบเทียบ

1. frontend/src/lib/liff.ts — initLiff, getProfile, isLoggedIn
2. frontend/src/lib/api.ts — typed fetch client จาก docs/api-spec.md

3. Hooks:
   useFinance, useBudget, useAppointments, useSlipOCR,
   useSavingGoals, usePortfolio, usePriceAlerts, useSignal

4. Screens (match design/visual-reference.html ทุก pixel):
   Dashboard.tsx — greeting + summary card (bg-accent) + quick actions + today
   Finance.tsx — month nav + summary + budget bars (color logic) + tx list
   SlipConfirm.tsx — OCR status (pulsing dot) + category grid + budget impact
   BudgetSetup.tsx — copy btn + budget rows + total bar
   Appointments.tsx — 7-day strip + time slots + FAB
   PriceAlerts.tsx — filter pills + asset rows + alert list + signal detail modal
   SavingGoals.tsx — goal cards + progress bar (animated) + contribution bars
   Portfolio.tsx — summary 4 cards + position list + signal badges
   Settings.tsx — morning summary toggle + GCal connect + export + delete account

5. Shared components:
   TabBar (5 tabs: 🏠 📅 💰 📈 🎯) + PageHeader + SkeletonLoader

6. UX Polish:
   Skeleton loaders (animate-pulse, ห้ามใช้ spinner)
   Empty states ทุก list
   Toast notifications (success/error/warning)
   Confirm dialog ก่อน DELETE
   Budget bar animate width 0→X on mount
```

---

## PROMPT 9 — Deploy + Final Check

```
1. Railway:
   - เพิ่ม PostgreSQL plugin
   - ตั้ง env vars ทุกตัวจาก .env.example
   - deploy → รัน db:migrate อัตโนมัติ (ดู railway.toml)
   - copy Railway URL → ตั้ง LINE Webhook URL = {url}/webhook

2. Cloudflare R2:
   - สร้าง bucket myassist-slips
   - เปิด Public Access → copy public URL
   - สร้าง API Token → copy credentials
   - ตั้ง R2_* env vars ใน Railway

3. Vercel:
   - deploy frontend/
   - ตั้ง VITE_API_URL + VITE_LIFF_ID
   - copy URL → ตั้ง LIFF endpoint URL ใน LINE Developer Console

4. LINE:
   - ตั้ง Webhook URL
   - npm run setup:richmenu

5. ตรวจ Security Checklist ทุกข้อใน CLAUDE.md ก่อน go live
```
