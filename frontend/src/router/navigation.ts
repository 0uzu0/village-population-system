/**
 * 导航单一来源。
 *
 * 此前「菜单」和「路由」各维护一份清单：MainLayout 里有 menus 数组，
 * router/index.ts 里有 children 数组，同一个页面的 path / 标题 / 权限码要写两遍。
 * 后果是加一个页面要改两处，改权限时尤其容易只改一处——菜单看不到了、
 * 但直接输 URL 还能进（守卫读的是路由 meta），或者反过来菜单能点、进去被弹回。
 *
 * 现在：这里定义一次，路由与菜单都从它派生。
 * - 路由用它生成 children 与 meta（title 给面包屑与浏览器标题，perm 给全局守卫）
 * - 侧边栏用它渲染并做权限过滤
 *
 * 不是菜单项的页面（人员详情、台账统计）不放进 NAV_ITEMS，
 * 它们没有独立的入口，靠列表页跳转进入，路径写在 router/index.ts 里。
 */

import type { RouteComponent } from 'vue-router';

export interface NavItem {
  /** 菜单与路由共用的路径（以 / 开头） */
  path: string;
  /** 菜单文案。同时写入 meta.title，面包屑与 document.title 都读它 */
  title: string;
  /** Element Plus 图标组件名，需在 main.ts 全局注册 */
  icon: string;
  /** 访问所需权限码。同时写入 meta.perm，由全局前置守卫统一拦截 */
  perm?: string;
  /** 路由组件（懒加载） */
  component: RouteComponent;
}

/**
 * 顺序即菜单顺序，不是按字母排。
 * 「重点人群」紧跟「人口档案」：它本质就是按标签筛人口，与人口档案同源，
 * 隔着家庭/网格/标签三屏会让人找不到。
 */
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/dashboard',
    title: '工作台',
    icon: 'Odometer',
    perm: 'dashboard:view',
    component: () => import('@/views/dashboard/index.vue'),
  },
  {
    path: '/persons',
    title: '人口档案',
    icon: 'User',
    perm: 'person:view',
    component: () => import('@/views/person/index.vue'),
  },
  {
    path: '/key-groups',
    title: '重点人群',
    icon: 'Aim',
    perm: 'keygroup:view',
    component: () => import('@/views/keygroup/index.vue'),
  },
  {
    path: '/families',
    title: '家庭管理',
    icon: 'House',
    perm: 'family:view',
    component: () => import('@/views/family/index.vue'),
  },
  {
    path: '/grids',
    title: '网格管理',
    icon: 'Grid',
    perm: 'grid:view',
    component: () => import('@/views/grid/index.vue'),
  },
  {
    path: '/tags',
    title: '人口标签',
    icon: 'CollectionTag',
    perm: 'tag:view',
    component: () => import('@/views/tag/index.vue'),
  },
  {
    path: '/ledgers',
    title: '专项台账',
    icon: 'Tickets',
    perm: 'ledger:view',
    component: () => import('@/views/ledger/index.vue'),
  },
  {
    path: '/excel',
    title: 'Excel 导入导出',
    icon: 'Document',
    perm: 'excel:import',
    component: () => import('@/views/excel/index.vue'),
  },
  {
    path: '/pending',
    title: '待核查人员',
    icon: 'WarningFilled',
    perm: 'excel:import',
    component: () => import('@/views/pending/index.vue'),
  },
  {
    path: '/users',
    title: '用户与权限',
    icon: 'Setting',
    perm: 'user:view',
    component: () => import('@/views/user/index.vue'),
  },
  {
    path: '/system',
    title: '系统设置',
    icon: 'Tools',
    perm: 'system:view',
    component: () => import('@/views/system/index.vue'),
  },
];
