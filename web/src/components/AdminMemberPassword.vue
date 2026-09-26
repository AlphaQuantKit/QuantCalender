<script setup lang="ts">
import { t } from '../i18n'
import { ref } from 'vue'
import { adminMemberPasswordSchema } from '@wq-calendar/shared'
import { api, ApiError } from '../api'

const props = defineProps<{ memberId: string; wqId: string }>()
const emit = defineEmits<{ saved: []; close: [] }>()
const newPassword = ref('')
const confirmation = ref('')
const busy = ref(false)
const error = ref('')

async function save(action: 'set' | 'reset') {
  error.value = ''
  if (action === 'set' && newPassword.value !== confirmation.value) { error.value = '两次输入的新密码不一致'; return }
  const parsed = adminMemberPasswordSchema.safeParse(action === 'reset' ? { action } : { action, newPassword: newPassword.value })
  if (!parsed.success) { error.value = '新密码须为 12–128 位'; return }
  const message = action === 'reset' ? '重置为该成员的 WQ_ID 初始密码' : '设置该成员的新密码'
  if (!confirm(t('确定为 {0} {1}？该成员所有设备的登录会话将失效，订阅保持有效。', [props.wqId, t(message)]))) return
  busy.value = true
  try {
    await api(`/v1/admin/members/${encodeURIComponent(props.memberId)}/password`, { method: 'POST', body: JSON.stringify(parsed.data) })
    newPassword.value = ''; confirmation.value = ''
    emit('saved')
  } catch (caught) { error.value = caught instanceof ApiError ? caught.message : '密码操作失败，请重试' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="card card-body stack" :aria-label="t('单个成员密码管理')">
    <h2>{{ t("管理密码 · {0}", [wqId]) }}</h2>
    <p class="fine-print">{{ t("只能修改或重置，无法查看原密码。重置后用户需使用自己的 WQ_ID 登录，并会收到改密提醒。停用成员不会因此启用。") }}</p>
    <form class="stack" @submit.prevent="save('set')">
      <div class="field"><label for="admin-member-new-password">{{ t("新密码（12–128 位）") }}</label><input id="admin-member-new-password" v-model="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" /></div>
      <div class="field"><label for="admin-member-confirm-password">{{ t("确认新密码") }}</label><input id="admin-member-confirm-password" v-model="confirmation" type="password" autocomplete="new-password" required minlength="12" maxlength="128" /></div>
      <div v-if="error" class="error-box" role="alert">{{ t(error) }}</div>
      <div class="inline"><button class="button" :disabled="busy" type="submit">{{ t("设置新密码") }}</button><button class="button danger" :disabled="busy" type="button" @click="save('reset')">{{ t("重置为 WQ_ID") }}</button><button class="button secondary" :disabled="busy" type="button" @click="emit('close')">{{ t("取消") }}</button></div>
    </form>
  </section>
</template>
