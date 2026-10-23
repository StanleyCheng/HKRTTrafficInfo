'use client'
import { useCallback, useSyncExternalStore, type SetStateAction } from 'react'
import { defaultSession, sessionStore, type MapSession } from '@/lib/session-state'

export function useSessionField<K extends keyof MapSession>(key: K): [MapSession[K], (change: SetStateAction<MapSession[K]>) => void] {
  const get = useCallback(() => sessionStore.getSnapshot()[key], [key])
  const server = useCallback(() => defaultSession[key], [key])
  const value = useSyncExternalStore(sessionStore.subscribe, get, server)
  const set = useCallback((change: SetStateAction<MapSession[K]>) => {
    const current = sessionStore.getSnapshot()[key]
    const next = typeof change === 'function' ? (change as (current: MapSession[K]) => MapSession[K])(current) : change
    sessionStore.update({ [key]: next })
  }, [key])
  return [value, set]
}
