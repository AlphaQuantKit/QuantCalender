<script setup lang="ts">
import { t } from '../i18n'
import LeaderboardPanel from '../components/LeaderboardPanel.vue'
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">COMMUNITY LEADERBOARD</p><h1>{{ t("投稿排行") }}</h1><p class="subtitle">{{ t("会议投稿与回放贡献分别排名。WQ_ID 默认完整显示，成员可以在设置中切换为仅显示开头两个字母。") }}</p></div></div>
  <LeaderboardPanel />
</template>
