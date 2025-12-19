import { citiciousAPI } from '../shared/api-client';
import type { ExtractedCitation, FullCheckResult } from '../shared/types';

// Cache for check results
const resultsCache: Map<string, FullCheckResult> = new Map();

// Page status storage
const pageStatus: Map<number, { url: string; citations: any[] }> = new Map();

/**
 * Initialize service worker
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Citicious] Extension installed');

  // Set up side panel behavior
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

/**
 * Handle messages from content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error('[Citicious] Error handling message:', error);
      sendResponse({ error: error.message });
    });

  return true; // Keep channel open for async response
});

/**
 * Process incoming messages
 */
async function handleMessage(
  message: any,
  sender: chrome.runtime.MessageSender
): Promise<any> {
  switch (message.type) {
    case 'CHECK_BATCH':
      return handleBatchCheck(message.payload);

    case 'CHECK_CITATION':
      return handleSingleCheck(message.payload);

    case 'UPDATE_PAGE_STATUS':
      if (sender.tab?.id) {
        pageStatus.set(sender.tab.id, message.payload);
      }
      return { success: true };

    case 'GET_PAGE_STATUS':
      if (sender.tab?.id) {
        return pageStatus.get(sender.tab.id) || { citations: [] };
      }
      return { citations: [] };

    case 'OPEN_SIDEBAR':
      if (sender.tab?.id) {
        await chrome.sidePanel.open({ tabId: sender.tab.id });
      }
      return { success: true };

    default:
      console.warn('[Citicious] Unknown message type:', message.type);
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
    const cacheKey = getCacheKey(citation);
    const cached = resultsCache.get(cacheKey);

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
          // Cache the result
          const cacheKey = getCacheKey(citation);
          resultsCache.set(cacheKey, result);

          results.push({ id: citation.id, result });
        }
      }
    } catch (error) {
      console.error('[Citicious] Batch check error:', error);
      // Return unknown status for failed checks
      for (const citation of toCheck) {
        results.push({
          id: citation.id,
          result: {
            status: 'unknown',
            isRetracted: false,
            retractionDetails: null,
            validation: null,
          },
        });
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
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
}): Promise<FullCheckResult> {
  const cacheKey = citation.doi || citation.pmid || citation.title || '';
  const cached = resultsCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const result = await citiciousAPI.checkCitation(citation);

  // Cache the result
  if (cacheKey) {
    resultsCache.set(cacheKey, result);
  }

  return result;
}

/**
 * Generate cache key for a citation
 */
function getCacheKey(citation: ExtractedCitation): string {
  return citation.doi || citation.pmid || citation.title || citation.id;
}

/**
 * Clear cache (called periodically or on user request)
 */
function clearCache() {
  resultsCache.clear();
  console.log('[Citicious] Cache cleared');
}

// Clear cache every 24 hours
setInterval(clearCache, 24 * 60 * 60 * 1000);

/**
 * Handle tab updates (URL changes)
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Clear page status for this tab on navigation
    pageStatus.delete(tabId);
  }
});

/**
 * Handle tab removal
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  pageStatus.delete(tabId);
});
