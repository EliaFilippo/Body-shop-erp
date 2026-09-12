import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { DOCUMENT_IDENTITY_OCR_ENDPOINT, handleDocumentIdentityOcrRequest } from './api/documentIdentityRoute.js'
import { VEHICLE_BOOKLET_OCR_ENDPOINT, handleVehicleBookletOcrRequest } from './api/vehicleBookletRoute.js'

function toRequest(req: IncomingMessage) {
  const url = new URL(req.url ?? DOCUMENT_IDENTITY_OCR_ENDPOINT, 'http://localhost')
  return new Request(url, {
    method: req.method ?? 'GET',
    headers: req.headers as Record<string, string>,
    body: req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : (Readable.toWeb(req) as never),
    duplex: 'half' as never,
  })
}

async function writeResponse(nodeResponse: ServerResponse, response: Response) {
  nodeResponse.statusCode = response.status
  response.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value)
  })
  nodeResponse.end(await response.text())
}

function createMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const isIdentityRoute = req.url?.startsWith(DOCUMENT_IDENTITY_OCR_ENDPOINT)
    const isBookletRoute = req.url?.startsWith(VEHICLE_BOOKLET_OCR_ENDPOINT)
    if (!isIdentityRoute && !isBookletRoute) {
      next()
      return
    }

    try {
      const response = isIdentityRoute
        ? await handleDocumentIdentityOcrRequest(toRequest(req))
        : await handleVehicleBookletOcrRequest(toRequest(req))
      await writeResponse(res, response)
    } catch (error) {
      next(error)
    }
  }
}

export function documentIdentityOcrPlugin(): Plugin {
  return {
    name: 'document-identity-ocr-endpoint',
    configureServer(server) {
      server.middlewares.use(createMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(createMiddleware())
    },
  }
}