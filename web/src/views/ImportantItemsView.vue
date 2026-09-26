<script setup lang="ts">
import { t, dateLocale } from '../i18n'
import { computed, nextTick, onMounted, ref } from 'vue'
import { Calendar, ChevronLeft, ChevronRight, List, Plus, Search, X } from 'lucide-vue-next'
import type { ImportantItem, ImportantItemInput, ImportantItemKind } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import { session } from '../state'
import ImportantItemForm from '../components/ImportantItemForm.vue'
import MarkdownContent from '../components/MarkdownContent.vue'

type MonthCursor = { year: number; month: number }
type CalendarEntry = { key: string; label: string; item: ImportantItem; variant: 'range' | 'announcement' | 'payment' }

const items = ref<ImportantItem[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
const kind = ref<ImportantItemKind | ''>('')
const view = ref<'timeline' | 'month'>('timeline')
const monthCursor = ref<MonthCursor>(currentBeijingMonth())
const submitOpen = ref(session.user?.role === 'member' && new URLSearchParams(window.location.hash.split('?')[1] || '').get('submit') === '1')
const submitBusy = ref(false)
const submitError = ref('')
const submitSuccess = ref(false)

const KIND_LABELS: Record<ImportantItemKind, string> = { ppa: 'PPA 主题', competition: '比赛主题', bonus: '奖金日程' }

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items: ImportantItem[] }>('/v1/important-items')
    items.value = data.items
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '重要事项加载失败' }
  finally { loading.value = false }
}

function beijingToday() {
  const parts = new Intl.DateTimeFormat('en', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function currentBeijingMonth(): MonthCursor {
  const [year, month] = beijingToday().split('-').map(Number)
  return { year: year!, month: month! }
}

function dateMs(value: string) { return Date.parse(`${value}T00:00:00Z`) }
function formatDate(value: string) { return new Intl.DateTimeFormat(dateLocale.value, { year:'numeric', month:'long', day:'numeric', timeZone:'UTC' }).format(new Date(dateMs(value))) }
function dateRange(item: ImportantItem) { return item.startDate === item.endDate ? formatDate(item.startDate) : `${formatDate(item.startDate)}—${formatDate(item.endDate)}` }

function statusLabel(item: ImportantItem) {
  if (item.status === 'cancelled') return '已取消'
  const today = beijingToday()
  if (item.kind === 'bonus') {
    const dates = [item.announcementDate, item.paymentDate].filter((date): date is string => Boolean(date))
    if (!dates.length) return '日期待定'
    if (dates.includes(today)) return '进行中'
    if (dates.some((date) => date > today)) return '即将到来'
    return '已结束'
  }
  if (item.startDate <= today && item.endDate >= today) return '进行中'
  if (item.startDate > today) return '即将开始'
  return '已结束'
}

function sortKey(item: ImportantItem) {
  const today = beijingToday()
  if (item.kind === 'bonus') {
    const dates = [item.announcementDate, item.paymentDate].filter((date): date is string => Boolean(date)).sort()
    if (dates.includes(today)) return { tier: 0, value: today }
    const futureDates = dates.filter((date) => date > today)
    if (futureDates.length) return { tier: 1, value: futureDates[0]! }
    if (dates.length) return { tier: 2, value: dates.at(-1)! }
    return { tier: 3, value: item.updatedAt }
  }
  if (item.startDate <= today && item.endDate >= today) return { tier: 0, value: item.endDate }
  const futureDates = [item.startDate].filter((date) => date >= today).sort()
  if (futureDates.length) return { tier: 1, value: futureDates[0]! }
  return { tier: 2, value: item.endDate }
}

const filtered = computed(() => items.value.filter((item) => {
  const text = `${item.title} ${item.contentMarkdown}`.toLowerCase()
  return (!kind.value || item.kind === kind.value) && (!query.value || text.includes(query.value.toLowerCase()))
}))

const timelineItems = computed(() => [...filtered.value].sort((left, right) => {
  const a = sortKey(left)
  const b = sortKey(right)
  if (a.tier !== b.tier) return a.tier - b.tier
  return a.tier === 2 ? b.value.localeCompare(a.value) : a.value.localeCompare(b.value)
}))

function dayKey(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}` }

function entriesForDay(key: string): CalendarEntry[] {
  const entries: CalendarEntry[] = []
  for (const item of filtered.value) {
    if (item.kind !== 'bonus' && key >= item.startDate && key <= item.endDate) entries.push({ key:`${item.id}-range`, label:item.title, item, variant:'range' })
    if (item.kind === 'bonus' && item.announcementDate === key) entries.push({ key:`${item.id}-announcement`, label:t('公布 · {0}', [item.title]), item, variant:'announcement' })
    if (item.kind === 'bonus' && item.paymentDate === key) entries.push({ key:`${item.id}-payment`, label:t('账单 · {0}', [item.title]), item, variant:'payment' })
  }
  return entries
}

const monthDays = computed(() => {
  const { year, month } = monthCursor.value
  const first = new Date(Date.UTC(year, month - 1, 1))
  const gridStart = new Date(Date.UTC(year, month - 1, 1 - first.getUTCDay()))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setUTCDate(gridStart.getUTCDate() + index)
    const key = dayKey(date)
    return { date, key, current:date.getUTCMonth() + 1 === month, entries:entriesForDay(key) }
  })
})

function shiftMonth(delta: number) {
  const date = new Date(Date.UTC(monthCursor.value.year, monthCursor.value.month - 1 + delta, 1))
  monthCursor.value = { year:date.getUTCFullYear(), month:date.getUTCMonth() + 1 }
}

async function focusItem(id: string) {
  view.value = 'timeline'
  await nextTick()
  document.getElementById(`important-item-${id}`)?.scrollIntoView({ behavior:'smooth', block:'center' })
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

async function submitItem(item: ImportantItemInput) {
  submitBusy.value = true
  submitError.value = ''
  try {
    await api('/v1/important-item-submissions', { method:'POST', body:JSON.stringify(item) })
    submitSuccess.value = true
  } catch (caught) { submitError.value = caught instanceof ApiError ? caught.message : '投稿失败' }
  finally { submitBusy.value = false }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><p class="eyebrow">IMPORTANT TIMELINE</p><h1>{{ t("重要事项") }}</h1><p class="subtitle">{{ t("集中查看 PPA 主题、比赛安排与奖金关键日期；所有日期均为北京时间。") }}</p></div>
      <div class="calendar-page-actions">
        <button v-if="session.user?.role === 'member'" class="button" type="button" @click="openSubmission"><Plus :size="17" />{{ t("投稿重要事项") }}</button>
        <div class="segmented" :aria-label="t('切换重要事项视图')"><button type="button" :class="{ active:view === 'timeline' }" @click="view='timeline'"><List :size="16" />{{ t("时间线") }}</button><button type="button" :class="{ active:view === 'month' }" @click="view='month'"><Calendar :size="16" />{{ t("月历") }}</button></div>
      </div>
    </div>

    <div class="filters important-filters">
      <label class="important-search"><Search :size="17" /><input v-model="query" :placeholder="t('搜索主题或内容')" /></label>
      <select v-model="kind"><option value="">{{ t("全部类别") }}</option><option value="ppa">{{ t("PPA 主题") }}</option><option value="competition">{{ t("比赛主题") }}</option><option value="bonus">{{ t("奖金日程") }}</option></select>
      <button class="button secondary small" type="button" @click="query='';kind=''">{{ t("清除") }}</button>
    </div>

    <div v-if="error" class="error-box">{{ t(error) }}</div>
    <div v-else-if="loading" class="empty-state">{{ t("正在整理重要事项…") }}</div>
    <div v-else-if="!filtered.length" class="empty-state"><div><h2>{{ t("暂时没有匹配的重要事项") }}</h2><p>{{ t("可以调整筛选条件，成员也可以提交 PPA 或比赛主题等待审核。") }}</p></div></div>

    <div v-else-if="view === 'timeline'" class="important-timeline">
      <article v-for="item in timelineItems" :id="`important-item-${item.id}`" :key="item.id" class="card important-card" :class="[`kind-${item.kind}`, { cancelled:item.status === 'cancelled' }]">
        <div class="important-card-head">
          <div><div class="inline"><span class="tag">{{ t(KIND_LABELS[item.kind]) }}</span><span class="status" :class="item.status === 'cancelled' ? 'cancelled' : statusLabel(item) === '进行中' ? 'published' : statusLabel(item) === '已结束' ? 'ended' : 'pending'">{{ t(statusLabel(item)) }}</span></div><h2>{{ item.title }}</h2></div>
          <div class="important-date"><strong>{{ t(item.kind === 'bonus' ? '适用周期' : '持续时间') }}</strong><span>{{ dateRange(item) }}</span></div>
        </div>
        <MarkdownContent v-if="item.contentMarkdown" :content="item.contentMarkdown" />
        <div v-if="item.kind === 'bonus'" class="bonus-dates">
          <div><span>{{ t("公布日期") }}</span><strong>{{ t(item.announcementDate ? formatDate(item.announcementDate) : '待确定') }}</strong></div>
          <div><span>{{ t("账单日期") }}</span><strong>{{ t(item.paymentDate ? formatDate(item.paymentDate) : '待确定') }}</strong></div>
        </div>
      </article>
    </div>

    <template v-else>
      <div class="section-title important-month-title"><button class="icon-button" type="button" :aria-label="t('上一个月')" @click="shiftMonth(-1)"><ChevronLeft :size="18" /></button><h2>{{ t("{0} 年 {1} 月", [monthCursor.year, monthCursor.month]) }}</h2><button class="icon-button" type="button" :aria-label="t('下一个月')" @click="shiftMonth(1)"><ChevronRight :size="18" /></button></div>
      <div class="month-calendar important-month">
        <div class="month-head"><span v-for="day in ['日','一','二','三','四','五','六']" :key="day">{{ t('周' + day) }}</span></div>
        <div class="month-grid">
          <div v-for="day in monthDays" :key="day.key" class="month-day" :class="{ outside:!day.current }">
            <span class="day-number" :class="{ today:day.key === beijingToday() }">{{ day.date.getUTCDate() }}</span>
            <button v-for="entry in day.entries.slice(0,4)" :key="entry.key" type="button" class="calendar-chip important-chip" :class="[`kind-${entry.item.kind}`, entry.variant, { cancelled:entry.item.status === 'cancelled' }]" :title="entry.label" @click="focusItem(entry.item.id)">{{ t(entry.label) }}</button>
            <span v-if="day.entries.length > 4" class="more-items">{{ t("另有 {0} 项", [day.entries.length - 4]) }}</span>
          </div>
        </div>
      </div>
    </template>

    <div v-if="submitOpen" class="modal-backdrop" @click.self="closeSubmission">
      <section class="card card-body important-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="important-submit-title" @keydown.esc="closeSubmission">
        <div class="section-title"><div><p class="eyebrow">SUBMIT AN ITEM</p><h2 id="important-submit-title">{{ t("投稿重要事项") }}</h2><p class="subtitle">{{ t("成员可以投稿 PPA 或比赛主题，通过审核后才会公开。") }}</p></div><button class="icon-button" type="button" :aria-label="t('关闭投稿窗口')" @click="closeSubmission"><X :size="19" /></button></div>
        <div v-if="submitSuccess" class="stack"><div class="success-box"><strong>{{ t("投稿已进入审核队列。") }}</strong><br />{{ t("可以在“我的投稿”中查看结果。") }}</div><div class="inline"><RouterLink class="button" to="/submissions" @click="closeSubmission">{{ t("查看我的投稿") }}</RouterLink><button class="button secondary" type="button" @click="submitSuccess=false">{{ t("继续投稿") }}</button></div></div>
        <template v-else><div v-if="submitError" class="error-box">{{ t(submitError) }}</div><ImportantItemForm :busy="submitBusy" @submit="submitItem" /></template>
      </section>
    </div>
  </div>
</template>
