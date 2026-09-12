import { useEffect, useMemo, useRef, useState } from 'react'
import {
  analyzeDocumentCapture,
  buildProcessedDocument,
  normalizedToPoints,
  pointsToNormalized,
  summarizeQuality,
  type CaptureAnalysisResult,
  type CapturePoint,
} from '../services/documentCapture'

interface DocumentCapturePanelProps {
  onReadDocument: (file: File, dataUrl: string) => void
  disabled?: boolean
}

let queuedDocumentCaptureFile: File | null = null

export function queueDocumentCaptureFile(file: File) {
  queuedDocumentCaptureFile = file
}

function consumeQueuedDocumentCaptureFile() {
  const queued = queuedDocumentCaptureFile
  queuedDocumentCaptureFile = null
  return queued
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizedPath(points: [CapturePoint, CapturePoint, CapturePoint, CapturePoint]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(point.x * 100).toFixed(2)} ${(point.y * 100).toFixed(2)}`).join(' ') + ' Z'
}

export function DocumentCapturePanel({ onReadDocument, disabled = false }: DocumentCapturePanelProps) {
  const [capture, setCapture] = useState<CaptureAnalysisResult | null>(null)
  const [corners, setCorners] = useState<[CapturePoint, CapturePoint, CapturePoint, CapturePoint] | null>(null)
  const [autoCorners, setAutoCorners] = useState<[CapturePoint, CapturePoint, CapturePoint, CapturePoint] | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const [captureError, setCaptureError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [finalPreview, setFinalPreview] = useState<{ file: File; dataUrl: string } | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const activeHandleRef = useRef<number | null>(null)

  const qualityLabel = useMemo(() => capture ? summarizeQuality(capture.quality) : '', [capture])

  const resetAll = () => {
    setCapture(null)
    setCorners(null)
    setAutoCorners(null)
    setManualMode(false)
    setCaptureMessage('')
    setCaptureError('')
    setFinalPreview(null)
    activeHandleRef.current = null
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  const loadCapture = async (file: File) => {
    setProcessing(true)
    setCaptureError('')
    setCaptureMessage('Analisi qualita immagine in corso...')
    setFinalPreview(null)

    try {
      const analyzed = await analyzeDocumentCapture(file)
      const normalized = pointsToNormalized(analyzed.defaultCorners, analyzed.width, analyzed.height)
      const normalizedAuto = pointsToNormalized(analyzed.detectedCorners ?? analyzed.defaultCorners, analyzed.width, analyzed.height)
      setCapture(analyzed)
      setCorners(normalized)
      setAutoCorners(normalizedAuto)
      setCaptureMessage('')

      if (analyzed.quality.issues.length) {
        setCaptureError(summarizeQuality(analyzed.quality))
        return
      }

      const processed = await buildProcessedDocument(analyzed.originalDataUrl, analyzed.defaultCorners, analyzed.originalFile.name)
      setFinalPreview(processed)
      setCaptureMessage('Documento acquisito. Controlla l\'anteprima prima della lettura OCR.')
    } catch {
      setCaptureError('Acquisizione non riuscita. Riprova con una foto piu nitida.')
    } finally {
      setProcessing(false)
    }
  }

  const handleSelectedFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void loadCapture(file)
  }

  useEffect(() => {
    if (capture) return
    const queuedFile = consumeQueuedDocumentCaptureFile()
    if (!queuedFile) return
    void loadCapture(queuedFile)
  }, [capture])

  const updateCornerFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const index = activeHandleRef.current
    if (index === null || !corners || !stageRef.current) return

    const rect = stageRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const x = clamp((event.clientX - rect.left) / rect.width, 0.02, 0.98)
    const y = clamp((event.clientY - rect.top) / rect.height, 0.02, 0.98)

    const next = [...corners] as [CapturePoint, CapturePoint, CapturePoint, CapturePoint]
    next[index] = { x, y }
    setCorners(next)
  }

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    activeHandleRef.current = index
    if ('setPointerCapture' in event.currentTarget) event.currentTarget.setPointerCapture(event.pointerId)
  }

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if ('releasePointerCapture' in event.currentTarget) event.currentTarget.releasePointerCapture(event.pointerId)
    activeHandleRef.current = null
  }

  const applyCurrentCorners = async () => {
    if (!capture || !corners) return
    setProcessing(true)
    setCaptureError('')
    setCaptureMessage('Preparazione documento in corso...')
    try {
      const points = normalizedToPoints(corners, capture.width, capture.height)
      const processed = await buildProcessedDocument(capture.originalDataUrl, points, capture.originalFile.name)
      setFinalPreview(processed)
      setCaptureMessage('Documento pronto per la lettura OCR.')
      setManualMode(false)
    } catch {
      setCaptureError('Impossibile applicare il ritaglio. Regola gli angoli e riprova.')
    } finally {
      setProcessing(false)
    }
  }

  const restoreAutomaticCrop = () => {
    if (!autoCorners) return
    setCorners(autoCorners)
    setManualMode(true)
  }

  const canRead = Boolean(finalPreview && capture && !capture.quality.issues.length)

  return <section className="document-capture-panel">
    <h4>Acquisisci documento</h4>
    {!capture && <div className="document-capture-start">
      <p>Posiziona il documento all'interno della cornice.</p>
      <div className="document-capture-actions">
        <button type="button" className="primary" disabled={disabled || processing} onClick={() => cameraInputRef.current?.click()}>Scatta foto</button>
        <button type="button" className="secondary" disabled={disabled || processing} onClick={() => galleryInputRef.current?.click()}>Carica dalla galleria</button>
      </div>
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleSelectedFile} style={{ display: 'none' }} />
      <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleSelectedFile} style={{ display: 'none' }} />
    </div>}

    {capture && <div className="document-capture-workflow">
      <div className="document-capture-banner">
        <p>Posiziona il documento all'interno della cornice</p>
      </div>

      <div className="document-crop-stage" ref={stageRef} onPointerMove={updateCornerFromPointer}>
        <img src={capture.originalDataUrl} alt="Documento acquisito" />
        {corners && <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={normalizedPath(corners)} />
        </svg>}
        {corners?.map((point, index) => <button
          key={`corner-${index}`}
          type="button"
          className="document-crop-handle"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          onPointerDown={(event) => beginDrag(event, index)}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label={`Angolo ${index + 1}`}
        />)}
      </div>

      {qualityLabel && <p className={capture.quality.issues.length ? 'goal-critical' : 'goal-ok'}>{qualityLabel}</p>}
      {captureMessage && <p className="goal-gap">{captureMessage}</p>}
      {captureError && <p className="goal-critical">{captureError}</p>}

      <div className="document-capture-actions wide">
        <button type="button" className="secondary" disabled={disabled || processing} onClick={() => setManualMode((current) => !current)}>Regola ritaglio manualmente</button>
        <button type="button" className="secondary" disabled={disabled || processing || !autoCorners} onClick={restoreAutomaticCrop}>Usa ritaglio automatico</button>
        <button type="button" className="secondary" disabled={disabled || processing} onClick={resetAll}>Rifai foto</button>
      </div>

      {manualMode && <div className="document-manual-actions">
        <button type="button" className="primary" disabled={disabled || processing} onClick={() => void applyCurrentCorners()}>Applica ritaglio manuale</button>
      </div>}

      {finalPreview && <div className="preview-card document-final-preview">
        <h4>Documento che verra letto</h4>
        <img src={finalPreview.dataUrl} alt="Anteprima finale documento" />
        <div className="document-capture-actions">
          <button type="button" className="primary" disabled={disabled || processing || !canRead} onClick={() => onReadDocument(finalPreview.file, finalPreview.dataUrl)}>Leggi documento</button>
          <button type="button" className="secondary" disabled={disabled || processing} onClick={resetAll}>Rifai foto</button>
        </div>
      </div>}
    </div>}
  </section>
}
