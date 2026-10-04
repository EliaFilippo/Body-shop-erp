import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoneyInput } from './MoneyInput'
import { useState } from 'react'

afterEach(cleanup)
describe('importi durante la digitazione', () => {
  it('conserva tutte le cifre delle migliaia e normalizza alla fine', () => {
    const onValueChange = vi.fn()
    function ControlledInput() {
      const [value, setValue] = useState<number | null>(0)
      return <MoneyInput aria-label="Obiettivo" value={value} onValueChange={next => { setValue(next); onValueChange(next) }} />
    }
    render(<ControlledInput />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    for (const value of ['8', '8.', '8.0', '8.00', '8.000']) {
      fireEvent.change(input, { target: { value } })
      expect(input).toHaveValue(value)
    }
    fireEvent.blur(input)
    expect(onValueChange).toHaveBeenLastCalledWith(8000)
    expect(input).toHaveValue(new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(8000))
  })
  it('accetta importi incollati con migliaia e centesimi', () => {
    const onValueChange = vi.fn()
    render(<MoneyInput value={0} onValueChange={onValueChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '40.000,50 €' } })
    fireEvent.blur(input)
    expect(onValueChange).toHaveBeenLastCalledWith(40000.5)
  })
})
