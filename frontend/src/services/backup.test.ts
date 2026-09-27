import { describe, expect, it } from 'vitest'
import { emptyData } from './erp'
import { BACKUP_FORMAT, backupFilename, parseBackup, serializeBackup } from './backup'

describe('backup archivio ERP', () => {
  it('esporta e rilegge l’intero archivio con metadati e riepilogo', () => {
    const data = { ...emptyData, dbRevision: 12 }
    const raw = serializeBackup(data, '2026-09-27T14:30:00.000Z', 'https://erp.example.test')
    const backup = parseBackup(raw)
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.revision).toBe(12)
    expect(backup.appOrigin).toBe('https://erp.example.test')
    expect(backup.summary).toEqual({ customers: 0, vehicles: 0, estimates: 0, jobs: 0 })
    expect(backup.data).toEqual(data)
  })

  it('rifiuta file estranei o incompleti', () => {
    expect(() => parseBackup('{"hello":"world"}')).toThrow('backup compatibile')
    expect(() => parseBackup('{')).toThrow('JSON valido')
  })

  it('rifiuta un riepilogo alterato', () => {
    const parsed = JSON.parse(serializeBackup(emptyData))
    parsed.summary.vehicles = 4
    expect(() => parseBackup(JSON.stringify(parsed))).toThrow('riepilogo')
  })

  it('crea un nome file ordinabile e riconoscibile', () => {
    expect(backupFilename('2026-09-27T14:30:45.000Z')).toBe('body-shop-erp-backup-2026-09-27-14-30-45.json')
  })
})
