<script setup lang="ts">
import { locale, setLocale, t, type Locale } from '../i18n'
function change(event: Event) { setLocale((event.target as HTMLSelectElement).value as Locale) }
</script>

<template>
  <label class="language-selector"><span class="sr-only">{{ t('语言版本') }}</span><select :value="locale" :aria-label="t('语言版本')" @change="change"><option value="zh">中文</option><option value="en">English</option></select></label>
</template>
