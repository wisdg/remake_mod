import type { Talent, Event } from '@remake/data'
import { pickWeight, type WeightItem } from '@remake/vitex'
import type { Properties } from './state'

/**
 * 随机点：游戏中每一处由命运决定的选择。
 * - replace：天赋盲盒开出什么
 * - property：随机属性天赋第 times 次触发加到哪一项
 * - event：某一年发生哪个事件
 */
export type Point =
    | { kind: 'replace'; talent: Talent['id'] }
    | { kind: 'property'; talent: Talent['id']; times: number }
    | { kind: 'event'; age: number }

export type PointValue<P extends Point> = P extends { kind: 'replace' }
    ? Talent['id']
    : P extends { kind: 'property' }
      ? keyof Properties
      : Event['id']

export function pointKey(p: Point): string {
    switch (p.kind) {
        case 'replace':
            return `replace:${p.talent}`
        case 'property':
            return `property:${p.talent}:${p.times}`
        case 'event':
            return `event:${p.age}`
    }
}

/** 命运：在随机点上从带权选项中作出选择（无可选项时为 null） */
export interface Fate {
    choose<P extends Point>(point: P, options: WeightItem<PointValue<P>>[]): PointValue<P> | null
    /** 该点被指定的结果（仅当它在选项中时有效） */
    forced?(point: Point): unknown
}

/** 天意：按权重随机 */
export const chance: Fate = {
    choose: (_, options) => pickWeight(options),
}

/** 被指定的命运（作弊）：指定且可达的点取指定值，其余按 base 决定 */
export function destined(overrides: ReadonlyMap<string, unknown>, base: Fate = chance): Fate {
    if (!overrides.size) return base
    const forced = (point: Point) => overrides.get(pointKey(point))
    return {
        forced,
        choose(point, options) {
            const v = forced(point)
            if (v !== undefined && options.some(([o, w]) => o === v && w > 0)) return v as PointValue<typeof point>
            return base.choose(point, options)
        },
    }
}

/** 一次选择：p 为条件概率；alternatives 为该点的自然分布（不受指定影响） */
export interface Choice {
    point: Point
    key: string
    value: unknown
    p: number
    alternatives: [unknown, number][]
    /** 指定状态：未指定 / 已按指定 / 指定值不在选项中（不可达） */
    forced: 'no' | 'yes' | 'unreachable'
}

export interface Branch<R> {
    /** 整条分支的概率 */
    p: number
    path: Choice[]
    result?: R
    /** 该分支在游戏逻辑中抛出的错误 */
    error?: unknown
}

export interface Foresight<R> {
    branches: Branch<R>[]
    /** false：分支过多，改为抽样估计 */
    exact: boolean
}

function normalize<T>(options: WeightItem<T>[]): [T, number][] {
    const live = options.filter(([, w]) => w > 0)
    const total = live.reduce((s, [, w]) => s + w, 0)
    return live.map(([v, w]) => [v, w / total])
}

/**
 * 预见：用真正的游戏逻辑把所有随机点的每个分支都走一遍，得到精确的分支与概率。
 * 指定（作弊）的点只走指定分支。分支数超过 budget 时改为抽样 samples 次估计。
 */
export function foresee<R>(
    run: (fate: Fate) => R,
    { overrides = new Map(), budget = 20000, samples = 4000 }: { overrides?: ReadonlyMap<string, unknown>; budget?: number; samples?: number } = {},
): Foresight<R> {
    const forcedOf = (point: Point, alternatives: [unknown, number][]) => {
        const v = overrides.get(pointKey(point))
        if (v === undefined) return { state: 'no' as const }
        if (alternatives.some(([o]) => o === v)) return { state: 'yes' as const, value: v }
        return { state: 'unreachable' as const }
    }
    const once = (decide: (depth: number, alternatives: [unknown, number][]) => number) => {
        const path: Choice[] = []
        const fate: Fate = {
            choose(point, options) {
                const alternatives = normalize(options)
                if (!alternatives.length) return null
                const f = forcedOf(point, alternatives)
                let value: unknown
                let p: number
                if (f.state === 'yes') {
                    // 被指定的点视为只有一个选项，保持与穷举脚本的深度对齐
                    decide(path.length, [[f.value, 1]])
                    value = f.value
                    p = 1
                } else {
                    const i = decide(path.length, alternatives)
                    ;[value, p] = alternatives[i]!
                }
                path.push({ point, key: pointKey(point), value, p, alternatives, forced: f.state })
                return value as PointValue<typeof point>
            },
        }
        const branch: Branch<R> = { p: 1, path }
        try {
            branch.result = run(fate)
        } catch (error) {
            branch.error = error
        }
        branch.p = path.reduce((acc, c) => acc * c.p, 1)
        return branch
    }

    // 深度优先穷举：script[d] 为第 d 个（未指定的）选择点所取的选项序号
    const branches: Branch<R>[] = []
    const script: number[] = []
    const widths: number[] = []
    for (;;) {
        const branch = once((d, alternatives) => {
            widths[d] = alternatives.length
            if (d >= script.length) script.push(0)
            return script[d]!
        })
        const depth = branch.path.length
        script.length = depth
        branches.push(branch)
        if (branches.length > budget) break
        let d = depth - 1
        while (d >= 0 && script[d]! + 1 >= widths[d]!) d--
        if (d < 0) return { branches, exact: true }
        script[d]!++
        script.length = d + 1
    }

    // 抽样估计
    const sampled: Branch<R>[] = []
    for (let i = 0; i < samples; i++) {
        const b = once((_, alternatives) => {
            let mark = Math.random()
            for (let j = 0; j < alternatives.length; j++) {
                mark -= alternatives[j]![1]
                if (mark < 0) return j
            }
            return alternatives.length - 1
        })
        sampled.push({ ...b, p: 1 / samples })
    }
    return { branches: sampled, exact: false }
}

/**
 * 某随机点的分布（各分支汇总）：返回到达该点的概率与各取值的概率（条件于到达）。
 * 被指定的点仍给出自然分布，并标出指定值。
 */
export function distributionAt<R>(foresight: Foresight<R>, key: string) {
    let reach = 0
    const values = new Map<unknown, number>()
    let forced: Choice['forced'] = 'no'
    let forcedValue: unknown
    for (const b of foresight.branches) {
        const c = b.path.find(c => c.key === key)
        if (!c) continue
        reach += b.p
        if (c.forced === 'yes') {
            forced = 'yes'
            forcedValue = c.value
            for (const [v, p] of c.alternatives) values.set(v, (values.get(v) ?? 0) + b.p * p)
        } else {
            if (c.forced === 'unreachable') forced = 'unreachable'
            values.set(c.value, (values.get(c.value) ?? 0) + b.p)
        }
    }
    if (reach > 0) for (const [v, p] of values) values.set(v, p / reach)
    return { reach, values, forced, forcedValue }
}

/** 实际发生的一次选择 */
export interface Realized {
    point: Point
    key: string
    value: unknown
}

/** 记录经由此命运实际作出的选择（顺序即游戏逻辑的调用顺序，与 foresee 的路径一致） */
export function recording(fate: Fate = chance): { fate: Fate; realized: Realized[] } {
    const realized: Realized[] = []
    return {
        realized,
        fate: {
            forced: fate.forced,
            choose(point, options) {
                const value = fate.choose(point, options)
                if (value !== null) realized.push({ point, key: pointKey(point), value })
                return value
            },
        },
    }
}

/** 已发生的随机点不再需要指定：移除它们（无论指定是否生效） */
export function fulfil(overrides: ReadonlyMap<string, unknown>, realized: Realized[]) {
    if (!realized.some(r => overrides.has(r.key))) return overrides
    const next = new Map(overrides)
    for (const r of realized) next.delete(r.key)
    return next
}
