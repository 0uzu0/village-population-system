import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import router from './router';
import { registerIcons } from './icons';
import './styles/tokens.css';
import './styles/base.css';
import './styles/element-override.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus);

// 按需注册图标（全量注册会把 293 个图标全部打进产物，实际只用到二十来个）
registerIcons(app);

app.mount('#app');
