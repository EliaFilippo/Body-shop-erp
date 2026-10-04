import type { AcceptanceQuote } from '../types'

/** Customer charges must be explicitly entered, independently of internal costs. */
export function quoteCustomerLines(quote: AcceptanceQuote) {
  return quote.manualOnlyPricing ? quote.lines.filter(line => line.source === 'manual') : quote.lines
}
