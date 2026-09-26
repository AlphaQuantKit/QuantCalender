<script setup lang="ts">
import { t } from '../i18n'
import { ref } from 'vue'
import type { MeetingInput } from '@wq-calendar/shared'
import { api, ApiError } from '../api'
import MeetingForm from '../components/MeetingForm.vue'

const busy = ref(false)
const error = ref('')
const success = ref(false)

async function submit(meeting: MeetingInput) {
  busy.value = true; error.value = ''
  try { await api('/v1/submissions', { method: 'POST', body: JSON.stringify(meeting) }); success.value = true }
  catch (caught) { error.value = caught instanceof ApiError ? caught.message : '投稿失败' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">SUBMIT A MEETING</p><h1>{{ t("提交会议") }}</h1><p class="subtitle">{{ t("提交后不会直接公开。管理员会检查时间、来源与注册链接，必要时修正信息后发布。") }}</p></div></div>
  <div v-if="success" class="card card-body"><div class="success-box"><strong>{{ t("投稿已进入审核队列。") }}</strong><br />{{ t("可以前往“我的投稿”查看审核结果。") }}</div><RouterLink class="button" style="margin-top:16px" to="/submissions">{{ t("查看我的投稿") }}</RouterLink></div>
  <div v-else class="card card-body"><div v-if="error" class="error-box" style="margin-bottom:18px">{{ t(error) }}</div><MeetingForm :busy="busy" @submit="submit" /></div>
</template>
