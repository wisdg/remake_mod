import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { gameStateAtom } from '@remake/hooks'
import type { Suggestion } from './brigadier'
import { dispatcher, type Source } from './commands'

interface Props {
    source: Source
    history: string[]
    onSubmit: (line: string) => void
    onEscape: () => void
    inputRef: React.RefObject<HTMLInputElement | null>
}

let canvas: HTMLCanvasElement | null = null
function textWidth(text: string, el: HTMLElement) {
    canvas ??= document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = getComputedStyle(el).font
    return ctx.measureText(text).width
}

/**
 * Brigadier 式输入框：按解析结果着色，光标处给出补全，
 * 无补全时显示后续用法或解析错误。
 */
export function CommandInput({ source, history, onSubmit, onEscape, inputRef }: Props) {
    // 人生开始/结束会改变 life 等命令的可用性
    useAtomValue(gameStateAtom)
    const [value, setValue] = useState('')
    const [cursor, setCursor] = useState(0)
    const [scroll, setScroll] = useState(0)
    const [dismissed, setDismissed] = useState(false)
    // 空输入不自动弹出补全，按 Tab 才展开
    const [summoned, setSummoned] = useState(false)
    const [selected, setSelected] = useState(0)
    // 用 ↑↓ 主动选过补全项
    const [navigated, setNavigated] = useState(false)
    // 输入框中有选区（如全选）
    const [ranged, setRanged] = useState(false)
    const [recall, setRecall] = useState(-1)
    const lastPointer = useRef<{ x: number; y: number } | null>(null)
    const pending = useRef<number | null>(null)
    const listRef = useRef<HTMLUListElement>(null)

    const { segs, parse } = useMemo(() => dispatcher.highlight(value, source), [value, source])
    const suggestions = useMemo(() => dispatcher.suggestions(value.slice(0, cursor), source), [value, cursor, source])
    // 只在光标位于词尾且没有选区时补全：否则补全会把文字插进词中间
    const atTokenEnd = cursor === value.length || /\s/.test(value[cursor]!)
    const open = !dismissed && !ranged && atTokenEnd && suggestions.length > 0 && (value !== '' || summoned)
    const sel = Math.min(selected, suggestions.length - 1)

    const hint = useMemo(() => {
        if (!value.trim()) return { error: false, lines: ['输入 help 查看命令 · Tab 补全 · Enter 执行'] }
        if (parse.reader.canRead() && parse.reader.remaining.trim()) {
            const p = dispatcher.problem(parse)
            return { error: true, lines: [p?.message ?? '参数错误'] }
        }
        const usages = dispatcher.nextUsages(parse, source).slice(0, 6)
        const ready = parse.context.command ? ['↵ 可执行'] : []
        return { error: false, lines: [...ready, ...usages] }
    }, [value, parse, source])

    const sync = () => {
        const el = inputRef.current
        if (!el) return
        setCursor(el.selectionStart ?? el.value.length)
        setRanged(el.selectionStart !== el.selectionEnd)
        setScroll(el.scrollLeft)
    }
    useLayoutEffect(() => {
        const el = inputRef.current
        if (!el) return
        if (pending.current !== null) {
            el.setSelectionRange(pending.current, pending.current)
            pending.current = null
        }
        setScroll(el.scrollLeft)
    }, [value, inputRef])
    useLayoutEffect(() => {
        listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
    }, [sel, open])
    // 弹窗对齐到被补全的那一段文本
    const [anchor, setAnchor] = useState(0)
    const anchorStart = suggestions[0]?.start ?? 0
    useLayoutEffect(() => {
        const el = inputRef.current
        // 输入框相对补全层的偏移 + 被补全文本之前的宽度 - 横向滚动
        if (open && el) setAnchor(el.parentElement!.offsetLeft + textWidth(value.slice(0, anchorStart), el) - scroll)
    }, [open, value, anchorStart, scroll, inputRef])

    const change = (next: string, caret = next.length) => {
        setValue(next)
        setCursor(caret)
        setRanged(false)
        pending.current = caret
        setDismissed(false)
        setSummoned(false)
        setSelected(0)
        setNavigated(false)
    }
    const accept = (s: Suggestion) => {
        let head = value.slice(0, s.start) + s.text
        const tail = value.slice(cursor)
        if (s.continues && !tail.startsWith(' ')) head += ' '
        change(head + tail, head.length)
        inputRef.current?.focus()
    }

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.nativeEvent.isComposing) return
        switch (e.key) {
            case 'Enter': {
                e.preventDefault()
                if (!value.trim()) return
                // 补全打开时：主动选过某项，或当前输入尚不可执行 → 采纳补全；否则执行
                const executable = dispatcher.problem(dispatcher.parse(value.trimEnd(), source)) === null
                if (open && (navigated || !executable)) return accept(suggestions[sel]!)
                onSubmit(value)
                setRecall(-1)
                change('')
                return
            }
            case 'Tab':
                e.preventDefault()
                if (open) accept(suggestions[sel]!)
                else {
                    setDismissed(false)
                    setSummoned(true)
                }
                return
            case 'ArrowUp':
            case 'ArrowDown': {
                e.preventDefault()
                const up = e.key === 'ArrowUp'
                if (open) {
                    // 首尾循环：第一项按 ↑ 到最后一项，最后一项按 ↓ 回到第一项
                    const n = suggestions.length
                    setSelected((sel + (up ? -1 : 1) + n) % n)
                    setNavigated(true)
                    return
                }
                const next = Math.max(-1, Math.min(history.length - 1, recall + (up ? 1 : -1)))
                setRecall(next)
                change(next < 0 ? '' : history[next]!)
                setDismissed(true)
                return
            }
            case 'Escape':
                e.preventDefault()
                if (open) setDismissed(true)
                else onEscape()
                return
        }
    }


    return (
        <div className="cmd">
            {open ? (
                <ul className="suggestions font-mono" ref={listRef} style={{ left: `min(${Math.max(0, anchor)}px, max(0px, calc(100% - 22rem)))` }}>
                    {suggestions.map((s, i) => (
                        <li
                            key={i}
                            className={`${i === sel ? 'selected' : ''} ${s.grade !== undefined ? `grade-${s.grade} graded` : ''}`}
                            onPointerDown={e => e.preventDefault()}
                            onClick={() => accept(s)}
                            onPointerMove={e => {
                                // 仅在鼠标真正移动时跟随：列表滚动使条目滑到静止的鼠标下时不改变选择
                                const p = lastPointer.current
                                if (p && p.x === e.screenX && p.y === e.screenY) return
                                lastPointer.current = { x: e.screenX, y: e.screenY }
                                if (i !== sel) {
                                    setSelected(i)
                                    setNavigated(true)
                                }
                            }}
                        >
                            <span className="text">{s.text}</span>
                            {s.tooltip && <span className="tooltip">{s.tooltip}</span>}
                        </li>
                    ))}
                </ul>
            ) : (
                <div className={`hint font-mono ${hint.error ? 'error' : ''}`}>
                    {hint.lines.map((l, i) => (
                        <div key={i}>{l}</div>
                    ))}
                </div>
            )}
            <div className="field font-mono" onClick={() => inputRef.current?.focus()}>
                <span className="prompt">&gt;</span>
                <div className="editor">
                    <div className="highlight" aria-hidden>
                        <span style={{ transform: `translateX(${-scroll}px)` }}>
                            {segs.map((s, i) => (
                                <span key={i} className={s.kind}>
                                    {s.text}
                                </span>
                            ))}
                        </span>
                    </div>
                    <input
                        ref={inputRef}
                        value={value}
                        onChange={e => change(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                        onKeyDown={onKeyDown}
                        onSelect={sync}
                        onScroll={sync}
                        onKeyUp={sync}
                        onBlur={() => setDismissed(true)}
                        onFocus={() => setDismissed(false)}
                        autoCapitalize="off"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        enterKeyHint="send"
                        aria-label="命令"
                    />
                </div>
            </div>
        </div>
    )
}
export default CommandInput
