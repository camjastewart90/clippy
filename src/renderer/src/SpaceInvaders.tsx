import { JSX, useEffect, useRef, useState } from 'react'
import type { Difficulty } from './Pong'

const INV_CFG: Record<Difficulty, { speed: number; bomb: number }> = {
  easy: { speed: 0.3, bomb: 0.01 },
  normal: { speed: 0.4, bomb: 0.02 },
  hard: { speed: 0.6, bomb: 0.035 }
}

// A tiny Space-Invaders-style game. Mouse moves the ship; click or space fires.
// Logical field is 300x200; the canvas scales to the panel width via CSS.
export default function SpaceInvaders({ difficulty }: { difficulty: Difficulty }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const [over, setOver] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cfg = INV_CFG[difficulty]

    const W = 300
    const H = 200
    const PW = 24
    const PH = 8
    const PY = H - 14
    const COLS = 6
    const ROWS = 3
    const IW = 16
    const IH = 10

    let px = W / 2 - PW / 2
    let bullet: { x: number; y: number } | null = null
    let bombs: { x: number; y: number }[] = []
    let inv: { x: number; y: number; alive: boolean }[] = []
    let dir = 1
    let speed = 0.4
    let wave = 1
    let sc = 0
    let ended = false
    let raf = 0

    const buildWave = (sp: number): void => {
      inv = []
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          inv.push({ x: 30 + c * (IW + 12), y: 22 + r * (IH + 12), alive: true })
      dir = 1
      speed = sp
    }
    buildWave(cfg.speed)

    const onMove = (e: MouseEvent): void => {
      const r = canvas.getBoundingClientRect()
      px = (e.clientX - r.left) * (W / r.width) - PW / 2
      px = Math.max(0, Math.min(W - PW, px))
    }
    const shoot = (): void => {
      if (!bullet && !ended) bullet = { x: px + PW / 2, y: PY - 4 }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === ' ') {
        e.preventDefault()
        shoot()
      } else if (e.key === 'ArrowLeft') px = Math.max(0, px - 16)
      else if (e.key === 'ArrowRight') px = Math.min(W - PW, px + 16)
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('click', shoot)
    window.addEventListener('keydown', onKey)

    const end = (): void => {
      ended = true
      setOver(true)
    }

    const draw = (): void => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#24303c'
      inv.forEach((v) => v.alive && ctx.fillRect(v.x, v.y, IW, IH))
      ctx.fillStyle = '#000000'
      ctx.fillRect(px, PY, PW, PH)
      ctx.fillRect(px + PW / 2 - 2, PY - 4, 4, 4)
      if (bullet) {
        ctx.fillStyle = '#2f6bff'
        ctx.fillRect(bullet.x - 1, bullet.y - 4, 2, 6)
      }
      ctx.fillStyle = '#d64b3a'
      bombs.forEach((b) => ctx.fillRect(b.x - 1, b.y, 2, 5))
      if (ended) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.fillRect(0, H / 2 - 16, W, 32)
        ctx.fillStyle = '#24303c'
        ctx.font = 'bold 16px -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('GAME OVER', W / 2, H / 2 + 6)
      }
    }

    const loop = (): void => {
      if (ended) {
        draw()
        return
      }
      let minX = 1e9
      let maxX = -1e9
      let maxY = -1e9
      let count = 0
      inv.forEach((v) => {
        if (v.alive) {
          count++
          minX = Math.min(minX, v.x)
          maxX = Math.max(maxX, v.x + IW)
          maxY = Math.max(maxY, v.y + IH)
        }
      })
      if (count === 0) {
        wave++
        buildWave(cfg.speed + wave * 0.15)
      } else {
        const step = speed * (1 + (ROWS * COLS - count) * 0.08)
        let drop = false
        if (maxX + dir * step > W || minX + dir * step < 0) {
          dir = -dir
          drop = true
        }
        inv.forEach((v) => {
          if (v.alive) {
            v.x += dir * step
            if (drop) v.y += 8
          }
        })
        if (maxY >= PY) end()
      }

      if (Math.random() < cfg.bomb) {
        const alive = inv.filter((v) => v.alive)
        if (alive.length) {
          const s = alive[Math.floor(Math.random() * alive.length)]
          bombs.push({ x: s.x + IW / 2, y: s.y + IH })
        }
      }

      if (bullet) {
        bullet.y -= 4.5
        if (bullet.y < 0) bullet = null
        else {
          for (const v of inv) {
            if (v.alive && bullet.x > v.x && bullet.x < v.x + IW && bullet.y > v.y && bullet.y < v.y + IH) {
              v.alive = false
              bullet = null
              sc += 10
              setScore(sc)
              break
            }
          }
        }
      }

      bombs.forEach((b) => (b.y += 2.4))
      bombs = bombs.filter((b) => {
        if (b.y > H) return false
        if (b.x > px && b.x < px + PW && b.y > PY && b.y < PY + PH) {
          end()
          return false
        }
        return true
      })

      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('click', shoot)
      window.removeEventListener('keydown', onKey)
    }
  }, [difficulty])

  return (
    <div className="pong">
      <div className="pong__score">
        Score {score}
        {over ? ' · Game over' : ''}
      </div>
      <canvas ref={canvasRef} width={300} height={200} className="pong__canvas" />
      <div className="pong__hint">Mouse to move · click or space to shoot.</div>
    </div>
  )
}
