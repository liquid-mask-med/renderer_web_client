import { useEffect, useRef, type RefObject } from 'react'
import { vec3 } from 'gl-matrix'
import type { RendererSettings, VolumeData } from '../types'
import { RemoteRenderer } from '../renderer/remote/RemoteRenderer'

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
  const originRef = useRef(vec3.create())
  const draggingRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const rotationRunningRef = useRef(false)
  const operationRef = useRef(Promise.resolve())

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
    await renderer.setUpSliceState(0, originRef.current, vec3.fromValues(1,0,0), vec3.fromValues(0,-1,0))
    await renderer.setUpSliceState(1, originRef.current, vec3.fromValues(0,1,0), vec3.fromValues(0,0,1))
    await renderer.setUpSliceState(2, originRef.current, vec3.fromValues(1,0,0), vec3.fromValues(0,0,1))
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
      originRef.current = vec3.create()
      await updateSlices()
      for (let index = 0; index < 4; index += 1) await draw(index)
      onStatus(`远程 ${settings.remoteBackend} 渲染完成`)
    })
  }, [volumeVersion])

  const viewIndexAt = (x: number, y: number) => (y < .5 ? 0 : 2) + (x >= .5 ? 1 : 0)
  return (
    <div className="viewer-grid">
      <canvas
        ref={canvasRef}
        onWheel={(event) => {
          const index = viewIndexAt(event.nativeEvent.offsetX / event.currentTarget.clientWidth, event.nativeEvent.offsetY / event.currentTarget.clientHeight)
          if (index === 3) return
          event.preventDefault()
          const normals = [vec3.fromValues(0,0,-1), vec3.fromValues(1,0,0), vec3.fromValues(0,1,0)]
          vec3.scaleAndAdd(originRef.current, originRef.current, normals[index], event.deltaY / 120)
          enqueue(async () => { await updateSlices(); await draw(index) })
        }}
        onPointerDown={(event) => {
          const index = viewIndexAt(event.nativeEvent.offsetX / event.currentTarget.clientWidth, event.nativeEvent.offsetY / event.currentTarget.clientHeight)
          if (index === 3) {
            event.currentTarget.setPointerCapture(event.pointerId)
            draggingRef.current = { x: event.clientX, y: event.clientY }
          }
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return
          const { x, y } = draggingRef.current
          draggingRef.current = { x: event.clientX, y: event.clientY }
          rotateIfIdle(event.clientX - x, event.clientY - y)
        }}
        onPointerUp={stopRotation}
        onPointerCancel={stopRotation}
      />
      {labels.map(([title, top, left, right, bottom], index) => (
        <div className={`view-overlay overlay-${index}${volumeRef.current ? '' : ' empty'}`} key={title}>
          <div className="viewport-title">{title}</div>
          <span className="marker marker-top">{top}</span><span className="marker marker-left">{left}</span>
          <span className="marker marker-right">{right}</span><span className="marker marker-bottom">{bottom}</span>
          {!volumeRef.current && <div className="empty-state">选择 DICOM 文件夹</div>}
        </div>
      ))}
    </div>
  )
}
