<script setup lang="ts">
import { t, dateLocale } from '../i18n'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { AlertTriangle, Check, Copy, ExternalLink, Plus, Search } from 'lucide-vue-next'
import type { ReplayGroup, ReplayProvider } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import { session } from '../state'

type Pagination = { page: number; pageSize: number; total: number; totalPages: number }

const route = useRoute()
const groups = ref<ReplayGroup[]>([])
const pagination = ref<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
const loading = ref(true)
const error = ref('')
const notice = ref('')
const query = ref('')
const provider = ref<ReplayProvider | ''>('')
const from = ref('')
const to = ref('')
const copiedLinkId = ref('')
const reportingLinkId = ref('')
const reportReason = ref<'unavailable' | 'invalid_code' | 'content_mismatch' | 'other'>('unavailable')
const reportNote = ref('')
const linkedEventId = computed(() => typeof route.query.eventId === 'string' ? route.query.eventId : '')
const linkedOccurrenceKey = computed(() => typeof route.query.occurrenceKey === 'string' ? route.query.occurrenceKey : '')
const hasOccurrenceFilter = computed(() => Boolean(linkedEventId.value && linkedOccurrenceKey.value))
const replaySubmitTarget = computed(() => hasOccurrenceFilter.value
  ? { path:'/replays/submit', query:{ eventId:linkedEventId.value, occurrenceKey:linkedOccurrenceKey.value } }
  : '/replays/submit')

onMounted(() => load(1))

async function load(page = pagination.value.page) {
  loading.value = true
  error.value = ''
  const params = new URLSearchParams({ page: String(page) })
  if (query.value.trim()) params.set('q', query.value.trim())
  if (provider.value) params.set('provider', provider.value)
  if (from.value) params.set('from', from.value)
  if (to.value) params.set('to', to.value)
  if (linkedEventId.value) params.set('eventId', linkedEventId.value)
  if (linkedOccurrenceKey.value) params.set('occurrenceKey', linkedOccurrenceKey.value)
  try {
    const data = await api<{ groups: ReplayGroup[]; pagination: Pagination }>(`/v1/replays?${params}`)
    groups.value = data.groups
    pagination.value = data.pagination
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '回放加载失败' }
  finally { loading.value = false }
}

function clearFilters() {
  query.value = ''
  provider.value = ''
  from.value = ''
  to.value = ''
  void load(1)
}

async function copyCode(linkId: string, code: string) {
  await navigator.clipboard.writeText(code)
  copiedLinkId.value = linkId
  setTimeout(() => { if (copiedLinkId.value === linkId) copiedLinkId.value = '' }, 1600)
}

function openReport(linkId: string) {
  reportingLinkId.value = linkId
  reportReason.value = 'unavailable'
  reportNote.value = ''
}

async function submitReport() {
  if (!reportingLinkId.value) return
  error.value = ''
  try {
    await api(`/v1/replay-links/${reportingLinkId.value}/reports`, {
      method: 'POST', body: JSON.stringify({ reason: reportReason.value, note: reportNote.value })
    })
    notice.value = '反馈已提交，管理员确认前链接仍会保留。'
    reportingLinkId.value = ''
    await load()
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '反馈提交失败' }
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat(dateLocale.value, { dateStyle: 'long', timeZone: 'Asia/Shanghai' }).format(new Date(`${value}T00:00:00+08:00`))
}
</script>

<template>
  <div class="page-head">
    <div><p class="eyebrow">MEETING REPLAYS</p><h1>{{ t(hasOccurrenceFilter ? '场次回放' : '会议回放') }}</h1><p class="subtitle">{{ t(hasOccurrenceFilter ? '仅显示与所选会议场次精确关联的已审核回放。' : '同一场会议可以收录多个网盘来源。所有链接均由成员投稿并经管理员审核。') }}</p></div>
    <div v-if="session.user?.role === 'member'" class="inline"><RouterLink class="button secondary" to="/submissions">{{ t("我的投稿") }}</RouterLink><RouterLink class="button" :to="replaySubmitTarget"><Plus :size="17" />{{ t("投稿回放") }}</RouterLink></div>
  </div>

  <div v-if="session.user?.role === 'member' && session.user.publicWqId" class="notice-box identity-notice">{{ t("你的完整 WQ_ID 会显示在回放来源和排行榜中。") }}<RouterLink to="/calendar-settings">{{ t("前往设置隐藏") }}</RouterLink></div>
  <div v-if="error" class="error-box replay-message">{{ t(error) }}</div>
  <div v-if="notice" class="success-box replay-message">{{ t(notice) }}</div>

  <div class="replay-filters">
    <label class="replay-search"><Search :size="17" /><input v-model="query" :placeholder="t('搜索会议标题')" @keyup.enter="load(1)" /></label>
    <select v-model="provider" :aria-label="t('筛选网盘来源')"><option value="">{{ t("全部来源") }}</option><option value="baidu">{{ t("百度网盘") }}</option><option value="quark">{{ t("夸克网盘") }}</option><option value="aliyun">{{ t("阿里云盘") }}</option><option value="onedrive">OneDrive</option><option value="google_drive">Google Drive</option><option value="dropbox">Dropbox</option><option value="weiyun">{{ t("腾讯微云") }}</option><option value="other">{{ t("其他来源") }}</option></select>
    <input v-model="from" type="date" :aria-label="t('开始日期')" />
    <input v-model="to" type="date" :aria-label="t('结束日期')" />
    <button class="button small" @click="load(1)">{{ t("筛选") }}</button><button class="button secondary small" @click="clearFilters">{{ t("清除") }}</button>
  </div>

  <div v-if="loading" class="empty-state">{{ t("正在整理会议回放…") }}</div>
  <div v-else-if="!groups.length" class="empty-state"><div><h2>{{ t(hasOccurrenceFilter ? '该场会议暂时没有回放' : '暂时没有匹配的回放') }}</h2><p>{{ t("可以投稿第一个来源，等待管理员审核。") }}</p><RouterLink v-if="hasOccurrenceFilter && session.user?.role === 'member'" class="button" style="margin-top:12px" :to="replaySubmitTarget"><Plus :size="16" />{{ t("为该场会议投稿回放") }}</RouterLink></div></div>
  <div v-else class="replay-grid">
    <article v-for="group in groups" :key="group.id" class="card replay-card">
      <header class="replay-card-head">
        <div><span class="tag">{{ displayDate(group.meetingDate) }}</span><h2>{{ group.title }}</h2><RouterLink v-if="group.eventId" class="fine-print replay-meeting-link" :to="`/meetings/${group.eventId}`">{{ t("查看原会议") }}</RouterLink></div>
        <span class="replay-source-count">{{ t("{0} 个来源", [group.links.length]) }}</span>
      </header>
      <div class="replay-sources">
        <section v-for="link in group.links" :key="link.id" class="replay-source">
          <div class="replay-source-main"><div class="inline"><strong>{{ t(link.providerLabel) }}</strong><span class="fine-print">{{ t("贡献者：{0}", [link.contributorWqId]) }}</span></div><p v-if="link.note">{{ link.note }}</p><span v-if="link.openReportCount" class="report-count"><AlertTriangle :size="14" />{{ t("已有 {0} 人反馈", [link.openReportCount]) }}</span></div>
          <div v-if="link.accessCode" class="access-code"><span>{{ t("提取码") }}</span><strong>{{ link.accessCode }}</strong><button class="icon-button" :aria-label="t('复制 {0} 提取码', [t(link.providerLabel)])" @click="copyCode(link.id, link.accessCode)"><Check v-if="copiedLinkId === link.id" :size="16" /><Copy v-else :size="16" /></button></div>
          <div class="replay-source-actions"><a class="button small" :href="link.shareUrl" target="_blank" rel="noopener noreferrer"><ExternalLink :size="15" />{{ t("打开回放") }}</a><button v-if="session.user?.role === 'member'" class="button secondary small" :disabled="link.reportedByMe" @click="openReport(link.id)">{{ t(link.reportedByMe ? '已反馈' : '反馈失效') }}</button></div>
        </section>
      </div>
      <footer v-if="session.user?.role === 'member'" class="replay-card-foot"><RouterLink class="button secondary small" :to="{ path:'/replays/submit', query:{ group:group.id } }"><Plus :size="15" />{{ t("补充回放来源") }}</RouterLink></footer>
    </article>
  </div>

  <div v-if="groups.length" class="pagination-bar"><span class="fine-print">{{ t("第 {0}–{1} 场，共 {2} 场", [(pagination.page - 1) * pagination.pageSize + 1, Math.min(pagination.page * pagination.pageSize, pagination.total), pagination.total]) }}</span><div class="inline"><button class="button secondary small" :disabled="pagination.page <= 1 || loading" @click="load(pagination.page - 1)">{{ t("上一页") }}</button><button class="button secondary small" :disabled="pagination.page >= pagination.totalPages || loading" @click="load(pagination.page + 1)">{{ t("下一页") }}</button></div></div>

  <div v-if="reportingLinkId" class="modal-backdrop" @click.self="reportingLinkId=''">
    <section class="card card-body report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <h2 id="report-title">{{ t("反馈回放问题") }}</h2><p class="fine-print">{{ t("反馈不会自动下架链接，管理员确认后再处理。") }}</p>
      <div class="field"><label for="report-reason">{{ t("问题类型") }}</label><select id="report-reason" v-model="reportReason"><option value="unavailable">{{ t("链接无法访问") }}</option><option value="invalid_code">{{ t("提取码无效") }}</option><option value="content_mismatch">{{ t("内容与会议不符") }}</option><option value="other">{{ t("其他问题") }}</option></select></div>
      <div class="field"><label for="report-note">{{ t("补充说明（可选）") }}</label><textarea id="report-note" v-model="reportNote" maxlength="300" /></div>
      <div class="inline"><button class="button" @click="submitReport">{{ t("提交反馈") }}</button><button class="button secondary" @click="reportingLinkId=''">{{ t("取消") }}</button></div>
    </section>
  </div>
</template>
