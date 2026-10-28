<template>
  <div class="layout">
    <!-- 侧边栏 -->
    <aside class="sidebar" :class="{ collapsed }">
      <div class="logo" @click="router.push('/dashboard')">
        <div class="logo-icon">村</div>
        <span v-if="!collapsed" class="logo-text">村级人口管理</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        class="menu"
      >
        <el-menu-item v-for="item in visibleMenus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>

      <!--
        当前构建标识。部署后如果发现「新功能没上线」，先看这里：
        版本/时间和刚构建的那版对不上，就说明跑的还是旧包（镜像没更新或缓存了旧 HTML），
        而不是功能没做。
      -->
      <div v-if="!collapsed" class="build-stamp" :title="`当前页面构建于 ${buildLabel}`">{{ buildLabel }}</div>
    </aside>

    <!-- 主区域 -->
    <div class="main">
      <header class="header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="collapsed = !collapsed">
            <Fold v-if="!collapsed" /><Expand v-else />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>工作台</el-breadcrumb-item>
            <el-breadcrumb-item v-if="currentTitle">{{ currentTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click" @command="onCommand">
            <div class="user-info">
              <el-avatar :size="32" class="avatar">{{ avatarText }}</el-avatar>
              <span class="user-name">{{ auth.user?.realName || auth.user?.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main ref="contentRef" class="content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

    <!-- 修改密码弹窗 -->
    <el-dialog v-model="pwdVisible" title="修改密码" width="420px">
      <el-form :model="pwdForm" label-width="90px">
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少8位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdLoading" @click="submitPassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { NAV_ITEMS } from '@/router/navigation';
import { authApi } from '@/api';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const collapsed = ref(false);
/** 内容滚动容器。切换路由后要手动把它滚回顶部，理由见下面的 watch */
const contentRef = ref<HTMLElement | null>(null);
const pwdVisible = ref(false);
const pwdLoading = ref(false);
const pwdForm = ref({ oldPassword: '', newPassword: '' });

/**
 * 构建版本（编译期常量，见 vite.config.ts 的 define）。
 * 先赋给局部变量再用到模板里：直接写 __APP_BUILD__ 会被模板编译器
 * 当成 `_ctx.__APP_BUILD__`，而 define 的文本替换会让它变成 `_ctx."v1.0.0 · ..."`
 * 这种语法错误。
 */
const buildLabel = __APP_BUILD__;

/**
 * 菜单直接由 NAV_ITEMS 派生（router/navigation.ts）。
 * 不再在这里维护第二份 path/title/perm 清单——那样改权限时极易只改一处，
 * 出现「菜单能点、进去被弹回」或「菜单消失、直接输 URL 却能进」。
 */
const visibleMenus = computed(() => NAV_ITEMS.filter((m) => !m.perm || auth.hasPermission(m.perm)));

const activeMenu = computed(() => {
  const path = route.path;
  if (path.startsWith('/persons')) return '/persons';
  if (path.startsWith('/ledgers')) return '/ledgers';
  return path;
});

const currentTitle = computed(() => route.meta.title as string | undefined);

/**
 * 切换路由后把内容区滚回顶部。
 *
 * 为什么非要手动做：本布局的滚动容器是 `.content`（overflow-y: auto），
 * 滚动条在它身上而**不在 window 上**。vue-router 的 `scrollBehavior`
 * 只对 window 滚动生效，对这种内部容器完全无效——于是在列表页往下滚一段
 * 再点进某个人的详情，新页面会「停在页面最下方」。
 *
 * 用 nextTick 等新页面挂载完再滚，否则可能滚了个还在旧内容的高度。
 */
watch(
  () => route.path,
  async () => {
    await nextTick();
    contentRef.value?.scrollTo({ top: 0 });
  }
);

const avatarText = computed(() => (auth.user?.realName || auth.user?.username || '?').charAt(0));

function onCommand(cmd: string) {
  if (cmd === 'logout') {
    ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' }).then(() => {
      auth.logout();
      router.push('/login');
    }).catch(() => {});
  } else if (cmd === 'password') {
    pwdForm.value = { oldPassword: '', newPassword: '' };
    pwdVisible.value = true;
  }
}

async function submitPassword() {
  if (!pwdForm.value.oldPassword || !pwdForm.value.newPassword) {
    ElMessage.warning('请填写完整');
    return;
  }
  pwdLoading.value = true;
  try {
    const res: any = await authApi.changePassword(pwdForm.value);
    // 后端改密后作废其他设备的旧 token，并为当前设备换发新 token
    if (res?.data?.token) auth.setToken(res.data.token);
    ElMessage.success('密码修改成功');
    pwdVisible.value = false;
  } finally {
    pwdLoading.value = false;
  }
}
</script>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  width: var(--sidebar-width);
  height: 100%;
  background: var(--color-bg-card);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  transition: width var(--transition-base);
  flex-shrink: 0;
  padding: 16px 12px;
  box-sizing: border-box;
}
.sidebar.collapsed {
  width: var(--sidebar-width-collapsed);
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 16px;
  cursor: pointer;
}
.logo-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--color-primary);
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-lg);
  flex-shrink: 0;
}
.logo-text {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
}
.menu {
  border-right: none;
  flex: 1;
}
/* 侧栏底部的构建标识：不抢视觉，但更新后要能一眼找到 */
.build-stamp {
  padding: 0 8px 4px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu :deep(.el-menu-item) {
  border-radius: var(--radius-button);
  margin-bottom: 4px;
  height: 44px;
}
.menu :deep(.el-menu-item.is-active) {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.header {
  height: var(--header-height);
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.collapse-btn {
  cursor: pointer;
  font-size: var(--font-size-lg);
  color: var(--color-text-secondary);
}
.header-right {
  display: flex;
  align-items: center;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-button);
}
.user-info:hover {
  background: var(--color-bg-hover);
}
.avatar {
  background: var(--color-primary);
}
.user-name {
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  padding-bottom: env(safe-area-inset-bottom);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--transition-fast);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    z-index: 100;
    transform: translateX(-100%);
  }
  .sidebar.collapsed {
    transform: translateX(0);
    width: var(--sidebar-width);
  }
  .content {
    padding: 12px;
  }
}
</style>
