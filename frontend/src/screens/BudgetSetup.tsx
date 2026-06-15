import { useEffect, useState } from 'react'
import { PageHeader, Skeleton } from '../components/Layout'
import { api } from '../lib/api'

export default function BudgetSetup() {
  const month = new Date().toISOString().slice(0, 7)
  const [budgets, setBudgets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Record<string, string>>({})

  useEffect(() => {
    api.budget.get(month).then(data => {
      setBudgets(data)
      const edits: Record<string, string> = {}
      data.forEach(b => { edits[b.id] = String(b.budget_amount || 0) })
      setEditing(edits)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    const categories = budgets.map(b => ({
      category_id: b.id,
      amount: Number(editing[b.id] || 0),
    }))
    await api.budget.upsert(month, categories)
    alert('บันทึกงบประมาณแล้ว')
  }

  const total = Object.values(editing).reduce((s, v) => s + Number(v || 0), 0)
  const totalSpent = budgets.reduce((s, b) => s + (b.spent || 0), 0)

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="งบประมาณ" subtitle={new Date(month + '-01').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })} />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="bg-[#E8EEFA] border border-[#2655A0]/15 rounded-[14px] p-3 flex gap-2">
          <span>💡</span>
          <p className="text-[12px] text-[#2655A0]">ตั้งงบต่อหมวด — ระบบจะแจ้งเตือนเมื่อใกล้เกิน 80%</p>
        </div>

        {loading ? <Skeleton className="h-48" /> : (
          <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[20px] p-4 space-y-3">
            {budgets.map(b => (
              <div key={b.id} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[10px] bg-[#EEEDE8] flex items-center justify-center text-[18px]">{b.icon}</div>
                <div className="flex-1">
                  <p className="text-[13px] font-medium">{b.name}</p>
                  <p className="text-[11px] text-[#9B9A94]">ใช้ไป ฿{b.spent?.toLocaleString()}</p>
                </div>
                <input
                  value={editing[b.id] || ''}
                  onChange={e => setEditing(prev => ({ ...prev, [b.id]: e.target.value }))}
                  className="w-20 px-2 py-1 border border-[rgba(0,0,0,0.13)] rounded-[8px] text-[14px] font-['DM_Sans'] text-right focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}

        <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4 flex justify-between items-center">
          <div>
            <p className="text-[12px] text-[#9B9A94]">งบรวมทั้งหมด</p>
            <p className="font-['DM_Sans'] text-[20px] font-semibold">฿{total.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-[12px] text-[#9B9A94]">ใช้ไป</p>
            <p className="font-['DM_Sans'] text-[16px] font-semibold text-[#B83232]">฿{totalSpent.toLocaleString()}</p>
          </div>
        </div>

        <button onClick={handleSave} className="w-full py-[14px] bg-[#2A5C45] text-white rounded-[14px] font-semibold text-[15px]">
          บันทึกงบประมาณ
        </button>
      </div>
    </div>
  )
}
