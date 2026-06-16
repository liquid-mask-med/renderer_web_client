import { useEffect, useRef, useState, type RefObject } from 'react'
import { vec3 } from 'gl-matrix'
import type { LocalBackend, VolumeData } from '../types'
import type { Renderer } from '../renderer/Renderer'
import { WebGlRenderer } from '../renderer/webgl/WebGlRenderer'
import { WebGpuRenderer } from '../renderer/webgpu/WebGpuRenderer'
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
  backend: LocalBackend
  volumeRef: RefObject<VolumeData | undefined>
  volumeVersion: number
  onError(message: string): void
}

const viewLabels = [
  ['Axial', 'A', 'R', 'L', 'P'],
  ['Coronal', 'S', 'R', 'L', 'I'],
  ['Sagittal', 'S', 'A', 'P', 'I'],
  ['Volume', '', '', '', ''],
]

export function ViewerCanvas({ backend, volumeRef, volumeVersion, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | undefined>(undefined)
  const [rendererVersion, setRendererVersion] = useState(0)
  const [crosshairs, setCrosshairs] = useState<SliceCrosshair[]>([])
  const [cursor, setCursor] = useState('crosshair')
  const mprRef = useRef(createMprState())
  const mappingsRef = useRef<SliceDisplayMapping[]>([])
  const crosshairsRef = useRef<SliceCrosshair[]>([])
  const draggingRef = useRef<SliceDrag | undefined>(undefined)
  const volumeDirtyRef = useRef(false)
  const renderFrameRef = useRef<number | undefined>(undefined)

  const stopRotation = () => {
    draggingRef.current = undefined
  }

  const markVolumeDirty = () => {
    volumeDirtyRef.current = true
    if (renderFrameRef.current !== undefined) return
    const renderDirty = () => {
      if (volumeDirtyRef.current) {
        volumeDirtyRef.current = false
        rendererRef.current?.render(1 << 3)
      }
      if (volumeDirtyRef.current) renderFrameRef.current = requestAnimationFrame(renderDirty)
      else renderFrameRef.current = undefined
    }
    renderFrameRef.current = requestAnimationFrame(renderDirty)
  }

  const updateSlices = () => {
    const renderer = rendererRef.current
    const volume = volumeRef.current
    const canvas = canvasRef.current
    if (!renderer || !volume || !canvas) return
    const width = Math.max(1, Math.floor(canvas.width / 2))
    const height = Math.max(1, Math.floor(canvas.height / 2))
    const mpr = mprRef.current
    const nextMappings: SliceDisplayMapping[] = []
    const nextCrosshairs: SliceCrosshair[] = []
    mpr.views.forEach(({ u, v }, index) => {
      const mapping = calculateSliceDisplayMapping(volume, mpr.origin, u, v, width, height)
      renderer.setUpSliceState(index, mpr.origin, u, v, mapping)
      nextMappings.push(mapping)
      nextCrosshairs.push(calculateSliceCrosshair(u, v, mapping, mpr.axes))
    })
    mappingsRef.current = nextMappings
    crosshairsRef.current = nextCrosshairs
    setCrosshairs(nextCrosshairs)
  }

  useEffect(() => {
    if (!canvasRef.current) return
    let cancelled = false
    let observer: ResizeObserver | undefined
    const initialize = async () => {
      try {
        const renderer = backend === 'WebGPU'
          ? await WebGpuRenderer.create(canvasRef.current!, onError)
          : new WebGlRenderer(canvasRef.current!, onError)
        if (cancelled) {
          renderer.dispose()
          return
        }
        rendererRef.current = renderer
      const resize = () => {
        const canvas = canvasRef.current!
        const width = Math.max(1, Math.floor(canvas.clientWidth * devicePixelRatio))
        const height = Math.max(1, Math.floor(canvas.clientHeight * devicePixelRatio))
        canvas.width = width
        canvas.height = height
        for (let index = 0; index < 4; index += 1) renderer.resizeViewport(index, width, height)
        updateSlices()
        renderer.render(0xF)
      }
      observer = new ResizeObserver(resize)
      observer.observe(canvasRef.current!)
      resize()
        setRendererVersion((current) => current + 1)
      } catch (reason) {
        onError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void initialize()
    return () => {
      cancelled = true
      observer?.disconnect()
      if (renderFrameRef.current !== undefined) cancelAnimationFrame(renderFrameRef.current)
      rendererRef.current?.dispose()
      rendererRef.current = undefined
    }
  }, [backend, onError])

  useEffect(() => {
    const volume = volumeRef.current
    if (!volume || !rendererRef.current) return
    try {
      rendererRef.current.setUpRenderParameters(volume)
      mprRef.current = createMprState()
      updateSlices()
      rendererRef.current.render(0x7)
      // Let the three MPR views reach the screen before the original volume ray-cast runs.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        rendererRef.current?.render(1 << 3)
      }))
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [volumeVersion, rendererVersion, onError])

  const viewIndexAt = (x: number, y: number) => (y < 0.5 ? 0 : 2) + (x >= 0.5 ? 1 : 0)
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
          updateSlices()
          rendererRef.current?.render(0x7)
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
            const dx = event.clientX - drag.x
            const dy = event.clientY - drag.y
            draggingRef.current = { mode: 'volume', x: event.clientX, y: event.clientY }
            rendererRef.current?.rotateCamera(dx, dy)
            markVolumeDirty()
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
          updateSlices()
          rendererRef.current?.render(0x7)
        }}
        onPointerUp={stopRotation}
        onPointerCancel={stopRotation}
      />
      {viewLabels.map(([title, top, left, right, bottom], index) => (
        <div className={`view-overlay overlay-${index}${volumeRef.current ? '' : ' empty'}`} key={title}>
          {index < 3 && <SliceCrosshairOverlay crosshair={crosshairs[index]} />}
          <div className="viewport-title">{title}</div>
          <span className="marker marker-top">{top}</span>
          <span className="marker marker-left">{left}</span>
          <span className="marker marker-right">{right}</span>
          <span className="marker marker-bottom">{bottom}</span>
          {!volumeRef.current && <div className="empty-state">选择 DICOM 文件夹</div>}
        </div>
      ))}
    </div>
  )
}
