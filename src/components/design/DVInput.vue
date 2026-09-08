<script setup lang="ts">
/**
 * DVInput - 统一输入组件（Design System）
 * mode: 'text'（文字）| 'amount'（金额：仅数字 + 小数点，最多两位小数）
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    mode?: 'text' | 'amount';
    type?: 'text' | 'password';
    disabled?: boolean;
    label?: string;
    /** 金额模式最大位数（整数部分，默认 7 位） */
    maxIntegerDigits?: number;
    /** 金额文字对齐：默认 right（全局行为不变）；Recurring 等场景显式 left */
    amountAlign?: 'left' | 'right';
    /** 前缀符号（如 ¥），显示在输入框内左侧 */
    prefix?: string;
    /** 输入框尺寸：md 默认 / lg 放大（金额等主输入） */
    size?: 'md' | 'lg';
  }>(),
  {
    modelValue: '',
    placeholder: '',
    mode: 'text',
    type: 'text',
    disabled: false,
    label: '',
    maxIntegerDigits: 7,
    amountAlign: 'right',
    prefix: '',
    size: 'md',
  },
);
const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [event: Event];
}>();

const inputType = computed(() => (props.mode === 'amount' ? 'text' : props.type));

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  if (props.mode === 'amount') {
    emit('update:modelValue', sanitizeAmount(raw, props.maxIntegerDigits));
  } else {
    emit('update:modelValue', raw);
  }
}

/** 金额清洗：仅保留数字与一个小数点，最多两位小数 */
function sanitizeAmount(raw: string, maxInt: number): string {
  let value = raw.replace(/[^\d.]/g, '');
  const parts = value.split('.');
  if (parts.length > 2) {
    value = parts[0] + '.' + parts.slice(1).join('');
  }
  const [intPart = '', ...decParts] = value.split('.');
  const int = intPart.slice(0, maxInt).replace(/^0+(?=\d)/, '');
  if (decParts.length > 0) {
    return `${int}.${decParts.join('').slice(0, 2)}`;
  }
  return int;
}
</script>

<template>
  <label class="dv-input">
    <span v-if="label" class="dv-input__label">{{ label }}</span>
    <span
      class="dv-input__box"
      :class="[
        { 'dv-input__box--lg': size === 'lg' },
        { 'dv-input__box--left': amountAlign === 'left' },
        { 'dv-input__box--prefix': !!prefix },
      ]"
    >
      <span v-if="prefix" class="dv-input__prefix">{{ prefix }}</span>
      <input
        class="dv-input__field"
        :class="[
          { 'dv-input__field--amount': mode === 'amount' },
          { 'dv-input__field--left': amountAlign === 'left' },
          { 'dv-input__field--lg': size === 'lg' },
        ]"
        :type="inputType"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :inputmode="mode === 'amount' ? 'decimal' : 'text'"
        autocomplete="off"
        @input="onInput"
        @change="emit('change', $event)"
      />
    </span>
  </label>
</template>

<style scoped>
.dv-input {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xxs);
}
.dv-input__label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.dv-input__box {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xxs);
}
/* 前缀模式（如金额 ¥）：prefix + input 处于同一视觉容器，border/background 由 box 承担；
   仅在有 prefix 时生效，普通 DVInput（无 prefix）视觉完全不变。 */
.dv-input__box--prefix {
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  padding: 0 var(--dv-space-sm);
  transition: border-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.dv-input__box--prefix:focus-within {
  border-color: var(--dv-primary);
}
.dv-input__box--prefix .dv-input__field {
  flex: 1;
  min-width: 0;
  height: 42px; /* 44 - 上下各 1px 边框，保持外高不变 */
  padding: 0;
  border: none;
  background: transparent;
}
.dv-input__box--prefix .dv-input__field--lg {
  height: 46px; /* 48 - 上下各 1px 边框，保持外高不变 */
}
.dv-input__box--prefix .dv-input__field:focus {
  border-color: transparent;
  outline: none;
}
.dv-input__prefix {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--dv-on-surface-variant);
}
.dv-input__box--lg .dv-input__prefix {
  font-size: 20px;
}
.dv-input__field {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0 var(--dv-space-sm);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 14px;
  transition: border-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.dv-input__field--amount {
  font-size: 20px;
  font-weight: 600;
  text-align: right;
  letter-spacing: 0.5px;
}
/* 金额左对齐（Recurring 等场景显式启用，不改变全局默认右对齐） */
.dv-input__field--left,
.dv-input__field--amount.dv-input__field--left {
  text-align: left;
}
/* 放大尺寸：金额主输入 */
.dv-input__field--lg {
  height: 48px;
  font-size: 24px;
}
.dv-input__field--amount.dv-input__field--lg {
  font-size: 24px;
  letter-spacing: 0.5px;
}
.dv-input__field:focus {
  outline: none;
  border-color: var(--dv-primary);
}
.dv-input__field::placeholder {
  color: var(--dv-on-surface-variant);
}
.dv-input__field:disabled {
  opacity: 0.5;
}
</style>
