import { atomWithStorage } from 'jotai/utils'

/** 悬浮按钮已解锁（左上角三次右滑） */
export const fabAtom = atomWithStorage('remake-mod:fab', false, undefined, {
    getOnInit: true,
})
/** 悬浮按钮位置（px，左上角为原点） */
export const fabPosAtom = atomWithStorage(
    'remake-mod:fab-pos',
    { x: 16, y: 96 },
    undefined,
    { getOnInit: true },
)
/** 预言：揭示命运与隐藏信息 */
export const prophecyAtom = atomWithStorage('remake-mod:prophecy', false, undefined, {
    getOnInit: true,
})
/** 控制台面板开启 */
export const consoleAtom = atomWithStorage('remake-mod:console', false, undefined, {
    getOnInit: true,
})
/** 命运之窗（预言开启时可用） */
export const prophecyWindowAtom = atomWithStorage('remake-mod:prophecy-window', false, undefined, {
    getOnInit: true,
})
/** 页面内概率选项是否全部展开（全局记住） */
export const oddsExpandedAtom = atomWithStorage('remake-mod:odds-expanded', false, undefined, {
    getOnInit: true,
})
