<script setup lang="ts">
import { t, dateLocale } from '../i18n'
import { onMounted, ref } from 'vue'
import type { ImportantItem, ReplaySubmission } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import { regionalAccess } from '../state'

type Tab = 'meeting' | 'replay' | 'important'
type Pagination = { page: number; pageSize: number; total: number; totalPages: number }
const tab = ref<Tab>('meeting')
const meetings = ref<any[]>([])
const replays = ref<ReplaySubmission[]>([])
const importantItems = ref<ImportantItem[]>([])
const replayPagination = ref<Pagination>({ page:1, pageSize:20, total:0, totalPages:1 })
const loading = ref(true)
const error = ref('')
const label: Record<string,string> = { pending:'待审核', published:'已发布', rejected:'未通过', cancelled:'已取消', disabled:'已下架' }

onMounted(async () => {
  try {
    const [meetingData, importantData] = await Promise.all([
      api<{ submissions:any[] }>('/v1/submissions/mine'),
      api<{ submissions:ImportantItem[] }>('/v1/important-item-submissions/mine'),
      regionalAccess.value ? loadReplays(1) : Promise.resolve()
    ])
    meetings.value = meetingData.submissions
    importantItems.value = importantData.submissions
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '投稿记录加载失败' }
  finally { loading.value = false }
})

async function loadReplays(page = replayPagination.value.page) {
  try {
    const data = await api<{ submissions:ReplaySubmission[]; pagination:Pagination }>(`/v1/replay-submissions/mine?page=${page}`)
    replays.value = data.submissions
    replayPagination.value = data.pagination
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '回放投稿记录加载失败'
  }
}
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">MY SUBMISSIONS</p><h1>{{ t("我的投稿") }}</h1><p class="subtitle">{{ t("查看当前 WQ_ID 提交的会议、回放来源、重要事项和管理员反馈。") }}</p></div><RouterLink class="button" :to="tab === 'meeting' ? '/?submit=1' : tab === 'replay' ? '/replays/submit' : '/important-items?submit=1'">{{ t(tab === 'meeting' ? '提交新会议' : tab === 'replay' ? '投稿新回放' : '投稿重要事项') }}</RouterLink></div>
  <div class="segmented submission-switch"><button :class="{active:tab==='meeting'}" @click="tab='meeting'">{{ t("会议投稿") }}</button><button v-if="regionalAccess" :class="{active:tab==='replay'}" @click="tab='replay'">{{ t("回放投稿") }}</button><button :class="{active:tab==='important'}" @click="tab='important'">{{ t("重要事项投稿") }}</button></div>
  <div v-if="error" class="error-box">{{ t(error) }}</div>
  <div v-else-if="loading" class="empty-state">{{ t("正在加载投稿记录…") }}</div>
  <template v-else-if="tab==='meeting'">
    <div v-if="!meetings.length" class="empty-state">{{ t("还没有提交过会议。") }}</div>
    <div v-else class="agenda"><div v-for="item in meetings" :key="item.id" class="agenda-item"><div><span class="status" :class="item.status">{{ t(label[item.status] || item.status) }}</span></div><div><h3>{{ item.title }}</h3><p>{{ item.summary }} · {{ new Date(item.createdAt).toLocaleDateString(dateLocale) }}</p><p v-if="item.reviewNote" class="review-note">{{ t("管理员反馈：{0}", [item.reviewNote]) }}</p></div><RouterLink v-if="item.status === 'published'" class="button secondary small" :to="`/meetings/${item.id}`">{{ t("查看") }}</RouterLink></div></div>
  </template>
  <template v-else-if="tab==='replay'">
    <div v-if="!replays.length" class="empty-state">{{ t("还没有提交过回放。") }}</div>
    <div v-else class="agenda"><div v-for="item in replays" :key="item.id" class="agenda-item replay-submission-item"><div><span class="status" :class="item.status">{{ t(label[item.status] || item.status) }}</span></div><div><h3>{{ item.title }}</h3><p>{{ item.meetingDate }} · {{ t(item.providerLabel) }}</p><p v-if="item.note" class="muted">{{ item.note }}</p><p v-if="item.reviewNote" class="review-note">{{ t("管理员反馈：{0}", [item.reviewNote]) }}</p></div><a v-if="item.status === 'published'" class="button secondary small" :href="item.shareUrl" target="_blank" rel="noopener noreferrer">{{ t("打开") }}</a></div></div>
    <div v-if="replays.length" class="pagination-bar"><span class="fine-print">{{ t("第 {0} / {1} 页，共 {2} 条", [replayPagination.page, replayPagination.totalPages, replayPagination.total]) }}</span><div class="inline"><button class="button secondary small" :disabled="replayPagination.page<=1" @click="loadReplays(replayPagination.page-1)">{{ t("上一页") }}</button><button class="button secondary small" :disabled="replayPagination.page>=replayPagination.totalPages" @click="loadReplays(replayPagination.page+1)">{{ t("下一页") }}</button></div></div>
  </template>
  <template v-else>
    <div v-if="!importantItems.length" class="empty-state">{{ t("还没有提交过重要事项。") }}</div>
    <div v-else class="agenda"><div v-for="item in importantItems" :key="item.id" class="agenda-item"><div><span class="status" :class="item.status">{{ t(label[item.status] || item.status) }}</span></div><div><h3>{{ item.title }}</h3><p>{{ t(item.kind === 'ppa' ? 'PPA 主题' : '比赛主题') }} · {{ item.startDate }}—{{ item.endDate }}</p><p v-if="item.reviewNote" class="review-note">{{ t("管理员反馈：{0}", [item.reviewNote]) }}</p></div><RouterLink v-if="item.status === 'published'" class="button secondary small" to="/important-items">{{ t("查看") }}</RouterLink></div></div>
  </template>
</template>
