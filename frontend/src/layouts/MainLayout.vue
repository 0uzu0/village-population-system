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

      <main class="content">
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
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/api';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const collapsed = ref(false);
const pwdVisible = ref(false);
const pwdLoading = ref(false);
const pwdForm = ref({ oldPassword: '', newPassword: '' });

interface MenuItem {
  path: string;
  title: string;
  icon: string;
  perm?: string;
}

const menus: MenuItem[] = [
  { path: '/dashboard', title: '工作台', icon: 'Odometer' },
  { path: '/persons', title: '人口档案', icon: 'User', perm: 'person:view' },
  { path: '/families', title: '家庭管理', icon: 'House', perm: 'family:view' },
  { path: '/grids', title: '网格管理', icon: 'Grid', perm: 'grid:view' },
  { path: '/tags', title: '人口标签', icon: 'CollectionTag', perm: 'tag:view' },
  { path: '/key-groups', title: '重点人群', icon: 'Aim', perm: 'keygroup:view' },
  { path: '/excel', title: 'Excel 导入导出', icon: 'Document', perm: 'excel:import' },
  { path: '/pending', title: '待核查人员', icon: 'WarningFilled', perm: 'excel:import' },
  { path: '/users', title: '用户与权限', icon: 'Setting', perm: 'user:view' },
  { path: '/system', title: '系统设置', icon: 'Tools', perm: 'system:view' },
];

const visibleMenus = computed(() => menus.filter((m) => !m.perm || auth.hasPermission(m.perm)));

const activeMenu = computed(() => {
  const path = route.path;
  if (path.startsWith('/persons')) return '/persons';
  return path;
});

const currentTitle = computed(() => route.meta.title as string | undefined);

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
    await authApi.changePassword(pwdForm.value);
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
