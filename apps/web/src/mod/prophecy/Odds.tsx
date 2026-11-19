import { useAtom } from 'jotai'
import { distributionAt, pointKey, RandomProperties } from '@remake/core'
import type { Foresight, Point } from '@remake/core'
import { talents, type Talent } from '@remake/data'
import { properties } from '@remake/data/etc/display'
import { useDestine, useProphecy, percent } from '.'
import { oddsExpandedAtom } from '../state'
import './Prophecy.css'

const Fold = 12

/** 嵌套盲盒行的前提：要到达此行，上游各盲盒须开出的值 */
type Via = { key: string; value: unknown }[]

interface ChipProps {
    point: Point
    via?: Via
    value: unknown
    p: number
    exact: boolean
    chosen: boolean
    /** 因与其他指定冲突而不可能 */
    impossible?: boolean
    grade?: number
    label: string
    title?: string
}
function Chip({ point, via = [], value, p, exact, chosen, impossible, grade, label, title }: ChipProps) {
    const { cheat, one, path } = useDestine()
    const hint = impossible
        ? '与其他指定冲突，不可能开出；先取消冲突的指定'
        : cheat
          ? chosen
              ? '点击取消指定'
              : '点击指定为此结果（作弊）'
          : '开启控制台后可指定结果'
    return (
        <button
            className={`odds-chip ${grade !== undefined ? `grade-${grade}` : ''} ${chosen ? 'chosen' : ''} ${impossible ? 'impossible' : ''}`}
            disabled={!cheat || impossible}
            title={(title ? title + '\n' : '') + hint}
            onClick={e => {
                e.stopPropagation()
                // 指定条件分支时，一并指定其前提（上游盲盒开出本盲盒）
                if (chosen) one(point, undefined)
                else path([...via, { key: pointKey(point), value }])
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
/**
 * 盲盒会开出什么。选项全集取自不考虑任何指定的推演（baseline），概率取自以指定为条件的推演：
 * 因而无论冲突的指定在上方还是下方，被排除的选项都以 0% 显示为不可能。
 */
export function ReplaceOdds({
    talent,
    foresight,
    baseline,
}: {
    talent: Talent['id']
    foresight: Foresight<unknown>
    baseline: Foresight<unknown>
}) {
    const prophecy = useProphecy()
    if (!prophecy || !talents.get(talent)?.replacement) return null
    const rows: React.ReactNode[] = []
    const visit = (t: Talent['id'], depth: number, seen: Set<number>, via: Via) => {
        const point: Point = { kind: 'replace', talent: t }
        const d = distributionAt(foresight, pointKey(point))
        if (d.reach === 0) return
        const base = distributionAt(baseline, pointKey(point))
        const all = new Set([...base.values.keys(), ...d.values.keys()]) as Set<Talent['id']>
        const entries = [...all]
            .map(v => [v, d.values.get(v) ?? 0, base.values.get(v) ?? 0] as const)
            .sort((a, b) => b[1] - a[1] || b[2] - a[2])
        const label = depth === 0 ? '可能开出' : `${'　'.repeat(depth - 1)}↳ 若开出${talents.get(t)!.name}（${percent(d.reach, foresight.exact)}）`
        rows.push(
            <Row key={t} label={label} warn={d.forced === 'unreachable' ? '指定的结果已不可达' : undefined}>
                {entries.map(([v, p]) => (
                    <Chip
                        key={v}
                        impossible={p === 0 && !(d.forced === 'yes' && d.forcedValue === v)}
                        point={point}
                        via={via}
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
        for (const [v, p] of entries) {
            if (p === 0 || !talents.get(v)!.replacement || seen.has(v)) continue
            visit(v, depth + 1, new Set([...seen, v]), [...via, { key: pointKey(point), value: v }])
        }
    }
    visit(talent, 0, new Set([talent]), [])
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
