export type RenderingMode = 'Local' | 'Remote'
export type LocalBackend = 'WebGL' | 'WebGPU'
export type RemoteBackend = 'OpenGL' | 'Vulkan'
export type ViewKind = 'axial' | 'coronal' | 'sagittal' | 'volume'

export interface RendererSettings {
  mode: RenderingMode
  backend: LocalBackend
  remoteBackend: RemoteBackend
  serverUrl: string
}

export interface VolumeData {
  pixels: Uint16Array
  width: number
  height: number
  depth: number
  windowCenter: number
  windowWidth: number
  spacing: [number, number, number]
  patientId: string
  studyDescription: string
}
