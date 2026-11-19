import { useEffect, useRef, useState } from 'react'

export interface Segment {
    key: string
    /** 点击后跳转到的路径（节点 id 列表） */
    ids: string[]
    /** 年龄等前缀（加粗） */
    head?: string
    text: string
    /** 本段的条件概率 */
    p: string
    title: string
}

interface Props {
    root: string
    segments: Segment[]
    onGo: (ids: string[]) => void
}

/**
 * 单行面包屑：始终显示“现在”与当前一级；中间按实际宽度从后往前尽量多放，
 * 放不下的收进“… N”，展开为按时间顺序的完整列表。
 */
export function Crumbs({ root, segments, onGo }: Props) {
    const barRef = useRef<HTMLElement>(null)
    const measureRef = useRef<HTMLDivElement>(null)
    const [shown, setShown] = useState(segments.length)
    const [open, setOpen] = useState(false)

    // 实测各项宽度（隐藏的测量层与真实样式一致），算出能放下的尾部段数
    useEffect(() => {
        const bar = barRef.current
        const measure = measureRef.current
        if (!bar || !measure) return
        const fit = () => {
            const [rootW = 0, moreW = 0, ...segW] = [...measure.children].map(el => el.getBoundingClientRect().width)
            const avail = bar.clientWidth - 8
            let k = Math.min(1, segW.length)
            let used = rootW + (segW.at(-1) ?? 0)
            while (k < segW.length) {
                const w = segW[segW.length - 1 - k]!
                const hidden = segW.length - (k + 1)
                if (used + w + (hidden > 0 ? moreW : 0) > avail) break
                used += w
                k++
            }
            setShown(k)
        }
        const ro = new ResizeObserver(fit)
        ro.observe(bar)
        ro.observe(measure)
        return () => ro.disconnect()
    }, [segments])

    // 点击面包屑以外处关闭列表
    useEffect(() => {
        if (!open) return
        const close = (e: PointerEvent) => {
            if (!barRef.current?.contains(e.target as globalThis.Node)) setOpen(false)
        }
        document.addEventListener('pointerdown', close, true)
        return () => document.removeEventListener('pointerdown', close, true)
    }, [open])

    const hiddenCount = Math.max(0, segments.length - shown)
    const hidden = segments.slice(0, hiddenCount)
    const visible = segments.slice(hiddenCount)
    const go = (ids: string[]) => {
        setOpen(false)
        onGo(ids)
    }
    const crumb = (s: Segment, here: boolean) => (
        <span key={s.key} className={`crumb ${here ? 'current' : ''}`}>
            <span className="sep">›</span>
            <button className={here ? 'here' : ''} onClick={() => go(s.ids)} title={s.title}>
                <span className="text">
                    {s.head && <b>{s.head}</b>} {s.text}
                </span>
                <span className="p font-mono">{s.p}</span>
            </button>
        </span>
    )

    return (
        <nav className="crumbs" ref={barRef}>
            <button className={`root ${segments.length ? '' : 'here'}`} onClick={() => go([])}>
                现在 · {root}
            </button>
            {hiddenCount > 0 && (
                <span className="crumb">
                    <span className="sep">›</span>
                    <button className={`more ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title="展开被收起的路径">
                        … {hiddenCount}
                    </button>
                </span>
            )}
            {visible.map((s, i) => crumb(s, i === visible.length - 1))}
            {open && hiddenCount > 0 && (
                <ol className="crumbs-menu">
                    {hidden.map(s => (
                        <li key={s.key}>
                            <button onClick={() => go(s.ids)} title={s.title}>
                                <b>{s.head ?? ''}</b>
                                <span className="text">{s.text}</span>
                                <span className="p font-mono">{s.p}</span>
                            </button>
                        </li>
                    ))}
                </ol>
            )}
            {/* 测量层：root、more、各段，样式与真实一致；装在 0×0 的裁剪盒里，不参与布局 */}
            <div className="crumbs-measure-box" aria-hidden>
                <div className="crumbs-measure" ref={measureRef}>
                    <button className="root">现在 · {root}</button>
                    <span className="crumb">
                        <span className="sep">›</span>
                        <button className="more">… {segments.length}</button>
                    </span>
                    {segments.map(s => crumb(s, false))}
                </div>
            </div>
        </nav>
    )
}
export default Crumbs
