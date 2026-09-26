<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarDays, FileUp, Flag, Pencil, PlaySquare, Plus, ShieldX, XCircle } from 'lucide-vue-next'
import type { MeetingInput, MeetingOccurrence } from '@wq-calendar/shared'
import { memberImportRowSchema } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import { session } from '../state'
import MeetingForm from '../components/MeetingForm.vue'
import LeaderboardPanel from '../components/LeaderboardPanel.vue'
import AdminReplayPanel from '../components/AdminReplayPanel.vue'
import AdminImportantItemPanel from '../components/AdminImportantItemPanel.vue'
import AdminMemberPassword from '../components/AdminMemberPassword.vue'

type Tab = 'pending' | 'events' | 'replays' | 'important' | 'members' | 'usage' | 'leaderboard' | 'audit'
type UsageFilter = 'all' | 'logged' | 'not_logged' | 'subscribed' | 'not_subscribed' | 'active_session'
type UsageMember = {
  id: string; wqId: string; hasFullWqId: boolean; country: string; active: boolean; recordDate: string
  firstLoginAt: string | null; lastLoginAt: string | null; lastActiveAt: string | null; loginCount: number
  activeSessionCount: number; subscribed: boolean; alarmMinutes: number | null
  subscriptionCreatedAt: string | null; subscriptionUpdatedAt: string | null
}
type UsageSummary = { activeMembers: number; loggedInMembers: number; active30Days: number; subscribedMembers: number; subscriptionRate: number }
type UsagePagination = { page: number; pageSize: number; total: number; totalPages: number }
const router = useRouter()
const tab = ref<Tab>('pending')
const pending = ref<any[]>([])
const pendingReplayCount = ref(0)
const pendingImportantCount = ref(0)
const events = ref<any[]>([])
const occurrences = ref<MeetingOccurrence[]>([])
const logs = ref<any[]>([])
const usageMembers = ref<UsageMember[]>([])
const passwordMember = ref<UsageMember | null>(null)
const usageSummary = ref<UsageSummary>({ activeMembers: 0, loggedInMembers: 0, active30Days: 0, subscribedMembers: 0, subscriptionRate: 0 })
const usageLoaded = ref(false)
const usageLoading = ref(false)
const usageQuery = ref('')
const usageFilter = ref<UsageFilter>('all')
const usagePageSize = ref(50)
const usagePagination = ref<UsagePagination>({ page: 1, pageSize: 50, total: 0, totalPages: 1 })
const error = ref('')
const notice = ref('')
const busy = ref(false)
const editorOpen = ref(false)
const editing = ref<any>(null)
const editorStatus = ref<'draft' | 'pending' | 'published' | 'rejected' | 'cancelled'>('published')
const reviewNotes = ref<Record<string, string>>({})

const csvFile = ref<File | null>(null)
const csvRows = ref<Array<{ wqId: string; country: string }>>([])
const csvInvalid = ref<string[]>([])
const importProgress = ref('')

const exceptionEventId = ref('')
const exceptionOccurrence = ref('')
const exceptionAction = ref<'cancel' | 'override'>('cancel')
const overrideStart = ref('')
const overrideEnd = ref('')
const overrideTimezone = ref('Asia/Shanghai')

onMounted(loadAll)

async function loadAll() {
  error.value = ''
  try {
    const now = new Date()
    const to = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)
    const [submissionData, eventData, occurrenceData, auditData] = await Promise.all([
      api<{ submissions: any[] }>('/v1/admin/submissions'),
      api<{ events: any[] }>('/v1/admin/events'),
      api<{ occurrences: MeetingOccurrence[] }>(`/v1/meetings?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
      api<{ logs: any[] }>('/v1/admin/audit')
    ])
    pending.value = submissionData.submissions
    events.value = eventData.events
    occurrences.value = occurrenceData.occurrences
    logs.value = auditData.logs
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '管理数据加载失败' }
}

function meetingFromEvent(item: any): Partial<MeetingInput> {
  return {
    title: item.title, category: item.category, meetingLanguage: item.meetingLanguage,
    registrationUrl: item.registrationUrl, startLocal: item.startLocal.slice(0, 16),
    durationMinutes: item.durationMinutes,
    recurrence: { ...item.recurrence, untilLocal: item.recurrence?.untilLocal?.slice(0, 16) || null }
  }
}

function createEvent() { editing.value = null; editorStatus.value = 'published'; editorOpen.value = true }
function editEvent(item: any) { editing.value = item; editorStatus.value = item.status; editorOpen.value = true }

async function saveEvent(meeting: MeetingInput) {
  busy.value = true; error.value = ''
  try {
    if (editing.value) await api(`/v1/admin/events/${editing.value.id}`, { method:'PATCH', body:JSON.stringify({ meeting, status: editorStatus.value }) })
    else await api('/v1/admin/events', { method:'POST', body:JSON.stringify({ meeting, status:editorStatus.value }) })
    notice.value = editing.value ? '会议已更新。' : editorStatus.value === 'draft' ? '草稿已保存。' : '会议已发布。'
    editorOpen.value = false; await loadAll()
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '保存失败' }
  finally { busy.value = false }
}

async function decide(id: string, decision: 'publish' | 'reject') {
  const verb = decision === 'publish' ? '发布' : '拒绝'
  if (!confirm(`确定${verb}这条投稿吗？`)) return
  try { await api(`/v1/admin/submissions/${id}/decision`, { method:'POST', body:JSON.stringify({ decision, reviewNote: reviewNotes.value[id] || '' }) }); notice.value = `投稿已${verb}。`; await loadAll() }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '审批失败' }
}

async function cancelEvent(id: string) {
  if (!confirm('取消后会通过日历订阅同步给成员。确定继续吗？')) return
  try { await api(`/v1/admin/events/${id}/cancel`, { method:'POST', body:'{}' }); await loadAll() }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '取消失败' }
}

const selectedOccurrenceOptions = computed(() => occurrences.value.filter((item) => !exceptionEventId.value || item.eventId === exceptionEventId.value))

async function openUsage() {
  tab.value = 'usage'
  if (usageLoaded.value || usageLoading.value) return
  await loadUsage(1)
}

async function passwordSaved() {
  passwordMember.value = null
  notice.value = '成员密码已更新，该成员旧登录会话已失效。'
  await loadUsage()
}

async function loadUsage(page = usagePagination.value.page) {
  usageLoading.value = true; error.value = ''
  try {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(usagePageSize.value),
      filter: usageFilter.value
    })
    if (usageQuery.value.trim()) params.set('q', usageQuery.value.trim())
    const data = await api<{ summary: UsageSummary; pagination: UsagePagination; members: UsageMember[] }>(`/v1/admin/member-usage?${params}`)
    usageSummary.value = data.summary
    usageMembers.value = data.members
    usagePagination.value = data.pagination
    usageLoaded.value = true
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '使用统计加载失败' }
  finally { usageLoading.value = false }
}

function clearUsageFilters() {
  usageQuery.value = ''
  usageFilter.value = 'all'
  void loadUsage(1)
}

function formatUsageTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
}

function alarmLabel(minutes: number | null) {
  if (minutes === 0) return '不提醒'
  if (minutes === 1440) return '提前 1 天'
  return minutes === null ? '—' : `提前 ${minutes} 分钟`
}

async function saveException() {
  if (!exceptionEventId.value || !exceptionOccurrence.value) { error.value = '请选择会议和具体场次'; return }
  const body = exceptionAction.value === 'cancel'
    ? { action:'cancel', note:'' }
    : { action:'override', overrideStartLocal:withSeconds(overrideStart.value), overrideEndLocal:withSeconds(overrideEnd.value), overrideTimezone:overrideTimezone.value, note:'管理员改期' }
  try {
    await api(`/v1/admin/events/${exceptionEventId.value}/exceptions/${encodeURIComponent(exceptionOccurrence.value)}`, { method:'PUT', body:JSON.stringify(body) })
    notice.value = exceptionAction.value === 'cancel' ? '该场次已单独取消。' : '该场次已改期。'
    await loadAll()
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '保存例外失败' }
}
function withSeconds(value: string) { return value.length === 16 ? `${value}:00` : value }

async function readCsv(file: File) {
  csvFile.value = file; csvRows.value = []; csvInvalid.value = []
  const lines = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  const header = lines.shift()?.split(',').map((item) => item.trim().toLowerCase())
  if (!header || header.join(',') !== 'wq_id,country') { csvInvalid.value.push('表头必须严格为 wq_id,country'); return }
  const seen = new Set<string>()
  lines.forEach((line, index) => {
    const cells = line.split(',').map((item) => item?.trim() || '')
    const [rawId = '', rawCountry = ''] = cells
    const wqId = rawId.toUpperCase(); const country = rawCountry.toUpperCase()
    if (cells.length !== 2 || !memberImportRowSchema.safeParse({ wqId, country }).success || seen.has(wqId)) {
      csvInvalid.value.push(`第 ${index + 2} 行无效或重复`); return
    }
    seen.add(wqId); csvRows.value.push({ wqId, country })
  })
}

function onCsvChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void readCsv(file)
}

function hostname(value: string) {
  try { return new globalThis.URL(value).hostname } catch { return value }
}

async function importMembers() {
  if (!csvRows.value.length || csvInvalid.value.length) return
  if (!confirm(`将用 ${csvRows.value.length} 名成员整体替换现有名单，缺失成员会停用。确定继续吗？`)) return
  busy.value = true; error.value = ''
  try {
    const created = await api<{ importId: string }>('/v1/admin/member-imports', { method:'POST', body:'{}' })
    for (let offset = 0; offset < csvRows.value.length; offset += 100) {
      const rows = csvRows.value.slice(offset, offset + 100)
      await api(`/v1/admin/member-imports/${created.importId}/rows`, { method:'POST', body:JSON.stringify({ rows }) })
      importProgress.value = `已暂存 ${Math.min(offset + 100, csvRows.value.length)} / ${csvRows.value.length}`
    }
    await api(`/v1/admin/member-imports/${created.importId}/commit`, { method:'POST', body:'{}' })
    notice.value = `已启用 ${csvRows.value.length} 名成员。`; importProgress.value = ''; csvRows.value = []; csvFile.value = null; usageLoaded.value = false
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '成员导入失败' }
  finally { busy.value = false }
}

async function revokeAllAdminSessions() {
  if (!confirm('这会立即退出所有管理员设备，包括当前设备。确定继续吗？')) return
  await api('/v1/admin/sessions/revoke-all', { method:'POST', body:'{}' })
  session.user = null
  await router.push('/login')
}
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">ADMIN CONSOLE</p><h1>日历管理</h1><p class="subtitle">审批成员投稿、维护会议系列和更新各地区成员名单。所有关键操作都会写入审计日志。</p></div><button class="button" @click="createEvent"><Plus :size="17" />新建会议</button></div>
  <div v-if="error" class="error-box" style="margin-bottom:14px">{{ error }}</div><div v-if="notice" class="success-box" style="margin-bottom:14px">{{ notice }}</div>

  <div class="tabs"><button :class="{active:tab==='pending'}" @click="tab='pending'">待审 {{ pending.length + pendingReplayCount + pendingImportantCount }}</button><button :class="{active:tab==='events'}" @click="tab='events'">会议管理</button><button :class="{active:tab==='replays'}" @click="tab='replays'">回放管理</button><button :class="{active:tab==='important'}" @click="tab='important'">重要事项</button><button :class="{active:tab==='leaderboard'}" @click="tab='leaderboard'">投稿排行</button><button :class="{active:tab==='usage'}" @click="openUsage">使用统计</button><button :class="{active:tab==='members'}" @click="tab='members'">成员导入</button><button :class="{active:tab==='audit'}" @click="tab='audit'">审计日志</button></div>

  <section v-if="editorOpen" class="card card-body" style="margin-bottom:22px"><div class="section-title"><h2>{{ editing ? '编辑会议' : '创建会议' }}</h2><button class="icon-button" @click="editorOpen=false"><XCircle :size="19" /></button></div><div v-if="!editing || editing.status === 'draft'" class="field" style="max-width:280px;margin-bottom:16px"><label for="editor-status">保存状态</label><select id="editor-status" v-model="editorStatus"><option value="draft">保存为草稿</option><option value="published">立即发布</option></select></div><MeetingForm :initial="editing ? meetingFromEvent(editing) : undefined" :busy="busy" :submit-label="editing ? '保存修改' : editorStatus === 'draft' ? '保存草稿' : '发布会议'" @submit="saveEvent" /></section>

  <section v-if="tab==='pending'" class="pending-review-layout">
    <section class="pending-review-group pending-review-meetings">
      <div class="pending-review-title"><span class="pending-review-icon"><CalendarDays :size="19" /></span><div><h2>会议投稿</h2><p>待审核 {{ pending.length }} 条</p></div></div>
      <div v-if="!pending.length" class="empty-state">当前没有待审核的会议投稿。</div>
      <div v-else class="stack">
        <article v-for="item in pending" :key="item.id" class="card card-body pending-review-card">
          <div class="page-head" style="margin-bottom:14px"><div><span class="status pending">会议待审</span><h2 style="margin-top:10px">{{ item.title }}</h2><p class="subtitle">{{ item.summary }}</p></div><button class="button secondary small" @click="editEvent(item)"><Pencil :size="15" />审核前编辑</button></div>
          <dl class="meta-list"><div class="meta-row"><dt>时间</dt><dd>{{ item.startLocal }} · {{ item.sourceTimezone }}</dd></div><div class="meta-row"><dt>主办方</dt><dd>{{ item.organizer }}</dd></div><div class="meta-row"><dt>注册链接</dt><dd><a :href="item.registrationUrl" target="_blank" rel="noopener noreferrer">{{ hostname(item.registrationUrl) }}</a></dd></div></dl>
          <div class="field" style="margin-top:14px"><label>给投稿人的反馈（可选）</label><textarea v-model="reviewNotes[item.id]" maxlength="1000" /></div>
          <div class="inline" style="margin-top:12px"><button class="button" @click="decide(item.id,'publish')">通过并发布</button><button class="button danger" @click="decide(item.id,'reject')">拒绝</button></div>
        </article>
      </div>
    </section>
    <section class="pending-review-group pending-review-replays">
      <div class="pending-review-title"><span class="pending-review-icon"><PlaySquare :size="19" /></span><div><h2>回放投稿</h2><p>待审核 {{ pendingReplayCount }} 条</p></div></div>
      <AdminReplayPanel pending-only @pending-count="pendingReplayCount = $event" />
    </section>
    <section class="pending-review-group pending-review-important">
      <div class="pending-review-title"><span class="pending-review-icon"><Flag :size="19" /></span><div><h2>重要事项投稿</h2><p>待审核 {{ pendingImportantCount }} 条</p></div></div>
      <AdminImportantItemPanel pending-only @pending-count="pendingImportantCount = $event" />
    </section>
  </section>

  <section v-if="tab==='events'" class="stack">
    <div class="card card-body"><h2>单次取消或改期</h2><div class="form-grid"><div class="field"><label>会议系列</label><select v-model="exceptionEventId"><option value="">请选择</option><option v-for="item in events.filter(e=>e.status==='published')" :key="item.id" :value="item.id">{{ item.title }}</option></select></div><div class="field"><label>具体场次</label><select v-model="exceptionOccurrence"><option value="">请选择</option><option v-for="item in selectedOccurrenceOptions" :key="item.occurrenceKey" :value="item.occurrenceKey">{{ new Date(item.startUtc).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}) }} · {{ item.title }}</option></select></div><div class="field"><label>操作</label><select v-model="exceptionAction"><option value="cancel">仅取消这一次</option><option value="override">仅改期这一次</option></select></div><template v-if="exceptionAction==='override'"><div class="field"><label>新开始时间</label><input v-model="overrideStart" type="datetime-local" /></div><div class="field"><label>新结束时间</label><input v-model="overrideEnd" type="datetime-local" /></div><div class="field"><label>新时区</label><input v-model="overrideTimezone" /></div></template></div><button class="button secondary" style="margin-top:14px" @click="saveException">保存单次例外</button></div>
    <div class="card card-body"><div class="section-title"><h2>全部会议</h2><span class="muted">{{ events.length }} 条</span></div><table class="data-table"><thead><tr><th>会议</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in events" :key="item.id"><td><strong>{{ item.title }}</strong><br><span class="muted">{{ item.organizer }}</span></td><td>{{ item.startLocal }}<br><span class="muted">{{ item.sourceTimezone }}</span></td><td><span class="status" :class="item.status">{{ item.status }}</span></td><td><div class="inline"><button class="button secondary small" @click="editEvent(item)">编辑</button><button v-if="item.status==='published'" class="button danger small" @click="cancelEvent(item.id)">取消</button></div></td></tr></tbody></table></div>
  </section>

  <section v-if="tab==='members'" class="panel-grid">
    <div class="card card-body stack"><h2>整体替换成员名单</h2><div class="notice-box">CSV 表头必须为 <code>wq_id,country</code>。支持各地区的两位字母代码（如 CN、HK、US、IN），重复 ID、额外列或非法行会阻止提交；导入日期由系统自动记录。</div><label class="button secondary" style="width:max-content"><FileUp :size="17" />选择 CSV<input type="file" accept=".csv,text/csv" hidden @change="onCsvChange" /></label><p v-if="csvFile">已选择：{{ csvFile.name }}</p><div v-if="csvRows.length" class="success-box">有效成员 {{ csvRows.length }} 名，覆盖 {{ new Set(csvRows.map(r=>r.country)).size }} 个地区。</div><div v-if="csvInvalid.length" class="error-box"><strong>发现 {{ csvInvalid.length }} 个问题</strong><ul><li v-for="item in csvInvalid.slice(0,10)" :key="item">{{ item }}</li></ul></div><p v-if="importProgress" class="muted">{{ importProgress }}</p><button class="button" :disabled="busy || !csvRows.length || !!csvInvalid.length" @click="importMembers">{{ busy ? '正在导入…' : '确认整体替换' }}</button></div>
    <div class="card card-body stack"><h2>平台定时同步</h2><p>可通过 GitHub Actions 的 <code>Sync platform members</code> 工作流每日同步，也可手动运行。</p><p>在仓库 Secrets 配置 <code>WQ_USERNAME</code>、<code>WQ_PASSWORD</code>、<code>MEMBER_SYNC_TOKEN</code>，并按 README 设置 API 地址与启用开关。平台账号密码不会保存到网页或日历数据库。</p><p class="muted">自动同步仅新增、更新，不停用名单外成员；手动整体替换仍会停用缺失成员。运行结果可在 Actions 和审计日志中查看。</p></div>
    <aside class="card card-body"><h2>安全操作</h2><p class="fine-print">WQ_ID 使用 HMAC 作为登录索引，并保存一份仅管理员接口可解密的加密值；原始 CSV 不会进入仓库。</p><div class="divider"></div><button class="button danger" @click="revokeAllAdminSessions"><ShieldX :size="17" />撤销全部管理员会话</button></aside>
  </section>

  <section v-if="tab==='usage'" class="stack">
    <AdminMemberPassword v-if="passwordMember" :key="passwordMember.id" :member-id="passwordMember.id" :wq-id="passwordMember.wqId" @saved="passwordSaved" @close="passwordMember=null" />
    <div v-if="usageLoading" class="empty-state">正在整理成员使用情况…</div>
    <template v-else-if="usageLoaded">
      <div class="metric-grid">
        <div class="card metric-card"><span>有效成员</span><strong>{{ usageSummary.activeMembers }}</strong></div>
        <div class="card metric-card"><span>已登录成员</span><strong>{{ usageSummary.loggedInMembers }}</strong></div>
        <div class="card metric-card"><span>近 30 天活跃</span><strong>{{ usageSummary.active30Days }}</strong></div>
        <div class="card metric-card"><span>有效订阅</span><strong>{{ usageSummary.subscribedMembers }}</strong><small>已登录成员的 {{ usageSummary.subscriptionRate }}%</small></div>
      </div>
      <div class="card card-body">
        <div class="usage-toolbar">
          <div><h2>成员明细</h2><p class="fine-print">共 {{ usagePagination.total }} 名，当前第 {{ usagePagination.page }} / {{ usagePagination.totalPages }} 页；所有时间均为北京时间。</p></div>
          <div class="inline">
            <input v-model="usageQuery" aria-label="精确搜索 WQ_ID" placeholder="精确搜索 WQ_ID" @keyup.enter="loadUsage(1)" />
            <select v-model="usageFilter" aria-label="筛选使用状态"><option value="all">全部成员</option><option value="logged">已登录</option><option value="not_logged">未登录</option><option value="subscribed">已订阅</option><option value="not_subscribed">未订阅</option><option value="active_session">当前有会话</option></select>
            <select v-model.number="usagePageSize" aria-label="每页显示数量" @change="loadUsage(1)"><option :value="25">每页 25 名</option><option :value="50">每页 50 名</option><option :value="100">每页 100 名</option></select>
            <button class="button small" type="button" @click="loadUsage(1)">查询</button>
            <button class="button secondary small" type="button" @click="clearUsageFilters">清除</button>
          </div>
        </div>
        <table class="data-table usage-table"><thead><tr><th>WQ_ID</th><th>地区</th><th>首次登录</th><th>最近登录 / 活跃</th><th>登录次数</th><th>有效会话</th><th>日历订阅</th><th>密码</th></tr></thead><tbody><tr v-for="member in usageMembers" :key="member.id"><td><strong>{{ member.wqId }}</strong><br><span v-if="!member.hasFullWqId" class="muted">重新登录或导入后补全</span><span v-if="!member.active" class="status rejected">已停用</span></td><td>{{ member.country }}</td><td>{{ formatUsageTime(member.firstLoginAt) }}</td><td>{{ formatUsageTime(member.lastLoginAt) }}<br><span class="muted">活跃：{{ formatUsageTime(member.lastActiveAt) }}</span></td><td>{{ member.loginCount }}</td><td><span class="status" :class="member.activeSessionCount ? 'published' : 'draft'">{{ member.activeSessionCount ? `${member.activeSessionCount} 个` : '无' }}</span></td><td><span class="status" :class="member.subscribed ? 'published' : 'draft'">{{ member.subscribed ? '已订阅' : '未订阅' }}</span><template v-if="member.subscribed"><br><span class="muted">{{ formatUsageTime(member.subscriptionCreatedAt) }}<br>{{ alarmLabel(member.alarmMinutes) }}</span></template></td><td><button class="button secondary small" type="button" @click="passwordMember=member">管理密码</button></td></tr></tbody></table>
        <div v-if="!usageMembers.length" class="empty-state">没有符合条件的成员。</div>
        <div v-else class="pagination-bar">
          <span class="fine-print">第 {{ (usagePagination.page - 1) * usagePagination.pageSize + 1 }}–{{ Math.min(usagePagination.page * usagePagination.pageSize, usagePagination.total) }} 名，共 {{ usagePagination.total }} 名</span>
          <div class="inline"><button class="button secondary small" :disabled="usagePagination.page <= 1 || usageLoading" @click="loadUsage(usagePagination.page - 1)">上一页</button><button class="button secondary small" :disabled="usagePagination.page >= usagePagination.totalPages || usageLoading" @click="loadUsage(usagePagination.page + 1)">下一页</button></div>
        </div>
      </div>
    </template>
  </section>

  <section v-if="tab==='leaderboard'"><LeaderboardPanel /></section>

  <section v-if="tab==='replays'"><AdminReplayPanel /></section>

  <section v-if="tab==='important'"><AdminImportantItemPanel @pending-count="pendingImportantCount = $event" /></section>

  <section v-if="tab==='audit'" class="card card-body"><table class="data-table"><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>角色</th></tr></thead><tbody><tr v-for="item in logs" :key="item.id"><td>{{ new Date(item.created_at).toLocaleString('zh-CN') }}</td><td>{{ item.action }}</td><td>{{ item.entity_type }} · {{ item.entity_id.slice(0,8) }}</td><td>{{ item.actor_role }}</td></tr></tbody></table></section>
</template>
