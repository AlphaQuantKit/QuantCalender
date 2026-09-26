import { computed, ref } from 'vue'
import { en } from './locales/en'

export type Locale = 'zh' | 'en'
const storageKey = 'wq-calendar-locale'
function storedLocale(): Locale | null {
  try { const value = localStorage.getItem(storageKey); return value === 'en' || value === 'zh' ? value : null } catch { return null }
}
export const locale = ref<Locale>(storedLocale() || (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'))
export const dateLocale = computed(() => locale.value === 'zh' ? 'zh-CN' : 'en-GB')

export function setLocale(value: Locale, persist = true) {
  locale.value = value
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en'
    document.title = value === 'zh' ? 'WQ Calendar · 会议日历' : 'WQ Calendar · Meetings'
  }
  if (persist) { try { localStorage.setItem(storageKey, value) } catch { /* Storage may be disabled. */ } }
}

// A member country provides a default only. An explicit language choice always wins.
export function applyMemberLocale(user: { role: string; country?: string | null }) {
  if (!storedLocale() && user.role === 'member') setLocale(['CN', 'HK'].includes(user.country || '') ? 'zh' : 'en', false)
}

const interpolate = (message: string, values: readonly unknown[]) => message.replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match))
// Existing asynchronous notices remain source strings, so changing language can
// re-render them without refetching data, remounting forms, or losing user input.
const patterns = Object.entries(en).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => ({
  value,
  pattern: new RegExp('^' + key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$', 's')
}))

export function t(message: unknown, values: readonly unknown[] = []): string {
  const source = String(message ?? '')
  if (locale.value === 'zh') return interpolate(source, values)
  if (en[source]) return interpolate(en[source], values)
  if (!values.length && /[\u3400-\u9fff]/.test(source)) {
    for (const { pattern, value } of patterns) {
      const match = pattern.exec(source)
      if (match) return interpolate(value, match.slice(1))
    }
  }
  return interpolate(source, values)
}

setLocale(locale.value, false)
