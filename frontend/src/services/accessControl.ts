import type { AppUser, UserRole, View } from '../types'

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Titolare',
  office: 'Ufficio',
  production: 'Produzione',
}

const OFFICE_VIEWS = new Set<View>([
  'dashboard', 'today-shop', 'customers', 'vehicles', 'cones', 'planner', 'operator-program',
  'acceptance', 'pending-cases', 'confirmed-cases', 'estimates-jobs', 'finance',
])

const PRODUCTION_VIEWS = new Set<View>([
  'today-shop', 'vehicles', 'cones', 'planner', 'operator-program', 'estimates-jobs',
])

export function canAccessView(role: UserRole, view: View): boolean {
  if (role === 'owner') return true
  return role === 'office' ? OFFICE_VIEWS.has(view) : PRODUCTION_VIEWS.has(view)
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'owner'
}

export function getDefaultActiveUser(users: AppUser[] | undefined): AppUser | null {
  if (!users?.length) return null
  return users.find((user) => user.active && user.role === 'owner')
    ?? users.find((user) => user.active)
    ?? null
}

export function createAppUser(displayName: string, role: UserRole, now = new Date().toISOString(), email = ''): AppUser {
  const normalizedName = displayName.trim().replace(/\s+/g, ' ')
  if (!normalizedName) throw new Error('Inserisci il nome dell’utente.')
  const normalizedEmail = email.trim().toLowerCase()
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Inserisci un indirizzo email valido.')
  return {
    id: crypto.randomUUID(),
    displayName: normalizedName,
    email: normalizedEmail,
    authUserId: null,
    role,
    active: true,
    operatorId: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function upsertAppUser(users: AppUser[], user: AppUser): AppUser[] {
  const duplicate = users.find((item) => item.id !== user.id && item.displayName.localeCompare(user.displayName, 'it', { sensitivity: 'base' }) === 0)
  if (duplicate) throw new Error('Esiste già un utente con questo nome.')
  const normalizedEmail = user.email?.trim().toLowerCase()
  if (normalizedEmail && users.some((item) => item.id !== user.id && item.email?.trim().toLowerCase() === normalizedEmail)) throw new Error('Questa email è già associata a un altro utente.')
  const existing = users.some((item) => item.id === user.id)
  return existing ? users.map((item) => item.id === user.id ? user : item) : [...users, user]
}

export function setUserActive(users: AppUser[], userId: string, active: boolean, now = new Date().toISOString()): AppUser[] {
  const target = users.find((user) => user.id === userId)
  if (!target) throw new Error('Utente non trovato.')
  if (!active && target.role === 'owner' && users.filter((user) => user.active && user.role === 'owner').length === 1) {
    throw new Error('Non puoi disattivare l’unico titolare attivo.')
  }
  return users.map((user) => user.id === userId ? { ...user, active, updatedAt: now } : user)
}
