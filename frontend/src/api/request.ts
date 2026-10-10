import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiResult } from '@/types';

const request: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

// 请求拦截：注入 token
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('vp_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截：统一处理错误
request.interceptors.response.use(
  (response) => {
    const res = response.data;
    // 文件流直接返回
    if (response.config.responseType === 'blob') return response;
    if (res && res.code === 0) return res;
    ElMessage.error(res?.message || '请求失败');
    return Promise.reject(new Error(res?.message || '请求失败'));
  },
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message || '网络错误';
    if (status === 401) {
      localStorage.removeItem('vp_token');
      localStorage.removeItem('vp_user');
      window.location.href = '/login';
    } else if (status === 403) {
      ElMessage.error(message || '无操作权限');
    } else {
      ElMessage.error(message);
    }
    return Promise.reject(error);
  }
);

export default request;

/** 泛型请求方法（返回已解包 data 的 ApiResult） */
export function get<T = any>(url: string, params?: any): Promise<ApiResult<T>> {
  return request.get(url, { params }) as unknown as Promise<ApiResult<T>>;
}

export function post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResult<T>> {
  return request.post(url, data, config) as unknown as Promise<ApiResult<T>>;
}

export function put<T = any>(url: string, data?: any): Promise<ApiResult<T>> {
  return request.put(url, data) as unknown as Promise<ApiResult<T>>;
}

export function del<T = any>(url: string, params?: any): Promise<ApiResult<T>> {
  return request.delete(url, { params }) as unknown as Promise<ApiResult<T>>;
}
