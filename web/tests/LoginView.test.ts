import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginView from '../src/views/LoginView.vue'
import { login } from '../src/api'

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({ useRouter:() => ({ push:routerPush }), useRoute: () => ({ query: {} }) }))
vi.mock('../src/api', () => ({ login:vi.fn(), ApiError:class ApiError extends Error {} }))

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAAAAAAA-test-site-key')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('asks for human verification without sending a login request', async () => {
    const wrapper = mount(LoginView)
    expect(wrapper.text()).toContain('WQ Calendar')
    expect(wrapper.find('button[type="submit"]').text()).toBe('进入 WQ 日历')
    await wrapper.find('#wq-id').setValue('KZ79256')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe('请先完成人机验证')
    expect(login).not.toHaveBeenCalled()
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('sends the member password and directs initial-password users to settings', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.mocked(login).mockResolvedValue({ user: { role: 'member', passwordChangeRequired: true }, csrfToken: 'csrf' })
    const wrapper = mount(LoginView)
    expect(wrapper.find('#login-password').attributes('type')).toBe('password')
    expect(wrapper.text()).toContain('请勿填写 BRAIN 平台密码')
    await wrapper.find('#wq-id').setValue('ID1234')
    await wrapper.find('#login-password').setValue('ID1234')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(login).toHaveBeenCalledWith('/v1/session/member', { wqId: 'ID1234', password: 'ID1234', turnstileToken: '' })
    expect(routerPush).toHaveBeenCalledWith('/calendar-settings')
    expect((wrapper.find('#login-password').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('directs members with a custom password to the calendar and retains admin login', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.mocked(login).mockResolvedValue({ user: { role: 'member', country: 'US', passwordChangeRequired: false }, csrfToken: 'csrf' })
    const wrapper = mount(LoginView)
    await wrapper.find('#wq-id').setValue('ID1234')
    await wrapper.find('#login-password').setValue('custom password')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(routerPush).toHaveBeenCalledWith('/')
    // A US member's first login defaults to English if no preference was saved.
    await wrapper.findAll('button').find(button => button.text() === 'Admin')!.trigger('click')
    await wrapper.find('#login-password').setValue('admin password')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(login).toHaveBeenCalledWith('/v1/session/admin', { wqId: 'ID1234', password: 'admin password', turnstileToken: '' })
    expect(routerPush).toHaveBeenCalledWith('/admin')
    wrapper.unmount()
  })
})
