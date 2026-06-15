import { vec3 } from 'gl-matrix'
import type { VolumeData } from '../types'

export interface SliceDisplayMapping {
  centerU: number
  centerV: number
  halfU: number
  halfV: number
}

const edgeIndices = [
  [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
  [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
]

export function calculateSliceDisplayMapping(
  volume: VolumeData,
  origin: vec3,
  axisU: vec3,
  axisV: vec3,
  viewportWidth: number,
  viewportHeight: number,
): SliceDisplayMapping {
  const half = vec3.fromValues(
    volume.width * volume.spacing[0] * 0.5,
    volume.height * volume.spacing[1] * 0.5,
    volume.depth * volume.spacing[2] * 0.5,
  )
  const points = [
    vec3.fromValues(-half[0], -half[1], -half[2]), vec3.fromValues(half[0], -half[1], -half[2]),
    vec3.fromValues(-half[0], half[1], -half[2]), vec3.fromValues(half[0], half[1], -half[2]),
    vec3.fromValues(-half[0], -half[1], half[2]), vec3.fromValues(half[0], -half[1], half[2]),
    vec3.fromValues(-half[0], half[1], half[2]), vec3.fromValues(half[0], half[1], half[2]),
  ]
  const normal = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), axisU, axisV))
  let minU = Number.POSITIVE_INFINITY, maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY, maxV = Number.NEGATIVE_INFINITY

  for (const [aIndex, bIndex] of edgeIndices) {
    const a = points[aIndex], b = points[bIndex]
    const da = vec3.dot(vec3.sub(vec3.create(), a, origin), normal)
    const db = vec3.dot(vec3.sub(vec3.create(), b, origin), normal)
    if (da * db > 0 || Math.abs(da - db) < 1e-6) continue
    const point = vec3.scaleAndAdd(vec3.create(), a, vec3.sub(vec3.create(), b, a), da / (da - db))
    const relative = vec3.sub(vec3.create(), point, origin)
    const u = vec3.dot(relative, axisU), v = vec3.dot(relative, axisV)
    minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    minV = Math.min(minV, v); maxV = Math.max(maxV, v)
  }

  if (!Number.isFinite(minU)) {
    const fallback = Math.max(half[0], half[1], half[2])
    return { centerU: 0, centerV: 0, halfU: fallback, halfV: fallback }
  }

  let halfU = Math.max((maxU - minU) * 0.5, 1e-5)
  let halfV = Math.max((maxV - minV) * 0.5, 1e-5)
  const aspect = viewportHeight > 0 ? viewportWidth / viewportHeight : 1
  if (aspect > halfU / halfV) halfU = halfV * aspect
  else halfV = halfU / aspect
  return { centerU: (minU + maxU) * 0.5, centerV: (minV + maxV) * 0.5, halfU, halfV }
}
