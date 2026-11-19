import { useCallback, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { useDestiny, useProfile } from '@remake/hooks'
import { foresee, pick, next, pointKey } from '@remake/core'
import type { Choice, GameState, Point } from '@remake/core'
import type { Talent } from '@remake/data'
import { prophecyAtom, consoleAtom } from '../state'

export const useProphecy = () => useAtomValue(prophecyAtom)
/** 指定命运（选分支）相当于作弊，需开启控制台 */
export const useCheat = () => useAtomValue(consoleAtom)

/** 盲盒推演很便宜；一年推演每分支约 0.3~2ms */
export const PickBudget = { budget: 20000, samples: 4000 }
export const YearBudget = { budget: 2000, samples: 600 }

/** 开出给定天赋盲盒的全部分支 */
export function usePickForesight(list: Iterable<Talent['id']>) {
    const [destiny] = useDestiny()
    return useMemo(() => foresee(fate => pick(list, fate), { overrides: destiny, ...PickBudget }), [list, destiny])
}

/** 从某一状态推进一年的全部分支 */
export function useYearForesight(state: GameState | null) {
    const [destiny] = useDestiny()
    const [profile] = useProfile()
    return useMemo(
        () => (state && state.life > 0 ? foresee(fate => next(state, profile, fate), { overrides: destiny, ...YearBudget }) : null),
        [state, profile, destiny],
    )
}

/** 指定 / 取消指定随机点 */
export function useDestine() {
    const [destiny, setDestiny] = useDestiny()
    const cheat = useCheat()
    /** 指定单个点；value 为 undefined 时取消 */
    const one = useCallback(
        (point: Point, value: unknown) => {
            if (!cheat) return
            const m = new Map(destiny)
            if (value === undefined) m.delete(pointKey(point))
            else m.set(pointKey(point), value)
            setDestiny(m)
        },
        [cheat, destiny, setDestiny],
    )
    /** 指定一整条路径（选定某个未来） */
    const path = useCallback(
        (choices: Pick<Choice, 'key' | 'value'>[]) => {
            if (!cheat) return
            const m = new Map(destiny)
            for (const c of choices) m.set(c.key, c.value)
            setDestiny(m)
        },
        [cheat, destiny, setDestiny],
    )
    const clear = useCallback(() => cheat && setDestiny(new Map()), [cheat, setDestiny])
    return { cheat, destiny, one, path, clear }
}

export const percent = (p: number, exact = true) => {
    const v = p * 100
    const s = v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v > 0 ? '<0.01' : '0'
    return `${exact ? '' : '≈'}${s}%`
}
