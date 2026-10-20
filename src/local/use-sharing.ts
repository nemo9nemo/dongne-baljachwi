import { useEffect, useRef, useState } from 'react'
import { DeviceShare, flushRevocations, type ShareStatus } from './sharing'
import { getState } from './storage'
import type { LocalState } from './model'

export function useSharing(state: LocalState) {
  const [statuses, setStatuses] = useState<Record<string, ShareStatus>>({})
  const connections = useRef(new Map<string, DeviceShare>())
  const signature = state.maps
    .filter((map) => map.share)
    .map((map) => map.id + ':' + map.share!.roomId)
    .join('|')
  useEffect(() => {
    let alive = true
    const active = connections.current
    for (const map of getState().maps)
      if (map.share) {
        const controller = new DeviceShare(map.id, map.share, (status) => {
          if (alive) setStatuses((previous) => ({ ...previous, [map.id]: status }))
        })
        active.set(map.id, controller)
        controller.start()
      }
    return () => {
      alive = false
      for (const controller of active.values()) controller.stop()
      active.clear()
    }
  }, [signature])
  useEffect(() => {
    const flush = () => void flushRevocations()
    flush()
    addEventListener('online', flush)
    const timer = setInterval(flush, 30000)
    return () => {
      removeEventListener('online', flush)
      clearInterval(timer)
    }
  }, [])
  return { statuses, connections }
}
