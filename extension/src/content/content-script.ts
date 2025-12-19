import {
  scanPageForDois,
  extractCurrentArticleDoi,
  findReferenceSection,
  extractReferenceDois,
} from './extractors/doi-extractor';
import {
  injectTopBanner,
  injectBadge,
  updateBadge,
  removeAllBadges,
} from './ui/badge-injector';
import type {
  ExtractedCitation,
  CheckedCitation,
  FullCheckResult,
  PageScanResult,
} from '../shared/types';

// Store checked citations
const checkedCitations: Map<string, CheckedCitation> = new Map();

// Debounce timer for scanning
let scanDebounceTimer: number | null = null;

/**
 * Initialize the content script
 */
async function init() {
  // Skip non-relevant pages
  if (!isRelevantPage()) {
    return;
  }

  console.log('[Citicious] Initializing on:', window.location.href);

  // Wait for page to be fully loaded
  if (document.readyState !== 'complete') {
    await new Promise<void>((resolve) => {
      window.addEventListener('load', () => resolve(), { once: true });
    });
  }

  // Scan the page for DOIs
  scanPage();

  // Set up mutation observer for dynamic content
  observePageChanges();

  // Listen for messages from service worker
  chrome.runtime.onMessage.addListener(handleMessage);
}

/**
 * Check if this page is worth scanning (academic/scientific content)
 */
function isRelevantPage(): boolean {
  const hostname = window.location.hostname;

  // List of known academic domains
  const academicDomains = [
    'pubmed.ncbi.nlm.nih.gov',
    'scholar.google.com',
    'sciencedirect.com',
    'nature.com',
    'springer.com',
    'wiley.com',
    'doi.org',
    'arxiv.org',
    'biorxiv.org',
    'medrxiv.org',
    'plos.org',
    'frontiersin.org',
    'mdpi.com',
    'tandfonline.com',
    'sagepub.com',
    'oup.com',
    'cell.com',
    'science.org',
    'pnas.org',
    'acs.org',
    'rsc.org',
    'ieee.org',
    'jstor.org',
    'researchgate.net',
    'semanticscholar.org',
  ];

  // Check if on a known academic domain
  if (academicDomains.some((domain) => hostname.includes(domain))) {
    return true;
  }

  // Check for DOI in URL
  if (window.location.href.includes('10.')) {
    return true;
  }

  // Check for academic meta tags
  const hasCitationMeta = document.querySelector(
    'meta[name^="citation_"], meta[name^="dc."], meta[property="og:type"][content*="article"]'
  );
  if (hasCitationMeta) {
    return true;
  }

  return false;
}

/**
 * Scan the page for DOIs and check them
 */
async function scanPage() {
  console.log('[Citicious] Scanning page...');

  // Extract citations from the page
  const citations = scanPageForDois(document);
  console.log(`[Citicious] Found ${citations.length} citations`);

  if (citations.length === 0) {
    return;
  }

  // Store citations and show "checking" state
  for (const citation of citations) {
    const checked: CheckedCitation = {
      ...citation,
      checking: true,
    };
    checkedCitations.set(citation.id, checked);

    // Inject "checking" badge for references
    if (citation.context === 'reference') {
      injectBadge(citation.element, 'checking');
    }
  }

  // Send to service worker for batch checking
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_BATCH',
      payload: citations.map((c) => ({
        id: c.id,
        doi: c.doi,
        pmid: c.pmid,
        title: c.title,
        authors: c.authors,
        year: c.year,
        journal: c.journal,
        context: c.context,
      })),
    });

    if (response?.results) {
      handleCheckResults(response.results);
    }
  } catch (error) {
    console.error('[Citicious] Error checking citations:', error);
    // Mark all as unknown
    for (const citation of citations) {
      const checked = checkedCitations.get(citation.id);
      if (checked) {
        checked.checking = false;
        checked.result = {
          status: 'unknown',
          isRetracted: false,
          retractionDetails: null,
          validation: null,
        };
        updateBadge(citation.element, 'unknown');
      }
    }
  }
}

/**
 * Handle check results from service worker
 */
function handleCheckResults(results: { id: string; result: FullCheckResult }[]) {
  let hasRetractedCurrentArticle = false;
  let currentArticleResult: FullCheckResult | null = null;

  for (const { id, result } of results) {
    const checked = checkedCitations.get(id);
    if (!checked) continue;

    checked.checking = false;
    checked.result = result;

    // Handle current article
    if (checked.context === 'current-article') {
      currentArticleResult = result;
      if (result.isRetracted) {
        hasRetractedCurrentArticle = true;
      }
    }

    // Update badge for references
    if (checked.context === 'reference') {
      updateBadge(
        checked.element,
        result.status,
        result.retractionDetails || undefined,
        result.validation?.discrepancies
      );

      // Add highlight to reference element
      if (result.status === 'retracted') {
        checked.element.classList.add('citicious-reference--retracted');
      } else if (result.status === 'fake') {
        checked.element.classList.add('citicious-reference--fake');
      } else if (result.status === 'suspicious') {
        checked.element.classList.add('citicious-reference--suspicious');
      }
    }
  }

  // Show top banner if current article is problematic
  if (currentArticleResult) {
    if (hasRetractedCurrentArticle) {
      injectTopBanner(
        'retracted',
        currentArticleResult.retractionDetails || undefined
      );
    } else if (currentArticleResult.status === 'fake') {
      injectTopBanner(
        'fake',
        undefined,
        currentArticleResult.validation?.discrepancies
      );
    } else if (currentArticleResult.status === 'suspicious') {
      injectTopBanner(
        'suspicious',
        undefined,
        currentArticleResult.validation?.discrepancies
      );
    }
  }

  // Notify service worker of results for sidebar
  chrome.runtime.sendMessage({
    type: 'UPDATE_PAGE_STATUS',
    payload: {
      url: window.location.href,
      citations: Array.from(checkedCitations.values()).map((c) => ({
        id: c.id,
        doi: c.doi,
        title: c.title,
        context: c.context,
        status: c.result?.status || 'unknown',
        isRetracted: c.result?.isRetracted || false,
      })),
    },
  });
}

/**
 * Observe page changes for dynamic content (SPA navigation, lazy loading)
 */
function observePageChanges() {
  const observer = new MutationObserver((mutations) => {
    // Check if new DOIs might have been added
    let shouldRescan = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            // Check if added element or its children contain DOI patterns
            if (
              element.innerHTML?.includes('10.') ||
              element.querySelector?.('[data-doi], a[href*="doi.org"]')
            ) {
              shouldRescan = true;
              break;
            }
          }
        }
      }
      if (shouldRescan) break;
    }

    if (shouldRescan) {
      // Debounce rescanning
      if (scanDebounceTimer) {
        clearTimeout(scanDebounceTimer);
      }
      scanDebounceTimer = window.setTimeout(() => {
        console.log('[Citicious] Re-scanning due to page changes...');
        scanPage();
      }, 1000);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

/**
 * Handle messages from service worker
 */
function handleMessage(
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
) {
  switch (message.type) {
    case 'GET_PAGE_STATUS':
      sendResponse({
        url: window.location.href,
        citations: Array.from(checkedCitations.values()).map((c) => ({
          id: c.id,
          doi: c.doi,
          title: c.title,
          context: c.context,
          status: c.result?.status || 'checking',
          isRetracted: c.result?.isRetracted || false,
          details: c.result?.retractionDetails,
          validation: c.result?.validation,
        })),
      });
      return true;

    case 'RESCAN_PAGE':
      removeAllBadges();
      checkedCitations.clear();
      scanPage();
      sendResponse({ success: true });
      return true;

    case 'HIGHLIGHT_CITATION':
      const citation = checkedCitations.get(message.payload.id);
      if (citation) {
        citation.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        citation.element.classList.add('citicious-highlight');
        setTimeout(() => {
          citation.element.classList.remove('citicious-highlight');
        }, 2000);
      }
      sendResponse({ success: true });
      return true;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
