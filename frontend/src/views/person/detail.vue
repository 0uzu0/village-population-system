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
          <el-descriptions-item label="性别">{{ person?.gender === 'MALE' ? '男' : '女' }}</el-descriptions-item>
          <el-descriptions-item label="出生日期">{{ person?.birthDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="年龄">{{ person?.age ?? '—' }} 岁</el-descriptions-item>
          <el-descriptions-item label="人员状态">
            <el-tag size="small" :type="statusTag(person?.status)">{{ statusLabel(person?.status) }}</el-tag>
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

      <!-- 变更历史 -->
      <div class="vp-card">
        <div class="card-title">档案变更历史</div>
        <el-table :data="person?.changes || []" size="small" max-height="300">
          <el-table-column prop="change_type" label="类型" width="100">
            <template #default="{ row }">{{ typeLabel(row.change_type) }}</template>
          </el-table-column>
          <el-table-column prop="field_name" label="字段" width="100" />
          <el-table-column prop="old_value" label="旧值" show-overflow-tooltip />
          <el-table-column prop="new_value" label="新值" show-overflow-tooltip />
          <el-table-column prop="reason" label="原因" show-overflow-tooltip />
          <el-table-column prop="created_at" label="时间" width="160" />
        </el-table>
        <el-empty v-if="!(person?.changes?.length)" description="暂无变更记录" :image-size="60" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { personApi } from '@/api';
import { parseFrom } from '@/utils/nav';
import TagPill from '@/components/TagPill.vue';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const person = ref<any>(null);

/** 来源页：从人口档案/重点人群等页面进来，返回时原样退回（含筛选条件） */
const back = computed(() => parseFrom(route));
function goBack() { router.push(back.value.path); }

function statusLabel(s: string) { return { NORMAL: '正常', MOVED_IN: '迁入', MOVED_OUT: '迁出', CANCELLED: '注销' }[s] || s; }
function statusTag(s?: string): any { return { NORMAL: 'success', MOVED_IN: 'primary', MOVED_OUT: 'warning', CANCELLED: 'danger' }[s || ''] || 'info'; }
function relationLabel(r?: string) { return { HEAD: '户主', SPOUSE: '配偶', CHILD: '子女', PARENT: '父母', OTHER: '其他' }[r || ''] || r || '—'; }
function linkStatusLabel(s: string) { return { ACTIVE: '生效中', INACTIVE: '已失效', PENDING: '待审核' }[s] || s; }
function typeLabel(t: string) { return { CREATE: '新增', UPDATE: '更新', STATUS_CHANGE: '状态变更', TAG: '标签' }[t] || t; }

onMounted(async () => {
  loading.value = true;
  try {
    const id = Number(route.params.id);
    const res = await personApi.detail(id);
    person.value = res.data;
  } finally {
    loading.value = false;
  }
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
</style>
