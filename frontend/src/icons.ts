import type { App } from 'vue';
import {
  Aim,
  ArrowDown,
  ArrowLeft,
  CollectionTag,
  DataAnalysis,
  Document,
  Download,
  Expand,
  FirstAidKit,
  Flag,
  Fold,
  Grape,
  Grid,
  HomeFilled,
  House,
  InfoFilled,
  Lock,
  MagicStick,
  Medal,
  Odometer,
  Operation,
  Picture,
  Plus,
  Refresh,
  Search,
  Setting,
  Star,
  Tools,
  Tickets,
  Upload,
  User,
  UserFilled,
  WarningFilled,
} from '@element-plus/icons-vue';

/**
 * 按需注册的图标表（key 即全局组件名）
 *
 * 早前 main.ts 用 `import * as ElementPlusIconsVue` 全量注册：
 * namespace 导入无法被摇树，293 个图标全部打进产物，其中 260 多个从未被引用。
 * 这里只列出真正用到的图标，其余交由构建器摇除。
 *
 * ⚠️ 注意：侧边菜单（MainLayout.menuItems）和统计卡片（dashboard.statCards）
 * 用 `<component :is="'Grid'">` 这类**字符串**动态渲染，依赖全局注册名解析。
 * 因此新增图标时必须同步加进这张表，否则运行时会静默渲染成空白。
 */
export const ICONS = {
  Aim,
  ArrowDown,
  ArrowLeft,
  CollectionTag,
  DataAnalysis,
  Document,
  Download,
  Expand,
  FirstAidKit,
  Flag,
  Fold,
  Grape,
  Grid,
  HomeFilled,
  House,
  InfoFilled,
  Lock,
  MagicStick,
  Medal,
  Odometer,
  Operation,
  Picture,
  Plus,
  Refresh,
  Search,
  Setting,
  Star,
  Tools,
  Tickets,
  Upload,
  User,
  UserFilled,
  WarningFilled,
} as const;

/** 已注册的图标名，便于在测试或调试时核对 */
export const ICON_NAMES = Object.keys(ICONS);

/** 把图标注册为全局组件 */
export function registerIcons(app: App): void {
  for (const [name, component] of Object.entries(ICONS)) {
    app.component(name, component);
  }
}
