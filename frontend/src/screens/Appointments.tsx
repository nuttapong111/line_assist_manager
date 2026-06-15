import { useEffect, useState } from 'react'
import { PageHeader, Skeleton, EmptyState } from '../components/Layout'
import { api } from '../lib/api'

export default function Appointments() {
  const [appts, setAppts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const today = new Date()

  useEffect(() => {
    async function load() {
      try {
        const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
        const to = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]
        const data = await api.appointments.getRange(from, to)
        setAppts(data)
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - today.getDay() + i)
    return d
  })

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="นัดหมาย" subtitle={today.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })} />

      <div className="bg-white border-b border-[rgba(0,0,0,0.07)] px-3 py-3 flex gap-1">
        {days.map(d => {
          const isToday = d.toDateString() === today.toDateString()
          const hasEvent = appts.some(a => new Date(a.startAt).toDateString() === d.toDateString())
          return (
            <div key={d.toISOString()} className={`flex-1 flex flex-col items-center py-2 rounded-[10px] ${isToday ? 'bg-[#2A5C45] text-white' : ''}`}>
              <span className={`text-[10px] uppercase ${isToday ? 'text-white/70' : 'text-[#9B9A94]'}`}>
                {d.toLocaleDateString('th-TH', { weekday: 'short' })}
              </span>
              <span className="text-[16px] font-semibold font-['DM_Sans']">{d.getDate()}</span>
              {hasEvent && <div className={`w-1 h-1 rounded-full mt-0.5 ${isToday ? 'bg-white' : 'bg-[#2A5C45]'}`} />}
            </div>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? <Skeleton className="h-32" /> : appts.length === 0 ? (
          <EmptyState icon="📅" text="ไม่มีนัดหมายในเดือนนี้" />
        ) : appts.map(a => (
          <div key={a.id} className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4 mb-3 flex gap-3">
            <div className="text-right w-10">
              <p className="font-['DM_Mono'] text-[11px] text-[#9B9A94]">
                {new Date(a.startAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <div className="flex-1 border-l-[3px] border-[#2A5C45] pl-3">
              <p className="text-[13px] font-semibold">{a.title}</p>
              {a.location && <p className="text-[11px] text-[#636259] mt-0.5">📍 {a.location}</p>}
              <p className="text-[11px] text-[#9B9A94] mt-0.5">
                {new Date(a.startAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
