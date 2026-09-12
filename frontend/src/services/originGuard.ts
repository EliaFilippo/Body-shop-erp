export const EXPECTED_APP_ORIGIN = 'http://localhost:5173'
export const ORIGIN_BLOCK_MESSAGE = `Apri il gestionale da ${EXPECTED_APP_ORIGIN}`

function runtimeLocation() {
  if (typeof window === 'undefined') return null
  return window.location
}

function isPrivateIpv4Host(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const parts = match.slice(1).map((part) => Number(part))
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function isAllowedDevOrigin(origin: string) {
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:') return false
    const port = Number(parsed.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') return true
    return isPrivateIpv4Host(host)
  } catch {
    return false
  }
}

export function currentOriginLabel() {
  const override = (globalThis as { __ERP_ORIGIN_OVERRIDE__?: string }).__ERP_ORIGIN_OVERRIDE__
  if (override) return override
  const location = runtimeLocation()
  return location?.origin ?? 'unknown'
}

export function isFileOrigin() {
  const override = (globalThis as { __ERP_ORIGIN_OVERRIDE__?: string }).__ERP_ORIGIN_OVERRIDE__
  if (override) return override.startsWith('file://')
  const location = runtimeLocation()
  return location?.protocol === 'file:'
}

function resolveEntryPath(pathname: string) {
  const normalized = pathname.replace(/\\/g, '/').toLowerCase()
  if (normalized.endsWith('/production.html')) return '/production.html'
  if (normalized.endsWith('/finance.html')) return '/finance.html'
  return '/'
}

export function tryRedirectFromFileOrigin() {
  const location = runtimeLocation()
  if (!location) return false
  if (location.protocol !== 'file:') return false
  const target = `${EXPECTED_APP_ORIGIN}${resolveEntryPath(location.pathname)}${location.search}${location.hash}`
  if (location.href === target) return false
  window.location.href = target
  return true
}

export function isAllowedPersistenceOrigin() {
  const override = (globalThis as { __ERP_ORIGIN_OVERRIDE__?: string }).__ERP_ORIGIN_OVERRIDE__
  if (import.meta.env.MODE === 'test' && !override) return true
  if (!import.meta.env.DEV) return true
  return isAllowedDevOrigin(currentOriginLabel())
}
