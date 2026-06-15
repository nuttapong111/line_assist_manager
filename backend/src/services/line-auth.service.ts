export interface VerifiedLineProfile {
  userId: string
  displayName: string
  pictureUrl?: string
}

function getExpectedChannelId(): string | undefined {
  if (process.env.LINE_CHANNEL_ID) return process.env.LINE_CHANNEL_ID
  const liffId = process.env.LIFF_ID
  if (liffId) return liffId.split('-')[0]
  return undefined
}

export async function verifyLineAccessToken(accessToken: string): Promise<VerifiedLineProfile> {
  const verifyRes = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
  )

  if (!verifyRes.ok) {
    throw new Error('Invalid or expired LINE access token')
  }

  const verifyData = (await verifyRes.json()) as { client_id?: string; expires_in?: number }
  const expectedChannelId = getExpectedChannelId()

  if (expectedChannelId && verifyData.client_id && verifyData.client_id !== expectedChannelId) {
    throw new Error('LINE token does not belong to this channel')
  }

  if (verifyData.expires_in !== undefined && verifyData.expires_in <= 0) {
    throw new Error('LINE access token expired')
  }

  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!profileRes.ok) {
    throw new Error('Failed to fetch LINE profile')
  }

  const profile = (await profileRes.json()) as {
    userId: string
    displayName: string
    pictureUrl?: string
  }

  if (!profile.userId?.startsWith('U')) {
    throw new Error('Invalid LINE user ID')
  }

  return {
    userId: profile.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
  }
}
