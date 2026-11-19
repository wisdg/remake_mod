import { useMemo } from 'react'
import { useSetAtom } from 'jotai'
import { useStep, Step, useGameState, usePicked, useAlloc, useConfig, useProfile, useReplaced } from '@remake/hooks'
import type { GameState } from '@remake/core'
import { start } from '@remake/core'
import { talents } from '@remake/data'
import Window, { type Geometry } from '../window/Window'
import { prophecyWindowAtom } from '../state'
import { useDestine, usePickForesight, useYearForesight } from '.'
import Browser from './Browser'
import './Prophecy.css'

const defaults = (): Geometry => {
    const w = Math.min(560, window.innerWidth - 32)
    const h = Math.min(620, window.innerHeight - 120)
    return { x: window.innerWidth - w - 16, y: 64, w, h, mode: 'normal' }
}

function PickView() {
    const picked = usePicked()
    const foresight = usePickForesight(picked)
    if (![...picked].some(t => talents.get(t)?.replacement)) return <div className="tree-empty">所选天赋中没有盲盒</div>
    return <Browser kind="pick" foresight={foresight} now="选择天赋" picked={picked} />
}

/** 属性分配页：按当前分配假想开局，预见第一年 */
function AllocView() {
    const [profile] = useProfile()
    const { final } = useAlloc()
    const { spirit } = useConfig()
    const { talents: tr } = useReplaced()
    const state = useMemo(() => start(profile, { ...final, spirit }, tr.talents).state, [profile, final, spirit, tr])
    return <YearView state={state} now="按当前分配开局" />
}

function YearView({ state, now }: { state: GameState; now: string }) {
    const foresight = useYearForesight(state)
    if (!foresight) return <div className="tree-empty">人生已结束</div>
    return <Browser kind="year" foresight={foresight} from={state} now={now} />
}

function PlayView() {
    const state = useGameState()
    if (!state) return null
    const age = state.props.current.age
    return <YearView state={state} now={age < 0 ? '出生前' : `${age} 岁`} />
}

function Body() {
    switch (useStep()) {
        case Step.Pick:
            return <PickView />
        case Step.Alloc:
            return <AllocView />
        case Step.Play:
            return <PlayView />
        case Step.Chara:
            return <div className="tree-empty">名人的盲盒分布见各角色卡</div>
        default:
            return <div className="tree-empty">此刻没有可预见的未来</div>
    }
}

export function ProphecyWindow() {
    const setOpen = useSetAtom(prophecyWindowAtom)
    const { cheat, destiny, clear } = useDestine()
    return (
        <Window id="prophecy" title="命运之树" defaults={defaults} onClose={() => setOpen(false)}>
            <div className="mod-prophecy">
                <div className="bar">
                    {cheat ? (
                        <>
                            <span>控制台已开启：可指定分支（作弊）</span>
                            <span className="font-mono">已指定 {destiny.size}</span>
                            {destiny.size > 0 && <button onClick={clear}>全部取消</button>}
                        </>
                    ) : (
                        <span>未来充满变数 · 开启控制台后可指定分支</span>
                    )}
                </div>
                <div className="content">
                    <Body />
                </div>
            </div>
        </Window>
    )
}
export default ProphecyWindow
