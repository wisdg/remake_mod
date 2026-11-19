/**
 * 图鉴：把天赋 / 事件 / 成就的数据定义翻译成人能读懂的文字，并建立反查索引。
 * 输出为“行”（片段数组），片段可带稀有度着色或弱化，由控制台渲染。
 */
import { parse, type ConditionNode } from '@remake/condition'
import { talents, events, achievements, ages, AchievementOpportunity } from '@remake/data'
import type { Talent, Event, Achievement } from '@remake/data'

export interface Seg {
    text: string
    grade?: number
    dim?: boolean
}
export type Ln = Seg[]

const s = (text: string, extra: Omit<Seg, 'text'> = {}): Seg => ({ text, ...extra })
const dim = (text: string): Seg => ({ text, dim: true })
const cut = (t: string, n = 18) => (t.length > n ? t.slice(0, n) + '…' : t)

export const T = (id: number): Seg => s(talents.get(id)?.name ?? `#${id}`, { grade: talents.get(id)?.grade })
export const A = (id: number): Seg => s(achievements.get(id)?.name ?? `#${id}`, { grade: achievements.get(id)?.grade })
/** 事件：截断的文本 + 弱化的 id（事件没有名字，id 便于继续查询） */
export const E = (id: number, n = 18): Seg[] => [
    s(`「${cut(events.get(id)?.event ?? '?', n)}」`, { grade: events.get(id)?.grade }),
    dim(`#${id}`),
]
const join = (parts: Seg[][], sep: string): Seg[] => parts.flatMap((p, i) => (i ? [s(sep), ...p] : p))
const GradeName = ['白', '蓝', '紫', '橙']

/* ---------- 条件 ---------- */

const NumKeys: Record<string, string> = {
    AGE: '年龄',
    CHR: '颜值',
    INT: '智力',
    STR: '体质',
    MNY: '家境',
    SPR: '快乐',
    HAGE: '年龄',
    HCHR: '历史最高颜值',
    HINT: '历史最高智力',
    HSTR: '历史最高体质',
    HMNY: '历史最高家境',
    HSPR: '历史最高快乐',
    LAGE: '历史最低年龄',
    LCHR: '历史最低颜值',
    LINT: '历史最低智力',
    LSTR: '历史最低体质',
    LMNY: '历史最低家境',
    LSPR: '历史最低快乐',
    LIF: '生命',
    SUM: '总评',
    TMS: '重开次数',
}
const Ops: Record<string, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '=': '=', '!=': '≠' }

interface Atom {
    key: string
    op: string
    value: number | number[]
}
export function parseAtom(text: string): Atom | null {
    const m = text.match(/^([A-Z]+)(>=|<=|!=|[><!?=])(.*)$/)
    if (!m) return null
    const raw = m[3]!
    return { key: m[1]!, op: m[2]!, value: raw.startsWith('[') ? (JSON.parse(raw) as number[]) : Number(raw) }
}

function atomText(text: string): Seg[] {
    const a = parseAtom(text)
    if (!a) return [s(text)]
    if (!Array.isArray(a.value)) return [s(`${NumKeys[a.key] ?? a.key} ${Ops[a.op] ?? a.op} ${a.value}`)]
    const any = a.op === '?'
    const ids = a.value
    const list = (ref: (id: number) => Seg[]) => join(ids.map(ref), any ? ' 或 ' : '、')
    switch (a.key) {
        case 'TLT':
            return [s(any ? '拥有天赋 ' : '没有天赋 '), ...list(id => [T(id)])]
        case 'EVT':
            return [s(any ? '本局经历过' : '本局没经历过'), ...list(id => E(id))]
        case 'AEVT':
            return [s(any ? '往世经历过' : '往世没经历过'), ...list(id => E(id))]
        case 'ATLT':
            return [s(any ? '往世拥有过天赋 ' : '往世没拥有过天赋 '), ...list(id => [T(id)])]
        case 'AACH':
            return [s(any ? '已达成成就 ' : '未达成成就 '), ...list(id => [A(id)])]
        case 'AGE':
            return [s(`年龄${any ? '为' : '不是'} ${ids.join('/')} 岁`)]
        default:
            return [s(text)]
    }
}

/** 去掉只有一个元素的嵌套 */
function unwrap(n: ConditionNode): ConditionNode {
    while (Array.isArray(n) && n.length === 1) n = n[0]!
    return n
}
function inline(n: ConditionNode): Seg[] {
    n = unwrap(n)
    if (!Array.isArray(n)) return atomText(n)
    const out: Seg[] = []
    n.forEach((x, i) => {
        if (i % 2) return out.push(s(x === '&' ? ' 且 ' : ' 或 '))
        const u = unwrap(x)
        if (Array.isArray(u)) out.push(s('（'), ...inline(u), s('）'))
        else out.push(...atomText(u))
    })
    return out
}

/** 条件 → 若干行：顶层全为“且”时逐条列出；全为“或”时注明“满足其一”；混合则一行 */
export function conditionLines(cond: string | undefined, indent = '  '): Ln[] {
    return cond ? conditionLinesOf(parse(cond), indent) : []
}
function conditionLinesOf(node: ConditionNode, indent: string): Ln[] {
    const n = unwrap(node)
    if (!Array.isArray(n)) return [[s(indent + '· '), ...atomText(n)]]
    const ops = new Set(n.filter((_, i) => i % 2) as string[])
    if (ops.size === 1) {
        const operands = n.filter((_, i) => !(i % 2))
        const head: Ln[] = ops.has('|') ? [[s(indent), dim('满足其一：')]] : []
        return [...head, ...operands.map(o => [s(indent + '· '), ...inline(o)])]
    }
    return [[s(indent + '· '), ...inline(n)]]
}

/** 条件中引用到的 id（按键与正负） */
function refsOf(cond: string | undefined) {
    const out: { key: string; positive: boolean; ids: number[] }[] = []
    if (!cond) return out
    const walk = (n: ConditionNode) => {
        if (Array.isArray(n)) return n.forEach(walk)
        const a = parseAtom(n)
        if (a && Array.isArray(a.value)) out.push({ key: a.key, positive: a.op === '?', ids: a.value })
    }
    walk(parse(cond))
    return out
}

/* ---------- 索引 ---------- */

interface AgeEntry {
    age: number
    level: number
    weight: number
}
type RefKind = 'event-include' | 'event-exclude' | 'branch' | 'talent' | 'achievement'
interface Ref {
    kind: RefKind
    id: number
    positive: boolean
    /** 分支：父事件 */
    parent?: number
}

let index: {
    ages: Map<number, AgeEntry[]>
    branchParents: Map<number, { parent: number; condition: string }[]>
    refs: Map<string, Ref[]>
} | null = null

function idx() {
    if (index) return index
    const agesOf = new Map<number, AgeEntry[]>()
    for (const { age, event } of ages.values())
        event.forEach((level, li) => {
            for (const [id, weight] of level) {
                let l = agesOf.get(id)
                if (!l) agesOf.set(id, (l = []))
                l.push({ age, level: li + 1, weight })
            }
        })
    const branchParents = new Map<number, { parent: number; condition: string }[]>()
    const refs = new Map<string, Ref[]>()
    const add = (key: string, r: Ref) => {
        let l = refs.get(key)
        if (!l) refs.set(key, (l = []))
        if (!l.some(x => x.kind === r.kind && x.id === r.id && x.positive === r.positive)) l.push(r)
    }
    const collect = (cond: string | undefined, kind: RefKind, id: number, parent?: number) => {
        for (const r of refsOf(cond)) for (const target of r.ids) add(`${r.key}:${target}`, { kind, id, positive: r.positive, parent })
    }
    for (const e of events.values()) {
        collect(e.include, 'event-include', e.id)
        collect(e.exclude, 'event-exclude', e.id)
        for (const b of e.branch ?? []) {
            let l = branchParents.get(b.event)
            if (!l) branchParents.set(b.event, (l = []))
            l.push({ parent: e.id, condition: b.condition })
            collect(b.condition, 'branch', b.event, e.id)
        }
    }
    for (const t of talents.values()) collect(t.condition, 'talent', t.id)
    for (const a of achievements.values()) collect(a.condition, 'achievement', a.id)
    index = { ages: agesOf, branchParents, refs }
    return index
}

/** 年龄列表压缩：连续年龄且层级/权重相同的合并 */
export function ageRanges(id: number): string[] {
    const list = [...(idx().ages.get(id) ?? [])].sort((a, b) => a.age - b.age)
    const out: string[] = []
    for (let i = 0; i < list.length; ) {
        let j = i
        while (j + 1 < list.length && list[j + 1]!.age === list[j]!.age + 1 && list[j + 1]!.level === list[i]!.level && list[j + 1]!.weight === list[i]!.weight) j++
        const a = list[i]!
        const range = j > i ? `${a.age}–${list[j]!.age}` : `${a.age}`
        out.push(`${range} 岁（第 ${a.level} 层 · 权重 ${a.weight}）`)
        i = j + 1
    }
    return out
}

/* ---------- 最早年龄（只考虑事件前置） ---------- */

let earliestCache: Map<number, number> | null = null
/**
 * 正常时间线（不发生时光倒流）下事件最早可能发生的年龄下界：
 * 只考虑“本局经历过某事件”的前置与分支来源，忽略属性 / 天赋等其余条件（它们只会更晚或更难）。
 * Infinity 表示正常时间线上不可能；是否根本不可能见 reachable。
 */
export function earliest(id: number): number {
    if (!earliestCache) {
        const { ages: agesOf, branchParents } = idx()
        const est = new Map<number, number>()
        const get = (e: number) => est.get(e) ?? Infinity
        // 条件中“经历过事件”需要的最早年龄：且取大、或取小；其余原子不限制
        const need = (n: ConditionNode): number => {
            n = unwrap(n)
            if (!Array.isArray(n)) {
                const a = parseAtom(n)
                if (a?.key === 'EVT' && a.op === '?' && Array.isArray(a.value)) return Math.min(...a.value.map(get))
                return -Infinity
            }
            let acc = need(n[0]!)
            for (let i = 1; i < n.length; i += 2) {
                const v = need(n[i + 1]!)
                acc = n[i] === '&' ? Math.max(acc, v) : Math.min(acc, v)
            }
            return acc
        }
        for (let changed = true; changed; ) {
            changed = false
            for (const e of events.values()) {
                const req = e.include ? need(parse(e.include)) : -Infinity
                let best = Infinity
                if (!e.NoRandom)
                    for (const { age } of agesOf.get(e.id) ?? []) if (age > req && age < best) best = age
                // 分支与父事件同年发生；父事件可能晚于其最早年龄才发生，
                // 所以下界是 max(父事件最早年龄, 分支条件所需最早年龄)
                for (const { parent, condition } of branchParents.get(e.id) ?? []) {
                    const at = Math.max(get(parent), need(parse(condition)))
                    if (at < best) best = at
                }
                if (best < get(e.id)) {
                    est.set(e.id, best)
                    changed = true
                }
            }
        }
        earliestCache = est
    }
    return earliestCache.get(id) ?? Infinity
}
/* ---------- 可达性（不考虑时间顺序） ---------- */

let reachCache: Set<number> | null = null
/**
 * 事件是否可能发生：有来源（年龄事件池 / 可达父事件的分支），且“本局经历过某事件”的前置可达。
 * 不考虑时间先后（时光倒流会让年龄回退，顺序约束不再成立），忽略属性 / 天赋等条件，
 * 因此判定“不可能”是可靠的。依赖自身或成环且无外部入口的事件为不可能。
 */
export function reachable(id: number): boolean {
    if (!reachCache) {
        const { ages: agesOf, branchParents } = idx()
        const set = new Set<number>()
        const ok = (n: ConditionNode): boolean => {
            n = unwrap(n)
            if (!Array.isArray(n)) {
                const a = parseAtom(n)
                if (a?.key === 'EVT' && a.op === '?' && Array.isArray(a.value)) return a.value.some(x => set.has(x))
                return true
            }
            let acc = ok(n[0]!)
            for (let i = 1; i < n.length; i += 2) acc = n[i] === '&' ? acc && ok(n[i + 1]!) : acc || ok(n[i + 1]!)
            return acc
        }
        for (let changed = true; changed; ) {
            changed = false
            for (const e of events.values()) {
                if (set.has(e.id)) continue
                const fromPool = !e.NoRandom && (agesOf.get(e.id)?.length ?? 0) > 0 && (!e.include || ok(parse(e.include)))
                const fromBranch = (branchParents.get(e.id) ?? []).some(p => set.has(p.parent) && ok(parse(p.condition)))
                if (fromPool || fromBranch) {
                    set.add(e.id)
                    changed = true
                }
            }
        }
        reachCache = set
    }
    return reachCache.has(id)
}

const earliestText = (id: number): Seg =>
    !reachable(id)
        ? s('不可能发生')
        : Number.isFinite(earliest(id))
          ? dim(`正常时间线最早 ${earliest(id)} 岁`)
          : s('正常时间线上不可能；须经时光倒流（年龄回退）才可能发生')

/* ---------- 列表 ---------- */

const MaxList = 8
function listLine(label: string, items: Seg[][], sep = '、'): Ln[] {
    if (!items.length) return []
    const more = items.length > MaxList ? [dim(` …等 ${items.length} 个`)] : []
    return [[s(`  ${label}：`), ...join(items.slice(0, MaxList), sep), ...more]]
}
const refsTo = (key: string, kind: RefKind, positive: boolean) =>
    (idx().refs.get(key) ?? []).filter(r => r.kind === kind && r.positive === positive)

function effectText(effect: Partial<Record<string, number>> | undefined): string {
    if (!effect) return ''
    const names: Record<string, string> = { CHR: '颜值', INT: '智力', STR: '体质', MNY: '家境', SPR: '快乐', RND: '随机属性', LIF: '生命', AGE: '年龄' }
    return Object.entries(effect)
        .filter(([, v]) => v)
        .map(([k, v]) => `${names[k] ?? k}${v! > 0 ? '+' : ''}${v}`)
        .join(' ')
}

/* ---------- 详情 ---------- */

export function talentInfo(id: number): Ln[] {
    const t = talents.get(id) as Talent
    const lines: Ln[] = [[T(id), dim(` #${id}`), s(` [${GradeName[t.grade]}] `), s(t.description)]]
    const fx = effectText(t.effect)
    if (fx) lines.push([s(`  效果：${fx}`)])
    if (t.points) lines.push([s(`  初始可用属性点 ${t.points > 0 ? '+' : ''}${t.points}`)])
    if (t.condition) lines.push([s('  触发条件：')], ...conditionLines(t.condition, '    '))
    else if (fx) lines.push([s('  触发条件：无（第一年即触发）')])
    if (fx || t.condition) lines.push([s(`  触发上限：${t.max} 次`)])
    if (t.exclusive) lines.push([s('  专属天赋：抽卡抽不到，只属于特定名人')])
    lines.push(...listLine('互斥', (t.exclude ?? []).map(x => [T(x)])))
    const r = t.replacement
    if (r?.talent) {
        const total = r.talent.reduce((a, [, w]) => a + w, 0)
        lines.push(...listLine('盲盒：可能开出（按权重）', r.talent.map(([x, w]) => [T(x), dim(` ${((w / total) * 100).toFixed(1)}%`)]), '  '))
    } else if (r?.grade !== undefined) lines.push([s(`  盲盒：随机开出一个${GradeName[r.grade]}色天赋（等概率，排除已有与互斥）`)])
    lines.push(...listLine('需要此天赋的事件', refsTo(`TLT:${id}`, 'event-include', true).map(x => E(x.id, 12))))
    lines.push(...listLine('被此天赋排除的事件', refsTo(`TLT:${id}`, 'event-exclude', true).map(x => E(x.id, 12))))
    lines.push(...listLine('相关成就', (idx().refs.get(`TLT:${id}`) ?? []).filter(x => x.kind === 'achievement').map(x => [A(x.id)])))
    return lines
}

export function eventInfo(id: number): Ln[] {
    const e = events.get(id) as Event
    const lines: Ln[] = [[...E(id, 60), s(` [${GradeName[e.grade]}] `), earliestText(id)]]
    if (e.postEvent) lines.push([s(`  随后：${e.postEvent}`)])
    const fx = effectText(e.effect)
    if (fx) lines.push([s(`  效果：${fx}`)])
    // 来源
    const where = ageRanges(id)
    if (e.NoRandom) lines.push([s('  不会被随机抽到，只能经由分支发生')])
    else if (where.length) lines.push(...listLine('出现于', where.map(w => [s(w)]), '；'))
    else lines.push([s('  不在任何年龄的事件池中')])
    const parents = idx().branchParents.get(id) ?? []
    if (parents.length) {
        lines.push([s('  由以下事件的分支导向：')])
        for (const p of parents.slice(0, MaxList)) lines.push([s('    · '), ...E(p.parent, 16), s(' 时，若 '), ...inline(parse(p.condition))])
        if (parents.length > MaxList) lines.push([dim(`    …等 ${parents.length} 个`)])
    }
    if (e.include) lines.push([s('  出现条件：')], ...conditionLines(e.include, '    '))
    if (e.exclude) {
        const { repeat, rest } = splitSelf(e)
        if (repeat && !rest) lines.push([s('  不会重复发生')])
        else lines.push([s('  排除条件（满足则不会出现）：')], ...excludeLines(e, '    '))
    }
    if (e.branch?.length) {
        lines.push([s('  分支（按顺序，命中第一个）：')])
        for (const b of e.branch) lines.push([s('    · 若 '), ...inline(parse(b.condition)), s(' → '), ...E(b.event, 16)])
    }
    // 后续
    const others = (r: Ref[]) => r.filter(x => x.id !== id)
    lines.push(...listLine('以此为前提的事件', others(refsTo(`EVT:${id}`, 'event-include', true)).map(x => E(x.id, 12))))
    lines.push(...listLine('此事件会排除的事件', others(refsTo(`EVT:${id}`, 'event-exclude', true)).map(x => E(x.id, 12))))
    lines.push(...listLine('相关成就', (idx().refs.get(`EVT:${id}`) ?? []).filter(x => x.kind === 'achievement').map(x => [A(x.id)])))
    return lines
}

const OpportunityText: Record<string, string> = {
    [AchievementOpportunity.Start]: '开始新人生时',
    [AchievementOpportunity.Trajectory]: '人生的每一年',
    [AchievementOpportunity.Summary]: '人生总结时',
    [AchievementOpportunity.End]: '重开时',
}
export function achievementInfo(id: number): Ln[] {
    const a = achievements.get(id) as Achievement
    return [
        [A(id), dim(` #${id}`), s(` [${GradeName[a.grade]}] `), s(a.description), ...(a.hide ? [dim('（隐藏成就）')] : [])],
        [s(`  判定时机：${OpportunityText[a.opportunity] ?? a.opportunity}`)],
        [s('  达成条件：')],
        ...conditionLines(a.condition, '    '),
    ]
}

/* ---------- 自我排除 ---------- */

/**
 * 排除条件里的“本局经历过自己”是“不会重复发生”的惯用写法。
 * 仅当它处于顶层“或”中（或就是整个条件）时才可单独表述；在条件树上剔除它。
 */
function splitSelf(e: Event): { repeat: boolean; rest: ConditionNode | null } {
    if (!e.exclude) return { repeat: false, rest: null }
    const tree = unwrap(parse(e.exclude))
    const operands = Array.isArray(tree) && tree.filter((_, i) => i % 2).every(op => op === '|') ? tree.filter((_, i) => !(i % 2)) : [tree]
    let repeat = false
    const kept: ConditionNode[] = []
    for (const o of operands) {
        const u = unwrap(o)
        const a = typeof u === 'string' ? parseAtom(u) : null
        if (a && a.key === 'EVT' && a.op === '?' && Array.isArray(a.value) && a.value.includes(e.id)) {
            repeat = true
            const others = a.value.filter(x => x !== e.id)
            if (others.length) kept.push(`EVT?[${others.join(',')}]`)
        } else kept.push(o)
    }
    if (!repeat) return { repeat, rest: tree }
    const rest = kept.length ? kept.flatMap((k, i) => (i ? ['|', k] : [k])) : null
    return { repeat, rest }
}
function excludeLines(e: Event, indent: string): Ln[] {
    const { repeat, rest } = splitSelf(e)
    const lines: Ln[] = []
    if (rest) lines.push(...conditionLinesOf(rest, indent))
    if (repeat) lines.push([s(indent + '· '), s('不会重复发生')])
    return lines
}

/* ---------- 前提树 ---------- */

/**
 * 事件的前提树：出现于哪些年龄、需要哪些条件；“本局经历过某事件”的前置逐层展开，
 * 分支来源也逐层展开。已展开过的事件不再重复（标注“见上”）。
 */
export function prereqTree(id: number, depth: number): Ln[] {
    const lines: Ln[] = []
    const seen = new Set<number>()
    const node = (e: number, prefix: string, d: number, label: Seg[], suffix: Seg[] = []) => {
        const ev = events.get(e)!
        lines.push([s(prefix), ...label, ...E(e, 22), ...suffix, s(' '), earliestText(e)])
        const child = prefix.replace(/[├└]─ $/, m => (m.startsWith('├') ? '│  ' : '   '))
        if (seen.has(e)) {
            lines[lines.length - 1]!.push(dim(' （见上）'))
            return
        }
        seen.add(e)
        type Item = { line?: Ln; sub?: [number, Seg[], Seg[]?] }
        const items: Item[] = []
        const where = ageRanges(e)
        if (ev.NoRandom) items.push({ line: [s('仅经由分支发生')] })
        else if (where.length) items.push({ line: [s('出现于 '), s(where.slice(0, 3).join('；')), ...(where.length > 3 ? [dim(` …共 ${where.length} 段`)] : [])] })
        else if (!(idx().branchParents.get(e) ?? []).length) items.push({ line: [s('不在任何事件池中，也没有分支导向')] })
        if (ev.include) items.push({ line: [s('需要 '), ...inline(parse(ev.include))] })
        if (ev.exclude) {
            const { repeat, rest } = splitSelf(ev)
            if (rest) items.push({ line: [s('且不能 '), ...inline(rest), ...(repeat ? [dim('；不会重复发生')] : [])] })
            else if (repeat) items.push({ line: [dim('不会重复发生')] })
        }
        if (d > 0) {
            const pre = new Set<number>()
            for (const r of refsOf(ev.include)) if (r.key === 'EVT' && r.positive) r.ids.forEach(x => pre.add(x))
            for (const x of pre) items.push({ sub: [x, [dim('前置 ')]] })
            for (const p of idx().branchParents.get(e) ?? []) items.push({ sub: [p.parent, [dim('分支自 ')], [dim('（若 '), ...inline(parse(p.condition)), dim('）')]] })
        }
        items.forEach((it, i) => {
            const branch = i === items.length - 1 ? '└─ ' : '├─ '
            if (it.line) lines.push([s(child + branch), ...it.line])
            else node(it.sub![0], child + branch, d - 1, it.sub![1], it.sub![2])
        })
    }
    node(id, '', depth, [])
    return lines
}
