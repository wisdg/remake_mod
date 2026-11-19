import { useMemo } from 'react'
import { atom, useAtom } from 'jotai'
import { useProfile, useFateHistory } from '@remake/hooks'
import { foresee, next } from '@remake/core'
import type { Branch, Choice, Foresight, GameState, NextResult, PickResult, ProfileState } from '@remake/core'
import { talents, events, achievements } from '@remake/data'
import { properties } from '@remake/data/etc/display'
import { useDestine, YearBudget, percent } from '.'
import Crumbs, { type Segment } from './Crumbs'

/**
 * 命运浏览器：一次只看一层分支，逐层进入，顶部面包屑记录所走的路径。
 * 节点 id 为“自开局起的完整选择路径”，因此游戏前进后，查看位置随现实前进。
 */

interface Trie {
    choice?: Choice
    p: number
    natural: number
    children: Map<string, Trie>
    branch?: Branch<unknown>
    ghost?: boolean
}

function buildTrie(f: Foresight<unknown>): Trie {
    const root: Trie = { p: 0, natural: 1, children: new Map() }
    for (const b of f.branches) {
        root.p += b.p
        let node = root
        for (const c of b.path) {
            const k = segment(c)
            let child = node.children.get(k)
            if (!child) {
                const natural = c.alternatives.find(([v]) => v === c.value)?.[1] ?? c.p
                child = { choice: c, p: 0, natural, children: new Map() }
                node.children.set(k, child)
                // 被指定的点：保留未走的自然分支以示概率
                if (c.forced === 'yes')
                    for (const [v, ap] of c.alternatives) {
                        if (v === c.value) continue
                        const gc: Choice = { ...c, value: v, p: ap, forced: 'no' }
                        node.children.set(segment(gc), { choice: gc, p: 0, natural: ap, children: new Map(), ghost: true })
                    }
            }
            child.p += b.p
            node = child
        }
        node.branch = b
    }
    return root
}

const segment = (c: { key: string; value: unknown }) => `${c.key}=${String(c.value)}`
const childId = (parent: string, c: Choice) => (parent ? `${parent}/${segment(c)}` : segment(c))
const within = (id: string, root: string) => (root ? id.startsWith(root + '/') : id !== '')

type Kind = 'pick' | 'year'
interface Node {
    id: string
    choice: Choice
    /** 条件概率（被指定/被跳过时为自然概率） */
    cond: number
    /** 自“现在”起的绝对概率 */
    abs: number
    trie: Trie
    kind: Kind
    /** 该节点所在年份开始时的状态 */
    from?: GameState
    exact: boolean
}
interface Level {
    title: string
    nodes: Node[]
    exact: boolean
}

function level(parentId: string, trie: Trie, parentAbs: number, kind: Kind, exact: boolean, from?: GameState): Level {
    const nodes = [...trie.children.values()]
        .map(t => {
            const forced = t.choice!.forced === 'yes'
            const actual = trie.p > 0 ? t.p / trie.p : 0
            return {
                id: childId(parentId, t.choice!),
                choice: t.choice!,
                cond: t.ghost || forced ? t.natural : actual,
                abs: t.ghost ? 0 : parentAbs * actual,
                trie: t,
                kind,
                from,
                exact,
            }
        })
        .sort((a, b) => b.abs - a.abs || b.cond - a.cond)
    const first = nodes[0]?.choice.point
    const title =
        kind === 'pick'
            ? '开启天赋盲盒'
            : `${(from?.props.current.age ?? -1) + 1} 岁 · ${first?.kind === 'property' ? '随机属性' : '事件'}`
    return { title, nodes, exact }
}

const alive = (n: Node) => {
    const r = n.trie.branch?.result as NextResult | undefined
    return n.kind === 'year' && !n.trie.ghost && !!r && r.state.life > 0
}
const canEnter = (n: Node) => !n.trie.ghost && (n.trie.children.size > 0 || alive(n))

const T = ({ id }: { id: number }) => (
    <span className={`grade-${talents.get(id)?.grade ?? 0} graded`}>{talents.get(id)?.name ?? `#${id}`}</span>
)
const E = ({ id }: { id: number }) => (
    <span className={`grade-${events.get(id)?.grade ?? 0} graded`}>{events.get(id)?.event ?? `#${id}`}</span>
)
const A = ({ id }: { id: number }) => (
    <span className={`grade-${achievements.get(id)?.grade ?? 0} graded`}>{achievements.get(id)?.name ?? `#${id}`}</span>
)

function choiceText(c: Choice) {
    switch (c.point.kind) {
        case 'replace':
            return (
                <>
                    <T id={c.point.talent} /> → <T id={c.value as number} />
                </>
            )
        case 'property':
            return (
                <>
                    <T id={c.point.talent} /> → {properties[c.value as keyof typeof properties]}+
                    {talents.get(c.point.talent)?.effect?.RND ?? 0}
                </>
            )
        case 'event':
            return <E id={c.value as number} />
    }
}
/**
 * 面包屑分段：同一年的随机点（随机属性 + 事件）合为一段，概率为该年结果的条件概率；
 * 盲盒每一步各为一段。
 */
function segmentsOf(crumbs: Node[]): Segment[] {
    const groups: Node[][] = []
    for (const n of crumbs) {
        const last = groups.at(-1)
        if (last && n.kind === 'year' && last[0]!.kind === 'year' && last[0]!.from === n.from) last.push(n)
        else groups.push([n])
    }
    let end = 0
    return groups.map(g => {
        end += g.length
        const ids = crumbs.slice(0, end).map(c => c.id)
        const tail = g.at(-1)!
        const exact = g.every(n => n.exact)
        const p = g.reduce((acc, n) => acc * n.cond, 1)
        let head: string | undefined
        let text: string
        if (tail.kind === 'pick') {
            const c = tail.choice
            text = `${talents.get((c.point as { talent: number }).talent)?.name} → ${talents.get(c.value as number)?.name}`
        } else {
            head = `${(tail.from?.props.current.age ?? -1) + 1}岁`
            const props = g
                .filter(n => n.choice.point.kind === 'property')
                .map(n => `${properties[n.choice.value as keyof typeof properties]}+${talents.get((n.choice.point as { talent: number }).talent)?.effect?.RND ?? 0}`)
            const ev = g.find(n => n.choice.point.kind === 'event')
            text = [ev ? (events.get(ev.choice.value as number)?.event ?? '') : '', ...props].filter(Boolean).join(' · ') + (ev ? '' : ' …')
        }
        return {
            key: tail.id,
            ids,
            head,
            text,
            p: percent(p, exact),
            title: `${head ? head + ' ' : ''}${text}\n条件 ${percent(p, exact)} · 累计 ${percent(tail.abs, exact)}`,
        }
    })
}

export const errorText = (e: unknown) =>
    `⚠ 走到此分支游戏会报错：${(e as Error)?.message ?? e}（事件表未覆盖此状态，参见 packages/data/BUGS.md）`

const Props = ['charm', 'intelligence', 'strength', 'money', 'spirit'] as const
function detail(n: Node, picked?: Set<number>) {
    const b = n.trie.branch
    if (!b || n.trie.ghost) return null
    if (b.error) return <span className="warn">{errorText(b.error)}</span>
    if (n.kind === 'pick') {
        const r = b.result as PickResult
        return (
            <>
                最终获得
                {[...r.talents.talents]
                    .filter(t => !picked?.has(t))
                    .map(t => (
                        <T key={t} id={t} />
                    ))}
            </>
        )
    }
    const r = b.result as NextResult
    const from = n.from!
    const now = r.state.props.current
    const delta = Props.map(k => [k, now[k] - from.props.current[k]] as const).filter(([, d]) => d !== 0)
    return (
        <>
            {r.events.slice(1).map(e => (
                <span key={e}>
                    → <E id={e} />
                </span>
            ))}
            {r.talents.length > 0 && (
                <span>
                    [天赋]
                    {r.talents.map(t => (
                        <T key={t} id={t} />
                    ))}
                </span>
            )}
            {delta.length > 0 && (
                <span className="font-mono">
                    {delta.map(([k, d]) => `${properties[k]}${d > 0 ? '+' : ''}${d}`).join(' ')}
                </span>
            )}
            {r.achievements.length > 0 && (
                <span>
                    [成就]
                    {r.achievements.map(a => (
                        <A key={a} id={a} />
                    ))}
                </span>
            )}
            {r.state.life < 1 && <span className="death">☠ 人生结束</span>}
            {r.state.life > from.life && <span className="revive">✚ 复活</span>}
        </>
    )
}

/**
 * 逐年推演按需计算：以不可变的 状态 / 指定 / 存档 对象为键缓存，
 * 任一变化即自然失效，旧结果随对象回收。
 */
const years = new WeakMap<GameState, WeakMap<ReadonlyMap<string, unknown>, WeakMap<ProfileState, Foresight<unknown>>>>()
function yearAhead(state: GameState, profile: ProfileState, destiny: ReadonlyMap<string, unknown>) {
    let byDestiny = years.get(state)
    if (!byDestiny) years.set(state, (byDestiny = new WeakMap()))
    let byProfile = byDestiny.get(destiny)
    if (!byProfile) byDestiny.set(destiny, (byProfile = new WeakMap()))
    let f = byProfile.get(profile)
    if (!f) byProfile.set(profile, (f = foresee(fate => next(state, profile, fate), { overrides: destiny, ...YearBudget })))
    return f
}
const tries = new WeakMap<Foresight<unknown>, Trie>()
function trieOf(f: Foresight<unknown>) {
    let t = tries.get(f)
    if (!t) tries.set(f, (t = buildTrie(f)))
    return t
}

/** 正在查看的路径（节点 id 列表，自开局起的绝对路径） */
const focusAtom = atom<string[]>([])

export interface BrowserProps {
    kind: Kind
    foresight: Foresight<unknown>
    /** 年份推演的起点状态 */
    from?: GameState
    /** “现在”的说明 */
    now: string
    picked?: Set<number>
}

export function Browser({ kind, foresight, from, now, picked }: BrowserProps) {
    const history = useFateHistory()
    const [profile] = useProfile()
    const { cheat, destiny, one, path } = useDestine()
    const [focus, setFocus] = useAtom(focusAtom)
    const rootId = useMemo(() => history.map(segment).join('/'), [history])
    const rootTrie = trieOf(foresight)

    const children = (n: Node): Level | null => {
        if (n.trie.children.size) return level(n.id, n.trie, n.abs, n.kind, n.exact, n.from)
        if (!alive(n)) return null
        const state = (n.trie.branch!.result as NextResult).state
        const f = yearAhead(state, profile, destiny)
        return level(n.id, trieOf(f), n.abs, 'year', f.exact, state)
    }

    // 解析面包屑：已成为历史的部分自动移除，与现实分叉则止步
    let current = level(rootId, rootTrie, 1, kind, foresight.exact, from)
    const crumbs: Node[] = []
    for (const id of focus.filter(id => within(id, rootId))) {
        const n = current.nodes.find(x => x.id === id)
        if (!n) break
        const lv = children(n)
        if (!lv) break
        crumbs.push(n)
        current = lv
    }
    const go = (ids: string[]) => setFocus(ids)
    const segments = segmentsOf(crumbs)
    const enter = (n: Node) => canEnter(n) && go([...crumbs.map(c => c.id), n.id])
    const destineTo = (n: Node) => path([...crumbs.map(c => c.choice), n.choice])

    if (current.nodes.length === 0) {
        const b = foresight.branches[0]
        return <div className="tree-empty">{b?.error ? errorText(b.error) : '没有随机分支：结果已确定'}</div>
    }
    const last = crumbs.at(-1)
    return (
        <div className="browser">
            <Crumbs root={now} segments={segments} onGo={go} />
            <div className="level-title">
                <span>{current.title}</span>
                {!current.exact && <span className="warn">分支过多，概率为抽样估计</span>}
                {current.nodes.some(n => n.trie.ghost) && <span className="note">已指定，其余分支（淡色）不会发生</span>}
                {last && <span className="abs font-mono">到达此处 {percent(last.abs, last.exact)}</span>}
            </div>
            <ul className="branches">
                {current.nodes.map(n => {
                    const forced = n.choice.forced === 'yes' && !n.trie.ghost
                    const enterable = canEnter(n)
                    const err = !!n.trie.branch?.error
                    return (
                        <li
                            key={n.id}
                            className={`branch ${n.trie.ghost ? 'ghost' : ''} ${forced ? 'forced' : ''} ${err ? 'error' : ''} ${enterable ? 'enterable' : ''}`}
                            onClick={() => enter(n)}
                        >
                            <span className="p font-mono" title={`累计 ${percent(n.abs, n.exact)}`}>
                                {percent(n.cond, n.exact)}
                            </span>
                            <div className="main">
                                <div className="label">{choiceText(n.choice)}</div>
                                <div className="detail">
                                    {forced && <span className="tag">✓ 已指定</span>}
                                    {n.choice.forced === 'unreachable' && <span className="tag warn">指定不可达</span>}
                                    {detail(n, picked)}
                                </div>
                            </div>
                            <div className="side">
                                {cheat && (
                                    <button
                                        className="destine"
                                        title={forced ? '取消指定' : '指定命运走向这里（含面包屑中的各步）'}
                                        onClick={e => {
                                            e.stopPropagation()
                                            if (forced) one(n.choice.point, undefined)
                                            else destineTo(n)
                                        }}
                                    >
                                        {forced ? '取消' : '指定'}
                                    </button>
                                )}
                                <span className="go">{enterable ? '›' : ''}</span>
                            </div>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}
export default Browser
