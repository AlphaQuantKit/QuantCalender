<script setup lang="ts">
import { t } from '../i18n'
import { computed, reactive, watch } from 'vue'
import type { MeetingInput } from '@wq-calendar/shared'
import { regionalAccess } from '../state'

type RecurrenceValue = { kind: 'none' | 'weekly' | 'biweekly' | 'monthly'; untilLocal: string | null }
type FormValue = Omit<MeetingInput, 'durationMinutes' | 'recurrence'> & { durationMinutes: 30 | 60 | 90 | 120 | 180; recurrence: RecurrenceValue }

const props = withDefaults(defineProps<{
  initial?: Partial<MeetingInput>
  submitLabel?: string
  busy?: boolean
}>(), { submitLabel: '提交审核', busy: false })

const emit = defineEmits<{ submit: [meeting: MeetingInput] }>()

function localDefault(hoursAhead = 24) {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1000)
  const shanghai = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const offset = shanghai.getTimezoneOffset()
  return new Date(shanghai.getTime() - offset * 60000).toISOString().slice(0, 16)
}

function defaults(): FormValue {
  return {
    title: '', category: '培训', meetingLanguage: regionalAccess.value ? 'zh' : 'en', registrationUrl: '',
    startLocal: localDefault(24), durationMinutes: 60, recurrence: { kind: 'none', untilLocal: null }
  }
}

function withSeconds(value: string | null) {
  if (!value) return null
  return value.length === 16 ? `${value}:00` : value
}

function formValue(initial?: Partial<MeetingInput>): FormValue {
  const base = defaults()
  return {
    ...base,
    ...initial,
    durationMinutes: initial?.durationMinutes || 60,
    recurrence: { ...base.recurrence, ...initial?.recurrence }
  }
}

const form = reactive<FormValue>(formValue(props.initial))
const showUntil = computed(() => form.recurrence.kind !== 'none')

watch(() => props.initial, (value) => {
  Object.assign(form, formValue(value))
}, { deep: true })

function submit() {
  const startLocal = withSeconds(form.startLocal)!
  emit('submit', {
    title: form.title,
    category: form.category,
    meetingLanguage: form.meetingLanguage,
    registrationUrl: form.registrationUrl,
    startLocal,
    durationMinutes: form.durationMinutes,
    recurrence: { ...form.recurrence, untilLocal: showUntil.value ? withSeconds(form.recurrence.untilLocal) : null }
  })
}
</script>

<template>
  <form class="stack" @submit.prevent="submit">
    <div class="form-grid">
      <div class="field wide">
        <label for="meeting-title">{{ t("会议名称 *") }}</label>
        <input id="meeting-title" v-model="form.title" required maxlength="120" :placeholder="t('例如：亚洲区顾问周会')" />
      </div>
      <div class="field">
        <label for="category">{{ t("类别 *") }}</label>
        <select id="category" v-model="form.category">
          <option value="培训">{{ t("培训") }}</option><option value="顾问周会">{{ t("顾问周会") }}</option><option value="研究分享">{{ t("研究分享") }}</option><option value="平台更新">{{ t("平台更新") }}</option><option value="答疑">{{ t("答疑") }}</option><option value="其他">{{ t("其他") }}</option>
        </select>
      </div>
      <div class="field">
        <label for="language">{{ t("会议语言") }}</label>
        <select id="language" v-model="form.meetingLanguage">
          <option v-if="regionalAccess" value="zh">{{ t("中文") }}</option><option value="en">{{ t("英文") }}</option><option v-if="regionalAccess" value="bilingual">{{ t("中英双语") }}</option><option v-if="regionalAccess" value="other">{{ t("其他") }}</option>
        </select>
      </div>
      <div class="field wide">
        <label for="registration-url">{{ t("注册链接 *") }}</label>
        <input id="registration-url" v-model="form.registrationUrl" required type="url" inputmode="url" placeholder="https://..." />
        <small>{{ t("仅接受 HTTPS 注册页；不要填写含密码、账号或个人令牌的直达链接。") }}</small>
      </div>
      <div class="field">
        <label for="start">{{ t("开始时间 *") }}<span class="tag">{{ t("北京时间") }}</span></label>
        <input id="start" v-model="form.startLocal" required type="datetime-local" />
      </div>
      <div class="field">
        <label for="duration">{{ t("持续时长") }}</label>
        <select id="duration" v-model="form.durationMinutes">
          <option :value="30">{{ t("30 分钟") }}</option>
          <option :value="60">{{ t("1 小时") }}</option>
          <option :value="90">{{ t("1.5 小时") }}</option>
          <option :value="120">{{ t("2 小时") }}</option>
          <option :value="180">{{ t("3 小时") }}</option>
        </select>
      </div>
      <div class="field">
        <label for="recurrence">{{ t("重复方式") }}</label>
        <select id="recurrence" v-model="form.recurrence.kind">
          <option value="none">{{ t("不重复") }}</option><option value="weekly">{{ t("每周") }}</option><option value="biweekly">{{ t("每两周") }}</option><option value="monthly">{{ t("每月同日") }}</option>
        </select>
      </div>
      <div v-if="showUntil" class="field">
        <label for="recurrence-until">{{ t("重复至 *") }}<span class="tag">{{ t("北京时间") }}</span></label>
        <input id="recurrence-until" v-model="form.recurrence.untilLocal" required type="datetime-local" />
        <small>{{ t("最长 12 个月；月度重复遇到不存在的日期时跳过该月。") }}</small>
      </div>
    </div>
    <div class="inline">
      <button class="button" type="submit" :disabled="busy">{{ t(busy ? '正在保存…' : submitLabel) }}</button>
      <span class="fine-print">{{ t("开始与重复时间均按北京时间；结束时间根据持续时长自动计算。") }}</span>
    </div>
  </form>
</template>
