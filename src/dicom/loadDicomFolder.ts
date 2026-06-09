import dicomParser from 'dicom-parser'
import type { VolumeData } from '../types'

interface SliceMetadata {
  file: File
  instance: number
  width: number
  height: number
  pixelOffset: number
  pixelLength: number
  windowCenter: number
  windowWidth: number
  spacing: number
  thickness: number
  patientId: string
  studyDescription: string
}

const numberValue = (value: string | undefined, fallback: number) => {
  const parsed = Number(value?.split('\\')[0])
  return Number.isFinite(parsed) ? parsed : fallback
}

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
  return {
    file,
    instance: numberValue(dataSet.string('x00200013'), 0),
    width,
    height,
    pixelOffset: pixelElement.dataOffset,
    pixelLength: expectedLength,
    windowCenter: numberValue(dataSet.string('x00281050'), 40),
    windowWidth: numberValue(dataSet.string('x00281051'), 400),
    spacing: numberValue(pixelSpacing[0], 1),
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
  slices.sort((left, right) => right.instance - left.instance)

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

  return {
    pixels,
    width: first.width,
    height: first.height,
    depth: selectedSlices.length,
    windowCenter: first.windowCenter,
    windowWidth: first.windowWidth,
    spacing: [first.spacing, first.spacing, first.thickness],
    patientId: first.patientId,
    studyDescription: first.studyDescription,
  }
}
