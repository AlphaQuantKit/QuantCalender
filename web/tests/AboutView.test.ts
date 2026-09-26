import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AboutView from '../src/views/AboutView.vue'
import { session } from '../src/state'

describe('member guide', () => {
  it('shows member workflows instead of the old explanation content', () => {
    session.user = { role:'member', memberId:'test', wqIdHint:'TEST01', country:'CN', publicWqId:true, passwordChangeRequired:false, expiresAt:'2099-01-01' }
    const wrapper = mount(AboutView, {
      global: {
        stubs: {
          RouterLink: { props: ['to'], template: '<a><slot /></a>' }
        }
      }
    })

    expect(wrapper.text()).toContain('成员使用指南')
    expect(wrapper.text()).toContain('WQ 日历集中提供会议日历、回放、重要事项和排行榜')
    expect(wrapper.text()).toContain('使用会议日历')
    expect(wrapper.text()).toContain('浏览与贡献回放')
    expect(wrapper.text()).toContain('查看与投稿重要事项')
    expect(wrapper.text()).toContain('查看投稿审核结果')
    expect(wrapper.text()).toContain('查看排行榜与贡献者身份')
    expect(wrapper.text()).toContain('订阅个人日历与设置提醒')
    expect(wrapper.text()).toContain('旧地址立即失效')
    expect(wrapper.text()).not.toContain('身份说明')
    expect(wrapper.text()).not.toContain('数据最小化')
    expect(wrapper.find('.panel-grid').exists()).toBe(false)
    expect(wrapper.findAll('.guide-step')).toHaveLength(6)
  })
})
