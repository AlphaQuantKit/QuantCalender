import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api'
import { session } from '../src/state'
import CalendarView from '../src/views/CalendarView.vue'

vi.mock('../src/api', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {}
}))

describe('CalendarView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    session.user = { role:'member', memberId:'member-1', wqIdHint:'••••1234', country:'CN', publicWqId:true, passwordChangeRequired:false, expiresAt:'2099-01-01T00:00:00Z' }
    vi.mocked(api).mockResolvedValue({
      occurrences: [{
        eventId: 'meeting-1', occurrenceKey: '2099-08-01T10:00:00Z', title: '顾问周会',
        summary: '顾问周会', organizer: 'WQ', speaker: '', category: '培训', meetingLanguage: 'zh',
        locationType: 'online', locationText: '线上会议', registrationUrl: 'https://example.com/register',
        sourceTimezone: 'Asia/Shanghai', startUtc: '2099-08-01T10:00:00Z', endUtc: '2099-08-01T11:00:00Z',
        status: 'published', isException: false
      }, {
        eventId: 'meeting-1', occurrenceKey: '2099-08-08T10:00:00Z', title: '顾问周会',
        summary: '顾问周会', organizer: 'WQ', speaker: '', category: '培训', meetingLanguage: 'zh',
        locationType: 'online', locationText: '线上会议', registrationUrl: 'https://example.com/register',
        sourceTimezone: 'Asia/Shanghai', startUtc: '2099-08-08T10:00:00Z', endUtc: '2099-08-08T11:00:00Z',
        status: 'published', isException: false
      }, {
        eventId: 'meeting-2', occurrenceKey: '2099-08-02T10:00:00Z', title: '研究分享',
        summary: '研究分享', organizer: 'WQ', speaker: '', category: '研究分享', meetingLanguage: 'zh',
        locationType: 'online', locationText: '线上会议', registrationUrl: 'https://example.com/research',
        sourceTimezone: 'Asia/Shanghai', startUtc: '2099-08-02T10:00:00Z', endUtc: '2099-08-02T11:00:00Z',
        status: 'published', isException: false
      }, {
        eventId: 'meeting-2', occurrenceKey: '2099-08-09T10:00:00Z', title: '研究分享',
        summary: '研究分享', organizer: 'WQ', speaker: '', category: '研究分享', meetingLanguage: 'zh',
        locationType: 'online', locationText: '线上会议', registrationUrl: 'https://example.com/research',
        sourceTimezone: 'Asia/Shanghai', startUtc: '2099-08-09T10:00:00Z', endUtc: '2099-08-09T11:00:00Z',
        status: 'published', isException: false
      }]
    })
  })

  it('opens meeting submission as a dialog from the meeting page', async () => {
    const wrapper = mount(CalendarView, {
      global: {
        stubs: {
          RouterLink: { props: ['to'], template: '<a class="router-link"><slot /></a>' }
        }
      }
    })
    await flushPromises()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.find('.meeting-submit-button').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('[role="dialog"]').text()).toContain('投稿会议')
    expect(wrapper.find('[role="dialog"] form').exists()).toBe(true)
  })

  it('shows separate detail and direct registration buttons', async () => {
    const wrapper = mount(CalendarView, {
      global: {
        stubs: {
          RouterLink: { props: ['to'], template: '<a class="router-link"><slot /></a>' }
        }
      }
    })
    await flushPromises()

    const actions = wrapper.find('.hero-actions')
    expect(actions.text()).toContain('查看详情')
    expect(actions.text()).toContain('立即注册')
    const registration = actions.find('a[href="https://example.com/register"]')
    expect(registration.attributes('target')).toBe('_blank')
    expect(registration.attributes('rel')).toContain('noopener')
  })

  it('shows actions on agenda cards and only the nearest occurrence per series', async () => {
    const wrapper = mount(CalendarView, {
      global: {
        stubs: {
          RouterLink: { props: ['to'], template: '<a class="router-link"><slot /></a>' }
        }
      }
    })
    await flushPromises()

    const agendaItems = wrapper.findAll('.agenda-item')
    expect(agendaItems).toHaveLength(1)
    const agendaItem = agendaItems[0]!
    expect(agendaItem.text()).toContain('研究分享')
    expect(agendaItem.text()).toContain('查看详情')
    expect(agendaItem.text()).toContain('立即注册')
    expect(agendaItem.find('a[href="https://example.com/research"]').exists()).toBe(true)
  })

  it('loads every past occurrence lazily and exposes replay actions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T12:00:00Z'))
    const base = {
      summary:'周期培训', organizer:'WQ', speaker:'', category:'培训', meetingLanguage:'zh' as const,
      locationType:'online' as const, locationText:'线上会议', registrationUrl:'https://example.com/register',
      sourceTimezone:'Asia/Shanghai', isException:false, hasReplay:false
    }
    vi.mocked(api)
      .mockResolvedValueOnce({ occurrences:[{
        ...base, eventId:'11111111-1111-4111-8111-111111111111', occurrenceKey:'2026-08-07T12:00:00Z', title:'周期培训',
        startUtc:'2026-08-07T12:00:00Z', endUtc:'2026-08-07T13:00:00Z', status:'published'
      }] })
      .mockResolvedValueOnce({ occurrences:[{
        ...base, eventId:'11111111-1111-4111-8111-111111111111', occurrenceKey:'2026-07-24T12:00:00Z', title:'周期培训',
        startUtc:'2026-07-24T12:00:00Z', endUtc:'2026-07-24T13:00:00Z', status:'published', hasReplay:true
      }, {
        ...base, eventId:'11111111-1111-4111-8111-111111111111', occurrenceKey:'2026-07-17T12:00:00Z', title:'周期培训',
        startUtc:'2026-07-17T12:00:00Z', endUtc:'2026-07-17T13:00:00Z', status:'published'
      }, {
        ...base, eventId:'22222222-2222-4222-8222-222222222222', occurrenceKey:'2026-07-20T12:00:00Z', title:'已取消分享',
        startUtc:'2026-07-20T12:00:00Z', endUtc:'2026-07-20T13:00:00Z', status:'cancelled'
      }] })
    const wrapper = mount(CalendarView, {
      global: { stubs: { RouterLink: { props:['to'], template:'<a class="router-link"><slot /></a>' } } }
    })
    try {
      await flushPromises()
      expect(vi.mocked(api)).toHaveBeenCalledTimes(1)
      await wrapper.findAll('[aria-label="切换会议时间范围"] button')[1]!.trigger('click')
      await flushPromises()
      expect(vi.mocked(api)).toHaveBeenCalledTimes(2)
      expect(wrapper.findAll('.agenda-item')).toHaveLength(3)
      expect(wrapper.text()).toContain('已结束')
      expect(wrapper.text()).toContain('已取消')
      expect(wrapper.text()).toContain('查看回放')
      expect(wrapper.text()).toContain('暂无回放')
      expect(wrapper.findAll('.agenda-actions').filter((actions) => actions.text().includes('查看回放'))).toHaveLength(1)
      expect(wrapper.text()).toContain('投稿回放')
      expect(wrapper.text()).not.toContain('立即注册')

      await wrapper.findAll('[aria-label="切换日历视图"] button')[1]!.trigger('click')
      const monthButtons = wrapper.findAll('.section-title .icon-button')
      expect(monthButtons[0]!.attributes('disabled')).toBeUndefined()
      expect(monthButtons[1]!.attributes('disabled')).toBeDefined()
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps long month titles inside an equal-width calendar cell', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-08-24T00:00:00Z'))
    const longTitle = 'Path to Genius: 3 Part Consultant toolkit and exclusive competition for IQC consultants'
    vi.mocked(api).mockResolvedValueOnce({ occurrences: [{
      eventId: 'long-meeting', occurrenceKey: '2099-08-24T12:00:00Z', title: longTitle,
      summary: longTitle, organizer: 'WQ', speaker: '', category: '培训', meetingLanguage: 'en',
      locationType: 'online', locationText: '线上会议', registrationUrl: 'https://example.com/long',
      sourceTimezone: 'Asia/Shanghai', startUtc: '2099-08-24T12:00:00Z', endUtc: '2099-08-24T13:00:00Z',
      status: 'published', isException: false
    }] })
    try {
      const wrapper = mount(CalendarView, {
        global: { stubs: { RouterLink: { props: ['to'], template: '<a class="router-link"><slot /></a>' } } }
      })
      await flushPromises()
      await wrapper.findAll('[aria-label="切换日历视图"] button')[1]!.trigger('click')
      const chip = wrapper.find('.calendar-chip')
      expect(chip.exists()).toBe(true)
      expect(chip.attributes('title')).toContain(longTitle)
    } finally { vi.useRealTimers() }
  })
})
