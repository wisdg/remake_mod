import { test, expect, describe } from 'vitest'
import { CommandDispatcher, CommandError, literal, argument, variadic, StringReader, quote } from './brigadier'
import { integer, greedy, choice, talent, achievement, event } from './arguments'

type S = { log: string[]; alive: boolean }
const L = (n: string) => literal<S>(n)

function make() {
    const d = new CommandDispatcher<S>()
    d.register(
        L('pick')
            .executes(c => void c.source.log.push('show'))
            .then(
                L('add').then(argument<S, number[]>('天赋', variadic(talent())).executes(c => void c.source.log.push(`add ${c.get<number[]>('天赋').join(',')}`))),
                L('clear').executes(c => void c.source.log.push('clear')),
            ),
        L('achv').then(argument<S, number>('成就', achievement()).executes(c => void c.source.log.push(`achv ${c.get('成就')}`))),
        L('ev').then(argument<S, number>('事件', event()).executes(c => void c.source.log.push(`ev ${c.get('事件')}`))),
        L('n').then(argument<S, number>('n', integer(0, 9)).executes(c => void c.source.log.push(`n ${c.get('n')}`))),
        L('mode').then(
            argument<S, string>(
                'm',
                choice('模式', [
                    { value: 'classic', text: 'classic', aliases: ['经典'] },
                    { value: 'celebrity', text: 'celebrity', aliases: ['名人'] },
                ]),
            ).executes(c => void c.source.log.push(`mode ${c.get('m')}`)),
        ),
        L('js').then(argument<S, string>('code', greedy()).executes(c => void c.source.log.push(`js ${c.get('code')}`))),
        L('life')
            .requires(s => s.alive)
            .executes(c => void c.source.log.push('life')),
    )
    return d
}
const src = (alive = false): S => ({ log: [], alive })
const run = (input: string, s = src()) => {
    make().execute(input, s)
    return s.log
}
const err = (input: string, s = src()) => {
    try {
        make().execute(input, s)
    } catch (e) {
        if (e instanceof CommandError) return e
        throw e
    }
    throw new Error('expected error: ' + input)
}
const sugg = (input: string, s = src()) => make().suggestions(input, s)

describe('StringReader', () => {
    test('quoted / unquoted / int', () => {
        const r = new StringReader('"经 典 老 歌" 阴间福袋 -12')
        expect(r.readString()).toBe('经 典 老 歌')
        r.skipWhitespace()
        expect(r.readString()).toBe('阴间福袋')
        r.skipWhitespace()
        expect(r.readInt()).toBe(-12)
        expect(quote('经 典 老 歌')).toBe('"经 典 老 歌"')
        expect(quote('阴间福袋')).toBe('阴间福袋')
    })
})

describe('execute', () => {
    test('字面量与可执行中间节点', () => {
        expect(run('pick')).toEqual(['show'])
        expect(run('pick clear')).toEqual(['clear'])
        expect(err('pick nope').message).toBe('参数错误')
        expect(err('nope').message).toBe('未知命令')
        expect(err('pick add').message).toBe('命令不完整')
    })
    test('按名称引用，多个参数，尾随空格', () => {
        expect(run('pick add 阴间福袋 轮盘赌 1141 ')).toEqual(['add 1145,1146,1141'])
    })
    test('可变参数中的错误项给出具体原因与位置', () => {
        const e = err('pick add 阴间福袋 不存在的天赋')
        expect(e.message).toBe('未知天赋: 不存在的天赋')
        expect(e.cursor).toBe('pick add 阴间福袋 '.length)
    })
    test('重名天赋必须用 id', () => {
        expect(err('pick add 白色转盘').message).toMatch(/对应多个天赋.*2009/)
        expect(run('pick add 2009')).toEqual(['add 2009'])
    })
    test('带空格的成就名用引号', () => {
        expect(run('achv "经 典 老 歌"')).toEqual(['achv 263'])
    })
    test('事件按文本唯一匹配', () => {
        expect(run('ev 你出生了，是个男孩。')).toEqual(['ev 10001'])
    })
    test('整数范围', () => {
        expect(run('n 3')).toEqual(['n 3'])
        expect(err('n 10').message).toBe('不能大于 9')
        expect(err('n x').message).toBe('无效的整数: x')
    })
    test('枚举别名', () => {
        expect(run('mode 名人')).toEqual(['mode celebrity'])
    })
    test('贪婪参数', () => {
        expect(run('js 1 + "a b"')).toEqual(['js 1 + "a b"'])
    })
    test('requires 控制可用性', () => {
        expect(err('life').message).toBe('未知命令')
        expect(run('life', src(true))).toEqual(['life'])
    })
})

describe('suggestions', () => {
    const texts = (input: string, s?: S) => sugg(input, s).map(x => x.text)
    test('根命令前缀', () => {
        expect(texts('pi')).toEqual(['pick'])
        expect(texts('')).not.toContain('life')
        expect(texts('', src(true))).toContain('life')
    })
    test('子命令', () => {
        expect(texts('pick ')).toEqual(['add', 'clear'])
        expect(sugg('pick ')[0]).toMatchObject({ start: 5, continues: true })
    })
    test('天赋按名称/描述匹配，插入名称', () => {
        const s = sugg('pick add 福袋')
        expect(s.map(x => x.text)).toEqual(expect.arrayContaining(['阴间福袋', '阳间福袋']))
        expect(s[0]).toMatchObject({ start: 9, continues: true })
        expect(texts('pick add 随机属性+8')).toContain('阴间大会员')
    })
    test('可变参数补全最后一项', () => {
        const s = sugg('pick add 阴间福袋 轮盘')
        expect(s.map(x => x.text)).toContain('轮盘赌')
        expect(s[0]!.start).toBe('pick add 阴间福袋 '.length)
        expect(sugg('pick add 阴间福袋 ')[0]!.start).toBe('pick add 阴间福袋 '.length)
    })
    test('重名插入 id，含空格的名称加引号', () => {
        expect(texts('pick add 白色转')).toEqual(expect.arrayContaining(['2009', '2013']))
        expect(texts('achv 经')).toContain('"经 典 老 歌"')
    })
    test('事件按文本搜索，插入 id', () => {
        expect(texts('ev 出生了，是个男')).toContain('10001')
    })
    test('枚举按别名匹配', () => {
        expect(texts('mode 名')).toEqual(['celebrity'])
    })
})

describe('highlight & usage', () => {
    test('分段', () => {
        const { segs } = make().highlight('pick add 阴间福袋 xx', src())
        expect(segs.map(s => [s.text, s.kind])).toEqual([
            ['pick', 'literal'],
            [' ', 'plain'],
            ['add', 'literal'],
            [' ', 'plain'],
            ['阴间福袋', 'arg0'],
            [' ', 'plain'],
            ['xx', 'error'],
        ])
    })
    test('可变参数逐项着色', () => {
        const { segs } = make().highlight('pick add 阴间福袋 轮盘赌', src())
        expect(segs.slice(4).map(s => [s.text, s.kind])).toEqual([
            ['阴间福袋', 'arg0'],
            [' ', 'plain'],
            ['轮盘赌', 'arg1'],
        ])
    })
    test('用法', () => {
        const d = make()
        expect(d.nextUsages(d.parse('pick', src()), src())).toEqual(['add <天赋…>', 'clear'])
        expect(d.allUsage(d.root.children[0]!, src())).toEqual(['pick', 'pick add <天赋…>', 'pick clear'])
    })
})
