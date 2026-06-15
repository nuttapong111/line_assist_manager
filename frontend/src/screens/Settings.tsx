import { useEffect, useState } from 'react'
import { PageHeader } from '../components/Layout'
import { api } from '../lib/api'

export default function Settings() {
  const [quota, setQuota] = useState<{ push_count: number; limit: number; remaining: number } | null>(null)
  const [gcal, setGcal] = useState<{ connected: boolean; sync_enabled: boolean } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    api.user.getPushQuota().then(setQuota).catch(console.error)
    api.gcal.getStatus().then(setGcal).catch(console.error)
  }, [])

  async function connectGcal() {
    const { url } = await api.gcal.getAuthUrl()
    window.open(url, '_blank')
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    await api.user.deleteAccount()
    alert('บัญชีถูกลบแล้ว')
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="ตั้งค่า" />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4">
          <p className="font-['DM_Sans'] text-[11px] font-semibold text-[#9B9A94] uppercase mb-3">Push Quota</p>
          {quota && (
            <div className="flex justify-between text-[14px]">
              <span>ใช้แล้ว {quota.push_count} / {quota.limit}</span>
              <span className="text-[#2A5C45] font-medium">เหลือ {quota.remaining}</span>
            </div>
          )}
        </div>

        <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4">
          <p className="font-['DM_Sans'] text-[11px] font-semibold text-[#9B9A94] uppercase mb-3">Google Calendar</p>
          {gcal?.connected ? (
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-[#2A5C45]">✓ เชื่อมต่อแล้ว</span>
              <button onClick={() => api.gcal.disconnect()} className="text-[12px] text-[#B83232]">ยกเลิกการเชื่อมต่อ</button>
            </div>
          ) : (
            <button onClick={connectGcal} className="w-full py-3 bg-[#E8EEFA] text-[#2655A0] rounded-[10px] text-[14px] font-medium">
              เชื่อมต่อ Google Calendar
            </button>
          )}
        </div>

        <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4">
          <p className="font-['DM_Sans'] text-[11px] font-semibold text-[#9B9A94] uppercase mb-3">ลิงก์ด่วน</p>
          <div className="space-y-2">
            {[
              { label: '📈 พอร์ตการลงทุน', path: '/portfolio' },
              { label: '🔔 แจ้งเตือนราคา', path: '/alerts' },
              { label: '💰 งบประมาณ', path: '/budget' },
            ].map(l => (
              <a key={l.path} href={l.path} className="block text-[14px] text-[#636259] py-1">{l.label}</a>
            ))}
          </div>
        </div>

        <button onClick={handleDelete}
          className={`w-full py-3 rounded-[14px] text-[14px] font-medium ${confirmDelete ? 'bg-[#B83232] text-white' : 'bg-[#FAEBE8] text-[#B83232]'}`}>
          {confirmDelete ? 'ยืนยันลบบัญชี (ไม่สามารถกู้คืน)' : 'ลบบัญชี'}
        </button>
      </div>
    </div>
  )
}
