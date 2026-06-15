import { mat4, vec3, vec4 } from 'gl-matrix'
import type { Renderer } from '../Renderer'
import type { VolumeData } from '../../types'
import { RenderBox } from '../webgl/RenderBox'
import { buildRgbaLut } from '../webgl/TransferFunction'
import { clearShader, mprShader, volumeShader } from './shaders'
import type { SliceDisplayMapping } from '../../mpr/sliceGeometry'

interface SliceDesc { origin: vec3; axisU: vec3; axisV: vec3; mapping: SliceDisplayMapping }
interface Viewport { x: number; y: number; width: number; height: number }

const radians = (degrees: number) => degrees * Math.PI / 180
const align = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment
const webGpuDepthRemap = mat4.fromValues(
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0.5, 0,
  0, 0, 0.5, 1,
)

export class WebGpuRenderer implements Renderer {
  private renderParams?: VolumeData
  private renderBox?: RenderBox
  private volumeTexture?: GPUTexture
  private colorTexture?: GPUTexture
  private outputTexture?: GPUTexture
  private depthTexture?: GPUTexture
  private boxVertexBuffer?: GPUBuffer
  private boxIndexBuffer?: GPUBuffer
  private volumeBindGroup?: GPUBindGroup
  private readonly sliceBindGroups: GPUBindGroup[] = []
  private readonly modelMatrix = mat4.create()
  private readonly viewMatrix = mat4.create()
  private readonly projectMatrix = mat4.create()
  private readonly sliceStates: SliceDesc[] = Array.from({ length: 3 }, () => ({
    origin: vec3.create(), axisU: vec3.create(), axisV: vec3.create(),
    mapping: { centerU: 0, centerV: 0, halfU: 1, halfV: 1 },
  }))
  private readonly viewports: Viewport[] = Array.from({ length: 4 }, () => ({ x: 0, y: 0, width: 0, height: 0 }))

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly clearPipeline: GPURenderPipeline,
    private readonly volumePipeline: GPURenderPipeline,
    private readonly mprPipeline: GPURenderPipeline,
    private readonly volumeUniformBuffer: GPUBuffer,
    private readonly sliceUniformBuffers: GPUBuffer[],
  ) {}

  static async create(canvas: HTMLCanvasElement, reportError: (message: string) => void) {
    if (!navigator.gpu) throw new Error('当前浏览器不支持 WebGPU')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('未找到可用的 WebGPU 适配器')
    const device = await adapter.requestDevice()
    device.lost.then((info) => reportError(`WebGPU device lost: ${info.message}`))
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('无法创建 WebGPU canvas context')
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST })

    const volumeModule = device.createShaderModule({ code: volumeShader })
    const mprModule = device.createShaderModule({ code: mprShader })
    const clearModule = device.createShaderModule({ code: clearShader })
    await WebGpuRenderer.assertShaderValid(volumeModule, 'Volume')
    await WebGpuRenderer.assertShaderValid(mprModule, 'MPR')
    await WebGpuRenderer.assertShaderValid(clearModule, 'Clear')
    const clearPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: clearModule, entryPoint: 'vertexMain' },
      fragment: { module: clearModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    const volumePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: volumeModule, entryPoint: 'vertexMain', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module: volumeModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    })
    const mprPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mprModule, entryPoint: 'vertexMain' },
      fragment: { module: mprModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    const volumeUniformBuffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const sliceUniformBuffers = Array.from({ length: 3 }, () => device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }))
    return new WebGpuRenderer(canvas, device, context, format, clearPipeline, volumePipeline, mprPipeline, volumeUniformBuffer, sliceUniformBuffers)
  }

  private static async assertShaderValid(module: GPUShaderModule, name: string) {
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter((message) => message.type === 'error')
    if (errors.length) {
      throw new Error(`${name} WGSL 编译失败：${errors.map((message) => message.message).join('; ')}`)
    }
  }

  setUpRenderParameters(volume: VolumeData) {
    this.renderParams = volume
    const physicalSize = this.physicalSize()
    this.renderBox = new RenderBox(physicalSize[0], physicalSize[1], physicalSize[2])
    const maxSide = Math.max(...physicalSize)
    const viewRadius = maxSide * 0.6
    mat4.identity(this.modelMatrix)
    mat4.lookAt(this.viewMatrix, [0, -physicalSize[1], 0], [0, 0, 0], [0, 0, 1])
    mat4.ortho(this.projectMatrix, -viewRadius, viewRadius, -viewRadius, viewRadius, -viewRadius * 2, viewRadius * 2)
    this.updateProjection()

    const maxDimension = this.device.limits.maxTextureDimension3D
    if (Math.max(volume.width, volume.height, volume.depth) > maxDimension) {
      throw new Error(`体数据 ${volume.width}x${volume.height}x${volume.depth} 超过 WebGPU 3D 纹理限制 ${maxDimension}`)
    }
    this.volumeTexture?.destroy()
    this.volumeTexture = this.device.createTexture({
      size: [volume.width, volume.height, volume.depth],
      dimension: '3d',
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.writeVolume(volume)
    this.colorTexture?.destroy()
    this.colorTexture = this.device.createTexture({
      size: [4096, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.device.queue.writeTexture({ texture: this.colorTexture }, buildRgbaLut(), { bytesPerRow: 4096 * 16 }, [4096, 1])

    this.boxVertexBuffer?.destroy()
    this.boxIndexBuffer?.destroy()
    this.boxVertexBuffer = this.createBuffer(this.renderBox.vertices, GPUBufferUsage.VERTEX)
    this.boxIndexBuffer = this.createBuffer(this.renderBox.indices, GPUBufferUsage.INDEX)
    this.volumeBindGroup = this.device.createBindGroup({
      layout: this.volumePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.volumeUniformBuffer } },
        { binding: 1, resource: this.volumeTexture.createView() },
        { binding: 2, resource: this.colorTexture.createView() },
      ],
    })
    this.sliceBindGroups.length = 0
    for (let index = 0; index < 3; index += 1) {
      this.sliceBindGroups.push(this.device.createBindGroup({
        layout: this.mprPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sliceUniformBuffers[index] } },
          { binding: 1, resource: this.volumeTexture.createView() },
        ],
      }))
    }
  }

  setUpSliceState(index: number, origin: vec3, axisU: vec3, axisV: vec3, mapping: SliceDisplayMapping) {
    const slice = { origin: vec3.clone(origin), axisU: vec3.normalize(vec3.create(), axisU), axisV: vec3.normalize(vec3.create(), axisV), mapping }
    this.sliceStates[index] = slice
  }

  resizeViewport(index: number, width: number, height: number) {
    const halfWidth = Math.floor(width / 2), halfHeight = Math.floor(height / 2)
    const positions = [[0, 0], [halfWidth, 0], [0, halfHeight], [halfWidth, halfHeight]]
    this.viewports[index] = { x: positions[index][0], y: positions[index][1], width: halfWidth, height: halfHeight }
    if (this.outputTexture && this.canvas.width === width && this.canvas.height === height) return
    this.outputTexture?.destroy()
    this.depthTexture?.destroy()
    this.outputTexture = this.device.createTexture({ size: [width, height], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    this.depthTexture = this.device.createTexture({ size: [width, height], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT })
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.outputTexture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] })
    pass.end()
    this.device.queue.submit([encoder.finish()])
    this.updateProjection()
  }

  rotateCamera(dx: number, dy: number) {
    const camera = mat4.invert(mat4.create(), this.viewMatrix)!
    const up = vec3.normalize(vec3.create(), vec3.fromValues(camera[4], camera[5], camera[6]))
    mat4.multiply(camera, mat4.fromRotation(mat4.create(), -radians(dx), up), camera)
    const right = vec3.normalize(vec3.create(), vec3.fromValues(camera[0], camera[1], camera[2]))
    mat4.multiply(camera, mat4.fromRotation(mat4.create(), -radians(dy), right), camera)
    mat4.invert(this.viewMatrix, camera)
  }

  render(mask: number) {
    if (!this.renderParams || !this.outputTexture || !this.depthTexture) return
    const encoder = this.device.createCommandEncoder()
    if (mask & 8) {
      this.clearViewport(encoder, this.viewports[3])
      this.renderVolume(encoder)
    }
    for (let index = 0; index < 3; index += 1) {
      if (mask & (1 << index)) {
        this.clearViewport(encoder, this.viewports[index])
        this.renderSlice(encoder, index)
      }
    }
    encoder.copyTextureToTexture({ texture: this.outputTexture }, { texture: this.context.getCurrentTexture() }, [this.canvas.width, this.canvas.height])
    this.device.queue.submit([encoder.finish()])
  }

  dispose() {
    this.volumeTexture?.destroy()
    this.colorTexture?.destroy()
    this.outputTexture?.destroy()
    this.depthTexture?.destroy()
    this.boxVertexBuffer?.destroy()
    this.boxIndexBuffer?.destroy()
    this.volumeUniformBuffer.destroy()
    this.sliceUniformBuffers.forEach((buffer) => buffer.destroy())
  }

  private renderVolume(encoder: GPUCommandEncoder) {
    const viewport = this.viewports[3]
    if (!viewport.width || !this.volumeBindGroup || !this.boxVertexBuffer || !this.boxIndexBuffer) return
    const inverseView = mat4.invert(mat4.create(), this.viewMatrix)!
    const ray4 = vec4.transformMat4(vec4.create(), [0, 0, -1, 0], inverseView)
    const ray = vec3.normalize(vec3.create(), [ray4[0], ray4[1], ray4[2]])
    const size = this.physicalSize()
    const values = new Float32Array(64)
    values.set(this.modelMatrix, 0); values.set(this.viewMatrix, 16); values.set(this.projectMatrix, 32)
    values.set([size[0], size[1], size[2], 0], 48); values.set([ray[0], ray[1], ray[2], 0], 52)
    new Uint32Array(values.buffer)[56] = Math.floor(Math.hypot(...size))
    this.device.queue.writeBuffer(this.volumeUniformBuffer, 0, values)
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.outputTexture!.createView(), loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depthTexture!.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
    })
    pass.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1)
    pass.setScissorRect(viewport.x, viewport.y, viewport.width, viewport.height)
    pass.setPipeline(this.volumePipeline)
    pass.setBindGroup(0, this.volumeBindGroup)
    pass.setVertexBuffer(0, this.boxVertexBuffer)
    pass.setIndexBuffer(this.boxIndexBuffer, 'uint16')
    pass.drawIndexed(36)
    pass.end()
  }

  private clearViewport(encoder: GPUCommandEncoder, viewport: Viewport) {
    if (!viewport.width || !viewport.height) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.outputTexture!.createView(),
        loadOp: 'load',
        storeOp: 'store',
      }],
    })
    pass.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1)
    pass.setScissorRect(viewport.x, viewport.y, viewport.width, viewport.height)
    pass.setPipeline(this.clearPipeline)
    pass.draw(3)
    pass.end()
  }

  private renderSlice(encoder: GPUCommandEncoder, index: number) {
    const viewport = this.viewports[index], slice = this.sliceStates[index]
    if (!viewport.width || !this.sliceBindGroups[index]) return
    const size = this.physicalSize()
    const values = new Float32Array(24)
    values.set([...slice.origin, 0], 0); values.set([...slice.axisU, 0], 4); values.set([...slice.axisV, 0], 8)
    values.set([slice.mapping.centerU, slice.mapping.centerV, slice.mapping.halfU, slice.mapping.halfV], 12)
    values.set([...size, 0], 16)
    values.set([this.renderParams!.windowCenter, this.renderParams!.windowWidth, viewport.width, viewport.height], 20)
    this.device.queue.writeBuffer(this.sliceUniformBuffers[index], 0, values)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.outputTexture!.createView(), loadOp: 'load', storeOp: 'store' }] })
    pass.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1)
    pass.setScissorRect(viewport.x, viewport.y, viewport.width, viewport.height)
    pass.setPipeline(this.mprPipeline)
    pass.setBindGroup(0, this.sliceBindGroups[index])
    pass.draw(6)
    pass.end()
  }

  private writeVolume(volume: VolumeData) {
    const sourceRow = volume.width * 2
    const bytesPerRow = align(sourceRow, 256)
    let data: Uint8Array = new Uint8Array(volume.pixels.buffer, volume.pixels.byteOffset, volume.pixels.byteLength)
    if (bytesPerRow !== sourceRow) {
      const padded = new Uint8Array(bytesPerRow * volume.height * volume.depth)
      for (let z = 0; z < volume.depth; z += 1) for (let y = 0; y < volume.height; y += 1) {
        const sourceOffset = (z * volume.height + y) * sourceRow
        padded.set(data.subarray(sourceOffset, sourceOffset + sourceRow), (z * volume.height + y) * bytesPerRow)
      }
      data = padded
    }
    this.device.queue.writeTexture({ texture: this.volumeTexture! }, data, { bytesPerRow, rowsPerImage: volume.height }, [volume.width, volume.height, volume.depth])
  }

  private createBuffer(data: Float32Array | Uint16Array, usage: GPUBufferUsageFlags) {
    const buffer = this.device.createBuffer({ size: align(data.byteLength, 4), usage: usage | GPUBufferUsage.COPY_DST })
    this.device.queue.writeBuffer(buffer, 0, data)
    return buffer
  }

  private physicalSize() {
    const volume = this.renderParams!
    return vec3.fromValues(volume.width * volume.spacing[0], volume.height * volume.spacing[1], volume.depth * volume.spacing[2])
  }

  private updateProjection() {
    const viewport = this.viewports[3]
    if (!this.renderParams || !viewport.width || !viewport.height) return
    const aspect = viewport.width / viewport.height
    const radius = Math.max(...this.physicalSize()) * 0.6
    const left = aspect >= 1 ? -radius * aspect : -radius
    const bottom = aspect >= 1 ? -radius : -radius / aspect
    mat4.ortho(this.projectMatrix, left, -left, bottom, -bottom, -radius * 4, radius * 4)
    mat4.multiply(this.projectMatrix, webGpuDepthRemap, this.projectMatrix)
  }
}
