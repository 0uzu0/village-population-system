<template>
  <el-dialog
    :model-value="modelValue"
    :title="isBatch ? `批量变更状态（${persons.length} 人）` : `变更状态 - ${persons[0]?.name || ''}`"
    width="520px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-alert
      type="info"
      :closable="false"
      style="margin-bottom: 16px"
      title="死亡、迁出请在这里变更状态，不要删除人员"
      description="变更后档案、标签与变更记录全部保留，该人员自动从人口统计和重点人群名单中退出，可随时改回。户籍人口 / 流动人口标签会随状态停用或恢复——这两枚描述的是当前归属，不是历史身份。家庭成员关联也会同步标记离开；若该户因此没有在册成员，将不再计入家庭总数（改回在册后自动恢复）。"
    />

    <el-form label-width="96px">
      <el-form-item label="当前状态">
        <el-tag size="small" :type="statusTagType(currentStatus)">{{ statusLabel(currentStatus) }}</el-tag>
        <span v-if="isBatch && mixedStatus" class="hint">（所选人员状态不一致）</span>
      </el-form-item>
      <el-form-item label="变更为" required>
        <el-radio-group v-model="form.status">
          <el-radio v-for="s in CHANGEABLE_STATUSES" :key="s" :value="s" :disabled="!isBatch && s === currentStatus">
            {{ statusLabel(s) }}
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="isInactive" label="生效日期">
        <el-date-picker
          v-model="form.statusDate"
          type="date"
          value-format="YYYY-MM-DD"
          :placeholder="form.status === 'DEAD' ? '死亡日期' : '迁出日期'"
          style="width: 100%"
        />
        <div class="hint">留空则默认记为今天</div>
      </el-form-item>
      <el-form-item label="变更原因">
        <el-input
          v-model="form.reason"
          type="textarea"
          :rows="2"
          :placeholder="form.status === 'DEAD' ? '如：2026-03 病故，已核销户口' : '如：迁往南京，随子女居住'"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">确认变更</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { personApi } from '@/api';
import { relationLabel, escapeHtml } from '@/utils/format';
import {
  PERSON_STATUSES,
  statusLabel,
  statusTagType,
  isActiveStatus,
} from '@/utils/personStatus';

const props = defineProps<{
  modelValue: boolean;
  /** 目标人员，至少 1 个；批量时传多条 */
  persons: { id: number; name: string; status?: string }[];
}>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; done: [] }>();
const router = useRouter();

const saving = ref(false);
const form = reactive<{ status: string; statusDate: string | null; reason: string }>({
  status: 'MOVED_OUT',
  statusDate: null,
  reason: '',
});

/**
 * 可变更为的状态：去掉「迁入」。
 *
 * 「迁入」是人员入库时的**初始状态**（Excel 导入/手工建档时按迁入登记），
 * 不是一次「变更」动作——把一个已在册的人变更成迁入，语义上站不住，
 * 而且迁入属于在册状态，用它做变更会让人误以为档案发生了实质变化。
 * 注意：这里只过滤变更目标，PERSON_STATUSES / ACTIVE_STATUSES 本身不动——
 * 迁入仍要作为合法状态参与统计（在册口径）与筛选。
 */
const CHANGEABLE_STATUSES = PERSON_STATUSES.filter((s) => s !== 'MOVED_IN');

const isBatch = computed(() => props.persons.length > 1);
const currentStatus = computed(() => props.persons[0]?.status || '');
const mixedStatus = computed(() => props.persons.some((p) => (p.status || '') !== currentStatus.value));
/** 目标为非在册时才需要填生效日期 */
const isInactive = computed(() => !isActiveStatus(form.status));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    // 每次打开重置为默认目标状态，避免沿用上一次的选择
    form.status = isActiveStatus(currentStatus.value) ? 'MOVED_OUT' : 'NORMAL';
    form.statusDate = null;
    form.reason = '';
  }
);

/**
 * 提示语里的姓名/地址来自数据库，拼进 HTML 前必须转义。
 * ElMessageBox 的 dangerouslyUseHTMLString 不转义就等于把库里的字符串当模板执行。
 */
/**
 * 户主离户提示。
 *
 * 为什么要单独弹：死亡/迁出登记可以一次办完（现场就那一趟），但这一户从此
 * 「还有人、没在册户主」，家庭列表与导出仍显示已故者姓名。以前这件事没有任何
 * 提示，只能等下次对账或核对名单才发现，看起来像数据错了。
 *
 * 只提示、不阻断、不自动改：继任户主是业务决定（配偶？长子？），工具不能替人挑。
 */
async function promptVacatedHeads(rows: any[]) {
  if (!rows?.length) return;
  const shown = rows.slice(0, 5);
  const lines = shown.map((h) => {
    const who = h.headName ? `户主 ${escapeHtml(h.headName)} ` : '户主';
    const cand = h.candidate
      ? `，建议由 ${escapeHtml(h.candidate.name)}（${escapeHtml(relationLabel(h.candidate.relation))}）接任`
      : '';
    return `<li><b>${escapeHtml(h.familyNo || '家庭')}</b>${h.address ? `（${escapeHtml(h.address)}）` : ''}：${who}已离户，在册 ${
      Number(h.remaining) || 0
    } 人${cand}</li>`;
  });
  const more = rows.length > shown.length ? `<li>…另有 ${rows.length - shown.length} 户</li>` : '';
  const html =
    `<div style="line-height:1.7">这些户现在没有在册户主，家庭列表与导出仍显示已离户的人：` +
    `<ul style="margin:8px 0 0 18px;padding:0">${lines.join('')}${more}</ul>` +
    `<div style="margin-top:8px">现在去改选户主吗？</div></div>`;
  try {
    await ElMessageBox.confirm(html, `${rows.length} 户户主已离户`, {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '去改选户主',
      cancelButtonText: '稍后处理',
      type: 'warning',
    });
    // 单户直接打开该户详情抽屉（家庭页读 ?familyId），多户回列表自己挑
    router.push(rows.length === 1 ? `/families?familyId=${rows[0].familyId}` : '/families');
  } catch {
    /* 用户选「稍后处理」，不打扰 */
  }
}

async function submit() {
  if (!form.status) { ElMessage.warning('请选择要变更为的状态'); return; }
  if (!props.persons.length) return;
  saving.value = true;
  try {
    const payload = {
      status: form.status,
      statusDate: isInactive.value ? form.statusDate || null : null,
      reason: form.reason || undefined,
    };
    const res: any = isBatch.value
      ? await personApi.batchStatus({ personIds: props.persons.map((p) => p.id), ...payload })
      : await personApi.changeStatus(props.persons[0].id, payload);
    emit('update:modelValue', false);
    emit('done');
    ElMessage.success(res?.message || '状态已更新');
    // 放在关闭之后弹：先关表单再问户主，避免两层弹窗叠在一起
    await promptVacatedHeads(res?.data?.headVacated || []);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.hint {
  margin-left: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>
