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

export interface CloudCompanyMembership {
  companyId: string
  companyName: string
  role: 'owner' | 'office' | 'production'
}

interface SupabaseTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  user?: { id?: string; email?: string }
  error_description?: string
  msg?: string
}

interface SupabaseCompanyMembership {
  company_id?: string
  company_name?: string
  role?: string
}

export function getCloudAuthConfig(env: Record<string, unknown> = import.meta.env): CloudAuthConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim().replace(/\/$/, '')
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  return url && anonKey ? { url, anonKey } : null
}

export function getRecoveryAccessToken(hash = globalThis.location?.hash ?? ''): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  if (params.get('type') !== 'recovery') return null
  return params.get('access_token')?.trim() || null
}

export async function updateCloudPassword(
  accessToken: string,
  password: string,
  config: CloudAuthConfig,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!accessToken) throw new Error('Link di recupero non valido o scaduto.')
  if (password.length < 8) throw new Error('La nuova password deve contenere almeno 8 caratteri.')
  const response = await fetcher(`${config.url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    const payload = await response.json() as { message?: string; msg?: string }
    throw new Error(payload.message || payload.msg || 'Impossibile aggiornare la password.')
  }
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

export async function bootstrapCloudCompany(
  session: Pick<CloudAuthSession, 'accessToken'>,
  companyName: string,
  displayName: string,
  config: CloudAuthConfig,
  fetcher: typeof fetch = fetch,
): Promise<CloudCompanyMembership> {
  const response = await fetcher(`${config.url}/rest/v1/rpc/bootstrap_company`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ p_company_name: companyName.trim(), p_member_display_name: displayName.trim() }),
  })
  const payload = await response.json() as SupabaseCompanyMembership[] | { message?: string }
  if (!response.ok || !Array.isArray(payload) || !payload[0]?.company_id) {
    throw new Error(!Array.isArray(payload) && payload.message ? payload.message : 'Creazione azienda cloud non riuscita.')
  }
  const membership = payload[0]
  if (!['owner', 'office', 'production'].includes(String(membership.role))) throw new Error('Ruolo cloud non valido.')
  return {
    companyId: String(membership.company_id),
    companyName: String(membership.company_name ?? ''),
    role: membership.role as CloudCompanyMembership['role'],
  }
}
