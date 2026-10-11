import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/dashboard/index.vue'), meta: { title: '工作台', perm: 'dashboard:view' } },
      { path: 'persons', name: 'person-list', component: () => import('@/views/person/index.vue'), meta: { title: '人口档案', perm: 'person:view' } },
      { path: 'persons/:id', name: 'person-detail', component: () => import('@/views/person/detail.vue'), meta: { title: '人口详情', perm: 'person:view' } },
      { path: 'families', name: 'family', component: () => import('@/views/family/index.vue'), meta: { title: '家庭管理', perm: 'family:view' } },
      { path: 'grids', name: 'grid', component: () => import('@/views/grid/index.vue'), meta: { title: '网格管理', perm: 'grid:view' } },
      { path: 'tags', name: 'tag', component: () => import('@/views/tag/index.vue'), meta: { title: '人口标签', perm: 'tag:view' } },
      { path: 'key-groups', name: 'keygroup', component: () => import('@/views/keygroup/index.vue'), meta: { title: '重点人群', perm: 'keygroup:view' } },
      { path: 'excel', name: 'excel', component: () => import('@/views/excel/index.vue'), meta: { title: 'Excel 导入导出', perm: 'excel:import' } },
      { path: 'pending', name: 'pending', component: () => import('@/views/pending/index.vue'), meta: { title: '待核查人员', perm: 'excel:import' } },
      { path: 'users', name: 'user', component: () => import('@/views/user/index.vue'), meta: { title: '用户与权限', perm: 'user:view' } },
      { path: 'system', name: 'system', component: () => import('@/views/system/index.vue'), meta: { title: '系统设置', perm: 'system:view' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, _from, next) => {
  const auth = useAuthStore();
  document.title = to.meta.title ? `${to.meta.title} - 村级人口管理系统` : '村级人口管理系统';
  if (to.meta.public) {
    next();
    return;
  }
  if (!auth.isLoggedIn) {
    next({ path: '/login', query: { redirect: to.fullPath } });
    return;
  }
  if (to.meta.perm && !auth.hasPermission(to.meta.perm as string)) {
    next('/dashboard');
    return;
  }
  next();
});

export default router;
