import { createRouter, createWebHistory } from 'vue-router';
import Home from './pages/Home.vue';
import Job from './pages/Job.vue';
import Confirm from './pages/Confirm.vue';
import Import from './pages/Import.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/job/:id', component: Job },
    { path: '/job/:id/confirm', component: Confirm },
    { path: '/job/:id/import', component: Import },
  ],
});
