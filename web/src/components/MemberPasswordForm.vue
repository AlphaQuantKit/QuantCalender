<script setup lang="ts">
import { t } from '../i18n'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { memberPasswordChangeSchema } from '@wq-calendar/shared'
import { api, ApiError, clearCsrf } from '../api'
import { session } from '../state'

const router = useRouter()
const currentPassword = ref('')
const newPassword = ref('')
const confirmation = ref('')
const busy = ref(false)
const error = ref('')

async function save() {
  error.value = ''
  if (newPassword.value !== confirmation.value) { error.value = '两次输入的新密码不一致'; return }
  const parsed = memberPasswordChangeSchema.safeParse({ currentPassword: currentPassword.value, newPassword: newPassword.value })
  if (!parsed.success) { error.value = '请填写当前密码及 12–128 位新密码'; return }
  busy.value = true
  try {
    await api('/v1/me/password', { method: 'POST', body: JSON.stringify(parsed.data) })
    currentPassword.value = ''; newPassword.value = ''; confirmation.value = ''
    session.user = null
    clearCsrf()
    await router.push('/login?password=changed')
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '修改密码失败，请稍后重试' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="card card-body stack" id="member-password">
    <div><h2>{{ t("修改登录密码") }}</h2><p class="subtitle">{{ t("新密码须为 12–128 位，不能与 WQ_ID 或当前密码相同。自定义密码区分大小写，建议使用密码管理器生成。") }}</p></div>
    <p v-if="session.user?.passwordChangeRequired" class="notice-box">{{ t("当前使用 WQ_ID 初始密码，请尽快修改。") }}</p>
    <form class="stack" @submit.prevent="save">
      <div class="field"><label for="current-password">{{ t("当前密码") }}</label><input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" required maxlength="128" /></div>
      <div class="field"><label for="new-password">{{ t("新密码") }}</label><input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" /></div>
      <div class="field"><label for="confirm-password">{{ t("确认新密码") }}</label><input id="confirm-password" v-model="confirmation" type="password" autocomplete="new-password" required minlength="12" maxlength="128" /></div>
      <div v-if="error" class="error-box" role="alert">{{ t(error) }}</div>
      <p class="fine-print">{{ t("修改后所有设备需重新登录，日历订阅保持有效。这是日历站点密码，请勿复用 BRAIN 平台密码。") }}</p>
      <button class="button" type="submit" :disabled="busy">{{ t(busy ? '正在修改…' : '保存新密码并重新登录') }}</button>
    </form>
  </section>
</template>
