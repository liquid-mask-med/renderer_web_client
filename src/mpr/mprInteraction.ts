import { quat, vec3 } from 'gl-matrix'
import type { SliceCrosshair } from './crosshairGeometry'
import type { SliceDisplayMapping } from './sliceGeometry'

export interface SliceViewBasis {
  u: vec3
  v: vec3
}

export interface MprState {
  origin: vec3
  axes: vec3[]
  views: SliceViewBasis[]
}

export type SliceDrag =
  | { mode: 'translate'; viewIndex: number; x: number; y: number }
  | { mode: 'rotate'; viewIndex: number; x: number; y: number }
  | { mode: 'volume'; x: number; y: number }

export function createMprState(): MprState {
  return {
    origin: vec3.create(),
    axes: [
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(0, 1, 0),
      vec3.fromValues(0, 0, 1),
    ],
    views: [
      { u: vec3.fromValues(1, 0, 0), v: vec3.fromValues(0, -1, 0) },
      { u: vec3.fromValues(0, 1, 0), v: vec3.fromValues(0, 0, 1) },
      { u: vec3.fromValues(1, 0, 0), v: vec3.fromValues(0, 0, 1) },
    ],
  }
}

export function translateMpr(
  state: MprState,
  viewIndex: number,
  dx: number,
  dy: number,
  viewportWidth: number,
  viewportHeight: number,
  mapping: SliceDisplayMapping,
) {
  const view = state.views[viewIndex]
  const deltaU = dx / viewportWidth * (2 * mapping.halfU)
  const deltaV = -dy / viewportHeight * (2 * mapping.halfV)
  vec3.scaleAndAdd(state.origin, state.origin, view.u, deltaU)
  vec3.scaleAndAdd(state.origin, state.origin, view.v, deltaV)
}

export function rotateMpr(
  state: MprState,
  sourceViewIndex: number,
  previous: { x: number; y: number },
  current: { x: number; y: number },
  center: { x: number; y: number },
) {
  const previousX = previous.x - center.x
  const previousY = previous.y - center.y
  const currentX = current.x - center.x
  const currentY = current.y - center.y
  if (previousX * previousX + previousY * previousY <= 16 ||
      currentX * currentX + currentY * currentY <= 16) return

  const cross = previousX * currentY - previousY * currentX
  const dot = previousX * currentX + previousY * currentY
  const angle = -Math.atan2(cross, dot)
  const sourceView = state.views[sourceViewIndex]
  const axis = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), sourceView.u, sourceView.v))
  const rotation = quat.setAxisAngle(quat.create(), axis, angle)

  state.axes.forEach((value) => vec3.normalize(value, vec3.transformQuat(value, value, rotation)))
  state.views.forEach((view, index) => {
    if (index === sourceViewIndex) return
    vec3.normalize(view.u, vec3.transformQuat(view.u, view.u, rotation))
    vec3.normalize(view.v, vec3.transformQuat(view.v, view.v, rotation))
  })
}

export function hitTestCrosshair(
  crosshair: SliceCrosshair | undefined,
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): 'translate' | 'rotate' | undefined {
  if (!crosshair) return undefined
  if (crosshair.center) {
    const centerX = crosshair.center.x / 100 * viewportWidth
    const centerY = crosshair.center.y / 100 * viewportHeight
    if ((x - centerX) ** 2 + (y - centerY) ** 2 <= 12 ** 2) return 'translate'
  }

  for (const line of crosshair.lines) {
    if (distanceToSegment(
      x, y,
      line.x1 / 100 * viewportWidth, line.y1 / 100 * viewportHeight,
      line.x2 / 100 * viewportWidth, line.y2 / 100 * viewportHeight,
    ) <= 8) return 'rotate'
  }
  return undefined
}

function distanceToSegment(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-9) return Math.hypot(x - x1, y - y1)
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared))
  return Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t))
}
