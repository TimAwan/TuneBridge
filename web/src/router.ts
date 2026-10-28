import { createRouter, createWebHistory } from 'vue-router';
import Home from './pages/Home.vue';
import Job from './pages/Job.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/job/:id', component: Job },
  ],
});
