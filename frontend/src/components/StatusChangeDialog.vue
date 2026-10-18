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
import { ElMessage } from 'element-plus';
import { personApi } from '@/api';
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
    if (isBatch.value) {
      const res: any = await personApi.batchStatus({ personIds: props.persons.map((p) => p.id), ...payload });
      ElMessage.success(res?.message || '状态已更新');
    } else {
      const res: any = await personApi.changeStatus(props.persons[0].id, payload);
      ElMessage.success(res?.message || '状态已更新');
    }
    emit('update:modelValue', false);
    emit('done');
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
