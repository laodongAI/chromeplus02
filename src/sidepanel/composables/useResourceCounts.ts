import { inject, provide, reactive } from 'vue';

export type ResourceTabKey = 'video' | 'image' | 'audio' | 'text' | 'downloads' | 'sources' | 'settings';

export interface ResourceCountsContext {
  counts: Record<ResourceTabKey, number>;
  setCount: (key: ResourceTabKey, value: number) => void;
}

const ResourceCountsSymbol = Symbol('ResourceCounts');

export function provideResourceCounts() {
  const counts = reactive<Record<ResourceTabKey, number>>({
    video: 0,
    image: 0,
    audio: 0,
    text: 0,
    downloads: 0,
    sources: 0,
    settings: 0
  });

  const ctx: ResourceCountsContext = {
    counts,
    setCount: (key, value) => {
      counts[key] = value;
    }
  };

  provide(ResourceCountsSymbol, ctx);
  return ctx;
}

export function useResourceCounts(): ResourceCountsContext {
  const ctx = inject<ResourceCountsContext>(ResourceCountsSymbol);
  if (!ctx) {
    throw new Error('ResourceCounts context is not provided');
  }
  return ctx;
}
