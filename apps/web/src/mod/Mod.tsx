import { useCallback, useRef, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { fabAtom, fabPosAtom, prophecyAtom, consoleAtom, prophecyWindowAtom } from './state'
import { useUnlockGesture } from './gesture'
import Console from './console/Console'
import ProphecyWindow from './prophecy/ProphecyWindow'
import './Mod.css'

const Size = 44
const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max))

function Toggle({ label, desc, on, flip }: { label: string; desc: string; on: boolean; flip: () => void }) {
    return (
        <li className={on ? 'on' : ''} onClick={flip}>
            <span className="label">{label}</span>
            <span className="desc">{desc}</span>
            <span className="switch font-mono">{on ? 'ON' : 'OFF'}</span>
        </li>
    )
}

function Fab() {
    const [saved, save] = useAtom(fabPosAtom)
    const [prophecy, setProphecy] = useAtom(prophecyAtom)
    const [consoleOn, setConsole] = useAtom(consoleAtom)
    const [treeOn, setTree] = useAtom(prophecyWindowAtom)
    const setFab = useSetAtom(fabAtom)
    const [pos, setPos] = useState(saved)
    const [open, setOpen] = useState(false)
    const drag = useRef<{ ox: number; oy: number; sx: number; sy: number; moved: boolean } | null>(null)
    const x = clamp(pos.x, window.innerWidth - Size)
    const y = clamp(pos.y, window.innerHeight - Size)

    const down = (e: React.PointerEvent<HTMLButtonElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { ox: e.clientX - x, oy: e.clientY - y, sx: e.clientX, sy: e.clientY, moved: false }
    }
    const move = (e: React.PointerEvent) => {
        const d = drag.current
        if (!d) return
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
        d.moved = true
        setPos({ x: e.clientX - d.ox, y: e.clientY - d.oy })
    }
    const up = () => {
        const d = drag.current
        drag.current = null
        if (!d) return
        if (d.moved) save({ x, y })
        else setOpen(o => !o)
    }
    const right = x > window.innerWidth / 2
    const below = y < window.innerHeight / 2

    return (
        <>
            <button
                className={`mod-fab ${open ? 'open' : ''} ${prophecy ? 'prophecy' : ''}`}
                style={{ left: x, top: y, width: Size, height: Size }}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => (drag.current = null)}
            >
                ◈
            </button>
            {open && (
                <ul
                    className="mod-menu"
                    style={{
                        [right ? 'right' : 'left']: right ? window.innerWidth - x + 8 : x + Size + 8,
                        [below ? 'top' : 'bottom']: below ? y : window.innerHeight - y - Size,
                    }}
                >
                    <Toggle label="预言" desc="揭示隐藏信息与随机的概率" on={prophecy} flip={() => setProphecy(!prophecy)} />
                    {prophecy && <Toggle label="命运之树" desc="逐年展开未来分支" on={treeOn} flip={() => setTree(!treeOn)} />}
                    <Toggle label="控制台" desc="开发调试命令行 · 可指定命运（作弊）" on={consoleOn} flip={() => setConsole(!consoleOn)} />
                    <li
                        className="hide"
                        onClick={() => {
                            setOpen(false)
                            setFab(false)
                        }}
                    >
                        隐藏悬浮按钮（左上角三次右滑可唤出）
                    </li>
                </ul>
            )}
        </>
    )
}

export function Mod() {
    const [fab, setFab] = useAtom(fabAtom)
    const [consoleOn] = useAtom(consoleAtom)
    const [prophecy] = useAtom(prophecyAtom)
    const [treeOn] = useAtom(prophecyWindowAtom)
    const unlock = useCallback(() => setFab(true), [setFab])
    useUnlockGesture(unlock)
    return (
        <>
            {fab && <Fab />}
            {prophecy && treeOn && <ProphecyWindow />}
            {consoleOn && <Console />}
        </>
    )
}
export default Mod
