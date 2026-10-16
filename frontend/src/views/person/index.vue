<template>
  <div class="person-page">
    <!-- 标题 -->
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">人口档案</h2>
        <div class="vp-page-subtitle">共 {{ total }} 名村民 · 支持多条件筛选与标签检索</div>
      </div>
      <div class="actions">
        <el-button v-if="auth.hasPermission('excel:import')" @click="$router.push('/excel')">
          <el-icon><Upload /></el-icon>导入
        </el-button>
        <el-button v-if="auth.hasPermission('person:export')" @click="openExport">
          <el-icon><Download /></el-icon>导出
        </el-button>
        <el-button type="primary" v-if="auth.hasPermission('person:create')" @click="openCreate">
          <el-icon><Plus /></el-icon>新增人员
        </el-button>
      </div>
    </div>

    <!-- 搜索与筛选 -->
    <div class="vp-container">
      <div class="vp-search-bar">
        <el-input v-model="query.keyword" placeholder="搜索姓名 / 身份证号 / 手机号" clearable style="width: 280px" @keyup.enter="doSearch" @clear="doSearch">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="query.gender" placeholder="性别" clearable style="width: 100px" @change="doSearch">
          <el-option label="男" value="MALE" /><el-option label="女" value="FEMALE" />
        </el-select>
        <el-select v-model="query.gridId" placeholder="网格" clearable filterable style="width: 140px" @change="doSearch">
          <el-option v-for="g in options.grids" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
        <el-select v-model="query.village" placeholder="村庄" clearable filterable style="width: 140px" @change="doSearch">
          <el-option v-for="v in options.villages" :key="v.name" :label="v.name" :value="v.name" />
        </el-select>
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 110px" @change="doSearch">
          <el-option v-for="s in STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
        <el-checkbox v-model="activeOnly" style="margin-left: 4px" @change="doSearch">只看在册</el-checkbox>
        <el-button type="primary" @click="doSearch"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
      </div>

      <!-- 批量操作 -->
      <div class="vp-toolbar">
        <div class="batch-left">
          <span class="selected-info">已选 <b>{{ selectedIds.size }}</b> 人（跨页保留）</span>
          <el-button v-if="selectedIds.size && auth.hasPermission('tag:manage')" size="small" @click="openBatchTag">
            批量打标签
          </el-button>
          <el-button v-if="selectedIds.size && auth.hasPermission('person:edit')" size="small" @click="openBatchTransfer">
            批量转网格
          </el-button>
          <el-button v-if="selectedIds.size && auth.hasPermission('person:status')" size="small" @click="openBatchStatus">
            变更状态
          </el-button>
          <el-button
            v-if="selectedIds.size && auth.hasPermission('person:edit')"
            size="small" type="danger" plain @click="removeSelected"
          >
            批量删除
          </el-button>
        </div>
        <el-dropdown trigger="click" @command="onColumnCommand">
          <el-button size="small"><el-icon><Operation /></el-icon>列显隐</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="c in columns" :key="c.prop" :command="c.prop">
                {{ c.visible ? '✓ ' : '' }}{{ c.label }}
              </el-dropdown-item>
              <el-dropdown-item divided command="__reset__">恢复默认列</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <!-- 表格 -->
      <el-table
        :data="list"
        v-loading="loading"
        row-key="id"
        height="560"
        @selection-change="onSelectionChange"
        @sort-change="onSortChange"
        border
      >
        <el-table-column type="selection" width="44" reserve-selection />
        <el-table-column v-if="isColVisible('name')" prop="name" label="姓名" width="90" fixed sortable="custom">
          <template #default="{ row }">
            <el-link type="primary" @click="$router.push(toPersonDetail(route, row.id))">{{ row.name }}</el-link>
          </template>
        </el-table-column>
        <el-table-column v-if="isColVisible('gender')" prop="gender" label="性别" width="60">
          <template #default="{ row }">{{ row.gender === 'MALE' ? '男' : '女' }}</template>
        </el-table-column>
        <el-table-column v-if="isColVisible('id_card')" prop="idCard" label="身份证号" width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.idCard || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="isColVisible('age')" prop="age" label="年龄" width="70" sortable="custom" />
        <el-table-column v-if="isColVisible('phone')" prop="phone" label="联系电话" width="120">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="isColVisible('phone_backup')" prop="phoneBackup" label="备用手机号" width="130">
          <template #default="{ row }">{{ row.phoneBackup || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="isColVisible('hukou_address')" prop="hukouAddress" label="户籍地址" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.hukouAddress || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="isColVisible('live_address')" prop="liveAddress" label="实际居住地址" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.liveAddress || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="isColVisible('grid_name')" prop="gridName" label="所属网格" width="110">
          <template #default="{ row }">{{ row.gridName || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="isColVisible('status')" prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTag(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="isColVisible('tags')" label="人口标签" min-width="200">
          <template #default="{ row }">
            <TagPill v-for="t in row.tags.slice(0, 3)" :key="t.id" :name="t.name" :color="t.color" style="margin-right: 4px" />
            <el-tag v-if="row.tags.length > 3" size="small" type="info">+{{ row.tags.length - 3 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="isColVisible('updated_at')" prop="updatedAt" label="更新时间" width="160" sortable="custom">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="270" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="$router.push(toPersonDetail(route, row.id))">详情</el-button>
            <el-button v-if="auth.hasPermission('person:status')" link type="primary" size="small" @click="openStatus(row)">状态</el-button>
            <el-button v-if="auth.hasPermission('person:edit')" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="auth.hasPermission('tag:manage')" link type="primary" size="small" @click="openTagManager(row)">标签</el-button>
            <el-button
              v-if="auth.hasPermission('person:delete')"
              link type="danger" size="small" @click="removePerson(row)"
            >删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="load"
          @size-change="doSearch"
        />
      </div>
    </div>

    <!-- 新增/编辑弹窗 -->
    <!--
      destroy-on-close：关闭即销毁弹窗内的组件实例与 DOM。
      不开的话每次关闭只是隐藏，几十个表单组件（含几百个家庭 option）连同它们的
      watcher 常驻内存，反复开关会越堆越多，最终把主线程拖垮、点侧边栏跳转卡死。

      tab 加 lazy：三个页签共约 40 个表单控件，默认会一次性全部渲染，
      首次点「新增人员」要现建这么多组件，所以刷新后第一次打开特别卡。
      懒加载后只渲染当前页签，首次打开只需建「基本信息」这一屏。
    -->
    <el-dialog v-model="formVisible" :title="form.id ? '编辑人员' : '新增人员'" width="720px" top="6vh" destroy-on-close>
      <el-tabs v-model="formTab" class="form-tabs">
        <el-tab-pane label="基本信息" name="basic" lazy>
          <el-form :model="form" label-width="100px">
            <el-row :gutter="16">
              <el-col :span="12"><el-form-item label="姓名" required><el-input v-model="form.name" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="曾用名"><el-input v-model="form.formerName" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="性别"><el-radio-group v-model="form.gender"><el-radio value="MALE">男</el-radio><el-radio value="FEMALE">女</el-radio></el-radio-group></el-form-item></el-col>
              <el-col :span="12">
                <el-form-item label="身份证号"><el-input v-model="form.idCard" placeholder="选填，自动校验" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="出生日期">
                  <div style="width: 100%">
                    <el-date-picker
                      v-model="form.birthDate"
                      type="date"
                      value-format="YYYY-MM-DD"
                      style="width: 100%"
                      :disabled="!!idCardBirth"
                      placeholder="无身份证时手动填写"
                    />
                    <div class="hint">
                      {{ idCardBirth ? '以身份证号为准，自动带出' : '填写身份证号后自动带出（年龄按身份证号计算）' }}
                    </div>
                  </div>
                </el-form-item>
              </el-col>
              <el-col :span="12"><el-form-item label="联系电话"><el-input v-model="form.phone" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="备用手机号"><el-input v-model="form.phoneBackup" placeholder="家属/第二联系人" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="所属网格"><el-select v-model="form.gridId" filterable clearable style="width: 100%"><el-option v-for="g in options.grids" :key="g.id" :label="g.name" :value="g.id" /></el-select></el-form-item></el-col>
              <!--
                家庭下拉用 el-select-v2（虚拟滚动）而不是 el-select：
                /persons/meta/options 返回的是全量家庭（无分页），一个村几百户时
                el-select 会真的渲染几百个 el-option 节点，是弹窗卡顿的大头之一。
                v2 只渲染可视区的十几条，数据量再大也是常数开销。
              -->
              <el-col :span="12">
                <el-form-item label="所属家庭">
                  <el-select-v2
                    v-model="form.familyId"
                    :options="familyOptions"
                    filterable
                    clearable
                    style="width: 100%"
                    placeholder="输入户号搜索"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12"><el-form-item label="与户主关系"><el-select v-model="form.relation" clearable style="width: 100%"><el-option label="户主" value="HEAD" /><el-option label="配偶" value="SPOUSE" /><el-option label="子女" value="CHILD" /><el-option label="父母" value="PARENT" /><el-option label="其他" value="OTHER" /></el-select></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="所属村庄"><el-input v-model="form.village" /></el-form-item></el-col>
              <el-col :span="24"><el-form-item label="户籍地址"><el-input v-model="form.hukouAddress" /></el-form-item></el-col>
              <el-col :span="24"><el-form-item label="居住地址"><el-input v-model="form.liveAddress" /></el-form-item></el-col>
              <!-- 建档时就能挂标签，不必先保存再回列表页逐个去「标签」里加 -->
              <el-col :span="24">
                <el-form-item label="人口标签">
                  <el-select-v2
                    v-model="form.tagIds"
                    :options="personTagOptions"
                    multiple
                    filterable
                    clearable
                    collapse-tags
                    style="width: 100%"
                    placeholder="可多选；空表示不打标签"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="24"><el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item></el-col>
            </el-row>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="补贴与评估" name="subsidy" lazy>
          <el-form :model="form" label-width="100px">
            <el-row :gutter="16">
              <el-col :span="12"><el-form-item label="银行账号"><el-input v-model="form.bankAccount" placeholder="补贴发放到账账号" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="发放金额">
                <el-input-number v-model="form.subsidyAmount" :min="0" :precision="2" :step="50" controls-position="right" style="width: 100%" placeholder="元/月" />
              </el-form-item></el-col>
              <el-col :span="24"><el-form-item label="家庭情况描述">
                <el-input v-model="form.familyCondition" type="textarea" :rows="4" placeholder="家庭成员情况、收入来源、照护压力等" />
              </el-form-item></el-col>
              <el-col :span="24"><el-form-item label="身体评估结果">
                <el-input v-model="form.healthAssessment" type="textarea" :rows="4" placeholder="健康状况、行动能力、就医需求等" />
              </el-form-item></el-col>
            </el-row>
            <el-alert type="info" :closable="false" show-icon
              title="发放金额为当前应发标准（元/月），用于重点人群筛查与补贴发放台账；如需逐次发放记录需另建发放台账。" />
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="残疾信息" name="disability" lazy>
          <el-form :model="form" label-width="100px">
            <el-row :gutter="16">
              <el-col :span="12"><el-form-item label="残疾类别">
                <el-select v-model="form.disabilityType" clearable filterable allow-create placeholder="非残疾人可留空" style="width: 100%">
                  <el-option v-for="t in DISABILITY_TYPES" :key="t" :label="t" :value="t" />
                </el-select>
              </el-form-item></el-col>
              <el-col :span="12"><el-form-item label="残疾等级">
                <el-select v-model="form.disabilityLevel" clearable placeholder="一级最重" style="width: 100%">
                  <el-option v-for="l in DISABILITY_LEVELS" :key="l.value" :label="l.label" :value="l.value" />
                </el-select>
              </el-form-item></el-col>
              <el-col :span="12"><el-form-item label="残疾证号"><el-input v-model="form.disabilityCard" placeholder="如 132101199001011234" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="监护人"><el-input v-model="form.guardianName" placeholder="一级、二级必填" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="监护人手机"><el-input v-model="form.guardianPhone" placeholder="监护人联系电话" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="备注"><el-input v-model="form.disabilityRemark" /></el-form-item></el-col>
            </el-row>
            <el-alert type="warning" :closable="false" show-icon
              title="残疾信息全部留空即视为「非残疾人」，保存时会清除该人员的残疾档案记录。" />
          </el-form>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 标签管理弹窗 -->
    <el-dialog v-model="tagVisible" :title="`标签管理 - ${tagTarget?.name || ''}`" width="520px">
      <div class="tag-manager">
        <div class="tag-add">
          <el-select v-model="tagForm.tagId" placeholder="选择标签" filterable style="flex: 1">
            <el-option v-for="t in personTags" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
          <el-button type="primary" @click="addTag">添加</el-button>
        </div>
        <el-divider>当前标签</el-divider>
        <div v-if="tagTarget?.tags?.length" class="tag-list">
          <el-tag
            v-for="t in tagTarget.tags"
            :key="t.linkId"
            closable
            :color="t.color"
            style="color: #fff; margin: 4px"
            @close="removeTag(t.linkId)"
          >{{ t.name }}</el-tag>
        </div>
        <el-empty v-else description="暂无标签" :image-size="60" />
      </div>
    </el-dialog>

    <!-- 批量打标签弹窗 -->
    <el-dialog v-model="batchTagVisible" title="批量打标签" width="480px">
      <el-alert :title="`将对已选的 ${selectedIds.size} 人执行操作，请二次确认`" type="warning" :closable="false" style="margin-bottom: 16px" />
      <el-form label-width="80px">
        <el-form-item label="操作"><el-radio-group v-model="batchTagForm.action"><el-radio value="ADD">添加标签</el-radio><el-radio value="REMOVE">移除标签</el-radio></el-radio-group></el-form-item>
        <el-form-item label="标签"><el-select v-model="batchTagForm.tagIds" multiple filterable style="width: 100%"><el-option v-for="t in personTags" :key="t.id" :label="t.name" :value="t.id" /></el-select></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchTagVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitBatchTag">确认执行</el-button>
      </template>
    </el-dialog>

    <!-- 批量转网格弹窗 -->
    <el-dialog v-model="transferVisible" title="批量转网格" width="480px">
      <el-form label-width="80px">
        <el-form-item label="目标网格"><el-select v-model="transferForm.targetGridId" filterable style="width: 100%"><el-option v-for="g in options.grids" :key="g.id" :label="g.name" :value="g.id" /></el-select></el-form-item>
        <el-form-item label="原因"><el-input v-model="transferForm.reason" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transferVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitTransfer">确认转移</el-button>
      </template>
    </el-dialog>

    <!-- 导出弹窗 -->
    <el-dialog v-model="exportVisible" title="导出人员数据" width="560px">
      <el-form label-width="100px">
        <el-form-item label="导出字段">
          <el-checkbox-group v-model="exportForm.fields">
            <el-checkbox v-for="f in exportFields" :key="f.key" :value="f.key">{{ f.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="数据范围">
          <el-checkbox v-model="exportForm.activeOnly">只导出在册人员</el-checkbox>
          <div class="hint">取消勾选可导出含已迁出、已死亡的历史档案</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="exportVisible = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="submitExport">导出</el-button>
      </template>
    </el-dialog>

    <!-- 状态变更弹窗（单条 / 批量共用） -->
    <StatusChangeDialog v-model="statusVisible" :persons="statusTargets" @done="load" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { personApi, tagApi, gridApi, excelApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { toPersonDetail } from '@/utils/nav';
import { STATUS_OPTIONS, statusLabel, statusTagType } from '@/utils/personStatus';
import { DISABILITY_LEVELS, DISABILITY_TYPES } from '@/utils/disability';
import { birthFromIdCard, genderFromIdCard } from '@/utils/idcard';
import { useListUrlSync } from '@/composables/useListUrlSync';
import { useColumnVisibility } from '@/composables/useColumnVisibility';
import TagPill from '@/components/TagPill.vue';
import StatusChangeDialog from '@/components/StatusChangeDialog.vue';

const route = useRoute();
import type { PersonItem } from '@/types';

const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const exporting = ref(false);
const list = ref<PersonItem[]>([]);
const total = ref(0);
const selectedIds = ref<Set<number>>(new Set());
const options = reactive({ grids: [] as any[], families: [] as any[], villages: [] as any[] });
const commonTags = ref<any[]>([]);

/** 只看在册（默认开启）：隐藏已迁出/已死亡的历史档案，勾选状态筛选时以后者为准 */
const activeOnly = ref(true);

/**
 * 查询条件与地址栏同步：新增筛选字段时只要往 fields 里加一行，
 * 就会自动获得「写入 URL / 从 URL 还原 / 重置 / 组装请求参数」四件事。
 */
const {
  query,
  syncUrl,
  restoreQuery,
  resetQuery: resetQueryState,
  buildParams,
} = useListUrlSync({
  path: '/persons',
  initial: () => ({
    page: 1,
    pageSize: 20,
    keyword: '',
    gender: '',
    gridId: null as number | null,
    village: '',
    status: '',
    sortBy: '',
    sortOrder: '',
  }),
  fields: [
    { key: 'keyword' },
    { key: 'gender' },
    { key: 'gridId', type: 'number' },
    { key: 'village' },
    { key: 'status' },
  ],
  extras: { activeOnly: { ref: activeOnly, defaultValue: true } },
});

/** 状态变更弹窗目标人员（单条或批量） */
const statusVisible = ref(false);
const statusTargets = ref<{ id: number; name: string; status?: string }[]>([]);
function openStatus(row: any) {
  statusTargets.value = [{ id: row.id, name: row.name, status: row.status }];
  statusVisible.value = true;
}
function openBatchStatus() {
  const rows = list.value.filter((r: any) => selectedIds.value.has(r.id));
  if (!rows.length) { ElMessage.warning('请先在列表中选择人员'); return; }
  statusTargets.value = rows.map((r: any) => ({ id: r.id, name: r.name, status: r.status }));
  statusVisible.value = true;
}

const personTags = computed(() => commonTags.value.filter((t: any) => t.object_type === 'PERSON' && t.enabled === 1));

/** el-select-v2 的选项格式：{ label, value }。家庭全量返回，靠虚拟滚动扛住数量 */
const familyOptions = computed(() =>
  options.families.map((f: any) => ({ label: f.family_no, value: f.id }))
);
const personTagOptions = computed(() =>
  personTags.value.map((t: any) => ({ label: t.name, value: t.id }))
);

/* 列显隐：默认不展示「编号」「所属家庭」，改为展示户籍/居住地址 */
const DEFAULT_COLUMNS = [
  { prop: 'name', label: '姓名', visible: true },
  { prop: 'gender', label: '性别', visible: true },
  { prop: 'id_card', label: '身份证号', visible: true },
  { prop: 'age', label: '年龄', visible: true },
  { prop: 'phone', label: '联系电话', visible: true },
  { prop: 'phone_backup', label: '备用手机号', visible: true },
  { prop: 'hukou_address', label: '户籍地址', visible: true },
  { prop: 'live_address', label: '实际居住地址', visible: true },
  { prop: 'grid_name', label: '所属网格', visible: true },
  { prop: 'status', label: '状态', visible: true },
  { prop: 'tags', label: '人口标签', visible: true },
  { prop: 'updated_at', label: '更新时间', visible: true },
];

// 显隐持久化到 localStorage；读取时以默认列为准归并，后续增删列不会被旧缓存打乱
const { columns, isColVisible, toggleColumn, resetColumns } = useColumnVisibility(
  'person:columns',
  DEFAULT_COLUMNS
);

/** 列显隐下拉的统一入口：普通项切换显隐，「恢复默认列」重置 */
function onColumnCommand(prop: string) {
  if (prop === '__reset__') resetColumns();
  else toggleColumn(prop);
}

const exportFields = [
  { key: 'person_no', label: '人员编号' },
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性别' },
  { key: 'birth_date', label: '出生日期' },
  { key: 'id_card', label: '身份证号' },
  { key: 'phone', label: '手机号' },
  { key: 'phone_backup', label: '备用手机号' },
  { key: 'hukou_address', label: '户籍地址' },
  { key: 'live_address', label: '实际居住地址' },
  { key: 'grid_name', label: '所属网格' },
  { key: 'family_name', label: '所属家庭' },
  { key: 'status', label: '人员状态' },
  // 重点人群台账字段（V008）
  { key: 'bank_account', label: '银行账号' },
  { key: 'subsidy_amount', label: '发放金额' },
  { key: 'disability_type', label: '残疾类别' },
  { key: 'disability_level_label', label: '残疾等级' },
  { key: 'disability_card', label: '残疾证号' },
  { key: 'guardian_name', label: '监护人' },
  { key: 'guardian_phone', label: '监护人手机' },
  { key: 'family_condition', label: '家庭情况描述' },
  { key: 'health_assessment', label: '身体评估结果' },
];

// 表单
const formVisible = ref(false);
const formTab = ref('basic');
/** 表单初始值：新增与重置共用，避免两处漏改字段 */
const emptyForm = () => ({
  id: null, name: '', formerName: '', gender: 'MALE', birthDate: '', idCard: '', phone: '', phoneBackup: '',
  gridId: null, familyId: null, relation: '', village: '', hukouAddress: '', liveAddress: '', remark: '',
  // 建档/编辑时一并维护的标签 id 列表（后端写入 person_tag）
  tagIds: [] as number[],
  // 补贴与评估（V008）
  bankAccount: '', subsidyAmount: undefined as number | undefined, familyCondition: '', healthAssessment: '',
  // 残疾档案（V008）：全部为空表示非残疾人，保存时后端会清除档案
  disabilityType: '', disabilityLevel: '', disabilityCard: '',
  guardianName: '', guardianPhone: '', disabilityRemark: '',
});
const form = reactive<any>(emptyForm());

/**
 * 身份证号派生出的出生日期（年龄口径以身份证为准，与后端规则一致）。
 * 有值 = 该身份证能解析出合法出生日期，此时出生日期不可手改，且会即时覆盖表单值；
 * 无身份证 / 号码日期不合法时为空，可手动填写。
 */
const idCardBirth = ref<string | null>(null);

watch(() => form.idCard, (val: string) => {
  const birth = birthFromIdCard(val || '');
  idCardBirth.value = birth;
  if (birth) form.birthDate = birth;
  const g = genderFromIdCard(val || '');
  if (g) form.gender = g;
});

const tagVisible = ref(false);
const tagTarget = ref<any>(null);
const tagForm = reactive({ tagId: null as number | null });

const batchTagVisible = ref(false);
const batchTagForm = reactive({ action: 'ADD', tagIds: [] as number[] });

const transferVisible = ref(false);
const transferForm = reactive({ targetGridId: null as number | null, reason: '' });

const exportVisible = ref(false);
const exportForm = reactive({ fields: exportFields.map((f) => f.key), activeOnly: true });

function statusTag(s: string): any { return statusTagType(s); }
function formatTime(t?: string) { return t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—'; }

/**
 * 列表查询。请求参数由 buildParams() 统一组装（数组字段转逗号串、布尔开关转 'true'/'false'），
 * 查询完把条件写回地址栏，从详情页返回时才能还原现场。
 */
async function load() {
  loading.value = true;
  try {
    const res = await personApi.list(buildParams());
    list.value = res.data.list;
    total.value = res.data.total;
    syncUrl();
  } finally {
    loading.value = false;
  }
}

function doSearch() { query.page = 1; load(); }

/** 重置筛选（含「只看在册」开关）并重新查询 */
function resetQuery() {
  resetQueryState();
  load();
}

function onSelectionChange(rows: any[]) {
  selectedIds.value = new Set(rows.map((r) => r.id));
}
function onSortChange({ prop, order }: any) {
  if (order === 'ascending') { query.sortBy = prop === 'name' ? 'name' : prop; query.sortOrder = 'asc'; }
  else if (order === 'descending') { query.sortBy = prop; query.sortOrder = 'desc'; }
  else { query.sortBy = ''; query.sortOrder = ''; }
  load();
}

function openCreate() {
  Object.assign(form, emptyForm());
  formTab.value = 'basic';
  formVisible.value = true;
}
/**
 * 编辑时拉一次详情：列表行不含残疾档案（person_disability 是 LEFT JOIN，
 * 未接进列表查询），否则打开弹窗会看到空白的残疾信息，误以为没建档。
 */
async function openEdit(row: any) {
  Object.assign(form, emptyForm());
  formTab.value = 'basic';
  const d = await personApi.detail(row.id);
  const p = d.data || row;
  Object.assign(form, {
    id: p.id, name: p.name, formerName: p.formerName || '', gender: p.gender, birthDate: p.birthDate || '',
    idCard: p.idCard || '', phone: p.phone || '', phoneBackup: p.phoneBackup || '',
    gridId: p.gridId, familyId: p.familyId, relation: p.relation,
    village: p.village || '', hukouAddress: p.hukouAddress || '', liveAddress: p.liveAddress || '', remark: p.remark || '',
    // 详情里的标签回填到多选：列表行不带 tags，这里用的是 detail 接口的结果
    tagIds: (p.tags || []).map((t: any) => t.id).filter((id: any) => typeof id === 'number'),
    bankAccount: p.bankAccount || '',
    subsidyAmount: p.subsidyAmount ?? undefined,
    familyCondition: p.familyCondition || '', healthAssessment: p.healthAssessment || '',
    disabilityType: p.disability?.type || '',
    disabilityLevel: p.disability?.level || '',
    disabilityCard: p.disability?.card || '',
    guardianName: p.disability?.guardianName || '',
    guardianPhone: p.disability?.guardianPhone || '',
    disabilityRemark: p.disability?.remark || '',
  });
  formVisible.value = true;
}
async function saveForm() {
  if (!form.name) { ElMessage.warning('请填写姓名'); return; }
  saving.value = true;
  try {
    // 残疾信息作为嵌套对象提交；全空时后端按「非残疾人」处理并清除档案
    const payload = {
      ...form,
      subsidyAmount: form.subsidyAmount ?? null,
      disability: {
        disabilityType: form.disabilityType,
        disabilityLevel: form.disabilityLevel,
        disabilityCard: form.disabilityCard,
        guardianName: form.guardianName,
        guardianPhone: form.guardianPhone,
        remark: form.disabilityRemark,
      },
    };
    if (form.id) await personApi.update(form.id, payload);
    else await personApi.create(payload);
    ElMessage.success('保存成功');
    formVisible.value = false;
    load();
  } finally { saving.value = false; }
}

async function openTagManager(row: any) {
  const detail = await personApi.detail(row.id);
  tagTarget.value = detail.data;
  tagVisible.value = true;
}
async function addTag() {
  if (!tagForm.tagId || !tagTarget.value) return;
  await personApi.addTag(tagTarget.value.id, { tagId: tagForm.tagId });
  ElMessage.success('标签已添加');
  const d = await personApi.detail(tagTarget.value.id);
  tagTarget.value = d.data;
}
async function removeTag(linkId: number) {
  if (!tagTarget.value) return;
  await personApi.removeTag(tagTarget.value.id, linkId);
  ElMessage.success('标签已移除');
  const d = await personApi.detail(tagTarget.value.id);
  tagTarget.value = d.data;
}

/** 删除单个人员（物理删除，不可恢复） */
async function removePerson(row: any) {
  try {
    await ElMessageBox.confirm(
      `将物理删除人员「${row.name}」及其身份证号、手机号、标签、家庭成员关系、残疾档案与全部变更记录，且不可恢复。\n\n注意：死亡、迁出请使用「状态」功能登记，不要删除人员。\n\n是否确认删除？`,
      '删除确认（不可恢复）',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch { return; }
  await personApi.remove(row.id);
  ElMessage.success('人员已删除');
  selectedIds.value.delete(row.id);
  load();
}

/** 批量删除（物理删除，不可恢复） */
async function removeSelected() {
  const ids = Array.from(selectedIds.value);
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(
      `将删除已选的 ${ids.length} 名人员及其关联数据，且不可恢复。是否继续？`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch { return; }
  let failed = 0;
  for (const id of ids) {
    try { await personApi.remove(id); } catch { failed++; }
  }
  ElMessage[failed ? 'warning' : 'success'](failed ? `已完成，${failed} 条删除失败` : `已删除 ${ids.length} 名人员`);
  selectedIds.value.clear();
  load();
}

function openBatchTag() { batchTagVisible.value = true; }
async function submitBatchTag() {
  if (!batchTagForm.tagIds.length) { ElMessage.warning('请选择标签'); return; }
  saving.value = true;
  try {
    await personApi.batchTags({ personIds: Array.from(selectedIds.value), tagIds: batchTagForm.tagIds, action: batchTagForm.action });
    ElMessage.success('批量操作完成');
    batchTagVisible.value = false;
    load();
  } finally { saving.value = false; }
}

function openBatchTransfer() { transferVisible.value = true; }
async function submitTransfer() {
  if (!transferForm.targetGridId) { ElMessage.warning('请选择目标网格'); return; }
  saving.value = true;
  try {
    await gridApi.transferPerson({ personIds: Array.from(selectedIds.value), targetGridId: transferForm.targetGridId, reason: transferForm.reason });
    ElMessage.success('人员已转移');
    transferVisible.value = false;
    load();
  } finally { saving.value = false; }
}

function openExport() { exportVisible.value = true; }
async function submitExport() {
  exporting.value = true;
  try {
    const res: any = await excelApi.export({
      ...exportForm,
      keyword: query.keyword,
      gridId: query.gridId,
      status: query.status,
      gender: query.gender,
      // 导出的数据范围与列表保持一致
      activeOnly: exportForm.activeOnly,
    });
    ElMessage.success(`导出完成，共 ${res.data.total} 条，请到 Excel 页面下载`);
    exportVisible.value = false;
  } finally { exporting.value = false; }
}

onMounted(async () => {
  // 支持从网格/村庄概览页跳转过来时带入筛选条件（/persons?gridId=1 或 ?village=艾园村），
  // 也支持从人员详情返回时还原离开前的筛选与分页
  restoreQuery();
  load();
  const [opts, tags] = await Promise.all([
    personApi.options(),
    tagApi.definitions({ pageSize: 200, objectType: 'PERSON' }),
  ]);
  options.grids = opts.data.grids;
  options.families = opts.data.families;
  commonTags.value = tags.data.list;
  // 村庄下拉：取自人员档案中已有的村庄名，失败时静默降级为空（不影响人员列表本身）
  try {
    const vil: any = await gridApi.villages();
    options.villages = vil?.data?.list || [];
  } catch { options.villages = []; }
});
</script>

<style scoped>
.person-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.actions {
  display: flex;
  gap: 8px;
}
.batch-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.selected-info {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
.selected-info b {
  color: var(--color-primary);
}
.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.tag-manager .tag-add {
  display: flex;
  gap: 8px;
}
.tag-list {
  padding: 4px 0;
}
</style>
