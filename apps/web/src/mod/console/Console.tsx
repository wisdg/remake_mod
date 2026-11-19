import { useMemo, useRef, useLayoutEffect } from 'react'
import { atom, useAtom, useSetAtom } from 'jotai'
import { consoleAtom } from '../state'
import Window, { windowAtom, type Geometry } from '../window/Window'
import CommandInput from './CommandInput'
import { execute, type Line, type Source } from './commands'
import './Console.css'

const MaxLines = 2000
const linesAtom = atom<Line[]>([
    { kind: 'out', segs: [{ text: '人生重开控制台 · 输入 help 查看命令 · 天赋/成就可直接写名称' }] },
])
const historyAtom = atom<string[]>([])

const defaults = (): Geometry => {
    const w = Math.min(760, window.innerWidth - 32)
    const h = Math.min(440, Math.round(window.innerHeight * 0.5))
    return { x: Math.round((window.innerWidth - w) / 2), y: window.innerHeight - h - 16, w, h, mode: 'normal' }
}
const geometryAtom = windowAtom('console', defaults)

export function Console() {
    const setOpen = useSetAtom(consoleAtom)
    const [geometry, setGeometry] = useAtom(geometryAtom)
    const [lines, setLines] = useAtom(linesAtom)
    const [history, setHistory] = useAtom(historyAtom)
    const outRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    // 同步输出与命令回显一并提交；异步输出（如剪贴板回调）直接追加
    const buffer = useRef<Line[] | null>(null)

    const source = useMemo<Source>(
        () => ({
            print(content, kind = 'out') {
                const l: Line = { kind, segs: typeof content === 'string' ? [{ text: content }] : content }
                if (buffer.current) buffer.current.push(l)
                else setLines(ls => [...ls, l].slice(-MaxLines))
            },
        }),
        [setLines],
    )

    // 仅当已在底部时跟随新输出，不打断向上翻看/选择
    const stick = useRef(true)
    useLayoutEffect(() => {
        const el = outRef.current
        if (el && stick.current) el.scrollTop = el.scrollHeight
    }, [lines])
    useLayoutEffect(() => inputRef.current?.focus(), [])

    const submit = (line: string) => {
        setHistory(h => (h[0] === line ? h : [line, ...h].slice(0, 100)))
        if (line.trim() === 'clear') return setLines([])
        buffer.current = [{ kind: 'in', segs: [{ text: line }] }]
        execute(line, source)
        const out = buffer.current
        buffer.current = null
        stick.current = true
        setLines(ls => [...ls, ...out].slice(-MaxLines))
    }

    return (
        <Window
            id="console"
            title="控制台"
            defaults={defaults}
            onClose={() => setOpen(false)}
            onModeChange={mode => mode !== 'min' && requestAnimationFrame(() => inputRef.current?.focus())}
        >
            <div className="mod-console">
                <div
                    className="output font-mono"
                    ref={outRef}
                    onScroll={e => {
                        const el = e.currentTarget
                        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4
                    }}
                >
                    {lines.map((l, i) => (
                        <div key={i} className={`line ${l.kind}`}>
                            {l.kind === 'in' && <span className="echo">&gt; </span>}
                            {l.segs.map((s, j) =>
                                s.grade === undefined && !s.dim ? (
                                    s.text
                                ) : (
                                    <span key={j} className={`${s.grade !== undefined ? `grade-${s.grade} graded` : ''} ${s.dim ? 'dim' : ''}`}>
                                        {s.text}
                                    </span>
                                ),
                            )}
                        </div>
                    ))}
                </div>
                <CommandInput
                    source={source}
                    history={history}
                    onSubmit={submit}
                    onEscape={() => setGeometry({ ...geometry, mode: 'min' })}
                    inputRef={inputRef}
                />
            </div>
        </Window>
    )
}
export default Console
