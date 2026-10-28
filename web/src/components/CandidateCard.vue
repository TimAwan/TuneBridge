<script setup lang="ts">
import type { AppleSong } from '@tunebridge/shared';
import { computed } from 'vue';

const props = defineProps<{
  candidate: AppleSong;
  sourceDurationMs: number;
  selected?: boolean;
}>();

defineEmits<{ select: [] }>();

const durationDelta = computed(() => {
  if (props.sourceDurationMs <= 0 || props.candidate.durationMs <= 0) return '';
  const delta = (props.candidate.durationMs - props.sourceDurationMs) / 1000;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}s`;
});
</script>

<template>
  <div class="candidate" :class="{ selected }" @click="$emit('select')">
    <img :src="candidate.artworkUrl" alt="" loading="lazy" />
    <div class="info">
      <p class="title">
        {{ candidate.title }}
        <span v-if="candidate.versionHints.length > 0" class="badge warn">非原版</span>
      </p>
      <p class="meta">{{ candidate.artists.join(' / ') }} · {{ candidate.album }}</p>
      <p class="meta">
        <span class="badge">{{ candidate.storefront }}</span>
        <span v-if="durationDelta" class="delta">{{ durationDelta }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.candidate {
  display: flex;
  gap: 0.7rem;
  padding: 0.6rem;
  border: 2px solid #e5e5e5;
  border-radius: 8px;
  cursor: pointer;
}
.candidate.selected {
  border-color: #fa2d48;
  background: #fff5f6;
}
img {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  object-fit: cover;
}
.info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.title {
  font-weight: 600;
}
.meta {
  color: #666;
  font-size: 0.85rem;
}
.badge {
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 0 0.3rem;
  font-size: 0.75rem;
  margin-right: 0.4rem;
}
.badge.warn {
  color: #b7791f;
  border-color: #b7791f;
}
.delta {
  margin-right: 0.4rem;
}
</style>
