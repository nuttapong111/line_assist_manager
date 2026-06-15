const TZ = 'Asia/Bangkok'

export function formatBangkokTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('th-TH', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatBangkokDate(date: Date | string, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('th-TH', { timeZone: TZ, ...opts })
}

export function bangkokDateString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}
