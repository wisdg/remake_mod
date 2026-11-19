import { expect, test, describe } from 'bun:test'
import { pickWeight } from '@remake/vitex'
import { talents } from '@remake/data'
import { createState } from './state'
import { exclude } from './talent'
import { uniqueGenerate } from './character'
import { pick, next } from './game'
import { foresee, destined, distributionAt, pointKey, chance, recording, fulfil, condition, destinedRun } from './fate'
import { enableMapSet } from 'immer'
enableMapSet()

const profile = {
    times: 0,
    talents: new Set<number>(),
    achievements: new Set<number>(),
    events: new Set<number>(),
}
const allocation = { charm: 5, intelligence: 5, strength: 5, money: 5, spirit: 5 }
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

describe('pickWeight', () => {
    test('小数权重按比例取样', () => {
        const items = [
            ['a', 0.2],
            ['b', 5],
            ['c', 0.2],
        ] as const
        // 总权重 5.4：[0,0.2) → a，[0.2,5.2) → b，[5.2,5.4) → c
        expect(pickWeight([...items], () => 0.1 / 5.4)).toBe('a')
        expect(pickWeight([...items], () => 3 / 5.4)).toBe('b')
        expect(pickWeight([...items], () => 5.3 / 5.4)).toBe('c')
        expect(pickWeight([['x', 0]], () => 0.5)).toBeNull()
    })
})

describe('foresee', () => {
    test('单个盲盒：精确分布，概率和为 1', () => {
        const f = foresee(fate => pick([1146], fate)) // 轮盘赌：6 个橙色各 0.2，十死无生 5
        expect(f.exact).toBe(true)
        close(sum(f.branches.map(b => b.p)), 1)
        const d = distributionAt(f, pointKey({ kind: 'replace', talent: 1146 }))
        close(d.reach, 1)
        close(d.values.get(1033)!, 5 / 6.2)
        close(d.values.get(1141)!, 0.2 / 6.2)
    })

    test('多个盲盒：后开的盲盒以前者结果为条件', () => {
        // 紫色转盘 + 阳间福袋（可能开出蓝色转盘，形成嵌套）
        const f = foresee(fate => pick([1143, 2021], fate))
        expect(f.exact).toBe(true)
        close(sum(f.branches.map(b => b.p)), 1)
        for (const b of f.branches) {
            const set = b.result!.talents.talents
            // 任意分支都不含互斥组合
            for (const t of set) expect(exclude(t, [...set].filter(x => x !== t))).toBeNull()
        }
        // 独立推导：紫色转盘的每条开盒链（可能嵌套开出橙色转盘）之后，
        // 阳间福袋在剩余可选项中均匀开出蓝色转盘(1142)
        let expected = 0
        for (const { p: po, result } of foresee(fate => pick([1143], fate)).branches) {
            const set = new Set([...result!.talents.talents, 2021])
            const options = talents.get(2021)!.replacement!.talent!.filter(([id]) => !set.has(id) && exclude(id, set) == null)
            if (options.some(([id]) => id === 1142)) expected += po / options.length
        }
        const nested = distributionAt(f, pointKey({ kind: 'replace', talent: 1142 }))
        close(nested.reach, expected)
        expect(nested.reach).toBeGreaterThan(1 / 14) // 前一个盲盒抽走候选，使其更可能
        close(sum([...nested.values.values()]), 1)
    })

    test('指定（作弊）只走指定分支，并保留自然分布', () => {
        const overrides = new Map([[pointKey({ kind: 'replace', talent: 1145 }), 1133]])
        expect(pick([1145], destined(overrides)).talents.chains.get(1145)).toEqual([1133])
        const f = foresee(fate => pick([1145], fate), { overrides })
        expect(f.branches).toHaveLength(1)
        const d = distributionAt(f, pointKey({ kind: 'replace', talent: 1145 }))
        expect(d.forced).toBe('yes')
        expect(d.forcedValue).toBe(1133)
        close(d.values.get(1133)!, 1 / 16)
    })

    test('指定值不在选项中：不可达，按天意', () => {
        const overrides = new Map([[pointKey({ kind: 'replace', talent: 1145 }), 1001]])
        const f = foresee(fate => pick([1145], fate), { overrides })
        expect(f.branches).toHaveLength(16)
        expect(distributionAt(f, pointKey({ kind: 'replace', talent: 1145 })).forced).toBe('unreachable')
    })

    test('一年：随机属性先于事件，均为 1/5', () => {
        // 阴间大会员：随机属性+8，0 岁触发
        const state = createState(allocation, [1141])
        const f = foresee(fate => next(state, profile, fate))
        expect(f.exact).toBe(true)
        close(sum(f.branches.map(b => b.p)), 1)
        expect(f.branches[0]!.path[0]!.point).toEqual({ kind: 'property', talent: 1141, times: 0 })
        const d = distributionAt(f, pointKey({ kind: 'property', talent: 1141, times: 0 }))
        for (const v of d.values.values()) close(v, 0.2)
        // 指定加到智力
        const forced = new Map([[pointKey({ kind: 'property', talent: 1141, times: 0 }), 'intelligence']])
        const r = next(state, profile, destined(forced))
        expect(r.state.props.highest.intelligence).toBeGreaterThanOrEqual(13)
    })

    test('指定事件', () => {
        const state = createState(allocation, [])
        const forced = new Map([[pointKey({ kind: 'event', age: 0 }), 10002]])
        expect(next(state, profile, destined(forced)).events[0]).toBe(10002)
    })

    test('游戏逻辑出错的分支被记录而非中断预见', () => {
        // 生而为男 + 生而为女：0 岁无事件可选
        const state = createState(allocation, [1003, 1004])
        const f = foresee(fate => next(state, profile, fate))
        expect(f.branches.some(b => b.error)).toBe(true)
    })

    test('分支过多时改为抽样估计', () => {
        const f = foresee(fate => pick([1143, 2021, 1144], fate), { budget: 10, samples: 500 })
        expect(f.exact).toBe(false)
        close(sum(f.branches.map(b => b.p)), 1)
    })

    test('chance 与穷举一致：大量取样逼近精确分布', () => {
        const N = 20000
        let hit = 0
        for (let i = 0; i < N; i++) if (pick([1146], chance).talents.chains.get(1146)![0] === 1033) hit++
        expect(Math.abs(hit / N - 5 / 6.2)).toBeLessThan(0.02)
    })
})

describe('uniqueGenerate', () => {
    test('不生成互斥组合', () => {
        const config = {
            prop: [[5, 1]] as [number, number][],
            talent: [[5, 1]] as [number, number][],
        }
        for (let i = 0; i < 3000; i++) {
            const { talent } = uniqueGenerate(config)
            for (const t of talent) expect(exclude(t, talent.filter(x => x !== t))).toBeNull()
            expect(talent.every(t => !talents.get(t)!.exclusive)).toBe(true)
        }
    })
})

describe('recording / fulfil', () => {
    test('记录的实际选择与预见的路径一致，生效后移除指定', () => {
        const state = createState(allocation, [1141])
        const key = pointKey({ kind: 'property', talent: 1141, times: 0 })
        const overrides = new Map<string, unknown>([
            [key, 'money'],
            [pointKey({ kind: 'event', age: 5 }), 10001], // 未来的点保留
        ])
        const { fate, realized } = recording(destined(overrides))
        const r = next(state, profile, fate)
        expect(realized.map(c => c.key)).toEqual([key, pointKey({ kind: 'event', age: 0 })])
        expect(realized[0]!.value).toBe('money')
        expect(r.events[0]).toBe(realized[1]!.value as number)
        // 预见中存在一条与实际完全相同的路径
        const f = foresee(fate => next(state, profile, fate))
        expect(f.branches.some(b => b.path.map(c => `${c.key}=${c.value}`).join() === realized.map(c => `${c.key}=${c.value}`).join())).toBe(true)
        const left = fulfil(overrides, realized)
        expect([...left.keys()]).toEqual([pointKey({ kind: 'event', age: 5 })])
        expect(fulfil(left, realized)).toBe(left)
    })
})

describe('以指定为条件', () => {
    // 阳间福袋(2021) 的候选中、同时也在紫色转盘(1143) 紫色池里的天赋
    const X = talents.get(2021)!.replacement!.talent!.map(([id]) => id).find(id => talents.get(id)!.grade === 2 && !talents.get(id)!.exclusive)!
    const k1143 = pointKey({ kind: 'replace', talent: 1143 })
    const k2021 = pointKey({ kind: 'replace', talent: 2021 })
    const pins = new Map<string, unknown>([[k2021, X]])

    test('后面的指定约束前面的随机点', () => {
        const natural = distributionAt(foresee(fate => pick([1143, 2021], fate)), k1143)
        expect(natural.values.get(X)!).toBeGreaterThan(0)
        const f = condition(foresee(fate => pick([1143, 2021], fate), { overrides: pins }))
        expect(f.consistent).toBe(true)
        close(sum(f.branches.map(b => b.p)), 1)
        const d = distributionAt(f, k1143)
        expect(d.values.get(X) ?? 0).toBe(0)
        // 其余结果按比例放大：P(v | 指定) ∝ P(v) × P(阳间福袋仍能开出 X | v)
        close(sum([...d.values.values()]), 1)
        expect(distributionAt(f, k2021).forcedValue).toBe(X)
    })

    test('实际执行从条件分布中抽取：指定总能实现', () => {
        for (let i = 0; i < 300; i++) {
            const { result, realized } = destinedRun(fate => pick([1143, 2021], fate), pins)
            expect(result.talents.chains.get(2021)![0]).toBe(X)
            expect(result.talents.chains.get(1143)![0]).not.toBe(X)
            expect(realized.find(r => r.key === k2021)!.value).toBe(X)
        }
    })

    test('同一年内：事件指定约束先发生的随机属性', () => {
        // 体质 -1 + 阴间大会员(随机属性+8)：指定 0 岁“胎死腹中”(体质<0) 时，随机属性不能落在体质
        const state = createState({ ...allocation, strength: -1 }, [1141])
        const ev = pointKey({ kind: 'event', age: 0 })
        const f = condition(foresee(fate => next(state, profile, fate), { overrides: new Map([[ev, 10494]]) }))
        expect(f.consistent).toBe(true)
        const d = distributionAt(f, pointKey({ kind: 'property', talent: 1141, times: 0 }))
        expect(d.values.get('strength') ?? 0).toBe(0)
        for (const k of ['money', 'intelligence', 'charm', 'spirit']) close(d.values.get(k)!, 0.25)
        for (let i = 0; i < 50; i++) expect(destinedRun(fate => next(state, profile, fate), new Map([[ev, 10494]])).result.events[0]).toBe(10494)
    })

    test('指定无法同时满足：标记并退回“能强制则强制”', () => {
        // 已持有阴间大会员，轮盘赌不可能再开出它
        const bad = new Map<string, unknown>([[pointKey({ kind: 'replace', talent: 1146 }), 1141]])
        expect(condition(foresee(fate => pick([1141, 1146], fate), { overrides: bad })).consistent).toBe(false)
        const { result } = destinedRun(fate => pick([1141, 1146], fate), bad)
        expect(result.talents.chains.get(1146)![0]).not.toBe(1141)
    })

    test('无相关指定时按天意直接运行', () => {
        const { realized } = destinedRun(fate => pick([1146], fate), new Map([['event:99', 1]]), { relevant: k => k.startsWith('replace:') })
        expect(realized).toHaveLength(1)
    })
})
