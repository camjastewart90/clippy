import { JSX, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

export type ClippyState = 'idle' | 'thinking' | 'talking'

interface Props {
  state: ClippyState
  onClick?: () => void
  onMouseDown?: (e: ReactMouseEvent) => void
  title?: string
}

// Original smooth vector paperclip with googly eyes. Pupils glance toward the
// cursor. viewBox is 120x160.
const EYE_CX = 60 // midpoint between the eyes
const EYE_CY = 54
const MAX_GLANCE = 3.5 // pupil travel, in viewBox units

const WIRE_D =
  'M55 48 v58 a12 12 0 0 0 24 0 v-53 a24 24 0 0 0 -48 0 v63 a30 30 0 0 0 60 0 v-38'

export default function Clippy({ state, onClick, onMouseDown, title }: Props): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [glance, setGlance] = useState({ x: 0, y: 0 })

  useEffect(() => {
    return window.clippy.onCursor(({ cx, cy, wx, wy }) => {
      const el = svgRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const ex = wx + r.left + (EYE_CX / 120) * r.width
      const ey = wy + r.top + (EYE_CY / 160) * r.height
      const dx = cx - ex
      const dy = cy - ey
      const dist = Math.hypot(dx, dy) || 1
      const mag = MAX_GLANCE * Math.min(1, dist / 70)
      setGlance({ x: (dx / dist) * mag, y: (dy / dist) * mag })
    })
  }, [])

  return (
    <button
      className={`clippy clippy--${state}`}
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={title}
      aria-label="Clippy"
    >
      <svg ref={svgRef} viewBox="0 0 120 160" width="100%" height="100%" className="clippy__svg">
        <defs>
          <linearGradient id="wire" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e9edf2" />
            <stop offset="0.5" stopColor="#aab4c2" />
            <stop offset="1" stopColor="#7b8798" />
          </linearGradient>
          {/* faint horizontal scanlines */}
          <pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse">
            <rect width="4" height="1" fill="#101820" />
          </pattern>
        </defs>

        {/* the paperclip wire */}
        <path
          className="clippy__wire"
          d={WIRE_D}
          fill="none"
          stroke="url(#wire)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* scanline sheen, clipped to the wire by re-stroking the same path */}
        <path
          d={WIRE_D}
          fill="none"
          stroke="url(#scan)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.16"
        />

        {/* eyebrows */}
        <g className="clippy__brows" stroke="#3a4757" strokeWidth="3" strokeLinecap="round">
          <line x1="40" y1="40" x2="53" y2="37" />
          <line x1="67" y1="37" x2="80" y2="40" />
        </g>

        {/* eyes */}
        <g className="clippy__eyes">
          <ellipse cx="47" cy="54" rx="8" ry="10" fill="#fff" stroke="#3a4757" strokeWidth="2" />
          <ellipse cx="73" cy="54" rx="8" ry="10" fill="#fff" stroke="#3a4757" strokeWidth="2" />
          <g
            className="clippy__pupils"
            style={{ transform: `translate(${glance.x}px, ${glance.y}px)` }}
          >
            <circle cx="49" cy="57" r="3.8" fill="#20303f" />
            <circle cx="71" cy="57" r="3.8" fill="#20303f" />
          </g>
        </g>
      </svg>
    </button>
  )
}
