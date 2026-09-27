function fillRandomBytes(bytes: Uint8Array<ArrayBuffer>) {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
    return bytes
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function formatUuidFromBytes(bytes: Uint8Array<ArrayBuffer>) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function fallbackRandomUuid() {
  return formatUuidFromBytes(fillRandomBytes(new Uint8Array(16)))
}

if (globalThis.crypto && typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: fallbackRandomUuid,
    configurable: true,
    writable: true,
  })
}