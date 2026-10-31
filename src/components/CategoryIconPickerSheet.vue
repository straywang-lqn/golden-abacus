<script setup lang="ts">
import { computed, ref } from 'vue'
import { Popup } from 'vant/es/popup'
// 只加载底部弹层和遮罩，沿用应用现有的 Vant 样式边界。
import 'vant/es/style/base.css'
import 'vant/es/popup/index.css'
import 'vant/es/overlay/index.css'
import { useSheetFocus } from '../useSheetFocus'

/** 入口只传入已确认图标；弹层不直接修改分类或持久化数据。 */
const props = defineProps<{ value: string }>()
/** 取消丢弃草稿，确定后才把非空图标交回设置表单。 */
const emit = defineEmits<{ close: []; confirm: [icon: string] }>()
// 每次打开重新挂载，从当前图标建立可取消的草稿。
const draftIcon = ref(props.value)
// 复用抽屉的 Escape、Tab 循环和卸载后焦点恢复；传送后不会被设置抽屉截获。
const panel = ref<HTMLElement>()
useSheetFocus(panel, () => emit('close'))

// 预设只提供快捷输入，继续保存原有字符串，兼容自定义图标和旧备份。
const iconOptions = [
  { icon: '✨', name: '其他' }, { icon: '🍜', name: '餐饮' },
  { icon: '☕', name: '咖啡' }, { icon: '🍎', name: '水果' },
  { icon: '🚇', name: '交通' }, { icon: '🚗', name: '汽车' },
  { icon: '🛒', name: '购物' }, { icon: '👕', name: '服饰' },
  { icon: '🏠', name: '住房' }, { icon: '💡', name: '水电' },
  { icon: '📱', name: '通讯' }, { icon: '💊', name: '医疗' },
  { icon: '📚', name: '学习' }, { icon: '🎮', name: '游戏' },
  { icon: '🎬', name: '电影' }, { icon: '🎵', name: '音乐' },
  { icon: '✈', name: '旅行' }, { icon: '⚽', name: '运动' },
  { icon: '🐾', name: '宠物' }, { icon: '🎁', name: '礼物' },
  { icon: '💰', name: '工资' }, { icon: '💼', name: '兼职' },
  { icon: '📈', name: '理财' }, { icon: '🧧', name: '红包' },
]
// 只给已知预设显示名称参考，自定义字符不猜测含义，也不改写分类名称。
const referenceName = computed(() => iconOptions.find((option) => option.icon === draftIcon.value.trim())?.name)
</script>

<template>
  <Popup
    :show="true"
    position="bottom"
    round
    teleport="body"
    class="category-icon-panel"
    overlay-class="category-icon-overlay"
    aria-label="选择分类图标"
    aria-modal="true"
    :close-on-click-overlay="false"
    safe-area-inset-bottom
    @click-overlay="$emit('close')"
  >
    <div ref="panel">
      <header class="category-icon-header">
        <button type="button" class="text-button" @click="$emit('close')">取消</button>
        <h2>选择图标</h2>
        <button type="button" class="category-icon-confirm" :disabled="!draftIcon.trim()" @click="$emit('confirm', draftIcon.trim())">确定</button>
      </header>
      <!-- 原生单选框提供方向键切换，标签扩大点击区域并显示草稿选择。 -->
      <fieldset class="category-icon-options">
        <legend>常用图标</legend>
        <label v-for="option in iconOptions" :key="option.icon" :class="{ selected: draftIcon === option.icon }" :title="option.name">
          <input v-model="draftIcon" type="radio" name="new-category-icon" :value="option.icon" :aria-label="`${option.name}图标`">
          <span aria-hidden="true">{{ option.icon }}</span>
        </label>
      </fieldset>
      <label class="category-icon-custom">
        自定义图标<input v-model="draftIcon" maxlength="2" aria-label="自定义分类图标">
        <small class="field-help" aria-live="polite">{{ referenceName ? `参考名称：${referenceName}` : '' }}</small>
      </label>
    </div>
  </Popup>
</template>
