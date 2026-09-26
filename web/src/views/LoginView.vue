<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { login, ApiError } from '../api'
import { setUser } from '../state'
import type { SessionUser } from '@wq-calendar/shared'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; 'expired-callback': () => void }) => string
      reset: (widgetId: string) => void
    }
  }
}

const router = useRouter()
const route = useRoute()
const mode = ref<'member' | 'admin'>('member')
const wqId = ref('')
const password = ref('')
const turnstileToken = ref('')
const busy = ref(false)
const error = ref('')
const widget = ref<HTMLElement | null>(null)
let script: HTMLScriptElement | null = null
let widgetId = ''
const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
const turnstileRequired = Boolean(siteKey && !siteKey.startsWith('1x000'))

onMounted(() => {
  if (!turnstileRequired) return
  script = document.createElement('script')
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  script.async = true
  script.defer = true
  script.onload = () => {
    if (widget.value && window.turnstile) widgetId = window.turnstile.render(widget.value, { sitekey: siteKey, action: 'turnstile-spin-v2', callback: (token) => { turnstileToken.value = token; error.value = '' }, 'expired-callback': () => { turnstileToken.value = '' } })
  }
  document.head.appendChild(script)
})

onBeforeUnmount(() => { script?.remove() })

async function submit() {
  error.value = ''
  if (turnstileRequired && !turnstileToken.value) {
    error.value = '请先完成人机验证'
    return
  }
  busy.value = true
  try {
    const data = mode.value === 'member'
      ? await login('/v1/session/member', { wqId: wqId.value, password: password.value, turnstileToken: turnstileToken.value })
      : await login('/v1/session/admin', { wqId: wqId.value, password: password.value, turnstileToken: turnstileToken.value })
    setUser(data.user as SessionUser)
    password.value = ''
    await router.push(mode.value === 'admin' ? '/admin' : (data.user as SessionUser).passwordChangeRequired ? '/calendar-settings' : '/')
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '登录失败，请稍后重试'
    turnstileToken.value = ''
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId)
  } finally { busy.value = false }
}
</script>

<template>
  <div class="login-page">
    <section class="login-story">
      <div class="brand">
        <img class="brand-mark" src="/calendar-logo.png" alt="" width="44" height="44" />
        <span><strong>WQ Calendar</strong><small>非官方成员工具</small></span>
      </div>
      <div class="login-hero">
        <p class="eyebrow" style="color:#a7d9d3">BEIJING TIME · MEMBER ONLY</p>
        <h1>重要日程，<br />集中掌握。</h1>
      </div>
    </section>
    <section class="login-form-area">
      <div class="login-card card">
        <p class="eyebrow">SECURE ACCESS</p>
        <h2>{{ mode === 'member' ? '成员登录' : '管理员登录' }}</h2>
        <p class="subtitle">登录状态保持 30 天。</p>
        <p v-if="route.query.password === 'changed'" class="success-box" role="status">密码已修改，旧登录会话已退出。请使用新密码重新登录。</p>
        <div class="login-switch">
          <button type="button" :disabled="busy" :class="{ active: mode === 'member' }" @click="mode = 'member'; password = ''">普通成员</button>
          <button type="button" :disabled="busy" :class="{ active: mode === 'admin' }" @click="mode = 'admin'; password = ''">管理员</button>
        </div>
        <form class="stack" @submit.prevent="submit">
          <div class="field"><label for="wq-id">WQ_ID</label><input id="wq-id" v-model="wqId" required autocomplete="username" placeholder="输入你的 WQ_ID" /></div>
          <div class="field"><label for="login-password">{{ mode === 'admin' ? '管理员密码' : '成员密码' }}</label><input id="login-password" v-model="password" required type="password" :maxlength="mode === 'admin' ? 256 : 128" autocomplete="current-password" /></div>
          <p v-if="mode === 'member'" class="fine-print">初始密码为你的 WQ_ID（字母不区分大小写）。这是日历站点密码，请勿填写 BRAIN 平台密码；忘记密码请联系日历管理员重置。</p>
          <div ref="widget" aria-label="人机验证"></div>
          <div v-if="error" class="error-box" role="alert">{{ error }}</div>
          <button class="button" type="submit" :disabled="busy">{{ busy ? '正在验证…' : '进入 WQ 日历' }}</button>
        </form>
        <p class="fine-print" style="margin-top:18px">请勿在公共设备上保持登录。如遇成员资格问题，请联系日历管理员。</p>
      </div>
    </section>
  </div>
</template>
