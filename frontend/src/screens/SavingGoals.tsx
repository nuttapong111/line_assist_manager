import { useEffect, useState } from 'react'
import { PageHeader, Skeleton, EmptyState } from '../components/Layout'
import { api } from '../lib/api'

export default function SavingGoals() {
  const [goals, setGoals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showContribute, setShowContribute] = useState<string | null>(null)
  const [amount, setAmount] = useState('')

  useEffect(() => {
    api.goals.getAll().then(setGoals).catch(console.error).finally(() => setLoading(false))
  }, [])

  async function handleContribute(goalId: string) {
    if (!amount) return
    try {
      await api.goals.contribute(goalId, Number(amount))
      const updated = await api.goals.getAll()
      setGoals(updated)
      setShowContribute(null)
      setAmount('')
    } catch (e) { console.error(e) }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="เป้าหมายการออม" subtitle={`${goals.length} เป้าหมาย`} />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loading ? <Skeleton className="h-32" /> : goals.length === 0 ? (
          <EmptyState icon="🎯" text="ยังไม่มีเป้าหมาย — พิมใน LINE เช่น 'ตั้งเป้าเก็บเงิน iPhone 50000'" />
        ) : goals.map(g => {
          const pct = g.pct_complete ?? 0
          const barColor = pct < 50 ? '#B83232' : pct < 80 ? '#B8721A' : '#2A5C45'
          return (
            <div key={g.id} className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[20px] p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[24px]">{g.icon}</span>
                  <div>
                    <p className="text-[14px] font-medium">{g.name}</p>
                    {g.deadline && <p className="text-[11px] text-[#9B9A94]">เป้า {new Date(g.deadline).toLocaleDateString('th-TH')}</p>}
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: barColor + '20', color: barColor }}>
                  {pct}%
                </span>
              </div>
              <div className="h-[6px] bg-[#EEEDE8] rounded-full overflow-hidden mb-2">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
              </div>
              <div className="flex justify-between text-[12px] text-[#636259] mb-3">
                <span>ออมแล้ว ฿{Number(g.currentAmount).toLocaleString()}</span>
                <span>เป้า ฿{Number(g.targetAmount).toLocaleString()}</span>
              </div>
              {showContribute === g.id ? (
                <div className="flex gap-2">
                  <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="จำนวนเงิน"
                    className="flex-1 px-3 py-2 border border-[rgba(0,0,0,0.13)] rounded-[10px] text-[14px] focus:outline-none" />
                  <button onClick={() => handleContribute(g.id)} className="px-4 py-2 bg-[#2A5C45] text-white rounded-[10px] text-[13px] font-medium">บันทึก</button>
                </div>
              ) : (
                <button onClick={() => setShowContribute(g.id)} className="text-[12px] text-[#2A5C45] font-medium">+ ออมเพิ่ม</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
