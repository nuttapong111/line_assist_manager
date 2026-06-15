const TTL_MS = 10 * 60 * 1000

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
  sessions.set(lineUserId, { mode, expiresAt: Date.now() + TTL_MS })
}

export function setPendingConfirm(lineUserId: string, type: PendingType, data: Record<string, unknown>) {
  sessions.set(lineUserId, {
    pending: { type, data, expiresAt: Date.now() + TTL_MS },
    expiresAt: Date.now() + TTL_MS,
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
