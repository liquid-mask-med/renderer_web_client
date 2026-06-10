import { mat4, vec2, vec3, vec4, type ReadonlyVec3 } from 'gl-matrix'
import type { Renderer } from '../Renderer'
import type { VolumeData } from '../../types'
import { RenderBox } from './RenderBox'
import { buildRgbaLut } from './TransferFunction'
import { mainFragmentShader, mainVertexShader, mprFragmentShader, mprVertexShader } from './shaders'

interface SliceDesc { origin: vec3; axisU: vec3; axisV: vec3 }
interface Aabb { min: vec3; max: vec3 }
interface Viewport { x: number; y: number; width: number; height: number }

const createShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Create shader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Compile shader failed')
  return shader
}

const createProgram = (gl: WebGL2RenderingContext, vertex: string, fragment: string) => {
  const program = gl.createProgram()
  if (!program) throw new Error('Create program failed')
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertex))
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Link program failed')
  return program
}

const uniform = (gl: WebGL2RenderingContext, program: WebGLProgram, name: string) => gl.getUniformLocation(program, name)
const radians = (degrees: number) => degrees * Math.PI / 180

export class WebGlRenderer implements Renderer {
  private readonly gl: WebGL2RenderingContext
  private readonly mainProgram: WebGLProgram
  private readonly mprProgram: WebGLProgram
  private readonly volumeTexture: WebGLTexture
  private readonly volumeColor: WebGLTexture
  private readonly boxVao: WebGLVertexArrayObject
  private readonly boxVbo: WebGLBuffer
  private readonly boxEbo: WebGLBuffer
  private readonly mprVao: WebGLVertexArrayObject
  private readonly r16Format: number
  private renderBox?: RenderBox
  private renderParams?: VolumeData
  private readonly modelMatrix = mat4.create()
  private readonly viewMatrix = mat4.create()
  private readonly projectMatrix = mat4.create()
  private readonly sliceStates: SliceDesc[] = Array.from({ length: 3 }, () => ({
    origin: vec3.create(), axisU: vec3.create(), axisV: vec3.create(),
  }))
  private readonly sliceUvBounds: Aabb[] = Array.from({ length: 3 }, () => ({
    min: vec3.create(), max: vec3.create(),
  }))
  private readonly viewports: Viewport[] = Array.from({ length: 4 }, () => ({ x: 0, y: 0, width: 0, height: 0 }))

  constructor(private readonly canvas: HTMLCanvasElement, private readonly reportError: (message: string) => void) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      depth: true,
      preserveDrawingBuffer: true,
    })
    if (!gl) throw new Error('当前浏览器不支持 WebGL2')
    this.gl = gl
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    const norm16 = gl.getExtension('EXT_texture_norm16') as { R16_EXT: number } | null
    if (!norm16) throw new Error('当前浏览器不支持 renderer_opengl 所需的 EXT_texture_norm16')
    this.r16Format = norm16.R16_EXT
    gl.getExtension('OES_texture_float_linear')
    this.mainProgram = createProgram(gl, mainVertexShader, mainFragmentShader)
    this.mprProgram = createProgram(gl, mprVertexShader, mprFragmentShader)
    this.volumeTexture = gl.createTexture()!
    this.volumeColor = gl.createTexture()!
    this.boxVao = gl.createVertexArray()!
    this.boxVbo = gl.createBuffer()!
    this.boxEbo = gl.createBuffer()!
    this.mprVao = gl.createVertexArray()!

    gl.bindVertexArray(this.mprVao)
    const mprVbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, mprVbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,1,0, -1,-1,0, 1,1,0, 1,1,0, -1,-1,0, 1,-1,0]), gl.STATIC_DRAW)
    const mprPosition = gl.getAttribLocation(this.mprProgram, 'position')
    gl.vertexAttribPointer(mprPosition, 3, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(mprPosition)
  }

  setUpRenderParameters(volume: VolumeData) {
    if (!volume.pixels) throw new Error('本地 WebGL 体数据缺少像素缓冲')
    this.renderParams = volume
    const physicalSize = this.physicalSize()
    this.renderBox = new RenderBox(physicalSize[0], physicalSize[1], physicalSize[2])
    const maxSide = Math.max(...physicalSize)
    const viewRadius = maxSide * 0.6
    mat4.identity(this.modelMatrix)
    mat4.lookAt(this.viewMatrix, [0, -physicalSize[1], 0], [0, 0, 0], [0, 0, 1])
    mat4.ortho(this.projectMatrix, -viewRadius, viewRadius, -viewRadius, viewRadius, -viewRadius * 2, viewRadius * 2)
    this.updateProjection()

    const gl = this.gl
    const maxTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number
    if (Math.max(volume.width, volume.height, volume.depth) > maxTextureSize) {
      throw new Error(`体数据 ${volume.width}×${volume.height}×${volume.depth} 超过 WebGL 3D 纹理限制 ${maxTextureSize}`)
    }
    gl.bindVertexArray(this.boxVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.boxVbo)
    gl.bufferData(gl.ARRAY_BUFFER, this.renderBox.vertices, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.boxEbo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.renderBox.indices, gl.STATIC_DRAW)
    const position = gl.getAttribLocation(this.mainProgram, 'position')
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(position)

    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2)
    gl.texImage3D(gl.TEXTURE_3D, 0, this.r16Format, volume.width, volume.height, volume.depth, 0, gl.RED, gl.UNSIGNED_SHORT, volume.pixels)

    gl.bindTexture(gl.TEXTURE_2D, this.volumeColor)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4096, 1, 0, gl.RGBA, gl.FLOAT, buildRgbaLut())
    const error = gl.getError()
    if (error !== gl.NO_ERROR) throw new Error(`OpenGL 纹理上传失败：${error}`)
  }

  setUpSliceState(index: number, origin: vec3, axisU: vec3, axisV: vec3) {
    if (!this.renderBox) return
    const slice = {
      origin: vec3.clone(origin),
      axisU: vec3.normalize(vec3.create(), axisU),
      axisV: vec3.normalize(vec3.create(), axisV),
    }
    this.sliceStates[index] = slice
    const normal = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), slice.axisU, slice.axisV))
    const uvs: vec3[] = []
    for (const edge of this.renderBox.edges) {
      const l1 = vec3.sub(vec3.create(), edge.p1, slice.origin)
      const l2 = vec3.sub(vec3.create(), edge.p2, slice.origin)
      const da = vec3.dot(l1, normal)
      const db = vec3.dot(l2, normal)
      if (da * db <= 0 && Math.abs(da - db) >= Number.EPSILON) {
        const point = vec3.scaleAndAdd(vec3.create(), edge.p1, vec3.sub(vec3.create(), edge.p2, edge.p1), da / (da - db))
        uvs.push(vec3.fromValues(
          vec3.dot(vec3.sub(vec3.create(), point, slice.origin), slice.axisU),
          vec3.dot(vec3.sub(vec3.create(), point, slice.origin), slice.axisV),
          0,
        ))
      }
    }
    if (uvs.length) {
      const min = vec3.clone(uvs[0]), max = vec3.clone(uvs[0])
      uvs.forEach((point) => { vec3.min(min, min, point); vec3.max(max, max, point) })
      this.sliceUvBounds[index] = { min, max }
    }
  }

  resizeViewport(index: number, width: number, height: number) {
    const halfWidth = Math.floor(width / 2)
    const halfHeight = Math.floor(height / 2)
    const positions = [
      [0, halfHeight], [halfWidth, halfHeight], [0, 0], [halfWidth, 0],
    ]
    this.viewports[index] = { x: positions[index][0], y: positions[index][1], width: halfWidth, height: halfHeight }
    if (index === 3) this.updateProjection()
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
    if (!this.renderParams) return
    const gl = this.gl
    gl.enable(gl.SCISSOR_TEST)
    if (mask & (1 << 3)) this.renderVolume()
    for (let index = 0; index < 3; index += 1) if (mask & (1 << index)) this.renderSlice(index)
    gl.disable(gl.SCISSOR_TEST)
  }

  dispose() {
    const gl = this.gl
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    gl.deleteTexture(this.volumeTexture)
    gl.deleteTexture(this.volumeColor)
    gl.deleteProgram(this.mainProgram)
    gl.deleteProgram(this.mprProgram)
  }

  private readonly onContextLost = (event: Event) => {
    event.preventDefault()
    this.reportError('WebGL context lost：浏览器终止了 renderer_opengl 的 GPU 渲染任务')
  }

  private renderVolume() {
    const { gl, mainProgram: program } = this
    const viewport = this.viewports[3]
    if (!viewport.width || !viewport.height || !this.renderParams) return
    this.applyViewport(viewport)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.clearColor(0, 0, 0, 1)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture)
    gl.uniform1i(uniform(gl, program, 'volumeTexture'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.volumeColor)
    gl.uniform1i(uniform(gl, program, 'volumeColor'), 1)
    gl.uniformMatrix4fv(uniform(gl, program, 'modelMatrix'), false, this.modelMatrix)
    gl.uniformMatrix4fv(uniform(gl, program, 'projectMatrix'), false, this.projectMatrix)
    gl.uniformMatrix4fv(uniform(gl, program, 'viewMatrix'), false, this.viewMatrix)
    const inverseView = mat4.invert(mat4.create(), this.viewMatrix)!
    const ray4 = vec4.transformMat4(vec4.create(), [0, 0, -1, 0], inverseView)
    const viewRay = vec3.normalize(vec3.create(), [ray4[0], ray4[1], ray4[2]])
    gl.uniform3fv(uniform(gl, program, 'viewRay'), viewRay)
    const size = this.physicalSize()
    gl.uniform3fv(uniform(gl, program, 'volumePhysicalSize'), size)
    gl.uniform1i(uniform(gl, program, 'maxSteps'), Math.floor(Math.hypot(...size)))
    gl.bindVertexArray(this.boxVao)
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)
  }

  private renderSlice(index: number) {
    const { gl, mprProgram: program, renderParams } = this
    const viewport = this.viewports[index]
    if (!viewport.width || !viewport.height || !renderParams) return
    this.applyViewport(viewport)
    gl.disable(gl.DEPTH_TEST)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture)
    gl.uniform1i(uniform(gl, program, 'volumeTexture'), 0)
    gl.uniform1i(uniform(gl, program, 'windowCenter'), renderParams.windowCenter)
    gl.uniform1i(uniform(gl, program, 'windowWidth'), renderParams.windowWidth)
    gl.uniform1i(uniform(gl, program, 'width'), viewport.width)
    gl.uniform1i(uniform(gl, program, 'height'), viewport.height)
    gl.uniform3fv(uniform(gl, program, 'origin'), this.sliceStates[index].origin)
    gl.uniform3fv(uniform(gl, program, 'axisU'), this.sliceStates[index].axisU)
    gl.uniform3fv(uniform(gl, program, 'axisV'), this.sliceStates[index].axisV)
    gl.uniform3fv(uniform(gl, program, 'UVMin'), this.sliceUvBounds[index].min)
    gl.uniform3fv(uniform(gl, program, 'UVMax'), this.sliceUvBounds[index].max)
    gl.uniform3fv(uniform(gl, program, 'volumeSize'), this.physicalSize())
    gl.bindVertexArray(this.mprVao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private applyViewport(viewport: Viewport) {
    this.gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height)
    this.gl.scissor(viewport.x, viewport.y, viewport.width, viewport.height)
  }

  private physicalSize(): vec3 {
    const volume = this.renderParams!
    return vec3.fromValues(volume.width * volume.spacing[0], volume.height * volume.spacing[1], volume.depth * volume.spacing[2])
  }

  private updateProjection() {
    const viewport = this.viewports[3]
    if (!this.renderParams || !viewport.width || !viewport.height) return
    const aspect = viewport.width / viewport.height
    const viewRadius = Math.max(...this.physicalSize()) * 0.6
    const left = aspect >= 1 ? -viewRadius * aspect : -viewRadius
    const right = -left
    const bottom = aspect >= 1 ? -viewRadius : -viewRadius / aspect
    mat4.ortho(this.projectMatrix, left, right, bottom, -bottom, -viewRadius * 4, viewRadius * 4)
  }
}
