<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, ref } from 'vue'
import { Award, Trophy } from 'lucide-vue-next'
import type { LeaderboardEntry, ReplayLeaderboardEntry } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import { session } from '../state'

type Kind = 'meeting' | 'replay' | 'important'
type LeaderboardSummary = { contributorCount:number; submissionCount:number; approvedCount:number; approvalRate:number; contributedMeetingCount?:number }
type Pagination = { page:number; pageSize:number; total:number; totalPages:number }

const kind = ref<Kind>('meeting')
const entries = ref<Array<LeaderboardEntry | ReplayLeaderboardEntry>>([])
const summary = ref<LeaderboardSummary>({ contributorCount:0, submissionCount:0, approvedCount:0, approvalRate:0 })
const pagination = ref<Pagination>({ page:1, pageSize:50, total:0, totalPages:1 })
const pageSize = ref(50)
const loading = ref(true)
const error = ref('')
const podium = computed(() => pagination.value.page === 1 ? entries.value.slice(0, 3) : [])

onMounted(() => load(1))

async function switchKind(next: Kind) {
  if (kind.value === next) return
  kind.value = next
  await load(1)
}

async function load(page = pagination.value.page) {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ summary:LeaderboardSummary; pagination:Pagination; entries:Array<LeaderboardEntry | ReplayLeaderboardEntry> }>(`/v1/leaderboard?kind=${kind.value}&page=${page}&pageSize=${pageSize.value}`)
    summary.value = data.summary
    pagination.value = data.pagination
    entries.value = data.entries
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '排行榜加载失败' }
  finally { loading.value = false }
}

function replayContribution(entry: LeaderboardEntry | ReplayLeaderboardEntry) {
  return 'contributedMeetingCount' in entry ? entry.contributedMeetingCount : 0
}

function submissionLabel() {
  if (kind.value === 'meeting') return '会议投稿'
  if (kind.value === 'important') return '事项投稿'
  return '投稿链接'
}

function approvedLabel() {
  if (kind.value === 'meeting') return '通过会议'
  if (kind.value === 'important') return '通过事项'
  return '通过链接'
}

function rankingTitle() {
  if (kind.value === 'meeting') return '会议投稿排行榜'
  if (kind.value === 'important') return '重要事项投稿排行榜'
  return '回放贡献排行榜'
}
</script>

<template>
  <div class="segmented leaderboard-switch" :aria-label="t('切换排行榜')"><button :class="{active:kind==='meeting'}" @click="switchKind('meeting')">{{ t("会议榜") }}</button><button :class="{active:kind==='replay'}" @click="switchKind('replay')">{{ t("回放榜") }}</button><button :class="{active:kind==='important'}" @click="switchKind('important')">{{ t("重要事项榜") }}</button></div>
  <div v-if="session.user?.role === 'member' && session.user.publicWqId" class="notice-box identity-notice">{{ t("排行榜当前显示你的完整 WQ_ID。") }}<RouterLink to="/calendar-settings">{{ t("可在设置中隐藏") }}</RouterLink></div>
  <div v-if="error" class="error-box">{{ t(error) }}</div>
  <div v-else-if="loading" class="empty-state">{{ t("正在统计成员投稿…") }}</div>
  <div v-else class="stack">
    <div class="metric-grid leaderboard-metrics">
      <div class="card metric-card"><span>{{ t("投稿成员") }}</span><strong>{{ summary.contributorCount }}</strong></div>
      <div class="card metric-card"><span>{{ t(submissionLabel()) }}</span><strong>{{ summary.submissionCount }}</strong></div>
      <div class="card metric-card"><span>{{ t(approvedLabel()) }}</span><strong>{{ summary.approvedCount }}</strong></div>
      <div class="card metric-card"><span>{{ t(kind === 'replay' ? '贡献会议' : '整体通过率') }}</span><strong>{{ kind === 'replay' ? (summary.contributedMeetingCount || 0) : `${summary.approvalRate}%` }}</strong></div>
    </div>

    <div v-if="podium.length" class="leaderboard-podium">
      <article v-for="entry in podium" :key="entry.memberId" class="card podium-card" :class="[`place-${entry.rank}`, { 'is-current':entry.isCurrentUser }]">
        <div class="podium-rank"><Trophy v-if="entry.rank === 1" :size="24" /><Award v-else :size="22" />{{ t("第 {0} 名", [entry.rank]) }}</div>
        <strong>{{ entry.wqId }}<span v-if="entry.isCurrentUser" class="tag">{{ t("我") }}</span></strong>
        <span>{{ entry.country }} · {{ t(kind === 'replay' ? `投稿 ${entry.submissionCount} 个链接` : `投稿 ${entry.submissionCount} 次`) }}</span>
        <b>{{ t(kind === 'replay' ? `贡献 ${replayContribution(entry)} 场会议` : `通过 ${entry.approvedCount} 次`) }}</b>
      </article>
    </div>

    <div class="card card-body">
      <div class="section-title leaderboard-head"><div><h2>{{ t(rankingTitle()) }}</h2><p class="fine-print">{{ t(kind === 'replay' ? '按贡献会议数、通过链接数、投稿链接数依次排序；同一成员同场会议最多计 1 次贡献。' : `按通过次数排序，其次按投稿次数排序；${t(kind === 'meeting' ? '会议取消' : '事项取消')}后仍保留历史通过记录。`) }}</p></div><select v-model.number="pageSize" :aria-label="t('排行榜每页数量')" @change="load(1)"><option :value="25">{{ t("每页 25 名") }}</option><option :value="50">{{ t("每页 50 名") }}</option><option :value="100">{{ t("每页 100 名") }}</option></select></div>
      <table class="data-table leaderboard-table"><thead><tr><th>{{ t("排名") }}</th><th>WQ_ID</th><th>{{ t("地区") }}</th><th>{{ t(kind === 'replay' ? '投稿链接' : '投稿次数') }}</th><th>{{ t(kind === 'replay' ? '通过链接' : '通过次数') }}</th><th v-if="kind==='replay'">{{ t("贡献会议") }}</th><th>{{ t("通过率") }}</th></tr></thead><tbody><tr v-for="entry in entries" :key="entry.memberId" :class="{ 'current-user-row':entry.isCurrentUser }"><td><strong class="rank-number">{{ entry.rank }}</strong></td><td><strong>{{ entry.wqId }}</strong><span v-if="entry.isCurrentUser" class="tag">{{ t("我") }}</span><br><span v-if="!entry.hasFullWqId" class="fine-print">{{ t("已隐藏完整 ID") }}</span></td><td>{{ entry.country }}</td><td>{{ entry.submissionCount }}</td><td><strong>{{ entry.approvedCount }}</strong></td><td v-if="kind==='replay'"><strong>{{ replayContribution(entry) }}</strong></td><td>{{ entry.approvalRate }}%</td></tr></tbody></table>
      <div v-if="!entries.length" class="empty-state">{{ t("目前还没有{0}投稿。", [t(kind === 'meeting' ? '会议' : kind === 'important' ? '重要事项' : '回放')]) }}</div>
      <div v-else class="pagination-bar"><span class="fine-print">{{ t("第 {0}–{1} 名，共 {2} 名", [(pagination.page - 1) * pagination.pageSize + 1, Math.min(pagination.page * pagination.pageSize, pagination.total), pagination.total]) }}</span><div class="inline"><button class="button secondary small" :disabled="pagination.page <= 1 || loading" @click="load(pagination.page - 1)">{{ t("上一页") }}</button><button class="button secondary small" :disabled="pagination.page >= pagination.totalPages || loading" @click="load(pagination.page + 1)">{{ t("下一页") }}</button></div></div>
    </div>
  </div>
</template>
