import type { ErpData, StandardWorkPriceListItem } from '../types'

function normalizePriceListId(value?: string) {
  const normalized = String(value ?? '').trim()
  return normalized || crypto.randomUUID()
}

function normalizePriceListWorkName(value?: string) {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new Error('La lavorazione del listino e obbligatoria.')
  }
  if (!/[\p{L}\p{N}]/u.test(normalized)) {
    throw new Error('La lavorazione del listino non e valida.')
  }
  return normalized
}

export function normalizePriceListItem(item: Partial<StandardWorkPriceListItem> & { id?: string }): StandardWorkPriceListItem {
  const repairExtent = item.repairExtent === 'intero' || item.repairExtent === 'mezzo' ? item.repairExtent : ''
  const workId = String(item.workId ?? '').trim()
  return {
    id: normalizePriceListId(item.id),
    workId: workId || undefined,
    panelName: String(item.panelName ?? '').trim(),
    workName: normalizePriceListWorkName(item.workName),
    repairExtent,
    variantCycle: String(item.variantCycle ?? '').trim(),
    vatRate: Number.isFinite(Number(item.vatRate)) ? Math.max(0, Number(item.vatRate)) : 22,
    unitPrice: Number.isFinite(Number(item.unitPrice)) ? Math.max(0, Number(item.unitPrice)) : 0,
    active: Boolean(item.active),
    note: String(item.note ?? '').trim(),
  }
}

export function upsertPriceListItem(data: ErpData, item: StandardWorkPriceListItem): ErpData {
  const existing = data.plannerSettings?.standardWorkPriceList?.find((entry) => entry.id === item.id)
  const inferredWorkId = String(item.workId ?? existing?.workId ?? '').trim()
    || data.plannerSettings?.standardWorks?.find((work) => work.name.trim().toLowerCase() === item.workName.trim().toLowerCase())?.id
  const normalized = normalizePriceListItem({
    ...item,
    workId: inferredWorkId,
  })
  const currentList = data.plannerSettings?.standardWorkPriceList ?? []
  const nextList = currentList.some((entry) => entry.id === normalized.id)
    ? currentList.map((entry) => entry.id === normalized.id ? normalized : entry)
    : [normalized, ...currentList]

  return {
    ...data,
    plannerSettings: {
      ...data.plannerSettings,
      standardWorkPriceList: nextList,
    },
  }
}

export function setPriceListItemActive(data: ErpData, itemId: string, active: boolean): ErpData {
  const currentList = data.plannerSettings?.standardWorkPriceList ?? []
  const nextList = currentList.map((entry) => entry.id === itemId ? { ...entry, active } : entry)

  return {
    ...data,
    plannerSettings: {
      ...data.plannerSettings,
      standardWorkPriceList: nextList,
    },
  }
}

export function removePriceListItem(data: ErpData, itemId: string): ErpData {
  const currentList = data.plannerSettings?.standardWorkPriceList ?? []
  const nextList = currentList.filter((entry) => entry.id !== itemId)

  return {
    ...data,
    plannerSettings: {
      ...data.plannerSettings,
      standardWorkPriceList: nextList,
    },
  }
}
