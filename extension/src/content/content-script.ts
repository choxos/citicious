import {
  extractCurrentArticleDoi,
  findReferenceSection,
  extractReferenceDois,
  containsReferenceSectionMarker,
  MAX_REFERENCES_PER_PAGE,
} from './extractors/doi-extractor';
import {
  injectTopBanner,
  injectReferencesBanner,
  injectBadge,
  updateBadge,
  removeAllBadges,
} from './ui/badge-injector';
import type { ReferenceIssueCategory } from './ui/badge-injector';
import type {
  ExtractedCitation,
  CheckedCitation,
  FullCheckResult,
  CitationStatus,
} from '../shared/types';

// Maps summary-bar chip categories to citation statuses for chip navigation
const CATEGORY_STATUS: Record<ReferenceIssueCategory, CitationStatus> = {
  retracted: 'retracted',
  notFound: 'fake-likely',
  mismatch: 'fake-probably',
  concern: 'concern',
  correction: 'correction',
};

/**
 * Scroll to the first flagged reference of the given category and flash it.
 */
function jumpToFirstReference(category: ReferenceIssueCategory): void {
  const status = CATEGORY_STATUS[category];
  const candidates = Array.from(checkedCitations.values()).filter(
    (c) => c.context === 'reference' && c.result?.status === status && c.element.isConnected
  );
  if (candidates.length === 0) return;

  // Earliest element in document order
  const first = candidates.reduce((a, b) =>
    a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_PRECEDING ? b : a
  );

  first.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  first.element.classList.add('citicious-highlight');
  setTimeout(() => {
    first.element.classList.remove('citicious-highlight');
  }, 2000);
}

// Store checked citations
const checkedCitations: Map<string, CheckedCitation> = new Map();
let lastScannedUrl = window.location.href;
let processedReferenceCount = 0;
let hasMoreReferences = false;
const processedIdentifierKeys = new Set<string>();
let referenceSection: HTMLElement | null = null;

// Debounce timer for scanning
let scanDebounceTimer: number | null = null;

function getPageStatus() {
  return {
    url: window.location.href,
    hasMoreReferences,
    citations: Array.from(checkedCitations.values()).map((citation) => ({
      id: citation.id,
      doi: citation.doi,
      pmid: citation.pmid,
      title: citation.title,
      referenceText: citation.referenceText,
      context: citation.context,
      status: citation.result?.status || (citation.checking ? 'checking' : 'failed'),
      isRetracted: citation.result?.isRetracted || false,
      details: citation.result?.retractionDetails,
      validation: citation.result?.validation,
    })),
  };
}

function broadcastPageStatus(): void {
  chrome.runtime
    .sendMessage({ type: 'UPDATE_PAGE_STATUS', payload: getPageStatus() })
    .catch(() => {});
}

function syncPageBanner(): void {
  const currentArticleResult = Array.from(checkedCitations.values()).find(
    (citation) => citation.context === 'current-article'
  )?.result;

  if (currentArticleResult?.isRetracted) {
    injectTopBanner('retracted', currentArticleResult.retractionDetails || undefined);
    return;
  }
  if (currentArticleResult?.status === 'concern' || currentArticleResult?.status === 'correction') {
    injectTopBanner(
      currentArticleResult.status,
      currentArticleResult.retractionDetails || undefined
    );
    return;
  }
  if (
    currentArticleResult?.status === 'fake-likely' ||
    currentArticleResult?.status === 'fake-probably'
  ) {
    injectTopBanner(
      currentArticleResult.status,
      undefined,
      currentArticleResult.validation?.discrepancies
    );
    return;
  }

  const counts = { retracted: 0, notFound: 0, mismatch: 0, concern: 0, correction: 0 };
  for (const checked of checkedCitations.values()) {
    if (checked.context !== 'reference') continue;
    const status = checked.result?.status;
    if (status === 'retracted') counts.retracted++;
    else if (status === 'fake-likely') counts.notFound++;
    else if (status === 'fake-probably') counts.mismatch++;
    else if (status === 'concern') counts.concern++;
    else if (status === 'correction') counts.correction++;
  }
  injectReferencesBanner(counts, jumpToFirstReference);
}

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
export async function scanPage() {
  if (window.location.href !== lastScannedUrl) {
    removeAllBadges();
    checkedCitations.clear();
    processedReferenceCount = 0;
    hasMoreReferences = false;
    processedIdentifierKeys.clear();
    referenceSection = null;
    lastScannedUrl = window.location.href;
  }

  for (const [id, citation] of checkedCitations) {
    if (citation.context === 'reference' && !citation.element.isConnected) {
      checkedCitations.delete(id);
    }
  }

  // Extract citations from the page
  const extracted: ExtractedCitation[] = [];
  const currentArticle = extractCurrentArticleDoi(document);
  if (currentArticle?.doi) extracted.push(currentArticle);
  referenceSection = findReferenceSection(document);
  if (referenceSection) {
    extracted.push(...extractReferenceDois(referenceSection, MAX_REFERENCES_PER_PAGE + 1));
  }

  const seenElements = new Map<HTMLElement, CheckedCitation>();
  for (const citation of checkedCitations.values()) {
    seenElements.set(citation.element, citation);
  }

  const currentArticleCandidates: ExtractedCitation[] = [];
  const replacementReferenceCandidates: ExtractedCitation[] = [];
  const newReferenceCandidates: ExtractedCitation[] = [];
  for (const citation of extracted) {
    const previous = seenElements.get(citation.element);
    if (previous && previous.doi === citation.doi && previous.pmid === citation.pmid) continue;
    if (previous) {
      checkedCitations.delete(previous.id);
      previous.element.classList.remove(
        'citicious-reference--retracted',
        'citicious-reference--concern',
        'citicious-reference--correction',
        'citicious-reference--fake-likely',
        'citicious-reference--fake-probably'
      );
    }
    if (citation.context === 'current-article') {
      currentArticleCandidates.push(citation);
    } else if (previous) {
      replacementReferenceCandidates.push(citation);
    } else {
      newReferenceCandidates.push(citation);
    }
  }

  const availableReferenceSlots = Math.max(
    0,
    MAX_REFERENCES_PER_PAGE - processedReferenceCount
  );
  const newReferencesToCheck = newReferenceCandidates.slice(0, availableReferenceSlots);
  const referenceCandidates = [...replacementReferenceCandidates, ...newReferencesToCheck];
  processedReferenceCount += newReferencesToCheck.length;
  hasMoreReferences = newReferenceCandidates.length > newReferencesToCheck.length;
  const referencesToCheck = referenceCandidates.filter((citation) => {
    const identifierKey = citation.doi
      ? `doi:${citation.doi}`
      : citation.pmid
        ? `pmid:${citation.pmid}`
        : null;
    if (!identifierKey || processedIdentifierKeys.has(identifierKey)) return true;
    if (processedIdentifierKeys.size < MAX_REFERENCES_PER_PAGE) {
      processedIdentifierKeys.add(identifierKey);
      return true;
    }
    citation.element.querySelectorAll('.citicious-badge').forEach((badge) => badge.remove());
    hasMoreReferences = true;
    return false;
  });
  const citations = [...currentArticleCandidates, ...referencesToCheck];

  if (citations.length === 0) {
    syncPageBanner();
    broadcastPageStatus();
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

    if (!response?.results) throw new Error('Citation check failed');
    handleCheckResults(response.results);
  } catch (error) {
    for (const citation of citations) {
      const checked = checkedCitations.get(citation.id);
      if (checked) {
        checked.checking = false;
        checked.result = {
          status: 'failed',
          isRetracted: false,
          retractionDetails: null,
          validation: null,
        };
        updateBadge(citation.element, 'failed');
      }
    }
    syncPageBanner();
    broadcastPageStatus();
  }
}

/**
 * Handle check results from service worker
 */
function handleCheckResults(results: { id: string; result: FullCheckResult }[]) {
  for (const { id, result } of results) {
    const checked = checkedCitations.get(id);
    if (!checked) continue;

    checked.checking = false;
    checked.result = result;

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

  syncPageBanner();

  // Broadcast results so an open sidebar can live-update
  broadcastPageStatus();
}

/**
 * Observe page changes for dynamic content (SPA navigation, lazy loading)
 */
function observePageChanges() {
  const observer = new MutationObserver((mutations) => {
    // Check if new DOIs might have been added
    let shouldRescan = window.location.href !== lastScannedUrl;
    if (referenceSection && !referenceSection.isConnected) referenceSection = null;

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
            const identifierSelector =
              '[data-doi], a[href*="doi.org"], a[href*="pubmed.ncbi.nlm.nih.gov"]';
            if (
              /\b10\.\d{4,9}\//.test(element.textContent || '') ||
              /\bPMID:\s*\d+\b/i.test(element.textContent || '') ||
              element.matches?.(identifierSelector) ||
              element.querySelector?.(identifierSelector) ||
              (referenceSection &&
                (referenceSection.contains(element) || element.contains(referenceSection))) ||
              containsReferenceSectionMarker(element)
            ) {
              shouldRescan = true;
              break;
            }
          }
        }
      }
      if (
        mutation.type === 'childList' &&
        mutation.removedNodes.length > 0 &&
        Array.from(checkedCitations.values()).some(
          (citation) => citation.context === 'reference' && !citation.element.isConnected
        )
      ) {
        shouldRescan = true;
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

  const rescanAfterNavigation = () => {
    if (window.location.href === lastScannedUrl) return;
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = window.setTimeout(() => scanPage(), 100);
  };
  window.addEventListener('popstate', rescanAfterNavigation);
  window.addEventListener('hashchange', rescanAfterNavigation);
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
      sendResponse(getPageStatus());
      return true;

    case 'RESCAN_PAGE':
      removeAllBadges();
      checkedCitations.clear();
      processedReferenceCount = 0;
      hasMoreReferences = false;
      processedIdentifierKeys.clear();
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
