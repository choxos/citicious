import { citiciousAPI } from '../shared/api-client';
import type { ExtractedCitation, FullCheckResult } from '../shared/types';

// Persistent cache (chrome.storage.local). An in-memory Map is unreliable under
// Manifest V3 because the service worker is terminated when idle, which would
// wipe the cache (and any setInterval) within ~30s. Entries carry a timestamp
// and are treated as misses once older than CACHE_TTL_MS (TTL enforced on read).
const CACHE_PREFIX = 'citicious:cache:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  result: FullCheckResult;
  ts: number;
}

const SKIP_RESULT: FullCheckResult = {
  status: 'skip',
  isRetracted: false,
  retractionDetails: null,
  validation: null,
};

/**
 * Read a cached result, honoring the TTL. Expired entries are removed.
 */
async function getCached(key: string): Promise<FullCheckResult | null> {
  const storageKey = CACHE_PREFIX + key;
  const stored = await chrome.storage.local.get(storageKey);
  const entry = stored[storageKey] as CacheEntry | undefined;

  if (entry && typeof entry.ts === 'number' && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.result;
  }

  // Expired or malformed -> opportunistic cleanup
  if (entry) {
    await chrome.storage.local.remove(storageKey);
  }
  return null;
}

/**
 * Store a result. Transient "skip" results (API/network errors) are NOT cached
 * so they get retried on the next visit.
 */
async function setCached(key: string, result: FullCheckResult): Promise<void> {
  if (!key || result.status === 'skip') return;
  const entry: CacheEntry = { result, ts: Date.now() };
  await chrome.storage.local.set({ [CACHE_PREFIX + key]: entry });
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
 * Generate cache key for a citation. A page-extracted title influences the
 * classification (metadata mismatch), so titled lookups get their own entries;
 * a bad title extraction on one page must not poison the identifier's cached
 * result for every other page.
 */
function getCacheKey(citation: {
  doi?: string;
  pmid?: string;
  url?: string;
  title?: string;
  id?: string;
}): string {
  const base = citation.doi || citation.pmid || citation.url || citation.title || citation.id || '';
  const title = citation.title?.trim().toLowerCase();
  return title && base !== title ? `${base}|t:${title}` : base;
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
async function handleMessage(message: any): Promise<any> {
  switch (message.type) {
    case 'CHECK_BATCH':
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
async function handleBatchCheck(
  citations: ExtractedCitation[]
): Promise<{ results: { id: string; result: FullCheckResult }[] }> {
  const results: { id: string; result: FullCheckResult }[] = [];
  const toCheck: ExtractedCitation[] = [];

  // Check cache first
  for (const citation of citations) {
    const cached = await getCached(getCacheKey(citation));
    if (cached) {
      results.push({ id: citation.id, result: cached });
    } else {
      toCheck.push(citation);
    }
  }

  // Batch check remaining citations via API
  if (toCheck.length > 0) {
    try {
      const apiResults = await citiciousAPI.checkBatch(toCheck);

      for (const citation of toCheck) {
        const result = apiResults.get(citation.id);
        if (result) {
          await setCached(getCacheKey(citation), result);
          results.push({ id: citation.id, result });
        }
      }
    } catch {
      // Return skip status for failed checks (can't determine)
      for (const citation of toCheck) {
        results.push({ id: citation.id, result: SKIP_RESULT });
      }
    }
  }

  return { results };
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

  const cached = cacheKey ? await getCached(cacheKey) : null;
  if (cached) {
    return cached;
  }

  const result = await citiciousAPI.checkCitation(citation);
  await setCached(cacheKey, result);
  return result;
}
