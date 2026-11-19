import { type Talent as T, talents } from '@remake/data'
import Talent from './Talent'
import { PropertyOdds } from '@/mod/prophecy/Odds'
import './Replaced.css'

export interface TalentProps {
    id: T['id']
    chains?: T['id'][]
}
export function Replaced({ id, chains }: TalentProps) {
    return (
        <ul className="replaced">
            <li>
                <Talent id={id} selected />
                <PropertyOdds talent={id} />
            </li>
            {chains?.map(id => {
                const talent = talents.get(id)
                if (!talent) return null
                return (
                    <li key={id}>
                        <Talent id={id} />
                        <PropertyOdds talent={id} />
                    </li>
                )
            })}
        </ul>
    )
}

export default Replaced
