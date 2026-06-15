import { useEffect, useState } from 'react'
import { PageHeader, Skeleton, EmptyState } from '../components/Layout'
import { api } from '../lib/api'

export default function Portfolio() {
  const [positions, setPositions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.portfolio.getPositions().then(setPositions).catch(console.error).finally(() => setLoading(false))
  }, [])

  const totalValue = positions.reduce((s, p) => s + (p.cost_basis ?? 0), 0)

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="พอร์ตการลงทุน" />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="bg-[#2A5C45] rounded-[20px] p-5 text-white">
          <p className="text-white/75 text-[12px]">มูลค่ารวม (cost basis)</p>
          <p className="font-['DM_Mono'] text-[28px] font-semibold mt-1">฿{totalValue.toLocaleString()}</p>
          <p className="text-white/65 text-[11px] mt-2">วิเคราะห์จาก technical indicators เท่านั้น ไม่ใช่คำแนะนำการลงทุน</p>
        </div>

        {loading ? <Skeleton className="h-32" /> : positions.length === 0 ? (
          <EmptyState icon="📈" text="ยังไม่มีพอร์ต — พิมใน LINE เช่น 'ซื้อ PTT 100 หุ้น 35'" />
        ) : positions.map(p => (
          <div key={p.id} className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-medium">{p.displayName}</p>
              <p className="text-[11px] text-[#9B9A94]">{p.symbol} · {Number(p.quantity).toLocaleString()} หุ้น</p>
            </div>
            <div className="text-right">
              <p className="font-['DM_Mono'] text-[14px] font-semibold">฿{Number(p.avgCost).toLocaleString()}</p>
              <p className="text-[10px] text-[#9B9A94]">avg cost</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
