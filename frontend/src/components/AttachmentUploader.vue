<template>
  <div class="attachment-uploader">
    <el-upload
      :http-request="doUpload"
      :show-file-list="false"
      accept=".pdf,.jpg,.jpeg,.png,.webp"
      :before-upload="beforeUpload"
    >
      <el-button type="primary" plain>
        <el-icon><Upload /></el-icon>添加附件（合同 PDF / 发票图片）
      </el-button>
    </el-upload>

    <div v-if="files.length" class="file-list">
      <div v-for="f in files" :key="f.id" class="file-item">
        <el-icon class="file-icon" :class="{ pdf: f.fileType === 'pdf' }">
          <Document v-if="f.fileType === 'pdf'" />
          <Picture v-else />
        </el-icon>
        <span class="file-name" :title="f.fileName">{{ f.fileName }}</span>
        <span class="file-size">{{ formatSize(f.size) }}</span>
        <el-button link type="primary" size="small" @click="preview(f)">预览</el-button>
        <el-button link type="danger" size="small" @click="remove(f)">删除</el-button>
      </div>
    </div>
    <el-empty v-else description="暂无附件" :image-size="48" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Upload, Document, Picture } from '@element-plus/icons-vue';
import { fileApi } from '@/api';
import request from '@/api/request';

export interface Attachment {
  id: number;
  fileName: string;
  fileType: string;
  size: number;
  contentType: string;
}

const props = defineProps<{ modelValue: Attachment[] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: Attachment[]): void }>();

const files = ref<Attachment[]>([...props.modelValue]);

watch(
  () => props.modelValue,
  (v) => { files.value = [...v]; },
  { deep: true }
);

function sync() {
  emit('update:modelValue', [...files.value]);
}

// 大小不限制（后端与 nginx 均已放开），仅校验类型白名单
function beforeUpload(file: File) {
  const okTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const okExt = /\.(pdf|jpe?g|png|webp)$/i.test(file.name);
  if (!okExt && !okTypes.includes(file.type)) {
    ElMessage.error('仅支持 PDF / JPG / JPEG / PNG / WEBP 文件');
    return false;
  }
  return true;
}

// 自定义上传：走 axios 拦截器带上 JWT（el-upload 自带 XHR 不会带 token）
async function doUpload(options: any) {
  const fd = new FormData();
  fd.append('file', options.file);
  try {
    const resp: any = await fileApi.upload(fd);
    const data = resp.data as Attachment;
    files.value.push(data);
    sync();
    options.onSuccess(data);
  } catch (e: any) {
    ElMessage.error(e?.msg || '上传失败');
    options.onError(e);
  }
}

function formatSize(n?: number) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 预览：带鉴权头 fetch 为 blob 再开新标签（Bearer 鉴权下 <img src> 直链会 401）
async function preview(f: Attachment) {
  try {
    const resp: any = await request.get(`/files/${f.id}`, { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    ElMessage.error('预览失败');
  }
}

async function remove(f: Attachment) {
  try {
    await fileApi.remove(f.id);
  } catch {
    ElMessage.error('删除失败');
    return;
  }
  files.value = files.value.filter((x) => x.id !== f.id);
  sync();
}
</script>

<style scoped>
.attachment-uploader {
  width: 100%;
}
.file-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  background: var(--color-bg-hover);
}
.file-icon {
  font-size: var(--font-size-lg);
  color: var(--color-primary);
}
.file-icon.pdf {
  color: #e64a19;
}
.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
}
.file-size {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>
