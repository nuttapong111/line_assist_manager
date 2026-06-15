# Price Alert & AI Signal Analysis Spec
## docs/price-alert-spec.md

---

## ⚠️ ข้อจำกัดที่ต้อง hard-code ไว้ในระบบทุกที่

```
ระบบนี้คือ "personal technical analysis research tool" เท่านั้น
ทุก output ต้องมี disclaimer นี้เสมอ:
"วิเคราะห์จาก technical indicators เท่านั้น ไม่ใช่คำแนะนำการลงทุน
 อัตราความถูกต้องของ technical analysis อยู่ที่ 55–65% ใช้ประกอบการตัดสินใจของตัวเองเท่านั้น"

ห้ามใช้คำ: "แนะนำให้ซื้อ" "ควรซื้อตอนนี้" "น่าจะขึ้น" "รับประกัน" "แน่ใจว่า"
ใช้คำเหล่านี้แทน: "สัญญาณซื้อ" "indicator ชี้" "pattern ในอดีตเคย..." "ควรพิจารณา"
```

---

## Data Source

```typescript
// Yahoo Finance — ฟรี ไม่ต้อง API key
// ดึง OHLCV data แล้วคำนวณ indicators เองใน backend

// Symbol mapping
const SYMBOL_MAP: Record<string, string> = {
  // หุ้นไทย
  'PTT':'PTT.BK', 'SCB':'SCB.BK', 'AOT':'AOT.BK',
  'ADVANC':'ADVANC.BK', 'KBANK':'KBANK.BK',
  // หุ้น US
  'NVDA':'NVDA', 'AAPL':'AAPL', 'MSFT':'MSFT', 'TSLA':'TSLA',
  // ทอง
  'GOLD':'GC=F', 'XAUUSD':'XAUUSD=X',
  // กองทุน
  'KFSDIV':'KFSDIV-A.BK',
}

// timeframe ที่รองรับ
type Timeframe = '1d' | '1wk' | '1mo'

// ดึง OHLCV หลาย candle สำหรับคำนวณ indicators
async function fetchOHLCV(symbol: string, interval: Timeframe, count = 200): Promise<OHLCV[]>
```

---

## Indicators ที่ใช้ (คำนวณเองจาก OHLCV)

```typescript
// backend/src/services/technicals.service.ts
// ใช้ library: technicalindicators (npm i technicalindicators)

import TI from 'technicalindicators'

export interface IndicatorResult {
  name:    string           // 'MACD' | 'RSI' | 'BB' | 'EMA50' | 'EMA200' | 'VOLUME'
  signal:  'BULLISH' | 'BEARISH' | 'NEUTRAL'
  score:   number           // contribution ต่อ total score
  value:   string           // human-readable value เช่น "MACD: −0.18"
  reason:  string           // อธิบายว่าทำไม — ภาษาไทย 1-2 ประโยค
  weight:  number           // น้ำหนักใน total score (0-3)
}

// คำนวณ MACD (12, 26, 9)
export function calcMACD(closes: number[]): IndicatorResult {
  const result = TI.MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false
  })
  const last = result[result.length - 1]
  const prev = result[result.length - 2]

  const crossedUp   = prev.histogram <= 0 && last.histogram > 0
  const crossedDown = prev.histogram >= 0 && last.histogram < 0
  const histGrowing = last.histogram > prev.histogram

  let signal: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL'
  let score = 0
  let reason = ''

  if (crossedUp) {
    signal = 'BULLISH'; score = 2.5
    reason = `MACD line ตัดขึ้นผ่าน signal line (bullish crossover) histogram เปลี่ยนเป็นบวกครั้งแรกใน ${countNegStreak(result)} ช่วง`
  } else if (crossedDown) {
    signal = 'BEARISH'; score = -2.5
    reason = `MACD line ตัดลงผ่าน signal line (bearish crossover) — momentum เปลี่ยนทิศ`
  } else if (last.histogram > 0 && histGrowing) {
    signal = 'BULLISH'; score = 1.0
    reason = `MACD histogram เป็นบวกและยังโต — แรงซื้อยังมีอยู่`
  } else if (last.histogram < 0 && !histGrowing) {
    signal = 'BEARISH'; score = -1.0
    reason = `MACD histogram เป็นลบและยังลด — แรงขายยังหนักอยู่`
  } else {
    reason = `MACD ยังไม่ให้สัญญาณชัดเจน histogram: ${last.histogram?.toFixed(3)}`
  }

  return {
    name: 'MACD (12,26,9)', signal, score,
    value: `MACD: ${last.MACD?.toFixed(3)} · Signal: ${last.signal?.toFixed(3)} · Hist: ${last.histogram?.toFixed(3)}`,
    reason, weight: 2.5
  }
}

// คำนวณ RSI (14)
export function calcRSI(closes: number[]): IndicatorResult {
  const result = TI.RSI.calculate({ values: closes, period: 14 })
  const rsi  = result[result.length - 1]
  const prev = result[result.length - 2]

  let signal: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL'
  let score = 0; let reason = ''

  if (prev < 30 && rsi >= 30) {
    signal = 'BULLISH'; score = 2.0
    reason = `RSI เพิ่งเด้งออกจาก oversold zone (${prev.toFixed(1)} → ${rsi.toFixed(1)}) — pattern นี้ในอดีตมักตามด้วยการ bounce`
  } else if (rsi < 30) {
    signal = 'BULLISH'; score = 1.5
    reason = `RSI อยู่ใน oversold zone (${rsi.toFixed(1)}) — แรงขายมากเกินไป อาจเด้งระยะสั้น`
  } else if (prev > 70 && rsi <= 70) {
    signal = 'BEARISH'; score = -2.0
    reason = `RSI เพิ่งออกจาก overbought zone (${prev.toFixed(1)} → ${rsi.toFixed(1)}) — สัญญาณแรงซื้อลดลง`
  } else if (rsi > 70) {
    signal = 'BEARISH'; score = -1.5
    reason = `RSI อยู่ใน overbought zone (${rsi.toFixed(1)}) — ราคาขึ้นเร็วเกินไป เสี่ยง correction`
  } else {
    reason = `RSI อยู่ที่ ${rsi.toFixed(1)} ยังไม่เข้า overbought/oversold zone`
  }

  return { name: 'RSI (14)', signal, score, value: `${rsi.toFixed(1)}`, reason, weight: 2.0 }
}

// คำนวณ Bollinger Bands (20, 2)
export function calcBollinger(closes: number[]): IndicatorResult {
  const result = TI.BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 })
  const last  = result[result.length - 1]
  const price = closes[closes.length - 1]
  const pctB  = (price - last.lower) / (last.upper - last.lower)

  let signal: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL'
  let score = 0; let reason = ''

  if (price <= last.lower) {
    signal = 'BULLISH'; score = 1.5
    reason = `ราคาแตะหรือต่ำกว่า lower band — บ่งชี้ว่าราคา oversold ตาม Bollinger ควรระวัง false breakout`
  } else if (price >= last.upper) {
    signal = 'BEARISH'; score = -1.5
    reason = `ราคาแตะหรือสูงกว่า upper band — อาจ overbought ตาม Bollinger อาจมี pullback`
  } else if (pctB < 0.2) {
    signal = 'BULLISH'; score = 0.8
    reason = `ราคาใกล้ lower band (${(pctB*100).toFixed(0)}% ของ band) — อยู่ในโซนที่มักเด้งกลับ`
  } else if (pctB > 0.8) {
    signal = 'BEARISH'; score = -0.8
    reason = `ราคาใกล้ upper band (${(pctB*100).toFixed(0)}% ของ band) — อาจเริ่ม cool down`
  } else {
    reason = `ราคาอยู่กลาง band (${(pctB*100).toFixed(0)}%) ยังไม่ให้สัญญาณ extreme`
  }

  return {
    name: 'Bollinger Bands (20,2)', signal, score,
    value: `Upper: ${last.upper.toFixed(2)} · Mid: ${last.middle.toFixed(2)} · Lower: ${last.lower.toFixed(2)}`,
    reason, weight: 1.5
  }
}

// คำนวณ EMA 50 / 200
export function calcEMA(closes: number[]): IndicatorResult {
  const ema50  = TI.EMA.calculate({ period: 50,  values: closes })
  const ema200 = TI.EMA.calculate({ period: 200, values: closes })
  const price  = closes[closes.length - 1]
  const e50    = ema50[ema50.length - 1]
  const e200   = ema200[ema200.length - 1]

  const aboveBoth = price > e50 && price > e200
  const belowBoth = price < e50 && price < e200
  const goldenCross = ema50[ema50.length-2] <= ema200[ema200.length-2] && e50 > e200
  const deathCross  = ema50[ema50.length-2] >= ema200[ema200.length-2] && e50 < e200

  let signal: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL'
  let score = 0; let reason = ''

  if (goldenCross) {
    signal = 'BULLISH'; score = 2.0
    reason = `EMA50 เพิ่งตัดขึ้น EMA200 (Golden Cross) — สัญญาณ bullish ระยะยาวที่แข็งแกร่งที่สุด`
  } else if (deathCross) {
    signal = 'BEARISH'; score = -2.0
    reason = `EMA50 เพิ่งตัดลง EMA200 (Death Cross) — สัญญาณ bearish ระยะยาว`
  } else if (aboveBoth) {
    signal = 'BULLISH'; score = 1.0
    reason = `ราคาอยู่เหนือ EMA50 (${e50.toFixed(2)}) และ EMA200 (${e200.toFixed(2)}) — uptrend ทั้งระยะกลางและยาว`
  } else if (belowBoth) {
    signal = 'BEARISH'; score = -1.0
    reason = `ราคาอยู่ต่ำกว่า EMA50 (${e50.toFixed(2)}) และ EMA200 (${e200.toFixed(2)}) — downtrend ทั้งระยะกลางและยาว`
  } else {
    reason = `ราคาอยู่ระหว่าง EMA50/200 — อยู่ในช่วงเปลี่ยนทิศ`
  }

  return {
    name: 'EMA 50 / EMA 200', signal, score,
    value: `EMA50: ${e50.toFixed(2)} · EMA200: ${e200.toFixed(2)}`,
    reason, weight: 2.0
  }
}

// Volume analysis
export function calcVolume(volumes: number[], closes: number[]): IndicatorResult {
  const avg20 = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20
  const today  = volumes[volumes.length - 1]
  const pct    = ((today - avg20) / avg20) * 100
  const priceUp = closes[closes.length-1] > closes[closes.length-2]

  let signal: 'BULLISH'|'BEARISH'|'NEUTRAL' = 'NEUTRAL'
  let score = 0; let reason = ''

  if (pct > 50 && priceUp) {
    signal = 'BULLISH'; score = 1.5
    reason = `Volume สูงกว่าค่าเฉลี่ย ${pct.toFixed(0)}% ขณะราคาขึ้น — แสดงว่ามีแรงซื้อจริง`
  } else if (pct > 50 && !priceUp) {
    signal = 'BEARISH'; score = -1.5
    reason = `Volume สูงกว่าค่าเฉลี่ย ${pct.toFixed(0)}% ขณะราคาลง — selling pressure แรง`
  } else if (pct > 30 && priceUp) {
    signal = 'BULLISH'; score = 0.8
    reason = `Volume สูงกว่าเฉลี่ย ${pct.toFixed(0)}% ราคาขึ้น — momentum น่าเชื่อถือ`
  } else if (pct < -30) {
    reason = `Volume ต่ำกว่าเฉลี่ย ${Math.abs(pct).toFixed(0)}% — การเคลื่อนไหวราคาอาจไม่ sustainable`
  } else {
    reason = `Volume อยู่ในระดับปกติ (${pct > 0 ? '+' : ''}${pct.toFixed(0)}% จากเฉลี่ย)`
  }

  return {
    name: 'Volume', signal, score,
    value: `วันนี้: ${(today/1e6).toFixed(1)}M · เฉลี่ย: ${(avg20/1e6).toFixed(1)}M`,
    reason, weight: 1.5
  }
}

function countNegStreak(macdArr: any[]): number {
  let n = 0
  for (let i = macdArr.length - 2; i >= 0; i--) {
    if (macdArr[i].histogram < 0) n++; else break
  }
  return n
}
```

---

## Signal Aggregator — รวม indicators เป็น score เดียว

```typescript
// backend/src/services/signal.service.ts

export interface SignalSummary {
  symbol:      string
  timeframe:   string
  overall:     'BULLISH' | 'BEARISH' | 'NEUTRAL'
  score:       number           // 0–10
  confidence:  string           // '7/10'
  price:       number
  support:     number
  resistance:  number
  stopLoss:    number
  indicators:  IndicatorResult[]
  explanation: string           // AI-generated — paragraph ภาษาไทย
  considerations: string[]      // ควรพิจารณาเพิ่มเติม
  generatedAt: string
}

export async function analyzeSignal(symbol: string, timeframe: Timeframe): Promise<SignalSummary> {
  // 1. ดึง OHLCV data
  const ohlcv = await fetchOHLCV(symbol, timeframe, 250)
  const closes  = ohlcv.map(c => c.close)
  const volumes = ohlcv.map(c => c.volume)
  const highs   = ohlcv.map(c => c.high)
  const lows    = ohlcv.map(c => c.low)

  // 2. คำนวณ indicators
  const indicators = [
    calcMACD(closes),
    calcRSI(closes),
    calcBollinger(closes),
    calcEMA(closes),
    calcVolume(volumes, closes),
  ]

  // 3. คำนวณ score รวม (normalized 0–10)
  const rawScore  = indicators.reduce((sum, i) => sum + i.score, 0)
  const maxScore  = indicators.reduce((sum, i) => sum + i.weight, 0)
  const normScore = Math.max(0, Math.min(10, ((rawScore + maxScore) / (2 * maxScore)) * 10))
  const roundedScore = Math.round(normScore * 10) / 10

  const overall = roundedScore >= 6.5 ? 'BULLISH'
                : roundedScore <= 3.5 ? 'BEARISH'
                : 'NEUTRAL'

  // 4. คำนวณ support/resistance จาก swing points
  const { support, resistance } = calcSupportResistance(highs, lows, closes)
  const stopLoss = support * 0.97   // 3% ใต้ support

  // 5. ให้ Claude AI สร้างคำอธิบายและ considerations
  const { explanation, considerations } = await generateExplanation(
    symbol, overall, roundedScore, indicators, closes[closes.length-1],
    support, resistance, timeframe
  )

  return {
    symbol, timeframe,
    overall, score: roundedScore, confidence: `${roundedScore}/10`,
    price: closes[closes.length-1],
    support, resistance, stopLoss,
    indicators, explanation, considerations,
    generatedAt: new Date().toISOString()
  }
}

function calcSupportResistance(highs: number[], lows: number[], closes: number[]) {
  // ใช้ pivot points จาก 60 candles ล่าสุด
  const recent = 60
  const h = highs.slice(-recent), l = lows.slice(-recent)
  const pivotHighs = h.filter((v,i) => i>0 && i<h.length-1 && v > h[i-1] && v > h[i+1])
  const pivotLows  = l.filter((v,i) => i>0 && i<l.length-1 && v < l[i-1] && v < l[i+1])
  const price = closes[closes.length-1]

  const resistance = pivotHighs.filter(v => v > price).sort((a,b)=>a-b)[0] ?? price * 1.05
  const support    = pivotLows.filter(v => v < price).sort((a,b)=>b-a)[0]  ?? price * 0.95
  return { support, resistance }
}
```

---

## Claude API — สร้างคำอธิบายภาษาไทย

```typescript
// backend/src/services/signal.service.ts (ต่อ)

async function generateExplanation(
  symbol: string, overall: string, score: number,
  indicators: IndicatorResult[], price: number,
  support: number, resistance: number, timeframe: string
): Promise<{ explanation: string; considerations: string[] }> {

  const bullishCount = indicators.filter(i => i.signal === 'BULLISH').length
  const bearishCount = indicators.filter(i => i.signal === 'BEARISH').length

  const prompt = `
คุณเป็น technical analyst ที่วิเคราะห์หุ้นเพื่อใช้เองส่วนตัว
วิเคราะห์สัญญาณ technical ของ ${symbol} บน timeframe ${timeframe}

ข้อมูล indicators:
${indicators.map(i => `- ${i.name}: ${i.signal} (${i.score > 0 ? '+' : ''}${i.score}) — ${i.reason}`).join('\n')}

ราคาปัจจุบัน: ${price}
Support: ${support.toFixed(2)} | Resistance: ${resistance.toFixed(2)}
สัญญาณรวม: ${overall} (${score}/10)

สร้าง JSON ดังนี้ (ตอบแค่ JSON เท่านั้น ไม่ต้องมี markdown):
{
  "explanation": "อธิบาย 2-3 ประโยคว่าทำไมถึงเป็น${overall} เหตุผลหลักคืออะไร pattern ในอดีตเคยเป็นยังไง ภาษาไทยเข้าใจง่าย",
  "considerations": [
    "ปัจจัยเสี่ยงหรือสิ่งที่ควรดูเพิ่ม 1",
    "ปัจจัยเสี่ยงหรือสิ่งที่ควรดูเพิ่ม 2",
    "ปัจจัยเสี่ยงหรือสิ่งที่ควรดูเพิ่ม 3"
  ]
}

กฎห้ามละเมิด:
- ห้ามใช้คำ "แนะนำให้ซื้อ" "ควรซื้อ" "รับประกัน" "แน่ใจว่า"
- ใช้คำ "สัญญาณ" "indicator ชี้" "pattern เคย" "ควรพิจารณา" แทน
- considerations ต้องรวมถึงความเสี่ยงของ indicator ที่ bearish ด้วย
`

  const response = await anthropicClient.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const parsed = JSON.parse(text)
  return {
    explanation:    parsed.explanation ?? '',
    considerations: parsed.considerations ?? []
  }
}
```

---

## Push Message ที่ส่งใน LINE

```typescript
// backend/src/services/push.service.ts — buildSignalMessage()

export function buildSignalMessage(signal: SignalSummary): string {
  const icon = signal.overall === 'BULLISH' ? '📈' : signal.overall === 'BEARISH' ? '📉' : '📊'
  const label = signal.overall === 'BULLISH' ? 'สัญญาณซื้อ' : signal.overall === 'BEARISH' ? 'สัญญาณขาย' : 'Neutral'

  const indLines = signal.indicators
    .map(i => {
      const sig = i.signal === 'BULLISH' ? '🟢' : i.signal === 'BEARISH' ? '🔴' : '🟡'
      return `${sig} ${i.name}: ${i.value}`
    })
    .join('\n')

  const considerLines = signal.considerations
    .map((c, i) => `${i+1}. ${c}`)
    .join('\n')

  return [
    `${icon} ${signal.symbol} — ${label} (${signal.confidence})`,
    `ราคา: ${signal.price.toLocaleString()} · Timeframe: ${signal.timeframe}`,
    '',
    `📝 ${signal.explanation}`,
    '',
    '📊 Indicators:',
    indLines,
    '',
    `Support: ${signal.support.toFixed(2)} | Resistance: ${signal.resistance.toFixed(2)}`,
    `Stop Loss แนะนำ: ${signal.stopLoss.toFixed(2)} (3% ใต้ support)`,
    '',
    '⚠️ ควรพิจารณาเพิ่มเติม:',
    considerLines,
    '',
    '─────────────────────',
    'วิเคราะห์จาก technical indicators เท่านั้น ไม่ใช่คำแนะนำลงทุน',
    'อัตราความถูกต้องของ TA อยู่ที่ ~55–65%',
  ].join('\n')
}
```

---

## Trigger ที่ส่ง signal อัตโนมัติ

```typescript
// backend/src/services/scheduler.ts — เพิ่ม signal check

// รันเมื่อตลาดเปิด: จ-ศ 09:30-16:30 (SET), 21:30-04:00 (US)
// ตรวจทุก 30 นาที ในช่วงตลาดเปิด เพื่อลด API calls
cron.schedule('*/30 7-17 * * 1-5', async () => {
  await checkSignalAlerts()
})

async function checkSignalAlerts() {
  // ดึง watched_assets ทั้งหมด (unique symbols)
  const { data: assets } = await supabaseAdmin
    .from('watched_assets')
    .select('symbol, display_name, users!inner(id, line_user_id)')

  for (const asset of assets ?? []) {
    const signal = await analyzeSignal(asset.symbol, '1wk')

    // ส่งเฉพาะถ้า score เปลี่ยนแปลงมากพอ (ป้องกัน spam)
    const shouldNotify = signal.score >= 7.0 || signal.score <= 3.0

    // ตรวจว่าส่งในช่วง 4 ชั่วโมงที่ผ่านมาหรือยัง
    const recentlySent = await checkRecentSignal(asset.users.id, asset.symbol, 4)

    if (shouldNotify && !recentlySent) {
      const text = buildSignalMessage(signal)
      await sendPushWithQuotaCheck(asset.users.id, asset.users.line_user_id, {
        type: 'text', text
      })
      await logSignalSent(asset.users.id, asset.symbol, signal.score)
    }
  }
}
```

---

## NLP — พิมในแชทขอวิเคราะห์ได้

เพิ่มใน NLP_SYSTEM_PROMPT:
```
Classify as ANALYZE when text contains:
- "วิเคราะห์", "analyze", "ดูสัญญาณ", "signal" + ชื่อหุ้น
- "PTT เป็นยังไงบ้าง", "NVDA น่าซื้อไหม", "ทองตอนนี้เป็นยังไง"

Response:
{
  "intent": "ANALYZE",
  "data": {
    "symbol": "PTT",
    "timeframe": "1wk"   // default 1wk ถ้าไม่ระบุ
  }
}
```

Webhook handler:
```typescript
case 'ANALYZE': {
  const { symbol, timeframe } = nlp.data
  await lineClient.replyMessage(replyToken, { type: 'text', text: '⏳ กำลังวิเคราะห์...' })
  const signal = await analyzeSignal(symbol, timeframe ?? '1wk')
  await sendPushWithQuotaCheck(user.id, lineUserId, {
    type: 'text', text: buildSignalMessage(signal)
  })
  break
}
```

---

## REST Endpoints

```
GET  /api/signals/:symbol?timeframe=1wk    → SignalSummary (คำนวณใหม่)
GET  /api/signals/history/:symbol          → SignalSummary[] (ประวัติ)
GET  /api/signals/watchlist                → SignalSummary[] ของทุก watched_assets
POST /api/signals/manual/:symbol           → force re-analyze + push
```

---

## Frontend Screen — หน้า Signal Detail

```
เพิ่มใน PriceAlerts.tsx:
- กด asset row → เปิด Signal Detail modal/screen
- Signal hero card: icon + "สัญญาณซื้อ/ขาย" + score 7/10
- Explanation paragraph (จาก Claude)
- Indicator breakdown: badge (BULLISH/BEARISH/NEUTRAL) + name + value + reason + mini bar
- Considerations section (amber card)
- Support/Resistance/Stop Loss row
- Timeframe selector: 1D | 1W | 1M
- Disclaimer footer
```

---

## Dependencies

```json
// backend/package.json — เพิ่ม
"technicalindicators": "^3.1.0"
```

---

## Caching Strategy

```
- analyzeSignal() ผลลัพธ์ cache 30 นาทีต่อ symbol ต่อ timeframe
- ถ้า request มาใหม่ในช่วง 30 นาที return cached result
- Force refresh ได้ผ่าน POST /api/signals/manual/:symbol
- เก็บ cache ใน price_cache table หรือ in-memory (node-cache)
```

---

## News + Monthly Summary Feature

### ⚠️ Framing (ห้ามเปลี่ยน)

```
❌ "เดือนนี้ควรลงทุนตัวไหน"
✅ "สรุปสัญญาณ technical + ข่าวของทุกตัวใน watchlist เดือนนี้"

ทุก output ต้องมี disclaimer:
"สรุปจาก technical indicators และข่าวสาธารณะเท่านั้น
ไม่ใช่คำแนะนำการลงทุน การตัดสินใจเป็นของคุณเองทั้งหมด"
```

---

### News Source — Finnhub (ฟรี แนะนำ)

```typescript
// backend/src/services/news.service.ts
// Finnhub: ฟรี 60 req/นาที — สมัครที่ finnhub.io

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const FINNHUB_KEY  = process.env.FINNHUB_API_KEY

// ดึงข่าวตาม symbol (หุ้น US + SET บางตัว)
export async function fetchCompanyNews(
  symbol: string,
  from: string,   // 'YYYY-MM-DD'
  to:   string
): Promise<NewsItem[]> {
  const yahooSym = SYMBOL_MAP[symbol.toUpperCase()] ?? symbol
  // Finnhub ใช้ symbol ไม่มี .BK suffix
  const finnhubSym = yahooSym.replace('.BK', '')

  const res = await fetch(
    `${FINNHUB_BASE}/company-news?symbol=${finnhubSym}&from=${from}&to=${to}&token=${FINNHUB_KEY}`,
    { signal: AbortSignal.timeout(5000) }
  )
  const items = await res.json() as any[]
  return items.slice(0, 5).map(i => ({   // เอาแค่ 5 ข่าวล่าสุด
    headline: i.headline,
    summary:  i.summary,
    url:      i.url,
    datetime: new Date(i.datetime * 1000).toISOString(),
    source:   i.source,
  }))
}

// ข่าวทั่วไป SET / ตลาดไทย
export async function fetchMarketNews(category = 'general'): Promise<NewsItem[]> {
  const res = await fetch(
    `${FINNHUB_BASE}/news?category=${category}&token=${FINNHUB_KEY}`
  )
  const items = await res.json() as any[]
  return items.slice(0, 5).map(i => ({
    headline: i.headline,
    summary:  i.summary,
    url:      i.url,
    datetime: new Date(i.datetime * 1000).toISOString(),
    source:   i.source,
  }))
}

export interface NewsItem {
  headline: string
  summary:  string
  url:      string
  datetime: string
  source:   string
}
```

---

### Claude Summarizer

```typescript
// backend/src/services/news.service.ts (ต่อ)
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic()

// สรุปข่าวรายบริษัท — เรียก 1 ครั้ง/วัน/symbol
export async function summarizeNews(
  symbol: string,
  displayName: string,
  news: NewsItem[]
): Promise<string> {
  if (!news.length) return `${displayName}: ไม่มีข่าวใหม่ 24 ชั่วโมงที่ผ่านมา`

  const newsText = news
    .map((n, i) => `${i+1}. ${n.headline}\n${n.summary}`)
    .join('\n\n')

  const response = await client.messages.create({
    model:      'claude-haiku-4-5',   // ← ใช้ Haiku ลดค่าใช้จ่าย (ง่ายพอ)
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `สรุปข่าวของ ${displayName} (${symbol}) ในภาษาไทย 2-3 ประโยค
อธิบายว่าข่าวเหล่านี้อาจส่งผลต่อราคาหุ้นอย่างไร
ห้ามใช้คำว่า "ควรซื้อ" "ควรขาย" "แนะนำ"
ใช้คำว่า "อาจส่งผล" "น่าติดตาม" "ปัจจัยที่ควรพิจารณา" แทน

ข่าว:
${newsText}`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return `📰 ${displayName}: ${text.trim()}`
}

// สรุปภาพรวมรายเดือน — เรียก 1 ครั้ง/เดือน
export async function buildMonthlySummary(
  userId: string,
  month: string,    // 'YYYY-MM'
  items: MonthlySummaryItem[]
): Promise<string> {
  const itemsText = items.map(i =>
    `${i.displayName} (${i.symbol}):
     - สัญญาณ technical: ${i.overall} (${i.score}/10)
     - ข่าวเดือนนี้: ${i.newsSummary}
     - ราคาต้นเดือน: ${i.priceStart} / ปัจจุบัน: ${i.priceCurrent}
     - เปลี่ยนแปลง: ${i.changePct > 0 ? '+' : ''}${i.changePct.toFixed(2)}%`
  ).join('\n\n')

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',   // ← Sonnet สำหรับสรุปที่ซับซ้อนกว่า
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `สรุปภาพรวม watchlist ประจำเดือน ${month} ในภาษาไทย

สรุปภาพรวมตลาดและแต่ละสินทรัพย์ที่น่าสนใจ
บอกว่า technical + ข่าวชี้ไปในทิศทางใด
ระบุ "ปัจจัยที่ควรติดตาม" แทนการแนะนำซื้อขาย
ห้ามใช้คำว่า "ควรซื้อ" "ควรขาย" "แนะนำให้" ทุกกรณี

ข้อมูล watchlist:
${itemsText}

ลงท้ายด้วย:
"สรุปจาก technical indicators และข่าวสาธารณะ ไม่ใช่คำแนะนำลงทุน"`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const monthTH = formatMonthTH(month)
  return `📊 สรุป Watchlist ${monthTH}\n\n${text.trim()}`
}

export interface MonthlySummaryItem {
  symbol:       string
  displayName:  string
  overall:      string
  score:        number
  newsSummary:  string
  priceStart:   number
  priceCurrent: number
  changePct:    number
}

function formatMonthTH(month: string): string {
  const [y, m] = month.split('-')
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  return `${months[parseInt(m)-1]} ${parseInt(y)+543}`
}
```

---

### Scheduler Jobs เพิ่ม

```typescript
// backend/src/services/scheduler.ts — เพิ่ม 2 jobs

// ── ข่าวรายวัน ─────────────────────────────────────────────
// ทุกวัน 07:00 — ดึงข่าว + สรุป → รวมใน morning summary
cron.schedule('0 7 * * *', async () => {
  await fetchAndCacheAllNews()
}, { timezone: 'Asia/Bangkok' })

async function fetchAndCacheAllNews() {
  const today     = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  // ดึง symbols ทั้งหมดที่ user ติดตาม (unique)
  const assets = await db.selectDistinct({ symbol: watchedAssets.symbol,
    displayName: watchedAssets.displayName })
    .from(watchedAssets)

  for (const asset of assets) {
    try {
      const news    = await fetchCompanyNews(asset.symbol, yesterday, today)
      const summary = await summarizeNews(asset.symbol, asset.displayName, news)
      // cache ใน news_cache table (1 วัน)
      await db.insert(newsCache).values({
        symbol: asset.symbol, summary, date: today
      }).onConflictDoUpdate({
        target: [newsCache.symbol, newsCache.date],
        set: { summary, updatedAt: new Date() }
      })
    } catch (err) {
      console.error(`[News] fetch failed for ${asset.symbol}:`, err)
    }
  }
}

// ── สรุปรายเดือน ────────────────────────────────────────────
// วันที่ 1 ของทุกเดือน 08:30 (หลัง morning summary)
cron.schedule('30 8 1 * *', async () => {
  await sendMonthlySummaries()
}, { timezone: 'Asia/Bangkok' })

async function sendMonthlySummaries() {
  const lastMonth = new Date()
  lastMonth.setMonth(lastMonth.getMonth() - 1)
  const month = lastMonth.toISOString().slice(0, 7)   // 'YYYY-MM'

  // ดึง users ทุกคนที่มี watchlist
  const users = await db.selectDistinct({ id: watchedAssets.userId })
    .from(watchedAssets)

  for (const { id: userId } of users) {
    try {
      const items = await buildMonthlyItems(userId, month)
      if (!items.length) continue

      const summary = await buildMonthlySummary(userId, month, items)
      const user    = await getUserById(userId)

      await sendPushWithQuotaCheck(userId, user.lineUserId, {
        type: 'text', text: summary
      })
    } catch (err) {
      console.error(`[Monthly] failed for user ${userId}:`, err)
    }
  }
}

async function buildMonthlyItems(userId: string, month: string): Promise<MonthlySummaryItem[]> {
  const assets = await db.select().from(watchedAssets)
    .where(eq(watchedAssets.userId, userId))

  const items: MonthlySummaryItem[] = []
  for (const asset of assets) {
    const signal  = await analyzeSignal(asset.symbol, '1mo')
    const news    = await getNewsCache(asset.symbol, month)
    const prices  = await getMonthPrices(asset.symbol, month)

    items.push({
      symbol:       asset.symbol,
      displayName:  asset.displayName,
      overall:      signal.overall,
      score:        signal.score,
      newsSummary:  news ?? 'ไม่มีข้อมูล',
      priceStart:   prices.start,
      priceCurrent: prices.current,
      changePct:    ((prices.current - prices.start) / prices.start) * 100,
    })
  }
  return items
}
```

---

### Database — News Cache Table

```sql
-- เพิ่มใน schema.ts และ migrate

create table news_cache (
  id         uuid primary key default gen_random_uuid(),
  symbol     text not null,
  summary    text not null,    -- Claude สรุปแล้ว
  date       date not null,    -- วันที่ดึงข่าว
  updated_at timestamptz default now(),
  unique(symbol, date)
);

-- Drizzle schema
export const newsCache = pgTable('news_cache', {
  id:        uuid('id').primaryKey().defaultRandom(),
  symbol:    text('symbol').notNull(),
  summary:   text('summary').notNull(),
  date:      date('date').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, t => ({ uniq: unique().on(t.symbol, t.date) }))
```

---

### Morning Summary — เพิ่มข่าว

```typescript
// buildMorningSummary — เพิ่มข่าวเข้าไป
async function buildMorningSummary(userId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0]

  // ... (เหมือนเดิม: appts, tx, budgets, portfolio, goals) ...

  // เพิ่ม: ดึงข่าวจาก cache (07:00 fetch ไว้แล้ว)
  const assets = await db.select().from(watchedAssets)
    .where(eq(watchedAssets.userId, userId)).limit(3)   // top 3 ใน morning

  for (const asset of assets) {
    const cached = await getNewsCache(asset.symbol, today)
    if (cached) lines.push(cached)
  }

  // signal (เหมือนเดิม)
  // ...
}
```

---

### REST Endpoints เพิ่ม

```
GET /api/news/:symbol          → ข่าวล่าสุด (จาก cache ถ้ามี / fetch ถ้าไม่มี)
GET /api/news/summary/monthly  → สรุปรายเดือนของทุก watchlist
POST /api/news/refresh         → force fetch ข่าวทั้งหมด
```

---

### Environment Variables เพิ่ม

```bash
FINNHUB_API_KEY=   # สมัครฟรีที่ finnhub.io
```

---

### ประมาณค่าใช้จ่าย API

```
Haiku 4.5: $1 input / $5 output ต่อ 1M tokens
Sonnet 4.6: $3 input / $15 output ต่อ 1M tokens
Batch API: ลด 50% สำหรับงานที่ไม่ต้องการผลทันที

── ต่อเดือน (1 user, watchlist 5 ตัว) ──────────────────────
ข่าวรายวัน (Haiku):
  input  ~500 tokens × 5 × 30  = 75,000 tokens  = $0.075
  output ~300 tokens × 5 × 30  = 45,000 tokens  = $0.225
  รวม                                            ≈ $0.30/เดือน

สรุปรายเดือน (Sonnet, 1 ครั้ง):
  input  ~2,000 tokens                           = $0.006
  output ~800 tokens                             = $0.012
  รวม                                            ≈ $0.02/เดือน

NLP + Signal explain + OCR (Sonnet, ~100 ครั้ง):
                                                 ≈ $0.50-1.00/เดือน

รวมทั้งหมด                                       ≈ $1-2/เดือน ต่อ user
```

---

### Finnhub Free Tier

```
60 API calls/นาที
ข่าวรายบริษัท: ไม่จำกัด
ข่าวทั่วไป: ไม่จำกัด
ราคาหุ้น real-time: US stocks ฟรี
หุ้นไทย (SET): บางตัวมี บางตัวไม่มี — fallback ใช้ Yahoo Finance

หมายเหตุ: หุ้นไทยบน Finnhub อาจข่าวน้อยกว่า US
  fallback: ดึงข่าวจาก investing.com/th ด้วย web scraping
  หรือใช้แค่ Yahoo Finance news (มีใน yfinance Python library)
```
