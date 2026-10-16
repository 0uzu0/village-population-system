<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="brand-icon">村</div>
        <div>
          <h1 class="brand-title">村级人口管理系统</h1>
          <p class="brand-sub">人口与重点人群精细化管理平台</p>
        </div>
      </div>
      <el-form :model="form" @keyup.enter="submit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="请输入账号" size="large">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" size="large">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="submit">
          登 录
        </el-button>
      </el-form>
      <p class="tip">初始账号 admin，密码 Admin@123456（首次登录请修改）</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { authApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const form = ref({ username: 'admin', password: '' });
const loading = ref(false);

async function submit() {
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请输入账号和密码');
    return;
  }
  loading.value = true;
  try {
    const res = await authApi.login(form.value);
    auth.setLogin(res.data.token, res.data.user);
    ElMessage.success('登录成功');
    const redirect = (route.query.redirect as string) || '/dashboard';
    router.push(redirect);
  } catch {
    // 错误已由拦截器提示
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-page);
  background-image: radial-gradient(circle at 20% 20%, var(--color-primary-light) 0, transparent 40%),
    radial-gradient(circle at 80% 80%, #e4f4f0 0, transparent 40%);
}
.login-card {
  width: 400px;
  max-width: 92vw;
  background: var(--color-bg-card);
  border-radius: var(--radius-container);
  padding: 40px 36px;
  box-shadow: var(--shadow-modal);
}
.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}
.brand-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--color-primary);
  color: #fff;
  font-size: var(--font-size-xl);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  margin: 0;
  color: var(--color-text-primary);
}
.brand-sub {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 2px 0 0;
}
.login-btn {
  width: 100%;
  height: 44px;
  margin-top: 4px;
  font-size: var(--font-size-md);
}
.tip {
  margin-top: 16px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-placeholder);
}
</style>
