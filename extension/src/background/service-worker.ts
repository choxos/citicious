import { applyCitationMetadata, citiciousAPI } from '../shared/api-client';
import type { ExtractedCitation, FullCheckResult } from '../shared/types';

// Persistent cache (chrome.storage.local). An in-memory Map is unreliable under
// Manifest V3 because the service worker is terminated when idle, which would
// wipe the cache (and any setInterval) within ~30s. Entries carry a timestamp
// and are treated as misses once older than CACHE_TTL_MS (TTL enforced on read).
const CACHE_PREFIX = 'citicious:cache:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_BATCH_CITATIONS = 501;
const inFlightByKey = new Map<string, Promise<FullCheckResult>>();

interface CacheEntry {
  result: FullCheckResult;
  ts: number;
}

const NOT_CHECKABLE_RESULT: FullCheckResult = {
  status: 'not-checkable',
  isRetracted: false,
  retractionDetails: null,
  validation: null,
};

const FAILED_RESULT: FullCheckResult = {
  status: 'failed',
  isRetracted: false,
  retractionDetails: null,
  validation: null,
};

/**
 * Read a cached result, honoring the TTL. Expired entries are removed.
 */
async function getCached(key: string): Promise<FullCheckResult | null> {
  return (await getCachedBatch([key])).get(key) || null;
}

async function setCached(key: string, result: FullCheckResult): Promise<void> {
  await setCachedBatch(new Map([[key, result]]));
}

async function getCachedBatch(keys: string[]): Promise<Map<string, FullCheckResult>> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return new Map();

  const storageKeys = uniqueKeys.map((key) => CACHE_PREFIX + key);
  const stored = await chrome.storage.local.get(storageKeys);
  const results = new Map<string, FullCheckResult>();
  const expired: string[] = [];
  const now = Date.now();

  for (const key of uniqueKeys) {
    const storageKey = CACHE_PREFIX + key;
    const entry = stored[storageKey] as CacheEntry | undefined;
    if (entry && typeof entry.ts === 'number' && now - entry.ts < CACHE_TTL_MS) {
      results.set(key, entry.result);
    } else if (entry) {
      expired.push(storageKey);
    }
  }

  if (expired.length > 0) await chrome.storage.local.remove(expired);
  return results;
}

async function setCachedBatch(entries: Map<string, FullCheckResult>): Promise<void> {
  const stored: Record<string, CacheEntry> = {};
  const now = Date.now();

  for (const [key, result] of entries) {
    if (!key || ['skip', 'failed', 'not-checkable'].includes(result.status)) continue;
    stored[CACHE_PREFIX + key] = { result, ts: now };
  }

  if (Object.keys(stored).length > 0) await chrome.storage.local.set(stored);
}

/**
 * Remove all expired cache entries. Run on startup/install to bound growth,
 * since read-time TTL only cleans entries that happen to be read again.
 */
async function sweepExpiredCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const toRemove: string[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    const entry = value as CacheEntry | undefined;
    if (!entry || typeof entry.ts !== 'number' || now - entry.ts >= CACHE_TTL_MS) {
      toRemove.push(key);
    }
  }

  if (toRemove.length > 0) {
    await chrome.storage.local.remove(toRemove);
  }
}

/**
 * Generate a cache key for the authoritative identifier lookup. Page metadata
 * is compared after lookup so duplicate occurrences share one request.
 */
function getCacheKey(citation: {
  doi?: string;
  pmid?: string;
}): string {
  if (citation.doi) {
    return `doi:${citation.doi.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}`;
  }
  return citation.pmid ? `pmid:${citation.pmid.trim().replace(/^pmid:\s*/i, '')}` : '';
}

function identifierOnly(citation: ExtractedCitation): ExtractedCitation {
  return {
    ...citation,
    title: undefined,
    authors: undefined,
    year: undefined,
    journal: undefined,
  };
}

function storeInFlight(
  key: string,
  lookup: Promise<FullCheckResult>
): Promise<FullCheckResult> {
  const request = lookup.catch(() => FAILED_RESULT);
  inFlightByKey.set(key, request);
  return request;
}

/**
 * Initialize service worker
 */
chrome.runtime.onInstalled.addListener(() => {
  // Set up side panel behavior
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  sweepExpiredCache().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  sweepExpiredCache().catch(() => {});
});

/**
 * Handle messages from content scripts
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ error: error.message });
    });

  return true; // Keep channel open for async response
});

/**
 * Process incoming messages
 */
export async function handleMessage(message: any): Promise<any> {
  switch (message.type) {
    case 'CHECK_BATCH':
      if (!Array.isArray(message.payload) || message.payload.length > MAX_BATCH_CITATIONS) {
        return { error: `Maximum ${MAX_BATCH_CITATIONS} citations per batch` };
      }
      return handleBatchCheck(message.payload);

    case 'CHECK_CITATION':
      return handleSingleCheck(message.payload);

    case 'UPDATE_PAGE_STATUS':
      // Broadcast consumed by the sidebar when it is open. Acking here
      // guarantees the content script's sendMessage never rejects when the
      // sidebar is closed.
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

/**
 * Handle batch check request
 */
export async function handleBatchCheck(
  citations: ExtractedCitation[]
): Promise<{ results: { id: string; result: FullCheckResult }[] }> {
  const resultById = new Map<string, FullCheckResult>();
  const checkable = citations.filter((citation) => {
    if (citation.doi || citation.pmid) return true;
    resultById.set(citation.id, NOT_CHECKABLE_RESULT);
    return false;
  });
  const cached = await getCachedBatch(checkable.map(getCacheKey)).catch(() => new Map());
  const pendingByKey = new Map<string, ExtractedCitation[]>();

  for (const citation of checkable) {
    const key = getCacheKey(citation);
    const cachedResult = cached.get(key);
    if (cachedResult) {
      resultById.set(citation.id, applyCitationMetadata(cachedResult, citation));
    } else {
      const pending = pendingByKey.get(key) || [];
      pending.push(citation);
      pendingByKey.set(key, pending);
    }
  }

  const waitingByKey = new Map<string, Promise<FullCheckResult>>();
  const fresh: ExtractedCitation[] = [];
  for (const [key, [citation]] of pendingByKey) {
    const active = inFlightByKey.get(key);
    if (active) waitingByKey.set(key, active);
    else fresh.push(citation);
  }

  if (fresh.length > 0) {
    const batch = citiciousAPI.checkBatch(fresh.map(identifierOnly)).catch(() => new Map());
    for (const citation of fresh) {
      const key = getCacheKey(citation);
      waitingByKey.set(
        key,
        storeInFlight(
          key,
          batch.then((results) => results.get(citation.id) || FAILED_RESULT)
        )
      );
    }
  }

  const toCache = new Map<string, FullCheckResult>();
  for (const [key, lookup] of waitingByKey) {
    const result = await lookup;
    toCache.set(key, result);
    for (const occurrence of pendingByKey.get(key) || []) {
      resultById.set(occurrence.id, applyCitationMetadata(result, occurrence));
    }
  }
  await setCachedBatch(toCache).catch(() => {});
  for (const citation of fresh) {
    const key = getCacheKey(citation);
    if (inFlightByKey.get(key) === waitingByKey.get(key)) inFlightByKey.delete(key);
  }

  return {
    results: citations.map((citation) => ({
      id: citation.id,
      result: resultById.get(citation.id) || FAILED_RESULT,
    })),
  };
}

/**
 * Handle single citation check
 */
async function handleSingleCheck(citation: {
  doi?: string;
  pmid?: string;
  url?: string;
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
}): Promise<FullCheckResult> {
  const cacheKey = getCacheKey(citation);

  const cached = cacheKey ? await getCached(cacheKey).catch(() => null) : null;
  if (cached) {
    return applyCitationMetadata(cached, citation);
  }

  const active = cacheKey ? inFlightByKey.get(cacheKey) : null;
  const request =
    active ||
    (cacheKey
      ? storeInFlight(
          cacheKey,
          citiciousAPI.checkCitation({
            doi: citation.doi,
            pmid: citation.pmid,
            url: citation.url,
          })
        )
      : citiciousAPI.checkCitation({
          doi: citation.doi,
          pmid: citation.pmid,
          url: citation.url,
        }));
  const result = await request;
  await setCached(cacheKey, result).catch(() => {});
  if (!active && cacheKey && inFlightByKey.get(cacheKey) === request) {
    inFlightByKey.delete(cacheKey);
  }
  return applyCitationMetadata(result, citation);
}
