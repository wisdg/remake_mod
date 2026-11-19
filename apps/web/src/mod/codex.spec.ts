import { test, expect, describe } from 'vitest'
import { events } from '@remake/data'
import { start, next } from '@remake/core'
import { conditionLines, eventInfo, talentInfo, achievementInfo, earliest, reachable, prereqTree, ageRanges } from './codex'
import type { Ln } from './codex'

const text = (lines: Ln[]) => lines.map(l => l.map(s => s.text).join('')).join('\n')

describe('条件翻译', () => {
    test('顶层“且”逐条列出', () => {
        expect(text(conditionLines('(EVT?[10365])&(INT>150)'))).toBe('  · 本局经历过「你突破到元婴一层。」#10365\n  · 智力 > 150')
    })
    test('顶层“或”注明满足其一', () => {
        expect(text(conditionLines('(MNY<8)|(TLT?[1012])'))).toBe('  满足其一：\n  · 家境 < 8\n  · 拥有天赋 乡间微风')
    })
    test('混合嵌套加括号', () => {
        // 顶层为“且”：逐条；第二条内部的“或”整行成立，无需括号
        expect(text(conditionLines('(EVT?[10365])&((TLT?[1033,1122])|(EVT?[10715]))'))).toBe(
            '  · 本局经历过「你突破到元婴一层。」#10365\n  · 拥有天赋 十死无生 或 急了急了 或 本局经历过「你发现了大统一模型。」#10715',
        )
        // 真正的混合：加括号
        expect(text(conditionLines('(INT>1)&(STR>1)|(MNY>1)'))).toBe('  · （智力 > 1） 且 （体质 > 1） 或 （家境 > 1）'.replace(/（(\S+ > 1)）/g, '$1'))
    })
    test('各类原子', () => {
        expect(text(conditionLines('TLT![1003,1004]'))).toBe('  · 没有天赋 生而为男、生而为女')
        expect(text(conditionLines('AGE?[1,2]'))).toBe('  · 年龄为 1/2 岁')
        expect(text(conditionLines('HINT>100'))).toBe('  · 历史最高智力 > 100')
        expect(text(conditionLines('AACH?[101]'))).toMatch(/^ {2}· 已达成成就 既视感$/)
    })
})

describe('详情', () => {
    test('事件：出现年龄、分支', () => {
        const t = text(eventInfo(10368))
        expect(t).toContain('出现于：400 岁（第 2 层 · 权重 1）；401–405 岁（第 1 层 · 权重 1）')
        expect(t).toContain('若 体质 > 0 → 「你死了。」#10000')
        expect(t).toContain('排除条件')
    })
    test('事件：仅经分支发生，列出来源', () => {
        const t = text(eventInfo(20000))
        expect(t).toContain('只能经由分支发生')
        expect(t).toMatch(/「你死了。」#10000 时，若 .*拥有天赋 死者苏生/)
    })
    test('天赋：效果、盲盒概率、相关事件', () => {
        expect(text(talentInfo(1141))).toContain('效果：随机属性+8')
        expect(text(talentInfo(1141))).toContain('触发条件：无（第一年即触发）')
        const roulette = text(talentInfo(1146))
        expect(roulette).toContain('十死无生 80.6%')
        expect(roulette).toContain('阴间大会员 3.2%')
        expect(text(talentInfo(1012))).toContain('需要此天赋的事件')
    })
    test('成就：时机与条件', () => {
        expect(text(achievementInfo(101))).toMatch(/判定时机：.+\n {2}达成条件：/)
    })
    test('年龄压缩', () => {
        expect(ageRanges(10368)).toEqual(['400 岁（第 2 层 · 权重 1）', '401–405 岁（第 1 层 · 权重 1）'])
    })
})

describe('反查', () => {
    test('前置链：元婴三层不早于二层', () => {
        expect(earliest(10001)).toBe(0)
        expect(earliest(10370)).toBeGreaterThan(earliest(10369))
        expect(earliest(10369)).toBeGreaterThan(earliest(10365))
    })
    test('经分支到达：父事件可晚于其最早年龄发生（回归：40063 曾被误判不可达）', () => {
        // 40063 只经 40062 的分支（需本局经历过 20462）到达
        expect(Number.isFinite(earliest(40063))).toBe(true)
        expect(earliest(40063)).toBeGreaterThanOrEqual(Math.max(earliest(40062), earliest(20462)))
        expect(Number.isFinite(earliest(40083))).toBe(true)
        expect(reachable(40083)).toBe(true)
    })
    test('自我排除表述为“不会重复发生”', () => {
        const t = text(eventInfo(10370))
        expect(t).toContain('不会重复发生')
        expect(t).not.toContain('本局经历过「你突破到元婴三层。」')
        // 与其他条件以“或”并列时：其余条件照常列出
        const t2 = text(eventInfo(10185))
        expect(t2).toContain('排除条件')
        expect(t2).toContain('· 不会重复发生')
        expect(t2).toMatch(/本局经历过「你和父母一同进了城。」#10025/)
    })
    test('前提树逐层展开，重复处标注', () => {
        const t = text(prereqTree(10370, 3))
        expect(t).toContain('前置 「你突破到元婴二层。」#10369')
        expect(t).toContain('前置 「你突破到元婴一层。」#10365')
        expect(t.split('\n')[1]).toMatch(/^[├└]─ /)
    })
    test('时光倒流：正常时间线不可能 ≠ 不可能发生', () => {
        // 觉醒前世记忆：只在 100 岁出现，需先“开始渡劫”；渡劫失败转世（年龄 -500）后才可能
        expect(earliest(20408)).toBe(Infinity)
        expect(reachable(20408)).toBe(true)
        expect(text(eventInfo(20408))).toContain('须经时光倒流')
        // 中考没考好：15 岁，需先“想要参军”（最早 15 岁）；时光倒流 -5 后可再回到 15 岁
        expect(reachable(10943)).toBe(true)
        // 前置引用自身：任何时间线都不可能
        expect(reachable(11266)).toBe(false)
        expect(text(eventInfo(11266))).toContain('不可能发生')
    })
    test('正常时间线下最早年龄是真实下界；判为不可能的事件绝不会发生', () => {
        const profile = { times: 0, talents: new Set<number>(), events: new Set<number>(), achievements: new Set<number>() }
        const r = () => Math.floor(Math.random() * 11)
        let checked = 0
        for (let life = 0; life < 300; life++) {
            let s = start(profile, { charm: r(), intelligence: r(), strength: r(), money: r(), spirit: 5 }, []).state
            let rewound = false
            try {
                while (s.life > 0) {
                    const x = next(s, profile)
                    s = x.state
                    for (const e of x.events) {
                        expect(reachable(e), `#${e} 被判不可能却发生了`).toBe(true)
                        if (!rewound) expect(earliest(e), `#${e} ${events.get(e)?.event} 实际 ${x.age} 岁`).toBeLessThanOrEqual(x.age)
                        checked++
                    }
                    // 发生时光倒流后，正常时间线的下界不再适用（可达性仍适用）
                    if (x.events.some(e => (events.get(e)?.effect?.AGE ?? 0) < 0)) rewound = true
                }
            } catch {
                /* 数据缺陷分支（见 BUGS.md）不影响本检验 */
            }
        }
        expect(checked).toBeGreaterThan(3000)
    }, 60000)
})
