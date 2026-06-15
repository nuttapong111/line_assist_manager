import { getAccessToken } from './liff'

const BASE_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api')

async function getAuthHeaders(contentType = true): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: Record<string, string> = {}

  if (contentType) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return headers
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> ?? {}) },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? 'API error')
  return json as T
}

export const api = {
  finance: {
    getSummary: (month: string) => apiFetch<Record<string, number>>(`/finance/summary?month=${month}`),
    getTransactions: (month: string, limit = 20) =>
      apiFetch<{ transactions: any[]; total: number }>(`/finance/transactions?month=${month}&limit=${limit}`),
    createTransaction: (body: Record<string, unknown>) =>
      apiFetch('/finance/transactions', { method: 'POST', body: JSON.stringify(body) }),
    deleteTransaction: (id: string) =>
      apiFetch(`/finance/transactions/${id}`, { method: 'DELETE' }),
  },
  budget: {
    get: (month: string) => apiFetch<any[]>(`/budget?month=${month}`),
    upsert: (month: string, categories: { category_id: string; amount: number }[]) =>
      apiFetch('/budget', { method: 'PUT', body: JSON.stringify({ month, categories }) }),
    getCategories: () => apiFetch<any[]>('/budget/categories'),
  },
  appointments: {
    getToday: () => apiFetch<any[]>('/appointments/today'),
    getRange: (from: string, to: string) => apiFetch<any[]>(`/appointments?from=${from}&to=${to}`),
    create: (body: Record<string, unknown>) =>
      apiFetch('/appointments', { method: 'POST', body: JSON.stringify(body) }),
    delete: (id: string) => apiFetch(`/appointments/${id}`, { method: 'DELETE' }),
  },
  reminders: {
    getUpcoming: () => apiFetch<any[]>('/reminders'),
    create: (body: Record<string, unknown>) =>
      apiFetch('/reminders', { method: 'POST', body: JSON.stringify(body) }),
    markDone: (id: string) => apiFetch(`/reminders/${id}/done`, { method: 'PATCH' }),
  },
  ocr: {
    scanSlip: async (file: File) => {
      const headers = await getAuthHeaders(false)
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE_URL}/ocr/slip`, {
        method: 'POST',
        headers,
        body: form,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? 'OCR failed')
      return json
    },
  },
  user: {
    getStats: () => apiFetch<Record<string, number>>('/user/stats'),
    getPushQuota: () => apiFetch<{ push_count: number; limit: number; remaining: number }>('/user/quota'),
    deleteAccount: () => apiFetch('/user/account', { method: 'DELETE' }),
  },
  goals: {
    getAll: () => apiFetch<any[]>('/goals'),
    create: (body: Record<string, unknown>) => apiFetch('/goals', { method: 'POST', body: JSON.stringify(body) }),
    contribute: (id: string, amount: number, note?: string) =>
      apiFetch(`/goals/${id}/contribute`, { method: 'POST', body: JSON.stringify({ amount, note }) }),
    delete: (id: string) => apiFetch(`/goals/${id}`, { method: 'DELETE' }),
  },
  portfolio: {
    getPositions: () => apiFetch<any[]>('/portfolio/positions'),
    buy: (body: Record<string, unknown>) => apiFetch('/portfolio/buy', { method: 'POST', body: JSON.stringify(body) }),
    getWatched: () => apiFetch<any[]>('/portfolio/watched'),
  },
  alerts: {
    getAll: () => apiFetch<any[]>('/alerts'),
    create: (body: Record<string, unknown>) => apiFetch('/alerts', { method: 'POST', body: JSON.stringify(body) }),
    delete: (id: string) => apiFetch(`/alerts/${id}`, { method: 'DELETE' }),
    analyze: (symbol: string) => apiFetch<any>(`/alerts/analyze/${symbol}`),
  },
  gcal: {
    getStatus: () => apiFetch<{ connected: boolean; sync_enabled: boolean }>('/gcal/status'),
    getAuthUrl: () => apiFetch<{ url: string }>('/gcal/auth'),
    disconnect: () => apiFetch('/gcal/disconnect', { method: 'DELETE' }),
  },
  news: {
    getFeed: () => apiFetch<{ bundles: any[]; market: any[]; disclaimer: string }>('/news'),
    getSymbol: (symbol: string) => apiFetch<any>(`/news/${symbol}`),
    getMarket: () => apiFetch<{ market: any[]; disclaimer: string }>('/news/market'),
    refresh: () => apiFetch<{ bundles: any[]; disclaimer: string }>('/news/refresh', { method: 'POST' }),
    getSymbols: () => apiFetch<Array<{ symbol: string; displayName: string }>>('/news/symbols'),
  },
}
