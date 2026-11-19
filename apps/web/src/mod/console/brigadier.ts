/**
 * Brigadier 式命令引擎（参照 Mojang/brigadier 的设计）：
 * 命令树（字面量 / 类型化参数）→ 解析出带区间的上下文 → 据此执行、补全、高亮、生成用法。
 * 本文件与游戏无关。
 */

const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n'

export class CommandError extends Error {
    constructor(
        message: string,
        readonly cursor?: number,
    ) {
        super(message)
    }
}

export class StringReader {
    constructor(
        readonly string: string,
        public cursor = 0,
    ) {}
    get remaining() {
        return this.string.slice(this.cursor)
    }
    canRead(length = 1) {
        return this.cursor + length <= this.string.length
    }
    peek(offset = 0) {
        return this.string.charAt(this.cursor + offset)
    }
    read() {
        return this.string.charAt(this.cursor++)
    }
    skip() {
        this.cursor++
    }
    skipWhitespace() {
        while (this.canRead() && isWs(this.peek())) this.skip()
    }
    atWhitespace() {
        return this.canRead() && isWs(this.peek())
    }
    clone() {
        return new StringReader(this.string, this.cursor)
    }
    error(message: string, cursor = this.cursor) {
        return new CommandError(message, cursor)
    }
    /** 读到空白为止（允许中文等任意非空白字符） */
    readUnquoted() {
        const start = this.cursor
        while (this.canRead() && !isWs(this.peek())) this.skip()
        return this.string.slice(start, this.cursor)
    }
    readQuoted() {
        const start = this.cursor
        const quote = this.read()
        let result = ''
        let escaped = false
        while (this.canRead()) {
            const c = this.read()
            if (escaped) {
                result += c
                escaped = false
            } else if (c === '\\') escaped = true
            else if (c === quote) return result
            else result += c
        }
        throw this.error('引号未闭合', start)
    }
    readString() {
        const c = this.peek()
        return c === '"' || c === "'" ? this.readQuoted() : this.readUnquoted()
    }
    readInt() {
        const start = this.cursor
        const token = this.readUnquoted()
        if (!token) throw this.error('应为整数', start)
        const n = Number(token)
        if (!/^[-+]?\d+$/.test(token) || !Number.isSafeInteger(n))
            throw this.error(`无效的整数: ${token}`, start)
        return n
    }
    readGreedy() {
        const s = this.remaining
        this.cursor = this.string.length
        return s
    }
}

/** 需要时给字符串加引号，保证能被 readString 读回 */
export function quote(s: string) {
    if (s && !/[\s"'\\]/.test(s) && s[0] !== '"' && s[0] !== "'") return s
    return `"${s.replace(/["\\]/g, m => '\\' + m)}"`
}

export interface Suggestion {
    start: number
    end: number
    text: string
    tooltip?: string
    grade?: number
    /** 采纳后还需继续输入（自动补空格） */
    continues?: boolean
}

export class SuggestionsBuilder {
    readonly remaining: string
    readonly remainingLower: string
    readonly list: Suggestion[] = []
    constructor(
        readonly input: string,
        readonly start: number,
    ) {
        this.remaining = input.slice(start)
        this.remainingLower = this.remaining.toLowerCase()
    }
    suggest(text: string, extra: Omit<Suggestion, 'start' | 'end' | 'text'> = {}) {
        if (text === this.remaining) return this
        this.list.push({ start: this.start, end: this.input.length, text, ...extra })
        return this
    }
    /** 从 offset 处开始的子构造器，结果写回本构造器 */
    at(offset: number) {
        const sub = new SuggestionsBuilder(this.input, this.start + offset)
        ;(sub as { list: Suggestion[] }).list = this.list
        return sub
    }
}

export interface ArgumentType<T> {
    parse(reader: StringReader): T
    suggest?(builder: SuggestionsBuilder): void
    /** 可重复：吃掉多个以空白分隔的值，补全时针对最后一个 */
    variadic?: boolean
    /** 已解析文本中各项的区间（相对偏移），用于逐项高亮 */
    split?(text: string): [number, number][]
}

export interface CommandContext<S> {
    source: S
    input: string
    get<T>(name: string): T
    has(name: string): boolean
}
export type Command<S> = (ctx: CommandContext<S>) => void

interface ParsedNode<S> {
    node: CommandNode<S>
    start: number
    end: number
}

class ContextBuilder<S> {
    nodes: ParsedNode<S>[] = []
    args = new Map<string, unknown>()
    command?: Command<S>
    constructor(readonly source: S) {}
    copy() {
        const c = new ContextBuilder(this.source)
        c.nodes = [...this.nodes]
        c.args = new Map(this.args)
        c.command = this.command
        return c
    }
    build(input: string): CommandContext<S> {
        const args = this.args
        return {
            source: this.source,
            input,
            get: <T>(name: string) => {
                if (!args.has(name)) throw new Error(`参数不存在: ${name}`)
                return args.get(name) as T
            },
            has: name => args.has(name),
        }
    }
}

export abstract class CommandNode<S> {
    readonly children: CommandNode<S>[] = []
    command?: Command<S>
    requirement?: (source: S) => boolean
    abstract readonly name: string
    abstract usage(): string
    abstract parse(reader: StringReader, ctx: ContextBuilder<S>): void
    abstract suggest(builder: SuggestionsBuilder): void
    get variadic() {
        return false
    }
    then(...nodes: CommandNode<S>[]) {
        this.children.push(...nodes)
        return this
    }
    executes(command: Command<S>) {
        this.command = command
        return this
    }
    requires(requirement: (source: S) => boolean) {
        this.requirement = requirement
        return this
    }
    canUse(source: S) {
        return this.requirement?.(source) ?? true
    }
    /** 若下一个词恰好是某个字面量，只尝试它；否则尝试全部参数节点 */
    relevant(reader: StringReader) {
        const word = reader.clone().readUnquoted()
        const literal = this.children.find(c => c instanceof LiteralNode && c.name === word)
        if (literal) return [literal]
        return this.children.filter(c => c instanceof ArgumentNode)
    }
}

class RootNode<S> extends CommandNode<S> {
    readonly name = ''
    usage() {
        return ''
    }
    parse() {}
    suggest() {}
}

export class LiteralNode<S> extends CommandNode<S> {
    constructor(readonly name: string) {
        super()
    }
    usage() {
        return this.name
    }
    parse(reader: StringReader, ctx: ContextBuilder<S>) {
        const start = reader.cursor
        if (reader.string.startsWith(this.name, start)) {
            const end = start + this.name.length
            if (end === reader.string.length || isWs(reader.string[end]!)) {
                reader.cursor = end
                ctx.nodes.push({ node: this, start, end })
                return
            }
        }
        throw reader.error(`应为 ${this.name}`)
    }
    suggest(builder: SuggestionsBuilder) {
        if (this.name.startsWith(builder.remainingLower))
            builder.suggest(this.name, { continues: this.children.length > 0 })
    }
}

export class ArgumentNode<S, T> extends CommandNode<S> {
    constructor(
        readonly name: string,
        readonly type: ArgumentType<T>,
    ) {
        super()
    }
    override get variadic() {
        return !!this.type.variadic
    }
    usage() {
        return `<${this.name}${this.variadic ? '…' : ''}>`
    }
    parse(reader: StringReader, ctx: ContextBuilder<S>) {
        const start = reader.cursor
        const value = this.type.parse(reader)
        ctx.nodes.push({ node: this, start, end: reader.cursor })
        ctx.args.set(this.name, value)
    }
    suggest(builder: SuggestionsBuilder) {
        const from = builder.list.length
        this.type.suggest?.(builder)
        const continues = this.children.length > 0 || this.variadic
        for (let i = from; i < builder.list.length; i++) builder.list[i]!.continues = continues
    }
}

/** 可重复参数：解析到第一个无法解析的项为止；补全针对最后一项 */
export function variadic<T>(item: ArgumentType<T>): ArgumentType<T[]> {
    return {
        variadic: true,
        parse(reader) {
            const out = [item.parse(reader)]
            while (reader.atWhitespace()) {
                const save = reader.cursor
                reader.skipWhitespace()
                if (!reader.canRead()) {
                    reader.cursor = save
                    break
                }
                try {
                    out.push(item.parse(reader))
                } catch (e) {
                    if (!(e instanceof CommandError)) throw e
                    reader.cursor = save
                    break
                }
            }
            return out
        },
        split(text) {
            const r = new StringReader(text)
            const out: [number, number][] = []
            for (r.skipWhitespace(); r.canRead(); r.skipWhitespace()) {
                const start = r.cursor
                item.parse(r)
                out.push([start, r.cursor])
            }
            return out
        },
        suggest(builder) {
            const r = new StringReader(builder.remaining)
            let last = 0
            for (;;) {
                r.skipWhitespace()
                last = r.cursor
                if (!r.canRead()) break
                try {
                    item.parse(r)
                } catch {
                    break
                }
                if (!r.canRead()) break
            }
            item.suggest?.(builder.at(last))
        },
    }
}

export const literal = <S>(name: string) => new LiteralNode<S>(name)
export const argument = <S, T>(name: string, type: ArgumentType<T>) =>
    new ArgumentNode<S, T>(name, type)

export interface ParseResult<S> {
    input: string
    context: ContextBuilder<S>
    reader: StringReader
    errors: Map<CommandNode<S>, CommandError>
}

export class CommandDispatcher<S> {
    readonly root: CommandNode<S> = new RootNode<S>()

    register(...nodes: CommandNode<S>[]) {
        this.root.then(...nodes)
    }

    parse(input: string, source: S): ParseResult<S> {
        return this.parseNodes(this.root, new StringReader(input), new ContextBuilder(source))
    }

    private parseNodes(node: CommandNode<S>, reader: StringReader, ctx: ContextBuilder<S>): ParseResult<S> {
        const errors = new Map<CommandNode<S>, CommandError>()
        const potentials: ParseResult<S>[] = []
        for (const child of node.relevant(reader)) {
            if (!child.canUse(ctx.source)) continue
            const c = ctx.copy()
            const r = reader.clone()
            try {
                child.parse(r, c)
                if (r.canRead() && !r.atWhitespace()) throw r.error('参数之后应有空格')
            } catch (e) {
                if (!(e instanceof CommandError)) throw e
                errors.set(child, e)
                continue
            }
            c.command = child.command
            if (r.canRead(2)) {
                r.skip()
                potentials.push(this.parseNodes(child, r, c))
            } else {
                potentials.push({ input: reader.string, context: c, reader: r, errors: new Map() })
            }
        }
        if (potentials.length) {
            const rank = (p: ParseResult<S>) => (p.reader.canRead() ? 2 : 0) + (p.errors.size ? 1 : 0)
            return potentials.reduce((a, b) => (rank(b) < rank(a) ? b : a))
        }
        return { input: reader.string, context: ctx, reader, errors }
    }

    /** 解析失败的原因；可执行则返回 null */
    problem(parse: ParseResult<S>): CommandError | null {
        if (parse.reader.canRead()) {
            if (parse.errors.size === 1) return [...parse.errors.values()][0]!
            const at = parse.reader.cursor
            if (parse.context.nodes.length === 0) return new CommandError('未知命令', at)
            // 可变参数在失败项前停下：重新解析该项以给出具体原因
            const last = parse.context.nodes.at(-1)!.node
            if (last instanceof ArgumentNode && last.variadic) {
                const r = parse.reader.clone()
                r.skipWhitespace()
                try {
                    last.type.parse(r)
                } catch (e) {
                    if (e instanceof CommandError) return e
                    throw e
                }
            }
            return new CommandError('参数错误', at)
        }
        if (!parse.context.command) return new CommandError('命令不完整', parse.reader.cursor)
        return null
    }

    execute(input: string, source: S) {
        const trimmed = input.trimEnd()
        const parse = this.parse(trimmed, source)
        const problem = this.problem(parse)
        if (problem) throw problem
        parse.context.command!(parse.context.build(trimmed))
    }

    /** 光标处的补全：找到光标所在节点的父节点，让它的子节点提供建议 */
    suggestions(input: string, source: S): Suggestion[] {
        const parse = this.parse(input, source)
        const nodes = parse.context.nodes
        const cursor = input.length
        let parent = this.root
        let start = 0
        let found = false
        for (const n of nodes) {
            if (n.end >= cursor) {
                start = n.start
                found = true
                break
            }
            parent = n.node
        }
        if (!found && nodes.length) {
            const last = nodes.at(-1)!
            if (last.node.variadic) {
                parent = nodes.at(-2)?.node ?? this.root
                start = last.start
            } else start = last.end + 1
        }
        if (start > cursor) return []
        const builder = new SuggestionsBuilder(input, start)
        for (const child of parent.children) if (child.canUse(source)) child.suggest(builder)
        return builder.list
    }

    /** 当前解析位置之后可接的用法（简要） */
    nextUsages(parse: ParseResult<S>, source: S) {
        const node = parse.context.nodes.at(-1)?.node ?? this.root
        return node.children.filter(c => c.canUse(source)).map(c => this.smartUsage(c, source))
    }

    smartUsage(node: CommandNode<S>, source: S): string {
        const self = node.usage()
        const kids = node.children.filter(c => c.canUse(source))
        if (!kids.length) return self
        const inner = kids.length === 1 ? this.smartUsage(kids[0]!, source) : `(${kids.map(k => k.usage()).join('|')})`
        return node.command ? `${self} [${inner}]` : `${self} ${inner}`
    }

    /** 某节点下所有可执行路径 */
    allUsage(node: CommandNode<S>, source: S, prefix = node.usage()): string[] {
        const out: string[] = []
        if (node.command) out.push(prefix)
        for (const c of node.children) {
            if (!c.canUse(source)) continue
            out.push(...this.allUsage(c, source, prefix ? `${prefix} ${c.usage()}` : c.usage()))
        }
        return out
    }

    /** 输入高亮分段：字面量 / 参数（轮换色）/ 无法解析的部分 */
    highlight(input: string, source: S) {
        const parse = this.parse(input, source)
        const segs: { text: string; kind: 'plain' | 'literal' | 'error' | `arg${number}` }[] = []
        let pos = 0
        let arg = 0
        const push = (start: number, end: number, kind: (typeof segs)[number]['kind']) => {
            if (start > pos) segs.push({ text: input.slice(pos, start), kind: 'plain' })
            segs.push({ text: input.slice(start, end), kind })
            pos = end
        }
        for (const n of parse.context.nodes) {
            if (n.node instanceof LiteralNode) push(n.start, n.end, 'literal')
            else if (n.node instanceof ArgumentNode && n.node.type.split) {
                for (const [a, b] of n.node.type.split(input.slice(n.start, n.end)))
                    push(n.start + a, n.start + b, `arg${arg++ % 5}`)
            } else push(n.start, n.end, `arg${arg++ % 5}`)
        }
        if (pos < input.length) {
            const rest = input.slice(pos)
            const lead = rest.length - rest.trimStart().length
            if (lead) segs.push({ text: rest.slice(0, lead), kind: 'plain' })
            if (rest.trim()) segs.push({ text: rest.slice(lead), kind: 'error' })
        }
        return { parse, segs }
    }
}
