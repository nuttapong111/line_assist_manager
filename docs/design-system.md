# Design System — MyAssist
## ให้ Claude Code อ่านไฟล์นี้ก่อน code ทุก component

---

## Color Palette (CSS Variables)

```css
/* frontend/src/index.css — วางใน :root */
:root {
  /* ─── Backgrounds ─────────────────── */
  --bg:          #F7F6F2;   /* page background - warm white */
  --surface:     #FFFFFF;   /* card / input background */
  --surface-2:   #EEEDE8;   /* subtle surface, hover state */
  --surface-3:   #E5E3DC;   /* pressed state */

  /* ─── Borders ─────────────────────── */
  --border:      rgba(0, 0, 0, 0.07);   /* default border */
  --border-md:   rgba(0, 0, 0, 0.13);   /* emphasized border */
  --border-strong: rgba(0, 0, 0, 0.22); /* input focus */

  /* ─── Text ────────────────────────── */
  --text-1:  #18170F;   /* primary text */
  --text-2:  #636259;   /* secondary text */
  --text-3:  #9B9A94;   /* placeholder / hint */

  /* ─── Accent (Forest Green) ──────── */
  --accent:      #2A5C45;
  --accent-mid:  #3D7A5E;
  --accent-light:#E6F0EB;   /* accent tint background */
  --accent-text: #1A3D2E;   /* text on accent-light */

  /* ─── Semantic ────────────────────── */
  --amber:       #B8721A;
  --amber-light: #FBF0E0;
  --red:         #B83232;
  --red-light:   #FAEBE8;
  --blue:        #2655A0;
  --blue-light:  #E8EEFA;
  --purple:      #6344A0;
  --purple-light:#EEE8FA;
  --teal:        #1A7A6B;
  --teal-light:  #E4F4F1;

  /* ─── LINE Brand ─────────────────── */
  --line-green:  #06C755;

  /* ─── Shadows ─────────────────────── */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow:    0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04);
  --shadow-lg: 0 12px 40px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.06);

  /* ─── Radius ─────────────────────── */
  --r-sm:  8px;
  --r:     14px;   /* default card */
  --r-lg:  20px;   /* large card, modal */
  --r-xl:  28px;   /* pill, bottom sheet */
}
```

---

## Tailwind Config

```typescript
// frontend/tailwind.config.ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#F7F6F2',
        surface:  '#FFFFFF',
        's2':     '#EEEDE8',
        border:   'rgba(0,0,0,0.07)',
        'text-1': '#18170F',
        'text-2': '#636259',
        'text-3': '#9B9A94',
        accent: {
          DEFAULT: '#2A5C45',
          mid:     '#3D7A5E',
          light:   '#E6F0EB',
          text:    '#1A3D2E',
        },
        amber: { DEFAULT: '#B8721A', light: '#FBF0E0' },
        danger: { DEFAULT: '#B83232', light: '#FAEBE8' },
        info:   { DEFAULT: '#2655A0', light: '#E8EEFA' },
      },
      fontFamily: {
        th: ['Noto Sans Thai', 'sans-serif'],
        en: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      borderRadius: {
        sm:  '8px',
        DEFAULT: '14px',
        lg:  '20px',
        xl:  '28px',
      },
      boxShadow: {
        sm: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        DEFAULT: '0 4px 16px rgba(0,0,0,0.08)',
        lg: '0 12px 40px rgba(0,0,0,0.10)',
      },
    },
  },
} satisfies Config
```

---

## Typography

```css
/* Noto Sans Thai + DM Sans — โหลดใน index.html */
/* <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"> */

/* Scale */
--text-xs:   11px  / line-height: 1.4  / tracking: 0
--text-sm:   13px  / line-height: 1.5  / tracking: 0
--text-base: 14px  / line-height: 1.6  / tracking: 0
--text-md:   16px  / line-height: 1.6  / tracking: -0.1px
--text-lg:   20px  / line-height: 1.4  / tracking: -0.3px
--text-xl:   24px  / line-height: 1.3  / tracking: -0.5px
--text-2xl:  30px  / line-height: 1.2  / tracking: -0.8px

/* Rules */
- หัวข้อใช้ font-en (DM Sans) เสมอ
- body text ใช้ font-th (Noto Sans Thai)
- ตัวเลขเงินใช้ font-mono (DM Mono)
- ห้ามใช้ font-weight 700+ (ดูหนักเกิน)
- weight ที่ใช้: 400 (regular), 500 (medium), 600 (semibold)
```

---

## Component Specs

### Card (ใช้บ่อยที่สุด)
```tsx
// ✅ Standard card
<div className="bg-surface border border-[rgba(0,0,0,0.07)] rounded-[14px] shadow-sm">

// ✅ Large card (modal-like)
<div className="bg-surface border border-[rgba(0,0,0,0.07)] rounded-[20px] shadow">

// ✅ Accent card (summary)
<div className="bg-accent rounded-[20px] text-white relative overflow-hidden">

// ❌ ห้าม
<div className="shadow-md rounded-2xl"> // shadow หนักเกิน
<div className="bg-white">             // ใช้ bg-surface แทน
```

### Button
```tsx
// Primary
<button className="w-full py-[14px] bg-accent text-white rounded-[14px] font-th text-[15px] font-semibold
                   hover:bg-accent-mid active:scale-[0.99] transition-all">

// Secondary
<button className="w-full py-[14px] bg-s2 text-text-2 rounded-[14px] font-th text-[15px]
                   hover:bg-[rgba(0,0,0,0.06)] transition-colors">

// Ghost / Destructive
<button className="text-danger text-[13px] font-medium">
```

### Input
```tsx
<input className="w-full px-[14px] py-[10px] bg-surface border border-[rgba(0,0,0,0.13)]
                  rounded-[10px] font-th text-[14px] text-text-1
                  placeholder:text-text-3 focus:outline-none
                  focus:border-[rgba(0,0,0,0.22)] transition-colors" />
```

### Progress Bar (Budget)
```tsx
<div className="h-[5px] bg-s2 rounded-full overflow-hidden">
  <div
    className="h-full rounded-full transition-all duration-500"
    style={{
      width: `${Math.min(pct, 100)}%`,
      background: pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--accent)'
    }}
  />
</div>
```

### Badge / Pill
```tsx
// Status badge
<span className="text-[10px] font-semibold font-en px-[7px] py-[2px] rounded-full
                 bg-amber-light text-amber tracking-wide">
  76%
</span>

// Over budget
<span className="text-[10px] font-semibold px-[7px] py-[2px] rounded-full
                 bg-red-light text-danger">
  เกินงบ
</span>
```

### Icon Button
```tsx
<button className="w-[36px] h-[36px] rounded-full bg-s2 flex items-center justify-center
                   text-text-2 hover:bg-[rgba(0,0,0,0.06)] transition-colors text-[16px]">
  {icon}
</button>
```

### Section Header
```tsx
<div className="flex items-center justify-between mb-3">
  <span className="font-en text-[11px] font-semibold text-text-3
                   tracking-[0.08em] uppercase">
    {title}
  </span>
  <span className="text-[12px] text-accent font-medium cursor-pointer">
    ดูทั้งหมด
  </span>
</div>
```

---

## Screen Layout Rules

```
ทุก screen ใช้ layout นี้:
┌─────────────────────────┐
│ Status bar (44px)       │  ← สีพื้น bg
│ Page header (52-60px)   │  ← bg-surface, border-bottom
│ ─────────────────────── │
│ Scrollable content      │  ← bg (warm white)
│   padding: 0 20px       │
│   gap ระหว่าง section:  │
│     16-20px             │
│                         │
│                         │
│ ─────────────────────── │
│ Tab bar (68px)          │  ← bg-surface/95 backdrop-blur
└─────────────────────────┘

Content max-width: 100% (mobile-first, 375px base)
Safe area: padding-bottom ใน tab bar = 8px + env(safe-area-inset-bottom)
```

---

## Screen-by-Screen Specs

### 1. Dashboard
```
Header:
  - ชื่อ "สวัสดี, [ชื่อ] 👋" — font-en 26px/600
  - วันที่ ภาษาไทย — text-3 13px
  - icon ⚙️ ขวา

Summary Card (bg-accent):
  - "ใช้จ่ายเดือนนี้" label — white/75 12px
  - ตัวเลขยอด — font-mono 32px/600 white
  - "จากงบ X บ. · เหลือ X บ." — white/65 12px
  - pills row: "📅 X นัดวันนี้" + "🔔 X การแจ้งเตือน"
  - มี 2 decorative circles ขวาบน (absolute, white/8%)

Quick Actions (bg-surface, border-bottom):
  - grid 4 columns
  - icon 52×52px, border-radius 16px
  - label 11px text-2
  - icon bg colors: accent-light / amber-light / purple-light / blue-light

Today's Appointments section:
  - appointment card: bg-surface, border, rounded-[14px], padding 14/16
  - left: time column (13px/600) + colored dot
  - body: title 14px/500, meta 12px text-3, badge pill

Reminders section:
  - reminder row: bg-surface, border, rounded-[14px]
  - left icon 36×36px rounded-[10px]
  - right: unchecked circle 22px
```

### 2. Finance Screen
```
Month navigator:
  - ‹ | มิถุนายน 2026 | › (DM Sans 15px/600)
  - nav buttons: 32×32 rounded-full border

Summary row (2-col grid, gap 10):
  - รายรับ card: amount color accent
  - รายจ่าย card: amount color red

Budget section (border + rounded-[20px]):
  - header: "งบประมาณ" uppercase 11px + "แก้ไข" link
  - each row: icon 26×26 rounded-[7px] + name + badge + "X/Y"
  - progress bar 5px height
  - color logic: <80% = accent, 80-99% = amber, ≥100% = red

Transaction list (border + rounded-[20px]):
  - icon 38×38 rounded-[12px]
  - name 13px/500, category 11px text-3
  - amount font-mono 14px/600 (red=expense, green=income)
  - date 10px text-3 right-align
```

### 3. Slip Confirm Screen
```
Nav: back button + title "บันทึกจากสลิป"

OCR Status bar (bg-accent-light):
  - pulsing dot (animation) + "AI อ่านสลิปแล้ว"
  - badge "✓ สำเร็จ" right

Slip thumbnail: 90px height, bg-s2, centered receipt icon

Fields:
  - ยอดเงิน: 22px/600 (biggest)
  - วันที่, ร้าน/ผู้รับ, ธนาคาร: 13px/500
  - ร้าน มี edit icon ✏️ 12px

Category grid (3×2):
  - each: border 1.5px, rounded-[10px], icon 20px + label 11px
  - selected state: border-accent (2px) + bg-accent-light + text-accent
  - unselected: border-border + hover:border-accent

Budget impact warning:
  - bg-amber-light, border-amber/20, rounded-[14px]
  - ⚠️ icon + text 12px text-amber
  - bold ยอดคงเหลือ

Note field:
  - dashed? No — just text-3 placeholder style

CTA: "บันทึกรายจ่าย" primary + "ยกเลิก" secondary
```

### 4. Budget Setup Screen
```
Header: "งบประมาณ" + วันที่ subtitle + ✓ button (bg-accent)

Tip card (bg-blue-light, border-blue/15):
  - 💡 icon + text 12px blue

Copy/Reset buttons row (2-col):
  - copy: border-accent bg-accent-light text-accent
  - reset: border-border bg-surface text-2

Budget rows (rounded-[20px] card):
  - icon 36×36 rounded-[10px]
  - category name 13px/500
  - spent info 11px text-3 (red ถ้าเกิน)
  - right: amount (font-en 14px/600) + บ. + ›
  - last row: "+ เพิ่มหมวดหมู่" (text-accent)

Total summary bar:
  - "งบรวมทั้งหมด" label + amount font-en 20px
  - right: ใช้ไป X (red)
```

### 5. Appointments Screen
```
Calendar strip (bg-surface):
  - 7 วัน horizontal
  - each: day-name 10px text-3 uppercase + day-num 16px/600
  - today: bg-accent rounded-[10px] text-white
  - has-event dot: 4px circle below number (accent / white for today)

Time slot sections:
  - label: "เช้า" / "บ่าย" / "เย็น" — 11px/600 text-3 uppercase tracking-wide
  - appointment block: time-col (36px wide, 11px text-3 right) + colored card
  - card: bg-{color}-light, border-l-[3px] border-{color}, rounded-[14px]
  - title 13px/600, meta 11px (opacity 0.7) — both colored

FAB:
  - 52×52 rounded-full bg-accent
  - position: absolute bottom-[84px] right-[20px]
  - shadow: 0 4px 16px rgba(42,92,69,0.35)
```

---

## Tab Bar

```tsx
// 5 tabs: หน้าหลัก | นัดหมาย | การเงิน | สลิป | งบ
// icons: 🏠 📅 💰 📷 🎯

<div className="h-[68px] bg-surface/95 backdrop-blur-xl border-t border-border
                flex items-center px-2 pb-2 flex-shrink-0">
  {tabs.map(tab => (
    <div key={tab.id}
         className={`flex-1 flex flex-col items-center gap-[3px] py-2 px-1
                     rounded-[10px] cursor-pointer transition-all`}
         onClick={() => setActiveTab(tab.id)}>
      <div className={`w-7 h-7 flex items-center justify-center rounded-[8px]
                       text-[18px] transition-all
                       ${active === tab.id ? 'bg-accent text-white scale-[1.08]' : ''}`}>
        {tab.icon}
      </div>
      <span className={`text-[10px] transition-colors
                        ${active === tab.id
                          ? 'text-accent font-medium'
                          : 'text-text-3'}`}>
        {tab.label}
      </span>
    </div>
  ))}
</div>
```

---

## Animation Guidelines

```css
/* Transitions */
transition: all 0.15s ease;        /* hover states */
transition: background 0.12s;      /* bg color change */
transition: colors 0.15s;          /* text color */
transition: transform 0.15s;       /* scale */

/* Scale on press */
active:scale-[0.99]    /* buttons */
active:scale-[0.98]    /* cards */

/* OCR pulsing dot */
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.8); }
}
animation: pulse 1.8s ease-in-out infinite;

/* Budget bar fill (on mount) */
transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);

/* FAB entrance */
@keyframes fab-in {
  from { opacity: 0; transform: scale(0.8) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
animation: fab-in 0.25s ease-out;
```

---

## Do / Don't

```
✅ DO
- bg-surface (not bg-white)
- border border-[rgba(0,0,0,0.07)]
- font-en สำหรับ title, heading, ตัวเลข
- font-th สำหรับ body text, button label
- font-mono สำหรับ ยอดเงิน, เวลา
- rounded-[14px] default, rounded-[20px] large card
- shadow-sm เท่านั้น (ยกเว้น FAB)
- text-text-1/2/3 ตาม hierarchy
- transition ทุก interactive element

❌ DON'T
- bg-white (ใช้ bg-surface)
- shadow-md, shadow-lg (หนักเกิน, ยกเว้น phone frame)
- rounded-2xl, rounded-3xl (ใช้ค่าที่กำหนดไว้)
- font-bold (weight 700) — ใช้ font-semibold (600) สูงสุด
- border-2 ยกเว้น selected state
- text-gray-500 (ใช้ text-text-2/3 แทน)
- hardcode colors เช่น #333, #666 (ใช้ CSS vars)
- purple gradient บน white background
```
