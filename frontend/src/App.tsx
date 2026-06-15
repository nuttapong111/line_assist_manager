import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { initLiff } from './lib/liff'
import { TabBar } from './components/Layout'
import Dashboard from './screens/Dashboard'
import Finance from './screens/Finance'
import SlipConfirm from './screens/SlipConfirm'
import Appointments from './screens/Appointments'
import SavingGoals from './screens/SavingGoals'
import Portfolio from './screens/Portfolio'
import PriceAlerts from './screens/PriceAlerts'
import Settings from './screens/Settings'
import BudgetSetup from './screens/BudgetSetup'

function AppLayout() {
  const location = useLocation()
  const hideTabBar = ['/slip', '/portfolio', '/alerts', '/budget'].includes(location.pathname)

  return (
    <div className="max-w-[430px] mx-auto h-screen flex flex-col bg-[#F7F6F2]">
      <div className="flex-1 flex flex-col overflow-hidden">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/slip" element={<SlipConfirm />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/goals" element={<SavingGoals />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/alerts" element={<PriceAlerts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/budget" element={<BudgetSetup />} />
        </Routes>
      </div>
      {!hideTabBar && <TabBar />}
    </div>
  )
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    initLiff()
      .catch((err) => setInitError(err instanceof Error ? err.message : 'LIFF init failed'))
      .finally(() => setReady(true))
  }, [])

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F7F6F2]">
        <div className="text-center">
          <div className="w-12 h-12 rounded-[14px] bg-[#2A5C45] flex items-center justify-center text-white text-[24px] mx-auto mb-3">🤖</div>
          <p className="text-[14px] text-[#636259]">กำลังโหลด MyAssist...</p>
        </div>
      </div>
    )
  }

  if (initError) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F7F6F2] px-6">
        <div className="text-center max-w-sm">
          <p className="text-[16px] font-medium text-[#B83232] mb-2">ไม่สามารถเข้าสู่ระบบได้</p>
          <p className="text-[13px] text-[#636259]">{initError}</p>
          <p className="text-[12px] text-[#9B9A94] mt-3">เปิดแอปจาก LINE และตรวจสอบ VITE_LIFF_ID</p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}
