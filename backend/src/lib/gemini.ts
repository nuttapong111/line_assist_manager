import { GoogleGenerativeAI } from '@google/generative-ai'

const DEFAULT_MODEL = 'gemini-2.0-flash'

export function hasGeminiKey(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim()
}

export function getGeminiModel(jsonMode = false, systemInstruction?: string) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

  const genAI = new GoogleGenerativeAI(apiKey)
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    systemInstruction: systemInstruction || undefined,
    generationConfig: jsonMode ? { responseMimeType: 'application/json' } : undefined,
  })
}

export function parseJsonFromText(text: string): unknown {
  const cleaned = text.replace(/```json\n?|```/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  return JSON.parse(match ? match[0] : cleaned)
}
