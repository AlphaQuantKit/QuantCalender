<script setup lang="ts">
import { t } from '../i18n'
import { ref } from 'vue'
import { CalendarDays } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  id: string
  modelValue?: string | null
  required?: boolean
  readonly?: boolean
  min?: string
  max?: string
  ariaLabel?: string
}>(), {
  modelValue: '',
  required: false,
  readonly: false,
  min: '',
  max: '',
  ariaLabel: '日期'
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const picker = ref<HTMLInputElement | null>(null)

function formatCalendarDateInput(raw: string, finalize = false): string {
  let value = raw.replace(/[^\d/-]/g, '').slice(0, 10)
  if (/^\d{8}$/.test(value)) value = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
  if (finalize) value = value.replace(/\//g, '-')
  return value
}

function validityMessage(value: string): string {
  if (!value) return props.required ? '请输入日期' : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '日期格式应为 YYYY-MM-DD'
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return '请输入真实存在的日期'
  if (props.min && value < props.min) return `日期不能早于 ${props.min}`
  if (props.max && value > props.max) return `日期不能晚于 ${props.max}`
  return ''
}

function updateValidity(input: HTMLInputElement, value: string) {
  input.setCustomValidity(t(validityMessage(value)))
}

function onTextInput(event: Event) {
  const input = event.target as HTMLInputElement
  const value = formatCalendarDateInput(input.value)
  input.value = value
  updateValidity(input, value)
  emit('update:modelValue', value)
}

function onTextBlur(event: FocusEvent) {
  const input = event.target as HTMLInputElement
  const value = formatCalendarDateInput(input.value, true)
  input.value = value
  updateValidity(input, value)
  emit('update:modelValue', value)
}

function onPickerInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
}

function openPicker() {
  if (!picker.value || props.readonly) return
  try {
    if (typeof picker.value.showPicker === 'function') picker.value.showPicker()
    else picker.value.click()
  } catch {
    picker.value.click()
  }
}
</script>

<template>
  <div class="calendar-date-input">
    <input
      :id="id"
      class="calendar-date-text"
      :value="modelValue || ''"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="YYYY-MM-DD"
      pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
      maxlength="10"
      :required="required"
      :readonly="readonly"
      :aria-label="t(ariaLabel)"
      @input="onTextInput"
      @blur="onTextBlur"
    />
    <button v-if="!readonly" class="calendar-date-button" type="button" :aria-label="t('{0}：打开日期选择器', [t(ariaLabel)])" @click="openPicker">
      <CalendarDays :size="18" aria-hidden="true" />
    </button>
    <input
      v-if="!readonly"
      ref="picker"
      class="calendar-date-picker"
      type="date"
      tabindex="-1"
      aria-hidden="true"
      :value="modelValue || ''"
      :min="min || undefined"
      :max="max || undefined"
      @input="onPickerInput"
    />
  </div>
</template>

<style scoped>
.calendar-date-input { position: relative; }
.calendar-date-text { padding-right: 52px !important; font-variant-numeric: tabular-nums; }
.calendar-date-button { position: absolute; z-index: 1; top: 1px; right: 1px; display: grid; width: 44px; height: 44px; place-items: center; padding: 0; color: var(--teal); border: 0; border-left: 1px solid #e1e5e2; border-radius: 0 10px 10px 0; background: transparent; cursor: pointer; }
.calendar-date-button:hover { background: rgba(22, 125, 120, .08); }
.calendar-date-button:focus-visible { outline: 2px solid var(--teal); outline-offset: -3px; }
.calendar-date-picker { position: absolute; right: 12px; bottom: 2px; width: 1px !important; min-height: 1px !important; height: 1px; padding: 0 !important; opacity: 0; pointer-events: none; }
</style>
