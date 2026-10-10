<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">系统设置</h2>
        <div class="vp-page-subtitle">审计日志、数据字典与系统信息</div>
      </div>
    </div>

    <div class="vp-container">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="系统信息" name="info">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="系统名称">村级人口与重点人群精细化管理系统</el-descriptions-item>
            <el-descriptions-item label="版本">v1.0.0</el-descriptions-item>
            <el-descriptions-item label="前端框架">Vue 3 + TypeScript + Element Plus</el-descriptions-item>
            <el-descriptions-item label="后端框架">Node.js + Express</el-descriptions-item>
            <el-descriptions-item label="数据库">MySQL 8</el-descriptions-item>
            <el-descriptions-item label="部署方式">Docker Compose + Nginx</el-descriptions-item>
          </el-descriptions>
          <el-alert title="数据安全：生产环境请务必启用 HTTPS，定期执行数据库备份（详见部署文档）。" type="warning" :closable="false" style="margin-top: 16px" />
        </el-tab-pane>

        <el-tab-pane label="操作审计" name="audit" v-if="auth.hasPermission('audit:view')">
          <div class="vp-search-bar">
            <el-input v-model="auditQuery.keyword" placeholder="搜索用户/动作" clearable style="width: 220px" @keyup.enter="loadAudit" @clear="loadAudit" />
            <el-select v-model="auditQuery.result" placeholder="结果" clearable style="width: 110px" @change="loadAudit">
              <el-option label="成功" value="SUCCESS" /><el-option label="失败" value="FAIL" />
            </el-select>
            <el-button type="primary" @click="loadAudit">查询</el-button>
          </div>
          <el-table :data="audits" v-loading="auditLoading">
            <el-table-column prop="username" label="用户" width="100" />
            <el-table-column prop="action" label="动作" min-width="200" show-overflow-tooltip />
            <el-table-column prop="result" label="结果" width="80">
              <template #default="{ row }"><el-tag size="small" :type="row.result === 'SUCCESS' ? 'success' : 'danger'">{{ row.result === 'SUCCESS' ? '成功' : '失败' }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="ip" label="IP" width="130" />
            <el-table-column prop="created_at" label="时间" width="160" />
          </el-table>
          <div class="pagination">
            <el-pagination v-model:current-page="auditQuery.page" v-model:page-size="auditQuery.pageSize" :total="auditTotal" layout="total, prev, pager, next" @current-change="loadAudit" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="数据字典" name="dict">
          <el-table :data="dicts" v-loading="dictLoading">
            <el-table-column prop="dict_type" label="字典类型" width="160" />
            <el-table-column prop="dict_label" label="标签" width="140" />
            <el-table-column prop="dict_value" label="值" width="140" />
            <el-table-column prop="sort" label="排序" width="80" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { auditApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const activeTab = ref('info');
const audits = ref<any[]>([]);
const auditTotal = ref(0);
const auditLoading = ref(false);
const auditQuery = reactive({ page: 1, pageSize: 20, keyword: '', result: '' });

const dicts = ref<any[]>([]);
const dictLoading = ref(false);

async function loadAudit() {
  auditLoading.value = true;
  try {
    const res = await auditApi.list({ ...auditQuery });
    audits.value = res.data.list;
    auditTotal.value = res.data.total;
  } finally { auditLoading.value = false; }
}

async function loadDicts() {
  dictLoading.value = true;
  try {
    const types = ['gender', 'person_status', 'relation', 'tag_object_type', 'import_status'];
    const results = await Promise.all(types.map((t) => auditApi.dicts(t)));
    dicts.value = results.flatMap((r: any) => r.data);
  } finally { dictLoading.value = false; }
}

onMounted(() => {
  loadAudit();
  loadDicts();
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
