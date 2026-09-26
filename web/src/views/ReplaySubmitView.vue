<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { MeetingOccurrence, ReplayGroup, ReplayInput } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import { session } from '../state'

const route = useRoute()
const group = ref<ReplayGroup | null>(null)
const occurrences = ref<MeetingOccurrence[]>([])
const selectedOccurrence = ref('')
const busy = ref(false)
const loading = ref(true)
const success = ref(false)
const error = ref('')
const form = reactive({ title:'', meetingDate:'', shareUrl:'', accessCode:'', note:'' })

const groupId = computed(() => typeof route.query.group === 'string' ? route.query.group : null)
const requestedEventId = computed(() => typeof route.query.eventId === 'string' ? route.query.eventId : '')
const requestedOccurrenceKey = computed(() => typeof route.query.occurrenceKey === 'string' ? route.query.occurrenceKey : '')

function shanghaiDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value))
}

onMounted(async () => {
  try {
    if (groupId.value) {
      const data = await api<{ replay: ReplayGroup }>(`/v1/replays/${groupId.value}`)
      group.value = data.replay
      form.title = data.replay.title
      form.meetingDate = data.replay.meetingDate
    } else {
      const now = Date.now()
      const [past, future] = await Promise.all([
        api<{ occurrences: MeetingOccurrence[] }>(`/v1/meetings?from=${encodeURIComponent(new Date(now - 180 * 86400000).toISOString())}&to=${encodeURIComponent(new Date(now).toISOString())}`),
        api<{ occurrences: MeetingOccurrence[] }>(`/v1/meetings?from=${encodeURIComponent(new Date(now).toISOString())}&to=${encodeURIComponent(new Date(now + 180 * 86400000).toISOString())}`)
      ])
      const seen = new Set<string>()
      occurrences.value = [...past.occurrences, ...future.occurrences].filter((item) => {
        const key = `${item.eventId}:${item.occurrenceKey}`
        if (seen.has(key)) return false
        seen.add(key); return true
      }).sort((left, right) => right.startUtc.localeCompare(left.startUtc))
      if (Boolean(requestedEventId.value) !== Boolean(requestedOccurrenceKey.value)) {
        error.value = '关联会议参数不完整，请从历史会议重新进入。'
      } else if (requestedEventId.value && requestedOccurrenceKey.value) {
        const match = occurrences.value.find((item) => item.eventId === requestedEventId.value && item.occurrenceKey === requestedOccurrenceKey.value)
        if (match) {
          selectedOccurrence.value = `${match.eventId}|${match.occurrenceKey}`
          chooseOccurrence()
        } else {
          error.value = '会议场次不存在或超出可关联的 180 天范围。'
        }
      }
    }
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '投稿页面加载失败' }
  finally { loading.value = false }
})

function chooseOccurrence() {
  const item = occurrences.value.find((occurrence) => `${occurrence.eventId}|${occurrence.occurrenceKey}` === selectedOccurrence.value)
  if (!item) return
  form.title = item.title
  form.meetingDate = shanghaiDate(item.startUtc)
}

async function submit() {
  busy.value = true
  error.value = ''
  const occurrence = occurrences.value.find((item) => `${item.eventId}|${item.occurrenceKey}` === selectedOccurrence.value)
  const payload: ReplayInput = {
    groupId: groupId.value,
    eventId: groupId.value ? null : occurrence?.eventId || null,
    occurrenceKey: groupId.value ? null : occurrence?.occurrenceKey || null,
    title: form.title,
    meetingDate: form.meetingDate,
    shareUrl: form.shareUrl,
    accessCode: form.accessCode,
    note: form.note
  }
  try {
    await api('/v1/replay-submissions', { method:'POST', body:JSON.stringify(payload) })
    success.value = true
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '回放投稿失败' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">SUBMIT A REPLAY</p><h1>{{ t(group ? '补充回放来源' : '投稿会议回放') }}</h1><p class="subtitle">{{ t("每个不同的有效链接都可以提交；完全相同的链接只保留最先投稿的一条。") }}</p></div><RouterLink class="button secondary" to="/replays">{{ t("返回回放") }}</RouterLink></div>
  <div v-if="session.user?.publicWqId" class="notice-box identity-notice">{{ t("投稿通过后，你的完整 WQ_ID 会显示给登录成员。") }}<RouterLink to="/calendar-settings">{{ t("需要时可在设置中隐藏") }}</RouterLink>。</div>
  <div v-if="loading" class="empty-state">{{ t("正在准备投稿表单…") }}</div>
  <div v-else-if="success" class="card card-body"><div class="success-box"><strong>{{ t("回放已进入审核队列。") }}</strong><br />{{ t("管理员通过后会出现在对应会议卡片中。") }}</div><div class="inline" style="margin-top:16px"><RouterLink class="button" to="/submissions">{{ t("查看我的投稿") }}</RouterLink><RouterLink class="button secondary" to="/replays">{{ t("浏览回放") }}</RouterLink></div></div>
  <form v-else class="card card-body stack" @submit.prevent="submit">
    <div v-if="error" class="error-box">{{ t(error) }}</div>
    <div v-if="group" class="success-box">{{ t("将为“{0}（{1}）”补充一个新的回放来源。", [group.title, group.meetingDate]) }}</div>
    <div v-else class="field"><label for="related-meeting">{{ t("关联日历会议（可选）") }}</label><select id="related-meeting" v-model="selectedOccurrence" @change="chooseOccurrence"><option value="">{{ t("不关联，手动填写历史会议") }}</option><option v-for="item in occurrences" :key="`${item.eventId}-${item.occurrenceKey}`" :value="`${item.eventId}|${item.occurrenceKey}`">{{ shanghaiDate(item.startUtc) }} · {{ item.title }}</option></select><small>{{ t("关联具体场次后，其他成员提交的来源会自动归入同一张回放卡片。") }}</small></div>
    <div class="form-grid">
      <div class="field wide"><label for="replay-title">{{ t("会议标题 *") }}</label><input id="replay-title" v-model="form.title" required maxlength="120" :readonly="Boolean(group)" /></div>
      <div class="field"><label for="replay-date">{{ t("会议日期 *") }}<span class="tag">{{ t("北京时间") }}</span></label><input id="replay-date" v-model="form.meetingDate" required type="date" :readonly="Boolean(group)" /></div>
      <div class="field"><label for="access-code">{{ t("提取码（可选）") }}</label><input id="access-code" v-model="form.accessCode" maxlength="64" autocomplete="off" :placeholder="t('例如：3k8p')" /></div>
      <div class="field wide"><label for="replay-url">{{ t("网盘或回放链接 *") }}</label><input id="replay-url" v-model="form.shareUrl" required type="url" inputmode="url" placeholder="https://..." /><small>{{ t("支持百度、夸克、阿里云盘、OneDrive、Google Drive、Dropbox、微云及其他 HTTPS 链接。") }}</small></div>
      <div class="field wide"><label for="replay-note">{{ t("简短备注（可选）") }}</label><textarea id="replay-note" v-model="form.note" maxlength="500" :placeholder="t('例如：包含完整问答环节，清晰度 1080p')" /></div>
    </div>
    <div class="inline"><button class="button" type="submit" :disabled="busy">{{ t(busy ? '正在提交…' : '提交审核') }}</button><span class="fine-print">{{ t("后台不会自动访问外部链接，管理员会人工审核。") }}</span></div>
  </form>
</template>
