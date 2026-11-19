import { useEffect } from 'react'

/** 起点必须落在左上角区域 */
const Zone = { x: 64, y: 160 }
/** 一次有效右滑：水平位移足够、足够水平、足够快 */
const MinDx = 60
const MaxSlope = 0.6
const MaxDuration = 800
/** 连续三次，相邻两次间隔不超过 */
const Required = 3
const MaxGap = 1500

/** 监听左上角三次从左向右滑动，触发 onUnlock */
export function useUnlockGesture(onUnlock: () => void) {
    useEffect(() => {
        let start: { x: number; y: number; t: number } | null = null
        let count = 0
        let last = 0
        const begin = (x: number, y: number) => {
            start = x <= Zone.x && y <= Zone.y ? { x, y, t: Date.now() } : null
        }
        const finish = (x: number, y: number) => {
            if (!start) return
            const now = Date.now()
            const dx = x - start.x
            const dy = Math.abs(y - start.y)
            const ok =
                dx >= MinDx &&
                dy <= dx * MaxSlope &&
                now - start.t <= MaxDuration
            start = null
            if (!ok) return
            count = now - last <= MaxGap ? count + 1 : 1
            last = now
            if (count < Required) return
            count = 0
            onUnlock()
        }
        // 触摸用 touch 事件：浏览器接管手势时 pointer 事件会被 cancel，touchend 不会丢
        const ts = (e: TouchEvent) => {
            const t = e.changedTouches[0]
            if (t) begin(t.clientX, t.clientY)
        }
        const te = (e: TouchEvent) => {
            const t = e.changedTouches[0]
            if (t) finish(t.clientX, t.clientY)
        }
        const pd = (e: PointerEvent) => {
            if (e.pointerType !== 'touch') begin(e.clientX, e.clientY)
        }
        const pu = (e: PointerEvent) => {
            if (e.pointerType !== 'touch') finish(e.clientX, e.clientY)
        }
        const opt = { capture: true, passive: true }
        window.addEventListener('touchstart', ts, opt)
        window.addEventListener('touchend', te, opt)
        window.addEventListener('pointerdown', pd, opt)
        window.addEventListener('pointerup', pu, opt)
        return () => {
            window.removeEventListener('touchstart', ts, opt)
            window.removeEventListener('touchend', te, opt)
            window.removeEventListener('pointerdown', pd, opt)
            window.removeEventListener('pointerup', pu, opt)
        }
    }, [onUnlock])
}
