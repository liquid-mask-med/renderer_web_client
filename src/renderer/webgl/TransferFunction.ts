const rgbTable = [
  [0, 0, 0, 0], [196/255, 25/255, 15/255, 1028], [204/255, 0, 0, 1148],
  [233/255, 185/255, 110/255, 1197], [229/255, 185/255, 142/255, 1603],
  [180/255, 180/255, 180/255, 2433], [247/255, 247/255, 247/255, 3072],
  [247/255, 247/255, 247/255, 4095],
]
const alphaTable = [
  [0, 0], [0, 1028], [0.07853403, 1148], [0.2670157, 1197],
  [0.5759162306785583, 1603], [1, 2433], [1, 3072], [1, 4095],
]

export function buildRgbaLut() {
  const lut = new Float32Array(4096 * 4)
  for (let value = 0; value <= 4095; value += 1) {
    let rIndex = 0
    while (rIndex < 7 && !(value >= rgbTable[rIndex][3] && value <= rgbTable[rIndex + 1][3])) rIndex += 1
    let aIndex = 0
    while (aIndex < 7 && !(value >= alphaTable[aIndex][1] && value <= alphaTable[aIndex + 1][1])) aIndex += 1
    const rNext = Math.min(rIndex + 1, 7)
    const aNext = Math.min(aIndex + 1, 7)
    const rt = (value - rgbTable[rIndex][3]) / Math.max(1, rgbTable[rNext][3] - rgbTable[rIndex][3])
    const at = (value - alphaTable[aIndex][1]) / Math.max(1, alphaTable[aNext][1] - alphaTable[aIndex][1])
    for (let channel = 0; channel < 3; channel += 1) {
      lut[value * 4 + channel] = rgbTable[rIndex][channel] + rt * (rgbTable[rNext][channel] - rgbTable[rIndex][channel])
    }
    lut[value * 4 + 3] = alphaTable[aIndex][0] + at * (alphaTable[aNext][0] - alphaTable[aIndex][0])
  }
  return lut
}

