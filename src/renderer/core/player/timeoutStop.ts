import { ref, computed, type ComputedRef } from '@common/utils/vueTools'
import { isPlay } from '@renderer/store/player/state'
// import { interval, intervalCancel } from '@renderer/utils/ipc'
import { pause } from './action'

const time = ref(-1)


const timeoutTools: {
  isRunning: boolean
  // time: number
  interval: null | number
  timeout: NodeJS.Timeout | null
  endTime: number
  exit: () => void
  clearTimeout: () => void
  start: (_time: number) => void
} = {
  isRunning: false,
  timeout: null,
  // time: -1,
  endTime: 0,
  interval: null,
  exit() {
    window.rain.isPlayedStop = true
    if (isPlay.value) pause()
  },
  clearTimeout() {
    if (this.interval) {
      window.clearInterval(this.interval)
      this.interval = null
    }
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    if (!this.isRunning) return
    // this.time = -1
    time.value = -1
    this.isRunning = false
  },
  start(_time: number) {
    this.clearTimeout()
    // this.time = _time
    time.value = _time
    this.isRunning = true
    this.endTime = performance.now() + _time * 1000

    this.interval = window.setInterval(() => {
      // this.endTime = performance.now()
      // if (this.time > 0) {
      //   this.time--
      // }
      time.value = Math.max(0, Math.round((this.endTime - performance.now()) / 1000))
    }, 1000)
    this.timeout = setTimeout(() => {
      this.timeout = null
      time.value = -1
      this.clearTimeout()
      this.exit()
    }, _time * 1000)
  },
}

export const minutesToTimeoutSeconds = (minutes: string | number): number | null => {
  const value = String(minutes).trim()
  if (!/^\d+$/.test(value)) return null
  const duration = Number(value)
  return duration >= 1 && duration <= 1440 ? duration * 60 : null
}

export const startTimeoutStop = (time: number) => {
  if (!Number.isFinite(time) || time <= 0 || time > 86400) return
  window.rain.isPlayedStop &&= false
  timeoutTools.start(time)
}
export const stopTimeoutStop = () => {
  window.rain.isPlayedStop &&= false
  timeoutTools.clearTimeout()
}

const formatTime = (time: number): string => {
  // let d = parseInt(time / 86400)
  // d = d ? d.toString() + ':' : ''
  // time = time % 86400
  let h: number | string = Math.trunc(time / 3600)
  h = h ? h.toString() + ':' : ''
  time = time % 3600
  const m = Math.trunc(time / 60).toString().padStart(2, '0')
  const s = Math.trunc(time % 60).toString().padStart(2, '0')
  return `${h}${m}:${s}`
}
export const useTimeout = () => {
  const timeLabel: ComputedRef<string> = computed(() => {
    return time.value > 0 ? formatTime(time.value) : ''
  })

  return {
    time,
    timeLabel,
  }
}
