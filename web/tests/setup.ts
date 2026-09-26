import { beforeEach } from 'vitest'
import { setLocale } from '../src/i18n'

beforeEach(() => { localStorage.removeItem('wq-calendar-locale'); setLocale('zh', false) })
