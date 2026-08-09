import { describe, expect, it } from 'vitest'
import type { ErpData } from '../types'
import { calculateCashFlowSnapshot } from './cashflow'
import { emptyData } from './erp'
import { calculateInvoiceTotalWithVat, calculateVatAmount, createPayableEntry, markPayableInstallmentPaid, payableResidual, splitAmountAcrossInstallments, updatePayableEntry } from './finance'

const dateKey = (offsetDays: number) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const baseData = (): ErpData => ({
  ...structuredClone(emptyData),
  plannerSettings: {
    ...structuredClone(emptyData.plannerSettings),
    ownerWithdrawalAmount: 0,
    ownerWithdrawalPlannedDate: dateKey(120),
  },
  bankAccounts: [{
    id: 'b1',
    name: 'Banca',
    iban: 'IT00TEST',
    creditLimit: 50000,
    blockOverLimit: false,
    minimumBalanceAlert: 0,
    currentBalance: 20000,
    createdAt: `${dateKey(-30)}T00:00:00.000Z`,
  }],
  financialEvents: [],
  payables: [],
})

describe('payables scadenzario', () => {
  it('calcola IVA e totale fattura fornitore (esempio 6000 + 22%)', () => {
    const taxable = 6000
    const vat = calculateVatAmount(taxable, 22)
    const total = calculateInvoiceTotalWithVat(taxable, vat)

    expect(vat).toBe(1320)
    expect(total).toBe(7320)
  })

  it('divisione automatica arrotonda ai centesimi e preserva il totale', () => {
    const parts = splitAmountAcrossInstallments(100, 3)
    expect(parts).toEqual([33.33, 33.33, 33.34])
    expect(parts.reduce((sum, item) => sum + item, 0)).toBe(100)
  })

  it('gestisce fattura fornitore in unica soluzione', () => {
    const data = createPayableEntry(baseData(), {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Ricambi paraurti',
      supplierName: 'Ricambi SRL',
      invoiceNumber: 'RF-100',
      invoiceDate: dateKey(-1),
      taxableAmount: 1000,
      vatAmount: 220,
      totalAmount: 1220,
      paymentMethod: 'Bonifico',
      dueDate: dateKey(10),
      notes: '',
      installments: [{ installmentNo: 1, amount: 1220, dueDate: dateKey(10) }],
    })

    expect(data.payables?.length).toBe(1)
    expect(data.payables?.[0].installments.length).toBe(1)
    expect(payableResidual(data.payables?.[0] as NonNullable<ErpData['payables']>[number])).toBe(1220)
  })

  it('gestisce fattura fornitore rateizzata e somma rate coerente', () => {
    const data = createPayableEntry(baseData(), {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Vernici e materiali',
      supplierName: 'Colori SPA',
      invoiceNumber: 'RF-200',
      invoiceDate: dateKey(-2),
      taxableAmount: 3000,
      vatAmount: 660,
      totalAmount: 3660,
      paymentMethod: 'Bonifico',
      dueDate: dateKey(5),
      notes: '',
      installments: [
        { installmentNo: 1, amount: 1220, dueDate: dateKey(5) },
        { installmentNo: 2, amount: 1220, dueDate: dateKey(35) },
        { installmentNo: 3, amount: 1220, dueDate: dateKey(65) },
      ],
    })

    const payable = data.payables?.[0]
    expect(payable?.installments.length).toBe(3)
    expect(payableResidual(payable as NonNullable<ErpData['payables']>[number])).toBe(3660)
  })

  it('blocca salvataggio quando la somma rate non coincide col totale', () => {
    expect(() => createPayableEntry(baseData(), {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Ricambi',
      supplierName: 'Ricambi SRL',
      invoiceNumber: 'RF-ERR',
      invoiceDate: dateKey(-1),
      taxableAmount: 1000,
      vatAmount: 220,
      totalAmount: 1220,
      paymentMethod: 'Bonifico',
      dueDate: dateKey(10),
      notes: '',
      installments: [
        { installmentNo: 1, amount: 600, dueDate: dateKey(10) },
        { installmentNo: 2, amount: 600, dueDate: dateKey(40) },
      ],
    })).toThrowError('La somma delle rate deve coincidere con il totale.')
  })

  it('gestisce F24 in unica soluzione', () => {
    const data = createPayableEntry(baseData(), {
      kind: 'f24',
      category: 'f24-imposte',
      description: 'F24 IVA',
      totalAmount: 1200,
      paymentMethod: 'F24',
      dueDate: dateKey(6),
      referencePeriod: '2026-08',
      accountantNote: 'Codice tributo 6008',
      notes: '',
      installments: [{ installmentNo: 1, amount: 1200, dueDate: dateKey(6) }],
    })

    expect(data.payables?.[0].kind).toBe('f24')
    expect(data.payables?.[0].status).toBe('Da pagare')
  })

  it('gestisce F24 rateizzato con rate manuali differenziate', () => {
    const data = createPayableEntry(baseData(), {
      kind: 'f24',
      category: 'f24-imposte',
      description: 'F24 IVA',
      totalAmount: 12000,
      paymentMethod: 'F24',
      dueDate: dateKey(7),
      referencePeriod: '2026-08',
      accountantNote: 'Piano commercialista',
      notes: '',
      installments: [
        { installmentNo: 1, amount: 2500, dueDate: dateKey(7) },
        { installmentNo: 2, amount: 1500, dueDate: dateKey(37) },
        { installmentNo: 3, amount: 2000, dueDate: dateKey(67) },
        { installmentNo: 4, amount: 2000, dueDate: dateKey(97) },
        { installmentNo: 5, amount: 2000, dueDate: dateKey(127) },
        { installmentNo: 6, amount: 2000, dueDate: dateKey(157) },
      ],
    })

    const payable = data.payables?.[0]
    const paid = payable?.installments.filter((item) => item.status === 'Pagato').length ?? 0
    expect(payable?.installments.length).toBe(6)
    expect(paid).toBe(0)
    expect(payableResidual(payable as NonNullable<ErpData['payables']>[number])).toBe(12000)
  })

  it('consente modifica manuale rate (importo, scadenza, nota) mantenendo totale coerente', () => {
    const created = createPayableEntry(baseData(), {
      kind: 'f24',
      category: 'f24-imposte',
      description: 'F24 IVA',
      totalAmount: 3000,
      paymentMethod: 'F24',
      dueDate: dateKey(7),
      referencePeriod: '2026-08',
      notes: '',
      installments: [
        { installmentNo: 1, amount: 1000, dueDate: dateKey(7), note: '' },
        { installmentNo: 2, amount: 1000, dueDate: dateKey(37), note: '' },
        { installmentNo: 3, amount: 1000, dueDate: dateKey(67), note: '' },
      ],
    })
    const payable = created.payables?.[0] as NonNullable<ErpData['payables']>[number]

    const updated = updatePayableEntry(created, payable.id, {
      kind: 'f24',
      category: 'f24-imposte',
      description: 'F24 IVA',
      totalAmount: 3000,
      paymentMethod: 'F24',
      dueDate: dateKey(7),
      referencePeriod: '2026-08',
      notes: '',
      installments: [
        { installmentNo: 1, amount: 1200, dueDate: dateKey(8), note: 'Rata iniziale' },
        { installmentNo: 2, amount: 800, dueDate: dateKey(38), note: 'Piano commercialista' },
        { installmentNo: 3, amount: 1000, dueDate: dateKey(68), note: 'Saldo' },
      ],
    })

    const next = updated.payables?.[0] as NonNullable<ErpData['payables']>[number]
    expect(next.installments[0].amount).toBe(1200)
    expect(next.installments[1].dueDate).toBe(dateKey(38))
    expect(next.installments[2].note).toBe('Saldo')
    expect(payableResidual(next)).toBe(3000)
  })

  it('pagamento rata aggiorna residuo, eventi e cashflow', () => {
    const created = createPayableEntry(baseData(), {
      kind: 'f24',
      category: 'f24-imposte',
      description: 'F24 INPS',
      totalAmount: 3000,
      paymentMethod: 'F24',
      dueDate: dateKey(4),
      referencePeriod: '2026-08',
      notes: '',
      installments: [
        { installmentNo: 1, amount: 1500, dueDate: dateKey(4) },
        { installmentNo: 2, amount: 1500, dueDate: dateKey(40) },
      ],
    })
    const before = calculateCashFlowSnapshot(created, dateKey(0))
    const payable = created.payables?.[0] as NonNullable<ErpData['payables']>[number]
    const firstInstallment = payable.installments[0]

    const paid = markPayableInstallmentPaid(created, {
      payableId: payable.id,
      installmentId: firstInstallment.id,
      paymentDate: dateKey(1),
    })

    const after = calculateCashFlowSnapshot(paid, dateKey(0))
    const updated = paid.payables?.[0] as NonNullable<ErpData['payables']>[number]
    expect(updated.installments[0].status).toBe('Pagato')
    expect(payableResidual(updated)).toBe(1500)
    expect(paid.financialEvents.some((event) => event.type === 'Pagamento uscita' && event.payableId === payable.id)).toBe(true)
    expect(after.windows[0].outflow).toBeLessThan(before.windows[0].outflow)
  })

  it('marca scaduta una rata non pagata oltre la data', () => {
    const data = createPayableEntry(baseData(), {
      kind: 'planned-outflow',
      category: 'altre-uscite',
      description: 'Noleggio ponte',
      totalAmount: 800,
      paymentMethod: 'Bonifico',
      dueDate: dateKey(-3),
      notes: '',
      installments: [{ installmentNo: 1, amount: 800, dueDate: dateKey(-3) }],
    })

    expect(data.payables?.[0].status).toBe('Scaduto')
    expect(data.payables?.[0].installments[0].status).toBe('Scaduto')
  })

  it('evita doppio conteggio su F24 rateizzato nel cashflow', () => {
    const data = createPayableEntry(baseData(), {
      kind: 'f24',
      category: 'f24-imposte',
      description: 'F24 IVA',
      totalAmount: 12000,
      paymentMethod: 'F24',
      dueDate: dateKey(5),
      referencePeriod: '2026-08',
      notes: '',
      installments: [
        { installmentNo: 1, amount: 2000, dueDate: dateKey(5) },
        { installmentNo: 2, amount: 2000, dueDate: dateKey(35) },
        { installmentNo: 3, amount: 2000, dueDate: dateKey(65) },
        { installmentNo: 4, amount: 2000, dueDate: dateKey(95) },
        { installmentNo: 5, amount: 2000, dueDate: dateKey(125) },
        { installmentNo: 6, amount: 2000, dueDate: dateKey(155) },
      ],
    })

    const snapshot30 = calculateCashFlowSnapshot(data, dateKey(0))
    expect(snapshot30.windows[0].outflow).toBe(2000)
  })

  it('passando da rateizzato a unica soluzione evita doppio conteggio nel cashflow', () => {
    const created = createPayableEntry(baseData(), {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Materiali',
      supplierName: 'Colori SPA',
      invoiceNumber: 'RF-300',
      invoiceDate: dateKey(-2),
      taxableAmount: 3000,
      vatAmount: 660,
      totalAmount: 3660,
      paymentMethod: 'Bonifico',
      dueDate: dateKey(5),
      notes: '',
      installments: [
        { installmentNo: 1, amount: 1220, dueDate: dateKey(5) },
        { installmentNo: 2, amount: 1220, dueDate: dateKey(35) },
        { installmentNo: 3, amount: 1220, dueDate: dateKey(65) },
      ],
    })
    const payable = created.payables?.[0] as NonNullable<ErpData['payables']>[number]

    const single = updatePayableEntry(created, payable.id, {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Materiali',
      supplierName: 'Colori SPA',
      invoiceNumber: 'RF-300',
      invoiceDate: dateKey(-2),
      taxableAmount: 3000,
      vatAmount: 660,
      totalAmount: 3660,
      paymentMethod: 'Bonifico',
      dueDate: dateKey(5),
      notes: '',
      installments: [{ installmentNo: 1, amount: 3660, dueDate: dateKey(5), note: 'Saldo unico' }],
    })

    const snapshot = calculateCashFlowSnapshot(single, dateKey(0))
    expect((single.payables?.[0].installments.length ?? 0)).toBe(1)
    expect(snapshot.windows[0].outflow).toBe(3660)
  })
})
