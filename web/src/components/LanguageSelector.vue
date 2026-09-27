<script setup lang="ts">
import { locale, setLocale, t } from '../i18n'
</script>

<template>
  <div class="language-selector" role="group" :aria-label="t('语言版本')">
    <button type="button" lang="zh-CN" :aria-pressed="locale === 'zh'" @click="setLocale('zh')">中文</button>
    <button type="button" lang="en" aria-label="English" :aria-pressed="locale === 'en'" @click="setLocale('en')">EN</button>
  </div>
</template>
