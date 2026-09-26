import { mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { hasRegionalAccess } from '@wq-calendar/shared'
import { api } from '../src/api'
import { session } from '../src/state'
import router from '../src/router'
import App from '../src/App.vue'

vi.mock('../src/api',()=>({api:vi.fn(),ApiError:class ApiError extends Error{},clearCsrf:vi.fn()}))
beforeEach(()=>{
  session.user={role:'member',memberId:'test',country:'US',wqIdHint:'ID01',publicWqId:true,passwordChangeRequired:false,expiresAt:'2099-01-01'}
  vi.mocked(api).mockResolvedValue({user:session.user})
})
it('fails closed for absent country and allows administrators',()=>{
  expect(hasRegionalAccess(null)).toBe(false)
  expect(hasRegionalAccess({role:'member'})).toBe(false)
  expect(hasRegionalAccess({role:'member',country:'US'})).toBe(false)
  expect(hasRegionalAccess({role:'member',country:'CN'})).toBe(true)
  expect(hasRegionalAccess({role:'member',country:'HK'})).toBe(true)
  expect(hasRegionalAccess({role:'admin'})).toBe(true)
})
it('redirects restricted bookmarked routes and hides their navigation links',async()=>{
  for(const path of ['/replays','/replays/submit','/leaderboard']) {
    await router.push(path)
    expect(router.currentRoute.value.path).toBe('/')
  }
  const wrapper=mount(App,{global:{plugins:[router],stubs:{RouterView:true,PasswordReminder:true}}})
  expect(wrapper.find('nav a[href="#/replays"]').exists()).toBe(false)
  expect(wrapper.find('nav a[href="#/leaderboard"]').exists()).toBe(false)
  session.user!.country='HK'
  await router.push('/replays')
  expect(router.currentRoute.value.path).toBe('/replays')
  expect(wrapper.find('nav a[href="#/replays"]').exists()).toBe(true)
  session.user!.role='admin'
  session.user!.country=null
  await router.push('/leaderboard')
  expect(router.currentRoute.value.path).toBe('/leaderboard')
  wrapper.unmount()
})
