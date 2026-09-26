import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api'
import { session } from '../src/state'
import ReplaySubmitView from '../src/views/ReplaySubmitView.vue'

const routeQuery = vi.hoisted(() => ({ value:{} as Record<string, string> }))
vi.mock('vue-router', () => ({ useRoute:() => ({ get query() { return routeQuery.value } }) }))
vi.mock('../src/api', () => ({ api:vi.fn(), ApiError:class ApiError extends Error {} }))

const occurrence = {
  eventId:'11111111-1111-4111-8111-111111111111', occurrenceKey:'2099-08-01T10:00:00Z', title:'顾问周会',
  summary:'顾问周会', organizer:'WQ', speaker:'', category:'培训', meetingLanguage:'zh', locationType:'online',
  locationText:'线上会议', registrationUrl:'https://example.com/register', sourceTimezone:'Asia/Shanghai',
  startUtc:'2099-08-01T10:00:00Z', endUtc:'2099-08-01T11:00:00Z', status:'published', isException:false
}

describe('ReplaySubmitView', () => {
  beforeEach(() => {
    routeQuery.value = {}
    vi.clearAllMocks()
    session.user = { role:'member', memberId:'member-1', wqIdHint:'••••1234', country:'CN', publicWqId:true, passwordChangeRequired:false, expiresAt:'2099-01-01T00:00:00Z' }
    vi.mocked(api).mockImplementation(async (path) => path.startsWith('/v1/meetings?') ? { occurrences:[occurrence] } : { submission:{ id:'link-1', status:'pending' } })
  })

  it('associates a replay with a concrete meeting occurrence', async () => {
    const wrapper = mount(ReplaySubmitView, { global:{ stubs:{ RouterLink:{ template:'<a><slot /></a>' } } } })
    await flushPromises()
    await wrapper.find('#related-meeting').setValue(`${occurrence.eventId}|${occurrence.occurrenceKey}`)
    expect((wrapper.find('#replay-title').element as HTMLInputElement).value).toBe('顾问周会')
    expect((wrapper.find('#replay-date').element as HTMLInputElement).value).toBe('2099-08-01')
    await wrapper.find('#replay-url').setValue('https://pan.baidu.com/s/replay')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const submitCall = vi.mocked(api).mock.calls.find(([path]) => path === '/v1/replay-submissions')
    const payload = JSON.parse(String(submitCall?.[1]?.body))
    expect(payload).toMatchObject({ eventId:occurrence.eventId, occurrenceKey:occurrence.occurrenceKey, title:'顾问周会', meetingDate:'2099-08-01' })
  })

  it('preselects a meeting occurrence from a history deep link', async () => {
    routeQuery.value = { eventId:occurrence.eventId, occurrenceKey:occurrence.occurrenceKey }
    const wrapper = mount(ReplaySubmitView, { global:{ stubs:{ RouterLink:{ template:'<a><slot /></a>' } } } })
    await flushPromises()
    expect((wrapper.find('#related-meeting').element as HTMLSelectElement).value).toBe(`${occurrence.eventId}|${occurrence.occurrenceKey}`)
    expect((wrapper.find('#replay-title').element as HTMLInputElement).value).toBe('顾问周会')
    expect((wrapper.find('#replay-date').element as HTMLInputElement).value).toBe('2099-08-01')
  })
})
