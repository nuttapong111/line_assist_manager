import type { ValueAnalysisDetail } from './value-score.service'
import { formatScorePct } from './value-score.service'
import type { SupportResistanceLevels } from './support-resistance.service'
import type { OHLCV } from './yahoo.service'
import type { IndicatorResult } from '../types'
import { formatAssetPrice } from '../data/market-universe'
import { isSuperinvestorSymbol, isViFundSymbol, isViStockSymbol } from '../data/vi-universe'

export type ViPriceZone = 'ต้นกรอบ' | 'กลางกรอบ' | 'ปลายกรอบ'
export type ViFocusPhase = 'ต้น' | 'กลาง' | 'ปลาย'
export type ViHorizonKey = 'short' | 'medium' | 'long'
export type ViBestHorizon = 'สั้น' | 'กลาง' | 'ยาว'

export interface ViPhaseDetail {
  key: 'early' | 'mid' | 'late'
  title: string
  subtitle: string
  score: number
  verdict: string
  bullets: string[]
  action: string
}

export interface ViPhasedResult {
  early: ViPhaseDetail
  mid: ViPhaseDetail
  late: ViPhaseDetail
  priceZone: ViPriceZone | null
  priceZonePct: number | null
  currentFocus: ViFocusPhase
  recommendation: string
}

export interface ViHorizonDetail {
  key: ViHorizonKey
  title: string
  subtitle: string
  score: number
  verdict: string
  bullets: string[]
  action: string
}

export interface ViHorizonResult {
  short: ViHorizonDetail
  medium: ViHorizonDetail
  long: ViHorizonDetail
  bestHorizon: ViBestHorizon
  summary: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function metricValue(detail: ValueAnalysisDetail, label: string): number | null {
  const m = detail.metrics.find(x => x.label === label)
  if (!m) return null
  const n = parseFloat(m.value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function get52WeekPosition(ohlcv: OHLCV[], price: number | null): { pct: number; low: number; high: number } | null {
  const closes = ohlcv.map(d => d.close).filter(c => c > 0)
  if (closes.length < 30) return null
  const slice = closes.slice(-Math.min(252, closes.length))
  const high = Math.max(...slice)
  const low = Math.min(...slice)
  const current = price ?? closes[closes.length - 1]
  if (high <= low) return null
  return { pct: ((current - low) / (high - low)) * 100, low, high }
}

function priceZoneFromPct(pct: number): ViPriceZone {
  if (pct < 35) return 'ต้นกรอบ'
  if (pct > 65) return 'ปลายกรอบ'
  return 'กลางกรอบ'
}

function verdictFromScore(score: number): string {
  if (score >= 0.45) return 'เหมาะมาก'
  if (score >= 0.25) return 'น่าพิจารณา'
  if (score >= 0) return 'ปานกลาง'
  return 'ระวัง'
}

function valueVerdictFromScore(score: number): string {
  if (score >= 0.45) return 'คุ้มค่ามาก'
  if (score >= 0.25) return 'คุ้มค่าดี'
  if (score >= 0.05) return 'ปานกลาง'
  if (score >= -0.15) return 'คุ้มค่าน้อย'
  return 'ยังไม่คุ้ม'
}

function scoreEarlyPhase(symbol: string, detail: ValueAnalysisDetail): { score: number; bullets: string[] } {
  const bullets: string[] = []
  let total = 0
  let weight = 0

  if (isViFundSymbol(symbol)) {
    bullets.push('กองทุน/ETF — เน้นถือยาว กระจายความเสี่ยง')
    if (detail.styleLabel.includes('Bogle') || detail.styleLabel.includes('Index')) {
      total += 0.7; weight++
      bullets.push('ดัชนีต่ำค่าธรรมเนียม — เหมาะเป็นฐานพอร์ต VI')
    } else if (detail.styleLabel.includes('ปันผล') || detail.reasons.some(r => r.includes('ปันผล'))) {
      total += 0.65; weight++
      bullets.push('เน้นปันผล/คุณภาพ — เหมาะสาย income ระยะยาว')
    } else {
      total += 0.4; weight++
    }
    return { score: weight ? total / weight : 0.5, bullets }
  }

  if (isSuperinvestorSymbol(symbol)) {
    total += 0.4; weight++
    bullets.push('อยู่ในพอร์ตนักลงทุนชื่อดานระดับโลก (Buffett/13F overlap)')
  }
  if (isViStockSymbol(symbol)) {
    total += 0.35; weight++
    bullets.push('อยู่ในกลุ่มหุ้นคุณภาพ/ปันผล VI ไทย')
  }

  const roe = metricValue(detail, 'ROE')
  if (roe != null) {
    weight++
    if (roe >= 20) { total += 0.7; bullets.push(`ROE ${roe.toFixed(0)}% — ธุรกิจทำกำไรดี (แนว Buffett)`) }
    else if (roe >= 12) { total += 0.4; bullets.push(`ROE ${roe.toFixed(0)}% — คุณภาพปานกลาง`) }
    else { total += -0.1; bullets.push(`ROE ${roe.toFixed(0)}% — กำไรต่อทุนยังไม่แข็ง`) }
  }

  const dy = metricValue(detail, 'ปันผล')
  if (dy != null && dy > 0) {
    weight++
    if (dy >= 3) { total += 0.55; bullets.push(`ปันผล ${dy.toFixed(1)}% — สาย income/VI ชัดเจน`) }
    else { total += 0.2; bullets.push(`ปันผล ${dy.toFixed(1)}% — มีปันผลแต่ไม่ใช่โฟกัสหลัก`) }
  }

  if (detail.styleLabel.includes('Growth')) {
    bullets.push('สไตล์ Growth — VI ต้นผ่านได้ถ้าเชื่อมั่นคุณภาพ+โมโนโพลระยะยาว')
    total += 0.15; weight++
  } else if (detail.styleLabel.includes('Quality') || detail.styleLabel.includes('Value')) {
    bullets.push(`สไตล์ ${detail.styleLabel} — เข้าเกณฑ์ VI ต้น`)
    total += 0.35; weight++
  }

  if (!bullets.length) {
    bullets.push('ยังไม่มีข้อมูลพื้นฐานครบ — ดูจากกลุ่มอุตสาหกรรมและงบเพิ่ม')
  }

  return { score: weight ? clamp(total / weight, -1, 1) : 0.15, bullets }
}

function scoreMidPhase(detail: ValueAnalysisDetail, zone: ViPriceZone | null, zonePct: number | null, isFund: boolean): { score: number; bullets: string[] } {
  const bullets: string[] = []
  let total = 0
  let weight = 0

  const pe = metricValue(detail, 'P/E')
  if (pe != null) {
    weight++
    if (pe <= 0) { total += -0.3; bullets.push('P/E ติดลบ/ไม่มีกำไร — มูลค่ายากประเมิน') }
    else if (pe < 15) { total += 0.65; bullets.push(`P/E ${pe.toFixed(1)} — ราคาต่ำเทียบกำไร (margin of safety)`) }
    else if (pe < 25) { total += 0.35; bullets.push(`P/E ${pe.toFixed(1)} — สมเหตุสมผลปานกลาง`) }
    else if (pe < 35) { total += 0.05; bullets.push(`P/E ${pe.toFixed(1)} — ค่อนสูง ตลาดคาดหวังโต`) }
    else { total += -0.25; bullets.push(`P/E ${pe.toFixed(1)} — สูง ไม่ใช่ value คลาสสิก`) }
  }

  const pb = metricValue(detail, 'P/B')
  if (pb != null) {
    weight++
    if (pb < 1.5) { total += 0.55; bullets.push(`P/B ${pb.toFixed(2)} — ต่ำกว่ามูลคือบัญชี`) }
    else if (pb < 3) { total += 0.2; bullets.push(`P/B ${pb.toFixed(2)} — สมเหตุสมผล`) }
    else { total += -0.15; bullets.push(`P/B ${pb.toFixed(2)} — สูง ต้องพึ่งการเติบโต`) }
  }

  if (zone && zonePct != null) {
    weight++
    if (zone === 'ต้นกรอบ') {
      total += 0.6
      bullets.push(`ตำแหน่งราคา ${zonePct.toFixed(0)}% ของกรอบ 52 สัปดาห์ — ใกล้จุดต่ำ (MoS ดี)`)
    } else if (zone === 'กลางกรอบ') {
      total += 0.15
      bullets.push(`ตำแหน่งราคา ${zonePct.toFixed(0)}% ของกรอบ 52 สัปดาห์ — ไม่ถูก/แพงชัด`)
    } else {
      total -= 0.35
      bullets.push(`ตำแหน่งราคา ${zonePct.toFixed(0)}% ของกรอบ 52 สัปดาห์ — สูงในกรอบ รอ pullback`)
    }
  } else if (detail.marginOfSafetyNote) {
    bullets.push(detail.marginOfSafetyNote)
  }

  if (isFund) {
    total += 0.5; weight++
    bullets.push('กองทุนดัชนี — DCA ได้ทุกช่วง ไม่ต้องจับจังหวะมาก')
  }

  return { score: weight ? clamp(total / weight, -1, 1) : detail.score * 0.5, bullets }
}

function scoreLatePhase(
  technicalScore: number,
  indicators: IndicatorResult[],
  zone: ViPriceZone | null,
  sr: SupportResistanceLevels | null,
  price: number | null,
  symbol: string,
): { score: number; bullets: string[] } {
  const bullets: string[] = []
  let total = technicalScore
  let weight = 1

  const rsi = indicators.find(i => i.name.startsWith('RSI'))
  if (rsi) {
    const rsiVal = parseFloat(rsi.value) || 50
    if (rsiVal < 35) { bullets.push(`RSI ${rsiVal.toFixed(0)} — oversold จังหวะสะสมดี`) }
    else if (rsiVal > 65) { bullets.push(`RSI ${rsiVal.toFixed(0)} — overbought ระวังย่อ`) ; total -= 0.15 }
    else { bullets.push(`RSI ${rsiVal.toFixed(0)} — กลางๆ ยังไม่ชัด`) }
  }

  const macd = indicators.find(i => i.name.startsWith('MACD'))
  if (macd?.signal === 'BULLISH') {
    bullets.push('MACD bullish — โมเมนตัมขาขึ้น')
    total += 0.1
  } else if (macd?.signal === 'BEARISH') {
    bullets.push('MACD bearish — รอสัญญาณกลับตัว')
    total -= 0.1
  }

  const sma = indicators.find(i => i.name.includes('SMA'))
  if (sma?.signal === 'BULLISH') bullets.push('ราคาอยู่เหนือแนวโน้ม — แรงซื้อดี')
  else if (sma?.signal === 'BEARISH') bullets.push('ราคาอยู่ใต้แนวโน้ม — รอฟื้น')

  if (sr && price != null) {
    const distToSupport = (price - sr.support1) / price
    const distToResist = (sr.resistance1 - price) / price
    if (distToSupport < 0.03) {
      bullets.push(`ใกล้แนวรับ ${formatAssetPrice(symbol, sr.support1)} — จุดสะสมตาม VI`)
      total += 0.15
    } else if (distToResist < 0.03) {
      bullets.push(`ใกล้แนวต้าน ${formatAssetPrice(symbol, sr.resistance1)} — ระวัง take profit`)
      total -= 0.1
    }
  }

  if (zone === 'ปลายกรอบ') {
    bullets.push('ราคาปลายกรอบ — VI ปลายเน้น รอ/ลด มากกว่าไล่ซื้อ')
    total -= 0.1
  } else if (zone === 'ต้นกรอบ') {
    bullets.push('ราคาต้นกรอบ + สัญญาณเทคนิคดี = จังหวะสะสม')
    total += 0.1
  }

  if (!bullets.length) {
    bullets.push(`คะแนนเทคนิครวม ${formatScorePct(technicalScore)}/100`)
  }

  return { score: clamp(total / weight, -1, 1), bullets }
}

function earlyAction(score: number, isFund: boolean): string {
  if (isFund) return score >= 0.35 ? 'เหมาะเป็นฐานพอร์ต VI — สะสม DCA ได้' : 'เลือกกองทุนดัชนี/ปันผลคุณภาพก่อน'
  if (score >= 0.45) return 'ธุรกิจผ่านเกณฑ์ VI ต้น — ใส่ใน watchlist ระยะยาว'
  if (score >= 0.2) return 'คุณภาพพอใช้ — ศึกษางบ/โมเดลธุรกิจเพิ่มก่อนถือยาว'
  return 'คุณภาพยังไม่ชัด — ไม่เหมาะเป็นหุ้นหลัก VI'
}

function midAction(score: number, zone: ViPriceZone | null, isFund: boolean): string {
  if (isFund) return 'กองทุน VI กลาง — ซื้อสม่ำเสมอ ไม่ต้องรอราคาถูกมาก'
  if (score >= 0.4 && zone === 'ต้นกรอบ') return 'มูลค่าดี + ราคาต้นกรอบ — เหมาะเริ่มสะสม'
  if (score >= 0.25) return 'ราคายังรับได้ — แบ่งซื้อไม่ all-in'
  if (zone === 'ปลายกรอบ') return 'ราคาสูงในกรอบ — VI รอ pullback หรือซื้อบางส่วน'
  return 'มูลค่ายังไม่โดด — รอราคาดีกว่านี้'
}

function lateAction(score: number, zone: ViPriceZone | null): string {
  if (score >= 0.35 && zone !== 'ปลายกรอบ') return '🟢 จังหวะลงมือ: สะสม/เพิ่มได้ (แบ่งซื้อ)'
  if (score >= 0.35 && zone === 'ปลายกรอบ') return '🟡 สัญญาณดีแต่ราคาสูง — ซื้อน้อยหรือรอ pullback'
  if (score >= 0) return '🟡 ถือได้ แต่ยังไม่ใช่จังหวะ aggressive'
  return '🔴 รอสัญญาณเทคนิคดีขึ้น / รอแนวรับ'
}

function inferCurrentFocus(early: number, mid: number, late: number, zone: ViPriceZone | null): ViFocusPhase {
  if (early < 0.15) return 'ต้น'
  if (zone === 'ปลายกรอบ' || late < 0) return 'ปลาย'
  if (zone === 'ต้นกรอบ' && mid >= 0.25) return 'กลาง'
  const scores = [
    { phase: 'ต้น' as const, s: early },
    { phase: 'กลาง' as const, s: mid },
    { phase: 'ปลาย' as const, s: late },
  ]
  scores.sort((a, b) => b.s - a.s)
  const weakest = scores[2]
  if (weakest.s < 0.1) return weakest.phase
  return scores.find(x => x.s === Math.min(early, mid, late))?.phase ?? 'กลาง'
}

function buildRecommendation(early: ViPhaseDetail, mid: ViPhaseDetail, late: ViPhaseDetail, focus: ViFocusPhase, zone: ViPriceZone | null): string {
  const parts: string[] = []
  parts.push(`โฟกัสตอนนี้: VI ${focus}`)
  if (zone) parts.push(`ตำแหน่งราคา: ${zone}`)
  if (early.score >= 0.35 && mid.score >= 0.3 && late.score >= 0.35) {
    parts.push('ภาพรวม: ผ่านครบ 3 ชั้น — เหมาะสะสมระยะยาว')
  } else if (early.score >= 0.35 && mid.score < 0.2) {
    parts.push('ภาพรวม: ธุรกิจดี แต่ราคายังแพง — รอ VI กลาง')
  } else if (early.score < 0.2) {
    parts.push('ภาพรวม: ยังไม่ผ่าน VI ต้น — ไม่แนะนำเป็นหุ้นหลัก')
  } else if (late.score < 0) {
    parts.push('ภาพรวม: รอจังหวะ VI ปลายดีขึ้น')
  } else {
    parts.push('ภาพรวม: ผ่านบางส่วน — แบ่งซื้อไม่ all-in')
  }
  return parts.join(' | ')
}

export function computeViPhases(params: {
  symbol: string
  valueDetail: ValueAnalysisDetail
  technicalScore: number
  price: number | null
  ohlcv?: OHLCV[]
  supportResistance?: SupportResistanceLevels | null
  indicators?: IndicatorResult[]
}): ViPhasedResult {
  const { symbol, valueDetail, technicalScore, price, ohlcv, supportResistance, indicators = [] } = params
  const isFund = isViFundSymbol(symbol) || valueDetail.metrics.some(m => m.label === 'ประเภท')

  const range = ohlcv?.length ? get52WeekPosition(ohlcv, price) : null
  const zone = range ? priceZoneFromPct(range.pct) : null
  const zonePct = range?.pct ?? null

  const earlyRaw = scoreEarlyPhase(symbol, valueDetail)
  const midRaw = scoreMidPhase(valueDetail, zone, zonePct, isFund)
  const lateRaw = scoreLatePhase(technicalScore, indicators, zone, supportResistance ?? null, price, symbol)

  const early: ViPhaseDetail = {
    key: 'early',
    title: '🌱 VI ต้น — คุณภาพธุรกิจ',
    subtitle: 'ธุรกิจดีไหม ถือยาวได้ไหม (Buffett: Quality)',
    score: earlyRaw.score,
    verdict: verdictFromScore(earlyRaw.score),
    bullets: earlyRaw.bullets,
    action: earlyAction(earlyRaw.score, isFund),
  }

  const mid: ViPhaseDetail = {
    key: 'mid',
    title: '⚖️ VI กลาง — มูลค่าราคา',
    subtitle: 'ราคาสมเหตุสมผลไหม (Graham: Margin of Safety)',
    score: midRaw.score,
    verdict: verdictFromScore(midRaw.score),
    bullets: midRaw.bullets,
    action: midAction(midRaw.score, zone, isFund),
  }

  const late: ViPhaseDetail = {
    key: 'late',
    title: '🎯 VI ปลาย — จังหวะลงมือ',
    subtitle: 'ตอนนี้ควรซื้อ/ถือ/ลดไหม (Timing + แนวรับต้าน)',
    score: lateRaw.score,
    verdict: verdictFromScore(lateRaw.score),
    bullets: lateRaw.bullets,
    action: lateAction(lateRaw.score, zone),
  }

  const currentFocus = inferCurrentFocus(early.score, mid.score, late.score, zone)
  const recommendation = buildRecommendation(early, mid, late, currentFocus, zone)

  return { early, mid, late, priceZone: zone, priceZonePct: zonePct, currentFocus, recommendation }
}

function scoreShortHorizon(
  technicalScore: number,
  phases: ViPhasedResult,
  indicators: IndicatorResult[],
  changePct: number | null,
  sr: SupportResistanceLevels | null,
  price: number | null,
  symbol: string,
): { score: number; bullets: string[] } {
  const bullets: string[] = []
  let total = technicalScore * 0.45 + phases.late.score * 0.35
  let weight = 0.8

  const rsi = indicators.find(i => i.name.startsWith('RSI'))
  if (rsi) {
    const rsiVal = parseFloat(rsi.value) || 50
    weight += 0.15
    if (rsiVal < 35) { total += 0.2; bullets.push(`RSI ${rsiVal.toFixed(0)} oversold — bounce สั้นมีโอกาส`) }
    else if (rsiVal > 65) { total -= 0.2; bullets.push(`RSI ${rsiVal.toFixed(0)} overbought — ระยะสั้นเสี่ยงย่อ`) }
    else { bullets.push(`RSI ${rsiVal.toFixed(0)} — ยังไม่ชัดสำหรับเก็งสั้น`) }
  } else {
    bullets.push(`เทคนิครวม ${formatScorePct(technicalScore)}/100 — ใช้เป็นตัวชี้จังหวะสั้น`)
  }

  if (sr && price != null) {
    const distToSupport = (price - sr.support1) / price
    const distToResist = (sr.resistance1 - price) / price
    if (distToSupport < 0.04) {
      weight += 0.1; total += 0.15
      bullets.push(`ใกล้แนวรับ ${formatAssetPrice(symbol, sr.support1)} — จุดเก็งสั้น/สวนเทรนด์`)
    } else if (distToResist < 0.04) {
      weight += 0.1; total -= 0.15
      bullets.push(`ใกล้แนวต้าน ${formatAssetPrice(symbol, sr.resistance1)} — ระยะสั้น take profit ดีกว่าไล่ซื้อ`)
    }
  }

  if (phases.priceZone === 'ต้นกรอบ') {
    weight += 0.05; total += 0.1
    bullets.push('ราคาต้นกรอบ — สวนกลับระยะสั้นมี margin')
  } else if (phases.priceZone === 'ปลายกรอบ') {
    weight += 0.05; total -= 0.12
    bullets.push('ราคาปลายกรอบ — ระยะสั้นไม่คุ้มไล่ซื้อ')
  }

  if (changePct != null) {
    if (changePct <= -2.5) bullets.push(`วันนี้ลง ${changePct.toFixed(1)}% — อาจมี dead-cat bounce แต่ระวัง downtrend`)
    else if (changePct >= 2.5) bullets.push(`วันนี้ขึ้น ${changePct.toFixed(1)}% — ระยะสั้นระวัง profit-taking`)
  }

  const macd = indicators.find(i => i.name.startsWith('MACD'))
  if (macd?.signal === 'BULLISH') { total += 0.08; bullets.push('MACD bullish — โมเมนตัมสั้นขาขึ้น') }
  else if (macd?.signal === 'BEARISH') { total -= 0.08; bullets.push('MACD bearish — รอสัญญาณกลับตัวก่อนเก็งสั้น') }

  if (!bullets.length) bullets.push('ดูจากเทคนิค + แนวรับต้านเป็นหลัก')

  return { score: clamp(total / weight, -1, 1), bullets }
}

function scoreMediumHorizon(
  phases: ViPhasedResult,
  technicalScore: number,
  isFund: boolean,
): { score: number; bullets: string[] } {
  const bullets: string[] = []
  let total = phases.mid.score * 0.4 + phases.early.score * 0.25 + technicalScore * 0.2
  let weight = 0.85

  if (isFund) {
    total += 0.35; weight += 0.15
    bullets.push('กองทุน/ETF — DCA ระยะกลางเหมาะกว่าจับจังหวะ')
  }

  if (phases.priceZone === 'ต้นกรอบ' && phases.mid.score >= 0.2) {
    total += 0.15; weight += 0.1
    bullets.push('ราคาต้นกรอบ + มูลค่าพอใช้ — สะสมระยะกลางน่าสนใจ')
  } else if (phases.priceZone === 'กลางกรอบ') {
    bullets.push('ราคากลางกรอบ — แบ่งซื้อระยะกลางได้ ไม่ต้องรอถูกมาก')
  } else if (phases.priceZone === 'ปลายกรอบ') {
    total -= 0.15; weight += 0.05
    bullets.push('ราคาปลายกรอบ — ระยะกลางควรรอ pullback หรือซื้อบางส่วน')
  }

  if (phases.early.score >= 0.35) bullets.push('ธุรกิจผ่าน VI — ถือกลางได้ถ้าราคาไม่แพงเกิน')
  else if (phases.early.score < 0.15) {
    total -= 0.2
    bullets.push('คุณภาพธุรกิจยังไม่แข็ง — ระยะกลางเสี่ยง')
  }

  if (phases.mid.score >= 0.3) bullets.push(`มูลค่า VI กลาง ${formatScorePct(phases.mid.score)}/100 — ราคายังรับได้`)
  else bullets.push(`มูลค่า VI กลาง ${formatScorePct(phases.mid.score)}/100 — รอราคาดีกว่านี้`)

  return { score: clamp(total / weight, -1, 1), bullets }
}

function scoreLongHorizon(
  symbol: string,
  phases: ViPhasedResult,
  valueDetail: ValueAnalysisDetail,
  isFund: boolean,
): { score: number; bullets: string[] } {
  const bullets: string[] = []
  let total = phases.early.score * 0.5 + phases.mid.score * 0.35
  let weight = 0.85

  if (isFund) {
    total += 0.45; weight += 0.15
    bullets.push('กองทุนดัชนี/ปันผล — ถือยาวเป็นฐานพอร์ต VI คลาสสิก')
  }

  if (isSuperinvestorSymbol(symbol)) {
    total += 0.15; weight += 0.1
    bullets.push('นักลงทุนชื่อดานถือระยะยาว — สัญญาณคุณภาพระยะยาว')
  }
  if (isViStockSymbol(symbol)) {
    total += 0.1; weight += 0.05
    bullets.push('อยู่ในกลุ่มหุ้น VI ไทย — เหมาะเป็นหลักพอร์ตยาว')
  }

  if (phases.early.score >= 0.4 && phases.mid.score >= 0.25) {
    total += 0.12
    bullets.push('ผ่านทั้งคุณภาพ + มูลค่า — ถือยาวคุ้มที่สุด')
  } else if (phases.early.score >= 0.35 && phases.mid.score < 0.2) {
    bullets.push('ธุรกิจดีแต่ราคาแพง — ถือยาวได้ถ้าเชื่อมั่น แต่ DCA ดีกว่า lump sum')
  } else if (phases.early.score < 0.2) {
    total -= 0.25
    bullets.push('ยังไม่ผ่าน VI ต้น — ไม่เหมาะเป็นหุ้นหลักระยะยาว')
  }

  if (valueDetail.styleLabel.includes('Quality') || valueDetail.styleLabel.includes('Value')) {
    bullets.push(`สไตล์ ${valueDetail.styleLabel} — เข้ากับถือยาว`)
  }

  const dy = metricValue(valueDetail, 'ปันผล')
  if (dy != null && dy >= 2.5) {
    total += 0.1; weight += 0.05
    bullets.push(`ปันผล ${dy.toFixed(1)}% — income ระยะยาวช่วยลดความผันผวน`)
  }

  return { score: clamp(total / weight, -1, 1), bullets }
}

function shortHorizonAction(score: number, zone: ViPriceZone | null): string {
  if (score >= 0.4 && zone !== 'ปลายกรอบ') return 'เหมาะเก็งกำไรสั้น / swing ใกล้แนวรับ'
  if (score >= 0.25) return 'เก็งสั้นได้บางส่วน — ตั้ง stop-loss ชัดเจน'
  if (score >= 0) return 'ระยะสั้นปานกลาง — รอสัญญาณชัดกว่านี้'
  return 'ไม่คุ้มระยะสั้น — หลีกเลี่ยงเก็งกำไรเร็ว'
}

function mediumHorizonAction(score: number, zone: ViPriceZone | null, isFund: boolean): string {
  if (isFund) return 'เหมาะ DCA ระยะกลาง — ซื้อสม่ำเสมอทุกเดือน/ไตรมาส'
  if (score >= 0.4 && zone === 'ต้นกรอบ') return 'คุ้มสะสมระยะกลาง — เริ่มแบ่งซื้อได้'
  if (score >= 0.3) return 'น่าถือระยะกลาง — แบ่งซื้อ ไม่ all-in'
  if (zone === 'ปลายกรอบ') return 'ราคาสูง — ระยะกลางรอ pullback หรือซื้อน้อยๆ'
  return 'ยังไม่คุ้มระยะกลางชัด — รอมูลค่าดีขึ้น'
}

function longHorizonAction(score: number, isFund: boolean): string {
  if (isFund) return 'เหมาะถือยาวเป็นหลักพอร์ต — ลดความเสี่ยงด้วย diversification'
  if (score >= 0.45) return 'คุ้มถือยาว — เป็นหุ้นหลัก VI ได้'
  if (score >= 0.28) return 'ถือยาวได้ถ้าเชื่อมั่นธุรกิจ — เน้น DCA'
  if (score >= 0.1) return 'ถือยาวได้บางส่วน — ไม่ควรเป็นตัวใหญ่ในพอร์ต'
  return 'ยังไม่คุ้มถือยาว — หาโอกาสอื่นที่ผ่าน VI ต้น+กลาง'
}

function inferBestHorizon(short: number, medium: number, long: number): ViBestHorizon {
  const scores = [
    { h: 'สั้น' as const, s: short },
    { h: 'กลาง' as const, s: medium },
    { h: 'ยาว' as const, s: long },
  ]
  scores.sort((a, b) => b.s - a.s)
  return scores[0].h
}

function buildHorizonSummary(short: ViHorizonDetail, medium: ViHorizonDetail, long: ViHorizonDetail, best: ViBestHorizon): string {
  const parts: string[] = [`เหมาะสุด: ถือ${best}`]
  if (long.score >= 0.35 && short.score < 0.15) {
    parts.push('ภาพรวม: เน้นถือยาว ไม่เหมาะเก็งสั้น')
  } else if (short.score >= 0.35 && long.score < 0.25) {
    parts.push('ภาพรวม: จังหวะสั้นดีกว่า แต่คุณภาพระยะยาวยังไม่ชัด')
  } else if (short.score >= 0.3 && medium.score >= 0.3 && long.score >= 0.3) {
    parts.push('ภาพรวม: คุ้มค่าทุกช่วง — ยืดหยุ่นได้ตามสไตล์')
  } else if (medium.score >= long.score && medium.score >= short.score) {
    parts.push('ภาพรวม: sweet spot อยู่ที่ระยะกลาง')
  } else {
    parts.push(`สั้น ${valueVerdictFromScore(short.score)} | กลาง ${valueVerdictFromScore(medium.score)} | ยาว ${valueVerdictFromScore(long.score)}`)
  }
  return parts.join(' | ')
}

export function computeViHorizons(params: {
  symbol: string
  valueDetail: ValueAnalysisDetail
  technicalScore: number
  price: number | null
  changePct?: number | null
  supportResistance?: SupportResistanceLevels | null
  indicators?: IndicatorResult[]
  phases?: ViPhasedResult
}): ViHorizonResult {
  const {
    symbol,
    valueDetail,
    technicalScore,
    price,
    changePct = null,
    supportResistance,
    indicators = [],
    phases: phasesIn,
  } = params

  const isFund = isViFundSymbol(symbol) || valueDetail.metrics.some(m => m.label === 'ประเภท')
  const phases = phasesIn ?? computeViPhases({
    symbol,
    valueDetail,
    technicalScore,
    price,
    ohlcv: undefined,
    supportResistance,
    indicators,
  })

  const shortRaw = scoreShortHorizon(technicalScore, phases, indicators, changePct, supportResistance ?? null, price, symbol)
  const mediumRaw = scoreMediumHorizon(phases, technicalScore, isFund)
  const longRaw = scoreLongHorizon(symbol, phases, valueDetail, isFund)

  const short: ViHorizonDetail = {
    key: 'short',
    title: '⚡ VI ระยะสั้น (1–3 เดือน)',
    subtitle: 'ความคุ้มค่าเก็งกำไรสั้น / swing ตามเทคนิค',
    score: shortRaw.score,
    verdict: valueVerdictFromScore(shortRaw.score),
    bullets: shortRaw.bullets,
    action: shortHorizonAction(shortRaw.score, phases.priceZone),
  }

  const medium: ViHorizonDetail = {
    key: 'medium',
    title: '📅 VI ระยะกลาง (6–18 เดือน)',
    subtitle: 'ความคุ้มค่าสะสมกลาง — มูลค่า + แนวโน้ม',
    score: mediumRaw.score,
    verdict: valueVerdictFromScore(mediumRaw.score),
    bullets: mediumRaw.bullets,
    action: mediumHorizonAction(mediumRaw.score, phases.priceZone, isFund),
  }

  const long: ViHorizonDetail = {
    key: 'long',
    title: '🏛️ VI ระยะยาว (3 ปี+)',
    subtitle: 'ความคุ้มค่าถือยาว — คุณภาพธุรกิจ + MoS',
    score: longRaw.score,
    verdict: valueVerdictFromScore(longRaw.score),
    bullets: longRaw.bullets,
    action: longHorizonAction(longRaw.score, isFund),
  }

  const bestHorizon = inferBestHorizon(short.score, medium.score, long.score)
  const summary = buildHorizonSummary(short, medium, long, bestHorizon)

  return { short, medium, long, bestHorizon, summary }
}

export function formatViHorizonBlock(horizon: ViHorizonDetail): string {
  return [
    horizon.title,
    horizon.subtitle,
    `ความคุ้มค่า: ${formatScorePct(horizon.score)}/100 | ${horizon.verdict}`,
    ...horizon.bullets.map(b => `• ${b}`),
    `→ ${horizon.action}`,
  ].join('\n')
}

export function formatViHorizonsSection(horizons: ViHorizonResult): string {
  return [
    '━━━━━━━━━━━━━━━━━━━━',
    formatViHorizonBlock(horizons.short),
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    formatViHorizonBlock(horizons.medium),
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    formatViHorizonBlock(horizons.long),
    '',
    '📌 สรุปความคุ้มค่าตามเวลา',
    horizons.summary,
    `เหมาะสุด: ถือ${horizons.bestHorizon}`,
  ].join('\n')
}

export function formatViHorizonsCompact(horizons: ViHorizonResult): string {
  return `คุ้มค่า สั้น ${formatScorePct(horizons.short.score)} | กลาง ${formatScorePct(horizons.medium.score)} | ยาว ${formatScorePct(horizons.long.score)} | เหมาะ:${horizons.bestHorizon}`
}

export function formatViPhaseBlock(phase: ViPhaseDetail): string {
  return [
    phase.title,
    phase.subtitle,
    `คะแนน: ${formatScorePct(phase.score)}/100 | ${phase.verdict}`,
    ...phase.bullets.map(b => `• ${b}`),
    `→ ${phase.action}`,
  ].join('\n')
}

export function formatViPhasesSection(phases: ViPhasedResult): string {
  const zoneLine = phases.priceZone
    ? `📍 ตำแหน่งราคาในกรอบ 52 สัปดาห์: ${phases.priceZone}${phases.priceZonePct != null ? ` (${phases.priceZonePct.toFixed(0)}%)` : ''}`
    : ''

  return [
    '━━━━━━━━━━━━━━━━━━━━',
    formatViPhaseBlock(phases.early),
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    formatViPhaseBlock(phases.mid),
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    formatViPhaseBlock(phases.late),
    '',
    '📌 สรุป 3 ชั้น VI',
    phases.recommendation,
    zoneLine,
  ].filter(Boolean).join('\n')
}

export function formatViPhasesCompact(phases: ViPhasedResult): string {
  return `VI ต้น ${formatScorePct(phases.early.score)} | กลาง ${formatScorePct(phases.mid.score)} | ปลาย ${formatScorePct(phases.late.score)} | โฟกัส:${phases.currentFocus}${phases.priceZone ? ` | ${phases.priceZone}` : ''}`
}
