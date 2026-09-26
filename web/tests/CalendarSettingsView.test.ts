import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api'
import CalendarSettingsView from '../src/views/CalendarSettingsView.vue'
import { session } from '../src/state'
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('../src/api', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {}
}))

describe('CalendarSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps a saved no-reminder preference selected', async () => {
    vi.mocked(api).mockResolvedValue({
      feed: { exists: true, alarm_minutes: 0 }
    })

    const wrapper = mount(CalendarSettingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('重新生成新地址后，旧地址会立即作废')
    const select = wrapper.find('#default-alarm')
    expect(select.text()).toContain('不提醒')
    expect((select.element as HTMLSelectElement).value).toBe('0')
    expect((wrapper.find('#include-meetings').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.find('#include-ppa').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.find('#include-competition').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.find('#include-bonus').element as HTMLInputElement).checked).toBe(true)
  })

  it('loads and saves independent calendar content settings', async () => {
    vi.mocked(api).mockResolvedValue({
      feed: { exists:true, alarm_minutes:30, include_meetings:1, include_ppa:1, include_competition:0, include_bonus:1 }
    })

    const wrapper = mount(CalendarSettingsView)
    await flushPromises()

    const competition = wrapper.find('#include-competition')
    expect((competition.element as HTMLInputElement).checked).toBe(false)
    await competition.setValue(true)
    await flushPromises()

    const patchCall = vi.mocked(api).mock.calls.find(([, options]) => options?.method === 'PATCH')
    expect(patchCall?.[1]?.body).toContain('"competition":true')
    expect(patchCall?.[1]?.body).toContain('"alarmMinutes":30')
  })

  it('disables the meeting reminder selector when meeting sync is off', async () => {
    vi.mocked(api).mockResolvedValue({
      feed: { exists:true, alarm_minutes:0, include_meetings:0, include_ppa:1, include_competition:1, include_bonus:1 }
    })

    const wrapper = mount(CalendarSettingsView)
    await flushPromises()

    expect(wrapper.find('#default-alarm').attributes('disabled')).toBeDefined()
  })

  it('updates the global contributor identity preference', async () => {
    session.user = { role:'member', memberId:'member-1', wqIdHint:'••••1234', country:'CN', publicWqId:true, passwordChangeRequired:false, expiresAt:'2099-01-01T00:00:00Z' }
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/v1/calendar-feed') return { feed:{ exists:false, alarm_minutes:30 } }
      if (path === '/v1/me/preferences') return { user:{ ...session.user!, publicWqId:false } }
      return {}
    })
    const wrapper = mount(CalendarSettingsView)
    await flushPromises()
    await wrapper.find('.preference-toggle input').setValue(false)
    await flushPromises()
    const preferenceCall = vi.mocked(api).mock.calls.find(([path]) => path === '/v1/me/preferences')
    expect(preferenceCall?.[1]?.method).toBe('PATCH')
    expect(preferenceCall?.[1]?.body).toContain('"publicWqId":false')
    expect(session.user?.publicWqId).toBe(false)
  })
})
