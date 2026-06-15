import { useEffect, useState } from 'react'
import { PageHeader, Skeleton, EmptyState } from '../components/Layout'
import { api } from '../lib/api'

export default function Finance() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [summary, setSummary] = useState<Record<string, number> | null>(null)
  const [budgets, setBudgets] = useState<any[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [s, b, t] = await Promise.all([
          api.finance.getSummary(month),
          api.budget.get(month),
          api.finance.getTransactions(month),
        ])
        setSummary(s)
        setBudgets(b)
        setTransactions(t.transactions)
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [month])

  const monthLabel = new Date(month + '-01').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })

  function shiftMonth(dir: number) {
    const d = new Date(month + '-01')
    d.setMonth(d.getMonth() + dir)
    setMonth(d.toISOString().slice(0, 7))
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="การเงิน" />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => shiftMonth(-1)} className="w-8 h-8 rounded-full border border-[rgba(0,0,0,0.13)] flex items-center justify-center text-[#636259]">‹</button>
          <span className="font-['DM_Sans'] text-[15px] font-semibold">{monthLabel}</span>
          <button onClick={() => shiftMonth(1)} className="w-8 h-8 rounded-full border border-[rgba(0,0,0,0.13)] flex items-center justify-center text-[#636259]">›</button>
        </div>

        {loading ? <Skeleton className="h-20" /> : (
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4">
              <p className="text-[11px] text-[#9B9A94]">รายรับ</p>
              <p className="font-['DM_Mono'] text-[18px] font-semibold text-[#2A5C45] mt-1">฿{(summary?.income ?? 0).toLocaleString()}</p>
            </div>
            <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4">
              <p className="text-[11px] text-[#9B9A94]">รายจ่าย</p>
              <p className="font-['DM_Mono'] text-[18px] font-semibold text-[#B83232] mt-1">฿{(summary?.expenses ?? 0).toLocaleString()}</p>
            </div>
          </div>
        )}

        <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[20px] p-4">
          <div className="flex justify-between mb-3">
            <span className="font-['DM_Sans'] text-[11px] font-semibold text-[#9B9A94] tracking-[0.08em] uppercase">งบประมาณ</span>
          </div>
          {loading ? <Skeleton className="h-24" /> : budgets.map(b => {
            const pct = b.pct_used ?? 0
            const barColor = pct >= 100 ? '#B83232' : pct >= 80 ? '#B8721A' : '#2A5C45'
            return (
              <div key={b.id} className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[18px]">{b.icon}</span>
                    <span className="text-[13px] font-medium">{b.name}</span>
                  </div>
                  <span className="font-['DM_Mono'] text-[12px] text-[#636259]">฿{b.spent?.toLocaleString()} / ฿{b.budget_amount?.toLocaleString()}</span>
                </div>
                <div className="h-[5px] bg-[#EEEDE8] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[20px] p-4">
          <span className="font-['DM_Sans'] text-[11px] font-semibold text-[#9B9A94] tracking-[0.08em] uppercase">รายการล่าสุด</span>
          {loading ? <Skeleton className="h-32 mt-3" /> : transactions.length === 0 ? (
            <EmptyState icon="💰" text="ยังไม่มีรายการ" />
          ) : transactions.slice(0, 10).map(t => (
            <div key={t.id} className="flex items-center gap-3 py-3 border-b border-[rgba(0,0,0,0.05)] last:border-0">
              <div className="w-[38px] h-[38px] rounded-[12px] bg-[#EEEDE8] flex items-center justify-center text-[16px]">
                {t.type === 'EXPENSE' ? '💸' : '💰'}
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-medium">{t.description || t.merchantName || 'รายการ'}</p>
                <p className="text-[11px] text-[#9B9A94]">{t.categoryName || t.type}</p>
              </div>
              <div className="text-right">
                <p className={`font-['DM_Mono'] text-[14px] font-semibold ${t.type === 'EXPENSE' ? 'text-[#B83232]' : 'text-[#2A5C45]'}`}>
                  {t.type === 'EXPENSE' ? '-' : '+'}฿{Number(t.amount).toLocaleString()}
                </p>
                <p className="text-[10px] text-[#9B9A94]">{t.transactionDate}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
