export function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '')
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

/** ใช้ตรวจว่า FRONTEND_URL ชี้ไปโดเมนอื่น (redirect) หรือ serve จาก service เดียวกัน */
export function isExternalFrontend(url: string, publicBaseUrl?: string): boolean {
  const normalized = normalizeUrl(url)
  if (!normalized) return false
  if (!publicBaseUrl) return true
  const base = normalizeUrl(publicBaseUrl)
  return normalized !== base
}
