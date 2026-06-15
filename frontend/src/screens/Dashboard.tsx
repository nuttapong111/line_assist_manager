import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, Skeleton, EmptyState } from '../components/Layout'
import { api } from '../lib/api'
import { getDisplayName } from '../lib/liff'
import { formatBangkokTime } from '../lib/datetime'

export default function Dashboard() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [appts, setAppts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [displayName, userStats, todayAppts] = await Promise.all([
          getDisplayName(),
          api.user.getStats(),
          api.appointments.getToday(),
        ])
        setName(displayName)
        setStats(userStats)
        setAppts(todayAppts)
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  const today = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="flex flex-col h-full">
      <PageHeader title={`สวัสดี, ${name} 👋`} subtitle={today} right={
        <button onClick={() => navigate('/settings')} className="w-9 h-9 rounded-full bg-[#EEEDE8] flex items-center justify-center text-[16px]">⚙️</button>
      } />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="bg-[#2A5C45] rounded-[20px] p-5 text-white relative overflow-hidden">
            <p className="text-white/75 text-[12px]">ใช้จ่ายเดือนนี้</p>
            <p className="font-['DM_Mono'] text-[32px] font-semibold mt-1">
              ฿{(stats?.total_expenses_this_month ?? 0).toLocaleString()}
            </p>
            <p className="text-white/65 text-[12px] mt-1">
              รายรับ ฿{(stats?.total_income_this_month ?? 0).toLocaleString()}
            </p>
            <div className="flex gap-2 mt-3">
              <span className="text-[11px] bg-white/15 px-2 py-1 rounded-full">📅 {stats?.appointments_today ?? 0} นัดวันนี้</span>
              <span className="text-[11px] bg-white/15 px-2 py-1 rounded-full">🔔 {stats?.pending_reminders ?? 0} การแจ้งเตือน</span>
            </div>
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/8" />
            <div className="absolute -right-2 top-8 w-16 h-16 rounded-full bg-white/5" />
          </div>
        )}

        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: '📅', label: 'นัดหมาย', bg: 'bg-[#E6F0EB]', path: '/appointments' },
            { icon: '💸', label: 'รายจ่าย', bg: 'bg-[#FBF0E0]', path: '/finance' },
            { icon: '📷', label: 'สแกนสลิป', bg: 'bg-[#EEE8FA]', path: '/slip' },
            { icon: '🎯', label: 'เป้าหมาย', bg: 'bg-[#E8EEFA]', path: '/goals' },
          ].map(a => (
            <button key={a.label} onClick={() => navigate(a.path)} className="flex flex-col items-center gap-1.5">
              <div className={`w-[52px] h-[52px] rounded-[16px] ${a.bg} flex items-center justify-center text-[22px]`}>{a.icon}</div>
              <span className="text-[11px] text-[#636259]">{a.label}</span>
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="font-['DM_Sans'] text-[11px] font-semibold text-[#9B9A94] tracking-[0.08em] uppercase">นัดหมายวันนี้</span>
            <button onClick={() => navigate('/appointments')} className="text-[12px] text-[#2A5C45] font-medium">ดูทั้งหมด</button>
          </div>
          {loading ? <Skeleton className="h-16" /> : appts.length === 0 ? (
            <EmptyState icon="📅" text="ไม่มีนัดหมายวันนี้" />
          ) : appts.map(a => (
            <div key={a.id} className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4 mb-2 flex gap-3">
              <div className="text-[13px] font-semibold text-[#636259]">
                {formatBangkokTime(a.startAt)}
              </div>
              <div>
                <p className="text-[14px] font-medium">{a.title}</p>
                {a.location && <p className="text-[12px] text-[#9B9A94]">📍 {a.location}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
