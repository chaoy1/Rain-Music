import { ref, type Ref, useCssModule } from '@common/utils/vueTools'
import { updateUserListPosition } from '@renderer/store/list/action'
import { userLists } from '@renderer/store/list/state'
import useDarg from '@renderer/utils/compositions/useDrag'

// 长按多久（毫秒）后开始拖动排序
const DRAG_DELAY = 500

export default ({ dom_lists_list }: {
  dom_lists_list: Ref<HTMLElement | null>
}) => {
  const isDraging = ref(false)
  const styles = useCssModule()

  useDarg({
    dom_list: dom_lists_list,
    dragingItemClassName: styles.dragingItem,
    filter: 'default-list',
    delay: DRAG_DELAY,
    onStart() {
      isDraging.value = true
    },
    onEnd() {
      isDraging.value = false
    },
    onUpdate(newIndex: number, oldIndex: number) {
      // 列表里第一个 li 是「试听列表」（不可拖动但计入 Sortable 的 index），所以真实下标要减 1
      const targetIndex = oldIndex - 1
      const target = userLists[targetIndex]
      // 越界（例如拖动过程中列表被删除）时直接忽略，避免写入无效顺序
      if (!target) return
      void updateUserListPosition({ ids: [target.id], position: Math.max(newIndex - 1, 0) })
    },
  })

  return {
    isDraging,
  }
}
