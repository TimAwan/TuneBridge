<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useJobStream } from '../composables/useJobStream';
import type { JobState } from '@tunebridge/shared';

const STATE_TEXT: Record<JobState, string> = {
  queued: '排队中',
  parsing: '正在解析歌单',
  matching: '正在匹配歌曲',
  awaiting_confirmation: '匹配完成,待确认',
  importing: '正在导入',
  done: '已完成',
  failed: '失败',
};

const route = useRoute();
const router = useRouter();
const jobId = ref(String(route.params.id));
const { snapshot, source } = useJobStream(jobId);

watch(
  () => snapshot.value?.state,
  (state) => {
    if (state === 'awaiting_confirmation') {
      void router.push(`/job/${jobId.value}/confirm`);
    }
  },
);

const stateText = computed(() =>
  snapshot.value ? STATE_TEXT[snapshot.value.state] : '连接中',
);
const etaText = computed(() => {
  const eta = snapshot.value?.etaSeconds;
  if (eta === null || eta === undefined) return '';
  if (eta < 60) return `预计约 ${eta} 秒`;
  return `预计约 ${Math.ceil(eta / 60)} 分钟`;
});
const progressPercent = computed(() => {
  const p = snapshot.value?.progress;
  if (!p || p.total === 0) return 0;
  return Math.round((p.done / p.total) * 100);
});
</script>

<template>
  <main class="job">
    <h2>{{ stateText }}</h2>
    <p v-if="snapshot?.state === 'queued'" class="queue">
      排队中,第 {{ snapshot.queuePosition ?? '?' }} 位 · {{ etaText }}
    </p>

    <template v-if="snapshot?.progress">
      <div class="bar">
        <div class="fill" :style="{ width: `${progressPercent}%` }" />
      </div>
      <p class="count">{{ snapshot.progress.done }} / {{ snapshot.progress.total }}</p>
    </template>

    <p v-if="snapshot?.error" class="error">{{ snapshot.error }}</p>
    <p class="meta">连接方式:{{ source === 'sse' ? '实时推送' : '轮询(实时连接中断,已自动降级)' }}</p>
  </main>
</template>

<style scoped>
.job {
  max-width: 560px;
  margin: 4rem auto;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.bar {
  height: 10px;
  background: #eee;
  border-radius: 5px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: #fa2d48;
  transition: width 0.3s;
}
.error {
  color: #c0392b;
}
.meta {
  color: #888;
  font-size: 0.85rem;
}
</style>
