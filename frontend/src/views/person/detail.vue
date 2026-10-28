<template>
  <div v-loading="loading" class="detail-page">
    <div class="vp-page-header">
      <div>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ path: back.path }">{{ back.title }}</el-breadcrumb-item>
          <el-breadcrumb-item>人员详情</el-breadcrumb-item>
        </el-breadcrumb>
        <h2 class="vp-page-title" style="margin-top: 8px">{{ person?.name }} <span class="no">{{ person?.personNo }}</span></h2>
      </div>
      <div class="actions">
        <el-button v-if="auth.hasPermission('person:status')" @click="statusVisible = true">
          <el-icon><Refresh /></el-icon>变更状态
        </el-button>
        <el-button type="primary" @click="goBack">返回{{ back.title }}</el-button>
      </div>
    </div>

    <div class="grid">
      <!-- 基本信息 -->
      <div class="vp-card">
        <div class="card-title">基本信息</div>
        <el-descriptions :column="3" border>
          <el-descriptions-item label="姓名">{{ person?.name }}</el-descriptions-item>
          <el-descriptions-item label="曾用名">{{ person?.formerName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="性别">{{ genderLabel(person?.gender) }}</el-descriptions-item>
          <el-descriptions-item label="出生日期">{{ person?.birthDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="年龄">{{ person?.age ?? '—' }} 岁</el-descriptions-item>
          <el-descriptions-item label="人员状态">
            <el-tag size="small" :type="statusTag(person?.status)">{{ statusLabel(person?.status) }}</el-tag>
            <span v-if="person?.statusDate" class="date-hint">{{ person.statusDate }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="身份证号">{{ person?.idCard || '—' }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">{{ person?.phone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="备用手机号">{{ person?.phoneBackup || '—' }}</el-descriptions-item>
          <el-descriptions-item label="数据来源">{{ person?.dataSource === 'EXCEL_IMPORT' ? 'Excel导入' : '手工录入' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 家庭与居住 -->
      <div class="vp-card">
        <div class="card-title">家庭与居住信息</div>
        <el-descriptions :column="3" border>
          <el-descriptions-item label="所属家庭">{{ person?.familyName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="与户主关系">{{ relationLabel(person?.relation) }}</el-descriptions-item>
          <el-descriptions-item label="所属网格">{{ person?.gridName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="所属村庄">{{ person?.village || '—' }}</el-descriptions-item>
          <el-descriptions-item label="户籍地址" :span="2">{{ person?.hukouAddress || '—' }}</el-descriptions-item>
          <el-descriptions-item label="实际居住地址" :span="3">{{ person?.liveAddress || '—' }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="3">{{ person?.remark || '—' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 补贴发放与走访评估（V008） -->
      <div class="vp-card">
        <div class="card-title">补贴发放与走访评估</div>
        <el-descriptions :column="3" border>
          <el-descriptions-item label="银行账号">{{ person?.bankAccount || '—' }}</el-descriptions-item>
          <el-descriptions-item label="发放金额">
            <span v-if="person?.subsidyAmount != null">{{ money(person.subsidyAmount) }} 元/月</span>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="特困供养方式">
            <el-tag v-if="extremePovertyMode" size="small" :type="extremePovertyMode === 'CENTRALIZED' ? 'danger' : 'warning'">
              {{ extremePovertyMode === 'CENTRALIZED' ? '集中供养' : '分散供养' }}
            </el-tag>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="家庭情况描述" :span="3">
            <span class="multiline">{{ person?.familyCondition || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="身体评估结果" :span="3">
            <span class="multiline">{{ person?.healthAssessment || '—' }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 残疾专项档案（V008，仅残疾人有记录） -->
      <div class="vp-card">
        <div class="card-title">
          残疾信息
          <el-tag v-if="person?.disability" size="small" type="success" effect="light">已建档</el-tag>
        </div>
        <el-descriptions v-if="person?.disability" :column="3" border>
          <el-descriptions-item label="残疾类别">{{ person.disability.type || '—' }}</el-descriptions-item>
          <el-descriptions-item label="残疾等级">{{ person.disability.levelLabel || '—' }}</el-descriptions-item>
          <el-descriptions-item label="残疾证号">{{ person.disability.card || '—' }}</el-descriptions-item>
          <el-descriptions-item label="监护人">{{ person.disability.guardianName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="监护人手机">{{ person.disability.guardianPhone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ person.disability.remark || '—' }}</el-descriptions-item>
        </el-descriptions>
        <el-empty v-else description="暂无残疾建档信息" :image-size="60" />
      </div>

      <!-- 人口标签 -->
      <div class="vp-card">
        <div class="card-title">人口标签</div>
        <div v-if="person?.tags?.length" class="tags">
          <div v-for="t in person.tags" :key="t.linkId" class="tag-item">
            <TagPill :name="t.name" :color="t.color" />
            <span class="tag-status">{{ linkStatusLabel(t.status) }}</span>
            <span class="tag-basis" v-if="t.basis">依据：{{ t.basis }}</span>
          </div>
        </div>
        <el-empty v-else description="暂无标签" :image-size="60" />
      </div>

      <!-- 现场照片：移动端「拍照留痕」上传后挂在这个人身上（biz_type=PERSON, biz_id=人员id） -->
      <div class="vp-card">
        <div class="card-title">
          现场照片
          <span v-if="photos.length" class="date-hint">共 {{ photos.length }} 张</span>
        </div>
        <div v-if="photos.length" class="photos">
          <div v-for="p in photos" :key="p.id" class="photo">
            <!-- 图片接口要 Bearer 头，不能把直链给 img（必然 401），
                 这里用的是页面加载时取回的 blob URL -->
            <div class="photo-frame" @click="openViewer(p)">
              <!-- 网格里放的是缩略图（长边 320px webp，几十 KB）：2–5MB 的原片
                   只在点开大图时才取，否则几张照片就能把详情页拖到十几秒 -->
              <img v-if="photoThumbUrls[p.id]" :src="photoThumbUrls[p.id]" :alt="p.fileName || '现场照片'" loading="lazy" />
              <div v-else class="photo-loading">加载中…</div>
              <!--
                删除做成图片角上的悬浮按钮。
                以前它是缩略图下面一行里的一个文字链，与文件名、拍摄时间同处 160px 的格子，
                三者互相挤宽度——名字被截断、时间看不全、删除键还常常点不准。
              -->
              <button
                v-if="canRemovePhoto"
                type="button"
                class="photo-del"
                :title="`删除「${p.fileName || '现场照片'}」`"
                @click.stop="removePhoto(p)"
              >
                <el-icon><Delete /></el-icon>
              </button>
            </div>
            <div class="photo-meta">
              <span class="photo-name" :title="photoNameFull(p)">{{ photoNameFull(p) }}</span>
              <span class="photo-time" :title="photoTimeFull(p)">{{ photoTimeLabel(p) }}</span>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无现场照片（移动端「拍照留痕」上传后在此显示）" :image-size="60" />
      </div>

      <!-- 变更历史 -->
      <div class="vp-card">
        <div class="card-title">档案变更历史</div>
        <el-table :data="person?.changes || []" size="small" max-height="300">
          <el-table-column prop="change_type" label="类型" width="100">
            <template #default="{ row }">{{ typeLabel(row.change_type) }}</template>
          </el-table-column>
          <el-table-column prop="field_name" label="字段" width="100" />
          <el-table-column prop="old_value" label="旧值" show-overflow-tooltip>
            <template #default="{ row }">{{ row.field_name === 'status' ? statusLabel(row.old_value) : row.old_value || '—' }}</template>
          </el-table-column>
          <el-table-column prop="new_value" label="新值" show-overflow-tooltip>
            <template #default="{ row }">{{ row.field_name === 'status' ? statusLabel(row.new_value) : row.new_value || '—' }}</template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" show-overflow-tooltip />
          <el-table-column prop="created_at" label="时间" width="160" />
        </el-table>
        <el-empty v-if="!(person?.changes?.length)" description="暂无变更记录" :image-size="60" />
      </div>
    </div>

    <StatusChangeDialog
      v-model="statusVisible"
      :persons="person ? [{ id: person.id, name: person.name, status: person.status }] : []"
      @done="reload"
    />

    <!--
      大图预览。用 Teleport 挂到 body：详情整页套着 v-loading 遮罩与 card 容器，
      留在原地会被它们的层级和 overflow 裁掉。
      预览里直接带删除按钮——「放大看清这张能不能用」和「决定删掉它」是同一个动作，
      不该让用户在预览和缩略图之间来回找那张卡片。
    -->
    <Teleport to="body">
      <div v-if="viewing" class="photo-viewer" role="dialog" aria-modal="true" @click.self="closeViewer">
        <div class="viewer-bar">
          <div class="viewer-meta">
            <span class="viewer-name">{{ photoNameFull(viewing) }}</span>
            <span class="viewer-time">{{ photoTimeFull(viewing) }}</span>
          </div>
          <div class="viewer-actions">
            <el-button v-if="canRemovePhoto" type="danger" plain @click="removePhoto(viewing)">
              <el-icon><Delete /></el-icon>删除这张
            </el-button>
            <el-button circle title="关闭（Esc）" @click="closeViewer">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
        </div>
        <img
          v-if="viewerSrc(viewing)"
          class="viewer-img"
          :src="viewerSrc(viewing)"
          :alt="photoNameFull(viewing)"
        />
        <div v-else class="viewer-img viewer-img--empty">这张照片没能加载出来</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { personApi, fileApi } from '@/api';
import request from '@/api/request';
import { parseFrom } from '@/utils/nav';
import { useAuthStore } from '@/stores/auth';
import { statusLabel, statusTagType } from '@/utils/personStatus';
import { genderLabel } from '@/utils/format';
import TagPill from '@/components/TagPill.vue';
import StatusChangeDialog from '@/components/StatusChangeDialog.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const person = ref<any>(null);
const statusVisible = ref(false);

/** 现场照片与其 blob URL。照片是取证材料，必须能看到原件，所以要真取回字节而不是给个链接 */
const photos = ref<any[]>([]);
/** 缩略图 blob URL：网格展示用（长边 320px webp，几十 KB） */
const photoThumbUrls = ref<Record<number, string>>({});
/** 原图 blob URL：只在大图预览时按需取（2–5MB/张，网格里用它太浪费） */
const photoUrls = ref<Record<number, string>>({});
/** 正在放大查看的那一张 */
const viewing = ref<any>(null);

/**
 * 能不能删。后端对人员附件的删除要求 `person:edit` 或 `ledger:manage`，
 * 这里先按同一条口径把按钮藏起来：点了再被告知没权限，体验是「先给了希望又收回去」。
 *（后端还有一道「只能删自己上传的」限制，那是按记录判的，前端无从预知。）
 */
const canRemovePhoto = computed(
  () => auth.hasPermission('person:edit') || auth.hasPermission('ledger:manage')
);

/** 来源页：从人口档案/重点人群等页面进来，返回时原样退回（含筛选条件） */
const back = computed(() => parseFrom(route));
function goBack() { router.push(back.value.path); }

function statusTag(s?: string): any { return statusTagType(s); }
function relationLabel(r?: string) { return { HEAD: '户主', SPOUSE: '配偶', CHILD: '子女', PARENT: '父母', OTHER: '其他' }[r || ''] || r || '—'; }
function linkStatusLabel(s: string) { return { ACTIVE: '生效中', INACTIVE: '已失效', PENDING: '待审核' }[s] || s; }
/** 发放金额：整数不显示小数位，非整数保留两位（台账金额多为整数） */
function money(n?: number | null): string {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * 特困供养方式（V008）：走标签维度而非独立字段，
 * 依据「集中供养特困人员 / 分散供养特困人员」两个标签判定。
 */
const extremePovertyMode = computed(() => {
  const tags = person.value?.tags || [];
  const has = (code: string) => tags.some((t: any) => t.code === code);
  if (has('EXTREME_POVERTY_CENTRALIZED')) return 'CENTRALIZED';
  if (has('EXTREME_POVERTY_DISPERSED')) return 'DISPERSED';
  return '';
});

function typeLabel(t: string) { return { CREATE: '新增', UPDATE: '更新', STATUS_CHANGE: '状态变更', TAG: '标签' }[t] || t; }

/**
 * 照片上的时间。
 *
 * ## 这条曾经是错的
 * 后端 DATETIME 经 JSON 序列化出来是 **UTC 的 ISO 串**（13:00 拍的照片是
 * `2026-10-16T05:00:00.000Z`），早先这里直接 `.replace('T',' ').slice(0,16)`，
 * 于是 13:00 显示成 05:00——整整少 8 小时。现场照片的时间是取证材料的一部分，
 * 差 8 小时足以让人对不上「什么时候去的」。
 *
 * 现在的时间由后端 `dateTimeCN` 统一成**北京时间文本**下发（`2026-10-16 13:00:00`），
 * 前端只做展示、不再做任何时区换算——换算放在两处就一定会有一处算错。
 */
function photoTimeText(p: any): { prefix: string; text: string } | null {
  // 优先显示拍摄时间（capturedAt，移动端拍照时上报），没有才退回上传时间：
  // 离线补传时两者能差好几天，标清楚是哪一个，看的人才知道该信哪个。
  const isCaptured = !!p.capturedAt;
  const raw = isCaptured ? p.capturedAt : p.createdAt;
  if (!raw) return null;
  // 后端已给的是北京时间朴素文本；万一拿到的还是 ISO 串（旧后台/旁路接口），
  // 也不要再去猜时区，原样显示总比显示成一个「看起来正常但错 8 小时」的时间安全。
  return { prefix: isCaptured ? '拍摄' : '上传', text: String(raw) };
}

/** 完整时间（悬浮/预览里用，带秒：同一分钟连拍的照片靠秒才能分清） */
function photoTimeFull(p: any): string {
  const t = photoTimeText(p);
  if (!t) return '时间未知';
  return `${t.prefix} ${t.text}`;
}

/** 缩略图下方的短标签：省掉秒数，格子才放得下 */
function photoTimeLabel(p: any): string {
  const t = photoTimeText(p);
  if (!t) return '时间未知';
  // 后端文本形如 2026-10-16 13:00:00，只取到分钟
  return `${t.prefix} ${t.text.slice(0, 16)}`;
}

function photoNameFull(p: any): string {
  return p.fileName || '现场照片';
}

/** 照片缩略图同时下载的并发数。
 * 村委那台小服务器经不起几十个并发 blob，但纯串行又太慢——
 * 3 是「带宽吃满但不挤爆」的经验值，配合缩略图（几十 KB/张）几秒内全部出齐 */
const PHOTO_CONCURRENCY = 3;

/**
 * 加载现场照片的缩略图。
 *
 * 性能三原则（v2.3.2）：
 *  1. 本函数**不阻塞页面**——onMounted 里不 await 它，档案信息先出、照片渐进出现；
 *  2. 只取 `/files/:id/thumb`（长边 320 webp），不再为 120px 的网格格子下原片；
 *  3. 受限并发 3 张，加载完一张立刻显示一张。
 * 缩略图取不到（存量 PDF / 生成失败）就退回原片；原片也取不到只跳过这一张。
 */
async function loadPhotos() {
  const id = Number(route.params.id);
  try {
    const res: any = await fileApi.listByBiz('PERSON', id);
    const list: any[] = res.data?.list || [];
    photos.value = list;
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const p = list[cursor];
        cursor += 1;
        try {
          const resp: any = await request.get(`/files/${p.id}/thumb`, { responseType: 'blob' });
          photoThumbUrls.value[p.id] = URL.createObjectURL(resp.data as Blob);
        } catch {
          // 没有缩略图（懒生成失败/非图片）退回原片，再失败只跳过这一张
          try {
            const full: any = await request.get(`/files/${p.id}`, { responseType: 'blob' });
            photoThumbUrls.value[p.id] = URL.createObjectURL(full.data as Blob);
          } catch { /* 单张取不到不影响其余照片，也不该把整页变成错误 */ }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, list.length) }, worker));
  } catch {
    photos.value = [];
  }
}

/** 大图预览的展示源：原图没到位时先显示缩略图（点开立即可见，原图到后自动替换） */
function viewerSrc(p: any): string | undefined {
  return photoUrls.value[p.id] || photoThumbUrls.value[p.id];
}

/** 按需取原图：只在点开大图时发生，取完缓存进 photoUrls（预览期间反复开关不再重下） */
async function ensureFullImage(p: any) {
  if (photoUrls.value[p.id]) return;
  try {
    const resp: any = await request.get(`/files/${p.id}`, { responseType: 'blob' });
    photoUrls.value[p.id] = URL.createObjectURL(resp.data as Blob);
  } catch {
    // 取不到原片就停在缩略图上（viewerSrc 的兜底），不打断预览
  }
}

function openViewer(p: any) {
  viewing.value = p;
  void ensureFullImage(p);
  document.addEventListener('keydown', onViewerKeydown);
}
function closeViewer() {
  viewing.value = null;
  document.removeEventListener('keydown', onViewerKeydown);
}
/** Esc 关预览：村里不少人习惯键盘操作，而预览是全屏遮罩，没有退出口就只能关页面 */
function onViewerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeViewer();
}

/**
 * 删除一张现场照片。
 *
 * 确认框必须写明「不可恢复」：后端删库的同时会删掉磁盘上的文件，
 * 删完既不能在界面上找回，也不能去上传目录里捞回来。
 * 文件名用 h() 渲染而不是 dangerouslyUseHTMLString——文件名来自上传端，
 * 拼进 HTML 就是一个存储型 XSS。
 */
async function removePhoto(p: any) {
  const confirmed = await ElMessageBox.confirm(
    h(
      'div',
      { style: 'white-space: pre-wrap; word-break: break-all; line-height: 1.6' },
      `删除后无法恢复，确定删除这张现场照片？\n\n${photoNameFull(p)}\n${photoTimeFull(p)}`
    ),
    '删除现场照片',
    {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    }
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return; // 用户取消，与「删除失败」要区分开

  try {
    await fileApi.remove(p.id);
  } catch (e: any) {
    // 后端只允许「本人上传」或管理员删除，权限说明直接透传比一句「删除失败」有用
    ElMessage.error(e?.response?.data?.message || '删除失败');
    return;
  }

  if (photoUrls.value[p.id]) URL.revokeObjectURL(photoUrls.value[p.id]);
  if (photoThumbUrls.value[p.id]) URL.revokeObjectURL(photoThumbUrls.value[p.id]);
  delete photoUrls.value[p.id];
  delete photoThumbUrls.value[p.id];
  photos.value = photos.value.filter((x) => x.id !== p.id);
  // 从预览里删的话，预览本身也该跟着关掉——否则会停在一张已经不存在的照片上
  if (viewing.value?.id === p.id) closeViewer();
  ElMessage.success('已删除');
}

async function reload() {
  const id = Number(route.params.id);
  const res = await personApi.detail(id);
  person.value = res.data;
}

onMounted(async () => {
  loading.value = true;
  try {
    await reload();
  } finally {
    // 档案信息到位就先放行页面：照片在网络差时可能要十几秒，
    // 不能让用户盯着整页遮罩等它——照片区自己会从「加载中…」渐进变成图片
    loading.value = false;
  }
  // 照片后台加载（不 await）：缩略图 + 并发 3，见 loadPhotos
  void loadPhotos();
});

// blob URL 不会自己释放，离开页面必须逐个 revoke，否则反复进出详情页会一直占着内存。
// 预览的键盘监听同理：监听器挂在 document 上，不摘掉会一直跟着页面留着。
onUnmounted(() => {
  Object.values(photoUrls.value).forEach((u) => URL.revokeObjectURL(u));
  Object.values(photoThumbUrls.value).forEach((u) => URL.revokeObjectURL(u));
  document.removeEventListener('keydown', onViewerKeydown);
});
</script>

<style scoped>
.detail-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.no {
  font-size: var(--font-size-base);
  font-weight: 400;
  color: var(--color-text-secondary);
  margin-left: 8px;
}
.actions {
  display: flex;
  gap: 8px;
}
.date-hint {
  margin-left: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
/* 家庭情况描述 / 身体评估结果：长文本保留换行 */
.multiline {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}
.grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  margin-bottom: 16px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
}
.tag-status {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.tag-basis {
  font-size: var(--font-size-xs);
  color: var(--color-text-placeholder);
}
/* 现场照片：小格子平铺，点图看大图。缩略图固定 120px 高，长宽比不同的照片也不会把网格撑乱 */
.photos {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.photo {
  width: 160px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
/* 定位上下文给悬浮的删除按钮用；cursor 声明在这层，图片还在加载时点上去的手型一致 */
.photo-frame {
  position: relative;
  display: block;
  width: 100%;
  height: 120px;
  background: var(--color-bg-subtle);
  cursor: zoom-in;
}
.photo-frame img {
  display: block;
  width: 100%;
  height: 120px;
  object-fit: cover;
}
.photo-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 120px;
  font-size: var(--font-size-xs);
  color: var(--color-text-placeholder);
  background: var(--color-bg-subtle);
}
/*
  删除按钮：默认隐去、悬浮/聚焦时才出现。
  为什么不全天候显示——照片是主体内容，一个常驻的红色按钮会抢视线，
  也会让人误以为这张卡片本身处于「待处理」状态。
  但它必须压在图片上而不是放进下面的小字行：160px 的格子里三样东西已经互相挤位了，
  再塞一个按钮只会让「想删的时候点不准」继续发生。
*/
.photo-del {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  /* 悬浮按钮压在照片上，底下是深色的半透明底，图标固定用白色，不参与主题变量 */
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.photo:hover .photo-del,
.photo-del:focus-visible {
  opacity: 1;
}
.photo-del:hover {
  background: var(--color-danger);
}
.photo-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.photo-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.photo-time {
  color: var(--color-text-placeholder);
  white-space: nowrap;
}

/* 大图预览：Teleport 到 body，铺满视口 */
.photo-viewer {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.72);
}
.viewer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  color: #fff;
}
.viewer-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.viewer-name {
  font-size: var(--font-size-base);
  word-break: break-all;
}
.viewer-time {
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.7);
}
.viewer-actions {
  display: flex;
  flex: none;
  gap: 8px;
}
/* contain 而不是 cover：预览的目的是看清原图，裁切掉的门牌/人脸恰恰是最要紧的部分 */
.viewer-img {
  flex: 1;
  min-height: 0;
  width: 100%;
  object-fit: contain;
}
.viewer-img--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  font-size: var(--font-size-sm);
}
</style>
