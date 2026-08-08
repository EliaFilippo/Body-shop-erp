import { useEffect, useMemo, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { formatCurrencyIt, formatEditableMoney, parseMoneyDraft, sanitizeMoneyDraft } from './money'

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'inputMode'>

export interface MoneyInputProps extends NativeInputProps {
  value: number | null
  onValueChange: (value: number | null) => void
  allowEmpty?: boolean
  minValue?: number
  maxValue?: number
  showCurrencyOnBlur?: boolean
}

export function MoneyInput({
  value,
  onValueChange,
  allowEmpty = false,
  minValue,
  maxValue,
  showCurrencyOnBlur = true,
  ...props
}: MoneyInputProps) {
  const [isFocused, setIsFocused] = useState(false)

  const presentation = useMemo(() => {
    if (value === null || value === undefined) return ''
    return isFocused
      ? formatEditableMoney(value)
      : showCurrencyOnBlur
        ? formatCurrencyIt(value)
        : value.toFixed(2).replace('.', ',')
  }, [isFocused, showCurrencyOnBlur, value])

  const [draft, setDraft] = useState(presentation)

  useEffect(() => {
    if (isFocused) return
    setDraft(presentation)
  }, [isFocused, presentation])

  const clamp = (input: number) => {
    let next = round2(input)
    if (typeof minValue === 'number') next = Math.max(minValue, next)
    if (typeof maxValue === 'number') next = Math.min(maxValue, next)
    return round2(next)
  }

  return <input
    {...props}
    type="text"
    inputMode="decimal"
    value={draft}
    onFocus={() => {
      setIsFocused(true)
      const parsed = value ?? parseMoneyDraft(draft)
      setDraft(parsed === null ? '' : formatEditableMoney(parsed))
    }}
    onBlur={(event) => {
      setIsFocused(false)
      const parsed = parseMoneyDraft(draft)

      if (parsed === null) {
        const fallback = allowEmpty ? null : clamp(value ?? 0)
        onValueChange(fallback)
        setDraft(fallback === null ? '' : (showCurrencyOnBlur ? formatCurrencyIt(fallback) : fallback.toFixed(2).replace('.', ',')))
        props.onBlur?.(event)
        return
      }

      const normalized = clamp(parsed)
      onValueChange(normalized)
      setDraft(showCurrencyOnBlur ? formatCurrencyIt(normalized) : normalized.toFixed(2).replace('.', ','))
      props.onBlur?.(event)
    }}
    onChange={(event) => {
      const nextDraft = sanitizeMoneyDraft(event.target.value)
      setDraft(nextDraft)

      if (!nextDraft) {
        if (allowEmpty) onValueChange(null)
        return
      }

      const parsed = parseMoneyDraft(nextDraft)
      if (parsed === null) return
      onValueChange(clamp(parsed))
    }}
    onWheel={(event) => event.currentTarget.blur()}
  />
}
