/**
 * 页面跳转辅助：让「从哪进来，就退回哪去」。
 *
 * 列表页跳转详情时把来源页的完整地址（含筛选条件）通过 `from` 带给详情页，
 * 详情页的返回按钮与面包屑据此原样退回，而不是一律回到人口档案。
 */
import type { RouteLocationNormalizedLoaded } from 'vue-router';

/** 列表页路径 → 菜单标题，用于详情页面包屑显示来源页名称 */
const PAGE_TITLES: Record<string, string> = {
  '/persons': '人口档案',
  '/key-groups': '重点人群',
  '/families': '家庭管理',
  '/grids': '网格管理',
  '/pending': '待核查人员',
  '/dashboard': '工作台',
  '/tags': '人口标签',
};

/** 跳转人员详情：附带来源页完整地址（含查询条件），便于返回时还原现场 */
export function toPersonDetail(route: RouteLocationNormalizedLoaded, id: number | string) {
  return { path: `/persons/${id}`, query: { from: route.fullPath } };
}

/** 详情页解析来源页；缺省（直接输地址、刷新丢失）时回退到人口档案 */
export function parseFrom(route: RouteLocationNormalizedLoaded): { path: string; title: string } {
  const raw = typeof route.query.from === 'string' ? route.query.from : '';
  const path = raw.startsWith('/persons/') || !raw ? '/persons' : raw;
  const pathname = path.split('?')[0];
  const title = PAGE_TITLES[pathname] || PAGE_TITLES[`/${pathname.split('/')[1]}`] || '返回';
  return { path, title };
}
