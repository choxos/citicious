import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedCitation, FullCheckResult } from '../../shared/types';

const matchedTitle = 'A complete and accurate scholarly article title';

const baseResult: FullCheckResult = {
  status: 'verified',
  isRetracted: false,
  retractionDetails: null,
  validation: {
    exists: true,
    confidence: 1,
    source: 'crossref',
    matchedData: {
      doi: '10.1000/shared',
      title: matchedTitle,
      authors: [],
      year: 2024,
      journal: 'Journal',
    },
    discrepancies: [],
    status: 'verified',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('service worker batch lookup', () => {
  it('shares one identifier lookup while comparing each duplicate occurrence', async () => {
    const storageSet = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: storageSet,
          remove: vi.fn(async () => undefined),
        },
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    });

    const { citiciousAPI } = await import('../../shared/api-client');
    const checkBatch = vi.spyOn(citiciousAPI, 'checkBatch').mockImplementation(async (citations) =>
      new Map([[citations[0].id, baseResult]])
    );
    const { handleBatchCheck } = await import('../service-worker');
    const citations: ExtractedCitation[] = [
      {
        id: 'first',
        doi: '10.1000/shared',
        title: matchedTitle,
        element: {} as HTMLElement,
        context: 'reference',
      },
      {
        id: 'second',
        doi: 'HTTPS://DOI.ORG/10.1000/SHARED',
        title: 'This deliberately unrelated citation title is long enough to flag',
        element: {} as HTMLElement,
        context: 'reference',
      },
    ];

    const response = await handleBatchCheck(citations);

    expect(checkBatch).toHaveBeenCalledTimes(1);
    expect(checkBatch.mock.calls[0][0]).toHaveLength(1);
    expect(checkBatch.mock.calls[0][0][0].title).toBeUndefined();
    expect(response.results.map(({ result }) => result.status)).toEqual([
      'verified',
      'fake-probably',
    ]);
    expect(storageSet).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized batch messages before lookup', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    });

    const { citiciousAPI } = await import('../../shared/api-client');
    const checkBatch = vi.spyOn(citiciousAPI, 'checkBatch');
    const { handleMessage } = await import('../service-worker');
    const response = await handleMessage({
      type: 'CHECK_BATCH',
      payload: Array.from({ length: 502 }, (_, index) => ({
        id: String(index),
        doi: `10.1000/${index}`,
      })),
    });

    expect(response).toEqual({ error: 'Maximum 501 citations per batch' });
    expect(checkBatch).not.toHaveBeenCalled();
  });

  it('shares an in-flight identifier lookup across overlapping messages', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    });

    let resolveLookup: (results: Map<string, FullCheckResult>) => void = () => {};
    const lookup = new Promise<Map<string, FullCheckResult>>((resolve) => {
      resolveLookup = resolve;
    });
    const { citiciousAPI } = await import('../../shared/api-client');
    const checkBatch = vi.spyOn(citiciousAPI, 'checkBatch').mockReturnValue(lookup);
    const { handleBatchCheck } = await import('../service-worker');
    const first = handleBatchCheck([
      {
        id: 'first',
        doi: '10.1000/shared',
        element: {} as HTMLElement,
        context: 'reference',
      },
    ]);
    const second = handleBatchCheck([
      {
        id: 'second',
        doi: '10.1000/shared',
        element: {} as HTMLElement,
        context: 'reference',
      },
    ]);

    await vi.waitFor(() => expect(checkBatch).toHaveBeenCalledTimes(1));
    resolveLookup(new Map([['first', baseResult]]));
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.results[0].result.status)).toEqual([
      'verified',
      'verified',
    ]);
  });
});
