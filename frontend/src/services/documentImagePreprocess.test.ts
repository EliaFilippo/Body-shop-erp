import { describe, expect, it } from 'vitest'
import { estimateDocumentQuadReliability, normalizeQuadOrder } from './documentImagePreprocess'

describe('documentImagePreprocess', () => {
  it('orders quad points in clockwise canonical order', () => {
    const points = [
      { x: 900, y: 560 },
      { x: 140, y: 120 },
      { x: 930, y: 90 },
      { x: 120, y: 610 },
    ]

    const [tl, tr, br, bl] = normalizeQuadOrder(points)

    expect(tl.x).toBe(140)
    expect(tl.y).toBe(120)
    expect(tr.x).toBe(930)
    expect(tr.y).toBe(90)
    expect(br.x).toBe(900)
    expect(br.y).toBe(560)
    expect(bl.x).toBe(120)
    expect(bl.y).toBe(610)
  })

  it('estimates high reliability for a plausible id-card quad', () => {
    const quad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 120, y: 130 },
      { x: 1010, y: 120 },
      { x: 980, y: 690 },
      { x: 140, y: 710 },
    ]

    const score = estimateDocumentQuadReliability(quad, 1200, 800)
    expect(score).toBeGreaterThan(0.55)
  })

  it('estimates low reliability for tiny skewed area', () => {
    const quad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 10, y: 10 },
      { x: 190, y: 8 },
      { x: 200, y: 100 },
      { x: 16, y: 120 },
    ]

    const score = estimateDocumentQuadReliability(quad, 1200, 800)
    expect(score).toBeLessThan(0.4)
  })
})
