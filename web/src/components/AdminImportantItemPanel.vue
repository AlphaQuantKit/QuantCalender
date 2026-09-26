<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, ref } from 'vue'
import { Pencil, Plus, RefreshCw, XCircle } from 'lucide-vue-next'
import type { ImportantItem, ImportantItemInput, ImportantItemStatus } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import ImportantItemForm from './ImportantItemForm.vue'
import MarkdownContent from './MarkdownContent.vue'

const props = withDefaults(defineProps<{ pendingOnly?: boolean }>(), { pendingOnly:false })
const emit = defineEmits<{ 'pending-count':[count:number] }>()

const items = ref<ImportantItem[]>([])
const loading = ref(true)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const editorOpen = ref(false)
const editing = ref<ImportantItem | null>(null)
const editorStatus = ref<'draft' | 'published'>('published')
const reviewNotes = ref<Record<string,string>>({})

const visibleItems = computed(() => props.pendingOnly ? items.value.filter((item) => item.status === 'pending') : items.value)
const KIND_LABELS = { ppa:'PPA 主题', competition:'比赛主题', bonus:'奖金日程' } as const
const STATUS_LABELS: Record<ImportantItemStatus,string> = { draft:'草稿', pending:'待审核', published:'已发布', rejected:'未通过', cancelled:'已取消' }

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items:ImportantItem[] }>('/v1/admin/important-items')
    items.value = data.items
    emit('pending-count', data.items.filter((item) => item.status === 'pending').length)
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '重要事项管理数据加载失败' }
  finally { loading.value = false }
}

function itemInput(item: ImportantItem): ImportantItemInput {
  return {
    kind:item.kind, title:item.title, contentMarkdown:item.contentMarkdown,
    startDate:item.startDate, endDate:item.endDate,
    announcementDate:item.announcementDate, paymentDate:item.paymentDate
  }
}

function createItem() {
  editing.value = null
  editorStatus.value = 'published'
  editorOpen.value = true
}

function editItem(item: ImportantItem) {
  editing.value = item
  editorOpen.value = true
}

async function saveItem(item: ImportantItemInput) {
  busy.value = true
  error.value = ''
  try {
    if (editing.value) await api(`/v1/admin/important-items/${editing.value.id}`, { method:'PATCH', body:JSON.stringify({ item, status:editing.value.status }) })
    else await api('/v1/admin/important-items', { method:'POST', body:JSON.stringify({ item, status:editorStatus.value }) })
    notice.value = editing.value ? '重要事项已更新。' : editorStatus.value === 'draft' ? '重要事项草稿已保存。' : '重要事项已发布。'
    editorOpen.value = false
    await load()
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '重要事项保存失败' }
  finally { busy.value = false }
}

async function decide(item: ImportantItem, decision: 'publish' | 'reject') {
  const verb = decision === 'publish' ? '通过并发布' : '拒绝'
  if (!confirm(t('确定{0}这条重要事项投稿吗？', [t(verb)]))) return
  try {
    await api(`/v1/admin/important-item-submissions/${item.id}/decision`, { method:'POST', body:JSON.stringify({ decision, reviewNote:reviewNotes.value[item.id] || '' }) })
    notice.value = decision === 'publish' ? '重要事项已发布。' : '重要事项投稿已拒绝。'
    await load()
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '审批失败' }
}

async function cancelItem(item: ImportantItem) {
  if (!confirm(t('取消后会保留记录，并通过日历订阅同步取消。确定继续吗？'))) return
  try {
    await api(`/v1/admin/important-items/${item.id}/cancel`, { method:'POST', body:'{}' })
    notice.value = '重要事项已取消。'
    await load()
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '取消失败' }
}
</script>

<template>
  <div :class="{ 'admin-important-pending-embed':pendingOnly }">
    <div v-if="!pendingOnly" class="section-title replay-admin-head"><div><h2>{{ t("重要事项管理") }}</h2><p class="fine-print">{{ t("维护 PPA、比赛、奖金适用周期和关键日期；已发布日期修改后会同步到现有订阅。") }}</p></div><div class="inline"><button class="button secondary small" type="button" @click="load"><RefreshCw :size="15" />{{ t("刷新") }}</button><button class="button small" type="button" @click="createItem"><Plus :size="15" />{{ t("直接新增") }}</button></div></div>
    <div v-if="error" class="error-box" style="margin-bottom:14px">{{ t(error) }}</div><div v-if="notice" class="success-box" style="margin-bottom:14px">{{ t(notice) }}</div>

    <section v-if="editorOpen" class="card card-body important-admin-editor">
      <div class="section-title"><h3>{{ t(editing ? '编辑重要事项' : '新建重要事项') }}</h3><button class="icon-button" type="button" @click="editorOpen=false"><XCircle :size="19" /></button></div>
      <div v-if="!editing" class="field important-status-select"><label>{{ t("保存状态") }}</label><select v-model="editorStatus"><option value="draft">{{ t("保存为草稿") }}</option><option value="published">{{ t("立即发布") }}</option></select></div>
      <ImportantItemForm :initial="editing ? itemInput(editing) : undefined" :busy="busy" :allow-bonus="!editing?.submittedByMember" :submit-label="t(editing ? '保存修改' : editorStatus === 'draft' ? '保存草稿' : '发布重要事项')" @submit="saveItem" />
    </section>

    <div v-if="loading" class="empty-state">{{ t("正在加载重要事项…") }}</div>
    <div v-else-if="!visibleItems.length" class="empty-state">{{ t(pendingOnly ? '当前没有待审核的重要事项投稿。' : '还没有重要事项记录。') }}</div>
    <div v-else class="stack">
      <article v-for="item in visibleItems" :key="item.id" class="card card-body important-admin-card">
        <div class="page-head important-admin-head"><div><div class="inline"><span class="tag">{{ t(KIND_LABELS[item.kind]) }}</span><span class="status" :class="item.status">{{ t(STATUS_LABELS[item.status]) }}</span></div><h3>{{ item.title }}</h3><p class="muted">{{ t(item.kind === 'bonus' ? '适用周期：' : '') }}{{ item.startDate }}—{{ item.endDate }}</p></div><button v-if="['draft','pending','published'].includes(item.status)" class="button secondary small" type="button" @click="editItem(item)"><Pencil :size="15" />{{ t("编辑") }}</button></div>
        <MarkdownContent v-if="item.contentMarkdown" :content="item.contentMarkdown" />
        <div v-if="item.kind === 'bonus'" class="bonus-dates"><div><span>{{ t("公布日期") }}</span><strong>{{ t(item.announcementDate || '待确定') }}</strong></div><div><span>{{ t("账单日期") }}</span><strong>{{ t(item.paymentDate || '待确定') }}</strong></div></div>
        <template v-if="item.status === 'pending'">
          <div class="field" style="margin-top:14px"><label>{{ t("给投稿人的反馈（可选）") }}</label><textarea v-model="reviewNotes[item.id]" maxlength="1000" /></div>
          <div class="inline" style="margin-top:12px"><button class="button" type="button" @click="decide(item,'publish')">{{ t("通过并发布") }}</button><button class="button danger" type="button" @click="decide(item,'reject')">{{ t("拒绝") }}</button></div>
        </template>
        <button v-else-if="item.status === 'published'" class="button danger small" type="button" style="margin-top:14px" @click="cancelItem(item)">{{ t("取消事项") }}</button>
      </article>
    </div>
  </div>
</template>
