<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Check, Copy, RefreshCw, Trash2 } from 'lucide-vue-next'
import { defaultCalendarContentSelection, type CalendarContentSelection } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import { session } from '../state'
import MemberPasswordForm from '../components/MemberPasswordForm.vue'

const exists = ref(false)
const alarmMinutes = ref(30)
const feedUrl = ref('')
const error = ref('')
const copied = ref(false)
const busy = ref(false)
const settingsBusy = ref(false)
const publicWqId = ref(session.user?.publicWqId ?? true)
const identityBusy = ref(false)
const contentSelection = reactive<CalendarContentSelection>({ ...defaultCalendarContentSelection })

type CalendarFeedRecord = {
  exists: boolean
  alarm_minutes?: number
  include_meetings?: number
  include_ppa?: number
  include_competition?: number
  include_bonus?: number
}

function applyFeedSettings(feed: CalendarFeedRecord) {
  exists.value = feed.exists
  alarmMinutes.value = feed.alarm_minutes ?? 30
  contentSelection.meetings = feed.include_meetings !== 0
  contentSelection.ppa = feed.include_ppa !== 0
  contentSelection.competition = feed.include_competition !== 0
  contentSelection.bonus = feed.include_bonus !== 0
}

function feedSettingsBody() {
  return {
    alarmMinutes: alarmMinutes.value,
    contentSelection: { ...contentSelection }
  }
}

onMounted(async () => {
  try {
    const data = await api<{ feed: CalendarFeedRecord }>('/v1/calendar-feed')
    applyFeedSettings(data.feed)
  }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '加载订阅设置失败' }
})

async function generate() {
  busy.value = true; error.value = ''
  try { const data = await api<{ url: string }>('/v1/calendar-feed', { method:'POST', body:JSON.stringify(feedSettingsBody()) }); feedUrl.value = data.url; exists.value = true }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '生成失败' }
  finally { busy.value = false }
}
async function updateFeedSettings() {
  if (!exists.value) return
  settingsBusy.value = true; error.value = ''
  try { await api('/v1/calendar-feed', { method:'PATCH', body:JSON.stringify(feedSettingsBody()) }) }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '订阅设置保存失败' }
  finally { settingsBusy.value = false }
}
async function setAllContent(enabled: boolean) {
  contentSelection.meetings = enabled
  contentSelection.ppa = enabled
  contentSelection.competition = enabled
  contentSelection.bonus = enabled
  await updateFeedSettings()
}
async function updateIdentity() {
  identityBusy.value = true; error.value = ''
  try {
    const data = await api<{ user: NonNullable<typeof session.user> }>('/v1/me/preferences', { method:'PATCH', body:JSON.stringify({ publicWqId: publicWqId.value }) })
    session.user = data.user
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '身份显示设置保存失败'; publicWqId.value = !publicWqId.value }
  finally { identityBusy.value = false }
}
async function copy() { if (!feedUrl.value) return; await navigator.clipboard.writeText(feedUrl.value); copied.value = true; setTimeout(() => copied.value = false, 1800) }
async function revoke() { if (!confirm('撤销后，旧订阅地址将立即失效。确定继续吗？')) return; await api('/v1/calendar-feed', { method:'DELETE' }); exists.value = false; feedUrl.value = '' }
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">MEMBER SETTINGS</p><h1>成员设置</h1><p class="subtitle">管理登录密码、排行榜身份显示和个人日历订阅。</p></div></div>
  <div v-if="error" class="error-box" style="margin-bottom:14px">{{ error }}</div>
  <div class="panel-grid">
    <div class="stack">
      <MemberPasswordForm />
      <section class="card card-body stack"><div><h2>贡献者身份显示</h2><p class="subtitle">此设置统一作用于会议榜、回放榜和回放来源卡片；管理员始终可以查看完整 WQ_ID。</p></div><label class="preference-toggle"><input v-model="publicWqId" type="checkbox" :disabled="identityBusy" @change="updateIdentity" /><span><strong>向登录成员显示完整 WQ_ID</strong><small>{{ publicWqId ? '当前显示完整 ID；关闭后仅显示开头两个字母。' : '当前仅显示开头两个字母，不显示后续数字。' }}</small></span></label></section>
      <section class="card card-body stack">
        <div><h2>个人日历提醒</h2><p class="subtitle">生成专属订阅地址后，可加入 Google、Outlook 或 Apple Calendar。地址等同于访问凭证，请勿转发。重新生成新地址后，旧地址会立即作废。</p></div>
        <div class="notice-box">可分别选择要同步的内容，默认全部开启。只有会议会按下方设置写入提醒；PPA、比赛和奖金日程无论日期如何都不会由网站写入提醒。日历客户端仍可能应用你自己的默认提醒；订阅刷新频率由客户端决定，可能不是即时。</div>
        <fieldset class="calendar-content-settings" :disabled="settingsBusy">
          <legend>同步到个人日历</legend>
          <div class="calendar-content-head">
            <p>选择订阅中需要包含的内容</p>
            <div class="inline">
              <button class="button secondary small" type="button" @click="setAllContent(true)">全部开启</button>
              <button class="button secondary small" type="button" @click="setAllContent(false)">全部关闭</button>
            </div>
          </div>
          <div class="calendar-content-grid">
            <label class="calendar-content-option" for="include-meetings"><input id="include-meetings" v-model="contentSelection.meetings" type="checkbox" @change="updateFeedSettings" /><span><strong>会议</strong><small>可使用下方提前提醒</small></span></label>
            <label class="calendar-content-option" for="include-ppa"><input id="include-ppa" v-model="contentSelection.ppa" type="checkbox" @change="updateFeedSettings" /><span><strong>PPA 主题</strong><small>全天事项，不写入提醒</small></span></label>
            <label class="calendar-content-option" for="include-competition"><input id="include-competition" v-model="contentSelection.competition" type="checkbox" @change="updateFeedSettings" /><span><strong>比赛主题</strong><small>全天事项，不写入提醒</small></span></label>
            <label class="calendar-content-option" for="include-bonus"><input id="include-bonus" v-model="contentSelection.bonus" type="checkbox" @change="updateFeedSettings" /><span><strong>奖金日程</strong><small>仅同步公布／账单日期，不写入提醒</small></span></label>
          </div>
        </fieldset>
        <div class="field"><label for="default-alarm">会议提前提醒</label><select id="default-alarm" v-model="alarmMinutes" :disabled="settingsBusy || !contentSelection.meetings" @change="updateFeedSettings"><option :value="0">不提醒</option><option :value="10">提前 10 分钟</option><option :value="30">提前 30 分钟</option><option :value="60">提前 1 小时</option><option :value="1440">提前 1 天</option></select><small v-if="!contentSelection.meetings">开启“会议”同步后，此设置才会生效。</small></div>
        <div v-if="feedUrl" class="field"><label for="feed-url">新订阅地址（仅显示这一次）</label><input id="feed-url" :value="feedUrl" readonly /><button class="button secondary" @click="copy"><Check v-if="copied" :size="17" /><Copy v-else :size="17" />{{ copied ? '已复制' : '复制地址' }}</button></div>
        <div class="inline"><button class="button" :disabled="busy" @click="generate"><RefreshCw :size="17" />{{ exists ? '旋转并生成新地址' : '生成订阅地址' }}</button><button v-if="exists" class="button danger" @click="revoke"><Trash2 :size="17" />撤销订阅</button></div>
      </section>
    </div>
    <aside class="card card-body"><h2>添加方法</h2><ol class="detail-copy"><li>点击生成并复制私密地址。</li><li>在个人日历中选择“从 URL 订阅”或“添加订阅日历”。</li><li>粘贴地址并保存。</li></ol><p class="fine-print">单场下载只是快照；只有 URL 订阅能持续获取更新。</p></aside>
  </div>
</template>
