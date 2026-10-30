import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue'

/** 全屏抽屉共用焦点循环、Escape 和关闭后恢复；嵌套日期弹层自行处理键盘。 */
export function useSheetFocus(panel: Ref<HTMLElement | undefined>, close: () => void) {
  // 保留触发入口和原滚动状态，让叠加抽屉依次关闭时回到正确位置。
  let trigger: HTMLElement | null = null
  let previousOverflow = ''

  /** 只处理当前抽屉内部事件，避免下层抽屉截走上层或传送日期弹层的按键。 */
  function handleKeydown(event: KeyboardEvent) {
    if (!panel.value?.contains(event.target as Node)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      // 排除禁用和隐藏控件，使首尾循环与当前可见表单一致。
      const targets = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
        .filter((element) => element.getClientRects().length > 0)
      const first = targets[0]
      const last = targets.at(-1)
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
  }

  // 初始焦点可由表单指定，否则落在关闭按钮；只锁住背景页面的滚动。
  onMounted(() => {
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
    nextTick(() => (panel.value?.querySelector<HTMLElement>('[data-initial-focus]') ?? panel.value?.querySelector<HTMLElement>('button'))?.focus())
  })

  // 等 DOM 移除后检查入口仍存在，避免把焦点送回已经卸载的控件。
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown)
    document.body.style.overflow = previousOverflow
    nextTick(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }) })
  })
}
