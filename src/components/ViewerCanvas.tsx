import { useEffect, useRef, type RefObject } from 'react'
import { vec3 } from 'gl-matrix'
import type { VolumeData } from '../types'
import { WebGlRenderer } from '../renderer/webgl/WebGlRenderer'

interface Props {
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

export function ViewerCanvas({ volumeRef, volumeVersion, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WebGlRenderer | undefined>(undefined)
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
    if (!renderer) return
    renderer.setUpSliceState(0, originRef.current, vec3.fromValues(1, 0, 0), vec3.fromValues(0, -1, 0))
    renderer.setUpSliceState(1, originRef.current, vec3.fromValues(0, 1, 0), vec3.fromValues(0, 0, 1))
    renderer.setUpSliceState(2, originRef.current, vec3.fromValues(1, 0, 0), vec3.fromValues(0, 0, 1))
  }

  useEffect(() => {
    if (!canvasRef.current) return
    try {
      rendererRef.current = new WebGlRenderer(canvasRef.current, onError)
      const resize = () => {
        const canvas = canvasRef.current!
        const width = Math.max(1, Math.floor(canvas.clientWidth * devicePixelRatio))
        const height = Math.max(1, Math.floor(canvas.clientHeight * devicePixelRatio))
        canvas.width = width
        canvas.height = height
        for (let index = 0; index < 4; index += 1) rendererRef.current?.resizeViewport(index, width, height)
        rendererRef.current?.render(0xF)
      }
      const observer = new ResizeObserver(resize)
      observer.observe(canvasRef.current)
      resize()
      return () => {
        observer.disconnect()
        if (renderFrameRef.current !== undefined) cancelAnimationFrame(renderFrameRef.current)
        rendererRef.current?.dispose()
      }
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [onError])

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
  }, [volumeVersion, onError])

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
