import { Request, Response, NextFunction } from 'express'
import { createUserIfNotExists } from '../services/user.service'

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const lineUserId = req.headers['x-line-user-id'] as string

  if (!lineUserId || !lineUserId.startsWith('U')) {
    return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Missing LINE user ID' })
  }

  try {
    req.user = await createUserIfNotExists(lineUserId)
    next()
  } catch {
    res.status(500).json({ error: true, code: 'INTERNAL', message: 'Auth failed' })
  }
}
