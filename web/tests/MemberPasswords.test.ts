import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MemberPasswordForm from '../src/components/MemberPasswordForm.vue'
import AdminMemberPassword from '../src/components/AdminMemberPassword.vue'
import PasswordReminder from '../src/components/PasswordReminder.vue'
import { api, ApiError, clearCsrf } from '../src/api'
import { session } from '../src/state'

const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../src/api', () => ({ api: vi.fn(), clearCsrf: vi.fn(), ApiError: class ApiError extends Error {} }))

beforeEach(() => {
  vi.clearAllMocks()
  session.user = { role: 'member', memberId: 'm1', country: 'US', publicWqId: true, wqIdHint: 'hint', passwordChangeRequired: true, expiresAt: '2099-01-01' }
})
afterEach(() => { vi.restoreAllMocks(); session.user = null })

describe('member password controls', () => {
  it('shows a persistent reminder only while the member uses the initial password', async () => {
    const wrapper = mount(PasswordReminder, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('前往设置修改密码')
    session.user!.passwordChangeRequired = false
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    session.user!.role = 'admin'; session.user!.passwordChangeRequired = true
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('validates confirmation and requires the current password', async () => {
    const wrapper = mount(MemberPasswordForm)
    await wrapper.find('#new-password').setValue('new long password')
    await wrapper.find('#confirm-password').setValue('different password')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('两次输入的新密码不一致')
    await wrapper.find('#confirm-password').setValue('new long password')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('请填写当前密码')
    expect(api).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('changes the password and clears local auth before returning to login', async () => {
    vi.mocked(api).mockResolvedValue({ changed: true, requiresLogin: true })
    const wrapper = mount(MemberPasswordForm)
    await wrapper.find('#current-password').setValue('ID1234')
    await wrapper.find('#new-password').setValue('new long password')
    await wrapper.find('#confirm-password').setValue('new long password')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api).toHaveBeenCalledWith('/v1/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: 'ID1234', newPassword: 'new long password' }) })
    expect(session.user).toBeNull()
    expect(clearCsrf).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/login?password=changed')
    expect((wrapper.find('#current-password').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('keeps the session on a rejected password change and displays the server error', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError({ code: 'CURRENT_PASSWORD_INCORRECT', message: '当前密码不正确', requestId: 'test' }))
    const wrapper = mount(MemberPasswordForm)
    await wrapper.find('#current-password').setValue('wrong')
    await wrapper.find('#new-password').setValue('new long password')
    await wrapper.find('#confirm-password').setValue('new long password')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(session.user).not.toBeNull()
    expect(clearCsrf).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('admin single-member password controls', () => {
  it('requires confirmation for reset and sends only the selected member ID', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(api).mockResolvedValue({ changed: true })
    const wrapper = mount(AdminMemberPassword, { props: { memberId: 'm1', wqId: 'ID1234' } })
    const reset = wrapper.findAll('button').find(button => button.text() === '重置为 WQ_ID')!
    await reset.trigger('click')
    expect(api).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await reset.trigger('click'); await flushPromises()
    expect(api).toHaveBeenCalledWith('/v1/admin/members/m1/password', { method: 'POST', body: '{"action":"reset"}' })
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })

  it('can set a new password and clears it after success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api).mockResolvedValue({ changed: true })
    const wrapper = mount(AdminMemberPassword, { props: { memberId: 'm2', wqId: 'OTHER01' } })
    await wrapper.find('#admin-member-new-password').setValue('assigned password')
    await wrapper.find('#admin-member-confirm-password').setValue('assigned password')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(api).toHaveBeenCalledWith('/v1/admin/members/m2/password', { method: 'POST', body: '{"action":"set","newPassword":"assigned password"}' })
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect((wrapper.find('#admin-member-new-password').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
})
