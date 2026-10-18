import { defineStore } from 'pinia';
import type { UserInfo } from '@/types';

interface AuthState {
  token: string;
  user: UserInfo | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: localStorage.getItem('vp_token') || '',
    user: JSON.parse(localStorage.getItem('vp_user') || 'null'),
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
    permissions: (state) => state.user?.permissions || [],
    isAdmin: (state) => !!state.user?.isAdmin,
  },
  actions: {
    setLogin(token: string, user: UserInfo) {
      this.token = token;
      this.user = user;
      localStorage.setItem('vp_token', token);
      localStorage.setItem('vp_user', JSON.stringify(user));
    },
    /**
     * 只替换 token，不动用户信息。
     * 用在改密码之后：服务端会把其他设备的旧 token 作废，同时给本机换发一张
     * 新 token，前端存下来才不会在改完密码后被自己的操作踢下线。
     */
    setToken(token: string) {
      this.token = token;
      localStorage.setItem('vp_token', token);
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('vp_token');
      localStorage.removeItem('vp_user');
    },
    hasPermission(code: string): boolean {
      return this.isAdmin || this.permissions.includes(code);
    },
  },
});
