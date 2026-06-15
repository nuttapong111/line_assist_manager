# REST API Spec
## backend/src/routes/ + middleware/

---

## Base URL
```
Development: http://localhost:3000/api
Production:  https://your-railway-app.railway.app/api
```

---

## ⚠️ Authentication Middleware (ใส่ทุก route — ห้ามข้าม)

```typescript
// backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express'
import { createUserIfNotExists, updateUserProfile } from '../services/user.service'

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const lineUserId = req.headers['x-line-user-id'] as string

  if (!lineUserId || !lineUserId.startsWith('U')) {
    return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Missing LINE user ID' })
  }

  try {
    req.user = await createUserIfNotExists(lineUserId)
    next()
  } catch (err) {
    res.status(500).json({ error: true, code: 'INTERNAL', message: 'Auth failed' })
  }
}

// backend/src/app.ts — ใส่ก่อน routes ทุกตัว
app.use('/api', authMiddleware)   // ← บรรทัดนี้บังคับทุก /api/* route
```

---

## ⚠️ Service Pattern (ทุก service ต้องรับ userId เป็น param แรก)

```typescript
// ✅ ถูก — scope ด้วย userId เสมอ
export async function getTransactions(userId: string, month: string) {
  return supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', userId)          // ← ห้ามลืม
    .gte('transaction_date', `${month}-01`)
}

// ❌ ผิด — ดึงข้อมูลทุกคน
export async function getTransactions(month: string) {
  return supabaseAdmin
    .from('transactions')           // ← ไม่มี user filter = BUG ร้ายแรง
    .select('*')
}
```

---

## Endpoints

### Finance

```
GET  /api/finance/summary?month=YYYY-MM
  → BudgetSummary[]  (scoped to req.user.id)

GET  /api/finance/transactions?month=YYYY-MM&limit=20&offset=0
  → { transactions: Transaction[], total: number }

POST /api/finance/transactions
  Body: { type, amount, description, category_id, transaction_date, slip_image_url? }
  → Transaction

PUT  /api/finance/transactions/:id
  Body: partial Transaction
  → Transaction
  ⚠️  ต้อง verify ว่า transaction.user_id === req.user.id ก่อน update

DELETE /api/finance/transactions/:id
  → { success: true }
  ⚠️  ต้อง verify owner ก่อน delete เสมอ
```

```typescript
// backend/src/routes/finance.ts — ตัวอย่าง ownership check
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const userId = req.user.id

  // ดึงก่อน ตรวจ owner
  const { data: tx } = await supabaseAdmin
    .from('transactions')
    .select('user_id')
    .eq('id', id)
    .single()

  if (!tx) return res.status(404).json({ error: true, code: 'NOT_FOUND' })
  if (tx.user_id !== userId) return res.status(403).json({ error: true, code: 'FORBIDDEN' })

  await supabaseAdmin.from('transactions').delete().eq('id', id)
  res.json({ success: true })
})
```

### Budget

```
GET  /api/budget?month=YYYY-MM
  → Budget[] with category info

PUT  /api/budget
  Body: { month: string, categories: { category_id: string, amount: number }[] }
  → Budget[]  (upsert — ใช้ onConflict user_id,category_id,month)

GET  /api/budget/categories
  → BudgetCategory[]  (เฉพาะ categories ของ user นี้)

POST /api/budget/categories
  Body: { name, icon, color }
  → BudgetCategory
```

### Appointments

```
GET  /api/appointments/today
  → Appointment[]

GET  /api/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
  → Appointment[]

POST /api/appointments
  Body: { title, location?, category, start_at, end_at?, reminder_min? }
  → Appointment

PUT  /api/appointments/:id   ⚠️ verify owner
DELETE /api/appointments/:id ⚠️ verify owner
```

### Reminders

```
GET    /api/reminders?upcoming=true
POST   /api/reminders     Body: { message, remind_at, repeat_type? }
PATCH  /api/reminders/:id/done
DELETE /api/reminders/:id  ⚠️ verify owner
```

### OCR

```
POST /api/ocr/slip
  Body: multipart/form-data — file: image (jpg/png ≤5MB)
  → { amount, date, time, merchant_name, sender_bank, slip_type, image_url }

  Pipeline:
  1. multer รับไฟล์ (memoryStorage)
  2. convert to base64
  3. ส่ง Claude Vision API
  4. upload รูปไป Supabase Storage path: {userId}/{timestamp}.jpg
  5. return parsed data + image_url
```

```typescript
// backend/src/services/ocr.service.ts — Storage path ต้องใช้ userId
async function uploadSlipImage(userId: string, buffer: Buffer, mimetype: string) {
  const timestamp = Date.now()
  const path = `${userId}/${timestamp}.jpg`   // ← แยก folder ต่อ user

  const { data, error } = await supabaseAdmin.storage
    .from('slips')
    .upload(path, buffer, { contentType: mimetype })

  if (error) throw error
  const { data: url } = supabaseAdmin.storage.from('slips').getPublicUrl(path)
  return url.publicUrl
}
```

### User

```
GET   /api/user/profile    → User
PATCH /api/user/profile    Body: { display_name?, picture_url? }  → User
GET   /api/user/stats      → { total_expenses_this_month, total_income_this_month,
                               appointments_today, pending_reminders }
DELETE /api/user/account   → { success: true }
  ⚠️  ลบทุกอย่างของ user (cascade จาก DB)
  ⚠️  ต้อง confirm สองชั้นใน UI

GET /api/user/export?month=YYYY-MM
  → CSV file ของ transactions เดือนนั้น (Content-Disposition: attachment)
```

### Push Quota

```
GET /api/push/quota    → { month, push_count, limit: 500, remaining }
```

---

## Push Quota Guard (ป้องกัน LINE free tier เกิน)

```typescript
// backend/src/services/push.service.ts
const MONTHLY_LIMIT = 500

export async function sendPushWithQuotaCheck(
  userId: string,
  lineUserId: string,
  message: any
): Promise<boolean> {
  const month = new Date().toISOString().slice(0, 7)  // 'YYYY-MM'

  // อ่าน quota ปัจจุบัน
  const { data: quota } = await supabaseAdmin
    .from('push_log')
    .select('push_count')
    .eq('user_id', userId)
    .eq('month', month)
    .single()

  const currentCount = quota?.push_count ?? 0

  if (currentCount >= MONTHLY_LIMIT) {
    console.warn(`[QUOTA] User ${userId} reached ${MONTHLY_LIMIT} pushes for ${month}`)
    return false   // ไม่ส่ง แต่ไม่ throw error
  }

  // ส่ง push
  await lineClient.pushMessage(lineUserId, message)

  // เพิ่ม count
  await supabaseAdmin
    .from('push_log')
    .upsert(
      { user_id: userId, month, push_count: currentCount + 1, updated_at: new Date() },
      { onConflict: 'user_id,month' }
    )

  return true
}
```

---

## Error Response Format

```typescript
interface ErrorResponse {
  error:   true
  code:    'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'QUOTA_EXCEEDED' | 'INTERNAL'
  message: string
  details?: Record<string, unknown>
}
```

---

## LIFF Frontend API Client

```typescript
// frontend/src/lib/api.ts
import liff from '@line/liff'

const BASE_URL = import.meta.env.VITE_API_URL

async function getHeaders(): Promise<HeadersInit> {
  await liff.ready
  const profile = await liff.getProfile()
  return {
    'Content-Type': 'application/json',
    'x-line-user-id': profile.userId,
  }
}

// Generic fetcher — throw ถ้า error
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await getHeaders()
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? 'API error')
  return json as T
}

export const api = {
  finance: {
    getSummary:       (month: string)              => apiFetch<BudgetSummary[]>(`/finance/summary?month=${month}`),
    getTransactions:  (month: string, limit = 20)  => apiFetch<{ transactions: Transaction[]; total: number }>(`/finance/transactions?month=${month}&limit=${limit}`),
    createTransaction:(body: Partial<Transaction>) => apiFetch<Transaction>('/finance/transactions', { method: 'POST', body: JSON.stringify(body) }),
    deleteTransaction:(id: string)                 => apiFetch<{ success: true }>(`/finance/transactions/${id}`, { method: 'DELETE' }),
  },
  budget: {
    get:        (month: string)                                                  => apiFetch<Budget[]>(`/budget?month=${month}`),
    upsert:     (month: string, categories: { category_id: string; amount: number }[]) => apiFetch<Budget[]>('/budget', { method: 'PUT', body: JSON.stringify({ month, categories }) }),
    getCategories: ()                                                            => apiFetch<BudgetCategory[]>('/budget/categories'),
  },
  appointments: {
    getToday: ()                          => apiFetch<Appointment[]>('/appointments/today'),
    getRange: (from: string, to: string)  => apiFetch<Appointment[]>(`/appointments?from=${from}&to=${to}`),
    create:   (body: Partial<Appointment>)=> apiFetch<Appointment>('/appointments', { method: 'POST', body: JSON.stringify(body) }),
    delete:   (id: string)                => apiFetch<{ success: true }>(`/appointments/${id}`, { method: 'DELETE' }),
  },
  reminders: {
    getUpcoming: ()                        => apiFetch<Reminder[]>('/reminders?upcoming=true'),
    create:      (body: Partial<Reminder>) => apiFetch<Reminder>('/reminders', { method: 'POST', body: JSON.stringify(body) }),
    markDone:    (id: string)              => apiFetch<Reminder>(`/reminders/${id}/done`, { method: 'PATCH' }),
  },
  ocr: {
    scanSlip: async (file: File) => {
      const headers = await getHeaders()
      const form = new FormData()
      form.append('file', file)
      const { 'Content-Type': _, ...rest } = headers as Record<string, string>
      const res = await fetch(`${BASE_URL}/ocr/slip`, { method: 'POST', headers: rest, body: form })
      return res.json()
    },
  },
  user: {
    getStats:      ()                        => apiFetch<Record<string, number>>('/user/stats'),
    getExportUrl:  (month: string)           => `${BASE_URL}/user/export?month=${month}`,
    deleteAccount: ()                        => apiFetch<{ success: true }>('/user/account', { method: 'DELETE' }),
    getPushQuota:  ()                        => apiFetch<{ push_count: number; limit: number; remaining: number }>('/push/quota'),
  },
}
```
