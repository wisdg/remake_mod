import { talents, achievements, events } from '@remake/data'
import type { ArgumentType, SuggestionsBuilder } from './brigadier'
import { quote } from './brigadier'

export function integer(min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): ArgumentType<number> {
    return {
        parse(reader) {
            const start = reader.cursor
            const n = reader.readInt()
            if (n < min) throw reader.error(`不能小于 ${min}`, start)
            if (n > max) throw reader.error(`不能大于 ${max}`, start)
            return n
        },
    }
}

/** 吃掉剩余全部输入 */
export function greedy(hint?: string): ArgumentType<string> {
    return {
        parse(reader) {
            const start = reader.cursor
            const s = reader.readGreedy()
            if (!s.trim()) throw reader.error('不能为空', start)
            return s
        },
        suggest: hint ? b => void (b.remaining || b.suggest(hint)) : undefined,
    }
}

export interface Choice<T> {
    value: T
    /** 补全插入的文本，也是首选写法 */
    text: string
    aliases?: string[]
    tooltip?: string
}

/** 枚举：可用 text 或任一别名，补全时也按别名/说明匹配 */
export function choice<T>(kind: string, options: Choice<T>[] | (() => Choice<T>[])): ArgumentType<T> {
    const all = () => (typeof options === 'function' ? options() : options)
    return {
        parse(reader) {
            const start = reader.cursor
            const token = reader.readString()
            const lower = token.toLowerCase()
            const hit = all().find(o => o.text === token || o.aliases?.some(a => a.toLowerCase() === lower))
            if (!hit) throw reader.error(token ? `未知${kind}: ${token}` : `应为${kind}`, start)
            return hit.value
        },
        suggest(b) {
            const q = b.remainingLower
            for (const o of all()) {
                const keys = [o.text, ...(o.aliases ?? []), o.tooltip ?? ''].map(k => k.toLowerCase())
                if (!q || keys.some(k => k.includes(q))) {
                    const alias = o.aliases?.length ? ` (${o.aliases.join(' ')})` : ''
                    b.suggest(o.text, { tooltip: (o.tooltip ?? '') + alias })
                }
            }
        },
    }
}

/** 可按名称引用的数据目录 */
interface Catalog<T> {
    kind: string
    items: Map<number, T>
    name?: (t: T) => string
    detail: (t: T) => string
    grade: (t: T) => number
}

/** 参数结果：数据 id */
function reference<T>(c: Catalog<T>): ArgumentType<number> {
    const list = [...c.items.entries()]
    const byName = c.name ? Map.groupBy(list, ([, t]) => c.name!(t)) : new Map<string, [number, T][]>()
    const insertText = (id: number, t: T) => {
        if (!c.name) return String(id)
        const name = c.name(t)
        return byName.get(name)!.length === 1 ? quote(name) : String(id)
    }
    return {
        parse(reader) {
            const start = reader.cursor
            if (/\d/.test(reader.peek())) {
                const id = reader.readInt()
                if (!c.items.has(id)) throw reader.error(`不存在的${c.kind} #${id}`, start)
                return id
            }
            const token = reader.readString()
            if (!token) throw reader.error(`应为${c.kind}`, start)
            const exact = byName.get(token)
            if (exact?.length === 1) return exact[0]![0]
            if (exact && exact.length > 1)
                throw reader.error(`“${token}”对应多个${c.kind}（${exact.map(([id]) => id).join('、')}），请用 id`, start)
            if (!c.name) {
                // 无名称的数据（事件）：按文本唯一匹配
                const hits = list.filter(([, t]) => c.detail(t).includes(token))
                if (hits.length === 1) return hits[0]![0]
                if (hits.length > 1) throw reader.error(`“${token}”匹配 ${hits.length} 个${c.kind}，请从补全中选择`, start)
            }
            throw reader.error(`未知${c.kind}: ${token}`, start)
        },
        suggest(b: SuggestionsBuilder) {
            const q = b.remaining.replace(/^["']/, '').toLowerCase()
            const ranked: [number, number, T][] = []
            for (const [id, t] of list) {
                const name = c.name?.(t).toLowerCase() ?? ''
                const score = !q
                    ? 0
                    : name.startsWith(q)
                      ? 0
                      : name.includes(q)
                        ? 1
                        : String(id).startsWith(q)
                          ? 2
                          : c.detail(t).toLowerCase().includes(q)
                            ? 3
                            : -1
                if (score >= 0) ranked.push([score, id, t])
            }
            ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1])
            for (const [, id, t] of ranked.slice(0, 200)) {
                const tooltip = c.name ? `#${id} ${c.detail(t)}` : `${c.detail(t)}`
                b.suggest(insertText(id, t), { tooltip, grade: c.grade(t) })
            }
        },
    }
}

export const talent = () =>
    reference({
        kind: '天赋',
        items: talents,
        name: t => t.name,
        detail: t => t.description,
        grade: t => t.grade,
    })

export const achievement = () =>
    reference({
        kind: '成就',
        items: achievements,
        name: a => a.name,
        detail: a => a.description,
        grade: a => a.grade,
    })

export const event = () =>
    reference({
        kind: '事件',
        items: events,
        detail: e => e.event,
        grade: e => e.grade ?? 0,
    })
