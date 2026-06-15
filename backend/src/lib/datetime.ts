const TZ = 'Asia/Bangkok'

/** วันที่วันนี้ในไทย YYYY-MM-DD */
export function bangkokToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

/** สร้าง Date จากวันที่+เวลาไทย (ไม่ใช้ UTC ของ server) */
export function parseBangkokDateTime(date: string, time: string): Date {
  const [h, m] = time.split(':').map(Number)
  const hour = String(h).padStart(2, '0')
  const minute = String(m ?? 0).padStart(2, '0')
  return new Date(`${date}T${hour}:${minute}:00+07:00`)
}

/** แปลง Date เป็น HH:mm ไทย */
export function formatBangkokTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('th-TH', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** แปลง Date เป็น YYYY-MM-DD ไทย */
export function formatBangkokDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}

/** ช่วงเริ่ม-สิ้นวันในไทย (UTC Date objects) */
export function bangkokDayRange(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00+07:00`)
  const end = new Date(`${dateStr}T23:59:59.999+07:00`)
  return { start, end }
}

export const BANGKOK_TZ = TZ
