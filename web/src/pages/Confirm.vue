<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { JobSnapshot, MatchResult, MismatchReason, SourceTrack } from '@tunebridge/shared';
import { confirmJob, getJob } from '../api';
import CandidateCard from '../components/CandidateCard.vue';

const REASON_TEXT: Record<MismatchReason, string> = {
  not_found: '未找到候选',
  title: '歌名不一致',
  artist: '歌手不一致',
  duration: '时长不一致',
  version: '版本不一致',
};

const props = defineProps<{ jobId?: string }>();
const route = useRoute();
const router = useRouter();
const jobId = computed(() => props.jobId ?? String(route.params.id));

const snapshot = ref<JobSnapshot | null>(null);
const loadError = ref('');
const submitting = ref(false);
const selection = ref(new Map<number, string>());

const results = computed(() => snapshot.value?.results ?? []);
const tracksByOrder = computed(() => {
  const map = new Map<number, SourceTrack>();
  for (const t of snapshot.value?.parsed?.tracks ?? []) map.set(t.order, t);
  return map;
});

const autoGroup = computed(() => results.value.filter((r) => r.tier === 'auto'));
const confirmGroup = computed(() => results.value.filter((r) => r.tier === 'confirm'));
const noneGroup = computed(() => results.value.filter((r) => r.tier === 'none'));

const manualCount = computed(
  () => [...selection.value.values()].filter((v) => v.length > 0).length,
);
const skipCount = computed(() => confirmGroup.value.length - manualCount.value);

function toggle(order: number, appleId: string): void {
  if (selection.value.get(order) === appleId) selection.value.delete(order);
  else selection.value.set(order, appleId);
  selection.value = new Map(selection.value);
}

function isSelected(order: number, appleId: string): boolean {
  return selection.value.get(order) === appleId;
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await confirmJob(jobId.value, [
      ...autoGroup.value.map((r) => ({ order: r.order, appleId: (r.chosen as { id: string }).id })),
      ...confirmGroup.value.map((r) => ({
        order: r.order,
        appleId: selection.value.get(r.order) ?? null,
      })),
    ]);
    await router.push(`/job/${jobId.value}`);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '提交失败,请稍后重试';
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  try {
    snapshot.value = await getJob(jobId.value);
    if (snapshot.value && snapshot.value.state !== 'awaiting_confirmation') {
      loadError.value = '任务当前状态不可确认';
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '加载失败';
  }
});

function reasonText(result: MatchResult): string {
  return result.reason ? REASON_TEXT[result.reason] : '';
}
</script>

<template>
  <main class="confirm">
    <h2>确认匹配结果</h2>
    <p class="playlist" v-if="snapshot?.parsed">
      {{ snapshot.parsed.name }} · {{ snapshot.parsed.tracks.length }} 首
    </p>
    <p v-if="loadError" class="error">{{ loadError }}</p>

    <section>
      <h3>自动加入({{ autoGroup.length }})</h3>
      <p class="desc">以下歌曲证据链完整,将自动加入(含你在目标地区的匹配)</p>
      <ul>
        <li v-for="r in autoGroup" :key="r.order">
          {{ tracksByOrder.get(r.order)?.title }} → {{ r.chosen?.title }}
          <span class="ok">✓</span>
        </li>
      </ul>
    </section>

    <section>
      <h3>待确认({{ confirmGroup.length }})</h3>
      <p class="desc">以下歌曲证据不足,默认跳过;从候选中选择正确的版本(D4:非原版候选不会默认选中)</p>
      <div v-for="r in confirmGroup" :key="r.order" class="track-block">
        <p class="track-title">
          {{ tracksByOrder.get(r.order)?.title }}
          <span class="artist">{{ tracksByOrder.get(r.order)?.artistRaw }}</span>
        </p>
        <div class="cards">
          <CandidateCard
            v-for="c in r.candidates"
            :key="c.id"
            :candidate="c"
            :source-duration-ms="tracksByOrder.get(r.order)?.durationMs ?? 0"
            :selected="isSelected(r.order, c.id)"
            @select="toggle(r.order, c.id)"
          />
        </div>
      </div>
    </section>

    <section>
      <h3>未匹配({{ noneGroup.length }})</h3>
      <ul>
        <li v-for="r in noneGroup" :key="r.order">
          {{ tracksByOrder.get(r.order)?.title }}
          <span class="reason">({{ reasonText(r) }})</span>
        </li>
      </ul>
    </section>

    <footer>
      <p>将自动加入 {{ autoGroup.length }} 首 · 已手动确认 {{ manualCount }} 首 · 跳过 {{ skipCount }} 首</p>
      <button class="primary" :disabled="submitting" @click="submit">
        {{ submitting ? '提交中…' : '确认并进入导入' }}
      </button>
    </footer>
  </main>
</template>

<style scoped>
.confirm {
  max-width: 640px;
  margin: 2rem auto;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}
.playlist {
  color: #666;
}
.error {
  color: #c0392b;
}
.desc {
  color: #888;
  font-size: 0.85rem;
}
.track-block {
  margin: 0.8rem 0;
}
.track-title {
  font-weight: 600;
}
.artist {
  color: #888;
  font-weight: 400;
  font-size: 0.85rem;
  margin-left: 0.4rem;
}
.cards {
  display: grid;
  gap: 0.6rem;
  margin-top: 0.4rem;
}
.ok {
  color: #2e7d32;
}
.reason {
  color: #888;
  font-size: 0.85rem;
}
footer {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: flex-start;
  border-top: 1px solid #eee;
  padding-top: 1rem;
}
button.primary {
  font: inherit;
  padding: 0.7rem 2rem;
  cursor: pointer;
  background: #fa2d48;
  color: #fff;
  border: none;
  border-radius: 6px;
}
button.primary:disabled {
  opacity: 0.5;
}
</style>
