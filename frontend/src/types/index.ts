// 通用响应结构
export interface ApiResult<T = any> {
  code: number;
  message: string;
  data: T;
}

export interface PageResult<T = any> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 登录用户
export interface UserInfo {
  id: number;
  username: string;
  realName: string;
  isAdmin: boolean;
  roles: string[];
  permissions: string[];
}

export interface TagItem {
  id: number;
  name: string;
  code: string;
  color: string;
}

export interface PersonItem {
  id: number;
  personNo: string;
  name: string;
  formerName?: string;
  gender: string;
  birthDate?: string;
  age?: number;
  idCard?: string;
  phone?: string;
  hukouAddress?: string;
  liveAddress?: string;
  village?: string;
  gridId?: number;
  gridName?: string;
  familyId?: number;
  familyName?: string;
  relation?: string;
  status: string;
  /** 状态生效日期：死亡日期 / 迁出日期 */
  statusDate?: string | null;
  remark?: string;
  dataSource?: string;
  updatedAt?: string;
  tags: TagItem[];
}
