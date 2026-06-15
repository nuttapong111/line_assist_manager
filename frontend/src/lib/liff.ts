import liff from '@line/liff'

let liffId = import.meta.env.VITE_LIFF_ID || ''
const IS_DEV = import.meta.env.DEV

async function resolveLiffId(): Promise<string> {
  if (liffId) return liffId
  try {
    const res = await fetch('/api/public/config')
    if (!res.ok) return ''
    const data = await res.json() as { liffId?: string }
    liffId = data.liffId || ''
  } catch {
    return ''
  }
  return liffId
}

export async function initLiff() {
  const id = await resolveLiffId()
  if (!id) {
    if (IS_DEV) {
      console.warn('LIFF ID not set — use VITE_LIFF_ID or backend LIFF_ID for local testing')
      return
    }
    throw new Error('LIFF ID is required — set LIFF_ID on Railway')
  }
  await liff.init({ liffId: id })
  if (!liff.isLoggedIn()) {
    liff.login()
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (!liffId) return null
  await liff.ready
  if (!liff.isLoggedIn()) return null
  return liff.getAccessToken()
}

export async function getLineUserId(): Promise<string> {
  const id = await resolveLiffId()
  if (!id) {
    throw new Error('LIFF not configured — set LIFF_ID on Railway')
  }
  await liff.ready
  const profile = await liff.getProfile()
  return profile.userId
}

export async function getDisplayName(): Promise<string> {
  if (!liffId) return 'Developer'
  await liff.ready
  const profile = await liff.getProfile()
  return profile.displayName
}

export function isLiffReady(): boolean {
  return !!liffId
}

export { liff }
