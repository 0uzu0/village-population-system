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
            <el-table-column prop="dict_type" label="字典类型" min-width="170" show-overflow-tooltip />
            <el-table-column prop="dict_label" label="标签" min-width="150" show-overflow-tooltip />
            <el-table-column prop="dict_value" label="值" min-width="150" show-overflow-tooltip />
            <el-table-column prop="sort" label="排序" width="90" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="AI 接入" name="mcp">
          <el-alert type="info" :closable="false" title="AI 客户端（Claude Desktop、Cherry Studio 等）通过 MCP 协议读写本系统数据，权限与你在网页上看到的完全一致。长期令牌长期有效，可随时单独吊销；改密码会让所有令牌立即失效。">
            <template #default>
              <div class="mcp-tip">只读令牌看不到任何写工具；写入还需服务器开启 MCP_WRITE_LEVEL。所有 AI 调用都会记入操作审计。</div>
            </template>
          </el-alert>

          <el-descriptions :column="3" border class="mcp-status">
            <el-descriptions-item label="接入地址">
              <span class="mono">{{ endpoint }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="写入开关">
              <el-tag size="small" :type="manifest.writeLevel === 'off' ? 'info' : 'success'">
                {{ writeLevelText }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="当前可用工具">
              {{ manifest.total ?? '—' }} 个
            </el-descriptions-item>
          </el-descriptions>

          <div class="vp-search-bar">
            <el-button type="primary" @click="openCreate">新建令牌</el-button>
            <el-button :disabled="!activeTokenCount" @click="revokeAllTokens">吊销全部</el-button>
            <span class="mcp-hint">令牌明文只在创建时显示一次，之后只能看到前缀</span>
          </div>

          <el-table :data="tokens" v-loading="tokenLoading" empty-text="还没有令牌，点「新建令牌」为 AI 客户端签发一枚">
            <el-table-column prop="name" label="用途" min-width="150" show-overflow-tooltip />
            <el-table-column prop="prefix" label="令牌" width="140">
              <template #default="{ row }"><span class="mono">{{ row.prefix }}</span></template>
            </el-table-column>
            <el-table-column prop="scope" label="范围" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.scope === 'write' ? 'warning' : 'info'">
                  {{ row.scope === 'write' ? '可写入' : '只读' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="最近使用" width="190">
              <template #default="{ row }">
                <div>{{ row.lastUsedAt || '从未使用' }}</div>
                <div v-if="row.lastUsedIp" class="mcp-sub">{{ row.lastUsedIp }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="statusTagType(row.status)">{{ statusText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" width="170" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button v-if="row.status === 'ACTIVE'" link type="danger" size="small" @click="revokeOne(row)">吊销</el-button>
                <span v-else class="mcp-sub">—</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog v-model="createVisible" :title="created ? '令牌已创建' : '新建 MCP 令牌'" width="560px" @closed="resetCreate">
      <template v-if="!created">
        <el-form label-width="90px">
          <el-form-item label="用途">
            <el-input v-model="form.name" placeholder="例如：Claude Desktop、家里电脑" maxlength="64" show-word-limit />
          </el-form-item>
          <el-form-item label="权限">
            <el-radio-group v-model="form.scope">
              <el-radio value="read">只读（推荐）</el-radio>
              <el-radio value="write">可写入</el-radio>
            </el-radio-group>
            <div class="mcp-sub">只读令牌连写工具都不会出现在 AI 的工具列表里。</div>
          </el-form-item>
          <el-form-item label="有效期">
            <el-select v-model="form.expiresInDays" style="width: 200px">
              <el-option :value="0" label="长期有效（推荐）" />
              <el-option :value="30" label="30 天" />
              <el-option :value="90" label="90 天" />
              <el-option :value="365" label="1 年" />
            </el-select>
          </el-form-item>
        </el-form>
      </template>

      <template v-else>
        <el-alert type="warning" :closable="false" title="请立刻复制保存，关闭后无法再次查看这串令牌" />
        <div class="mcp-copy-block">
          <div class="mcp-copy-label">令牌</div>
          <el-input :model-value="created.token" readonly>
            <template #append>
              <el-button @click="copyText(created.token, '令牌')">复制</el-button>
            </template>
          </el-input>
        </div>
        <div class="mcp-copy-block">
          <div class="mcp-copy-label">客户端配置（粘贴到 mcpServers 下）</div>
          <pre class="mcp-pre">{{ clientConfig }}</pre>
          <el-button size="small" @click="copyText(clientConfig, '配置')">复制配置</el-button>
        </div>
      </template>

      <template #footer>
        <template v-if="!created">
          <el-button @click="createVisible = false">取消</el-button>
          <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
        </template>
        <el-button v-else type="primary" @click="createVisible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { auditApi, mcpApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const activeTab = ref('info');
const audits = ref<any[]>([]);
const auditTotal = ref(0);
const auditLoading = ref(false);
const auditQuery = reactive({ page: 1, pageSize: 20, keyword: '', result: '' });

const dicts = ref<any[]>([]);
const dictLoading = ref(false);

// ---- AI 接入（MCP）----
/** 接入地址按当前页面 origin 拼：换域名/端口部署后这里自动跟着变，不需要改代码 */
const endpoint = computed(() => `${window.location.origin}/api/mcp`);
const tokens = ref<any[]>([]);
const tokenLoading = ref(false);
const manifest = ref<{ writeLevel?: string; total?: number; piiMode?: string }>({});
const activeTokenCount = computed(() => tokens.value.filter((t) => t.status === 'ACTIVE').length);
const writeLevelText = computed(() => {
  const level = manifest.value.writeLevel || 'off';
  return level === 'off' ? '只读（写入已关闭）' : level === 'basic' ? '允许常规写入' : '允许全部写入';
});

const createVisible = ref(false);
const creating = ref(false);
const created = ref<{ token: string; name: string; scope: string } | null>(null);
const form = reactive({ name: '', scope: 'read' as 'read' | 'write', expiresInDays: 0 });

/** 一次性给出的客户端配置片段，免得用户去翻文档拼 JSON */
const clientConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        village: {
          type: 'http',
          url: endpoint.value,
          headers: { Authorization: `Bearer ${created.value?.token ?? '<令牌>'}` },
        },
      },
    },
    null,
    2
  )
);

function statusText(status: string) {
  return status === 'ACTIVE' ? '生效中' : status === 'EXPIRED' ? '已过期' : '已吊销';
}
function statusTagType(status: string) {
  return status === 'ACTIVE' ? 'success' : status === 'EXPIRED' ? 'warning' : 'info';
}

async function loadTokens() {
  tokenLoading.value = true;
  try {
    const res = await mcpApi.tokens();
    tokens.value = res.data.items || [];
    manifest.value = { ...manifest.value, writeLevel: res.data.writeLevel };
  } catch {
    // 权限或网络问题：不清空已有列表，避免误以为令牌全没了
    ElMessage.error('令牌列表加载失败');
  } finally {
    tokenLoading.value = false;
  }
}

async function loadManifest() {
  try {
    const res = await mcpApi.manifest();
    manifest.value = res.data;
  } catch {
    /* 能力清单只用于展示，失败不影响令牌管理 */
  }
}

function openCreate() {
  form.name = '';
  form.scope = 'read';
  form.expiresInDays = 0;
  created.value = null;
  createVisible.value = true;
}

function resetCreate() {
  created.value = null;
  creating.value = false;
}

async function submitCreate() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写用途，方便以后区分是哪台设备');
    return;
  }
  creating.value = true;
  try {
    const res = await mcpApi.createToken({
      name: form.name.trim(),
      scope: form.scope,
      expiresInDays: form.expiresInDays || undefined,
    });
    created.value = res.data;
    await loadTokens();
  } catch {
    // 后端已给出具体原因（如「每人最多 20 枚」），拦截器会弹出提示
  } finally {
    creating.value = false;
  }
}

async function revokeOne(row: any) {
  try {
    await ElMessageBox.confirm(
      `吊销「${row.name}」后，使用这枚令牌的 AI 客户端会立刻无法访问，需要重新创建。`,
      '确认吊销',
      { type: 'warning' }
    );
  } catch {
    return;
  }
  try {
    await mcpApi.revokeToken(row.id);
    ElMessage.success('已吊销');
    await loadTokens();
  } catch {
    /* 拦截器已提示 */
  }
}

async function revokeAllTokens() {
  try {
    await ElMessageBox.confirm('将吊销你名下所有生效中的令牌，已配置的 AI 客户端会全部断开。', '确认吊销全部', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    const res = await mcpApi.revokeAll();
    ElMessage.success(res.message || '已全部吊销');
    await loadTokens();
  } catch {
    /* 拦截器已提示 */
  }
}

/** 复制：浏览器要求安全上下文，内网 HTTP 可能被拒，所以给手动复制的兜底提示 */
async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(`${label}已复制`);
  } catch {
    ElMessage.warning('当前浏览器不允许自动复制，请手动选中文本');
  }
}

// 令牌列表只在切到该 tab 时拉取：进设置页的人多数是来看审计的，不该白白多一次请求
watch(activeTab, (tab) => {
  if (tab !== 'mcp') return;
  loadTokens();
  loadManifest();
});

async function loadAudit() {
  auditLoading.value = true;
  try {
    const res = await auditApi.list({ ...auditQuery });
    audits.value = res.data.list;
    auditTotal.value = res.data.total;
  } finally {
    auditLoading.value = false;
  }
}

async function loadDicts() {
  dictLoading.value = true;
  try {
    const types = ['gender', 'person_status', 'relation', 'tag_object_type', 'import_status'];
    const results = await Promise.all(types.map((t) => auditApi.dicts(t)));
    dicts.value = results.flatMap((r: any) => r.data);
  } finally {
    dictLoading.value = false;
  }
}

onMounted(() => {
  loadAudit();
  loadDicts();
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
.mcp-tip { margin-top: 6px; line-height: 1.7; }
.mcp-status { margin: 16px 0 4px; }
.mcp-hint { color: var(--vp-text-3); font-size: var(--vp-font-12); margin-left: auto; }
.mcp-sub { color: var(--vp-text-3); font-size: var(--vp-font-12); margin-top: 2px; }
.mono { font-family: var(--vp-font-mono, monospace); font-size: var(--vp-font-12); }
.mcp-copy-block { margin-top: 16px; }
.mcp-copy-label { color: var(--vp-text-2); font-size: var(--vp-font-13); margin-bottom: 6px; }
.mcp-pre {
  background: var(--vp-fill-2);
  border: 1px solid var(--vp-border);
  border-radius: var(--vp-radius-md);
  padding: 12px;
  font-family: var(--vp-font-mono, monospace);
  font-size: var(--vp-font-12);
  line-height: 1.6;
  overflow: auto;
  white-space: pre;
  margin: 0 0 8px;
}
</style>
