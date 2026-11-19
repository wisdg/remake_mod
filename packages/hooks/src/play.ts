import { useCallback, useState } from 'react'
import { atom, useSetAtom, useAtomValue, useAtom } from 'jotai'
import { useConfig, useProfile, useReplaced, useAlloc } from '.'
import { useTalentReset, useAllocReset } from '.'
import { start, next, summary, end, pick } from '@remake/core'
import type { GameState, Properties, NextResult } from '@remake/core'
import type { ProfileState, Realized } from '@remake/core'
import { destinedRun, fulfil } from '@remake/core'
import type { Talent } from '@remake/data'

export enum Step {
    Idle = 'idle',
    Mode = 'mode',
    Chara = 'chara',
    Pick = 'pick',
    Alloc = 'alloc',
    Play = 'play',
    Summary = 'summary',
    Achv = 'achv',
    Thanks = 'thanks',
}

export enum Mode {
    Classic = 'classic',
    Celebrity = 'celebrity',
}

export type Log = Omit<NextResult, 'state'> & {
    props: Omit<Properties, 'age'>
}

export const modeAtom = atom<Mode>(Mode.Classic)
export const stepAtom = atom<Step>(Step.Idle)
export const gameStateAtom = atom<GameState | null>(null)
export const logsAtom = atom<Log[]>([])
export const summaryAtom = atom(0)
/** 本局被指定的随机点结果（作弊）：pointKey → 值；重开时清空 */
export const destinyAtom = atom<ReadonlyMap<string, unknown>>(new Map())
/** 本局实际发生的随机选择（开盲盒 + 逐年），重开时清空 */
export const fateHistoryAtom = atom<Realized[]>([])
/**
 * 随机点实际发生后：记入历史，并移除已过去的指定。
 * 开盲盒是本局第一批随机点，重新开盒时覆盖历史（mode = 'replace'）。
 */
export const realizeAtom = atom(null, (get, set, realized: Realized[], mode: 'append' | 'replace' = 'append') => {
    set(destinyAtom, fulfil(get(destinyAtom), realized))
    set(fateHistoryAtom, mode === 'replace' ? realized : [...get(fateHistoryAtom), ...realized])
})

export const useStateReset = () => {
    const setGameState = useSetAtom(gameStateAtom)
    return useCallback(() => setGameState(null), [setGameState])
}
export const useLogsReset = () => {
    const setLogs = useSetAtom(logsAtom)
    return useCallback(() => setLogs([]), [setLogs])
}
export const useGameReset = () => {
    const resetTalent = useTalentReset()
    const resetAlloc = useAllocReset()
    const resetState = useStateReset()
    const resetLogs = useLogsReset()
    const setDestiny = useSetAtom(destinyAtom)
    const setHistory = useSetAtom(fateHistoryAtom)
    return useCallback(() => {
        resetTalent()
        resetAlloc()
        resetState()
        resetLogs()
        setDestiny(new Map())
        setHistory([])
    }, [resetTalent, resetAlloc, resetState, resetLogs, setDestiny, setHistory])
}
export const useFateHistory = () => useAtomValue(fateHistoryAtom)
export const useRealize = () => useSetAtom(realizeAtom)
export const useDestiny = () => useAtom(destinyAtom)

/**
 * 推演上限（预言显示与实际执行共用，保证二者分布一致）：
 * 开盲盒很便宜；推进一年每分支约 0.3~2ms。
 */
export const FateBudget = {
    pick: { budget: 20000, samples: 4000 },
    year: { budget: 2000, samples: 600 },
} as const
/** 开盲盒只受盲盒指定约束 */
export const pickRelevant = (key: string) => key.startsWith('replace:')
/** 推进一年只受这一年的事件指定、以及所持天赋的随机属性指定约束 */
export const yearRelevant = (state: GameState) => (key: string) => {
    if (key === `event:${state.props.current.age + 1}`) return true
    const [kind, talent] = key.split(':')
    return kind === 'property' && state.talents.has(Number(talent))
}
/** 在指定下开盲盒：以所有相关指定都成立为条件抽取结果 */
export function openBoxes(list: Iterable<Talent['id']>, destiny: ReadonlyMap<string, unknown>) {
    return destinedRun(fate => pick(list, fate), destiny, { relevant: pickRelevant, ...FateBudget.pick })
}

export const useMode = () => useAtomValue(modeAtom)
export const useIsClassic = () => useAtomValue(modeAtom) === Mode.Classic
export const useStep = () => useAtomValue(stepAtom)
export const useSetStep = () => useSetAtom(stepAtom)
export const useGameState = () => useAtomValue(gameStateAtom)
export const useSetGameState = () => useSetAtom(gameStateAtom)
export const useSummary = () => useAtomValue(summaryAtom)
export const useLogs = () => useAtomValue(logsAtom)

export const useRemake = () => {
    const { mode } = useConfig()
    const [{ times }] = useProfile()
    const setStep = useSetAtom(stepAtom)
    const reset = useGameReset()
    return useCallback(() => {
        reset()
        setStep(times < mode ? Step.Pick : Step.Mode)
    }, [mode, times, setStep, reset])
}

export const useModeChoose = () => {
    const setMode = useSetAtom(modeAtom)
    const setStep = useSetAtom(stepAtom)
    const choose = useCallback(
        (mode: Mode) => {
            setMode(mode)
            /* prettier-ignore */
            switch (mode) {
                case Mode.Classic: return setStep(Step.Pick)
                case Mode.Celebrity: return setStep(Step.Chara)
            }
        },
        [setMode, setStep],
    )
    return [Mode, choose] as const
}

export const useStart = () => {
    const { spirit } = useConfig()
    const [profile] = useProfile()
    const setStep = useSetAtom(stepAtom)
    const setState = useSetAtom(gameStateAtom)
    const { final: allocate } = useAlloc()
    const { talents: tr } = useReplaced()
    return useCallback(() => {
        const alloc = { ...allocate, spirit }
        const result = start(profile, alloc, tr.talents)
        setState(result.state)
        setStep(Step.Play)
        return result.achievements
    }, [profile, allocate, spirit, tr, setStep, setState])
}
/** 推进一年（以相关指定都成立为条件）：返回新状态、日志与实际发生的随机选择（UI 与控制台共用） */
export function live(state: GameState, profile: ProfileState, destiny: ReadonlyMap<string, unknown> = new Map()) {
    const { result, realized } = destinedRun(fate => next(state, profile, fate), destiny, {
        relevant: yearRelevant(state),
        ...FateBudget.year,
    })
    const { state: s, ...rest } = result
    const { age, ...props } = s.props.current
    const log: Log = { ...rest, props }
    return { state: s, log, achievements: rest.achievements, realized }
}

export const useNext = () => {
    const [profile] = useProfile()
    const [state, setState] = useAtom(gameStateAtom)
    const [logs, setLogs] = useAtom(logsAtom)
    const destiny = useAtomValue(destinyAtom)
    const realize = useSetAtom(realizeAtom)
    if (!state) throw new Error('Game state is not available.')
    const ended = state.life <= 0
    const nexter = useCallback(() => {
        if (!state) throw new Error('Game state is not available.')
        if (state.life <= 0) throw new Error('Game state is already ended.')
        const { state: s, log, achievements, realized } = live(state, profile, destiny)
        setState(s)
        setLogs(prev => [...prev, log])
        realize(realized)
        return achievements
    }, [state, profile, destiny, setState, setLogs, realize])
    return [{ logs, ended }, nexter] as const
}
export const useGotoSummary = () => {
    const [profile] = useProfile()
    const [state, setState] = useAtom(gameStateAtom)
    const setStep = useSetAtom(stepAtom)
    const setSummary = useSetAtom(summaryAtom)
    return useCallback(() => {
        if (!state) throw new Error('Game state is not available.')
        const result = summary(state, profile)
        setSummary(result.summary)
        setState(result.state)
        setStep(Step.Summary)
        return result.achievements
    }, [state, profile, setStep, setState, setSummary])
}

export const useEnd = () => {
    const { lock } = useConfig()
    const [profile, setProfile] = useProfile()
    const setStep = useSetAtom(stepAtom)
    const state = useAtomValue(gameStateAtom)
    const reset = useGameReset()
    const isClassic = useIsClassic()
    const [locked, setLocked] = useState<Set<Talent['id']>>(new Set())
    const picker = useCallback(
        (talent: Talent['id']) => {
            setLocked(prev => {
                if (!isClassic) return prev
                if (prev.has(talent)) {
                    const next = new Set(prev)
                    next.delete(talent)
                    return next
                }
                if (lock == 1) return new Set([talent])
                const next = new Set(prev)
                if (next.size >= lock) return prev
                next.add(talent)
                return next
            })
        },
        [lock, isClassic, setLocked],
    )
    const ender = useCallback(() => {
        if (!state)
            throw new Error('Game state is not available or already ended.')
        const l = isClassic
            ? locked.size > 0
                ? Array.from(locked)
                : undefined
            : profile.locked
        const result = end(state, profile, l)
        setStep(Step.Idle)
        setProfile(result.profile)
        reset()
        return result.achievements
    }, [state, profile, locked, isClassic, setStep, setProfile, reset])
    return [locked, picker, ender] as const
}

export const useGoHome = () => {
    const setStep = useSetAtom(stepAtom)
    return useCallback(() => setStep(Step.Idle), [setStep])
}

export const useGoThanks = () => {
    const setStep = useSetAtom(stepAtom)
    return useCallback(() => setStep(Step.Thanks), [setStep])
}

export const useFeatures = () => {
    const { features } = useConfig()
    const [{ times }] = useProfile()
    return times >= features
}
