import { vec3, type ReadonlyVec3 } from 'gl-matrix'

export interface Line {
  p1: vec3
  p2: vec3
}

const almostEqual = (a: number, b: number) => Math.abs(a - b) < 1e-5
const isBoxEdge = (a: ReadonlyVec3, b: ReadonlyVec3) =>
  Number(almostEqual(a[0], b[0])) + Number(almostEqual(a[1], b[1])) + Number(almostEqual(a[2], b[2])) === 2

export class RenderBox {
  readonly vertices: Float32Array
  readonly indices = new Uint16Array([
    0,3,2, 2,1,0,
    7,3,2, 2,6,7,
    4,7,6, 6,5,4,
    4,5,1, 1,0,4,
    5,6,2, 2,1,5,
    7,4,0, 0,3,7,
  ])
  readonly points: vec3[]
  readonly edges: Line[] = []

  constructor(x: number, y: number, z: number) {
    this.vertices = new Float32Array([
      -x/2,-y/2, z/2, x/2,-y/2, z/2, x/2,-y/2,-z/2, -x/2,-y/2,-z/2,
      -x/2, y/2, z/2, x/2, y/2, z/2, x/2, y/2,-z/2, -x/2, y/2,-z/2,
    ])
    this.points = Array.from({ length: 8 }, (_, index) =>
      vec3.fromValues(this.vertices[index * 3], this.vertices[index * 3 + 1], this.vertices[index * 3 + 2]))
    for (const p1 of this.points) {
      for (const p2 of this.points) {
        if (isBoxEdge(p1, p2)) this.edges.push({ p1, p2 })
      }
    }
  }
}

