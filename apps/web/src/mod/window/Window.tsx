import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAtom, type WritableAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import './Window.css'

export type WindowMode = 'normal' | 'min' | 'max'
export interface Geometry {
    x: number
    y: number
    w: number
    h: number
    mode: WindowMode
}
type GeoAtom = WritableAtom<Geometry, [Geometry], void>

const atoms = new Map<string, GeoAtom>()
/** 每个窗口一份持久化几何状态 */
export function windowAtom(id: string, init: () => Geometry): GeoAtom {
    let a = atoms.get(id)
    if (!a) {
        a = atomWithStorage(`remake-mod:window:${id}`, init(), undefined, { getOnInit: true }) as GeoAtom
        atoms.set(id, a)
    }
    return a
}

const MinW = 280
const MinH = 160
/** 保证标题栏始终有一部分可见可拖 */
const Grip = 48
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const Edges: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function useViewport() {
    const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
    useEffect(() => {
        const on = () => setVp({ w: window.innerWidth, h: window.innerHeight })
        window.addEventListener('resize', on)
        return () => window.removeEventListener('resize', on)
    }, [])
    return vp
}

function fit(g: Geometry, vp: { w: number; h: number }): Geometry {
    const w = Math.min(Math.max(g.w, MinW), vp.w)
    const h = Math.min(Math.max(g.h, MinH), vp.h)
    const x = Math.min(Math.max(g.x, Grip - w), vp.w - Grip)
    const y = Math.min(Math.max(g.y, 0), vp.h - 32)
    return { ...g, x, y, w, h }
}

export interface WindowProps {
    id: string
    title: ReactNode
    defaults: () => Geometry
    onClose: () => void
    /** 模式变化（如恢复/最大化后聚焦输入框） */
    onModeChange?: (mode: WindowMode) => void
    children: ReactNode
}

/**
 * 可拖动、八向缩放、最小化（收为底部标题条）、最大化（双击标题栏切换）的浮动窗口。
 * 最小化时内容保持挂载，只是隐藏。
 */
export function Window({ id, title, defaults, onClose, onModeChange, children }: WindowProps) {
    const [saved, save] = useAtom(windowAtom(id, defaults))
    const vp = useViewport()
    // 拖动/缩放期间用本地状态，松手再持久化
    const [live, setLive] = useState<Geometry | null>(null)
    const g = fit(live ?? saved, vp)
    const op = useRef<{ edge: Edge | 'move'; px: number; py: number; from: Geometry } | null>(null)

    const setMode = (mode: WindowMode) => {
        save({ ...g, mode })
        onModeChange?.(mode)
    }
    const begin = (e: React.PointerEvent<HTMLElement>) => {
        const edge = e.currentTarget.dataset.edge as Edge | 'move'
        if (e.button !== 0 || g.mode !== 'normal') return
        if (edge === 'move' && (e.target as HTMLElement).closest('button')) return
        e.currentTarget.setPointerCapture(e.pointerId)
        op.current = { edge, px: e.clientX, py: e.clientY, from: g }
    }
    const move = (e: React.PointerEvent) => {
        const o = op.current
        if (!o) return
        const dx = e.clientX - o.px
        const dy = e.clientY - o.py
        const f = o.from
        if (o.edge === 'move') return setLive({ ...f, x: f.x + dx, y: f.y + dy })
        let { x, y, w, h } = f
        if (o.edge.includes('e')) w = Math.max(MinW, f.w + dx)
        if (o.edge.includes('s')) h = Math.max(MinH, f.h + dy)
        if (o.edge.includes('w')) {
            w = Math.max(MinW, f.w - dx)
            x = f.x + f.w - w
        }
        if (o.edge.includes('n')) {
            h = Math.max(MinH, f.h - dy)
            y = f.y + f.h - h
        }
        setLive({ ...f, x, y, w, h })
    }
    const end = () => {
        if (!op.current) return
        op.current = null
        if (live) save(fit(live, vp))
        setLive(null)
    }
    const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

    const style: React.CSSProperties =
        g.mode === 'max' ? { inset: 0 } : g.mode === 'min' ? {} : { left: g.x, top: g.y, width: g.w, height: g.h }

    return (
        <section className={`mod-window ${g.mode}`} style={style} aria-label={typeof title === 'string' ? title : undefined}>
            <header
                className="titlebar"
                data-edge="move"
                onPointerDown={begin}
                {...handlers}
                onDoubleClick={e => {
                    if ((e.target as HTMLElement).closest('button')) return
                    setMode(g.mode === 'max' ? 'normal' : 'max')
                }}
                onClick={() => g.mode === 'min' && setMode('normal')}
            >
                <span className="title">{title}</span>
                <div className="buttons">
                    {g.mode !== 'min' && (
                        <button title="最小化" aria-label="最小化" onClick={() => setMode('min')}>
                            <svg viewBox="0 0 10 10"><path d="M1 8h8" /></svg>
                        </button>
                    )}
                    <button
                        title={g.mode === 'normal' ? '最大化' : '还原'}
                        aria-label={g.mode === 'normal' ? '最大化' : '还原'}
                        onClick={e => {
                            e.stopPropagation()
                            setMode(g.mode === 'normal' ? 'max' : 'normal')
                        }}
                    >
                        {g.mode === 'normal' ? (
                            <svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" /></svg>
                        ) : (
                            <svg viewBox="0 0 10 10"><rect x="1.5" y="3.5" width="5" height="5" /><path d="M3.5 3.5V1.5h5v5h-2" /></svg>
                        )}
                    </button>
                    <button
                        className="close"
                        title="关闭"
                        aria-label="关闭"
                        onClick={e => {
                            e.stopPropagation()
                            onClose()
                        }}
                    >
                        <svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" /></svg>
                    </button>
                </div>
            </header>
            <div className="body">{children}</div>
            {g.mode === 'normal' &&
                Edges.map(edge => <div key={edge} className={`resize ${edge}`} data-edge={edge} onPointerDown={begin} {...handlers} />)}
        </section>
    )
}
export default Window
