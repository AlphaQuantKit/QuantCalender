import { createRouter, createWebHashHistory } from 'vue-router'
import { bootstrapSession, regionalAccess, session } from './state'
import LoginView from './views/LoginView.vue'
import CalendarView from './views/CalendarView.vue'
import MeetingDetailView from './views/MeetingDetailView.vue'
import MySubmissionsView from './views/MySubmissionsView.vue'
import CalendarSettingsView from './views/CalendarSettingsView.vue'
import AdminView from './views/AdminView.vue'
import AboutView from './views/AboutView.vue'
import LeaderboardView from './views/LeaderboardView.vue'
import ReplaysView from './views/ReplaysView.vue'
import ReplaySubmitView from './views/ReplaySubmitView.vue'
import ImportantItemsView from './views/ImportantItemsView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/', component: CalendarView },
    { path: '/meetings/:id', component: MeetingDetailView },
    { path: '/replays', component: ReplaysView },
    { path: '/important-items', component: ImportantItemsView },
    { path: '/replays/submit', component: ReplaySubmitView, meta: { member: true } },
    { path: '/submit', redirect: { path: '/', query: { submit: '1' } } },
    { path: '/submissions', component: MySubmissionsView, meta: { member: true } },
    { path: '/calendar-settings', component: CalendarSettingsView, meta: { member: true } },
    { path: '/leaderboard', component: LeaderboardView },
    { path: '/admin', component: AdminView, meta: { admin: true } },
    { path: '/guide', component: AboutView },
    { path: '/about', redirect: '/guide' },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach(async (to) => {
  await bootstrapSession()
  if (to.meta.public) return session.user ? '/' : true
  if (!session.user) return '/login'
  if (!regionalAccess.value && (to.path.startsWith('/replays') || to.path === '/leaderboard')) return '/'
  if (to.meta.admin && session.user.role !== 'admin') return '/'
  if (to.meta.member && session.user.role !== 'member') return '/admin'
  return true
})

export default router
