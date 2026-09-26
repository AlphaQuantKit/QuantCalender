import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminView from '../src/views/AdminView.vue'
import AdminMemberPassword from '../src/components/AdminMemberPassword.vue'
import { api } from '../src/api'
import { setLocale } from '../src/i18n'

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
  it('shows country totals and drills down to paginated user IDs, retaining the country filter', async () => {
    vi.mocked(api).mockImplementation(async path => {
      if (!path.startsWith('/v1/admin/member-usage')) return {submissions:[], events:[], occurrences:[], logs:[]}
      const params = new URL(path,'https://test').searchParams
      const page = Number(params.get('page') || 1)
      return {
        summary:{activeMembers:29, loggedInMembers:28, active30Days:27, subscribedMembers:3, subscriptionRate:10.7},
        countries:[{country:'US',totalMembers:28,activeMembers:27,usedMembers:27,active30Days:26,subscribedMembers:2},{country:'CN',totalMembers:1,activeMembers:1,usedMembers:1,active30Days:1,subscribedMembers:1}],
        pagination:{page,pageSize:25,total:27,totalPages:2},
        members:[{id:'test',wqId:page===1?'US01':'US27',hasFullWqId:true,country:'US',active:true,loginCount:2,activeSessionCount:1,subscribed:false}]
      }
    })
    const wrapper=shallowMount(AdminView)
    await flushPromises()
    await wrapper.findAll('button').find(button=>button.text()==='使用统计')!.trigger('click')
    await flushPromises()
    const table=wrapper.find('.table-scroll')
    expect(table.text()).toContain('使用人数')
    expect(table.findAll('tbody tr')).toHaveLength(2)
    await table.find('button').trigger('click')
    await flushPromises()
    const usageCalls=()=>vi.mocked(api).mock.calls.filter(([path])=>path.startsWith('/v1/admin/member-usage'))
    expect(usageCalls().at(-1)?.[0]).toContain('filter=logged&country=US')
    expect(wrapper.find('.usage-table').text()).toContain('US01')
    await wrapper.findAll('button').find(button=>button.text()==='下一页')!.trigger('click')
    await flushPromises()
    expect(usageCalls().at(-1)?.[0]).toContain('page=2')
    expect(usageCalls().at(-1)?.[0]).toContain('country=US')
    expect(wrapper.find('.usage-table').text()).toContain('US27')
    setLocale('en')
    await flushPromises()
    expect(wrapper.text()).not.toMatch(/[\u3400-\u9fff]/)
    expect(wrapper.text()).toContain('Usage by country')
    wrapper.unmount()
  })

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
