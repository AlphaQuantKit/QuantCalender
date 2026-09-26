import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminView from '../src/views/AdminView.vue'
import AdminMemberPassword from '../src/components/AdminMemberPassword.vue'
import { api } from '../src/api'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../src/api', () => ({ api: vi.fn(), ApiError: class ApiError extends Error {} }))

beforeEach(() => {
  vi.mocked(api).mockReset()
  vi.mocked(api).mockImplementation(async () => ({ submissions: [], events: [], occurrences: [], logs: [] }))
})
afterEach(() => vi.restoreAllMocks())

async function openMembers(csv: string) {
  const wrapper = shallowMount(AdminView)
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === '成员导入')!.trigger('click')
  const file = new File([csv], 'test.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: async () => csv })
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change')
  await flushPromises()
  return wrapper
}

describe('Admin member import', () => {
  it('accepts all two-letter regions and advertises the optional workflow', async () => {
    const wrapper = await openMembers('wq_id,country\nID01,US\nID02,IN\nID03,cn')
    expect(wrapper.text()).toContain('有效成员 3 名，覆盖 3 个地区')
    expect(wrapper.text()).toContain('Sync platform members')
    expect(wrapper.text()).toContain('MEMBER_SYNC_TOKEN')
    expect(wrapper.findAll('button').find(button => button.text() === '确认整体替换')!.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('still rejects duplicate IDs, malformed regions, and extra columns', async () => {
    const wrapper = await openMembers('wq_id,country\nID01,US\nid01,IN\nID02,USA\nID03,GB,extra')
    expect(wrapper.text()).toContain('发现 3 个问题')
    expect(wrapper.findAll('button').find(button => button.text() === '确认整体替换')!.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('uses the original manual staging/commit endpoints for worldwide CSV rows', async () => {
    const wrapper = await openMembers('wq_id,country\nID01,US')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api).mockResolvedValue({ importId: 'batch-1' })
    await wrapper.findAll('button').find(button => button.text() === '确认整体替换')!.trigger('click')
    await flushPromises()
    expect(api).toHaveBeenCalledWith('/v1/admin/member-imports/batch-1/rows', {
      method: 'POST', body: JSON.stringify({ rows: [{ wqId: 'ID01', country: 'US' }] })
    })
    expect(api).toHaveBeenCalledWith('/v1/admin/member-imports/batch-1/commit', { method: 'POST', body: '{}' })
    expect(wrapper.text()).toContain('已启用 1 名成员')
    wrapper.unmount()
  })
})

describe('Admin password management entry', () => {
  it('opens the selected member from usage statistics and refreshes after saving', async () => {
    vi.mocked(api).mockImplementation(async path => path.startsWith('/v1/admin/member-usage') ? {
      summary: { activeMembers: 2, loggedInMembers: 0, active30Days: 0, subscribedMembers: 0, subscriptionRate: 0 },
      pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
      members: ['ID01', 'ID02'].map((wqId, index) => ({
        id: `m${index + 1}`, wqId, hasFullWqId: true, country: 'US', active: true, recordDate: '2026-09-26',
        firstLoginAt: null, lastLoginAt: null, lastActiveAt: null, loginCount: 0,
        activeSessionCount: 0, subscribed: false, alarmMinutes: null, subscriptionCreatedAt: null, subscriptionUpdatedAt: null
      }))
    } : { submissions: [], events: [], occurrences: [], logs: [] })
    const wrapper = shallowMount(AdminView)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '使用统计')!.trigger('click')
    await flushPromises()
    const buttons = wrapper.findAll('button').filter(button => button.text() === '管理密码')
    await buttons[0]!.trigger('click')
    expect(wrapper.findComponent(AdminMemberPassword).props()).toEqual({ memberId: 'm1', wqId: 'ID01' })
    await buttons[1]!.trigger('click')
    expect(wrapper.findComponent(AdminMemberPassword).props()).toEqual({ memberId: 'm2', wqId: 'ID02' })
    wrapper.findComponent(AdminMemberPassword).vm.$emit('saved')
    await flushPromises()
    expect(wrapper.findComponent(AdminMemberPassword).exists()).toBe(false)
    expect(wrapper.text()).toContain('成员密码已更新，该成员旧登录会话已失效')
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.startsWith('/v1/admin/member-usage'))).toHaveLength(2)
    wrapper.unmount()
  })
})
