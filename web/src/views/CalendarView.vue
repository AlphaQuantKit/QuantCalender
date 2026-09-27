<script setup lang="ts">
import { t, dateLocale } from '../i18n'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Calendar, ChevronLeft, ChevronRight, ExternalLink, Eye, History, List, PlayCircle, Plus, Search, Upload, X } from 'lucide-vue-next'
import type { MeetingInput, MeetingOccurrence } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import { regionalAccess, session } from '../state'
import MeetingForm from '../components/MeetingForm.vue'

type TimeScope = 'upcoming' | 'history'
type MonthCursor = { year: number; month: number }

const upcomingOccurrences = ref<MeetingOccurrence[]>([])
const historyOccurrences = ref<MeetingOccurrence[]>([])
const upcomingLoading = ref(true)
const historyLoading = ref(false)
const historyLoaded = ref(false)
const error = ref('')
const query = ref('')
const category = ref('')
const meetingLanguage = ref('')
const locationType = ref('')
const view = ref<'agenda' | 'month'>('agenda')
const timeScope = ref<TimeScope>('upcoming')
const nowMs = ref(Date.now())
const monthCursor = ref<MonthCursor>(beijingMonth(nowMs.value))
const submitOpen = ref(session.user?.role === 'member' && new URLSearchParams(window.location.hash.split('?')[1] || '').get('submit') === '1')
const submitBusy = ref(false)
const submitError = ref('')
const submitSuccess = ref(false)

const formatter = computed(() => new Intl.DateTimeFormat(dateLocale.value, { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short' }))
const timeFormatter = computed(() => new Intl.DateTimeFormat(dateLocale.value, { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }))

let clockId: number | undefined

onMounted(() => {
  void loadUpcoming()
  clockId = window.setInterval(() => { nowMs.value = Date.now() }, 60_000)
})

onBeforeUnmount(() => {
  if (clockId !== undefined) window.clearInterval(clockId)
})

function rangeUrl(from: Date, to: Date) {
  return `/v1/meetings?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
}

async function loadUpcoming() {
  upcomingLoading.value = true
  error.value = ''
  try {
    const now = new Date(nowMs.value)
    const data = await api<{ occurrences: MeetingOccurrence[] }>(rangeUrl(now, new Date(nowMs.value + 180 * 86400000)))
    upcomingOccurrences.value = data.occurrences
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '加载会议失败' }
  finally { upcomingLoading.value = false }
}

async function loadHistory() {
  if (historyLoaded.value || historyLoading.value) return
  historyLoading.value = true
  error.value = ''
  try {
    const now = new Date(nowMs.value)
    const data = await api<{ occurrences: MeetingOccurrence[] }>(rangeUrl(new Date(nowMs.value - 180 * 86400000), now))
    historyOccurrences.value = data.occurrences
    historyLoaded.value = true
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '加载历史会议失败' }
  finally { historyLoading.value = false }
}

function selectScope(scope: TimeScope) {
  timeScope.value = scope
  error.value = ''
  monthCursor.value = beijingMonth(nowMs.value)
  if (scope === 'history') void loadHistory()
}

const allOccurrences = computed(() => {
  const unique = new Map<string, MeetingOccurrence>()
  for (const item of [...historyOccurrences.value, ...upcomingOccurrences.value]) {
    unique.set(`${item.eventId}:${item.occurrenceKey}`, item)
  }
  return [...unique.values()]
})
const scopedOccurrences = computed(() => allOccurrences.value.filter((item) => timeScope.value === 'history'
  ? new Date(item.endUtc).getTime() < nowMs.value
  : new Date(item.endUtc).getTime() >= nowMs.value))
const filtered = computed(() => scopedOccurrences.value.filter((item) => {
  const text = `${item.title} ${item.summary} ${item.organizer} ${item.speaker}`.toLowerCase()
  return (regionalAccess.value || item.meetingLanguage === 'en')
    && (!query.value || text.includes(query.value.toLowerCase()))
    && (!category.value || item.category === category.value)
    && (!meetingLanguage.value || item.meetingLanguage === meetingLanguage.value)
    && (!locationType.value || item.locationType === locationType.value)
}))
const upcoming = computed(() => timeScope.value === 'upcoming'
  ? [...filtered.value].sort((left, right) => left.startUtc.localeCompare(right.startUtc)).find((item) => item.status === 'published')
  : undefined)
const agendaItems = computed(() => {
  if (timeScope.value === 'history') return [...filtered.value].sort((left, right) => right.endUtc.localeCompare(left.endUtc))
  const shownSeries = new Set(upcoming.value ? [upcoming.value.eventId] : [])
  return [...filtered.value]
    .sort((left, right) => left.startUtc.localeCompare(right.startUtc))
    .filter((item) => {
      if (shownSeries.has(item.eventId)) return false
      shownSeries.add(item.eventId)
      return true
    })
})
const categories = computed(() => [...new Set(scopedOccurrences.value.map((item) => item.category))].sort())
const loading = computed(() => timeScope.value === 'history' ? historyLoading.value : upcomingLoading.value)

function shanghaiParts(date: string) {
  const parts = new Intl.DateTimeFormat(dateLocale.value, { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date(date))
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return { month: get('month'), day: get('day'), weekday: get('weekday') }
}

function beijingMonth(value: number): MonthCursor {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric' }).formatToParts(new Date(value))
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0)
  return { year: part('year'), month: part('month') }
}

function dayKey(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}` }
function occurrenceDayKey(value: string) {
  const formatted = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
  return formatted
}

const monthDays = computed(() => {
  const { year, month } = monthCursor.value
  const first = new Date(Date.UTC(year, month - 1, 1))
  const gridStart = new Date(Date.UTC(year, month - 1, 1 - first.getUTCDay()))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setUTCDate(gridStart.getUTCDate() + index)
    const key = dayKey(date)
    return { date, key, current: date.getUTCMonth() + 1 === month, events: filtered.value.filter((item) => occurrenceDayKey(item.startUtc) === key) }
  })
})

function monthIndex(value: MonthCursor) { return value.year * 12 + value.month - 1 }
const monthBounds = computed(() => {
  const start = beijingMonth(timeScope.value === 'history' ? nowMs.value - 180 * 86400000 : nowMs.value)
  const end = beijingMonth(timeScope.value === 'history' ? nowMs.value : nowMs.value + 180 * 86400000)
  return { start: monthIndex(start), end: monthIndex(end) }
})
function canShiftMonth(delta: number) {
  const target = monthIndex(monthCursor.value) + delta
  return target >= monthBounds.value.start && target <= monthBounds.value.end
}
function shiftMonth(delta: number) {
  if (!canShiftMonth(delta)) return
  const date = new Date(Date.UTC(monthCursor.value.year, monthCursor.value.month - 1 + delta, 1))
  monthCursor.value = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}
function detailLink(item: MeetingOccurrence) {
  return {
    path: `/meetings/${item.eventId}`,
    query: { occurrence: item.occurrenceKey, start: item.startUtc, end: item.endUtc, status: item.status }
  }
}
function replayLink(item: MeetingOccurrence) {
  return { path:'/replays', query:{ eventId:item.eventId, occurrenceKey:item.occurrenceKey } }
}
function replaySubmitLink(item: MeetingOccurrence) {
  return { path:'/replays/submit', query:{ eventId:item.eventId, occurrenceKey:item.occurrenceKey } }
}

function openSubmission() {
  submitError.value = ''
  submitSuccess.value = false
  submitOpen.value = true
}

function closeSubmission() {
  submitOpen.value = false
  submitError.value = ''
  submitSuccess.value = false
}

async function submitMeeting(meeting: MeetingInput) {
  submitBusy.value = true
  submitError.value = ''
  try {
    await api('/v1/submissions', { method:'POST', body:JSON.stringify(meeting) })
    submitSuccess.value = true
  } catch (caught) { submitError.value = caught instanceof ApiError ? caught.message : '投稿失败' }
  finally { submitBusy.value = false }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><p class="eyebrow">MEMBER CALENDAR</p><h1>{{ t("会议安排") }}</h1><p class="subtitle">{{ t("所有时间均按北京时间显示。订阅个人日历后，新会议、改期和取消会随客户端刷新同步。") }}</p></div>
      <div class="calendar-page-actions">
        <button v-if="session.user?.role === 'member'" class="button meeting-submit-button" type="button" @click="openSubmission"><Plus :size="17" />{{ t("投稿会议") }}</button>
        <div class="segmented calendar-scope" :aria-label="t('切换会议时间范围')">
          <button type="button" :class="{ active: timeScope === 'upcoming' }" @click="selectScope('upcoming')"><Calendar :size="16" />{{ t("即将开始") }}</button>
          <button type="button" :class="{ active: timeScope === 'history' }" @click="selectScope('history')"><History :size="16" />{{ t("历史会议") }}</button>
        </div>
        <div class="segmented" :aria-label="t('切换日历视图')">
          <button type="button" :class="{ active: view === 'agenda' }" @click="view = 'agenda'"><List :size="16" />{{ t("议程") }}</button>
          <button type="button" :class="{ active: view === 'month' }" @click="view = 'month'"><Calendar :size="16" />{{ t("月历") }}</button>
        </div>
      </div>
    </div>

    <div class="filters">
      <label style="position:relative"><Search :size="17" style="position:absolute;left:13px;top:13px;color:#839096" /><input v-model="query" style="width:100%;padding-left:39px" :placeholder="t('搜索会议、主办方或讲者')" /></label>
      <select v-model="category"><option value="">{{ t("全部类别") }}</option><option v-for="item in categories" :key="item" :value="item">{{ t(item) }}</option></select>
      <select v-model="meetingLanguage"><option value="">{{ t("全部语言") }}</option><option v-if="regionalAccess" value="zh">{{ t("中文") }}</option><option value="en">{{ t("英文") }}</option><option v-if="regionalAccess" value="bilingual">{{ t("中英双语") }}</option><option v-if="regionalAccess" value="other">{{ t("其他") }}</option></select>
      <select v-model="locationType"><option value="">{{ t("全部形式") }}</option><option value="online">{{ t("线上") }}</option><option value="offline">{{ t("线下") }}</option><option value="hybrid">{{ t("线上 + 线下") }}</option></select>
      <button class="button secondary small" @click="query='';category='';meetingLanguage='';locationType=''">{{ t("清除") }}</button>
    </div>

    <div v-if="error" class="error-box">{{ t(error) }}</div>
    <div v-else-if="loading" class="empty-state">{{ t(timeScope === 'history' ? '正在整理过去 180 天的会议…' : '正在整理未来 180 天的会议…') }}</div>
    <div v-else-if="filtered.length === 0" class="empty-state"><div><h2>{{ t(timeScope === 'history' ? '过去 180 天没有匹配的历史会议' : '暂时没有匹配的会议') }}</h2><p>{{ t(timeScope === 'history' ? '可以调整筛选条件，或切换回“即将开始”。' : '可以调整筛选条件，或提交一场新会议等待管理员审批。') }}</p></div></div>

    <template v-else-if="view === 'agenda'">
      <section v-if="timeScope === 'upcoming' && upcoming" class="hero-meeting">
        <div class="date-tile"><strong>{{ shanghaiParts(upcoming.startUtc).day }}</strong><span>{{ t("{0}月 · {1}", [shanghaiParts(upcoming.startUtc).month, shanghaiParts(upcoming.startUtc).weekday]) }}</span></div>
        <div><p class="eyebrow" style="color:#9ed3ce">NEXT MEETING · {{ timeFormatter.format(new Date(upcoming.startUtc)) }}</p><h2>{{ upcoming.title }}</h2><p>{{ upcoming.summary }} · {{ upcoming.organizer }}</p></div>
        <div class="hero-actions">
          <RouterLink :to="detailLink(upcoming)" class="button secondary"><Eye :size="17" />{{ t("查看详情") }}</RouterLink>
          <a class="button" :href="upcoming.registrationUrl" target="_blank" rel="noopener noreferrer"><ExternalLink :size="17" />{{ t("立即注册") }}</a>
        </div>
      </section>
      <div class="section-title"><h2>{{ t(timeScope === 'history' ? '历史会议' : '后续议程') }}</h2><span class="muted">{{ t("{0} 场", [agendaItems.length]) }}</span></div>
      <div class="agenda">
        <article v-for="item in agendaItems" :key="`${item.eventId}-${item.occurrenceKey}`" class="agenda-item" :class="{ cancelled: item.status === 'cancelled' }">
          <div class="agenda-time">{{ timeFormatter.format(new Date(item.startUtc)) }}<span>{{ formatter.format(new Date(item.startUtc)) }}</span></div>
          <div><h3>{{ item.title }}</h3><p>{{ item.summary }} · {{ item.organizer }}</p></div>
          <div class="agenda-meta"><span class="tag">{{ t(item.category) }}</span><span>{{ t(item.locationType === 'online' ? '线上' : item.locationType === 'offline' ? '线下' : '混合') }}</span><span v-if="item.status === 'cancelled'" class="status cancelled">{{ t("已取消") }}</span><span v-else-if="timeScope === 'history'" class="status ended">{{ t("已结束") }}</span></div>
          <div class="agenda-actions">
            <RouterLink :to="detailLink(item)" class="button secondary"><Eye :size="16" />{{ t("查看详情") }}</RouterLink>
            <template v-if="timeScope === 'history' && regionalAccess">
              <RouterLink v-if="item.hasReplay" :to="replayLink(item)" class="button secondary"><PlayCircle :size="16" />{{ t("查看回放") }}</RouterLink>
              <span v-else class="muted">{{ t("暂无回放") }}</span>
              <RouterLink v-if="session.user?.role === 'member'" :to="replaySubmitLink(item)" class="button"><Upload :size="16" />{{ t("投稿回放") }}</RouterLink>
            </template>
            <a v-else-if="timeScope !== 'history' && item.status !== 'cancelled'" class="button" :href="item.registrationUrl" target="_blank" rel="noopener noreferrer"><ExternalLink :size="16" />{{ t("立即注册") }}</a>
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <div class="section-title">
        <button class="icon-button" type="button" :aria-label="t('上一个月')" :disabled="!canShiftMonth(-1)" @click="shiftMonth(-1)"><ChevronLeft :size="18" /></button>
        <h2>{{ t("{0} 年 {1} 月", [monthCursor.year, monthCursor.month]) }}</h2>
        <button class="icon-button" type="button" :aria-label="t('下一个月')" :disabled="!canShiftMonth(1)" @click="shiftMonth(1)"><ChevronRight :size="18" /></button>
      </div>
      <div class="month-calendar">
        <div class="month-head"><span v-for="day in ['日','一','二','三','四','五','六']" :key="day">{{ t('周' + day) }}</span></div>
        <div class="month-grid">
          <div v-for="day in monthDays" :key="day.key" class="month-day" :class="{ outside: !day.current }">
            <span class="day-number" :class="{ today: day.key === occurrenceDayKey(new Date(nowMs).toISOString()) }">{{ day.date.getUTCDate() }}</span>
            <RouterLink v-for="item in day.events.slice(0,3)" :key="item.occurrenceKey" :to="detailLink(item)" class="calendar-chip" :class="{ historical: timeScope === 'history' }" :title="`${timeFormatter.format(new Date(item.startUtc))} ${item.title}`">{{ timeFormatter.format(new Date(item.startUtc)) }} {{ item.title }}</RouterLink>
          </div>
        </div>
      </div>
    </template>

    <div v-if="submitOpen" class="modal-backdrop" @click.self="closeSubmission">
      <section class="card card-body meeting-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="meeting-submit-title" @keydown.esc="closeSubmission">
        <div class="section-title meeting-submit-dialog-head">
          <div><p class="eyebrow">SUBMIT A MEETING</p><h2 id="meeting-submit-title">{{ t("投稿会议") }}</h2><p class="subtitle">{{ t("提交后由管理员审核，通过后才会出现在会议列表中。") }}</p></div>
          <button class="icon-button" type="button" :aria-label="t('关闭投稿窗口')" @click="closeSubmission"><X :size="19" /></button>
        </div>
        <div v-if="submitSuccess" class="meeting-submit-success">
          <div class="success-box"><strong>{{ t("投稿已进入审核队列。") }}</strong><br />{{ t("可以前往“我的投稿”查看审核结果。") }}</div>
          <div class="inline"><RouterLink class="button" to="/submissions" @click="closeSubmission">{{ t("查看我的投稿") }}</RouterLink><button class="button secondary" type="button" @click="submitSuccess=false">{{ t("继续投稿") }}</button></div>
        </div>
        <template v-else>
          <div v-if="submitError" class="error-box meeting-submit-error">{{ t(submitError) }}</div>
          <MeetingForm :busy="submitBusy" @submit="submitMeeting" />
        </template>
      </section>
    </div>
  </div>
</template>
