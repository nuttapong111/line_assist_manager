import crypto from 'crypto'

function getSecret(): string {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) throw new Error('LINE_CHANNEL_SECRET is required for OAuth state')
  return secret
}

export function signOAuthState(payload: string): string {
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifyOAuthState(state: string): string {
  const lastDot = state.lastIndexOf('.')
  if (lastDot === -1) throw new Error('Invalid OAuth state')

  const payload = state.slice(0, lastDot)
  const sig = state.slice(lastDot + 1)
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')

  if (sig.length !== expected.length) throw new Error('Invalid OAuth state signature')
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid OAuth state signature')
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload)) {
    throw new Error('Invalid OAuth state payload')
  }

  return payload
}
