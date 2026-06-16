import type { SliceCrosshair } from '../mpr/crosshairGeometry'

interface Props {
  crosshair?: SliceCrosshair
}

export function SliceCrosshairOverlay({ crosshair }: Props) {
  if (!crosshair) return null

  return (
    <>
      <svg className="slice-crosshair" viewBox="0 0 100 100" preserveAspectRatio="none">
        {crosshair.lines.map((line) => (
          <line
            key={line.color}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={line.color}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {crosshair.center && (
        <span
          className="slice-crosshair-center"
          style={{ left: `${crosshair.center.x}%`, top: `${crosshair.center.y}%` }}
        />
      )}
    </>
  )
}
