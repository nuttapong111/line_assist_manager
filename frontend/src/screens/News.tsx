import { useEffect, useState } from 'react'
import { PageHeader, Skeleton, EmptyState } from '../components/Layout'
import { api } from '../lib/api'
import { formatBangkokDate } from '../lib/datetime'

const DISCLAIMER = 'สรุปจากข่าวสาธารณะและ AI เท่านั้น ไม่ใช่คำแนะนำการลงทุน'

export default function News() {
  const [feed, setFeed] = useState<{
    bundles: any[]
    market: any[]
    disclaimer: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.news.getFeed()
      setFeed(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข่าวไม่สำเร็จ')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const { bundles } = await api.news.refresh()
      setFeed(prev => prev ? { ...prev, bundles } : { bundles, market: [], disclaimer: DISCLAIMER })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'รีเฟรชไม่สำเร็จ')
    }
    setRefreshing(false)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="ข่าวหุ้น"
        right={
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="text-[13px] text-[#2A5C45] font-medium disabled:opacity-50"
          >
            {refreshing ? 'กำลังอัปเดต...' : 'รีเฟรช'}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="bg-[#FBF0E0] border border-[#B8721A]/20 rounded-[14px] p-3 text-[11px] text-[#B8721A]">
          ⚠️ {feed?.disclaimer || DISCLAIMER}
        </div>

        {error && (
          <div className="bg-[#FDECEC] border border-[#B83232]/20 rounded-[14px] p-3 text-[12px] text-[#B83232]">
            {error.includes('FINNHUB') || error.includes('503')
              ? 'ยังไม่ได้ตั้ง FINNHUB_API_KEY บน Railway'
              : error}
          </div>
        )}

        {loading ? <Skeleton className="h-40" /> : (
          <>
            {feed?.bundles?.length === 0 ? (
              <EmptyState
                icon="📰"
                text="ยังไม่มีหุ้นใน watchlist — เพิ่มจากพอร์ตหรือแจ้งเตือนราคา แล้วกดรีเฟรช"
              />
            ) : feed?.bundles?.map(bundle => (
              <div key={bundle.symbol} className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[15px] font-semibold">{bundle.displayName}</p>
                  <span className="text-[11px] text-[#9B9A94] font-['DM_Mono']">{bundle.symbol}</span>
                </div>

                {bundle.aiSummary && (
                  <p className="text-[13px] text-[#636259] leading-relaxed bg-[#F7F6F2] rounded-[10px] p-3">
                    {bundle.aiSummary}
                  </p>
                )}

                {bundle.articles?.length === 0 ? (
                  <p className="text-[12px] text-[#9B9A94]">ไม่มีข่าวใหม่ 7 วันที่ผ่านมา</p>
                ) : bundle.articles?.map((a: any, i: number) => (
                  <a
                    key={`${bundle.symbol}-${i}`}
                    href={a.url || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border-t border-[rgba(0,0,0,0.06)] pt-3 first:border-0 first:pt-0"
                  >
                    <p className="text-[13px] font-medium text-[#18170F]">{a.headline}</p>
                    {a.summary && (
                      <p className="text-[11px] text-[#636259] mt-1 line-clamp-2">{a.summary}</p>
                    )}
                    <p className="text-[10px] text-[#9B9A94] mt-1">
                      {a.source} · {formatBangkokDate(a.datetime, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </a>
                ))}
              </div>
            ))}

            {feed?.market && feed.market.length > 0 && (
              <div>
                <p className="font-['DM_Sans'] text-[11px] font-semibold text-[#9B9A94] tracking-[0.08em] uppercase mb-3">
                  ข่าวตลาดทั่วไป
                </p>
                <div className="bg-white border border-[rgba(0,0,0,0.07)] rounded-[14px] p-4 space-y-3">
                  {feed.market.map((a: any, i: number) => (
                    <a
                      key={`market-${i}`}
                      href={a.url || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block border-t border-[rgba(0,0,0,0.06)] pt-3 first:border-0 first:pt-0"
                    >
                      <p className="text-[13px] font-medium">{a.headline}</p>
                      <p className="text-[10px] text-[#9B9A94] mt-1">{a.source}</p>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
