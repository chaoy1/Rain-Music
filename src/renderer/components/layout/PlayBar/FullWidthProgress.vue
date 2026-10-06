<template>
  <div :class="$style.player">
    <button type="button" :class="$style.picContent" data-player-cover ignore-tip :title="$t('player__detail_title')" :aria-label="$t('player__pic_tip')" :aria-expanded="isShowPlayerDetail" aria-controls="song-detail" @click="setShowPlayerDetail(!isShowPlayerDetail)" @contextmenu="handleToMusicLocation">
      <img v-if="musicInfo.pic" :src="musicInfo.pic" decoding="async" @error="imgError">
      <span v-else :class="$style.emptyPic" aria-hidden="true">R<span>M</span></span>
    </button>
    <div :class="[$style.trackContent, { [$style.timelineVisible]: hasTimeline }]">
    <div :class="$style.infoContent" data-footer-song>
      <div :class="$style.title" :aria-label="title + $t('copy_tip')" @click="handleCopy(title)">
        {{ title }}
      </div>
      <div v-if="statusText" :class="$style.status">{{ statusText }}</div>
    </div>
    <div v-if="hasTimeline" :class="$style.progress" data-footer-progress role="slider" :tabindex="canSeek ? 0 : -1" :aria-disabled="!canSeek" :aria-label="$t('player__detail_progress')" aria-valuemin="0" :aria-valuemax="maxPlayTime" :aria-valuenow="nowPlayTime" @keydown="handleSeekKey">
      <common-progress-bar :class-name="$style.progressBar" :progress="progress" :handle-transition-end="handleTransitionEnd" :is-active-transition="isActiveTransition" />
    </div>
    <div v-if="hasTimeline" :class="$style.timeContent" data-footer-time>
      <span>{{ nowPlayTimeStr }}</span>
      <span style="margin: 0 1px;">/</span>
      <span>{{ maxPlayTimeStr }}</span>
    </div>
    </div>
    <!-- <play-progress data-player-progress /> -->
    <control-btns />
    <common-playback-controls />
  </div>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText } from '@common/utils/electron'
import ControlBtns from './ControlBtns.vue'
// import PlayProgress from './PlayProgress'
import usePlayProgress from '@renderer/utils/compositions/usePlayProgress'
// import { lyric } from '@renderer/core/share/lyric'
import {
  statusText,
  musicInfo,
  isShowPlayerDetail,
  playInfo,
  playMusicInfo,
} from '@renderer/store/player/state'
import {
  setMusicInfo,
  setShowPlayerDetail,
} from '@renderer/store/player/action'
import { LIST_IDS, MUSIC_FILE_NAME_FORMAT } from '@common/constants'
import { formatMusicName } from '@renderer/utils'

export default {
  name: 'CorePlayBar',
  components: {
    ControlBtns,
    // PlayProgress,
  },
  setup() {
    const router = useRouter()

    const {
      nowPlayTimeStr,
      maxPlayTimeStr,
      progress,
      isActiveTransition,
      handleTransitionEnd,
      maxPlayTime,
      nowPlayTime,
      hasTimeline,
      canSeek,
    } = usePlayProgress()

    const handleSeekKey = (event) => {
      if (!canSeek.value) return
      let time
      if (event.key === 'ArrowRight') time = nowPlayTime.value + 5
      else if (event.key === 'ArrowLeft') time = nowPlayTime.value - 5
      else if (event.key === 'Home') time = 0
      else if (event.key === 'End') time = maxPlayTime.value
      else return
      event.preventDefault()
      if (maxPlayTime.value > 0) window.app_event.setProgress(Math.max(0, Math.min(maxPlayTime.value, time)))
    }

    const handleCopy = (text) => {
      clipboardWriteText(text)
    }

    const imgError = () => {
      // console.log(e)
      setMusicInfo({ pic: null })
    }

    const handleToMusicLocation = () => {
      const listId = playMusicInfo.listId
      if (!listId || listId == LIST_IDS.DOWNLOAD || !playMusicInfo.musicInfo) return
      if (playInfo.playIndex == -1) return
      void router.push({
        path: '/list',
        query: {
          id: listId,
          scrollIndex: playInfo.playIndex,
        },
      })
    }

    const title = computed(() => {
      return musicInfo.name
        ? formatMusicName(MUSIC_FILE_NAME_FORMAT, musicInfo.name, musicInfo.singer)
        : ''
    })

    // onBeforeUnmount(() => {
    // window.eventHub.emit(eventPlayerNames.setTogglePlay)
    // })

    return {
      musicInfo,
      hasTimeline,
      canSeek,
      nowPlayTimeStr,
      maxPlayTimeStr,
      progress,
      maxPlayTime,
      nowPlayTime,
      handleSeekKey,
      isActiveTransition,
      handleTransitionEnd,
      handleCopy,
      imgError,
      statusText,
      title,
      handleToMusicLocation,
      isShowPlayerDetail,
      setShowPlayerDetail,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.player {
  position: relative;
  height: @height-player;
  // border-top: 1px solid var(--color-primary-alpha-900);
  box-sizing: border-box;
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  contain: layout style;
  padding: 10px 16px;
  z-index: 2;
  // box-shadow: 0px 0px 4px rgba(0, 0, 0, 0.1);
  * {
    box-sizing: border-box;
  }
}
.progress {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  width: 100%;
  height: 24px;
  z-index: 3;
  outline: none;
  &:focus-visible { box-shadow: 0 0 0 2px var(--control-outline); }
  // height: 15px;
  .progressBar {
    height: 3px;
    border-radius: 3px;
  }
}

.picContent {
  padding: 0;
  border: 0;
  background: transparent;
  &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 3px; }
  &[aria-expanded="true"] { box-shadow: 0 0 0 1px var(--control-outline); border-radius: 10px; }
  height: 100%;
  aspect-ratio: 1 / 1;

  // color: var(--color-primary);
  // transition: @transition-normal;
  // transition-property: color;
  flex: none;
  opacity: 1;
  transition: opacity @transition-fast;
  // transition-property: opacity;
  display: flex;
  justify-content: center;
  // align-items: center;
  cursor: pointer;

  &:hover {
    opacity: 1;
  }

  // svg {
  //   fill: currentColor;
  // }
  img {
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
    max-width: 100%;
    max-height: 100%;
    transition: @transition-normal;
    transition-property: border-color;
    // border-radius: 50%;
    border-radius: @radius-border;
    // border: 2px solid @color-theme_2-background_1;
  }

  .emptyPic {
    background-color: var(--control-well);
    border-radius: @radius-border;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--control-ink);
    opacity: .5;
    user-select: none;
    font-size: 15px;
    font-family: inherit;
    letter-spacing: 1px;

    span {
      padding-left: 3px;
    }
  }
}

.trackContent {
  flex: auto;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  margin-left: 12px;
  &.timelineVisible { grid-template-columns: minmax(64px, .55fr) minmax(88px, 1.45fr) auto; }
}
.infoContent {
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: flex-start;
  font-size: 13px;
  color: var(--color-font);
  min-width: 0;
  line-height: 1.5;
}

.title {
  max-width: 100%;
  font-size: 12px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
.status {
  padding-top: 3px;
  height: 23px;
  .mixin-ellipsis-1();
  max-width: 100%;
}

.timeContent {
  flex: none;
  color: var(--color-550);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}


</style>
