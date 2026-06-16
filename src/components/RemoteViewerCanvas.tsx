import { useEffect, useRef, useState, type RefObject } from 'react'
import { vec3 } from 'gl-matrix'
import type { RendererSettings, VolumeData } from '../types'
import { RemoteRenderer } from '../renderer/remote/RemoteRenderer'
import { calculateSliceDisplayMapping } from '../mpr/sliceGeometry'
import { calculateSliceCrosshair, type SliceCrosshair } from '../mpr/crosshairGeometry'
import { SliceCrosshairOverlay } from './SliceCrosshairOverlay'
import {
  createMprState,
  hitTestCrosshair,
  rotateMpr,
  translateMpr,
  type SliceDrag,
} from '../mpr/mprInteraction'
import type { SliceDisplayMapping } from '../mpr/sliceGeometry'

interface Props {
  volumeRef: RefObject<VolumeData | undefined>
  volumeVersion: number
  settings: RendererSettings
  onStatus(message: string): void
  onError(message: string): void
}

const labels = [
  ['Axial', 'A', 'R', 'L', 'P'], ['Coronal', 'S', 'R', 'L', 'I'],
  ['Sagittal', 'S', 'A', 'P', 'I'], ['Volume', '', '', '', ''],
]

export function RemoteViewerCanvas({ volumeRef, volumeVersion, settings, onStatus, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<RemoteRenderer | undefined>(undefined)
  const mprRef = useRef(createMprState())
  const mappingsRef = useRef<SliceDisplayMapping[]>([])
  const crosshairsRef = useRef<SliceCrosshair[]>([])
  const draggingRef = useRef<SliceDrag | undefined>(undefined)
  const rotationRunningRef = useRef(false)
  const sliceUpdateRunningRef = useRef(false)
  const sliceUpdateRequestedRef = useRef(false)
  const operationRef = useRef(Promise.resolve())
  const [crosshairs, setCrosshairs] = useState<SliceCrosshair[]>([])
  const [cursor, setCursor] = useState('crosshair')

  const enqueue = (operation: () => Promise<void>) => {
    operationRef.current = operationRef.current
      .then(operation)
      .catch((reason) => {
        onError(reason instanceof Error ? reason.message : String(reason))
      })
  }

  const stopRotation = () => {
    draggingRef.current = undefined
  }

  const rotateIfIdle = (dx: number, dy: number) => {
    if (rotationRunningRef.current || (!dx && !dy)) return
    rotationRunningRef.current = true
    enqueue(async () => {
      try {
        await rendererRef.current!.rotateCamera(dx, dy)
        await draw(3)
      } finally {
        rotationRunningRef.current = false
      }
    })
  }

  const updateSlices = async () => {
    const renderer = rendererRef.current!
    const volume = volumeRef.current
    const canvas = canvasRef.current
    if (!volume || !canvas) return
    const width = Math.max(1, Math.floor(canvas.width / 2)), height = Math.max(1, Math.floor(canvas.height / 2))
    const mpr = mprRef.current
    const origin = vec3.clone(mpr.origin)
    const axes = mpr.axes.map((axis) => vec3.clone(axis))
    const views = mpr.views.map(({ u, v }) => ({ u: vec3.clone(u), v: vec3.clone(v) }))
    const nextMappings: SliceDisplayMapping[] = []
    const nextCrosshairs: SliceCrosshair[] = []
    for (let index = 0; index < views.length; index += 1) {
      const { u, v } = views[index]
      const mapping = calculateSliceDisplayMapping(volume, origin, u, v, width, height)
      await renderer.setUpSliceState(index, origin, u, v, mapping)
      nextMappings.push(mapping)
      nextCrosshairs.push(calculateSliceCrosshair(u, v, mapping, axes))
    }
    mappingsRef.current = nextMappings
    crosshairsRef.current = nextCrosshairs
    setCrosshairs(nextCrosshairs)
  }

  const requestSliceUpdate = () => {
    sliceUpdateRequestedRef.current = true
    if (sliceUpdateRunningRef.current) return
    sliceUpdateRunningRef.current = true
    enqueue(async () => {
      try {
        while (sliceUpdateRequestedRef.current) {
          sliceUpdateRequestedRef.current = false
          await updateSlices()
          for (let index = 0; index < 3; index += 1) await draw(index)
        }
      } finally {
        sliceUpdateRunningRef.current = false
      }
    })
  }

  const resize = async () => {
    const canvas = canvasRef.current!, renderer = rendererRef.current!
    canvas.width = Math.max(2, Math.floor(canvas.clientWidth))
    canvas.height = Math.max(2, Math.floor(canvas.clientHeight))
    const width = Math.floor(canvas.width / 2), height = Math.floor(canvas.height / 2)
    for (let index = 0; index < 4; index += 1) await renderer.resizeViewport(index, width, height)
  }

  const draw = async (index: number) => {
    const result = await rendererRef.current!.render(index)
    const rgba = new Uint8ClampedArray(result.bytes.length)
    for (let pixel = 0; pixel < result.bytes.length; pixel += 4) {
      rgba[pixel] = result.bytes[pixel + 2]
      rgba[pixel + 1] = result.bytes[pixel + 1]
      rgba[pixel + 2] = result.bytes[pixel]
      rgba[pixel + 3] = result.bytes[pixel + 3]
    }
    const image = new ImageData(rgba, result.width, result.height)
    const context = canvasRef.current!.getContext('2d')!
    const x = index % 2 === 0 ? 0 : result.width
    const y = index < 2 ? 0 : result.height
    context.putImageData(image, x, y)
  }

  useEffect(() => {
    const renderer = new RemoteRenderer(settings.serverUrl, settings.remoteBackend)
    rendererRef.current = renderer
    enqueue(async () => {
      onStatus(`正在连接远程 ${settings.remoteBackend}…`)
      await renderer.initialize()
      await resize()
      onStatus(`远程 ${settings.remoteBackend} 已连接`)
    })
    return () => { void renderer.dispose() }
  }, [settings.serverUrl, settings.remoteBackend])

  useEffect(() => {
    const volume = volumeRef.current
    if (!volume) return
    enqueue(async () => {
      onStatus('正在上传体数据到 renderer_server…')
      await rendererRef.current!.setUpRenderParameters(volume)
      mprRef.current = createMprState()
      await updateSlices()
      for (let index = 0; index < 4; index += 1) await draw(index)
      onStatus(`远程 ${settings.remoteBackend} 渲染完成`)
    })
  }, [volumeVersion])

  const viewIndexAt = (x: number, y: number) => (y < .5 ? 0 : 2) + (x >= .5 ? 1 : 0)
  const pointerInView = (clientX: number, clientY: number, viewIndex: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const width = rect.width / 2
    const height = rect.height / 2
    return {
      x: clientX - rect.left - (viewIndex % 2) * width,
      y: clientY - rect.top - (viewIndex >= 2 ? height : 0),
      width,
      height,
    }
  }
  return (
    <div className="viewer-grid">
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onWheel={(event) => {
          const index = viewIndexAt(event.nativeEvent.offsetX / event.currentTarget.clientWidth, event.nativeEvent.offsetY / event.currentTarget.clientHeight)
          if (index === 3) return
          event.preventDefault()
          const view = mprRef.current.views[index]
          const normal = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), view.u, view.v))
          vec3.scaleAndAdd(mprRef.current.origin, mprRef.current.origin, normal, event.deltaY / 120)
          requestSliceUpdate()
        }}
        onPointerDown={(event) => {
          const index = viewIndexAt(event.nativeEvent.offsetX / event.currentTarget.clientWidth, event.nativeEvent.offsetY / event.currentTarget.clientHeight)
          const point = pointerInView(event.clientX, event.clientY, index)
          if (index === 3) {
            draggingRef.current = { mode: 'volume', x: event.clientX, y: event.clientY }
          } else {
            const mode = hitTestCrosshair(crosshairsRef.current[index], point.x, point.y, point.width, point.height)
            if (!mode) return
            draggingRef.current = { mode, viewIndex: index, x: point.x, y: point.y }
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = draggingRef.current
          if (!drag) {
            const index = viewIndexAt(event.nativeEvent.offsetX / event.currentTarget.clientWidth, event.nativeEvent.offsetY / event.currentTarget.clientHeight)
            if (index === 3) setCursor('crosshair')
            else {
              const point = pointerInView(event.clientX, event.clientY, index)
              const hit = hitTestCrosshair(crosshairsRef.current[index], point.x, point.y, point.width, point.height)
              setCursor(hit === 'translate' ? 'move' : hit === 'rotate' ? 'grab' : 'crosshair')
            }
            return
          }
          if (drag.mode === 'volume') {
            draggingRef.current = { mode: 'volume', x: event.clientX, y: event.clientY }
            rotateIfIdle(event.clientX - drag.x, event.clientY - drag.y)
            return
          }
          const point = pointerInView(event.clientX, event.clientY, drag.viewIndex)
          if (drag.mode === 'translate') {
            translateMpr(mprRef.current, drag.viewIndex, point.x - drag.x, point.y - drag.y, point.width, point.height, mappingsRef.current[drag.viewIndex])
          } else {
            const center = crosshairsRef.current[drag.viewIndex].center
            if (center) rotateMpr(
              mprRef.current,
              drag.viewIndex,
              drag,
              point,
              { x: center.x / 100 * point.width, y: center.y / 100 * point.height },
            )
          }
          draggingRef.current = { ...drag, x: point.x, y: point.y }
          requestSliceUpdate()
        }}
        onPointerUp={stopRotation}
        onPointerCancel={stopRotation}
      />
      {labels.map(([title, top, left, right, bottom], index) => (
        <div className={`view-overlay overlay-${index}${volumeRef.current ? '' : ' empty'}`} key={title}>
          {index < 3 && <SliceCrosshairOverlay crosshair={crosshairs[index]} />}
          <div className="viewport-title">{title}</div>
          <span className="marker marker-top">{top}</span><span className="marker marker-left">{left}</span>
          <span className="marker marker-right">{right}</span><span className="marker marker-bottom">{bottom}</span>
          {!volumeRef.current && <div className="empty-state">选择 DICOM 文件夹</div>}
        </div>
      ))}
    </div>
  )
}
