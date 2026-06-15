import { useEffect, useRef, useState, type RefObject } from 'react'
import { vec3 } from 'gl-matrix'
import type { LocalBackend, VolumeData } from '../types'
import type { Renderer } from '../renderer/Renderer'
import { WebGlRenderer } from '../renderer/webgl/WebGlRenderer'
import { WebGpuRenderer } from '../renderer/webgpu/WebGpuRenderer'
import { calculateSliceDisplayMapping } from '../mpr/sliceGeometry'

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
  const originRef = useRef(vec3.create())
  const draggingRef = useRef<{ x: number; y: number } | undefined>(undefined)
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
    const slices = [
      [vec3.fromValues(1, 0, 0), vec3.fromValues(0, -1, 0)],
      [vec3.fromValues(0, 1, 0), vec3.fromValues(0, 0, 1)],
      [vec3.fromValues(1, 0, 0), vec3.fromValues(0, 0, 1)],
    ]
    slices.forEach(([u, v], index) => renderer.setUpSliceState(
      index, originRef.current, u, v,
      calculateSliceDisplayMapping(volume, originRef.current, u, v, width, height),
    ))
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
      originRef.current = vec3.create()
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

  return (
    <div className="viewer-grid">
      <canvas
        ref={canvasRef}
        onWheel={(event) => {
          const index = viewIndexAt(event.nativeEvent.offsetX / event.currentTarget.clientWidth, event.nativeEvent.offsetY / event.currentTarget.clientHeight)
          if (index === 3) return
          event.preventDefault()
          const normals = [vec3.fromValues(0, 0, -1), vec3.fromValues(1, 0, 0), vec3.fromValues(0, 1, 0)]
          vec3.scaleAndAdd(originRef.current, originRef.current, normals[index], event.deltaY / 120)
          updateSlices()
          rendererRef.current?.render(1 << index)
        }}
        onPointerDown={(event) => {
          const index = viewIndexAt(event.nativeEvent.offsetX / event.currentTarget.clientWidth, event.nativeEvent.offsetY / event.currentTarget.clientHeight)
          if (index !== 3) return
          event.currentTarget.setPointerCapture(event.pointerId)
          draggingRef.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return
          const dx = event.clientX - draggingRef.current.x
          const dy = event.clientY - draggingRef.current.y
          draggingRef.current = { x: event.clientX, y: event.clientY }
          if (dx || dy) {
            rendererRef.current?.rotateCamera(dx, dy)
            markVolumeDirty()
          }
        }}
        onPointerUp={stopRotation}
        onPointerCancel={stopRotation}
      />
      {viewLabels.map(([title, top, left, right, bottom], index) => (
        <div className={`view-overlay overlay-${index}${volumeRef.current ? '' : ' empty'}`} key={title}>
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
