import Sortable, { AutoScroll } from 'sortablejs/modular/sortable.core.esm'
import { onMounted } from '@common/utils/vueTools'
import { clearDownKeys } from '@renderer/event'

Sortable.mount(new AutoScroll())

const noop = () => {}

// 长按多久（毫秒）后才真正开始拖动，避免普通点击/轻微拖动被当成排序
const DEFAULT_DRAG_DELAY = 500
// 长按期间的指针抖动容忍范围（像素），超出则取消这次拖动
const DELAYED_DRAG_TOLERANCE = 5

// 在输入框、下拉框等交互元素上按下时不启动拖动，
// 否则长按重命名列表的输入框会被当成拖动排序
const isInteractiveTarget = target => !!(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'))

export default ({
  dom_list,
  dragingItemClassName,
  filter,
  onUpdate,
  onStart = noop,
  onEnd = noop,
  delay = DEFAULT_DRAG_DELAY,
}) => {
  onMounted(() => {
    Sortable.create(dom_list.value, {
      animation: 150,
      // 不再用修饰键开关拖动，而是长按 delay 毫秒后开始拖动
      delay,
      delayOnTouchOnly: false,
      touchStartThreshold: DELAYED_DRAG_TOLERANCE,
      // 由 filter 自己决定是否阻止默认行为（输入框上不能 preventDefault，否则无法输入）
      preventOnFilter: false,
      // 必须走 fallback 拖动：使用原生拖动时 sortablejs 会强制把 touchStartThreshold 设为 1，
      // 那样长按期间的任何 1px 抖动都会取消拖动，长按基本不可用
      forceFallback: true,
      filter: filter
        ? (event, target) => {
            if (!target) return false
            // 固定预设项（如试听列表）不参与排序
            if (target.classList.contains(filter)) {
              event.preventDefault()
              return true
            }
            return isInteractiveTarget(event.target)
          }
        : null,
      ghostClass: dragingItemClassName,
      onUpdate(event) {
        onUpdate(event.newIndex, event.oldIndex)
      },
      onMove(event) {
        return filter ? !event.related.classList.contains(filter) : true
      },
      onChoose() {
        onStart()
      },
      onUnchoose() {
        onEnd()
        // 处于拖动状态期间，键盘事件无法监听，拖动结束手动清理按下的键
        // window.app_event.emit(eventBaseName.setClearDownKeys)
        clearDownKeys()
      },
      onStart(event) {
        window.app_event.dragStart()
      },
      onEnd(event) {
        window.app_event.dragEnd()
      },
    })
  })
}
