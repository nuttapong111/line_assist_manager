import { Request, Response, NextFunction } from 'express'
import { createUserIfNotExists, updateUserProfile } from '../services/user.service'
import { verifyLineAccessToken } from '../services/line-auth.service'

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  return token.length > 0 ? token : null
}

function isDevBypassAllowed(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_AUTH_BYPASS === 'true' &&
    !!process.env.DEV_LINE_USER_ID
  )
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const accessToken = extractBearerToken(req)

  if (!accessToken) {
    if (isDevBypassAllowed()) {
      const devUserId = process.env.DEV_LINE_USER_ID!
      try {
        req.user = await createUserIfNotExists(devUserId)
        return next()
      } catch {
        return res.status(500).json({ error: true, code: 'INTERNAL', message: 'Auth failed' })
      }
    }
    return res.status(401).json({
      error: true,
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header. Use Bearer LIFF access token.',
    })
  }

  try {
    const profile = await verifyLineAccessToken(accessToken)
    const user = await createUserIfNotExists(profile.userId)

    if (profile.displayName && user.displayName !== profile.displayName) {
      const updated = await updateUserProfile(user.id, {
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
      })
      req.user = updated as typeof req.user
    } else {
      req.user = user
    }

    next()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Auth failed'
    console.warn('[auth] Token verification failed:', message)
    return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Invalid LINE access token' })
  }
}
