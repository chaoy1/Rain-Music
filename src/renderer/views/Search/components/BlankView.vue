<template>
  <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut">
    <div v-show="props.visible" :class="$style.noitem">
      <!-- search.isShowHotSearch / search.isShowHistorySearch 设置项已移除，
           两个行为都固定为 true，因此这里的分支判断直接去掉。 -->
      <div class="scroll" :class="$style.noitemListContainer">
        <dl :class="[$style.noitemList, $style.noitemHotSearchList]">
          <dt :class="$style.noitemListTitle">{{ $t('search__hot_search') }}</dt>
          <dd v-for="(item, index) in hotSearchList" :key="index" :class="$style.noitemListItem" @click="handleSearch(item)">{{ item }}</dd>
        </dl>
        <dl v-if="historyList.length" :class="$style.noitemList">
          <dt :class="$style.noitemListTitle">
            <span>{{ $t('history_search') }}</span><span :class="$style.historyClearBtn" :aria-label="$t('history_clear')" @click="clearHistoryList">
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 512 512" space="preserve">
                <use xlink:href="#icon-eraser" />
              </svg></span>
          </dt>
          <dd v-for="(item, index) in historyList" :key="index + item" :class="$style.noitemListItem" :aria-label="$t('history_remove')" @contextmenu="removeHistoryWord(index)" @click="handleSearch(item)">{{ item }}</dd>
        </dl>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { watch, shallowRef } from '@common/utils/vueTools'
import { historyList } from '@renderer/store/search/state'
import { getHistoryList, removeHistoryWord, clearHistoryList } from '@renderer/store/search/action'
import { getList } from '@renderer/store/hotSearch'
import { useRouter } from '@common/utils/vueRouter'

const props = defineProps({
  visible: Boolean,
  source: {
    type: String,
    required: true,
  },
})

const hotSearchList = shallowRef([])

// search.isShowHotSearch 设置项已移除，行为固定为 true，所以直接注册监听。
watch(() => props.visible, (visible) => {
  if (!visible) return
  void getList(props.source).then(list => {
    hotSearchList.value = list
  })
}, {
  immediate: true,
})

watch(() => props.source, (source) => {
  if (!props.visible) return
  void getList(source).then(list => {
    if (source != props.source) return
    hotSearchList.value = list
  })
})

// search.isShowHistorySearch 设置项已移除，行为固定为 true，所以直接拉取历史。
void getHistoryList()

const router = useRouter()
const handleSearch = (text) => {
  void router.replace({
    path: '/search',
    query: {
      text,
    },
  })
}

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.noitem {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
  display: flex;
  flex-flow: column nowrap;
  // justify-content: center;
}
.noitemListContainer {
  padding: 24px;
  // margin-top: -20px;
  min-height: 0;
  max-height: 100%;
  box-sizing: border-box;
}
.noitemList {
  +.noitemList {
    margin-top: 15px;
  }
}
.noitemHotSearchList {
  min-height: 106px;
}
.noitemListTitle {
  color: var(--color-font);
  padding: 5px 5px 10px;
  font-size: 12px;
  font-weight: 400;
  opacity: .65;
}
.noitemListItem {
  display: inline-block;
  margin: 3px 5px;
  background-color: var(--surface-card);
  border: 1px solid var(--glass-edge);
  font-weight: 400;
  padding: 7px 10px;
  border-radius: 8px;
  transition: background-color @transition-normal;
  cursor: pointer;
  color: var(--color-button-font);
  .mixin-ellipsis-1();
  max-width: 150px;
  font-size: 13px;
  &:hover {
    background-color: var(--surface-hover);
  }
  &:active {
    background-color: var(--control-well);
  }
}
.historyClearBtn {
  padding: 0 5px;
  margin-left: 5px;
  color: var(--color-font-label);
  cursor: pointer;
  transition: @transition-normal;
  transition-property: color, opacity;
  opacity: .3;
  &:hover {
    color: var(--color-primary-font-hover);
    opacity: .8;
  }
  &:active {
    color: var(--color-primary-font-active);
    opacity: 1;
  }
  svg {
    vertical-align: middle;
    width: 15px;
  }
}
</style>
