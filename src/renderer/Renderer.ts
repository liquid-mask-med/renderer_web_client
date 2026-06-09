import type { vec3 } from 'gl-matrix'
import type { VolumeData } from '../types'

export interface Renderer {
  setUpRenderParameters(volume: VolumeData): void
  setUpSliceState(index: number, origin: vec3, axisU: vec3, axisV: vec3): void
  resizeViewport(index: number, width: number, height: number): void
  rotateCamera(dx: number, dy: number): void
  render(mask: number): void
  dispose(): void
}

