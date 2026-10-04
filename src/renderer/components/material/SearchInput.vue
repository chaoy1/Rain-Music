<template>
  <div :class="[$style.container, { [$style.page]: page }]">
    <div :class="[$style.search, {[$style.active]: focus}, {[$style.big]: big}, {[$style.small]: small}]">
      <div :class="$style.form">
        <input
          ref="dom_input"
          v-model.trim="text"
          :aria-label="placeholder"
          :placeholder="placeholder"
          @focus="handleFocus"
          @blur="handleBlur"
          @input="$emit('update:modelValue', text)"
          @change="sendEvent('change')"
          @keyup.enter="handleSearch"
          @keydown.arrow-down.arrow-up.prevent
          @keyup.arrow-down.prevent="handleKeyDown"
          @keyup.arrow-up.prevent="handleKeyUp"
          @contextmenu="handleContextMenu"
        >
        <transition enter-active-class="animated zoomIn" leave-active-class="animated zoomOut">
          <button v-show="text" type="button" @click="handleClearList">
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 24 24" space="preserve">
              <use xlink:href="#icon-window-close" />
            </svg>
          </button>
        </transition>
        <button type="button" @click="handleSearch">
          <slot>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" />
            </svg>
          </slot>
        </button>
      </div>
      <div v-if="list" :class="$style.list" :style="listStyle">
        <ul ref="dom_list" @mouseleave="selectIndex = -1">
          <li
            v-for="(item, index) in list"
            :key="item"
            :class="{[$style.select]: selectIndex === index }"
            @mouseenter="selectIndex = index"
            @click="handleTemplistClick(index)"
          >
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
import { clipboardReadText } from '@common/utils/electron'
import { HOTKEY_COMMON } from '@common/hotKey'
import { appSetting } from '@renderer/store/setting'

export default {
  props: {
    placeholder: {
      type: String,
      default: 'Search for something...',
    },
    list: {
      type: Array,
      default() {
        return []
      },
    },
    visibleList: {
      type: Boolean,
      default: false,
    },
    modelValue: {
      type: String,
      default: '',
    },
    big: {
      type: Boolean,
      default: false,
    },
    small: {
      type: Boolean,
      default: false,
    },
    page: Boolean,
  },
  emits: ['update:modelValue', 'event'],
  data() {
    return {
      isShow: false,
      text: this.modelValue,
      selectIndex: -1,
      focus: false,
      listStyle: {
        height: 0,
      },
    }
  },
  watch: {
    list(n) {
      if (!this.visibleList) return
      if (this.selectIndex > -1) this.selectIndex = -1
      this.$nextTick(() => {
        this.listStyle.height = this.$refs.dom_list.scrollHeight + 'px'
      })
    },
    modelValue(n) {
      this.text = n
    },
    visibleList(n) {
      n ? this.showList() : this.hideList()
    },
  },
  mounted() {
    if (appSetting['search.isFocusSearchBox']) this.handleFocusInput()
    this.handleRegisterEvent('on')
  },
  beforeUnmount() {
    this.handleRegisterEvent('off')
  },
  methods: {
    handleRegisterEvent(action) {
      let eventHub = window.key_event
      let name = action == 'on' ? 'on' : 'off'
      // eslint-disable-next-line @typescript-eslint/unbound-method
      eventHub[name](HOTKEY_COMMON.focusSearchInput.action, this.handleFocusInput)
    },
    handleFocusInput() {
      this.$refs.dom_input.focus()
    },
    handleTemplistClick(index) {
      console.log(index)
      this.sendEvent('listClick', index)
    },
    handleFocus() {
      this.focus = true
      this.sendEvent('focus')
    },
    handleBlur() {
      setTimeout(() => {
        this.focus = false
        this.sendEvent('blur')
      }, 80)
    },
    handleSearch() {
      this.hideList()
      if (this.selectIndex < 0) {
        this.sendEvent('submit')
        return
      }
      this.sendEvent('listClick', this.selectIndex)
    },
    showList() {
      this.isShow = true
      this.listStyle.height = this.$refs.dom_list.scrollHeight + 'px'
    },
    hideList() {
      this.isShow = false
      this.listStyle.height = 0
      this.$nextTick(() => {
        this.selectIndex = -1
      })
    },
    sendEvent(action, data) {
      this.$emit('event', {
        action,
        data,
      })
    },
    handleKeyDown() {
      if (this.list.length) {
        this.selectIndex = this.selectIndex + 1 < this.list.length ? this.selectIndex + 1 : 0
      } else if (this.selectIndex > -1) {
        this.selectIndex = -1
      }
    },
    handleKeyUp() {
      if (this.list.length) {
        this.selectIndex = this.selectIndex - 1 < -1 ? this.list.length - 1 : this.selectIndex - 1
      } else if (this.selectIndex > -1) {
        this.selectIndex = -1
      }
    },
    handleContextMenu() {
      let str = clipboardReadText()
      str = str.trim()
      str = str.replace(/\t|\r\n|\n|\r/g, ' ')
      str = str.replace(/\s+/g, ' ')
      let dom_input = this.$refs.dom_input
      this.text = this.text.substring(0, dom_input.selectionStart) + str + this.text.substring(dom_input.selectionEnd, this.text.length)
      this.$emit('update:modelValue', this.text)
    },
    handleClearList() {
      this.text = ''
      this.$emit('update:modelValue', this.text)
      this.sendEvent('submit')
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  position: relative;
  width: clamp(180px, 38%, 320px);
  flex: none;
  height: 32px;
  -webkit-app-region: no-drag;
}

.search {
  position: absolute;
  width: 100%;
  border-radius: 12px;
  box-shadow: none;
  transition: box-shadow .4s ease, background-color @transition-normal;
  display: flex;
  flex-flow: column nowrap;
  background-color: var(--control-well);
  backdrop-filter: blur(20px);

  &.active {
    background-color: var(--surface-popup);
    box-shadow: 0 8px 24px rgba(0,0,0,.12), inset 0 0 0 1px var(--glass-edge);
    .form {
      input {
        border-bottom-left-radius: 0;

      }
      button {
        border-bottom-right-radius: 0;
      }
    }
  }
  &:focus-within { box-shadow: 0 0 0 2px var(--glass-edge), inset 0 1px 0 var(--glass-highlight); }
  .form {
    display: flex;
    height: 32px;
    position: relative;
    input {
      flex: auto;
      // border: 1px solid;
      border-top-left-radius: 3px;
      border-bottom-left-radius: 3px;
      background-color: transparent;
      // border-bottom: 2px solid var(--color-primary);
      // border-color: var(--color-primary);
      border: none;
      min-width: 0;

      outline: none;
      // height: @height-toolbar * .7;
      padding: 0 11px;
      overflow: hidden;
      font-size: 13.5px;
      line-height: 32px;
      &::placeholder {
        color: var(--color-button-font);
        font-size: .98em;
      }
    }
    button {
      flex: none;
      border: none;
      // background-color: @color-search-form-background;
      background-color: transparent;
      outline: none;
      cursor: pointer;
      height: 100%;
      padding: 8px;
      width: 34px;
      border-radius: 10px;
      svg { width: 16px; height: 16px; }
      svg[fill='none'] { fill: none; }
      color: var(--color-button-font);
      transition: background-color .2s ease;

      &:last-child {
        border-top-right-radius: 3px;
        border-bottom-right-radius: 3px;
      }

      &:hover {
        background-color: var(--control-hover);
      }
      &:active {
        background-color: var(--control-well);
      }
    }
  }
  .list {
    // background-color: @color-search-form-background;
    font-size: 13px;
    transition: .3s ease;
    height: 0;
    transition-property: height;
    overflow: hidden;
    max-height: min(340px, 55vh);
    overflow-y: auto;
    li {
      cursor: pointer;
      padding: 8px 11px;
      margin: 2px 5px;
      border-radius: 6px;
      font-weight: 400;
      transition: background-color .2s ease;
      line-height: 1.3;
      span {
        font-weight: 400;
        .mixin-ellipsis-2();
      }

      &.select {
        background-color: var(--surface-selected);
        font-weight: 400;
      }
      &:last-child {
        border-bottom-left-radius: 3px;
        border-bottom-right-radius: 3px;
      }
    }
  }
}

.big {
  width: 100%;
  // input {
  //   line-height: 30px;
  // }
  .form {
    height: 30px;
    button {
      padding: 6px 10px;
    }
  }
}
.page {
  width: min(100%, 600px);
  height: 42px;
  .search {
    border-radius: 10px;
    background-color: var(--control-well);
    background-image: none;
    box-shadow: inset 0 0 0 1px var(--glass-edge);
    transition: background-color .18s ease, box-shadow .18s ease;
    &.active, &:focus-within {
      background-color: var(--surface-popup);
      box-shadow: inset 0 1px 0 var(--glass-highlight), inset 0 0 0 1px var(--control-outline), 0 3px 10px var(--glass-edge);
      .form button { opacity: 1; }
      input::placeholder { opacity: .7; }
    }
  }
  .form {
    height: 42px;
    align-items: center;
    input { height: 100%; box-sizing: border-box; padding: 0 15px; font-size: 14px; line-height: 42px; &::placeholder { opacity: .55; } }
    button { width: 34px; height: 34px; margin-right: 4px; padding: 9px; border-radius: 8px; opacity: .65; transition: opacity .18s ease, background-color .14s ease; }
  }
  .list { font-size: 14px; li { padding: 10px 12px; border-radius: 7px; } }
}
@media (prefers-reduced-motion: reduce) { .page .search, .page .form button { transition: none; } }


</style>
