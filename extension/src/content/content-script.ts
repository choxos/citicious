import {
  scanPageForDois,
  extractCurrentArticleDoi,
  findReferenceSection,
  extractReferenceDois,
} from './extractors/doi-extractor';
import {
  injectTopBanner,
  injectReferencesBanner,
  injectBadge,
  updateBadge,
  removeAllBadges,
} from './ui/badge-injector';
import type {
  ExtractedCitation,
  CheckedCitation,
  FullCheckResult,
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

  // Check if on a known academic domain (exact host or subdomain, so that
  // e.g. "nature.com.example.test" does not match)
  if (academicDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return true;
  }

  // Check for DOI in URL (must match DOI pattern, not just "10.")
  if (/\/10\.\d{4,9}\//.test(window.location.href)) {
    return true;
  }

  // Check for scholarly citation meta tags. Generic Dublin Core or
  // og:type=article tags are NOT enough: most news/blog pages carry those.
  if (document.querySelector('meta[name^="citation_"]')) {
    return true;
  }
  const dcIdentifier = document.querySelector(
    'meta[name="dc.identifier" i]'
  ) as HTMLMetaElement | null;
  if (dcIdentifier?.content && /\b10\.\d{4,9}\//.test(dcIdentifier.content)) {
    return true;
  }

  return false;
}

/**
 * Scan the page for DOIs and check them
 */
async function scanPage() {
  // Extract citations from the page
  const extracted = scanPageForDois(document);

  // Skip citations we've already processed so MutationObserver rescans don't
  // re-inject "Checking…" badges or double-count references. scanPageForDois
  // generates fresh ids each run, so dedupe by DOI/PMID and by element.
  const seenKeys = new Set<string>();
  const seenElements = new Set<HTMLElement>();
  for (const c of checkedCitations.values()) {
    if (c.doi) seenKeys.add(`doi:${c.doi}`);
    if (c.pmid) seenKeys.add(`pmid:${c.pmid}`);
    seenElements.add(c.element);
  }

  const citations = extracted.filter((c) => {
    const key = c.doi ? `doi:${c.doi}` : c.pmid ? `pmid:${c.pmid}` : null;
    if (key && seenKeys.has(key)) return false;
    if (seenElements.has(c.element)) return false;
    return true;
  });

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
        url: c.url,
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
    // Mark all as skip (can't determine)
    for (const citation of citations) {
      const checked = checkedCitations.get(citation.id);
      if (checked) {
        checked.checking = false;
        checked.result = {
          status: 'skip',
          isRetracted: false,
          retractionDetails: null,
          validation: null,
        };
        updateBadge(citation.element, 'skip');
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
      } else if (result.status === 'concern') {
        checked.element.classList.add('citicious-reference--concern');
      } else if (result.status === 'correction') {
        checked.element.classList.add('citicious-reference--correction');
      } else if (result.status === 'fake-likely') {
        checked.element.classList.add('citicious-reference--fake-likely');
      } else if (result.status === 'fake-probably') {
        checked.element.classList.add('citicious-reference--fake-probably');
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
    } else if (currentArticleResult.status === 'concern') {
      injectTopBanner(
        'concern',
        currentArticleResult.retractionDetails || undefined
      );
    } else if (currentArticleResult.status === 'correction') {
      injectTopBanner(
        'correction',
        currentArticleResult.retractionDetails || undefined
      );
    } else if (currentArticleResult.status === 'fake-likely') {
      injectTopBanner(
        'fake-likely',
        undefined,
        currentArticleResult.validation?.discrepancies
      );
    } else if (currentArticleResult.status === 'fake-probably') {
      injectTopBanner(
        'fake-probably',
        undefined,
        currentArticleResult.validation?.discrepancies
      );
    }
  }

  // If no current article banner, show references banner if there are issues
  if (!currentArticleResult || currentArticleResult.status === 'verified' || currentArticleResult.status === 'skip') {
    // Count problematic references per status so the banner can convey
    // severity accurately
    const counts = { retracted: 0, notFound: 0, mismatch: 0, concern: 0, correction: 0 };

    for (const [, checked] of checkedCitations) {
      if (checked.context !== 'reference') continue;
      const status = checked.result?.status;
      if (status === 'retracted') counts.retracted++;
      else if (status === 'fake-likely') counts.notFound++;
      else if (status === 'fake-probably') counts.mismatch++;
      else if (status === 'concern') counts.concern++;
      else if (status === 'correction') counts.correction++;
    }

    injectReferencesBanner(counts);
  }

  // Broadcast results so an open sidebar can live-update
  chrome.runtime
    .sendMessage({
      type: 'UPDATE_PAGE_STATUS',
      payload: {
        url: window.location.href,
        citations: Array.from(checkedCitations.values()).map((c) => ({
          id: c.id,
          doi: c.doi,
          title: c.title,
          context: c.context,
          status: c.result?.status || 'skip',
          isRetracted: c.result?.isRetracted || false,
          details: c.result?.retractionDetails,
          validation: c.result?.validation,
        })),
      },
    })
    .catch(() => {});
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
            // Ignore the extension's own injected badges/banners to avoid a
            // self-triggered rescan loop.
            if (element.closest?.('.citicious-badge, .citicious-banner')) {
              continue;
            }
            // Check if added element or its children contain DOI patterns.
            // Test textContent against a real DOI prefix pattern; a bare
            // "10." would fire on prices, versions, and timestamps.
            if (
              /\b10\.\d{4,9}\//.test(element.textContent || '') ||
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
      // Respond once the scan (including API checks) has finished, so the
      // popup can refresh its summary with complete results.
      scanPage()
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
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
