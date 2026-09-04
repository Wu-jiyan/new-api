import type { CharacterStageView, CharacterView } from '../types'

/** 姿态立绘 URL：指定 pose → 阶段 poses 匹配；否则阶段第一姿态 */
export function resolvePose(stage?: CharacterStageView, pose?: string): string | undefined {
  if (!stage) return undefined
  if (pose) {
    const hit = stage.poses?.find((p) => p.name === pose)
    if (hit) return hit.image_url
  }
  return stage.poses?.[0]?.image_url
}

/** 背景 URL：指定背景库名 → 匹配 image_url；否则阶段默认背景 */
export function resolveBackground(
  stage: CharacterStageView | undefined,
  character: Pick<CharacterView, 'backgrounds'>,
  background?: string
): string | undefined {
  if (background && character.backgrounds) {
    const hit = character.backgrounds.find((b) => b.name === background)
    if (hit) return hit.image_url
  }
  return stage?.background_url
}

/** effect 是否触发全屏闪屏 */
export function isFlashEffect(effect?: string): effect is 'black' | 'white' {
  return effect === 'black' || effect === 'white'
}
