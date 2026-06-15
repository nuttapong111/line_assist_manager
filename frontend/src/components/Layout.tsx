import { useNavigate, useLocation } from 'react-router-dom'

const tabs = [
  { id: '/', icon: '🏠', label: 'หน้าหลัก' },
  { id: '/appointments', icon: '📅', label: 'นัดหมาย' },
  { id: '/finance', icon: '💰', label: 'การเงิน' },
  { id: '/goals', icon: '🎯', label: 'เป้าหมาย' },
  { id: '/settings', icon: '⚙️', label: 'ตั้งค่า' },
]

export function TabBar() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="h-[68px] bg-white/95 backdrop-blur-xl border-t border-[rgba(0,0,0,0.07)] flex items-center px-2 pb-2 flex-shrink-0">
      {tabs.map(tab => {
        const active = location.pathname === tab.id
        return (
          <div
            key={tab.id}
            className="flex-1 flex flex-col items-center gap-[3px] py-2 px-1 rounded-[10px] cursor-pointer transition-all"
            onClick={() => navigate(tab.id)}
          >
            <div className={`w-7 h-7 flex items-center justify-center rounded-[8px] text-[18px] transition-all ${active ? 'bg-[#2A5C45] text-white scale-[1.08]' : ''}`}>
              {tab.icon}
            </div>
            <span className={`text-[10px] transition-colors ${active ? 'text-[#2A5C45] font-medium' : 'text-[#9B9A94]'}`}>
              {tab.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="bg-white border-b border-[rgba(0,0,0,0.07)] px-5 py-4 flex items-center justify-between">
      <div>
        <h1 className="font-['DM_Sans'] text-[20px] font-semibold text-[#18170F] tracking-[-0.3px]">{title}</h1>
        {subtitle && <p className="text-[13px] text-[#9B9A94] mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-[#EEEDE8] rounded-[14px] ${className}`} />
}

export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center py-10 text-[#9B9A94]">
      <div className="text-[40px] mb-2">{icon}</div>
      <p className="text-[14px]">{text}</p>
    </div>
  )
}
