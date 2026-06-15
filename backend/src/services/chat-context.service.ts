const MODE_TTL_MS = 2 * 60 * 60 * 1000 // โหมดจากเมนูคงอยู่ 2 ชม.
const PENDING_TTL_MS = 30 * 60 * 1000 // รอยืนยันคงอยู่ 30 นาที

export type ChatMode = 'APPOINTMENT' | 'EXPENSE' | 'REMINDER'
export type PendingType = 'EXPENSE' | 'INCOME' | 'APPOINTMENT'

interface PendingConfirm {
  type: PendingType
  data: Record<string, unknown>
  expiresAt: number
}

interface ChatContext {
  mode?: ChatMode
  pending?: PendingConfirm
  expiresAt: number
}

const sessions = new Map<string, ChatContext>()

function isExpired(ctx: ChatContext): boolean {
  return ctx.expiresAt < Date.now()
}

export function setChatMode(lineUserId: string, mode: ChatMode) {
  const existing = sessions.get(lineUserId)
  sessions.set(lineUserId, {
    mode,
    pending: existing?.pending,
    expiresAt: Date.now() + MODE_TTL_MS,
  })
}

export function setPendingConfirm(lineUserId: string, type: PendingType, data: Record<string, unknown>) {
  const existing = sessions.get(lineUserId)
  sessions.set(lineUserId, {
    mode: existing?.mode,
    pending: { type, data, expiresAt: Date.now() + PENDING_TTL_MS },
    expiresAt: Date.now() + PENDING_TTL_MS,
  })
}

export function getChatContext(lineUserId: string): ChatContext | null {
  const ctx = sessions.get(lineUserId)
  if (!ctx || isExpired(ctx)) {
    sessions.delete(lineUserId)
    return null
  }
  if (ctx.pending && ctx.pending.expiresAt < Date.now()) {
    ctx.pending = undefined
  }
  return ctx
}

export function clearChatContext(lineUserId: string) {
  sessions.delete(lineUserId)
}

export function isConfirmText(text: string): boolean {
  return /^(ยืนยัน|confirm|ok|ตกลง)$/i.test(text.trim())
}

export function isCancelText(text: string): boolean {
  return /^(ยกเลิก|cancel|ไม่เอา)$/i.test(text.trim())
}
