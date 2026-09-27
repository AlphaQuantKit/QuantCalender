import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMemberLocale, dateLocale, locale, setLocale, t } from '../src/i18n'
import { session, regionalAccess } from '../src/state'
import { api } from '../src/api'
import MeetingForm from '../src/components/MeetingForm.vue'
import LanguageSelector from '../src/components/LanguageSelector.vue'
import CalendarView from '../src/views/CalendarView.vue'
import MeetingDetailView from '../src/views/MeetingDetailView.vue'
import MySubmissionsView from '../src/views/MySubmissionsView.vue'
import AboutView from '../src/views/AboutView.vue'
import LoginView from '../src/views/LoginView.vue'

vi.mock('../src/api', () => ({ api: vi.fn(), login: vi.fn(), ApiError: class ApiError extends Error {} }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'en' }, query: {} }), useRouter: () => ({ push: vi.fn() }) }))
const global = { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } }
const han = /[\u3400-\u9fff]/

beforeEach(() => {
  vi.clearAllMocks()
  session.user = { role:'member', memberId:'test', wqIdHint:'ID01', country:'US', publicWqId:true, passwordChangeRequired:false, expiresAt:'2099-01-01' }
})

describe('bilingual UI', () => {
  it('honors explicit language choices and only uses country as the initial default', async () => {
    applyMemberLocale(session.user!)
    expect(locale.value).toBe('en')
    const selector = mount(LanguageSelector)
    expect(selector.attributes('role')).toBe('group')
    expect(selector.attributes('aria-label')).toBe('Language')
    expect(selector.find('select').exists()).toBe(false)
    expect(selector.get('button[lang="en"]').attributes('aria-pressed')).toBe('true')
    await selector.get('button[lang="zh-CN"]').trigger('click')
    expect(localStorage.getItem('wq-calendar-locale')).toBe('zh')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(selector.get('button[lang="zh-CN"]').attributes('aria-pressed')).toBe('true')
    expect(selector.get('button[lang="en"]').attributes('aria-pressed')).toBe('false')
    expect(selector.findAll('button').every(button => button.attributes('type') === 'button')).toBe(true)
    applyMemberLocale(session.user!)
    expect(locale.value).toBe('zh')
    expect(regionalAccess.value).toBe(false)
    await selector.get('button[lang="en"]').trigger('click')
    expect(document.title).toBe('WQ Calendar · Meetings')
    expect(dateLocale.value).toBe('en-GB')
    localStorage.removeItem('wq-calendar-locale')
    applyMemberLocale({role:'member',country:'HK'})
    expect(locale.value).toBe('zh')
    selector.unmount()
  })

  it('switches form labels without losing input or changing canonical values', async () => {
    const form = mount(MeetingForm)
    await form.find('#meeting-title').setValue('研究分享 — user content')
    await form.find('#category').setValue('研究分享')
    await form.find('#registration-url').setValue('https://example.com/register')
    setLocale('en')
    await nextTick()
    expect(form.text()).not.toMatch(han)
    expect(form.find('#meeting-title').element).toHaveProperty('value','研究分享 — user content')
    expect(form.find('#category').element).toHaveProperty('value','研究分享')
    expect(form.findAll('#language option').map(option => option.attributes('value'))).toEqual(['en'])
    await form.find('form').trigger('submit')
    expect(form.emitted('submit')?.[0]?.[0]).toMatchObject({ title:'研究分享 — user content', category:'研究分享', meetingLanguage:'en' })
    form.unmount()
  })

  it('translates login, guide, errors and parameterized messages, preserving supplied content', async () => {
    setLocale('en')
    const login = mount(LoginView, {global})
    expect(login.text()).not.toMatch(han)
    expect(login.text()).toContain('Member sign-in')
    const guide = mount(AboutView, {global})
    expect(guide.text()).not.toMatch(han)
    expect(guide.find('a[href="/replays"]').exists()).toBe(false)
    expect(guide.find('a[href="/leaderboard"]').exists()).toBe(false)
    expect(t('会议不存在')).toBe('Meeting not found')
    expect(t('第 4 行无效或重复')).toBe('Row 4 is invalid or duplicated')
    expect(t('管理员反馈：{0}', ['请保留原始内容'])).toContain('请保留原始内容')
    expect(t('周一')).toBe('Mon')
    login.unmount(); guide.unmount()
  })

  it('defensively filters non-English meetings and removes blocked UI even in Chinese mode', async () => {
    vi.mocked(api).mockResolvedValue({ occurrences: ['en','zh','bilingual','other'].map(language => ({
      eventId: language, occurrenceKey:'2099-01-01T00:00:00Z', startUtc:'2099-01-01T00:00:00Z', endUtc:'2099-01-01T01:00:00Z',
      title:`Title-${language}`, summary:'Test', organizer:'Test', speaker:'', category:'培训', meetingLanguage:language, status:'published',
      locationType:'online', registrationUrl:'https://example.com/register'
    })) })
    const calendar = mount(CalendarView,{global})
    await flushPromises()
    expect(calendar.text()).not.toContain('仅显示英文会议')
    expect(calendar.text()).not.toContain('CN/HK')
    expect(calendar.text()).toContain('Title-en')
    for(const language of ['zh','bilingual','other']) expect(calendar.text()).not.toContain(`Title-${language}`)
    expect(calendar.find('option[value="bilingual"]').exists()).toBe(false)
    setLocale('en')
    await nextTick()
    expect(calendar.text()).not.toMatch(han)
    expect(calendar.text()).not.toContain('Only English meetings are shown')
    expect(calendar.text()).not.toContain('CN/HK')
    expect(calendar.text()).toContain('Title-en')
    for(const language of ['zh','bilingual','other']) expect(calendar.text()).not.toContain(`Title-${language}`)
    calendar.unmount()
  })

  it('never requests replays or offers replay actions for non-regional members', async () => {
    vi.mocked(api).mockResolvedValue({meeting:{id:'en', title:'English', category:'培训', meetingLanguage:'en', startUtc:'2020-01-01T00:00:00Z', endUtc:'2020-01-01T01:00:00Z'}})
    const detail = mount(MeetingDetailView,{global})
    await flushPromises()
    expect(api).toHaveBeenCalledTimes(1)
    expect(detail.text()).not.toContain('回放')
    expect(detail.text()).not.toContain('前往注册')
    detail.unmount()
    vi.mocked(api).mockClear().mockResolvedValue({submissions:[]})
    const mine = mount(MySubmissionsView,{global})
    await flushPromises()
    expect(api).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('replay'))).toBe(false)
    expect(mine.findAll('button').some(button=>button.text()==='回放投稿')).toBe(false)
    mine.unmount()
  })
})
