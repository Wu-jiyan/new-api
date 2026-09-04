import { useEffect, useState } from 'react'

import { isFlashEffect } from '../lib/scene'

export interface FlashState {
  color: 'black' | 'white'
  ts: number
}

const FLASH_DURATION = 420

/** 当 effect 为 black/white 时触发一次闪屏；triggerKey 变化（如台词游标推进）允许同效果重复触发 */
export function useSceneFlash(effect?: string, triggerKey?: unknown): FlashState | null {
  const [flash, setFlash] = useState<FlashState | null>(null)
  useEffect(() => {
    if (!isFlashEffect(effect)) {
      setFlash(null)
      return
    }
    const color = effect as 'black' | 'white'
    setFlash({ color, ts: Date.now() })
    const timer = window.setTimeout(() => setFlash(null), FLASH_DURATION)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect, triggerKey])
  return flash
}
