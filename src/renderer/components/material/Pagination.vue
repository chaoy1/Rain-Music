<template>
  <nav v-if="maxPage > 1" :class="$style.pagination" :aria-label="$t('pagination__page', { num: currentPage })" data-pagination>
    <button type="button" :disabled="currentPage === 1" :aria-label="$t('pagination__prev')" @click="handleClick(currentPage - 1)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
    </button>
    <template v-if="pages[0] > 1">
      <button type="button" :aria-label="$t('pagination__page', { num: 1 })" @click="handleClick(1)">1</button>
      <span v-if="pages[0] > 2" :class="$style.ellipsis" aria-hidden="true">…</span>
    </template>
    <button
      v-for="p in pages" :key="p" type="button"
      :class="{ [$style.active]: p === currentPage }"
      :aria-label="$t('pagination__page', { num: p })"
      :aria-current="p === currentPage ? 'page' : undefined"
      @click="handleClick(p)"
    >{{ p }}</button>
    <template v-if="pages[pages.length - 1] < maxPage">
      <span v-if="pages[pages.length - 1] < maxPage - 1" :class="$style.ellipsis" aria-hidden="true">…</span>
      <button type="button" :aria-label="$t('pagination__page', { num: maxPage })" @click="handleClick(maxPage)">{{ maxPage }}</button>
    </template>
    <button type="button" :disabled="currentPage === maxPage" :aria-label="$t('pagination__next')" @click="handleClick(currentPage + 1)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
    </button>
  </nav>
</template>

<script>
import { computed } from '@common/utils/vueTools'

export default {
  props: {
    count: { type: Number, default: 0 },
    limit: { type: Number, default: 10 },
    page: { type: Number, default: 1 },
    btnLength: { type: Number, default: 7 },
  },
  emits: ['btn-click'],
  setup(props, { emit }) {
    const maxPage = computed(() => Math.max(1, Math.ceil(props.count / Math.max(1, props.limit))))
    const currentPage = computed(() => Math.max(1, Math.min(maxPage.value, props.page)))
    const pages = computed(() => {
      const length = Math.min(maxPage.value, Math.max(1, props.btnLength))
      const start = Math.max(1, Math.min(currentPage.value - Math.floor(length / 2), maxPage.value - length + 1))
      return Array.from({ length }, (_, i) => start + i)
    })
    const handleClick = (page) => {
      if (page === currentPage.value || page < 1 || page > maxPage.value) return
      emit('btn-click', page)
    }
    return { maxPage, currentPage, pages, handleClick }
  },
}
</script>

<style lang="less" module>
.pagination {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  padding: 4px;
  box-sizing: border-box;
  border-radius: 14px;
  background: var(--control-well);
  font-variant-numeric: tabular-nums;
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    min-width: 30px;
    height: 30px;
    padding: 0 7px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--color-font);
    font-size: 13px;
    font-weight: 400;
    cursor: pointer;
    transition: background-color .16s ease, box-shadow .16s ease;
    &:hover:not(:disabled) { background: var(--control-hover); }
    &:active:not(:disabled) { background: var(--surface-hover); }
    &:focus-visible { outline: 2px solid var(--control-outline); outline-offset: 1px; }
    &:disabled { opacity: .28; cursor: default; }
    &.active {
      color: var(--control-ink);
      background: var(--control-active);
      box-shadow: inset 0 0 0 1px var(--glass-highlight), 0 1px 3px var(--glass-edge);
    }
  }
  svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}
.ellipsis { width: 18px; font-size: 13px; opacity: .45; text-align: center; }
@media (max-width: 880px) {
  .pagination { gap: 2px; button { min-width: 27px; padding: 0 5px; } }
}
</style>
