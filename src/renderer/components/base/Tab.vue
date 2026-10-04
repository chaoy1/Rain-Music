<template>
  <ul :class="[$style.list, $style[align]]" role="tablist">
    <li
      v-for="item in list"
      :key="item[itemKey]" :class="[$style.listItem, {[$style.active]: modelValue == item[itemKey]}]" tabindex="-1" role="tab"
      :aria-label="item[itemLabel]" ignore-tip :aria-selected="modelValue == item[itemKey]" @click="handleToggle(item[itemKey])"
    >
      <span :class="$style.label">{{ item[itemLabel] }}</span>
    </li>
  </ul>
</template>

<script>

export default {
  props: {
    list: {
      type: Array,
      default() {
        return []
      },
    },
    align: {
      type: String,
      default: 'left',
    },
    itemKey: {
      type: String,
      default: 'id',
    },
    itemLabel: {
      type: String,
      default: 'label',
    },
    modelValue: {
      type: [String, Number],
      default: '',
    },
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    const handleToggle = id => {
      if (id == props.modelValue) return
      emit('update:modelValue', id)
      emit('change', id)
    }

    return {
      handleToggle,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.list {
  display: flex;
  flex-flow: row nowrap;
  font-size: 12px;
  gap: 1px;
  padding: 3px;
  border-radius: 12px;
  background: var(--control-well);
  width: fit-content;
  max-width: 100%;
  min-width: 0;

  &.left {
    justify-content: flex-start;
  }
  &.center {
    justify-content: center;
  }
  &.right {
    justify-content: flex-end;
  }
}
.listItem {
  display: block;
  // padding: 5px 15px;
  cursor: pointer;
  border-radius: 9px;
  font-weight: 400;
  white-space: nowrap;
  transition: background-color @transition-fast, box-shadow @transition-fast;


  &:hover {
    color: var(--color-font);
    background: var(--surface-hover);
  }


  &.active {
    color: var(--color-primary);
    cursor: default;
    background: var(--control-active);
    box-shadow: inset 0 1px 0 var(--glass-highlight);

    >.label {
      &:after {
        // background-color: var(--color-primary);
        opacity: 1;
        transform: translateY(0);
      }
    }
  }
}

.label {
  display: block;
  position: relative;
  padding: 6px 10px;
  &:after {
    .mixin-after();
    left: 0;
    bottom: 0;
    width: 100%;
    height: 0;
    border-radius: 20px;
    background-color: transparent;
    transform: translateY(-4px);
    opacity: 0;
    background-color: var(--color-primary-alpha-300);
    transition: @transition-fast;
    transition-property: transform, opacity;
  }
}
</style>
