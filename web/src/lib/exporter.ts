import type { ExportJson, JobSnapshot } from '@tunebridge/shared';

export function buildExportJson(snapshot: JobSnapshot, choices: Map<number, string | null>): ExportJson {
  const results = new Map((snapshot.results ?? []).map((r) => [r.order, r]));
  const tracks = (snapshot.parsed?.tracks ?? []).map((source) => {
    const result = results.get(source.order);
    const appleId = result?.chosen?.id ?? choices.get(source.order) ?? undefined;
    const storefront = result?.chosen?.storefront ?? undefined;
    return {
      order: source.order,
      source,
      match: {
        tier: result?.tier ?? ('none' as const),
        reason: result?.reason ?? null,
        ...(appleId ? { appleId, storefront: storefront ?? '' } : {}),
      },
    };
  });
  return {
    source: snapshot.parsed?.platform ?? ('netease' as const),
    playlist: {
      id: snapshot.parsed?.playlistId ?? '',
      name: snapshot.parsed?.name ?? '',
      creator: snapshot.parsed?.creator ?? '',
      coverUrl: snapshot.parsed?.coverUrl ?? '',
    },
    tracks,
  };
}

export function downloadJson(data: ExportJson, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
