<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CalendarDays, CircleHelp, Flag, Github, LogOut, PlayCircle, Settings, ShieldCheck, Trophy, Video } from 'lucide-vue-next'
import { logout, session } from './state'
import PasswordReminder from './components/PasswordReminder.vue'

const route = useRoute()
const router = useRouter()
const isLogin = computed(() => route.path === '/login')

async function signOut() {
  await logout()
  await router.push('/login')
}
</script>

<template>
  <div class="site-shell" :class="{ 'login-shell': isLogin }">
    <header v-if="!isLogin" class="topbar">
      <RouterLink to="/" class="brand" aria-label="返回 WQ 日历首页">
        <img class="brand-mark" src="/calendar-logo.png" alt="" width="44" height="44" />
        <span>
          <strong>WQ Calendar</strong>
          <small>非官方成员工具</small>
        </span>
      </RouterLink>
      <nav class="main-nav" aria-label="主导航">
        <RouterLink to="/"><CalendarDays :size="18" />会议日历</RouterLink>
        <RouterLink to="/replays"><PlayCircle :size="18" />回放</RouterLink>
        <RouterLink to="/important-items"><Flag :size="18" />重要事项</RouterLink>
        <RouterLink to="/leaderboard"><Trophy :size="18" />排行榜</RouterLink>
        <span class="nav-divider" aria-hidden="true"></span>
        <RouterLink v-if="session.user?.role === 'member'" class="secondary-nav-link" to="/calendar-settings"><Settings :size="18" />设置</RouterLink>
        <RouterLink v-if="session.user?.role === 'admin'" class="secondary-nav-link" to="/admin"><ShieldCheck :size="18" />管理</RouterLink>
        <RouterLink class="secondary-nav-link" to="/guide"><CircleHelp :size="18" />指南</RouterLink>
      </nav>
      <div class="user-actions">
        <a class="github-link" href="https://github.com/AlphaQuantKit/QuantCalender" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看 AlphaQuantKit/QuantCalender 项目">
          <Github :size="18" /><span>GitHub</span>
        </a>
        <a class="github-link" href="https://github.com/AlphaQuantKit/WebMeetRecorder" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看 Zoom 会议录制工具" title="Zoom 会议录制工具">
          <Video :size="18" /><span>Zoom 录制</span>
        </a>
        <span class="member-pill">{{ session.user?.wqIdHint }}</span>
        <button class="icon-button" type="button" aria-label="退出登录" @click="signOut"><LogOut :size="18" /></button>
      </div>
    </header>

    <main :class="isLogin ? '' : 'page-container'">
      <PasswordReminder v-if="!isLogin" />
      <RouterView />
    </main>

    <footer v-if="!isLogin" class="site-footer">
      <span>WQ Calendar · 北京时间</span>
      <span>非官方成员工具 · 请勿保存密码、个人专属链接或内部文件</span>
    </footer>
  </div>
</template>
