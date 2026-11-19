import { useAtom } from 'jotai'
import { distributionAt, pointKey, RandomProperties } from '@remake/core'
import type { Foresight, Point } from '@remake/core'
import { talents, type Talent } from '@remake/data'
import { properties } from '@remake/data/etc/display'
import { useDestine, useProphecy, percent } from '.'
import { oddsExpandedAtom } from '../state'
import './Prophecy.css'

const Fold = 12

interface ChipProps {
    point: Point
    value: unknown
    p: number
    exact: boolean
    chosen: boolean
    grade?: number
    label: string
    title?: string
}
function Chip({ point, value, p, exact, chosen, grade, label, title }: ChipProps) {
    const { cheat, one } = useDestine()
    return (
        <button
            className={`odds-chip ${grade !== undefined ? `grade-${grade}` : ''} ${chosen ? 'chosen' : ''}`}
            disabled={!cheat}
            title={(title ? title + '\n' : '') + (cheat ? (chosen ? '点击取消指定' : '点击指定为此结果（作弊）') : '开启控制台后可指定结果')}
            onClick={e => {
                e.stopPropagation()
                one(point, chosen ? undefined : value)
            }}
        >
            <span className="name">{label}</span>
            <span className="p font-mono">{percent(p, exact)}</span>
        </button>
    )
}

function Row({ label, children, warn }: { label: string; children: React.ReactNode[]; warn?: string }) {
    // 展开与否全局记住，不必每次都点
    const [all, setAll] = useAtom(oddsExpandedAtom)
    const shown = all ? children : children.slice(0, Fold)
    return (
        <div className="odds-row" onClick={e => e.stopPropagation()}>
            <span className="odds-label">{label}</span>
            {shown}
            {children.length > Fold && (
                <button className="odds-more" onClick={() => setAll(!all)}>
                    {all ? '收起' : `其余 ${children.length - Fold} 项`}
                </button>
            )}
            {warn && <span className="odds-warn">{warn}</span>}
        </div>
    )
}

/** 盲盒会开出什么（含嵌套盲盒，条件于到达） */
export function ReplaceOdds({ talent, foresight }: { talent: Talent['id']; foresight: Foresight<unknown> }) {
    const prophecy = useProphecy()
    if (!prophecy || !talents.get(talent)?.replacement) return null
    const rows: React.ReactNode[] = []
    const visit = (t: Talent['id'], depth: number, seen: Set<number>) => {
        const point: Point = { kind: 'replace', talent: t }
        const d = distributionAt(foresight, pointKey(point))
        if (d.reach === 0) return
        const entries = [...d.values].sort((a, b) => b[1] - a[1]) as [Talent['id'], number][]
        const label = depth === 0 ? '可能开出' : `${'　'.repeat(depth - 1)}↳ 若开出${talents.get(t)!.name}（${percent(d.reach, foresight.exact)}）`
        rows.push(
            <Row key={t} label={label} warn={d.forced === 'unreachable' ? '指定的结果已不可达' : undefined}>
                {entries.map(([v, p]) => (
                    <Chip
                        key={v}
                        point={point}
                        value={v}
                        p={p}
                        exact={foresight.exact}
                        chosen={d.forced === 'yes' && d.forcedValue === v}
                        grade={talents.get(v)!.grade}
                        label={talents.get(v)!.name}
                        title={talents.get(v)!.description}
                    />
                ))}
            </Row>,
        )
        for (const [v] of entries) {
            if (!talents.get(v)!.replacement || seen.has(v)) continue
            visit(v, depth + 1, new Set([...seen, v]))
        }
    }
    visit(talent, 0, new Set([talent]))
    return <div className="odds">{rows}</div>
}

/** 随机属性天赋加到哪一项（各项等概率） */
export function PropertyOdds({ talent }: { talent: Talent['id'] }) {
    const prophecy = useProphecy()
    const { destiny } = useDestine()
    const t = talents.get(talent)
    const rnd = t?.effect?.RND
    if (!prophecy || !t || !rnd) return null
    return (
        <div className="odds">
            {Array.from({ length: t.max }, (_, times) => {
                const point: Point = { kind: 'property', talent, times }
                const forced = destiny.get(pointKey(point))
                return (
                    <Row key={times} label={t.max > 1 ? `第 ${times + 1} 次随机属性` : '随机属性'}>
                        {RandomProperties.map(k => (
                            <Chip
                                key={k}
                                point={point}
                                value={k}
                                p={1 / RandomProperties.length}
                                exact
                                chosen={forced === k}
                                label={`${properties[k]}+${rnd}`}
                            />
                        ))}
                    </Row>
                )
            })}
        </div>
    )
}
