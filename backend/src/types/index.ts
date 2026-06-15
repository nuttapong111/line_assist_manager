export interface User {
  id: string
  lineUserId: string
  displayName: string | null
  pictureUrl: string | null
  morningSummaryEnabled: boolean | null
  morningSummaryTime: string | null
  timezone: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface BudgetCategory {
  id: string
  userId: string
  name: string
  icon: string | null
  color: string | null
  sortOrder: number | null
}

export interface Transaction {
  id: string
  userId: string
  categoryId: string | null
  type: string
  amount: string
  description: string | null
  merchantName: string | null
  transactionDate: string | null
  slipImageUrl: string | null
  source: string | null
  createdAt: Date | null
}

export interface Appointment {
  id: string
  userId: string
  title: string
  location: string | null
  category: string | null
  startAt: Date
  endAt: Date | null
  reminderMin: number | null
  isReminded: boolean | null
  source: string | null
  createdAt: Date | null
}

export interface Reminder {
  id: string
  userId: string
  message: string
  remindAt: Date
  repeatType: string | null
  isDone: boolean | null
  createdAt: Date | null
}

export interface BudgetSummary {
  category_id: string
  category_name: string
  icon: string
  budget: number
  spent: number
  remaining: number
  pct_used: number
}

export interface SavingGoal {
  id: string
  userId: string
  name: string
  icon: string | null
  targetAmount: string
  currentAmount: string | null
  deadline: string | null
  monthlyTarget: string | null
  color: string | null
  isCompleted: boolean | null
  pct_complete?: number
  months_left?: number
  eta_month?: string
}

export interface NLPResult {
  intent: string
  confidence: number
  data: Record<string, unknown> | null
  raw_text?: string
}

export interface IndicatorResult {
  name: string
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  score: number
  value: string
  reason: string
  weight: number
}

export const INVESTMENT_DISCLAIMER =
  'วิเคราะห์จาก technical indicators เท่านั้น ไม่ใช่คำแนะนำการลงทุน อัตราความถูกต้องของ technical analysis อยู่ที่ 55–65% ใช้ประกอบการตัดสินใจของตัวเองเท่านั้น'

declare global {
  namespace Express {
    interface Request {
      user: User
    }
  }
}
