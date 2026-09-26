<script setup lang="ts">
import { t, dateLocale } from '../i18n'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { CalendarPlus, ExternalLink, MapPin, PlayCircle, Upload, UserRound } from 'lucide-vue-next'
import { API_BASE_URL, api, ApiError } from '../api'
import { regionalAccess, session } from '../state'

const route = useRoute()
const meeting = ref<any>(null)
const error = ref('')
const alarm = ref(30)
const replayAvailability = ref<'idle' | 'loading' | 'available' | 'unavailable' | 'error'>('idle')

onMounted(async () => {
  try {
    meeting.value = (await api<{ meeting: any }>(`/v1/meetings/${route.params.id}`)).meeting
    if (regionalAccess.value && occurrenceEnded.value && occurrenceKey.value) {
      replayAvailability.value = 'loading'
      try {
        const params = new URLSearchParams({ eventId:String(route.params.id), occurrenceKey:String(occurrenceKey.value), page:'1' })
        const data = await api<{ groups: unknown[] }>(`/v1/replays?${params}`)
        replayAvailability.value = data.groups.length ? 'available' : 'unavailable'
      } catch {
        replayAvailability.value = 'error'
      }
    }
  }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '会议加载失败' }
})

const occurrenceStart = computed(() => typeof route.query.start === 'string' ? route.query.start : meeting.value?.startUtc)
const occurrenceEnd = computed(() => typeof route.query.end === 'string' ? route.query.end : meeting.value?.endUtc)
const occurrenceStatus = computed(() => typeof route.query.status === 'string' ? route.query.status : meeting.value?.status)
const occurrenceKey = computed(() => typeof route.query.occurrence === 'string' ? route.query.occurrence : meeting.value?.startUtc)
const occurrenceEnded = computed(() => Boolean(occurrenceEnd.value && new Date(occurrenceEnd.value).getTime() < Date.now()))
const displayStatus = computed(() => occurrenceStatus.value === 'cancelled' ? 'cancelled' : occurrenceEnded.value ? 'ended' : 'published')
const statusText = computed(() => displayStatus.value === 'cancelled' ? '该场次已取消' : displayStatus.value === 'ended' ? '已结束' : '已发布')
const dateText = computed(() => occurrenceStart.value ? new Intl.DateTimeFormat(dateLocale.value, { timeZone: 'Asia/Shanghai', dateStyle: 'full', timeStyle: 'short', hour12: false }).format(new Date(occurrenceStart.value)) : '')
const endText = computed(() => occurrenceEnd.value ? new Intl.DateTimeFormat(dateLocale.value, { timeZone: 'Asia/Shanghai', timeStyle: 'short', hour12: false }).format(new Date(occurrenceEnd.value)) : '')
const deadlineText = computed(() => meeting.value?.registrationDeadlineUtc ? new Intl.DateTimeFormat(dateLocale.value, { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(meeting.value.registrationDeadlineUtc)) : '')
const calendarUrl = computed(() => meeting.value && occurrenceStart.value && occurrenceEnd.value ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(meeting.value.title)}&dates=${compact(occurrenceStart.value)}/${compact(occurrenceEnd.value)}&details=${encodeURIComponent(`${meeting.value.summary}\n\n${meeting.value.registrationUrl}`)}&location=${encodeURIComponent(meeting.value.locationText)}` : '#')
function compact(value: string) { return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') }
const replayLink = computed(() => ({ path:'/replays', query:{ eventId:meeting.value?.id, occurrenceKey:occurrenceKey.value } }))
const replaySubmitLink = computed(() => ({ path:'/replays/submit', query:{ eventId:meeting.value?.id, occurrenceKey:occurrenceKey.value } }))
</script>

<template>
  <div v-if="error" class="error-box">{{ t(error) }}</div>
  <div v-else-if="!meeting" class="empty-state">{{ t("正在加载会议详情…") }}</div>
  <div v-else>
    <div class="page-head"><div><p class="eyebrow">MEETING DETAILS</p><h1>{{ meeting.title }}</h1><p class="subtitle">{{ meeting.summary }}</p></div><span class="status" :class="displayStatus">{{ t(statusText) }}</span></div>
    <div class="detail-layout">
      <section class="card card-body">
        <div class="inline"><span class="tag">{{ t(meeting.category) }}</span><span class="tag">{{ t(meeting.meetingLanguage === 'zh' ? '中文' : meeting.meetingLanguage === 'en' ? '英文' : meeting.meetingLanguage === 'bilingual' ? '中英双语' : '其他') }}</span></div>
        <div class="divider"></div>
        <h2>{{ t("会议说明") }}</h2><p class="detail-copy">{{ meeting.description || meeting.summary }}</p>
        <div class="divider"></div>
        <div v-if="occurrenceEnded && regionalAccess" class="inline"><RouterLink v-if="replayAvailability === 'available'" class="button secondary" :to="replayLink"><PlayCircle :size="17" />{{ t("查看回放") }}</RouterLink><span v-else-if="replayAvailability === 'loading'" class="muted">{{ t("正在检查回放…") }}</span><span v-else-if="replayAvailability === 'error'" class="muted">{{ t("暂时无法确认回放") }}</span><span v-else class="muted">{{ t("暂无回放") }}</span><RouterLink v-if="session.user?.role === 'member'" class="button" :to="replaySubmitLink"><Upload :size="17" />{{ t("投稿回放") }}</RouterLink></div>
        <div v-else-if="!occurrenceEnded" class="inline"><a class="button" :class="{ disabled: occurrenceStatus === 'cancelled' }" :href="occurrenceStatus === 'cancelled' ? undefined : meeting.registrationUrl" target="_blank" rel="noopener noreferrer"><ExternalLink :size="17" />{{ t("前往注册") }}</a><a class="button secondary" :href="calendarUrl" target="_blank" rel="noopener noreferrer"><CalendarPlus :size="17" />{{ t("添加到 Google") }}</a></div>
      </section>
      <aside class="stack">
        <section class="card card-body">
          <h2>{{ t("时间与地点") }}</h2>
          <dl class="meta-list">
            <div class="meta-row"><dt>{{ t("北京时间") }}</dt><dd>{{ dateText }} – {{ endText }}</dd></div>
            <div class="meta-row"><dt>{{ t("原始时区") }}</dt><dd>{{ meeting.sourceTimezone }}</dd></div>
            <div v-if="deadlineText" class="meta-row"><dt>{{ t("报名截止") }}</dt><dd>{{ t("{0}（北京时间）", [deadlineText]) }}</dd></div>
            <div class="meta-row"><dt><UserRound :size="16" />{{ t("主办方") }}</dt><dd>{{ meeting.organizer }}<span v-if="meeting.speaker"><br />{{ t("讲者：{0}", [meeting.speaker]) }}</span></dd></div>
            <div class="meta-row"><dt><MapPin :size="16" />{{ t("地点") }}</dt><dd>{{ meeting.locationText }}</dd></div>
          </dl>
        </section>
        <section v-if="!occurrenceEnded" class="card card-body">
          <h2>{{ t("下载到个人日历") }}</h2><p class="fine-print">{{ t("下载是单次快照。持续同步请在“设置”页面生成私密订阅地址。") }}</p>
          <div class="field"><label for="alarm">{{ t("提前提醒") }}</label><select id="alarm" v-model="alarm"><option :value="0">{{ t("不提醒") }}</option><option :value="10">{{ t("10 分钟") }}</option><option :value="30">{{ t("30 分钟") }}</option><option :value="60">{{ t("1 小时") }}</option><option :value="1440">{{ t("1 天") }}</option></select></div>
          <a class="button secondary" style="margin-top:12px;width:100%" :href="`${API_BASE_URL}/v1/meetings/${meeting.id}.ics?alarm=${alarm}`"><CalendarPlus :size="17" />{{ t("下载 .ics") }}</a>
        </section>
      </aside>
    </div>
  </div>
</template>
