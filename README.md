# MyAssist — LINE Personal Assistant

LINE Personal Assistant สำหรับจัดการการเงิน นัดหมาย เป้าหมายการออม และพอร์ตการลงทุน

## Stack

- **Frontend**: React 18 + TypeScript + Vite → Vercel
- **Backend**: Express + TypeScript → Railway
- **Database**: PostgreSQL + Drizzle ORM → Railway
- **Storage**: Cloudflare R2
- **AI**: Anthropic Claude API

## Quick Start

### Backend

```bash
cd backend
cp ../.env.example .env   # แก้ไข env vars
npm install
npm run db:migrate
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL` and `VITE_LIFF_ID` in `.env`

## Deploy

### Railway (Backend)

1. Push to GitHub
2. Create Railway project → connect repo → set root to `backend/`
3. Add PostgreSQL plugin
4. Set env vars from `.env.example`
5. Deploy (runs `build` + `db:migrate` automatically via `railway.toml`)

### Vercel (Frontend)

1. Deploy `frontend/` directory
2. Set `VITE_API_URL` and `VITE_LIFF_ID`

## Project Structure

```
line_assist/
├── backend/          # Express API + LINE webhook
├── frontend/         # LIFF React app
├── docs/             # Specifications
├── design/           # Visual reference
└── CLAUDE.md         # Master prompt
```
