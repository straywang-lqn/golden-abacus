<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

/** 入口只负责手势与焦点，助手会话由根组件打开。 */
const emit = defineEmits<{ open: [] }>()

// 坐标按可拖动区域的比例保存，横竖屏切换后仍在安全范围内。
type LauncherPosition = { x: number; y: number }
const zone = ref<HTMLElement>()
const button = ref<HTMLButtonElement>()
const position = ref<LauncherPosition>({ x: 1, y: 1 })

// 精灵图前三行依次排列八个朝向，右下格只用于正面眨眼。
const angleCount = 8
const angle = ref(0)
const spritePosition = computed(() => `${angle.value % 3 * 50}% ${Math.floor(angle.value / 3) * 50}%`)

// 先移动进入拖动，先长按进入旋转；抬起后两者都拦截合成的点击。
let drag: { pointerId: number; startX: number; startY: number; origin: LauncherPosition; angle: number } | undefined
let suppressClick = false
const dragMode = ref<'move' | 'rotate'>()
let rotationTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(rotationTimer))

/** 按起点和像素位移更新比例，连续按键无需等待浏览器重排。 */
function moveFrom(origin: LauncherPosition, deltaX: number, deltaY: number) {
  if (!zone.value || !button.value) return
  const maxX = Math.max(1, zone.value.clientWidth - button.value.offsetWidth)
  const maxY = Math.max(1, zone.value.clientHeight - button.value.offsetHeight)
  position.value = {
    x: Math.max(0, Math.min(1, origin.x + deltaX / maxX)),
    y: Math.max(0, Math.min(1, origin.y + deltaY / maxY)),
  }
}

/** 每步切换一个视角，经过正面时从另一侧继续。 */
function turnFrom(start: number, steps: number) {
  angle.value = ((start + steps) % angleCount + angleCount) % angleCount
}

/** 捕获按下的指针，滑出按钮后也能继续拖动或正常结束。 */
function startDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || drag || !button.value) return
  suppressClick = false
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    origin: position.value,
    angle: angle.value,
  }
  button.value.setPointerCapture(event.pointerId)
  // 在原处长按后锁定旋转，描边提示可左右拖动。
  rotationTimer = setTimeout(() => {
    dragMode.value = 'rotate'
    suppressClick = true
  }, 400)
}

/** 横向拖动切换视角，直接拖动则从原位置移动。 */
function moveDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const deltaX = event.clientX - drag.startX
  const deltaY = event.clientY - drag.startY
  if (dragMode.value === 'rotate') {
    turnFrom(drag.angle, Math.trunc(deltaX / 24))
    return
  }
  // 超过抖动阈值后取消长按计时，整次拖动只移动位置。
  if (!dragMode.value && Math.hypot(deltaX, deltaY) < 6) return
  clearTimeout(rotationTimer)
  dragMode.value = 'move'
  suppressClick = true
  moveFrom(drag.origin, deltaX, deltaY)
}

/** 指针抬起、取消或失去捕获时释放拖动状态。 */
function endDrag(event: PointerEvent) {
  if (drag?.pointerId !== event.pointerId) return
  clearTimeout(rotationTimer)
  drag = undefined
  dragMode.value = undefined
}

/** 拦截拖动后的指针点击，同时保留回车、空格和辅助技术触发。 */
function open(event: MouseEvent) {
  if (event.detail > 0 && suppressClick) return
  // 触屏也主动记录入口，助手关闭后可以恢复到这里。
  button.value?.focus({ preventScroll: true })
  emit('open')
}

/** 方向键移动，Shift 加左右键转身，其他按键保留原生按钮行为。 */
function moveWithKeyboard(event: KeyboardEvent) {
  if (drag) return
  const step = 24
  const offsets: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0],
    ArrowUp: [0, -step], ArrowDown: [0, step],
  }
  const offset = offsets[event.key]
  if (!offset) return
  if (event.shiftKey) {
    if (offset[0]) {
      event.preventDefault()
      turnFrom(angle.value, Math.sign(offset[0]))
    }
    return
  }
  event.preventDefault()
  moveFrom(position.value, offset[0], offset[1])
}
</script>

<template>
  <!-- 只有按钮接收指针，浮动区域下方仍可正常滚动和操作。 -->
  <div ref="zone" class="ai-launcher-zone" :style="{ '--launcher-x': position.x, '--launcher-y': position.y }">
    <button
      ref="button"
      type="button"
      class="ai-launcher"
      :class="{ dragging: dragMode === 'move', rotating: dragMode === 'rotate', 'idle-front': angle === 0 && !dragMode }"
      aria-label="AI 助手"
      title="AI 助手，长按后左右拖动可旋转"
      aria-description="轻点打开，拖动或用方向键移动。长按后左右拖动，或按住 Shift 再按左右方向键，可旋转角色。"
      aria-haspopup="dialog"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @lostpointercapture="endDrag"
      @contextmenu.prevent
      @keydown="moveWithKeyboard"
      @click="open"
    >
      <!-- 透明精灵图与触摸区域等大，旋转和眨眼只切换显示的格子。 -->
      <span class="mascot-figure" aria-hidden="true">
        <span class="mascot-image" :style="{ '--mascot-frame': spritePosition }"></span>
      </span>
    </button>
  </div>
</template>

<style scoped>
/* 拖动区域避开月份栏、底栏和安全区，并与 520px 单列页面对齐。 */
.ai-launcher-zone {
  --launcher-size: 60px;
  position: fixed;
  z-index: 24;
  top: calc(var(--page-top-inset) + 56px);
  right: max(16px, calc(env(safe-area-inset-right) + 8px));
  bottom: calc(104px + env(safe-area-inset-bottom));
  left: max(16px, calc(env(safe-area-inset-left) + 8px));
  max-width: 488px;
  min-height: var(--launcher-size);
  margin-inline: auto;
  pointer-events: none;
}

/* 保留原生按钮的触摸和焦点区域，用人物轮廓代替圆形底板。 */
.ai-launcher {
  position: absolute;
  top: calc((100% - var(--launcher-size)) * var(--launcher-y));
  left: calc((100% - var(--launcher-size)) * var(--launcher-x));
  display: grid;
  place-items: center;
  width: var(--launcher-size);
  height: var(--launcher-size);
  padding: 0;
  border: 0;
  border-radius: 16px;
  background: transparent;
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
}

.ai-launcher.dragging { cursor: grabbing; }
.ai-launcher.rotating {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  cursor: ew-resize;
}

/* 精灵图按三行三列均分，背景位置每次对齐一个完整视角。 */
.mascot-figure, .mascot-image { display: block; width: 100%; height: 100%; pointer-events: none; }
.mascot-image {
  background-image: url('../assets/ai-mascot-turntable.png');
  background-position: var(--mascot-frame);
  background-repeat: no-repeat;
  background-size: 300% 300%;
}

/* 待机轻浮动，正面偶尔眨眼；拖动时保持直立并播放手脚动作。 */
.mascot-figure { animation: mascot-bob 5.8s ease-in-out infinite; }
.idle-front .mascot-image { animation: mascot-blink 5.2s steps(1, end) infinite; }
.dragging .mascot-figure, .rotating .mascot-figure { animation: none; }
.dragging .mascot-image {
  background-image: url('../assets/ai-mascot-drag.png');
  animation: mascot-flail .9s steps(1, end) infinite;
}

@keyframes mascot-bob {
  0%, 12%, 32%, 100% { transform: translateY(0); }
  22% { transform: translateY(-2px); }
}

@keyframes mascot-blink {
  0%, 34%, 38%, 100% { background-position: 0 0; }
  35% { background-position: 100% 100%; }
}

/* 九格动作按等时长循环，手脚变化不改变头部朝向或按钮位置。 */
@keyframes mascot-flail {
  0%, 100% { background-position: 0 0; }
  11.111% { background-position: 50% 0; }
  22.222% { background-position: 100% 0; }
  33.333% { background-position: 0 50%; }
  44.444% { background-position: 50% 50%; }
  55.556% { background-position: 100% 50%; }
  66.667% { background-position: 0 100%; }
  77.778% { background-position: 50% 100%; }
  88.889% { background-position: 100% 100%; }
}

/* 减少动态效果时取消自动动画，仍可手动选择朝向。 */
@media (prefers-reduced-motion: reduce) {
  .mascot-figure, .idle-front .mascot-image, .dragging .mascot-image { animation: none; }
  .dragging .mascot-image { background-position: 0 0; }
}
</style>
