import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { NAV_ITEMS } from './navigation';

/**
 * 路由表。
 *
 * 菜单页一律由 NAV_ITEMS 派生（见 router/navigation.ts）：标题、权限码只有一份，
 * 不会再出现「菜单改了、守卫没改」这类错位。
 * 这里只额外声明两类页面：
 *   1. 登录页（公开，没有菜单入口）；
 *   2. 非菜单页（人员详情、台账统计）——它们靠列表页跳转进入，不该出现在侧边栏。
 */
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
      ...NAV_ITEMS.map((item) => ({
        path: item.path.replace(/^\//, ''),
        component: item.component,
        meta: { title: item.title, perm: item.perm },
      })),
      // 人员详情：从人口档案 / 重点人群 / 家庭页点击行进入，带 ?from 可原路返回
      {
        path: 'persons/:id',
        component: () => import('@/views/person/detail.vue'),
        meta: { title: '人口详情', perm: 'person:view' },
      },
      // 台账统计：从台账页顶部入口进入，不占菜单
      {
        path: 'ledgers/statistics',
        component: () => import('@/views/ledger/statistics.vue'),
        meta: { title: '台账统计', perm: 'ledger:view' },
      },
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
  // 无权限统一回工作台：停在原页面只会让人反复点、反复被弹
  if (to.meta.perm && !auth.hasPermission(to.meta.perm as string)) {
    next('/dashboard');
    return;
  }
  next();
});

export default router;
