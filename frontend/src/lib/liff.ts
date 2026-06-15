import liff from '@line/liff'

const LIFF_ID = import.meta.env.VITE_LIFF_ID || ''
const IS_DEV = import.meta.env.DEV

export async function initLiff() {
  if (!LIFF_ID) {
    if (IS_DEV) {
      console.warn('VITE_LIFF_ID not set — use real LIFF ID or enable backend DEV_AUTH_BYPASS for local API testing')
      return
    }
    throw new Error('VITE_LIFF_ID is required in production')
  }
  await liff.init({ liffId: LIFF_ID })
  if (!liff.isLoggedIn()) {
    liff.login()
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (!LIFF_ID) return null
  await liff.ready
  if (!liff.isLoggedIn()) return null
  return liff.getAccessToken()
}

export async function getLineUserId(): Promise<string> {
  if (!LIFF_ID) {
    throw new Error('LIFF not configured — set VITE_LIFF_ID')
  }
  await liff.ready
  const profile = await liff.getProfile()
  return profile.userId
}

export async function getDisplayName(): Promise<string> {
  if (!LIFF_ID) return 'Developer'
  await liff.ready
  const profile = await liff.getProfile()
  return profile.displayName
}

export function isLiffReady(): boolean {
  return !!LIFF_ID
}

export { liff }
