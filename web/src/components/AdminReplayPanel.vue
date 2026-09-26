<script setup lang="ts">
import { t, dateLocale } from '../i18n'
import { onMounted, reactive, ref } from 'vue'
import { ExternalLink, Plus, RefreshCw } from 'lucide-vue-next'
import { api, ApiError } from '../api'

type Filter = 'pending' | 'published' | 'disabled' | 'rejected' | 'reports'
type Entry = {
  id:string; groupId:string; eventId:string|null; occurrenceKey:string|null; title:string; meetingDate:string
  provider:string; providerLabel:string; shareUrl:string; accessCode:string; note:string; status:string
  reviewNote:string; contributorWqId:string; openReportCount:number; latestReportReason:string|null; latestReportNote:string|null
  createdAt:string; approvedAt:string|null
}
type Pagination = { page:number; pageSize:number; total:number; totalPages:number }
type Draft = { title:string; meetingDate:string; shareUrl:string; accessCode:string; note:string; targetGroupId:string }

const props = withDefaults(defineProps<{ pendingOnly?: boolean }>(), { pendingOnly:false })
const emit = defineEmits<{ pendingCount:[count:number] }>()

const filter = ref<Filter>(props.pendingOnly ? 'pending' : 'published')
const entries = ref<Entry[]>([])
const pagination = ref<Pagination>({ page:1, pageSize:25, total:0, totalPages:1 })
const pageSize = ref(25)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const reviewNotes = reactive<Record<string,string>>({})
const drafts = reactive<Record<string,Draft>>({})
const createOpen = ref(false)
const createForm = reactive({ title:'', meetingDate:'', shareUrl:'', accessCode:'', note:'' })
const mergeSourceId = ref('')
const mergeTargetId = ref('')

const reasonLabels: Record<string,string> = { unavailable:'链接无法访问', invalid_code:'提取码无效', content_mismatch:'内容不符', other:'其他问题' }

onMounted(() => load(1))

async function load(page = pagination.value.page) {
  loading.value = true; error.value = ''
  try {
    const data = await api<{ entries:Entry[]; pagination:Pagination }>(`/v1/admin/replays?filter=${filter.value}&page=${page}&pageSize=${pageSize.value}`)
    entries.value = data.entries
    pagination.value = data.pagination
    if (filter.value === 'pending') emit('pendingCount', data.pagination.total)
    for (const item of data.entries) {
      drafts[item.id] = { title:item.title, meetingDate:item.meetingDate, shareUrl:item.shareUrl, accessCode:item.accessCode, note:item.note, targetGroupId:'' }
      reviewNotes[item.id] = item.reviewNote || ''
    }
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '回放管理数据加载失败' }
  finally { loading.value = false }
}

async function switchFilter(next: Filter) { filter.value = next; await load(1) }

async function decide(id:string, decision:'publish'|'reject') {
  if (!confirm(t(decision === 'publish' ? '确定通过并发布这条回放吗？' : '确定拒绝这条回放吗？'))) return
  try { await api(`/v1/admin/replay-links/${id}/decision`, { method:'POST', body:JSON.stringify({ decision, reviewNote:reviewNotes[id] || '' }) }); notice.value = decision === 'publish' ? '回放已发布。' : '回放已拒绝。'; await load() }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '审批失败' }
}

async function save(item:Entry) {
  const draft = drafts[item.id]
  if (!draft) return
  try { await api(`/v1/admin/replay-links/${item.id}`, { method:'PATCH', body:JSON.stringify({ ...draft, targetGroupId:draft.targetGroupId || null }) }); notice.value = '回放信息已更新。'; await load() }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '保存失败' }
}

async function changeState(item:Entry, action:'disable'|'restore') {
  if (action === 'disable' && !confirm(t('下架后该来源将不再向成员显示，确定继续吗？'))) return
  try { await api(`/v1/admin/replay-links/${item.id}/${action}`, { method:'POST', body:'{}' }); notice.value = action === 'disable' ? '来源已下架。' : '来源已恢复。'; await load() }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '状态修改失败' }
}

async function resolveReports(id:string, resolution:'resolved'|'dismissed') {
  try { await api(`/v1/admin/replay-links/${id}/reports/resolve`, { method:'POST', body:JSON.stringify({ resolution }) }); notice.value = resolution === 'resolved' ? '反馈已解决。' : '反馈已忽略。'; await load() }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '反馈处理失败' }
}

async function createReplay() {
  try {
    await api('/v1/admin/replays', { method:'POST', body:JSON.stringify({ groupId:null, eventId:null, occurrenceKey:null, ...createForm }) })
    notice.value = '管理员回放已直接发布。'; createOpen.value = false
    Object.assign(createForm, { title:'', meetingDate:'', shareUrl:'', accessCode:'', note:'' })
    filter.value = 'published'; await load(1)
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '回放创建失败' }
}

async function mergeGroups() {
  if (!mergeSourceId.value || !mergeTargetId.value) { error.value = '请填写来源会议卡片 ID 和目标会议卡片 ID'; return }
  if (!confirm(t('合并后，来源卡片的全部回放链接会移动到目标卡片。确定继续吗？'))) return
  try { await api(`/v1/admin/replay-groups/${mergeSourceId.value}/merge`, { method:'POST', body:JSON.stringify({ targetGroupId:mergeTargetId.value }) }); notice.value = '回放会议卡片已合并。'; mergeSourceId.value=''; mergeTargetId.value=''; await load() }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '合并失败' }
}
</script>

<template>
  <div class="stack" :class="{ 'admin-replay-pending-embed': pendingOnly }">
    <div v-if="error" class="error-box">{{ t(error) }}</div><div v-if="notice" class="success-box">{{ t(notice) }}</div>
    <template v-if="!pendingOnly">
      <div class="section-title"><div><h2>{{ t("回放管理") }}</h2><p class="fine-print">{{ t("维护已发布来源、处理失效反馈，或由管理员直接发布回放。") }}</p></div><div class="inline"><button class="button secondary small" @click="load()"><RefreshCw :size="15" />{{ t("刷新") }}</button><button class="button small" @click="createOpen=!createOpen"><Plus :size="15" />{{ t("直接新增") }}</button></div></div>
      <form v-if="createOpen" class="card card-body stack" @submit.prevent="createReplay"><h3>{{ t("管理员直接发布回放") }}</h3><div class="form-grid"><div class="field wide"><label>{{ t("会议标题 *") }}</label><input v-model="createForm.title" required maxlength="120" /></div><div class="field"><label>{{ t("会议日期 *") }}</label><input v-model="createForm.meetingDate" required type="date" /></div><div class="field"><label>{{ t("提取码") }}</label><input v-model="createForm.accessCode" maxlength="64" /></div><div class="field wide"><label>{{ t("回放链接 *") }}</label><input v-model="createForm.shareUrl" required type="url" /></div><div class="field wide"><label>{{ t("备注") }}</label><textarea v-model="createForm.note" maxlength="500" /></div></div><div class="inline"><button class="button" type="submit">{{ t("发布回放") }}</button><button class="button secondary" type="button" @click="createOpen=false">{{ t("取消") }}</button></div></form>
      <section class="card card-body"><h3>{{ t("合并重复会议卡片") }}</h3><p class="fine-print">{{ t("卡片 ID 显示在每条回放标题下。合并会移动来源链接并删除空的来源卡片。") }}</p><div class="inline"><input v-model="mergeSourceId" :aria-label="t('来源卡片 ID')" :placeholder="t('来源卡片 ID')" /><input v-model="mergeTargetId" :aria-label="t('目标卡片 ID')" :placeholder="t('目标卡片 ID')" /><button class="button secondary small" @click="mergeGroups">{{ t("合并") }}</button></div></section>
      <div class="tabs replay-admin-tabs"><button v-for="item in [{id:'published',label:'已发布'},{id:'reports',label:'失效反馈'},{id:'disabled',label:'已下架'},{id:'rejected',label:'已拒绝'}]" :key="item.id" :class="{active:filter===item.id}" @click="switchFilter(item.id as Filter)">{{ t(item.label) }}</button></div>
    </template>
    <div v-if="loading" class="empty-state">{{ t("正在加载回放管理数据…") }}</div>
    <div v-else-if="!entries.length" class="empty-state">{{ t(pendingOnly ? '当前没有待审核的回放投稿。' : '当前分类没有回放记录。') }}</div>
    <div v-else class="stack">
      <article v-for="item in entries" :key="item.id" class="card card-body replay-admin-card">
        <div class="section-title replay-admin-head"><div><span class="status" :class="item.status">{{ item.status }}</span><h3>{{ item.title }}</h3><p class="fine-print">{{ t("会议卡片 ID：{0} · 投稿人：{1} · {2}", [item.groupId, item.contributorWqId, new Date(item.createdAt).toLocaleString(dateLocale)]) }}</p></div><a class="button secondary small" :href="item.shareUrl" target="_blank" rel="noopener noreferrer"><ExternalLink :size="15" />{{ t("检查链接") }}</a></div>
        <div class="form-grid"><div class="field wide"><label>{{ t("会议标题") }}</label><input v-model="drafts[item.id]!.title" maxlength="120" /></div><div class="field"><label>{{ t("会议日期") }}</label><input v-model="drafts[item.id]!.meetingDate" type="date" /></div><div class="field"><label>{{ t("提取码") }}</label><input v-model="drafts[item.id]!.accessCode" maxlength="64" /></div><div class="field wide"><label>{{ t("回放链接") }}</label><input v-model="drafts[item.id]!.shareUrl" type="url" /></div><div class="field wide"><label>{{ t("备注") }}</label><textarea v-model="drafts[item.id]!.note" maxlength="500" /></div><div class="field wide"><label>{{ t("移动到其他会议卡片（可选）") }}</label><input v-model="drafts[item.id]!.targetGroupId" :placeholder="t('目标会议卡片 ID')" /></div></div>
        <div v-if="item.openReportCount" class="notice-box replay-report-summary"><strong>{{ t("{0} 条待处理反馈：{1}", [item.openReportCount, t(reasonLabels[item.latestReportReason || ''] || item.latestReportReason)]) }}</strong><span v-if="item.latestReportNote">{{ item.latestReportNote }}</span></div>
        <div v-if="item.status==='pending'" class="field"><label>{{ t("给投稿人的反馈（可选）") }}</label><textarea v-model="reviewNotes[item.id]" maxlength="1000" /></div>
        <div class="inline replay-admin-actions"><button class="button secondary small" @click="save(item)">{{ t("保存修改") }}</button><button v-if="item.status==='pending'" class="button small" @click="decide(item.id,'publish')">{{ t("通过并发布") }}</button><button v-if="item.status==='pending'" class="button danger small" @click="decide(item.id,'reject')">{{ t("拒绝") }}</button><button v-if="item.status==='published'" class="button danger small" @click="changeState(item,'disable')">{{ t("下架") }}</button><button v-if="item.status==='disabled'" class="button small" @click="changeState(item,'restore')">{{ t("恢复") }}</button><template v-if="item.openReportCount"><button class="button small" @click="resolveReports(item.id,'resolved')">{{ t("标记已解决") }}</button><button class="button secondary small" @click="resolveReports(item.id,'dismissed')">{{ t("忽略反馈") }}</button></template></div>
      </article>
    </div>
    <div v-if="entries.length" class="pagination-bar"><span class="fine-print">{{ t("第 {0}–{1} 条，共 {2} 条", [(pagination.page-1)*pagination.pageSize+1, Math.min(pagination.page*pagination.pageSize,pagination.total), pagination.total]) }}</span><div class="inline"><select v-model.number="pageSize" @change="load(1)"><option :value="25">{{ t("每页 25 条") }}</option><option :value="50">{{ t("每页 50 条") }}</option><option :value="100">{{ t("每页 100 条") }}</option></select><button class="button secondary small" :disabled="pagination.page<=1" @click="load(pagination.page-1)">{{ t("上一页") }}</button><button class="button secondary small" :disabled="pagination.page>=pagination.totalPages" @click="load(pagination.page+1)">{{ t("下一页") }}</button></div></div>
  </div>
</template>
