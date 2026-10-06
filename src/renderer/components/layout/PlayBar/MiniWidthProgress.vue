<template>
  <div :class="$style.player">
    <button type="button" :class="$style.picContent" data-player-cover ignore-tip :title="$t('player__detail_title')" :aria-label="$t('player__pic_tip')" :aria-expanded="isShowPlayerDetail" aria-controls="song-detail" @click="setShowPlayerDetail(!isShowPlayerDetail)" @contextmenu="handleToMusicLocation">
      <img v-if="musicInfo.pic" :src="musicInfo.pic" decoding="async" @error="imgError">
      <span v-else :class="$style.emptyPic" aria-hidden="true">R<span>M</span></span>
    </button>
    <div :class="$style.infoContent">
      <div :class="$style.title" :aria-label="title + $t('copy_tip')" @click="handleCopy(title)">
        {{ title }}
      </div>
      <div :class="$style.status">{{ statusText }}</div>
    </div>
    <!-- <div :class="$style.timeContainer">
      <div :class="$style.timeContent">
        <span>{{ nowPlayTimeStr }}</span>
        <span style="margin: 0 1px;">/</span>
        <span>{{ maxPlayTimeStr }}</span>
        <div :class="$style.progress">
          <common-progress-bar data-player-progress :class-name="$style.progressBar" :progress="progress" :handle-transition-end="handleTransitionEnd" :is-active-transition="isActiveTransition" />
        </div>
      </div>
    </div> -->
    <play-progress data-player-progress />
    <control-btns />
    <common-playback-controls />
  </div>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText } from '@common/utils/electron'
import ControlBtns from './ControlBtns.vue'
import PlayProgress from './PlayProgress.vue'
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
    PlayProgress,
  },
  setup() {
    const router = useRouter()

    const {
      nowPlayTimeStr,
      maxPlayTimeStr,
      progress,
      isActiveTransition,
      handleTransitionEnd,
    } = usePlayProgress()

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
      nowPlayTimeStr,
      maxPlayTimeStr,
      progress,
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
  border-top: none;
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

.infoContent {
  padding: 0 10px;
  flex: auto;
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

// .timeContainer {
//   flex: none;
//   padding: 15px 0;
//   &:hover {
//     .progress {
//       opacity: 1;
//     }
//   }
// }
// .timeContent {
//   // width: 30%;
//   position: relative;
//   // flex: none;
//   color: var(--color-300);
//   font-size: 13px;
//   // padding-left: 10px;
//   // display: flex;
//   // flex-flow: column nowrap;
//   // align-items: center;
//   padding-bottom: 3px;
// }
// .progress {
//   position: absolute;
//   top: 100%;
//   left: 0;
//   width: 100%;
//   flex: auto;
//   // width: 160px;
//   // position: relative;
//   // padding-bottom: 6px;
//   // margin: 0 8px;
//   padding: 2px 0;
//   height: 8px;
//   transition: opacity @transition-normal;
//   opacity: .24;

//   .progressBar {
//     height: 2px;
//     border-radius: 0;
//   }
// }
// .time {
//   display: flex;
//   flex-flow: row nowrap;
//   justify-content: space-between;
// }


</style>
