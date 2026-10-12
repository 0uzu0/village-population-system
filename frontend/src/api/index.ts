import request, { get, post, put, del } from './request';
import type { PageResult, UserInfo } from '@/types';

// ===== 认证 =====
export const authApi = {
  login: (data: { username: string; password: string }) => post<{ token: string; user: UserInfo }>('/auth/login', data),
  me: () => get<UserInfo>('/auth/me'),
  changePassword: (data: { oldPassword: string; newPassword: string }) => put('/auth/password', data),
};

// ===== 人员 =====
export const personApi = {
  list: (params: any) => get<PageResult>('/persons', params),
  detail: (id: number) => get(`/persons/${id}`),
  create: (data: any) => post('/persons', data),
  update: (id: number, data: any) => put(`/persons/${id}`, data),
  changeStatus: (id: number, data: any) => post(`/persons/${id}/status`, data),
  batchStatus: (data: any) => post('/persons/batch-status', data),
  changes: (id: number) => get(`/persons/${id}/changes`),
  addTag: (id: number, data: any) => post(`/persons/${id}/tags`, data),
  removeTag: (id: number, linkId: number) => del(`/persons/${id}/tags/${linkId}`),
  batchTags: (data: any) => post('/persons/batch-tags', data),
  remove: (id: number) => del(`/persons/${id}`),
  options: () => get('/persons/meta/options'),
};

// ===== 家庭 =====
export const familyApi = {
  list: (params: any) => get<PageResult>('/families', params),
  detail: (id: number) => get(`/families/${id}`),
  create: (data: any) => post('/families', data),
  update: (id: number, data: any) => put(`/families/${id}`, data),
  addMember: (id: number, data: any) => post(`/families/${id}/members`, data),
  removeMember: (id: number, memberId: number) => del(`/families/${id}/members/${memberId}`),
  changeHead: (id: number, data: any) => post(`/families/${id}/head`, data),
  addTag: (id: number, data: any) => post(`/families/${id}/tags`, data),
  removeTag: (id: number, linkId: number) => del(`/families/${id}/tags/${linkId}`),
  remove: (id: number) => del(`/families/${id}`),
  /** 按门牌号（地址）自动归户；dryRun=1 仅预览 */
  autoGroup: (data: any) => post('/families/auto-group', data),
};

// ===== 网格 =====
export const gridApi = {
  list: (params: any) => get<PageResult>('/grids', params),
  villages: (params?: any) => get('/grids/villages', params),
  detail: (id: number) => get(`/grids/${id}`),
  create: (data: any) => post('/grids', data),
  update: (id: number, data: any) => put(`/grids/${id}`, data),
  transferPerson: (data: any) => post('/grids/transfer-person', data),
  remove: (id: number) => del(`/grids/${id}`),
};

// ===== 标签 =====
export const tagApi = {
  categories: () => get('/tags/categories'),
  createCategory: (data: any) => post('/tags/categories', data),
  updateCategory: (id: number, data: any) => put(`/tags/categories/${id}`, data),
  definitions: (params: any) => get<PageResult>('/tags/definitions', params),
  createDefinition: (data: any) => post('/tags/definitions', data),
  updateDefinition: (id: number, data: any) => put(`/tags/definitions/${id}`, data),
  toggleDefinition: (id: number) => post(`/tags/definitions/${id}/toggle`),
  removeDefinition: (id: number) => del(`/tags/definitions/${id}`),
  history: (params: any) => get<PageResult>('/tags/history', params),
};

// ===== 重点人群 =====
export const keyGroupApi = {
  quick: () => get('/key-groups/quick'),
  query: (params: any) => get('/key-groups/query', params),
};

// ===== 统计 =====
export const statisticsApi = {
  dashboard: () => get('/statistics/dashboard'),
  distributions: () => get('/statistics/distributions'),
  changes: () => get('/statistics/changes'),
  imports: () => get('/statistics/imports'),
};

// ===== Excel =====
export const excelApi = {
  template: () => request.get('/excel/template', { responseType: 'blob' }),
  import: (formData: FormData) => post('/excel/import', formData),
  keyGroupTypes: () => get('/excel/key-group/types'),
  keyGroupTemplate: () => request.get('/excel/template/key-group', { responseType: 'blob' }),
  importKeyGroup: (formData: FormData) => post('/excel/import-key-group', formData),
  specialTypes: () => get('/excel/special/types'),
  specialTemplate: (type: string) => request.get(`/excel/template/special/${type}`, { responseType: 'blob' }),
  importSpecial: (formData: FormData) => post('/excel/import-special', formData),
  importTasks: (params: any) => get<PageResult>('/excel/import-tasks', params),
  importErrors: (id: number) => get(`/excel/import-tasks/${id}/errors`),
  export: (data: any) => post('/excel/export', data),
  exportTasks: () => get('/excel/export-tasks'),
  downloadExport: (id: number) => request.get(`/excel/export-tasks/${id}/download`, { responseType: 'blob' }),
  downloadErrors: (id: number) => request.get(`/excel/import-tasks/${id}/errors/download`, { responseType: 'blob' }),
};

// ===== 导入待核查人员 =====
export const pendingApi = {
  list: (params: any) => get<PageResult>('/pending', params),
  summary: () => get('/pending/summary'),
  detail: (id: number) => get(`/pending/${id}`),
  update: (id: number, data: any) => put(`/pending/${id}`, data),
  confirm: (id: number, data?: any) => post(`/pending/${id}/confirm`, data || {}),
  ignore: (id: number, data?: any) => post(`/pending/${id}/ignore`, data || {}),
  remove: (id: number) => del(`/pending/${id}`),
  batchDelete: (ids: number[]) => post('/pending/batch-delete', { ids }),
};

// ===== 用户与权限 =====
export const userApi = {
  list: (params: any) => get<PageResult>('/users', params),
  create: (data: any) => post('/users', data),
  update: (id: number, data: any) => put(`/users/${id}`, data),
  toggle: (id: number) => post(`/users/${id}/toggle`),
  roles: () => get('/users/roles'),
  permissions: () => get('/users/permissions'),
};

// ===== 审计 =====
export const auditApi = {
  list: (params: any) => get<PageResult>('/audit-logs', params),
  dicts: (type: string) => get(`/audit-logs/dicts/${type}`),
};
