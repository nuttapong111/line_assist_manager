export function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '')
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

/** LIFF ต้องอยู่บน Vercel ไม่ใช่ Railway backend */
export function isLiffFrontend(url: string): boolean {
  const normalized = normalizeUrl(url)
  if (!normalized) return false
  return !normalized.includes('railway.app')
}
