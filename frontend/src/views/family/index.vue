<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">家庭管理</h2>
        <div class="vp-page-subtitle">
          共 {{ total }} 户在册家庭
          <span class="sub-note">（全户迁出或死亡后不再计入，档案仍保留可查）</span>
        </div>
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
        <el-table-column prop="head_name" label="户主" width="130">
          <template #default="{ row }">
            <span>{{ row.head_name || '—' }}</span>
            <!-- 户主已故/迁出时不自动改选（户主承继各地规矩不同，不能替村里决定），
                 但要在这里标出来，否则列表上看起来一切正常 -->
            <el-tag v-if="row.head_name && row.head_status && !isActive(row.head_status)" size="small" type="danger" effect="plain" style="margin-left: 4px">
              已{{ statusLabel(row.head_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="address" label="家庭地址" min-width="160" show-overflow-tooltip />
        <el-table-column prop="grid_name" label="所属网格" width="110" />
        <el-table-column prop="member_count" label="人数" width="70" />
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
        <el-form-item label="户主">
          <el-select
            v-model="form.headPersonId"
            filterable
            remote
            reserve-keyword
            clearable
            :remote-method="headPicker.search"
            :loading="headPicker.loading"
            placeholder="输入姓名 / 身份证 / 手机号搜索"
            style="width: 100%"
          >
            <el-option v-for="p in headPicker.list" :key="p.id" :label="personLabel(p)" :value="p.id" />
          </el-select>
        </el-form-item>
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
          <el-descriptions-item label="户主">
            <span>{{ detail.head_name || '—' }}</span>
            <el-tag v-if="headVacant" size="small" type="danger" effect="plain" style="margin-left: 6px">已离户</el-tag>
            <el-button
              v-if="headVacant && auth.hasPermission('family:manage')"
              link
              type="primary"
              size="small"
              style="margin-left: 6px"
              @click="openHeadDialog"
            >
              改选户主
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label="所属网格">{{ detail.grid_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="地址" :span="2">{{ detail.address || '—' }}</el-descriptions-item>
        </el-descriptions>

        <!-- 户主离户：以前这里什么都不显示，家庭列表永远挂着已故者的姓名 -->
        <el-alert
          v-if="headVacant"
          type="warning"
          :closable="false"
          show-icon
          style="margin: 10px 0"
          title="本户户主已离户（死亡 / 迁出 / 移出），当前无人担任户主"
          :description="`家庭列表与导出仍显示「${detail.head_name || '—'}」。请改选一位在册成员接任，否则按户统计与名单会一直挂着一个已离户的人。`"
        />

        <div class="section-title">
          家庭成员
          <span class="sub-note">在册 {{ detail.activeMemberCount ?? detail.members.length }} 人</span>
        </div>
        <el-alert
          v-if="detail.dissolved"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 10px"
          title="本户已无在册成员，不再计入家庭总数"
          description="档案与成员关联都保留，人员改回「正常/迁入」后本户会自动恢复。"
        />
        <el-table :data="detail.members" size="small">
          <el-table-column prop="person.name" label="姓名" width="90">
            <template #default="{ row }">
              <el-link type="primary" :underline="false" @click="openPerson(row.person.id)">{{ row.person.name }}</el-link>
            </template>
          </el-table-column>
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

        <!-- 离户成员：人死了不该从家庭里消失，家属来核对时要能看到「已故」和日期 -->
        <template v-if="detail.formerMembers?.length">
          <div class="section-title">
            离户成员
            <span class="sub-note">共 {{ detail.formerMembers.length }} 人，不计入家庭人口</span>
          </div>
          <el-table :data="detail.formerMembers" size="small" class="former-table">
            <el-table-column prop="person.name" label="姓名" width="90">
              <template #default="{ row }">
                <el-link type="primary" :underline="false" @click="openPerson(row.person.id)">{{ row.person.name }}</el-link>
              </template>
            </el-table-column>
            <el-table-column prop="relation" label="与户主关系" width="100">
              <template #default="{ row }">{{ relationLabel(row.relation) }}</template>
            </el-table-column>
            <el-table-column label="去向" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="leaveReasonType(row.leaveReason)" effect="plain">
                  {{ leaveReasonLabel(row.leaveReason) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="离户日期" width="110">
              <template #default="{ row }">{{ row.leaveDate || '—' }}</template>
            </el-table-column>
            <el-table-column label="档案" min-width="90">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openPerson(row.person.id)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <div v-if="auth.hasPermission('family:manage')" class="add-member">
          <el-select
            v-model="memberForm.personId"
            placeholder="输入姓名 / 身份证 / 手机号，全库检索"
            filterable
            remote
            reserve-keyword
            clearable
            :remote-method="memberPicker.search"
            :loading="memberPicker.loading"
            style="flex: 1"
          >
            <el-option
              v-for="p in memberPicker.list"
              :key="p.id"
              :label="memberOptionLabel(p)"
              :value="p.id"
              :disabled="isCurrentMember(p.id)"
            />
          </el-select>
          <el-select v-model="memberForm.relation" placeholder="关系" style="width: 130px">
            <el-option v-for="o in RELATION_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <el-button type="primary" @click="addMember">添加</el-button>
        </div>
        <div v-if="auth.hasPermission('family:manage')" class="add-note">
          候选按姓名 / 身份证 / 手机号 / 地址在全库检索，不限本村。若此人已属于其他户，添加后会从原户迁出，原户留一条离户记录。
        </div>
      </div>
    </el-drawer>

    <!-- 改选户主：户主离户后唯一的补救入口 -->
    <el-dialog v-model="headDialogVisible" :title="`改选户主 - ${detail?.family_no || ''}`" width="440px">
      <el-alert
        v-if="detail?.head_name"
        type="info"
        :closable="false"
        style="margin-bottom: 12px"
        :title="`原户主：${detail.head_name}（已离户）`"
      />
      <el-select v-model="headPersonId" placeholder="选择继任户主" filterable style="width: 100%">
        <el-option
          v-for="m in detail?.members || []"
          :key="m.person.id"
          :label="`${m.person.name}（${relationLabel(m.relation)}）`"
          :value="m.person.id"
        />
      </el-select>
      <div class="head-note">
        只能从本户在册成员中选。改选后新户主的关系会被置为「户主」，原户主保留在离户成员里，档案与变更记录不受影响。
      </div>
      <template #footer>
        <el-button @click="headDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveHead">确认改选</el-button>
      </template>
    </el-dialog>

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
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { familyApi, gridApi, personApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { isActiveStatus as isActive, statusLabel, type TagType } from '@/utils/personStatus';
import { relationLabel, RELATION_OPTIONS, escapeHtml } from '@/utils/format';
import { toPersonDetail } from '@/utils/nav';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const grids = ref<any[]>([]);

/**
 * 人员下拉的远端检索。
 *
 * 原先 onMounted 一次性拉 `pageSize: 200` 当候选，全库 7600 多人，那只是 id 最小的
 * 两百个（北口村 + 仓门口村），于是「添加家庭成员」看起来只能加仓门口的人，
 * 别的村一个都搜不到。现在改成按关键词到服务端查，姓名/身份证/手机号/地址都命中。
 *
 * seq 是防竞态用的：输入快时旧请求可能后到，只认最后一次的结果。
 */
function usePersonPicker() {
  const list = ref<any[]>([]);
  const loading = ref(false);
  let seq = 0;
  async function search(keyword: string) {
    const kw = (keyword || '').trim();
    const mine = ++seq;
    if (!kw) {
      list.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const res = await personApi.list({ keyword: kw, pageSize: 30 });
      if (mine === seq) list.value = res.data.list;
    } catch {
      if (mine === seq) list.value = [];
    } finally {
      if (mine === seq) loading.value = false;
    }
  }
  function reset() {
    seq++;
    list.value = [];
    loading.value = false;
  }
  // reactive 包一层，模板里 memberPicker.list 才会自动解包成数组
  return reactive({ list, loading, search, reset });
}
const memberPicker = usePersonPicker();
const headPicker = usePersonPicker();

const query = reactive({ page: 1, pageSize: 20, keyword: '', gridId: null as number | null });
const formVisible = ref(false);
const form = reactive<any>({ id: null, address: '', gridId: null, headPersonId: null });
const detailVisible = ref(false);
const detail = ref<any>(null);
const memberForm = reactive({ personId: null as number | null, relation: 'OTHER' });

/**
 * 户主是否已离户（死亡/迁出/被移出）。
 *
 * `head_person_id` 只在「改选户主」或「有人被设为户主」时变，人员离户时没人动它，
 * 于是家庭列表和导出里一直显示已故者当户主。这里就地提示，并给一个改选入口。
 * 已灭户（members 为空）不提示改选——户里没人可当户主，那是另一回事。
 */
const headVacant = computed(() => {
  if (!detail.value || detail.value.dissolved) return false;
  const hid = Number(detail.value.head_person_id);
  if (!hid) return true;
  return !(detail.value.members || []).some((m: any) => Number(m.person?.id) === hid);
});
/** 默认选中项：关系已是「户主」的第一位，否则名单第一人 */
const suggestedHeadId = computed<number | null>(() => {
  const list = detail.value?.members || [];
  return (list.find((m: any) => m.relation === 'HEAD') || list[0])?.person?.id ?? null;
});
const headDialogVisible = ref(false);
const headPersonId = ref<number | null>(null);
function openHeadDialog() {
  headPersonId.value = suggestedHeadId.value;
  headDialogVisible.value = true;
}
async function saveHead() {
  if (!detail.value || !headPersonId.value) { ElMessage.warning('请选择继任户主'); return; }
  await familyApi.changeHead(detail.value.id, { personId: headPersonId.value });
  ElMessage.success('户主已变更');
  headDialogVisible.value = false;
  await openDetail({ id: detail.value.id });
  load();
}

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

/** 离户去向：书面语直接给村里看，不要出现 DEAD / REMOVED 这种编码 */
function leaveReasonLabel(reason: string) {
  return { DEAD: '死亡', MOVED_OUT: '迁出', REMOVED: '移出家庭' }[reason] || reason;
}
function leaveReasonType(reason: string): TagType {
  return ({ DEAD: 'danger', MOVED_OUT: 'warning', REMOVED: 'info' } as Record<string, TagType>)[reason] || 'info';
}
function openPerson(id: number) {
  // 带上来源页，详情页的返回能退回本抽屉所在的家庭列表
  router.push(toPersonDetail(route, id));
}

async function load() {
  loading.value = true;
  try {
    const res = await familyApi.list({ ...query });
    list.value = res.data.list;
    total.value = res.data.total;
  } finally { loading.value = false; }
}
function doSearch() { query.page = 1; load(); }
function openCreate() {
  Object.assign(form, { id: null, address: '', gridId: null, headPersonId: null });
  headPicker.reset();
  formVisible.value = true;
}
async function openEdit(row: any) {
  Object.assign(form, { id: row.id, address: row.address || '', gridId: row.grid_id, headPersonId: row.head_person_id });
  formVisible.value = true;
  // 户主下拉是远端检索，回填时先按姓名查一次，否则下拉里只剩一个孤零零的 id
  headPicker.reset();
  if (form.headPersonId && row.head_name) {
    await headPicker.search(row.head_name);
    if (!headPicker.list.some((p: any) => p.id === form.headPersonId)) {
      headPicker.list.unshift({ id: form.headPersonId, name: row.head_name });
    }
  }
}
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
      `将删除家庭「${row.family_no}」及其成员关系，且不可恢复（成员的人员档案会保留，仅解除家庭归属）。是否继续？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch { return; }
  await familyApi.remove(row.id);
  ElMessage.success('家庭已删除');
  load();
}

/**
 * 人员下拉展示文案。
 * 注意：后端返回的是驼峰字段（personNo / idCard / village），
 * 之前误用下划线 p.person_no，导致下拉里显示「张三(undefined)」。
 */
function personLabel(p: any) {
  if (!p) return '';
  const sub = p.idCard ? p.idCard : p.personNo || '';
  const extra = p.village ? `·${p.village}` : '';
  return sub ? `${p.name}（${sub}）${extra}` : p.name;
}

async function openDetail(row: any) {
  const res = await familyApi.detail(row.id);
  detail.value = res.data;
  detailVisible.value = true;
  // 换户了候选池就该清空，否则上一个户搜到的人还挂在下拉里
  memberForm.personId = null;
  memberPicker.reset();
}
/** 该人是否已在本户（已在本户的不能再加一遍，服务端会直接改关系，容易误操作） */
function isCurrentMember(personId: number) {
  return (detail.value?.members || []).some((m: any) => Number(m.person?.id) === Number(personId));
}
/** 下拉文案里带上「已在/在其他户」，避免把别人的家庭成员当成游离人口加进来 */
function memberOptionLabel(p: any) {
  if (!p) return '';
  const base = personLabel(p);
  if (isCurrentMember(p.id)) return `${base}（已在本户）`;
  return p.familyId ? `${base}（现属 ${p.familyName || '其他户'}）` : base;
}
/**
 * 原户没人当户主了：提示去改选。
 * 跨户加人把原户主搬走后，原户会挂着一个已离户的户主名（和死亡/迁出同一个毛病）。
 */
async function promptVacatedHeads(rows: any[] | undefined) {
  if (!rows?.length) return;
  const shown = rows.slice(0, 5);
  const lines = shown.map((h) => {
    const cand = h.candidate ? `，建议由 ${escapeHtml(h.candidate.name)}（${escapeHtml(relationLabel(h.candidate.relation))}）接任` : '';
    return `<li><b>${escapeHtml(h.familyNo || '家庭')}</b>${h.address ? `（${escapeHtml(h.address)}）` : ''}：原户主 ${
      escapeHtml(h.headName || '—')
    } 已迁入本户，该户在册 ${Number(h.remaining) || 0} 人${cand}</li>`;
  });
  const more = rows.length > shown.length ? `<li>…另有 ${rows.length - shown.length} 户</li>` : '';
  const html =
    `<div style="line-height:1.7">这些户现在没有在册户主：` +
    `<ul style="margin:8px 0 0 18px;padding:0">${lines.join('')}${more}</ul>` +
    `<div style="margin-top:8px">现在去改选户主吗？</div></div>`;
  try {
    await ElMessageBox.confirm(html, `${rows.length} 户户主已离户`, {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '去改选户主',
      cancelButtonText: '稍后处理',
      type: 'warning',
    });
    router.push(rows.length === 1 ? `/families?familyId=${rows[0].familyId}` : '/families');
  } catch {
    /* 用户选「稍后处理」，不打扰 */
  }
}
async function addMember() {
  if (!detail.value || !memberForm.personId) { ElMessage.warning('请选择人员'); return; }
  const picked = memberPicker.list.find((p: any) => p.id === memberForm.personId);
  if (picked?.familyId && Number(picked.familyId) !== Number(detail.value.id)) {
    try {
      await ElMessageBox.confirm(
        `${picked.name} 现属于家庭 ${picked.familyName || picked.familyId}，添加后会从原户迁出（原户保留一条离户记录）。是否继续？`,
        '跨户添加确认',
        { type: 'warning', confirmButtonText: '确定迁入', cancelButtonText: '取消' }
      );
    } catch { return; }
  }
  const res = await familyApi.addMember(detail.value.id, { personId: memberForm.personId, relation: memberForm.relation });
  ElMessage.success('成员已添加');
  await openDetail({ id: detail.value.id });
  load();
  await promptVacatedHeads(res?.data?.headVacated);
}
async function removeMember(memberId: number) {
  if (!detail.value) return;
  await familyApi.removeMember(detail.value.id, memberId);
  ElMessage.success('成员已移除');
  openDetail({ id: detail.value.id });
}

onMounted(async () => {
  load();
  // 人员不再预取：候选改为下拉里按关键词远程检索（见 usePersonPicker）
  const g = await gridApi.list({ pageSize: 100 });
  grids.value = g.data.list;
  // 从「户主已离户」提示跳过来的：?familyId=123 直接打开该户详情，
  // 否则用户落到列表里还得自己搜编号，提示等于没给出口
  const fid = Number(route.query.familyId);
  if (Number.isInteger(fid) && fid > 0) openDetail({ id: fid });
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.header-actions { display: flex; gap: 10px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
.auto-result { margin-top: 8px; }
.auto-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 12px; }
.as-item { background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 10px; text-align: center; }
.as-item .as-num { display: block; font-size: var(--font-size-lg); font-weight: 700; color: var(--color-primary); }
.as-item.create .as-num { color: #0E7C6B; }
.as-item.reuse .as-num { color: #5B5BD6; }
.as-item.muted .as-num { color: var(--color-text-secondary); }
.as-item .as-lbl { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.auto-tip { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 8px; }
.section-title { font-size: var(--font-size-base); font-weight: 600; margin: 20px 0 8px; }
.sub-note { font-size: var(--font-size-xs); font-weight: 400; color: var(--color-text-secondary); margin-left: 6px; }
.former-table { opacity: 0.92; }
.add-member { display: flex; gap: 8px; margin-top: 8px; }
.add-note { margin-top: 6px; font-size: var(--font-size-xs); line-height: 1.6; color: var(--color-text-secondary); }
.head-note { margin-top: 10px; font-size: var(--font-size-xs); line-height: 1.6; color: var(--color-text-secondary); }
</style>
