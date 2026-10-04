<template>
  <section id="song-detail" :class="$style.detail" data-song-detail data-glass ignore-tip role="main" :aria-label="$t('player__detail_title')" @contextmenu="handleContextMenu">
    <div v-if="musicInfo.pic && !coverFailed" :class="$style.ambient" aria-hidden="true" :style="{ backgroundImage: `url(${JSON.stringify(musicInfo.pic)})` }" />
    <header :class="$style.header">
      <TrafficLights data-detail-window-controls />
      <span :class="$style.heading">{{ $t('player__detail_now_playing') }}</span>
      <button type="button" :class="$style.back" data-detail-back ignore-tip :aria-label="$t('back')" @click="hide">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </header>
    <div :class="$style.body">
      <section :class="$style.album">
       <div :class="$style.presentation">
        <div :class="$style.cover" data-detail-cover data-glass>
          <img v-if="musicInfo.pic && !coverFailed" :src="musicInfo.pic" :alt="musicInfo.name" @error="coverFailed = true">
          <div v-else :class="$style.coverFallback" data-detail-cover-fallback aria-hidden="true">
            <svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="52" /><circle cx="80" cy="80" r="12" /><path d="M90 53v39c0 12-22 15-22 2 0-9 14-13 22-7M90 53l24-5v36c0 12-22 15-22 2" /></svg>
          </div>
        </div>
        <div :class="$style.metadata" data-detail-reveal>
          <h2 :title="musicInfo.name">{{ musicInfo.name || $t('player__detail_empty_title') }}</h2>
          <p v-if="musicInfo.singer" :class="$style.artist">{{ musicInfo.singer }}</p>
          <p v-if="musicInfo.album && musicInfo.album !== musicInfo.name" :class="$style.albumName">{{ musicInfo.album }}</p>
          <p v-if="!musicInfo.name" :class="$style.emptyHint">{{ $t('player__detail_empty_hint') }}</p>
        </div>
       </div>
       <PlayerDock data-detail-reveal />
      </section>
      <section :class="$style.stage" data-detail-reveal>
        <div :class="$style.lyrics" data-detail-lyrics>
          <LyricPlayer v-show="lyric.lines.length" />
          <div v-if="!lyric.lines.length" :class="$style.emptyLyric">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 10h10M5 14h14M5 18h8" /></svg>
            <p>{{ musicInfo.name ? $t('player__detail_no_lyric') : $t('player__detail_empty_hint') }}</p>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { musicInfo, isShowPlayerDetail } from '@renderer/store/player/state'
import { lyric } from '@renderer/store/player/lyric'
import { setShowPlayerDetail, setShowPlayComment, setShowPlayLrcSelectContentLrc } from '@renderer/store/player/action'
import LyricPlayer from './LyricPlayer.vue'
import PlayerDock from './PlayBar.vue'
import TrafficLights from '../Toolbar/TrafficLights.vue'

defineOptions({ name: 'CorePlayDetail' })

const coverFailed = ref(false)
watch(() => musicInfo.pic, () => { coverFailed.value = false })
const hide = () => { setShowPlayerDetail(false) }
const trapFocus = event => {
  if (event.key !== 'Tab' || !isShowPlayerDetail.value || document.getElementById('root')?.classList.contains('show-modal')) return
  const surfaces = [document.getElementById('song-detail'), ...document.querySelectorAll('[data-player-popup][aria-hidden="false"]')]
  const controls = surfaces.flatMap(surface => Array.from(surface?.querySelectorAll('button:not(:disabled), [tabindex="0"], input:not([aria-hidden="true"]), textarea') ?? []))
    .filter(el => el.getClientRects().length && window.getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]'))
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
onMounted(() => {
  setShowPlayComment(false)
  setShowPlayLrcSelectContentLrc(false)
  document.addEventListener('keydown', trapFocus)
})
let lastContextClick = 0
const handleContextMenu = () => {
  const now = window.performance.now()
  if (lastContextClick && now - lastContextClick < 400) {
    hide()
    lastContextClick = 0
  } else lastContextClick = now
}
onBeforeUnmount(() => {
  document.removeEventListener('keydown', trapFocus)
  setShowPlayComment(false)
  setShowPlayLrcSelectContentLrc(false)
})
</script>

<style lang="less" module>
.detail:global(#song-detail) {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  -webkit-app-region: no-drag;
  background: radial-gradient(ellipse at 15% 30%, var(--glass-ambient), transparent 65%), var(--color-primary-light-1000);
  overflow: hidden;
}
.ambient { position: absolute; inset: -100px; background-size: cover; background-position: center; filter: blur(110px) saturate(50%); opacity: .17; pointer-events: none; z-index: -1; }
.header {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: none;
  height: 52px;
  padding: 0 22px 0 0;
  box-sizing: border-box;
  -webkit-app-region: drag;
}
.back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--color-font);
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  -webkit-app-region: no-drag;
  &:hover { background: var(--control-hover); }
  &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 2px; }
  svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
}
.heading { flex: auto; min-width: 0; font-size: 11px; opacity: .4; text-align: center; padding-right: 54px; letter-spacing: 1px; }
.body {
  flex: auto;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(280px, .85fr) minmax(0, 1.15fr);
  gap: clamp(32px, 7vw, 100px);
  padding: 0 clamp(32px, 6vw, 90px) 32px;
}
.album {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  min-width: 0;
  padding: 0;
  gap: 24px;
  box-sizing: border-box;
}
.presentation { display: flex; flex-direction: column; justify-content: safe center; align-items: center; flex: auto; min-height: 0; width: 100%; }
.cover {
  flex: none;
  width: min(100%, calc(100vh - 340px), 340px);
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 16px;
  transform-origin: top left;
  background: var(--control-well);
  box-shadow: 0 18px 44px var(--glass-edge), 0 2px 6px var(--glass-edge), inset 0 0 0 1px var(--glass-highlight);
  &::after { z-index: 1; }
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
}
.coverFallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--control-ink);
  background: linear-gradient(145deg, var(--surface-selected), var(--control-well));
  svg { width: 54%; height: 54%; fill: none; stroke: currentColor; stroke-width: 1.2; opacity: .28; }
}
.metadata {
  width: min(100%, 340px);
  margin-top: 22px;
  h2 { font-size: 25px; font-weight: 500; line-height: 1.35; letter-spacing: -.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  p { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 1.5; }
}
.artist { margin-top: 10px; font-size: 14px; opacity: .76; }
.albumName { margin-top: 4px; font-size: 12px; opacity: .45; }
.emptyHint { margin-top: 12px; font-size: 12px; opacity: .5; }
.stage { position: relative; min-height: 0; min-width: 0; }
.lyrics { width: 100%; height: 100%; min-width: 0; min-height: 0; }
.lyrics { position: relative; display: flex; }
.emptyLyric {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--color-font);
  opacity: .38;
  text-align: center;
  font-size: 13px;
  line-height: 1.7;
  svg { width: 32px; height: 32px; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linecap: round; }
}
@media (max-width: 880px) {
  .body { padding: 0 32px 24px; gap: 36px; grid-template-columns: minmax(280px, .85fr) minmax(0, 1.15fr); }
  .metadata { margin-top: 18px; h2 { font-size: 22px; } }
}
@media (max-height: 600px) {
  .body { padding-bottom: 20px; }
  .album { gap: 16px; }
  .metadata { margin-top: 14px; }
  .artist { margin-top: 6px; }
  .emptyHint { margin-top: 6px; }
}
</style>
