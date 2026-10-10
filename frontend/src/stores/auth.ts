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
