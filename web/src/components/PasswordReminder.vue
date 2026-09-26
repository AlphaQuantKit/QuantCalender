<script setup lang="ts">
import { session } from '../state'
</script>

<template>
  <div v-if="session.user?.role === 'member' && session.user.passwordChangeRequired" class="notice-box" role="alert" style="margin-bottom:16px">
    你正在使用 WQ_ID 初始密码，其他人可能据此登录你的账号。请尽快<RouterLink to="/calendar-settings">前往设置修改密码</RouterLink>。
  </div>
</template>
