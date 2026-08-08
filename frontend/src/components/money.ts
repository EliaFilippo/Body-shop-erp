const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export const formatEditableMoney = (value: number) => {
  const normalized = round2(value)
  const hasDecimals = Math.abs(normalized - Math.trunc(normalized)) > 0
  if (!hasDecimals) return `${Math.trunc(normalized)}`
  return normalized.toFixed(2).replace('.', ',')
}

export const formatCurrencyIt = (value: number) => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(round2(value))

export function parseMoneyDraft(rawValue: string): number | null {
  const raw = rawValue.trim().replace(/\s/g, '')
  if (!raw) return null

  const cleaned = raw.replace(/[^\d,.-]/g, '')
  if (!cleaned) return null

  const hasNegative = cleaned.includes('-')
  const unsigned = cleaned.replace(/-/g, '')
  if (!unsigned) return null

  const lastComma = unsigned.lastIndexOf(',')
  const lastDot = unsigned.lastIndexOf('.')
  const decimalIndex = Math.max(lastComma, lastDot)

  if (decimalIndex >= 0) {
    const integerPart = unsigned.slice(0, decimalIndex).replace(/\D/g, '')
    const decimalPart = unsigned.slice(decimalIndex + 1).replace(/\D/g, '').slice(0, 2)
    const normalized = `${integerPart || '0'}${decimalPart ? `.${decimalPart}` : ''}`
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) return null
    return hasNegative ? -parsed : parsed
  }

  const integer = unsigned.replace(/\D/g, '')
  if (!integer) return null
  const parsed = Number(integer)
  if (!Number.isFinite(parsed)) return null
  return hasNegative ? -parsed : parsed
}

export function sanitizeMoneyDraft(rawValue: string, maxDecimals = 2): string {
  const cleaned = rawValue.replace(/[^\d,.-]/g, '').replace(/-/g, '')
  let decimalUsed = false
  let output = ''

  for (const char of cleaned.replace(/\./g, ',')) {
    if (char >= '0' && char <= '9') {
      output += char
      continue
    }
    if (char === ',' && !decimalUsed) {
      output += char
      decimalUsed = true
    }
  }

  if (!decimalUsed) return output

  const [integerPart = '', decimalPart = ''] = output.split(',')
  return `${integerPart},${decimalPart.slice(0, maxDecimals)}`
}
