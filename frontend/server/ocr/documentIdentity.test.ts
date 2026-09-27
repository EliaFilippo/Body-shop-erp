import { describe, expect, it } from 'vitest'
import { normalizeAzureIdentityDocumentResult } from './documentIdentity.js'

describe('normalizeAzureIdentityDocumentResult', () => {
  it('mappa i campi Azure nei campi normalizzati del documento', () => {
    const result = normalizeAzureIdentityDocumentResult({
      status: 'succeeded',
      analyzeResult: {
        content: 'CARTA D\'IDENTITA\nCodice fiscale RSSMRA80A01H501U',
        documents: [{
          docType: 'idDocument.nationalIdentityCard',
          fields: {
            FirstName: { valueString: 'Mario', confidence: 0.98 },
            LastName: { valueString: 'Rossi', confidence: 0.99 },
            PersonalNumber: { valueString: 'RSSMRA80A01H501U', confidence: 0.97 },
            DateOfBirth: { valueDate: '1980-01-01', confidence: 0.96 },
            PlaceOfBirth: { valueString: 'Roma', confidence: 0.88 },
            Address: { content: 'Via Roma 1 Torino', confidence: 0.92 },
            DocumentNumber: { valueString: 'CA1234567', confidence: 0.95 },
            DateOfIssue: { valueDate: '2020-05-10', confidence: 0.93 },
            DateOfExpiration: { valueDate: '2030-05-10', confidence: 0.94 },
            IssuingAuthority: { valueString: 'Comune di Torino', confidence: 0.87 },
          },
        }],
      },
    })

    expect(result.documentType).toBe('identity_card')
    expect(result.fields.firstName.value).toBe('Mario')
    expect(result.fields.lastName.value).toBe('Rossi')
    expect(result.fields.taxCode.value).toBe('RSSMRA80A01H501U')
    expect(result.fields.birthDate.value).toBe('1980-01-01')
    expect(result.fields.birthPlace.value).toBe('Roma')
    expect(result.fields.residence.value).toBe('Via Roma 1 Torino')
    expect(result.fields.documentNumber.value).toBe('CA1234567')
    expect(result.fields.issueDate.value).toBe('2020-05-10')
    expect(result.fields.expiryDate.value).toBe('2030-05-10')
    expect(result.fields.issuingAuthority.value).toBe('Comune di Torino')
  })

  it('lascia vuoto un campo mancante', () => {
    const result = normalizeAzureIdentityDocumentResult({
      status: 'succeeded',
      analyzeResult: {
        content: 'PATENTE',
        documents: [{
          docType: 'idDocument.driverLicense',
          fields: {
            FirstName: { valueString: 'Giulia', confidence: 0.95 },
          },
        }],
      },
    })

    expect(result.documentType).toBe('driving_license')
    expect(result.fields.firstName.value).toBe('Giulia')
    expect(result.fields.lastName.value).toBe('')
    expect(result.fields.lastName.confidence).toBeNull()
  })

  it('compila i valori a confidence media e lascia vuoti quelli a confidence bassa', () => {
    const result = normalizeAzureIdentityDocumentResult({
      status: 'succeeded',
      analyzeResult: {
        content: 'CARTA D\'IDENTITA',
        documents: [{
          docType: 'idDocument.nationalIdentityCard',
          fields: {
            FirstName: { valueString: 'Mario', confidence: 0.61 },
            LastName: { valueString: 'Rossi', confidence: 0.44 },
          },
        }],
      },
    })

    expect(result.fields.firstName.value).toBe('Mario')
    expect(result.fields.firstName.confidence).toBe(0.61)
    expect(result.fields.lastName.value).toBe('')
    expect(result.fields.lastName.confidence).toBe(0.44)
  })

  it('usa alias di proprieta Azure quando i nomi principali non sono presenti', () => {
    const result = normalizeAzureIdentityDocumentResult({
      status: 'succeeded',
      analyzeResult: {
        content: 'CARTA D\'IDENTITA',
        documents: [{
          docType: 'idDocument.nationalIdentityCard',
          fields: {
            GivenName: { valueString: 'Anna', confidence: 0.93 },
            Surname: { valueString: 'Verdi', confidence: 0.91 },
            BirthDate: { valueDate: '1992-04-01', confidence: 0.9 },
            ExpirationDate: { valueDate: '2032-04-01', confidence: 0.91 },
          },
        }],
      },
    })

    expect(result.fields.firstName.value).toBe('Anna')
    expect(result.fields.lastName.value).toBe('Verdi')
    expect(result.fields.birthDate.value).toBe('1992-04-01')
    expect(result.fields.expiryDate.value).toBe('2032-04-01')
  })

  it('gestisce una risposta Azure incompleta senza errori', () => {
    const result = normalizeAzureIdentityDocumentResult({
      status: 'succeeded',
      analyzeResult: {
        content: '',
        documents: [],
      },
    })

    expect(result.success).toBe(true)
    expect(result.documentType).toBe('unknown')
    expect(result.fields.documentNumber.value).toBe('')
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})