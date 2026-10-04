<template>
  <button
    data-round-control
    :class="[$style.btn, {[$style.min]: min}, {[$style.outline]: outline}]"
    tabindex="0"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<script>
export default {
  props: {
    min: {
      type: Boolean,
    },
    outline: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  box-shadow: var(--control-raised-shadow);
  border-radius: var(--control-radius);
  cursor: pointer;
  padding: 7px 13px;
  color: var(--color-font);
  outline: none;
  transition: background-color .16s ease, color .16s ease;
  background-color: var(--control-active);
  background-image: var(--control-face);
  font-size: 13px;
  &[disabled] {
    opacity: .4;
    cursor: default;
  }

  &.outline {
    background-color: transparent;
    box-shadow: none;
  }

  &:hover:not([disabled]) {
    background-color: var(--control-hover);
  }
  &:active:not([disabled]) {
    background-color: var(--control-well);
  }
}

.min {
  padding: 3px 8px;
  font-size: 12px;
}

</style>
