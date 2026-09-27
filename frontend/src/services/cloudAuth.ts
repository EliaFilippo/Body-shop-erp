export interface CloudAuthConfig {
  url: string
  anonKey: string
}

export interface CloudAuthSession {
  accessToken: string
  refreshToken: string
  expiresIn: number
  userId: string
  email: string
}

interface SupabaseTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  user?: { id?: string; email?: string }
  error_description?: string
  msg?: string
}

export function getCloudAuthConfig(env: Record<string, unknown> = import.meta.env): CloudAuthConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim().replace(/\/$/, '')
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  return url && anonKey ? { url, anonKey } : null
}

export async function signInWithPassword(email: string, password: string, config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<CloudAuthSession> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !password) throw new Error('Inserisci email e password.')
  const response = await fetcher(`${config.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.anonKey },
    body: JSON.stringify({ email: normalizedEmail, password }),
  })
  const payload = await response.json() as SupabaseTokenResponse
  if (!response.ok || !payload.access_token || !payload.user?.id) {
    throw new Error(payload.error_description || payload.msg || 'Accesso non riuscito. Controlla email e password.')
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? '',
    expiresIn: Math.max(0, Number(payload.expires_in ?? 0)),
    userId: payload.user.id,
    email: String(payload.user.email ?? normalizedEmail).toLowerCase(),
  }
}

export async function signOutCloud(session: Pick<CloudAuthSession, 'accessToken'>, config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${config.url}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}` },
  })
  if (!response.ok) throw new Error('Disconnessione cloud non riuscita.')
}
