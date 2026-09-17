import { JSX, useEffect, useRef, useState } from 'react'

export type Difficulty = 'easy' | 'normal' | 'hard'

const PONG_CFG: Record<Difficulty, { cpu: number; ball: number; padH: number }> = {
  easy: { cpu: 1.8, ball: 2.0, padH: 56 },
  normal: { cpu: 2.7, ball: 2.4, padH: 44 },
  hard: { cpu: 3.8, ball: 3.0, padH: 34 }
}

// A tiny mouse-controlled Pong to pass the time while things load.
// Logical playfield is 300x200; the canvas scales to the panel width via CSS.
export default function Pong({ difficulty }: { difficulty: Difficulty }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState({ you: 0, cpu: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cfg = PONG_CFG[difficulty]
    const W = 300
    const H = 200
    const PADW = 6
    const PADH = cfg.padH
    const R = 4

    let py = H / 2 - PADH / 2 // player (left)
    let cy = H / 2 - PADH / 2 // cpu (right)
    let bx = W / 2
    let by = H / 2
    let bvx = cfg.ball * (Math.random() < 0.5 ? 1 : -1)
    let bvy = (Math.random() * 2 - 1) * 1.8
    let you = 0
    let cpu = 0
    let raf = 0

    const onMove = (e: MouseEvent): void => {
      const r = canvas.getBoundingClientRect()
      py = (e.clientY - r.top) * (H / r.height) - PADH / 2
      py = Math.max(0, Math.min(H - PADH, py))
    }
    canvas.addEventListener('mousemove', onMove)

    const serve = (dir: number): void => {
      bx = W / 2
      by = H / 2
      bvx = cfg.ball * dir
      bvy = (Math.random() * 2 - 1) * 1.8
    }

    const loop = (): void => {
      // simple AI: chase the ball with a capped speed
      cy += Math.max(-cfg.cpu, Math.min(cfg.cpu, by - PADH / 2 - cy))
      cy = Math.max(0, Math.min(H - PADH, cy))

      bx += bvx
      by += bvy
      if (by < R || by > H - R) bvy = -bvy

      if (bx - R < PADW + 4 && by > py && by < py + PADH && bvx < 0) {
        bvx = -bvx * 1.05
        bvy += ((by - (py + PADH / 2)) / (PADH / 2)) * 1.6
      }
      if (bx + R > W - PADW - 4 && by > cy && by < cy + PADH && bvx > 0) {
        bvx = -bvx * 1.05
        bvy += ((by - (cy + PADH / 2)) / (PADH / 2)) * 1.6
      }
      bvx = Math.max(-5.5, Math.min(5.5, bvx))
      bvy = Math.max(-5.5, Math.min(5.5, bvy))

      if (bx < -R) {
        cpu += 1
        setScore({ you, cpu })
        serve(1)
      } else if (bx > W + R) {
        you += 1
        setScore({ you, cpu })
        serve(-1)
      }

      // draw
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = '#bcd4f0'
      ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.moveTo(W / 2, 0)
      ctx.lineTo(W / 2, H)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#000000' // you
      ctx.fillRect(4, py, PADW, PADH)
      ctx.fillStyle = '#8a93a0' // cpu
      ctx.fillRect(W - PADW - 4, cy, PADW, PADH)
      ctx.fillStyle = '#2f6bff' // ball
      ctx.beginPath()
      ctx.arc(bx, by, R, 0, Math.PI * 2)
      ctx.fill()

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('mousemove', onMove)
    }
  }, [difficulty])

  return (
    <div className="pong">
      <div className="pong__score">
        You {score.you} · CPU {score.cpu}
      </div>
      <canvas ref={canvasRef} width={300} height={200} className="pong__canvas" />
      <div className="pong__hint">Move your mouse to control the left paddle.</div>
    </div>
  )
}
