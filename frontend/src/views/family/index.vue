<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">家庭管理</h2>
        <div class="vp-page-subtitle">共 {{ total }} 户家庭</div>
      </div>
      <div class="header-actions">
        <el-button v-if="auth.hasPermission('family:manage')" @click="openAutoGroup">
          <el-icon><MagicStick /></el-icon>按门牌号自动归户
        </el-button>
        <el-button v-if="auth.hasPermission('family:manage')" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新增家庭
        </el-button>
      </div>
    </div>

    <div class="vp-container">
      <div class="vp-search-bar">
        <el-input v-model="query.keyword" placeholder="搜索家庭编号 / 户主姓名" clearable style="width: 240px" @keyup.enter="doSearch" @clear="doSearch">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="query.gridId" placeholder="网格" clearable filterable style="width: 140px" @change="doSearch">
          <el-option v-for="g in grids" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
        <el-button type="primary" @click="doSearch">查询</el-button>
      </div>

      <el-table :data="list" v-loading="loading" row-key="id">
        <el-table-column prop="family_no" label="家庭编号" width="140" />
        <el-table-column prop="head_name" label="户主" width="100">
          <template #default="{ row }">{{ row.head_name || '—' }}</template>
        </el-table-column>
        <el-table-column prop="address" label="家庭地址" min-width="160" show-overflow-tooltip />
        <el-table-column prop="grid_name" label="所属网格" width="110" />
        <el-table-column prop="member_count" label="人数" width="70" />
        <el-table-column label="家庭标签" min-width="180">
          <template #default="{ row }">
            <TagPill v-for="t in row.tags" :key="t.id" :name="t.name" :color="t.color" style="margin-right: 4px" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
            <el-button v-if="auth.hasPermission('family:manage')" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="auth.hasPermission('family:manage')"
              link type="danger" size="small" @click="removeFamily(row)"
            >删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[20, 50]" layout="total, sizes, prev, pager, next" @current-change="load" @size-change="doSearch" />
      </div>
    </div>

    <!-- 新增/编辑 -->
    <el-dialog v-model="formVisible" :title="form.id ? '编辑家庭' : '新增家庭'" width="480px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="家庭地址"><el-input v-model="form.address" /></el-form-item>
        <el-form-item label="所属网格"><el-select v-model="form.gridId" filterable clearable style="width: 100%"><el-option v-for="g in grids" :key="g.id" :label="g.name" :value="g.id" /></el-select></el-form-item>
        <el-form-item label="户主"><el-select v-model="form.headPersonId" filterable clearable style="width: 100%"><el-option v-for="p in persons" :key="p.id" :label="p.name" :value="p.id" /></el-select></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" :title="`家庭详情 - ${detail?.family_no || ''}`" size="560px">
      <div v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="户主">{{ detail.head_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="所属网格">{{ detail.grid_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="地址" :span="2">{{ detail.address || '—' }}</el-descriptions-item>
        </el-descriptions>

        <div class="section-title">家庭成员</div>
        <el-table :data="detail.members" size="small">
          <el-table-column prop="person.name" label="姓名" width="90" />
          <el-table-column prop="relation" label="与户主关系" width="100">
            <template #default="{ row }">{{ relationLabel(row.relation) }}</template>
          </el-table-column>
          <el-table-column prop="person.idCard" label="身份证号" width="170" show-overflow-tooltip />
          <el-table-column prop="person.phone" label="手机号" width="130">
            <template #default="{ row }">{{ row.person.phone || '—' }}</template>
          </el-table-column>
          <el-table-column prop="person.phoneBackup" label="备用手机号" width="130">
            <template #default="{ row }">{{ row.person.phoneBackup || '—' }}</template>
          </el-table-column>
          <el-table-column v-if="auth.hasPermission('family:manage')" label="操作" width="80">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="removeMember(row.memberId)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="auth.hasPermission('family:manage')" class="add-member">
          <el-select v-model="memberForm.personId" placeholder="选择人员" filterable style="flex: 1">
            <el-option v-for="p in persons" :key="p.id" :label="`${p.name}(${p.person_no})`" :value="p.id" />
          </el-select>
          <el-select v-model="memberForm.relation" placeholder="关系" style="width: 110px">
            <el-option label="户主" value="HEAD" /><el-option label="配偶" value="SPOUSE" /><el-option label="子女" value="CHILD" /><el-option label="父母" value="PARENT" /><el-option label="其他" value="OTHER" />
          </el-select>
          <el-button type="primary" @click="addMember">添加</el-button>
        </div>

        <div class="section-title">家庭标签</div>
        <div class="fam-tags">
          <el-tag v-for="t in detail.tags" :key="t.linkId" closable :color="t.color" style="color: #fff; margin: 4px" @close="removeFamilyTag(t.linkId)">{{ t.name }}</el-tag>
        </div>
        <div v-if="auth.hasPermission('tag:manage')" class="add-member" style="margin-top: 8px">
          <el-select v-model="famTagForm.tagId" placeholder="选择家庭标签" filterable style="flex: 1">
            <el-option v-for="t in familyTags" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
          <el-button type="primary" @click="addFamilyTag">添加标签</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- 按门牌号自动归户 -->
    <el-dialog v-model="autoVisible" title="按门牌号自动归户" width="680px">
      <el-alert
        title="同一门牌号的人员将归入同一个家庭；已存在的同地址家庭会被复用，不会重复建户。户主优先取「与户主关系=户主」的人，否则取最年长者。"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 14px"
      />
      <el-form label-width="110px">
        <el-form-item label="归户范围">
          <el-radio-group v-model="autoForm.scope">
            <el-radio-button value="UNFAMILIED">仅未归属家庭的人员</el-radio-button>
            <el-radio-button value="ALL">全部人员重新归户</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="依据地址">
          <el-radio-group v-model="autoForm.addressField">
            <el-radio-button value="hukou">户籍地址</el-radio-button>
            <el-radio-button value="live">实际居住地址</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="所属网格">
              <el-select v-model="autoForm.gridId" clearable filterable placeholder="全部网格" style="width: 100%">
                <el-option v-for="g in grids" :key="g.id" :label="g.name" :value="g.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最小成户人数">
              <el-input-number v-model="autoForm.minSize" :min="1" :max="50" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <div v-if="autoResult" class="auto-result">
        <div class="section-title">预览结果</div>
        <div class="auto-stats">
          <div class="as-item"><span class="as-num">{{ autoResult.groupCount }}</span><span class="as-lbl">门牌号分组</span></div>
          <div class="as-item"><span class="as-num">{{ autoResult.personsToAssign }}</span><span class="as-lbl">将归入人数</span></div>
          <div class="as-item create"><span class="as-num">{{ autoResult.familiesToCreate }}</span><span class="as-lbl">新建家庭</span></div>
          <div class="as-item reuse"><span class="as-num">{{ autoResult.familiesToReuse }}</span><span class="as-lbl">复用已有家庭</span></div>
          <div class="as-item muted"><span class="as-num">{{ autoResult.skippedNoAddress }}</span><span class="as-lbl">无地址跳过</span></div>
        </div>
        <el-table :data="autoResult.preview || []" size="small" max-height="220">
          <el-table-column prop="address" label="门牌号" min-width="200" show-overflow-tooltip />
          <el-table-column prop="count" label="人数" width="70" />
          <el-table-column prop="headName" label="拟定户主" width="100" />
          <el-table-column label="处理方式" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="row.reuse ? 'info' : 'success'">{{ row.reuse ? '并入已有' : '新建家庭' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div class="auto-tip">仅展示前 20 组；执行后才真正写入数据库。</div>
      </div>

      <template #footer>
        <el-button @click="autoVisible = false">取消</el-button>
        <el-button :loading="autoRunning" @click="previewAutoGroup">预览</el-button>
        <el-button type="primary" :loading="autoRunning" :disabled="!autoResult || !autoResult.personsToAssign" @click="runAutoGroup">
          确认执行
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { familyApi, gridApi, personApi, tagApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import TagPill from '@/components/TagPill.vue';

const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const grids = ref<any[]>([]);
const persons = ref<any[]>([]);
const familyTags = ref<any[]>([]);

const query = reactive({ page: 1, pageSize: 20, keyword: '', gridId: null as number | null });
const formVisible = ref(false);
const form = reactive<any>({ id: null, address: '', gridId: null, headPersonId: null });
const detailVisible = ref(false);
const detail = ref<any>(null);
const memberForm = reactive({ personId: null as number | null, relation: 'OTHER' });
const famTagForm = reactive({ tagId: null as number | null });

// 按门牌号自动归户
const autoVisible = ref(false);
const autoRunning = ref(false);
const autoResult = ref<any>(null);
const autoForm = reactive<any>({ scope: 'UNFAMILIED', addressField: 'hukou', gridId: null, minSize: 1, dryRun: 1 });

function openAutoGroup() {
  autoResult.value = null;
  Object.assign(autoForm, { scope: 'UNFAMILIED', addressField: 'hukou', gridId: null, minSize: 1, dryRun: 1 });
  autoVisible.value = true;
}
async function previewAutoGroup() {
  autoRunning.value = true;
  try {
    const res = await familyApi.autoGroup({ ...autoForm, dryRun: 1 });
    autoResult.value = res.data;
    if (!res.data.personsToAssign) ElMessage.info('没有可归户的人员');
  } finally { autoRunning.value = false; }
}
async function runAutoGroup() {
  try {
    await ElMessageBox.confirm(
      `将新建 ${autoResult.value.familiesToCreate} 户家庭、复用 ${autoResult.value.familiesToReuse} 户，归入 ${autoResult.value.personsToAssign} 人。是否执行？`,
      '自动归户确认',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' }
    );
  } catch { return; }
  autoRunning.value = true;
  try {
    const res = await familyApi.autoGroup({ ...autoForm, dryRun: 0 });
    ElMessage.success(res.data?.message || '自动归户完成');
    autoVisible.value = false;
    load();
  } finally { autoRunning.value = false; }
}

function relationLabel(r: string) { return { HEAD: '户主', SPOUSE: '配偶', CHILD: '子女', PARENT: '父母', OTHER: '其他' }[r] || r; }

async function load() {
  loading.value = true;
  try {
    const res = await familyApi.list({ ...query });
    list.value = res.data.list;
    total.value = res.data.total;
  } finally { loading.value = false; }
}
function doSearch() { query.page = 1; load(); }
function openCreate() { Object.assign(form, { id: null, address: '', gridId: null, headPersonId: null }); formVisible.value = true; }
function openEdit(row: any) { Object.assign(form, { id: row.id, address: row.address || '', gridId: row.grid_id, headPersonId: row.head_person_id }); formVisible.value = true; }
async function saveForm() {
  saving.value = true;
  try {
    if (form.id) await familyApi.update(form.id, form);
    else await familyApi.create(form);
    ElMessage.success('保存成功');
    formVisible.value = false;
    load();
  } finally { saving.value = false; }
}

/** 删除家庭（物理删除，不可恢复；成员人员档案保留，仅解除归属） */
async function removeFamily(row: any) {
  try {
    await ElMessageBox.confirm(
      `将删除家庭「${row.family_no}」及其成员关系与家庭标签，且不可恢复（成员的人员档案会保留，仅解除家庭归属）。是否继续？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch { return; }
  await familyApi.remove(row.id);
  ElMessage.success('家庭已删除');
  load();
}

async function openDetail(row: any) {
  const res = await familyApi.detail(row.id);
  detail.value = res.data;
  detailVisible.value = true;
}
async function addMember() {
  if (!detail.value || !memberForm.personId) { ElMessage.warning('请选择人员'); return; }
  await familyApi.addMember(detail.value.id, { personId: memberForm.personId, relation: memberForm.relation });
  ElMessage.success('成员已添加');
  openDetail({ id: detail.value.id });
}
async function removeMember(memberId: number) {
  if (!detail.value) return;
  await familyApi.removeMember(detail.value.id, memberId);
  ElMessage.success('成员已移除');
  openDetail({ id: detail.value.id });
}
async function addFamilyTag() {
  if (!detail.value || !famTagForm.tagId) return;
  await familyApi.addTag(detail.value.id, { tagId: famTagForm.tagId });
  ElMessage.success('标签已添加');
  openDetail({ id: detail.value.id });
}
async function removeFamilyTag(linkId: number) {
  if (!detail.value) return;
  await familyApi.removeTag(detail.value.id, linkId);
  ElMessage.success('标签已移除');
  openDetail({ id: detail.value.id });
}

onMounted(async () => {
  load();
  const [g, p, t] = await Promise.all([
    gridApi.list({ pageSize: 100 }),
    personApi.list({ pageSize: 200 }),
    tagApi.definitions({ pageSize: 200, objectType: 'FAMILY' }),
  ]);
  grids.value = g.data.list;
  persons.value = p.data.list;
  familyTags.value = t.data.list;
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.header-actions { display: flex; gap: 10px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
.auto-result { margin-top: 8px; }
.auto-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 12px; }
.as-item { background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 10px; text-align: center; }
.as-item .as-num { display: block; font-size: 20px; font-weight: 700; color: var(--color-primary); }
.as-item.create .as-num { color: #0E7C6B; }
.as-item.reuse .as-num { color: #5B5BD6; }
.as-item.muted .as-num { color: var(--color-text-secondary); }
.as-item .as-lbl { font-size: 12px; color: var(--color-text-secondary); }
.auto-tip { font-size: 12px; color: var(--color-text-secondary); margin-top: 8px; }
.section-title { font-size: 14px; font-weight: 600; margin: 20px 0 8px; }
.add-member { display: flex; gap: 8px; margin-top: 8px; }
.fam-tags { min-height: 20px; }
</style>
