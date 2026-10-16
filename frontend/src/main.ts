import { createApp } from 'vue';
import { createPinia } from 'pinia';
// 样式一次性全量引入；组件本身由 unplugin-vue-components 在模板处按需 import，
// 因此这里不再 `app.use(ElementPlus)`（那会把整库注册进去，产物多出约 950KB）
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

// 按需注册图标（全量注册会把 293 个图标全部打进产物，实际只用到二十来个）
registerIcons(app);

app.mount('#app');
