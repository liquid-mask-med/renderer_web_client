const rgbTable = [
  [0.0, 0.0, 0.0, 0.0],
  [0.0, 0.0, 0.0, 1166.677],
  [0.615686, 0.0, 0.0156863, 1169.016],
  [0.909804, 0.454902, 0.0, 1216.174],
  [0.972549, 0.807843, 0.611765, 1241.24],
  [0.909804, 0.909804, 1.0, 1408.347],
  [1.0, 1.0, 1.0, 4095.0],
]

const alphaTable = [
  [0.0, 0.0],
  [0.0, 1166.677],
  [0.116071, 1169.016],
  [0.5625, 1216.174],
  [0.776786, 1241.24],
  [0.830357, 1408.347],
  [0.830357, 4095.0],
]

export function buildRgbaLut(shift = 0.0) {
  const lut = new Float32Array(4096 * 4)
  const maxIndex = 4095
  const len = rgbTable.length - 1

  const shiftedGray = (table: number[][], index: number) => {
    if (index === 0 || index === len) return table[index][table[index].length - 1]
    return Math.min(maxIndex, Math.max(0, table[index][table[index].length - 1] + shift))
  }

  for (let value = 0; value <= maxIndex; value += 1) {
    let rIndex = 0
    while (rIndex < len && !(value >= shiftedGray(rgbTable, rIndex) && value <= shiftedGray(rgbTable, rIndex + 1))) {
      rIndex += 1
    }

    let aIndex = 0
    while (aIndex < len && !(value >= shiftedGray(alphaTable, aIndex) && value <= shiftedGray(alphaTable, aIndex + 1))) {
      aIndex += 1
    }

    const rNext = Math.min(rIndex + 1, len)
    const aNext = Math.min(aIndex + 1, len)
    const r0 = shiftedGray(rgbTable, rIndex)
    const r1 = shiftedGray(rgbTable, rNext)
    const a0 = shiftedGray(alphaTable, aIndex)
    const a1 = shiftedGray(alphaTable, aNext)
    const rt = r1 === r0 ? 0 : (value - r0) / (r1 - r0)
    const at = a1 === a0 ? 0 : (value - a0) / (a1 - a0)

    for (let channel = 0; channel < 3; channel += 1) {
      lut[value * 4 + channel] = rgbTable[rIndex][channel] + rt * (rgbTable[rNext][channel] - rgbTable[rIndex][channel])
    }
    lut[value * 4 + 3] = alphaTable[aIndex][0] + at * (alphaTable[aNext][0] - alphaTable[aIndex][0])
  }

  return lut
}
