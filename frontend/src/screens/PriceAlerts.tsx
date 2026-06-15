import { useEffect, useState } from 'react'
import { PageHeader, Skeleton, EmptyState } from '../components/Layout'
import { api } from '../lib/api'

const DISCLAIMER = 'วิเคราะห์จาก technical indicators เท่านั้น ไม่ใช่คำแนะนำการลงทุน'

export default function PriceAlerts() {
  const [alerts, setAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.alerts.getAll().then(setAlerts).catch(console.error).finally(() => setLoading(false))
  }, [])

  async function handleDelete(id: string) {
    await api.alerts.delete(id)
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="แจ้งเตือนราคา" />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div className="bg-[#FBF0E0] border border-[#B8721A]/20 rounded-[14px] p-3 text-[11px] text-[#B8721A]">
          ⚠️ {DISCLAIMER}
        </div>

        {loading ? <Skeleton className="h-24" /> : alerts.length === 0 ? (
          <EmptyState icon="📈" text="ยังไม่มี alert — พิมใน LINE เช่น 'แจ้งเตือน PTT เมื่อราคาเกิน 40'" />
        ) : alerts.map(a => (
          <div key={a.id} className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-medium">{a.displayName} ({a.symbol})</p>
              <p className="text-[12px] text-[#636259]">{a.conditionType} ฿{Number(a.targetValue).toLocaleString()}</p>
              {a.note && <p className="text-[11px] text-[#9B9A94]">{a.note}</p>}
            </div>
            <button onClick={() => handleDelete(a.id)} className="text-[#B83232] text-[12px] font-medium">ลบ</button>
          </div>
        ))}
      </div>
    </div>
  )
}
