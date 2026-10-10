<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">用户与权限</h2>
        <div class="vp-page-subtitle">仅区分「管理员」与「普通用户」两种身份</div>
      </div>
      <el-button v-if="auth.hasPermission('user:manage')" type="primary" @click="openCreateUser">
        <el-icon><Plus /></el-icon>新增用户
      </el-button>
    </div>

    <div class="vp-container">
      <el-table :data="users" v-loading="loading">
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="real_name" label="姓名" width="120" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column label="身份" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.is_admin ? 'danger' : 'info'">{{ row.is_admin ? '管理员' : '普通用户' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }"><el-tag size="small" :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" min-width="160" show-overflow-tooltip />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-if="auth.hasPermission('user:manage')" link type="primary" size="small" @click="openEditUser(row)">编辑</el-button>
            <el-button v-if="auth.hasPermission('user:manage')" link :type="row.status ? 'warning' : 'success'" size="small" @click="toggleUser(row)">{{ row.status ? '停用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" layout="total, prev, pager, next" @current-change="loadUsers" />
      </div>
    </div>

    <!-- 用户编辑弹窗 -->
    <el-dialog v-model="userVisible" :title="userForm.id ? '编辑用户' : '新增用户'" width="520px">
      <el-form :model="userForm" label-width="90px">
        <el-form-item label="账号" required><el-input v-model="userForm.username" :disabled="!!userForm.id" /></el-form-item>
        <el-form-item label="姓名" required><el-input v-model="userForm.realName" /></el-form-item>
        <el-form-item v-if="!userForm.id" label="初始密码"><el-input v-model="userForm.password" type="password" show-password placeholder="至少8位" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="userForm.phone" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="userForm.email" /></el-form-item>
        <el-form-item label="管理员">
          <el-switch v-model="userForm.isAdmin" :active-value="1" :inactive-value="0" active-text="管理员" inactive-text="普通用户" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { userApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const users = ref<any[]>([]);
const total = ref(0);

const query = reactive({ page: 1, pageSize: 20 });
const userVisible = ref(false);
const userForm = reactive<any>({ id: null, username: '', realName: '', password: '', phone: '', email: '', isAdmin: 0 });

async function loadUsers() {
  loading.value = true;
  try {
    const res = await userApi.list({ ...query });
    users.value = res.data.list;
    total.value = res.data.total;
  } finally { loading.value = false; }
}

function openCreateUser() { Object.assign(userForm, { id: null, username: '', realName: '', password: '', phone: '', email: '', isAdmin: 0 }); userVisible.value = true; }
function openEditUser(row: any) { Object.assign(userForm, { id: row.id, username: row.username, realName: row.real_name, password: '', phone: row.phone || '', email: row.email || '', isAdmin: row.is_admin ? 1 : 0 }); userVisible.value = true; }
async function saveUser() {
  if (!userForm.username || !userForm.realName) { ElMessage.warning('请填写账号和姓名'); return; }
  if (!userForm.id && !userForm.password) { ElMessage.warning('请设置初始密码'); return; }
  saving.value = true;
  try {
    if (userForm.id) await userApi.update(userForm.id, userForm);
    else await userApi.create(userForm);
    ElMessage.success('保存成功');
    userVisible.value = false;
    loadUsers();
  } finally { saving.value = false; }
}
async function toggleUser(row: any) {
  await userApi.toggle(row.id);
  ElMessage.success(row.status ? '已停用' : '已启用');
  loadUsers();
}

onMounted(loadUsers);
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
