import { getDefaultStore } from 'jotai'
import * as hooks from '@remake/hooks'
import { Step, Mode, live, openBoxes as open } from '@remake/hooks'
import type { GameState, Properties, ProfileState } from '@remake/core'
import * as core from '@remake/core'
import { summary, triggerEvent, propsEffect, exclude, pointKey } from '@remake/core'
import type { Point } from '@remake/core'
import { talents, events, achievements } from '@remake/data'
import * as data from '@remake/data'
import { properties } from '@remake/data/etc/display'
import { set as storageSet } from '@/storage'
import { CommandDispatcher, CommandError, literal as lit, argument as arg, variadic } from './brigadier'
import type { CommandNode, CommandContext } from './brigadier'
import { integer, greedy, choice, talent, achievement, event } from './arguments'

const store = getDefaultStore()
const { stepAtom, modeAtom, destinyAtom, profileAtom, configAtom } = hooks
const { gameStateAtom, logsAtom, summaryAtom, pickedAtom } = hooks
const { replacedAtom, uniqueAtom, realizeAtom } = hooks

/* ---------- 输出 ---------- */

export type LineKind = 'in' | 'out' | 'ok' | 'warn' | 'err'
/** 输出片段：可带稀有度着色或弱化 */
export type { Seg } from '../codex'
import type { Seg } from '../codex'
import { talentInfo, eventInfo, achievementInfo, prereqTree, type Ln } from '../codex'
export interface Line {
    kind: LineKind
    segs: Seg[]
}
export type Printable = string | Seg[]
export interface Source {
    print(content: Printable, kind?: Exclude<LineKind, 'in'>): void
}
type Ctx = CommandContext<Source>

/** 带 Map/Set 的值格式化 */
export function fmt(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
    if (value === undefined) return 'undefined'
    return JSON.stringify(
        value,
        (_, v) => {
            if (v instanceof Set) return [...v]
            if (v instanceof Map) return Object.fromEntries(v)
            return v
        },
        2,
    )
}

const fail = (msg: string): never => {
    throw new CommandError(msg)
}
const T = (id: number): Seg => ({ text: talents.get(id)?.name ?? `#${id}`, grade: talents.get(id)?.grade })
const A = (id: number): Seg => ({ text: achievements.get(id)?.name ?? `#${id}`, grade: achievements.get(id)?.grade })
const E = (id: number): Seg => ({ text: events.get(id)?.event ?? `#${id}`, grade: events.get(id)?.grade })
/** 以分隔符拼接片段 */
const join = (segs: Seg[], sep = ' '): Seg[] => segs.flatMap((s, i) => (i ? [{ text: sep }, s] : [s]))
const line = (...parts: (string | Seg | Seg[])[]): Seg[] =>
    parts.flatMap(p => (typeof p === 'string' ? [{ text: p }] : Array.isArray(p) ? p : [p]))
const none = (segs: Seg[]) => (segs.length ? segs : [{ text: '无' }])

/* ---------- 状态访问 ---------- */

const profileOf = () => store.get(profileAtom) ?? fail('存档尚未载入')
const setProfile = (fn: (p: ProfileState) => ProfileState) => store.set(profileAtom, fn(profileOf()))
const stateOf = () => store.get(gameStateAtom) ?? fail('当前没有进行中的人生')
const setState = (s: GameState) => store.set(gameStateAtom, s)
const hasLife = () => !!store.get(gameStateAtom)

/**
 * 选中天赋变化。属性分配页依赖已开盒的结果：在该页时必须保留至少一个天赋并立即重开盲盒；
 * 其余页面清掉旧的开盒结果，等提交时再开。
 */
function setPicked(next: Set<number>, src: Source) {
    const onAlloc = store.get(stepAtom) === Step.Alloc
    if (onAlloc && next.size === 0) fail('属性分配页至少需要一个天赋；要清空请先 goto pick')
    store.set(pickedAtom, next)
    if (onAlloc) {
        openBoxes(next)
        src.print('已重新开启天赋盲盒')
    } else store.set(replacedAtom, null)
}

/* ---------- 参数选项 ---------- */

const StepChoices = choice<Step>('页面', [
    { value: Step.Idle, text: 'idle', aliases: ['首页'], tooltip: '首页' },
    { value: Step.Mode, text: 'mode', aliases: ['模式'], tooltip: '模式选择' },
    { value: Step.Chara, text: 'chara', aliases: ['名人'], tooltip: '名人选择' },
    { value: Step.Pick, text: 'pick', aliases: ['天赋'], tooltip: '天赋抽取' },
    { value: Step.Alloc, text: 'alloc', aliases: ['分配'], tooltip: '属性分配' },
    { value: Step.Play, text: 'play', aliases: ['人生'], tooltip: '人生进行中' },
    { value: Step.Summary, text: 'summary', aliases: ['总结'], tooltip: '人生总结' },
    { value: Step.Achv, text: 'achv', aliases: ['成就'], tooltip: '成就' },
    { value: Step.Thanks, text: 'thanks', aliases: ['感谢'], tooltip: '感谢' },
])
const ModeChoices = choice<Mode>('模式', [
    { value: Mode.Classic, text: 'classic', aliases: ['经典'], tooltip: '经典模式' },
    { value: Mode.Celebrity, text: 'celebrity', aliases: ['名人'], tooltip: '名人模式' },
])
type Attr = keyof Properties | 'life'
const AttrChoices = choice<Attr>('属性', [
    { value: 'charm', text: '颜值', aliases: ['chr', 'charm'] },
    { value: 'intelligence', text: '智力', aliases: ['int', 'intelligence'] },
    { value: 'strength', text: '体质', aliases: ['str', 'strength'] },
    { value: 'money', text: '家境', aliases: ['mny', 'money'] },
    { value: 'spirit', text: '快乐', aliases: ['spr', 'spirit'] },
    { value: 'age', text: '年龄', aliases: ['age'] },
    { value: 'life', text: '生命', aliases: ['lif', 'life'] },
])
const ConfigKeys: Record<string, string> = {
    features: '解锁成就/感谢所需重开次数',
    lock: '可锁定天赋数',
    mode: '进入模式选择所需重开次数',
    max: '最多选择天赋数',
    min: '最少选择天赋数',
    points: '经典模式基础属性点',
    allocate: '单项属性上限',
    spirit: '初始快乐',
    'pull.count': '天赋抽取个数',
    'chara.count': '名人抽取个数',
    'chara.knife': '名人抽取权重切线',
    'unique.limit': '唯一角色解锁所需刷新次数',
}
const ConfigChoices = choice<string>(
    '配置项',
    Object.entries(ConfigKeys).map(([k, v]) => ({ value: k, text: k, tooltip: v })),
)

/* ---------- 命令实现 ---------- */

function gotoStep(step: Step, src: Source) {
    switch (step) {
        case Step.Alloc: {
            const picked = store.get(pickedAtom)
            if (picked.size === 0) fail('尚未选定天赋，先用 pick add <天赋…>')
            if (!store.get(replacedAtom)) {
                openBoxes(picked)
                src.print('已开启天赋盲盒')
            }
            break
        }
        case Step.Play:
            stateOf()
            break
        case Step.Summary: {
            const s = stateOf()
            if (s.life > 0) fail('人生尚未结束：可先 life attr 生命 set 0 再 life next')
            const r = summary(s, profileOf())
            store.set(summaryAtom, r.summary)
            setState(r.state)
            if (r.achievements.length) src.print(line('达成成就: ', join(r.achievements.map(A))), 'ok')
            break
        }
    }
    store.set(stepAtom, step)
    src.print(`→ ${step}`, 'ok')
}

function showLife(src: Source) {
    const s = stateOf()
    const c = s.props.current
    const props = (['charm', 'intelligence', 'strength', 'money', 'spirit'] as const)
        .map(k => `${properties[k]}=${c[k]}`)
        .join(' ')
    src.print(`年龄 ${c.age}  生命 ${s.life}  已指定命运 ${store.get(destinyAtom).size} 处`)
    src.print(props)
    src.print(line('天赋: ', none(join([...s.talents].map(T)))))
    src.print(line('成就: ', none(join([...s.achievements].map(A)))))
    src.print(`经历事件 ${s.events.size} 个`)
}

function setAttr(attr: Attr, value: number, src: Source) {
    const s = stateOf()
    if (attr === 'life') setState({ ...s, life: value })
    else setState({ ...s, props: propsEffect(s.props, { [attr]: value - s.props.current[attr] }) })
    src.print(`${attr === 'life' ? '生命' : properties[attr]} → ${value}`, 'ok')
}
const attrOf = (attr: Attr) => {
    const s = stateOf()
    return attr === 'life' ? s.life : s.props.current[attr]
}

function lifeNext(years: number, src: Source) {
    let s = stateOf()
    if (s.life <= 0) fail('人生已结束')
    const profile = profileOf()
    try {
        for (let i = 0; i < years && s.life > 0; i++) {
            const r = live(s, profile, store.get(destinyAtom))
            store.set(realizeAtom, r.realized)
            s = r.state
            setState(s)
            store.set(logsAtom, logs => [...logs, r.log])
            src.print(
                line(
                    `${r.log.age}岁 `,
                    join(r.log.events.map(E), ' → '),
                    r.log.talents.length ? line('  [天赋] ', join(r.log.talents.map(T))) : [],
                    r.log.achievements.length ? line('  [成就] ', join(r.log.achievements.map(A))) : [],
                ),
            )
        }
    } finally {
        if (s.life <= 0) src.print('人生已结束：页面点“人生总结”或 goto summary', 'ok')
    }
}

function search<K>(items: Map<number, K>, q: string, hay: (k: K) => string[], show: (id: number, k: K) => Seg[], src: Source) {
    const hits = [...items.entries()].filter(([id, k]) => !q || String(id) === q || hay(k).some(h => h.includes(q)))
    for (const [id, k] of hits.slice(0, 100)) src.print(show(id, k))
    if (hits.length > 100) src.print(`…共 ${hits.length} 条，仅显示前 100 条`)
    if (!hits.length) src.print('无匹配')
}

const run = (fn: (ctx: Ctx, src: Source) => void) => (ctx: Ctx) => fn(ctx, ctx.source)

/* ---------- 命令树 ---------- */

export const dispatcher = new CommandDispatcher<Source>()
const L = (name: string) => lit<Source>(name)
const R = <V>(name: string, type: Parameters<typeof arg<Source, V>>[1]) => arg<Source, V>(name, type)

const commandNames = () =>
    dispatcher.root.children.map(c => ({ value: c, text: c.name, tooltip: Descriptions[c.name] }))
const Descriptions: Record<string, string> = {
    help: '查看命令用法',
    clear: '清屏',
    goto: '跳转页面',
    mode: '查看/切换游戏模式',
    destiny: '指定命运：盲盒、随机属性、某年事件的结果（作弊）',
    profile: '存档',
    config: '运行配置',
    talent: '天赋数据',
    achievement: '成就数据与授予',
    event: '事件数据与前提反查',
    pick: '本局选中的天赋',
    lock: '下次必定抽到的锁定天赋',
    unique: '唯一角色（名人模式）',
    life: '进行中的人生',
    js: '执行 JavaScript',
}

dispatcher.register(
    L('help')
        .executes(
            run((_, src) => {
                for (const c of dispatcher.root.children) {
                    if (!c.canUse(src)) continue
                    src.print(line(dispatcher.smartUsage(c, src), { text: `  ${Descriptions[c.name] ?? ''}`, grade: 0 }))
                }
                src.print('Tab/↑↓ 选择补全，Enter 执行；天赋、成就可直接写名称')
            }),
        )
        .then(
            R<CommandNode<Source>>('命令', choice('命令', commandNames)).executes(
                run((ctx, src) => {
                    const node = ctx.get<CommandNode<Source>>('命令')
                    src.print(Descriptions[node.name] ?? '')
                    for (const u of dispatcher.allUsage(node, src)) src.print(u)
                }),
            ),
        ),
    L('clear').executes(() => {}),
    L('goto').then(R<Step>('页面', StepChoices).executes(run((ctx, src) => gotoStep(ctx.get('页面'), src)))),
    L('mode')
        .executes(run((_, src) => src.print(`当前模式: ${store.get(modeAtom)}`)))
        .then(
            R<Mode>('模式', ModeChoices).executes(
                run((ctx, src) => {
                    store.set(modeAtom, ctx.get<Mode>('模式'))
                    src.print(`模式 → ${ctx.get('模式')}`, 'ok')
                }),
            ),
        ),
    L('destiny')
        .executes(run((_, src) => showDestiny(src)))
        .then(
            L('clear').executes(
                run((_, src) => {
                    store.set(destinyAtom, new Map())
                    src.print('已取消全部指定，未来重归天意', 'ok')
                }),
            ),
            L('replace').then(
                R<number>('盲盒', talent()).then(
                    R<number>('结果', talent()).executes(
                        run((ctx, src) => {
                            const box = ctx.get<number>('盲盒')
                            if (!talents.get(box)!.replacement) fail(`${talents.get(box)!.name} 不是盲盒天赋`)
                            destine({ kind: 'replace', talent: box }, ctx.get('结果'), src)
                        }),
                    ),
                ),
            ),
            L('property').then(
                R<number>('天赋', talent()).then(
                    R<Attr>('属性', AttrChoices).executes(
                        run((ctx, src) => {
                            const t = ctx.get<number>('天赋')
                            const attr = ctx.get<Attr>('属性')
                            if (!talents.get(t)!.effect?.RND) fail(`${talents.get(t)!.name} 不是随机属性天赋`)
                            if (attr === 'life' || attr === 'age') fail('随机属性只会加到颜值/智力/体质/家境/快乐')
                            destine({ kind: 'property', talent: t, times: 0 }, attr, src)
                        }),
                    ),
                ),
            ),
            L('event').then(
                R<number>('年龄', integer(0, 500)).then(
                    R<number>('事件', event()).executes(run((ctx, src) => destine({ kind: 'event', age: ctx.get('年龄') }, ctx.get('事件'), src))),
                ),
            ),
            L('next').then(
                R<number>('事件', event()).executes(
                    run((ctx, src) => {
                        const age = (store.get(gameStateAtom)?.props.current.age ?? -1) + 1
                        destine({ kind: 'event', age }, ctx.get('事件'), src)
                    }),
                ),
            ),
        ),
    L('profile')
        .executes(
            run((_, src) => {
                const p = profileOf()
                src.print(`重开 ${p.times} 次`)
                src.print(`成就 ${p.achievements.size}/${achievements.size}  事件 ${p.events.size}/${events.size}  天赋 ${p.talents.size}/${talents.size}`)
                src.print(line('锁定: ', none(join((p.locked ?? []).map(T)))))
            }),
        )
        .then(
            L('export').executes(
                run((_, src) => {
                    const json = JSON.stringify(profileOf(), (_, v) => (v instanceof Set ? [...v] : v))
                    src.print(json)
                    navigator.clipboard?.writeText(json).then(
                        () => src.print('已复制到剪贴板', 'ok'),
                        () => {},
                    )
                }),
            ),
            L('import').then(
                R<string>('json', greedy()).executes(
                    run((ctx, src) => {
                        let o: any
                        try {
                            o = JSON.parse(ctx.get('json'))
                        } catch (e) {
                            return fail(`json 解析失败: ${(e as Error).message}`)
                        }
                        store.set(profileAtom, {
                            ...o,
                            times: Number(o.times) || 0,
                            achievements: new Set<number>(o.achievements ?? []),
                            events: new Set<number>(o.events ?? []),
                            talents: new Set<number>(o.talents ?? []),
                        })
                        src.print('存档已导入', 'ok')
                    }),
                ),
            ),
            L('reset').executes(
                run((_, src) => {
                    store.set(profileAtom, {
                        times: 0,
                        achievements: new Set<number>(),
                        events: new Set<number>(),
                        talents: new Set<number>(),
                    })
                    src.print('存档已清空', 'ok')
                }),
            ),
            L('times')
                .executes(run((_, src) => src.print(`重开 ${profileOf().times} 次`)))
                .then(
                    R<number>('次数', integer(0)).executes(
                        run((ctx, src) => {
                            const times = ctx.get<number>('次数')
                            setProfile(p => ({ ...p, times }))
                            src.print(`重开次数 → ${times}`, 'ok')
                        }),
                    ),
                ),
        ),
    L('config')
        .executes(
            run((_, src) => {
                for (const k of Object.keys(ConfigKeys)) src.print(line(`${k} = ${configGet(k)}`, { text: `  ${ConfigKeys[k]}`, grade: 0 }))
            }),
        )
        .then(
            R<string>('配置项', ConfigChoices)
                .executes(run((ctx, src) => src.print(`${ctx.get('配置项')} = ${configGet(ctx.get('配置项'))}`)))
                .then(
                    R<number>('值', integer()).executes(
                        run((ctx, src) => {
                            const key = ctx.get<string>('配置项')
                            const n = ctx.get<number>('值')
                            const cfg = store.get(configAtom) ?? fail('配置尚未注入')
                            const [a, b] = key.split('.') as [string, string | undefined]
                            const next: any = { ...cfg }
                            if (b) next[a] = { ...next[a], [b]: n }
                            else next[a] = n
                            store.set(configAtom, next)
                            src.print(`${key} → ${n}`, 'ok')
                        }),
                    ),
                ),
        ),
    L('talent').then(
        L('search').then(
            R<string>('关键词', greedy()).executes(
                run((ctx, src) =>
                    search(talents, ctx.get<string>('关键词').trim(), t => [t.name, t.description], (id, t) => line(T(id), ` #${id} ${t.description}`), src),
                ),
            ),
        ),
        L('info').then(
            R<number>('天赋', talent())
                .executes(run((ctx, src) => printLines(talentInfo(ctx.get('天赋')), src)))
                .then(L('raw').executes(run((ctx, src) => src.print(fmt(talents.get(ctx.get('天赋'))))))),
        ),
    ),
    L('achievement').then(
        L('search')
            .executes(run((_, src) => achvSearch('', src)))
            .then(R<string>('关键词', greedy()).executes(run((ctx, src) => achvSearch(ctx.get<string>('关键词').trim(), src)))),
        L('info').then(
            R<number>('成就', achievement())
                .executes(run((ctx, src) => printLines(achievementInfo(ctx.get('成就')), src)))
                .then(L('raw').executes(run((ctx, src) => src.print(fmt(achievements.get(ctx.get('成就'))))))),
        ),
        L('grant')
            .then(L('all').executes(run((_, src) => grant([...achievements.keys()], src))))
            .then(R<number[]>('成就', variadic(achievement())).executes(run((ctx, src) => grant(ctx.get('成就'), src)))),
        L('revoke')
            .then(L('all').executes(run((_, src) => revoke([...achievements.keys()], src))))
            .then(R<number[]>('成就', variadic(achievement())).executes(run((ctx, src) => revoke(ctx.get('成就'), src)))),
    ),
    L('event').then(
        L('search').then(
            R<string>('关键词', greedy()).executes(
                run((ctx, src) =>
                    search(events, ctx.get<string>('关键词').trim(), e => [e.event, e.postEvent ?? ''], (id, e) => line(`#${id} `, E(id), e.postEvent ? ` ${e.postEvent}` : ''), src),
                ),
            ),
        ),
        L('info').then(
            R<number>('事件', event())
                .executes(run((ctx, src) => printLines(eventInfo(ctx.get('事件')), src)))
                .then(L('raw').executes(run((ctx, src) => src.print(fmt(events.get(ctx.get('事件'))))))),
        ),
        L('prereq').then(
            R<number>('事件', event())
                .executes(run((ctx, src) => printLines(prereqTree(ctx.get('事件'), 2), src)))
                .then(R<number>('深度', integer(0, 8)).executes(run((ctx, src) => printLines(prereqTree(ctx.get('事件'), ctx.get('深度')), src)))),
        ),
    ),
    L('pick')
        .executes(run((_, src) => src.print(line('已选: ', none(join([...store.get(pickedAtom)].map(T)))))))
        .then(
            L('add').then(
                R<number[]>('天赋', variadic(talent())).executes(
                    run((ctx, src) => {
                        const next = new Set(store.get(pickedAtom))
                        for (const id of ctx.get<number[]>('天赋')) {
                            const conflict = exclude(id, next)
                            if (conflict != null) src.print(line('注意: ', T(id), ' 与 ', T(conflict), ' 互斥'), 'warn')
                            next.add(id)
                        }
                        setPicked(next, src)
                        src.print(line('已选 → ', join([...next].map(T))), 'ok')
                    }),
                ),
            ),
            L('remove').then(
                R<number[]>('天赋', variadic(talent())).executes(
                    run((ctx, src) => {
                        const next = new Set(store.get(pickedAtom)).difference(new Set(ctx.get<number[]>('天赋')))
                        setPicked(next, src)
                        src.print(line('已选 → ', none(join([...next].map(T)))), 'ok')
                    }),
                ),
            ),
            L('clear').executes(
                run((_, src) => {
                    setPicked(new Set(), src)
                    src.print('已清空选择', 'ok')
                }),
            ),
        ),
    L('lock')
        .executes(run((_, src) => src.print(line('锁定: ', none(join((profileOf().locked ?? []).map(T)))))))
        .then(
            L('add').then(R<number[]>('天赋', variadic(talent())).executes(run((ctx, src) => setLocked(l => [...new Set([...l, ...ctx.get<number[]>('天赋')])], src)))),
            L('remove').then(
                R<number[]>('天赋', variadic(talent())).executes(
                    run((ctx, src) => {
                        const del = new Set(ctx.get<number[]>('天赋'))
                        setLocked(l => l.filter(id => !del.has(id)), src)
                    }),
                ),
            ),
            L('clear').executes(run((_, src) => setLocked(() => [], src))),
        ),
    L('unique')
        .executes(
            run((_, src) => {
                const u = store.get(uniqueAtom)
                if (!u) return src.print('尚未生成唯一角色')
                src.print(`颜值=${u.property.CHR} 智力=${u.property.INT} 体质=${u.property.STR} 家境=${u.property.MNY}`)
                src.print(line('天赋: ', join(u.talent.map(T))))
            }),
        )
        .then(
            L('reset').executes(
                run((_, src) => {
                    store.set(uniqueAtom, null)
                    storageSet('unique', '')
                    src.print('唯一角色已重置，可重新生成', 'ok')
                }),
            ),
        ),
    L('life')
        .requires(hasLife)
        .executes(run((_, src) => showLife(src)))
        .then(
            L('attr').then(
                R<Attr>('属性', AttrChoices)
                    .executes(run((ctx, src) => src.print(`${attrName(ctx.get('属性'))} = ${attrOf(ctx.get('属性'))}`)))
                    .then(
                        L('set').then(R<number>('值', integer()).executes(run((ctx, src) => setAttr(ctx.get('属性'), ctx.get('值'), src)))),
                        L('add').then(
                            R<number>('增量', integer()).executes(
                                run((ctx, src) => setAttr(ctx.get('属性'), attrOf(ctx.get('属性')) + ctx.get<number>('增量'), src)),
                            ),
                        ),
                    ),
            ),
            L('talent').then(
                L('add').then(
                    R<number[]>('天赋', variadic(talent())).executes(
                        run((ctx, src) => {
                            const s = stateOf()
                            const list = ctx.get<number[]>('天赋')
                            setState({ ...s, talents: s.talents.union(new Set(list)) })
                            src.print(line('追加天赋 ', join(list.map(T))), 'ok')
                        }),
                    ),
                ),
            ),
            L('event').then(
                R<number>('事件', event()).executes(
                    run((ctx, src) => {
                        const s = stateOf()
                        const r = triggerEvent(ctx.get('事件'), s, profileOf())
                        setState(r.state)
                        const { age, ...props } = r.state.props.current
                        store.set(logsAtom, logs => [...logs, { age, events: r.triggers, talents: [], achievements: [], end: r.state.life < 1, props }])
                        src.print(line('触发 ', join(r.triggers.map(E), ' → ')), 'ok')
                    }),
                ),
            ),
            L('next')
                .executes(run((_, src) => lifeNext(1, src)))
                .then(R<number>('年数', integer(1, 10000)).executes(run((ctx, src) => lifeNext(ctx.get('年数'), src)))),
        ),
    L('js').then(
        R<string>('代码', greedy()).executes(
            run((ctx, src) => {
                const code = ctx.get<string>('代码')
                const $ = { store, hooks, core, data, get: store.get, set: store.set }
                let fn: Function
                try {
                    fn = new Function('$', `return (${code}\n)`)
                } catch {
                    fn = new Function('$', code)
                }
                src.print(fmt(fn($)))
            }),
        ),
    ),
)

function configGet(key: string) {
    const cfg = store.get(configAtom)
    return key.split('.').reduce<any>((o, p) => o?.[p], cfg)
}
const attrName = (a: Attr) => (a === 'life' ? '生命' : properties[a])

/** 开盲盒（与页面提交相同：以指定为条件抽取，记入历史并清除已生效的指定） */
function openBoxes(list: Set<number>) {
    const { result, realized } = open(list, store.get(destinyAtom))
    store.set(replacedAtom, result)
    store.set(realizeAtom, realized, 'replace')
}

function pointText(p: Point, value: unknown): Seg[] {
    switch (p.kind) {
        case 'replace':
            return line('盲盒 ', T(p.talent), ' → ', T(value as number))
        case 'property':
            return line('随机属性 ', T(p.talent), ` → ${properties[value as keyof Properties]}`)
        case 'event':
            return line(`${p.age} 岁 → `, E(value as number))
    }
}
function parseKey(key: string): Point {
    const [kind, a, b] = key.split(':')
    if (kind === 'replace') return { kind, talent: Number(a) }
    if (kind === 'property') return { kind, talent: Number(a), times: Number(b) }
    return { kind: 'event', age: Number(a) }
}
function showDestiny(src: Source) {
    const d = store.get(destinyAtom)
    if (!d.size) return src.print('没有指定：一切按天意')
    for (const [k, v] of d) src.print(pointText(parseKey(k), v))
}
function destine(point: Point, value: unknown, src: Source) {
    store.set(destinyAtom, new Map(store.get(destinyAtom)).set(pointKey(point), value))
    src.print(line('已指定 ', pointText(point, value), '（若届时不在可选范围内则不生效）'), 'ok')
}

function setLocked(fn: (l: number[]) => number[], src: Source) {
    const next = fn(profileOf().locked ?? [])
    setProfile(p => ({ ...p, locked: next.length ? next : undefined }))
    src.print(line('锁定 → ', none(join(next.map(T)))), 'ok')
}

function achvSearch(q: string, src: Source) {
    const owned = profileOf().achievements
    search(
        achievements,
        q,
        a => [a.name, a.description],
        (id, a) => line(owned.has(id) ? '✔ ' : '· ', A(id), ` #${id} ${a.description}${a.hide ? '（隐藏）' : ''}`),
        src,
    )
}
function grant(ids: number[], src: Source) {
    setProfile(p => ({ ...p, achievements: p.achievements.union(new Set(ids)) }))
    src.print(ids.length > 5 ? `授予 ${ids.length} 个成就` : line('授予 ', join(ids.map(A))), 'ok')
}
function revoke(ids: number[], src: Source) {
    setProfile(p => ({ ...p, achievements: p.achievements.difference(new Set(ids)) }))
    src.print(ids.length > 5 ? `移除 ${ids.length} 个成就` : line('移除 ', join(ids.map(A))), 'ok')
}

const printLines = (lines: Ln[], src: Source) => lines.forEach(l => src.print(l))

/** 执行一行输入；错误以红色输出，不中断控制台 */
export function execute(input: string, src: Source) {
    if (!input.trim()) return
    try {
        dispatcher.execute(input, src)
    } catch (e) {
        if (e instanceof CommandError) {
            const at = e.cursor
            if (at === undefined) return src.print(e.message, 'err')
            const before = input.slice(Math.max(0, at - 16), at)
            src.print(line(e.message, `：${at > 16 ? '…' : ''}${before}`, { text: input.slice(at).trimEnd() || '⟵' }, '⟵[此处]'), 'err')
        } else src.print(String((e as Error)?.stack ?? e), 'err')
    }
}
