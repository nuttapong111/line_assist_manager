import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/Layout'
import { api } from '../lib/api'

const CATEGORIES = [
  { key: 'FOOD', icon: '🍜', label: 'อาหาร' },
  { key: 'TRANSPORT', icon: '🚗', label: 'เดินทาง' },
  { key: 'SHOPPING', icon: '🛍️', label: 'ช้อปปิ้ง' },
  { key: 'BILLS', icon: '📄', label: 'บิล' },
  { key: 'HEALTH', icon: '💊', label: 'สุขภาพ' },
  { key: 'OTHER', icon: '📦', label: 'อื่นๆ' },
]

export default function SlipConfirm() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [selectedCat, setSelectedCat] = useState('FOOD')
  const [saving, setSaving] = useState(false)

  async function handleFile(file: File) {
    setScanning(true)
    try {
      const data = await api.ocr.scanSlip(file)
      setResult(data)
    } catch (e) { console.error(e) }
    setScanning(false)
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)
    try {
      await api.finance.createTransaction({
        type: 'EXPENSE',
        amount: result.amount,
        description: result.merchant_name,
        merchantName: result.merchant_name,
        transaction_date: result.date,
        slip_image_url: result.image_url,
        source: 'OCR',
      })
      navigate('/finance')
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="บันทึกจากสลิป" right={
        <button onClick={() => navigate(-1)} className="text-[14px] text-[#636259]">← กลับ</button>
      } />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {!result && !scanning && (
          <div className="text-center py-8">
            <div className="w-20 h-20 rounded-[20px] bg-[#EEEDE8] flex items-center justify-center text-[36px] mx-auto mb-4">📷</div>
            <p className="text-[14px] text-[#636259] mb-4">เลือกรูปสลิปเพื่ออ่านด้วย AI</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} className="w-full py-[14px] bg-[#2A5C45] text-white rounded-[14px] font-semibold text-[15px]">
              เลือกรูปสลิป
            </button>
          </div>
        )}

        {scanning && (
          <div className="bg-[#E6F0EB] rounded-[14px] p-4 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-[#2A5C45] animate-pulse-dot" />
            <span className="text-[13px] text-[#2A5C45] font-medium">AI กำลังอ่านสลิป...</span>
          </div>
        )}

        {result && (
          <>
            <div className="bg-[#E6F0EB] rounded-[14px] p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#2A5C45]" />
                <span className="text-[13px] text-[#2A5C45] font-medium">AI อ่านสลิปแล้ว</span>
              </div>
              <span className="text-[11px] font-semibold bg-[#2A5C45] text-white px-2 py-0.5 rounded-full">✓ สำเร็จ</span>
            </div>

            <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4 space-y-3">
              <div>
                <p className="text-[11px] text-[#9B9A94]">ยอดเงิน</p>
                <p className="font-['DM_Mono'] text-[22px] font-semibold">฿{Number(result.amount).toLocaleString()}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[11px] text-[#9B9A94]">วันที่</p><p className="text-[13px] font-medium">{result.date}</p></div>
                <div><p className="text-[11px] text-[#9B9A94]">ร้าน/ผู้รับ</p><p className="text-[13px] font-medium">{result.merchant_name}</p></div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-[#9B9A94] uppercase mb-2">หมวดหมู่</p>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map(c => (
                  <button key={c.key} onClick={() => setSelectedCat(c.key)}
                    className={`border-[1.5px] rounded-[10px] p-2 flex flex-col items-center gap-1 transition-all ${selectedCat === c.key ? 'border-[#2A5C45] bg-[#E6F0EB] text-[#2A5C45]' : 'border-[rgba(0,0,0,0.07)]'}`}>
                    <span className="text-[20px]">{c.icon}</span>
                    <span className="text-[11px]">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleSave} disabled={saving}
              className="w-full py-[14px] bg-[#2A5C45] text-white rounded-[14px] font-semibold text-[15px] disabled:opacity-50">
              {saving ? 'กำลังบันทึก...' : 'บันทึกรายจ่าย'}
            </button>
            <button onClick={() => navigate(-1)} className="w-full py-[14px] bg-[#EEEDE8] text-[#636259] rounded-[14px] text-[15px]">
              ยกเลิก
            </button>
          </>
        )}
      </div>
    </div>
  )
}
