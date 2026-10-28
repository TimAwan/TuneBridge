<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createJob } from '../api';

const STOREFRONTS: Array<{ code: string; label: string }> = [
  { code: 'CN', label: '中国大陆' },
  { code: 'TW', label: '台湾' },
  { code: 'HK', label: '香港' },
  { code: 'JP', label: '日本' },
  { code: 'KR', label: '韩国' },
  { code: 'US', label: '美国' },
  { code: 'GB', label: '英国' },
  { code: 'SG', label: '新加坡' },
  { code: 'AU', label: '澳大利亚' },
  { code: 'CA', label: '加拿大' },
  { code: 'DE', label: '德国' },
  { code: 'FR', label: '法国' },
];

const SUPPORTED_HOSTS = [
  /(^|\.)music\.163\.com$/i,
  /(^|\.)163cn\.tv$/i,
  /(^|\.)y\.qq\.com$/i,
  /(^|\.)kuwo\.cn$/i,
  /(^|\.)kugou\.com$/i,
];

const router = useRouter();
const url = ref('');
const storefront = ref('CN');
const submitting = ref(false);
const serverError = ref('');

const urlValid = computed(() => {
  const value = url.value.trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return SUPPORTED_HOSTS.some((re) => re.test(parsed.hostname));
  } catch {
    return false;
  }
});

async function submit(): Promise<void> {
  if (!urlValid.value || submitting.value) return;
  submitting.value = true;
  serverError.value = '';
  try {
    const jobId = await createJob(url.value.trim(), storefront.value);
    await router.push(`/job/${jobId}`);
  } catch (err) {
    serverError.value = err instanceof Error ? err.message : '提交失败,请稍后重试';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="home">
    <h1>TuneBridge</h1>
    <p class="lead">把网易云、QQ音乐、酷我、酷狗的公开歌单迁移到 Apple Music</p>

    <label class="field">
      <span>歌单链接</span>
      <textarea
        v-model="url"
        rows="2"
        placeholder="https://music.163.com/#/playlist?id=..."
      />
      <small v-if="url.trim() && !urlValid" class="hint-bad">
        请粘贴四平台(网易云 / QQ音乐 / 酷我 / 酷狗)的公开歌单链接
      </small>
    </label>

    <label class="field">
      <span>Apple Music 地区</span>
      <select v-model="storefront">
        <option v-for="s in STOREFRONTS" :key="s.code" :value="s.code">{{ s.label }}({{ s.code }})</option>
      </select>
    </label>

    <p v-if="serverError" class="error">{{ serverError }}</p>

    <button :disabled="!urlValid || submitting" @click="submit">
      {{ submitting ? '提交中…' : '开始迁移' }}
    </button>
  </main>
</template>

<style scoped>
.home {
  max-width: 560px;
  margin: 4rem auto;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
textarea,
select {
  font: inherit;
  padding: 0.6rem;
}
.hint-bad {
  color: #c0392b;
}
.error {
  color: #c0392b;
}
button {
  font: inherit;
  padding: 0.7rem 2rem;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
