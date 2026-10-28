<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { JobSnapshot } from '@tunebridge/shared';
import { getJob } from '../api';
import { appendTracks, createPlaylistWithTracks, getMyStorefront } from '../lib/appleApi';
import { buildExportJson, downloadJson } from '../lib/exporter';
import { loadMusicKit } from '../lib/musickit';

const props = defineProps<{ jobId?: string }>();
const route = useRoute();
const jobId = computed(() => props.jobId ?? String(route.params.id));

const snapshot = ref<JobSnapshot | null>(null);
const loadError = ref('');
const playlistName = ref('');
const authorized = ref(false);
const authorizing = ref(false);
const importing = ref(false);
const userStorefront = ref('');
const devToken = ref('');
const included = ref(new Map<number, boolean>());
const importDone = ref<{ added: string[]; failed: string[]; playlistId: string } | null>(null);

interface Target {
  order: number;
  appleId: string;
  storefront: string;
  title: string;
}

const targets = computed<Target[]>(() => {
  const snap = snapshot.value;
  if (!snap?.parsed || !snap.choices) return [];
  const byOrder = new Map(snap.parsed.tracks.map((t) => [t.order, t]));
  const resultByOrder = new Map((snap.results ?? []).map((r) => [r.order, r]));
  const out: Target[] = [];
  for (const choice of snap.choices) {
    if (!choice.appleId) continue;
    const result = resultByOrder.get(choice.order);
    const storefront =
      result?.chosen?.storefront ??
      result?.candidates.find((c) => c.id === choice.appleId)?.storefront ??
      snap.storefront;
    out.push({
      order: choice.order,
      appleId: choice.appleId,
      storefront,
      title: byOrder.get(choice.order)?.title ?? `#${choice.order}`,
    });
  }
  return out;
});

const accountMismatch = computed(
  () => authorized.value && userStorefront.value !== '' && snapshot.value !== null && userStorefront.value !== snapshot.value.storefront,
);

const crossTargets = computed(() =>
  accountMismatch.value ? targets.value.filter((t) => t.storefront !== userStorefront.value) : [],
);

const includedTargets = computed(() => targets.value.filter((t) => included.value.get(t.order) !== false));

const skipCount = computed(() => {
  const snap = snapshot.value;
  if (!snap) return 0;
  const chosenOrders = new Set((snap.choices ?? []).filter((c) => c.appleId).map((c) => c.order));
  return (snap.results ?? []).filter((r) => !chosenOrders.has(r.order)).length;
});

function toggle(order: number, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  included.value.set(order, checked);
  included.value = new Map(included.value);
}

async function authorize(): Promise<void> {
  if (authorizing.value || devToken.value === '') return;
  authorizing.value = true;
  loadError.value = '';
  try {
    const mk = await loadMusicKit(devToken.value);
    await mk.authorize();
    const mut = mk.musicUserToken();
    userStorefront.value = await getMyStorefront(mut, devToken.value);
    authorized.value = true;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '授权失败,请重试';
  } finally {
    authorizing.value = false;
  }
}

async function doImport(): Promise<void> {
  const snap = snapshot.value;
  if (!snap || importing.value || !authorized.value) return;
  importing.value = true;
  loadError.value = '';
  try {
    const mk = await loadMusicKit(devToken.value);
    const mut = mk.musicUserToken();
    const ids = includedTargets.value.map((t) => t.appleId);
    importDone.value = await createPlaylistWithTracks(
      playlistName.value || (snap.parsed?.name ?? 'TuneBridge 歌单'),
      ids,
      mut,
      devToken.value,
    );
    await fetch(`/api/jobs/${jobId.value}/complete`, { method: 'POST' }).catch(() => {});
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '导入失败,请重试';
  } finally {
    importing.value = false;
  }
}

async function retryFailed(): Promise<void> {
  if (!importDone.value || importing.value) return;
  importing.value = true;
  try {
    const mk = await loadMusicKit(devToken.value);
    const mut = mk.musicUserToken();
    const stillFailed = await appendTracks(
      importDone.value.playlistId,
      importDone.value.failed,
      mut,
      devToken.value,
    );
    const retried = importDone.value.failed.filter((id) => !stillFailed.includes(id));
    importDone.value = {
      ...importDone.value,
      added: [...importDone.value.added, ...retried],
      failed: stillFailed,
    };
  } finally {
    importing.value = false;
  }
}

function exportJson(): void {
  if (!snapshot.value) return;
  const choices = new Map<number, string | null>(
    (snapshot.value.choices ?? []).map((c) => [c.order, c.appleId]),
  );
  downloadJson(buildExportJson(snapshot.value, choices), `tunebridge-${jobId.value}.json`);
}

onMounted(async () => {
  try {
    snapshot.value = await getJob(jobId.value);
    playlistName.value = snapshot.value?.parsed?.name ?? '';
    for (const t of targets.value) included.value.set(t.order, true);
    const res = await fetch('/api/config');
    if (res.ok) {
      devToken.value = ((await res.json()) as { developerToken: string }).developerToken;
    } else {
      loadError.value = '站点未配置 Apple Music 密钥,暂时无法授权';
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '加载失败';
  }
});
</script>

<template>
  <main class="import">
    <h2>导入到 Apple Music</h2>
    <p v-if="snapshot?.parsed">
      {{ snapshot.parsed.name }} · 将导入 {{ includedTargets.length }} 首 · 跳过 {{ skipCount }} 首
    </p>
    <p v-if="loadError" class="error">{{ loadError }}</p>

    <button class="authorize" :disabled="authorizing || devToken === '' || authorized" @click="authorize">
      {{ authorized ? '已授权' : authorizing ? '授权中…' : '连接 Apple Music(需要授权)' }}
    </button>
    <p v-if="authorized && accountMismatch" class="mismatch">
      账号地区为 {{ userStorefront }},与所选地区 {{ snapshot?.storefront }} 不同,请确认跨区候选
    </p>

    <section v-if="crossTargets.length > 0" class="cross-region">
      <h3>跨区候选确认</h3>
      <ul>
        <li v-for="t in crossTargets" :key="t.order">
          <label>
            <input
              type="checkbox"
              :checked="included.get(t.order) !== false"
              @change="toggle(t.order, $event)"
            />
            {{ t.title }}(候选地区 {{ t.storefront }})
          </label>
        </li>
      </ul>
    </section>

    <template v-if="authorized && !importDone">
      <label class="field">
        <span>歌单名称</span>
        <input v-model="playlistName" />
      </label>
      <button class="import" :disabled="importing" @click="doImport">
        {{ importing ? '导入中…' : '创建歌单并导入' }}
      </button>
    </template>

    <section v-if="importDone" class="result">
      <p>
        成功 {{ importDone.added.length }} 首 · 失败 {{ importDone.failed.length }} 首 · 未匹配 {{ skipCount }} 首
      </p>
      <p v-if="importDone.failed.length > 0" class="failed-list">
        失败曲目 ID:{{ importDone.failed.join(', ') }}
      </p>
      <div class="actions">
        <button v-if="importDone.failed.length > 0" :disabled="importing" @click="retryFailed">重试失败曲目</button>
        <button @click="exportJson">导出 JSON</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.import {
  max-width: 560px;
  margin: 2rem auto;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.error {
  color: #c0392b;
}
.mismatch {
  color: #b7791f;
}
.cross-region {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 0.8rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
input {
  font: inherit;
  padding: 0.5rem;
}
button {
  font: inherit;
  padding: 0.7rem 1.6rem;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.failed-list {
  color: #c0392b;
  font-size: 0.85rem;
  word-break: break-all;
}
.actions {
  display: flex;
  gap: 0.8rem;
}
</style>
