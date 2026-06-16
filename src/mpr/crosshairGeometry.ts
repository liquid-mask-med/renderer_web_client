import { vec3 } from 'gl-matrix'
import type { SliceDisplayMapping } from './sliceGeometry'

export interface CrosshairLine {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
}

export interface SliceCrosshair {
  center?: { x: number; y: number }
  lines: CrosshairLine[]
}

const planeColors = ['#ff3030', '#3080ff', '#30d060']

export function calculateSliceCrosshair(
  axisU: vec3,
  axisV: vec3,
  mapping: SliceDisplayMapping,
  planeNormals: vec3[],
): SliceCrosshair {
  const center = {
    x: (0.5 - mapping.centerU / (2 * mapping.halfU)) * 100,
    y: (0.5 + mapping.centerV / (2 * mapping.halfV)) * 100,
  }
  const viewNormal = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), axisU, axisV))
  const lines: CrosshairLine[] = []

  planeNormals.forEach((planeNormal, index) => {
    const direction3D = vec3.cross(vec3.create(), viewNormal, planeNormal)
    if (vec3.squaredLength(direction3D) < 1e-8) return
    vec3.normalize(direction3D, direction3D)

    const direction = {
      x: vec3.dot(direction3D, axisU) * 100 / (2 * mapping.halfU),
      y: -vec3.dot(direction3D, axisV) * 100 / (2 * mapping.halfV),
    }
    const clipped = clipInfiniteLine(center, direction)
    if (clipped) lines.push({ ...clipped, color: planeColors[index] })
  })

  const centerVisible = center.x >= 0 && center.x <= 100 && center.y >= 0 && center.y <= 100
  return { center: centerVisible ? center : undefined, lines }
}

function clipInfiniteLine(
  center: { x: number; y: number },
  direction: { x: number; y: number },
): Omit<CrosshairLine, 'color'> | undefined {
  let minT = Number.NEGATIVE_INFINITY
  let maxT = Number.POSITIVE_INFINITY

  const clipAxis = (origin: number, delta: number) => {
    if (Math.abs(delta) < 1e-9) return origin >= 0 && origin <= 100
    let t0 = -origin / delta
    let t1 = (100 - origin) / delta
    if (t0 > t1) [t0, t1] = [t1, t0]
    minT = Math.max(minT, t0)
    maxT = Math.min(maxT, t1)
    return minT <= maxT
  }

  if (!clipAxis(center.x, direction.x) || !clipAxis(center.y, direction.y) ||
      !Number.isFinite(minT) || !Number.isFinite(maxT)) return undefined

  return {
    x1: center.x + direction.x * minT,
    y1: center.y + direction.y * minT,
    x2: center.x + direction.x * maxT,
    y2: center.y + direction.y * maxT,
  }
}
