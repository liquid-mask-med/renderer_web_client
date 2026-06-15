import type { vec3 } from 'gl-matrix'
import type { RemoteBackend, VolumeData } from '../../types'
import type { SliceDisplayMapping } from '../../mpr/sliceGeometry'

export class RemoteRenderer {
  private sessionId?: string
  private readonly widths = [0, 0, 0, 0]
  private readonly heights = [0, 0, 0, 0]

  constructor(private readonly serverUrl: string, private readonly backend: RemoteBackend) {}

  async initialize() {
    const response = await fetch(`${this.baseUrl()}/api/render/sessions?backend=${this.backend}`, { method: 'POST' })
    await this.ensureSuccess(response)
    this.sessionId = ((await response.json()) as { sessionId: string }).sessionId
  }

  async setUpRenderParameters(volume: VolumeData) {
    const query = new URLSearchParams({
      width: String(volume.width),
      height: String(volume.height),
      depth: String(volume.depth),
      windowWidth: String(volume.windowWidth),
      windowCenter: String(volume.windowCenter),
      spacing: String(volume.spacing[0]),
      thickness: String(volume.spacing[2]),
    })
    await this.request(`/volume?${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: volume.pixels.buffer as ArrayBuffer,
    })
  }

  async resizeViewport(index: number, width: number, height: number) {
    this.widths[index] = width
    this.heights[index] = height
    await this.request(`/viewports/${index}?width=${width}&height=${height}`, { method: 'PUT' })
  }

  async setUpSliceState(index: number, origin: vec3, axisU: vec3, axisV: vec3, mapping: SliceDisplayMapping) {
    const vector = (value: vec3) => ({ x: value[0], y: value[1], z: value[2] })
    await this.request(`/slices/${index}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: vector(origin), axisU: vector(axisU), axisV: vector(axisV), mapping }),
    })
  }

  async rotateCamera(dx: number, dy: number) {
    await this.request(`/rotate?dx=${dx}&dy=${dy}`, { method: 'POST' })
  }

  async render(index: number) {
    const response = await fetch(`${this.sessionUrl()}/views/${index}/render`, { method: 'POST' })
    await this.ensureSuccess(response)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { bytes, width: this.widths[index], height: this.heights[index] }
  }

  async dispose() {
    if (!this.sessionId) return
    try {
      await fetch(this.sessionUrl(), { method: 'DELETE' })
    } finally {
      this.sessionId = undefined
    }
  }

  private async request(path: string, init: RequestInit) {
    const response = await fetch(`${this.sessionUrl()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    })
    await this.ensureSuccess(response)
  }

  private async ensureSuccess(response: Response) {
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`renderer_server ${response.status}: ${body}`)
    }
  }

  private baseUrl() { return this.serverUrl.replace(/\/$/, '') }
  private sessionUrl() {
    if (!this.sessionId) throw new Error('远程渲染会话尚未初始化')
    return `${this.baseUrl()}/api/render/sessions/${this.sessionId}`
  }
}
