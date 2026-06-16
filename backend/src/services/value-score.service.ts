import { getMarketAsset } from '../data/market-universe'
import { isThaiListedSymbol } from '../data/thai-set-symbols'
import {
  isSuperinvestorSymbol,
  isViFundSymbol,
  isViStockSymbol,
} from '../data/vi-universe'
import { hasFinnhubKey } from './news.service'
import { fetchOHLCV, type OHLCV } from './yahoo.service'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface ValueMetricDetail {
  label: string
  value: string
  viNote: string
}

export interface ValueAnalysisDetail {
  score: number
  reasons: string[]
  metrics: ValueMetricDetail[]
  summary: string
  marginOfSafetyNote: string | null
  styleLabel: string
}

export interface ValueScoreResult {
  score: number
  reasons: string[]
}

const valueCache = new Map<string, ValueScoreResult & { at: number }>()
const analysisCache = new Map<string, ValueAnalysisDetail & { at: number }>()

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function pct(score: number): string {
  return (Math.round(score * 1000) / 10).toFixed(1)
}

function isUsOrGlobalEquity(symbol: string): boolean {
  const asset = getMarketAsset(symbol)
  if (asset?.category === 'TH_STOCK' || asset?.category === 'TH_FUND') return false
  if (asset?.category === 'US_STOCK' || asset?.category === 'US_ETF') return true
  if (isThaiListedSymbol(symbol)) return false
  if (isViFundSymbol(symbol)) return false
  return true
}

function peViNote(pe: number): string {
  if (pe <= 0) return 'ขาดทุนหรือไม่มีกำไร — ไม่เข้าเกณฑ์ VI คลาสสิก'
  if (pe < 12) return 'ราคาต่ำเทียบกำไร — ใกล้แนว value'
  if (pe < 20) return 'P/E ปานกลาง — สมดุล value/quality'
  if (pe < 35) return 'P/E ค่อนข้างสูง — ตลาดคาดหวังการเติบโต'
  return 'P/E สูง — เน้น growth มากกว่า value คลาสสิก'
}

function pbViNote(pb: number): string {
  if (pb < 1.2) return 'ต่ำกว่ามูลคือบัญชี — มี margin of safety ด้านราคา'
  if (pb < 2.5) return 'สมเหตุสมผลเทียบสินทรัพย์'
  return 'สูงกว่ามูลคือบัญชีมาก — ต้องพึ่งการเติบโตในอนาคต'
}

function dividendViNote(dy: number): string {
  if (dy >= 0.04) return 'ปันผลดี — เหมาะสาย income/VI ไทย'
  if (dy >= 0.02) return 'มีปันผลปานกลาง'
  if (dy > 0) return 'ปันผลน้อย — ไม่ใช่โฟกัสหลัก'
  return 'ไม่เน้นปันผล — มักเป็น growth'
}

function roeViNote(roe: number): string {
  if (roe >= 0.2) return 'กำไรต่อทุนสูง — ธุรกิจคุณภาพดี (แนว Buffett)'
  if (roe >= 0.12) return 'ROE ดี — บริษัททำกำไรได้สม่ำเสมอ'
  if (roe > 0) return 'ROE ปานกลาง'
  return 'ROE ต่ำ/ติดลบ — ระวังคุณภาพธุรกิจ'
}

function buildMarginNote(ohlcv: OHLCV[]): string | null {
  const closes = ohlcv.map(d => d.close).filter(c => c > 0)
  if (closes.length < 60) return null
  const slice = closes.slice(-Math.min(252, closes.length))
  const high = Math.max(...slice)
  const low = Math.min(...slice)
  const current = closes[closes.length - 1]
  if (high <= low) return null
  const position = ((current - low) / (high - low)) * 100
  if (position < 35) return `Margin of safety: ราคาอยู่ใกล้จุดต่ำ 52 สัปดาห์ (${position.toFixed(0)}% ของกรอบ) — น่าพิจารณาสะสม`
  if (position > 75) return `ราคาอยู่สูงในกรอบ 52 สัปดาห์ (${position.toFixed(0)}%) — VI มักรอ pullback ก่อนเพิ่ม`
  return `ราคาอยู่กลางกรอบ 52 สัปดาห์ (${position.toFixed(0)}%) — ไม่ถูก/แพงชัดเจน`
}

function inferStyleLabel(metrics: ValueMetricDetail[], score: number): string {
  const peMetric = metrics.find(m => m.label === 'P/E')
  const dyMetric = metrics.find(m => m.label === 'ปันผล')
  const pe = peMetric ? parseFloat(peMetric.value) : NaN
  const dy = dyMetric ? parseFloat(dyMetric.value) : 0
  if (dy >= 3) return 'สายปันผล / Income'
  if (pe > 35) return 'Growth / Quality (ไม่ใช่ value คลาสสิก)'
  if (pe > 0 && pe < 18 && score >= 0.35) return 'Value / Quality'
  if (score >= 0.4) return 'Quality at Reasonable Price'
  return 'ผสม Growth-Value / ต้องดูเพิ่ม'
}

function buildViSummary(symbol: string, style: string, metrics: ValueMetricDetail[], marginNote: string | null, score: number): string {
  const lines: string[] = []
  if (isSuperinvestorSymbol(symbol)) {
    lines.push('• อยู่ในกลุ่มหุ้นที่นักลงทุนชื่อดานระดับโลกถือยาว')
  }
  lines.push(`• สไตล์: ${style}`)
  if (marginNote) lines.push(`• ${marginNote}`)
  const pe = metrics.find(m => m.label === 'P/E')
  if (pe && parseFloat(pe.value) > 30) {
    lines.push('• VI คลาสสิก (Graham/Buffett) มักไม่ชอบ P/E สูงมาก — ต้องเชื่อมั่นการเติบโตระยะยาว')
  } else if (score >= 0.4) {
    lines.push('• มูลค่าพื้นฐานดีพอสำหรับพิจารณาลงทุนระยะยาว')
  } else if (score < 0.15) {
    lines.push('• มูลค่าพื้นฐานยังไม่โดดเด่น — ควรรอราคาที่สมเหตุสมผลกว่านี้')
  }
  lines.push('• VI = ซื้อธุรกิจดีในราคาสมเหตุสมผล ถือยาว ไม่ใช่เก็งกำไรสั้น')
  return lines.join('\n')
}

async function finnhubMetric(symbol: string): Promise<Record<string, number>> {
  const key = process.env.FINNHUB_API_KEY
  if (!key) return {}
  const res = await fetch(
    `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${key}`,
    { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } },
  )
  if (!res.ok) return {}
  const json = await res.json() as { metric?: Record<string, number> }
  return json.metric || {}
}

function scorePe(pe: number): number {
  if (pe <= 0) return -0.3
  if (pe < 12) return 0.8
  if (pe < 20) return 0.5
  if (pe < 30) return 0.15
  return -0.25
}

function scorePb(pb: number): number {
  if (pb < 1.2) return 0.6
  if (pb < 2.5) return 0.25
  if (pb < 5) return 0
  return -0.2
}

function scoreDividendYield(dy: number): number {
  if (dy >= 0.05) return 0.75
  if (dy >= 0.03) return 0.5
  if (dy >= 0.015) return 0.25
  if (dy > 0) return 0.1
  return 0
}

function scoreRoe(roe: number): number {
  if (roe >= 0.2) return 0.65
  if (roe >= 0.12) return 0.35
  if (roe > 0) return 0.05
  return -0.25
}

function computeFundValueAnalysis(symbol: string): ValueAnalysisDetail {
  const { score, reasons } = computeFundValueScore(symbol)
  const metrics: ValueMetricDetail[] = [
    { label: 'ประเภท', value: 'กองทุน/ETF', viNote: reasons[1] || 'ลงทุนระยะยาว กระจายความเสี่ยง' },
  ]
  return {
    score,
    reasons,
    metrics,
    marginOfSafetyNote: 'กองทุนดัชนี/ปันผล — เน้นถือยาว ไม่ต้องจับจังหวะมาก',
    styleLabel: reasons.includes('ดัชนีต่ำค่าธรรมเนียม (แนว Bogle)') ? 'Index (Bogle)' : 'กองทุน VI',
    summary: buildViSummary(symbol, 'กองทุน/ETF', metrics, null, score),
  }
}

function computeThaiValueAnalysis(symbol: string, ohlcv: OHLCV[]): ValueAnalysisDetail {
  const { score, reasons } = computeThaiValueProxy(symbol, ohlcv)
  const marginOfSafetyNote = buildMarginNote(ohlcv)
  const metrics: ValueMetricDetail[] = [
    { label: 'ตลาด', value: 'SET/MAI', viNote: isViStockSymbol(symbol) ? 'อยู่ในกลุ่มหุ้นคุณภาพ VI ไทย' : 'หุ้นไทย — ใช้ตำแหน่งราคาในกรอบเป็นตัวแทนมูลค่า' },
  ]
  if (marginOfSafetyNote) {
    metrics.push({ label: '52W Range', value: 'จากกราฟ', viNote: marginOfSafetyNote })
  }
  const styleLabel = isViStockSymbol(symbol) ? 'หุ้นคุณภาพ/ปันผล ไทย' : 'หุ้นไทย'
  return {
    score,
    reasons,
    metrics,
    marginOfSafetyNote,
    styleLabel,
    summary: buildViSummary(symbol, styleLabel, metrics, marginOfSafetyNote, score),
  }
}

async function computeUsValueAnalysis(symbol: string, ohlcv?: OHLCV[]): Promise<ValueAnalysisDetail> {
  const reasons: string[] = []
  const metrics: ValueMetricDetail[] = []
  let total = 0
  let weight = 0

  if (isSuperinvestorSymbol(symbol)) {
    total += 0.35
    weight += 1
    reasons.push('อยู่ในพอร์ตนักลงทุนชื่อดานระดับโลก')
    metrics.push({ label: 'นักลงทุนดัง', value: 'ถือยาว', viNote: 'มีการถือในพอร์ต superinvestor' })
  }

  if (hasFinnhubKey()) {
    try {
      const m = await finnhubMetric(symbol)
      if (m.peNormalizedAnnual != null) {
        total += scorePe(m.peNormalizedAnnual)
        weight += 1
        const note = peViNote(m.peNormalizedAnnual)
        reasons.push(`P/E ${m.peNormalizedAnnual.toFixed(1)}`)
        metrics.push({ label: 'P/E', value: m.peNormalizedAnnual.toFixed(1), viNote: note })
      }
      if (m.pbQuarterly != null) {
        total += scorePb(m.pbQuarterly)
        weight += 1
        reasons.push(`P/B ${m.pbQuarterly.toFixed(2)}`)
        metrics.push({ label: 'P/B', value: m.pbQuarterly.toFixed(2), viNote: pbViNote(m.pbQuarterly) })
      }
      if (m.dividendYieldIndicatedAnnual != null) {
        total += scoreDividendYield(m.dividendYieldIndicatedAnnual)
        weight += 1
        const dyPct = (m.dividendYieldIndicatedAnnual * 100).toFixed(1)
        reasons.push(`ปันผล ${dyPct}%`)
        metrics.push({ label: 'ปันผล', value: `${dyPct}%`, viNote: dividendViNote(m.dividendYieldIndicatedAnnual) })
      }
      if (m.roeTTM != null) {
        total += scoreRoe(m.roeTTM)
        weight += 1
        const roePct = (m.roeTTM * 100).toFixed(0)
        reasons.push(`ROE ${roePct}%`)
        metrics.push({ label: 'ROE', value: `${roePct}%`, viNote: roeViNote(m.roeTTM) })
      }
      if (m['52WeekHigh'] != null && m['52WeekLow'] != null) {
        metrics.push({
          label: '52W',
          value: `$${m['52WeekLow'].toFixed(2)} – $${m['52WeekHigh'].toFixed(2)}`,
          viNote: 'กรอบราคา 1 ปี — ใช้ประเมิน margin of safety',
        })
      }
    } catch (err) {
      console.error(`[value-score] Finnhub failed for ${symbol}:`, err)
    }
  } else if (!metrics.length) {
    reasons.push('ไม่มี FINNHUB_API_KEY — วิเคราะห์มูลค่าจำกัด')
  }

  const bars = ohlcv?.length ? ohlcv : await fetchOHLCV(symbol, '1d', 252)
  const marginOfSafetyNote = buildMarginNote(bars)
  if (marginOfSafetyNote && !metrics.some(m => m.label === '52W Range')) {
    metrics.push({ label: '52W Range', value: 'จากกราฟ', viNote: marginOfSafetyNote })
  }

  const score = weight > 0 ? total / weight : (isSuperinvestorSymbol(symbol) ? 0.3 : 0)
  const styleLabel = inferStyleLabel(metrics, score)
  return {
    score: clamp(score, -1, 1),
    reasons,
    metrics,
    marginOfSafetyNote,
    styleLabel,
    summary: buildViSummary(symbol, styleLabel, metrics, marginOfSafetyNote, score),
  }
}

export async function getValueAnalysis(symbol: string, ohlcv?: OHLCV[]): Promise<ValueAnalysisDetail> {
  const sym = symbol.toUpperCase()
  const cached = analysisCache.get(sym)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    const { at: _at, ...detail } = cached
    return detail
  }

  const asset = getMarketAsset(sym)
  let detail: ValueAnalysisDetail

  if (isViFundSymbol(sym) || asset?.category === 'TH_FUND' || asset?.category === 'US_ETF') {
    detail = computeFundValueAnalysis(sym)
  } else if (isUsOrGlobalEquity(sym)) {
    detail = await computeUsValueAnalysis(sym, ohlcv)
  } else {
    const bars = ohlcv?.length ? ohlcv : await fetchOHLCV(sym, '1d', 252)
    detail = computeThaiValueAnalysis(sym, bars)
  }

  analysisCache.set(sym, { ...detail, at: Date.now() })
  valueCache.set(sym, { score: detail.score, reasons: detail.reasons, at: Date.now() })
  return detail
}

function computeFundValueScore(symbol: string): ValueScoreResult {
  const sym = symbol.toUpperCase()
  const indexFunds = new Set(['VOO', 'VTI', 'SPY', 'SET50', 'TDEX', 'UOBSET50', 'KFS100-A', 'K-US500X'])
  const dividendFunds = new Set(['1DIV', 'KFSDIV', 'SCHD', 'JEPI', 'JEPQ'])

  let score = 0.25
  const reasons: string[] = ['กองทุน/ETF ระยะยาว']

  if (indexFunds.has(sym)) {
    score = 0.65
    reasons.push('ดัชนีต่ำค่าธรรมเนียม (แนว Bogle)')
  } else if (dividendFunds.has(sym)) {
    score = 0.72
    reasons.push('เน้นปันผล/คุณภาพ (แนว VI ไทย)')
  } else if (sym === 'KFGGRM') {
    score = 0.35
    reasons.push('กองทุนโลก — กระจายความเสี่ยง')
  }

  return { score: clamp(score, -1, 1), reasons }
}

function computeThaiValueProxy(symbol: string, ohlcv: OHLCV[]): ValueScoreResult {
  const closes = ohlcv.map(d => d.close).filter(c => c > 0)
  const reasons: string[] = []
  let score = 0.25

  if (isViStockSymbol(symbol)) {
    score += 0.2
    reasons.push('อยู่ในกลุ่มหุ้นคุณภาพ VI ไทย')
  }

  if (closes.length >= 60) {
    const slice = closes.slice(-Math.min(252, closes.length))
    const high = Math.max(...slice)
    const low = Math.min(...slice)
    const current = closes[closes.length - 1]
    if (high > low) {
      const position = (current - low) / (high - low)
      const rangeScore = 0.6 - position * 0.8
      score += rangeScore
      if (position < 0.35) reasons.push('ราคาใกล้จุดต่ำ 52 สัปดาห์ (margin of safety)')
      else if (position > 0.75) reasons.push('ราคาสูงในกรอบ 52 สัปดาห์ — รอ pullback')
      else reasons.push('ราคาอยู่กลางกรอบ 52 สัปดาห์')
    }
  }

  return { score: clamp(score, -1, 1), reasons }
}

export const VI_VALUE_WEIGHT = Number(process.env.VI_VALUE_WEIGHT || '0.6')
export const VI_TECH_WEIGHT = Number(process.env.VI_TECH_WEIGHT || '0.4')

export function computeViCompositeScore(valueScore: number, technicalScore: number): number {
  const composite = valueScore * VI_VALUE_WEIGHT + technicalScore * VI_TECH_WEIGHT
  return clamp(composite, -1, 1)
}

export { pct as formatScorePct }

export async function computeValueScore(symbol: string, ohlcv?: OHLCV[]): Promise<ValueScoreResult> {
  const detail = await getValueAnalysis(symbol, ohlcv)
  return { score: detail.score, reasons: detail.reasons }
}
