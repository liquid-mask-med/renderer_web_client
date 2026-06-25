import dicomParser from 'dicom-parser'
import type { VolumeData } from '../types'

interface SliceMetadata {
  file: File
  instance: number
  projection: number
  width: number
  height: number
  pixelOffset: number
  pixelLength: number
  windowCenter: number
  windowWidth: number
  spacingX: number
  spacingY: number
  thickness: number
  patientId: string
  studyDescription: string
}

const numberValue = (value: string | undefined, fallback: number) => {
  const parsed = Number(value?.split('\\')[0])
  return Number.isFinite(parsed) ? parsed : fallback
}
const numberValues = (value: string | undefined) => (value ?? '')
  .split('\\')
  .map((part) => Number(part))
  .filter(Number.isFinite)

const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

async function readMetadata(file: File): Promise<SliceMetadata | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let dataSet
  try {
    dataSet = dicomParser.parseDicom(bytes)
  } catch {
    return null
  }

  const pixelElement = dataSet.elements.x7fe00010
  const width = dataSet.uint16('x00280011') ?? 0
  const height = dataSet.uint16('x00280010') ?? 0
  const bitsAllocated = dataSet.uint16('x00280100') ?? 0
  if (!pixelElement || !width || !height || bitsAllocated !== 16) return null

  const expectedLength = width * height * 2
  if (pixelElement.length < expectedLength) {
    throw new Error(`${file.name} 的像素数据不是未压缩 16-bit 格式`)
  }

  const pixelSpacing = dataSet.string('x00280030')?.split('\\') ?? []
  const rowSpacing = numberValue(pixelSpacing[0], 1)
  const columnSpacing = numberValue(pixelSpacing[1], rowSpacing)
  const orientation = numberValues(dataSet.string('x00200037'))
  const position = numberValues(dataSet.string('x00200032'))
  const normal = orientation.length >= 6 ? cross(orientation.slice(0, 3), orientation.slice(3, 6)) : [0, 0, 1]
  return {
    file,
    instance: numberValue(dataSet.string('x00200013'), 0),
    projection: position.length >= 3 ? dot(position, normal) : Number.NaN,
    width,
    height,
    pixelOffset: pixelElement.dataOffset,
    pixelLength: expectedLength,
    windowCenter: numberValue(dataSet.string('x00281050'), 40),
    windowWidth: numberValue(dataSet.string('x00281051'), 400),
    spacingX: columnSpacing,
    spacingY: rowSpacing,
    thickness: numberValue(dataSet.string('x00180050'), 1),
    patientId: dataSet.string('x00100020') ?? 'Unknown',
    studyDescription: dataSet.string('x00081030') ?? 'DICOM Study',
  }
}

export async function loadDicomFolder(
  files: FileList,
  onProgress?: (message: string) => void,
  maxSlices?: number,
): Promise<VolumeData> {
  const slices: SliceMetadata[] = []
  const sourceFiles = Array.from(files)

  for (let index = 0; index < sourceFiles.length; index += 1) {
    onProgress?.(`正在读取 DICOM 元数据 ${index + 1}/${sourceFiles.length}`)
    const metadata = await readMetadata(sourceFiles[index])
    if (metadata) slices.push(metadata)
  }
  if (slices.every((slice) => Number.isFinite(slice.projection))) {
    slices.sort((left, right) => left.projection - right.projection)
  } else {
    slices.sort((left, right) => right.instance - left.instance)
  }

  if (slices.length === 0) throw new Error('没有找到可读取的未压缩 16-bit DICOM 文件')
  const selectedSlices = maxSlices ? slices.slice(0, maxSlices) : slices
  const first = selectedSlices[0]
  if (selectedSlices.some((slice) => slice.width !== first.width || slice.height !== first.height)) {
    throw new Error('所选 DICOM 序列的切片尺寸不一致')
  }

  const voxels = first.width * first.height * selectedSlices.length
  const bytes = voxels * 2
  onProgress?.(`正在分配体数据内存 ${(bytes / 1024 / 1024).toFixed(1)} MB`)

  const pixels = new Uint16Array(voxels)
  const volumeBytes = new Uint8Array(pixels.buffer)
  for (let index = 0; index < selectedSlices.length; index += 1) {
    const limitMessage = maxSlices && slices.length > maxSlices ? `（仅加载前 ${maxSlices} 张）` : ''
    onProgress?.(`正在组装体数据 ${index + 1}/${selectedSlices.length}${limitMessage}`)
    const slice = selectedSlices[index]
    const buffer = await slice.file.arrayBuffer()
    volumeBytes.set(new Uint8Array(buffer, slice.pixelOffset, slice.pixelLength), index * slice.pixelLength)
  }
  const zDistances = selectedSlices
    .slice(1)
    .map((slice, index) => Math.abs(slice.projection - selectedSlices[index].projection))
    .filter((distance) => Number.isFinite(distance) && distance > 1e-6)
    .sort((left, right) => left - right)
  const spacingZ = zDistances.length ? zDistances[Math.floor(zDistances.length / 2)] : first.thickness

  return {
    pixels,
    width: first.width,
    height: first.height,
    depth: selectedSlices.length,
    windowCenter: first.windowCenter,
    windowWidth: first.windowWidth,
    spacing: [first.spacingX, first.spacingY, spacingZ],
    patientId: first.patientId,
    studyDescription: first.studyDescription,
  }
}
