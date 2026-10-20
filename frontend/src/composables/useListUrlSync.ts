import { reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * 列表页「筛选条件 ↔ 地址栏」同步。
 *
 * 解决的问题：人员列表与重点人群筛查各自手写了一份 syncUrl/restoreQuery/resetQuery
 * （字段一多就上百行，且极易漏字段——加了新筛选条件却忘记同步到地址栏，
 * 从详情页返回时现场就丢了）。这里把「哪些字段要同步、怎么编解码」声明出来，
 * 其余逻辑共用一份。
 *
 * 序列化约定：
 *  - string  ：空串视为未设置，不写入 URL
 *  - number  ：null / undefined 视为未设置
 *  - numberArray：逗号连接，空数组视为未设置
 *  - stringArray：同 numberArray，但元素是字符串（如村庄名多选）
 *  - defaultValue：与默认值相同的字段不写入 URL（避免 ?tagMode=ANY 这种噪声）
 *  - extras  ：额外布尔开关（如「只看在册」），等于默认值时不写入 URL
 */
export type FieldType = 'string' | 'number' | 'numberArray' | 'stringArray';

export interface UrlField {
  /** query 对象里的字段名 */
  key: string;
  /** URL 参数名，默认与 key 相同（用于历史遗留的短名，如 dlMin/dType） */
  urlKey?: string;
  type?: FieldType;
  /** 与默认值相同则不写入 URL（默认值本身由 initial() 提供，可省略） */
  defaultValue?: any;
  /**
   * 自定义解析。返回 undefined 表示该值非法、按未设置处理。
   * 用于枚举型字段——不能让地址栏里的任意字符串直接灌进 query，
   * 否则非法值会被原样发给后端，把一次静默忽略变成 400。
   */
  parse?: (raw: string) => any;
}

export interface UseListUrlSyncOptions<Q extends Record<string, any>> {
  /** 路由路径，用于 router.replace */
  path: string;
  /** 查询初始值：既用于重置，也用作「与默认相同就不写进 URL」的比较基准 */
  initial: () => Q;
  /** 需要同步到地址栏的字段 */
  fields: UrlField[];
  /**
   * 额外同步的布尔开关。传 ref 本身，第二个参数是其默认值。
   * 兼容写法：extras: { activeOnly: true } 配合第二个返回值使用。
   */
  extras?: Record<string, { ref: { value: any }; defaultValue: any }>;
}

export function useListUrlSync<Q extends Record<string, any>>(opts: UseListUrlSyncOptions<Q>) {
  const route = useRoute();
  const router = useRouter();
  // 只取一次初始值里的分页默认量：不要整体缓存 initial() 的对象，
  // 否则 reset 时会把同一个数组引用写回 query（后续修改会串味）
  const { page: DEFAULT_PAGE = 1, pageSize: DEFAULT_PAGE_SIZE = 20 } = opts.initial();
  const query = reactive(opts.initial()) as Q;

  const isEmpty = (v: any, type: FieldType) =>
    type === 'numberArray' || type === 'stringArray'
      ? !Array.isArray(v) || v.length === 0
      : v === null || v === undefined || v === '';

  /** 把筛选条件写入地址栏；与默认值相同的字段不写，保持链接干净 */
  function syncUrl() {
    const q: Record<string, string> = {};
    for (const f of opts.fields) {
      const type = f.type || 'string';
      const value = (query as any)[f.key];
      if (isEmpty(value, type)) continue;
      if (f.defaultValue !== undefined && value === f.defaultValue) continue;
      q[f.urlKey || f.key] = type === 'numberArray' || type === 'stringArray' ? value.join(',') : String(value);
    }
    for (const [name, spec] of Object.entries(opts.extras || {})) {
      if (spec.ref.value !== spec.defaultValue) q[name] = String(spec.ref.value);
    }
    if ((query as any).page > DEFAULT_PAGE) q.page = String((query as any).page);
    if ((query as any).pageSize !== DEFAULT_PAGE_SIZE) q.pageSize = String((query as any).pageSize);
    router.replace({ path: opts.path, query: q });
  }

  /** 从地址栏恢复筛选条件（详情页返回、或直接粘贴带条件的链接） */
  function restoreQuery() {
    const rq = route.query;
    for (const f of opts.fields) {
      const raw = rq[f.urlKey || f.key];
      if (raw === undefined || raw === '') continue;
      if (f.parse) {
        const parsed = f.parse(String(raw));
        if (parsed === undefined) continue;
        (query as any)[f.key] = parsed;
        continue;
      }
      const type = f.type || 'string';
      if (type === 'number') {
        const n = Number(raw);
        if (!Number.isNaN(n)) (query as any)[f.key] = n;
      } else if (type === 'numberArray') {
        (query as any)[f.key] = String(raw)
          .split(',')
          .map((s) => Number(s))
          .filter((n) => !Number.isNaN(n));
      } else if (type === 'stringArray') {
        (query as any)[f.key] = String(raw).split(',').filter((s) => s !== '');
      } else {
        (query as any)[f.key] = String(raw);
      }
    }
    for (const [name, spec] of Object.entries(opts.extras || {})) {
      const raw = (rq as any)[name];
      if (raw === undefined) continue;
      spec.ref.value = String(raw) === String(spec.defaultValue);
    }
    if (rq.page) (query as any).page = Number(rq.page) || DEFAULT_PAGE;
    if (rq.pageSize) (query as any).pageSize = Number(rq.pageSize) || DEFAULT_PAGE_SIZE;
  }

  /** 重置为初始值（不触发加载，由调用方决定是否重新查询） */
  function resetQuery() {
    Object.assign(query as any, opts.initial());
    for (const spec of Object.values(opts.extras || {})) spec.ref.value = spec.defaultValue;
  }

  /**
   * 组装请求参数：数组字段转成逗号串、布尔开关转成 'true'/'false'。
   * 原先每个页面都要手写一遍「长度不为 0 才传」，漏写就会出现空数组传参。
   */
  function buildParams(): Record<string, any> {
    const params: Record<string, any> = { ...(query as any) };
    for (const f of opts.fields) {
      if (f.type === 'numberArray' || f.type === 'stringArray') {
        if ((query as any)[f.key]?.length) params[f.key] = (query as any)[f.key].join(',');
        else delete params[f.key];
      }
    }
    for (const [name, spec] of Object.entries(opts.extras || {})) {
      params[name] = typeof spec.ref.value === 'boolean' ? String(spec.ref.value) : spec.ref.value;
    }
    return params;
  }

  return { query, syncUrl, restoreQuery, resetQuery, buildParams };
}
