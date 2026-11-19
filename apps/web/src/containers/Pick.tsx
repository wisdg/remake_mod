import { useTalentPuller, useTalentPicker } from '@remake/hooks'
import { useTalentSubmit, useSubmitIsEnable } from '@remake/hooks'
import { PullCount, dev } from '@/config'
import { toastMsg } from '@/toast'
import Talent from '@/components/Talent'
import { useProphecy, usePickForesight, usePickBaseline } from '@/mod/prophecy'
import { ReplaceOdds, PropertyOdds } from '@/mod/prophecy/Odds'
import './Pick.css'

export function Pick() {
    const [pulled, puller] = useTalentPuller()
    const [talents, picker] = useTalentPicker()
    const { enabled, min, max } = useSubmitIsEnable()
    const submit = useTalentSubmit()
    const prophecy = useProphecy()
    const foresight = usePickForesight(talents)
    const baseline = usePickBaseline(talents)
    const msg = enabled
        ? '下一步'
        : `请选取 ${min == max ? min : `${min}~${max}`} 个天赋`
    const handleSubmit = () => {
        if (enabled) return submit()
        toastMsg(msg, 'pick-toast')
    }
    if (!pulled)
        return (
            <div className="screen talent-pick">
                <button
                    className="primary font-mono focus"
                    onClick={() => puller()}
                >
                    {PullCount} 连抽!
                </button>
            </div>
        )
    // 控制台 pick 可能选入非抽取所得的天赋，一并列出
    const ps = Array.from(new Set([...(dev.locked ?? []), ...pulled, ...talents]))
    return (
        <div className="screen talent-pick">
            <ul className="talent-list">
                {ps.map(id => (
                    <li key={id} onClick={() => picker(id)}>
                        {prophecy && talents.has(id) ? (
                            <div className="prophecy-talent">
                                <Talent id={id} selected />
                                <ReplaceOdds talent={id} foresight={foresight} baseline={baseline} />
                                <PropertyOdds talent={id} />
                            </div>
                        ) : (
                            <Talent id={id} selected={talents.has(id)} />
                        )}
                    </li>
                ))}
            </ul>
            <button
                className={enabled ? 'primary' : 'error'}
                onClick={handleSubmit}
            >
                {msg}
            </button>
        </div>
    )
}
export default Pick
