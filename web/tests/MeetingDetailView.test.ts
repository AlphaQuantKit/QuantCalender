import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api'
import { session } from '../src/state'
import MeetingDetailView from '../src/views/MeetingDetailView.vue'

vi.mock('vue-router', () => ({ useRoute:() => ({
  params:{ id:'11111111-1111-4111-8111-111111111111' },
  query:{ occurrence:'2026-07-01T10:00:00Z', start:'2026-07-01T10:00:00Z', end:'2026-07-01T11:00:00Z', status:'published' }
}) }))
vi.mock('../src/api', () => ({ api:vi.fn(), ApiError:class ApiError extends Error {}, API_BASE_URL:'https://api.example.com' }))

describe('MeetingDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    session.user = { role:'member', memberId:'member-1', wqIdHint:'••••1234', country:'CN', publicWqId:true, passwordChangeRequired:false, expiresAt:'2099-01-01T00:00:00Z' }
    vi.mocked(api).mockImplementation(async (path) => path.startsWith('/v1/replays?')
      ? { groups:[{ id:'replay-1' }] }
      : { meeting:{
        id:'11111111-1111-4111-8111-111111111111', title:'历史培训', summary:'历史培训', description:'',
        category:'培训', meetingLanguage:'zh', registrationUrl:'https://example.com/register', sourceTimezone:'Asia/Shanghai',
        startUtc:'2026-07-01T10:00:00Z', endUtc:'2026-07-01T11:00:00Z', organizer:'WQ', speaker:'', locationText:'线上会议',
        registrationDeadlineUtc:null, status:'published'
      } })
  })

  it('replaces registration and calendar actions with replay actions after a meeting ends', async () => {
    const wrapper = mount(MeetingDetailView, { global:{ stubs:{ RouterLink:{ props:['to'], template:'<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('已结束')
    expect(wrapper.text()).toContain('查看回放')
    expect(wrapper.text()).toContain('投稿回放')
    expect(wrapper.text()).not.toContain('前往注册')
    expect(wrapper.text()).not.toContain('添加到 Google')
    expect(wrapper.text()).not.toContain('下载 .ics')
  })

  it('does not offer replay viewing when the occurrence has no published replay', async () => {
    vi.mocked(api).mockImplementation(async (path) => path.startsWith('/v1/replays?') ? { groups:[] } : { meeting:{
      id:'11111111-1111-4111-8111-111111111111', title:'历史培训', summary:'历史培训', description:'',
      category:'培训', meetingLanguage:'zh', registrationUrl:'https://example.com/register', sourceTimezone:'Asia/Shanghai',
      startUtc:'2026-07-01T10:00:00Z', endUtc:'2026-07-01T11:00:00Z', organizer:'WQ', speaker:'', locationText:'线上会议',
      registrationDeadlineUtc:null, status:'published'
    } })
    const wrapper = mount(MeetingDetailView, { global:{ stubs:{ RouterLink:{ props:['to'], template:'<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无回放')
    expect(wrapper.text()).not.toContain('查看回放')
    expect(wrapper.text()).toContain('投稿回放')
  })
})
