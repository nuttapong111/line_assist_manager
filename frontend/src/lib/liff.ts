import liff from '@line/liff'

const LIFF_ID = import.meta.env.VITE_LIFF_ID || ''

export async function initLiff() {
  if (!LIFF_ID) {
    console.warn('VITE_LIFF_ID not set — dev mode')
    return
  }
  await liff.init({ liffId: LIFF_ID })
  if (!liff.isLoggedIn()) {
    liff.login()
  }
}

export async function getLineUserId(): Promise<string> {
  if (!LIFF_ID) return 'Udev0000000000000000000000000001'
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

export { liff }
