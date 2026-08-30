import { escapeHtml, safeHttpUrl } from '../shared/utils';
import type {
  CitationStatus,
  RetractionDetails,
  ValidationResult,
} from '../shared/types';

export interface CitationData {
  id: string;
  doi?: string;
  pmid?: string;
  title?: string;
  referenceText?: string;
  context: 'current-article' | 'reference';
  status: CitationStatus;
  isRetracted: boolean;
  details?: RetractionDetails;
  validation?: ValidationResult;
}

interface PageStatus {
  url: string;
  citations: CitationData[];
  hasMoreReferences?: boolean;
}

let currentTabId: number | null = null;
let currentWindowId: number | null = null;

/**
 * Initialize sidebar
 */
async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    currentTabId = tab.id;
    currentWindowId = tab.windowId;
    await loadPageStatus();
  }

  // Listen for updates
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.tabs.onActivated.addListener(handleTabActivated);
}

/**
 * Load page status from content script
 */
async function loadPageStatus() {
  if (!currentTabId) return;
  const tabId = currentTabId;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'GET_PAGE_STATUS',
    });

    if (response && tabId === currentTabId) {
      renderPageStatus(response);
    }
  } catch (error) {
    // Content script not loaded or page not relevant
    if (tabId === currentTabId) {
      showEmptyState('This page does not contain academic content.');
    }
  }
}

function handleTabActivated({ tabId, windowId }: chrome.tabs.OnActivatedInfo) {
  if (windowId !== currentWindowId) return;
  currentTabId = tabId;
  void loadPageStatus();
}

/**
 * Handle messages from content script
 */
function handleMessage(
  message: { type?: string; payload?: PageStatus },
  sender: chrome.runtime.MessageSender
) {
  if (
    message.type === 'UPDATE_PAGE_STATUS' &&
    sender.tab?.id === currentTabId &&
    message.payload
  ) {
    renderPageStatus(message.payload);
  }
}

/**
 * Render page status
 */
function renderPageStatus(status: PageStatus) {
  const content = document.getElementById('content');
  if (!content) return;

  const citations = status.citations || [];
  const currentArticle = citations.find((c) => c.context === 'current-article');
  const references = citations.filter((c) => c.context === 'reference');
  const hasMoreReferences = status.hasMoreReferences === true;

  // Update stats
  const retracted = citations.filter((c) => c.status === 'retracted');
  const fake = citations.filter((c) => c.status === 'fake-likely' || c.status === 'fake-probably');
  const verified = references.filter((c) => c.status === 'verified');

  document.getElementById('retracted-count')!.textContent = String(retracted.length);
  document.getElementById('fake-count')!.textContent = String(fake.length);
  document.getElementById('verified-count')!.textContent = String(verified.length);

  if (citations.length === 0 && !hasMoreReferences) {
    showEmptyState('No citations found on this page.');
    return;
  }

  let html = '';

  // Current article section
  if (currentArticle) {
    html += `
      <div class="section">
        <div class="section__title">
          Current Article
        </div>
        ${renderCitationCard(currentArticle)}
      </div>
    `;
  }

  if (references.length > 0 || hasMoreReferences) {
    const pending = references.filter((c) => c.status === 'checking').length;
    const notCheckable = references.filter((c) => c.status === 'not-checkable').length;
    const failed = references.filter((c) => c.status === 'failed' || c.status === 'skip').length;
    const checked = references.length - pending - notCheckable - failed;
    html += `
      <div class="section">
        <div class="section__title">Reference Coverage</div>
        <div class="citation-card" style="cursor: default; color: #374151;">
          ${checked}/${references.length}${hasMoreReferences ? ' scanned references checked' : ' checked'}
          ${notCheckable ? ` · ${notCheckable} without DOI/PMID` : ''}
          ${failed ? ` · ${failed} failed` : ''}
          ${pending ? ` · ${pending} pending` : ''}
          ${hasMoreReferences ? ' · additional references not scanned (500-reference safety limit)' : ''}
        </div>
      </div>
    `;
  }

  // Problematic references (retracted, fake, concern, correction)
  const problematic = references.filter(
    (c) => c.status === 'retracted' || c.status === 'fake-likely' || c.status === 'fake-probably' || c.status === 'concern' || c.status === 'correction'
  );

  if (problematic.length > 0) {
    html += `
      <div class="section">
        <div class="section__title">
          Issues Found
          <span class="section__count">${problematic.length}</span>
        </div>
        <div class="citation-list">
          ${problematic.map(renderCitationCard).join('')}
        </div>
      </div>
    `;
  }

  // Verified references
  if (verified.length > 0 && verified.length < 20) {
    html += `
      <div class="section">
        <div class="section__title">
          Verified References
          <span class="section__count">${verified.length}</span>
        </div>
        <div class="citation-list">
          ${verified.slice(0, 10).map(renderCitationCard).join('')}
          ${verified.length > 10 ? `<div class="citation-card" style="text-align: center; color: #6B7280;">And ${verified.length - 10} more...</div>` : ''}
        </div>
      </div>
    `;
  } else if (verified.length >= 20) {
    html += `
      <div class="section">
        <div class="section__title">
          Verified References
          <span class="section__count">${verified.length}</span>
        </div>
        <div class="citation-card" style="text-align: center; color: #16A34A;">
          ✓ ${verified.length} references verified
        </div>
      </div>
    `;
  }

  const other = references.filter((c) =>
    ['unverified', 'not-checkable', 'failed', 'skip', 'checking'].includes(c.status)
  );
  if (other.length > 0) {
    html += `
      <div class="section">
        <div class="section__title">
          Other References
          <span class="section__count">${other.length}</span>
        </div>
        <div class="citation-list">
          ${other.slice(0, 10).map(renderCitationCard).join('')}
          ${other.length > 10 ? `<div class="citation-card" style="text-align: center; color: #6B7280; cursor: default;">And ${other.length - 10} more...</div>` : ''}
        </div>
      </div>
    `;
  }

  content.innerHTML = html;

  // Add click handlers
  content.querySelectorAll('.citation-card[data-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      if (id && currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
          type: 'HIGHLIGHT_CITATION',
          payload: { id },
        });
      }
    });
  });
}

/**
 * Render a citation card
 */
export function renderCitationCard(citation: CitationData): string {
  const statusIcons: Record<string, string> = {
    retracted: '⚠️',
    concern: '⚠️',
    correction: '📝',
    'fake-likely': '❌',
    'fake-probably': '⚠️',
    verified: '✓',
    unverified: 'ℹ',
    checking: '⟳',
    'not-checkable': '—',
    failed: '!',
    skip: '!',
  };

  const statusClass = citation.status === 'retracted'
    ? 'citation-card--retracted'
    : citation.status === 'fake-likely'
      ? 'citation-card--fake'
      : ['fake-probably', 'concern', 'correction'].includes(citation.status)
        ? 'citation-card--suspicious'
        : '';

  let detailsHtml = '';

  if (citation.status === 'retracted' && citation.details) {
    // Retraction reasons are rarely available from the public APIs; show the
    // block only when there is something to say.
    if (citation.details.reason?.length) {
      const reasons = escapeHtml(citation.details.reason.slice(0, 2).join(', '));
      detailsHtml = `
        <div class="citation-card__reason">
          <strong>Retraction reason:</strong> ${reasons}
        </div>
      `;
    } else {
      const retractionNoticeUrl = safeHttpUrl(citation.details.retractionNoticeUrl);
      if (retractionNoticeUrl) {
        const noticeUrl = escapeHtml(retractionNoticeUrl);
        detailsHtml = `
          <div class="citation-card__reason">
            <a href="${noticeUrl}" target="_blank" rel="noopener">View retraction notice</a>
          </div>
        `;
      }
    }
  } else if ((citation.status === 'fake-likely' || citation.status === 'fake-probably') && citation.validation?.discrepancies) {
    const discrepancies = citation.validation.discrepancies
      .map((d) => `${escapeHtml(d.field)}: "${escapeHtml(d.provided)}" \u2192 "${escapeHtml(d.actual)}"`)
      .join('<br>');
    detailsHtml = `
      <div class="citation-card__discrepancy">
        <strong>Discrepancies:</strong><br>${discrepancies}
      </div>
    `;
  } else if (citation.status === 'unverified') {
    detailsHtml = `
      <div class="citation-card__reason">
        ${citation.validation?.discrepancies.some((discrepancy) => discrepancy.field === 'pmid')
          ? 'PubMed ID not found in OpenAlex; the reference could not be verified.'
          : 'Registered DOI, but not indexed in CrossRef/OpenAlex (e.g. dataset, software, thesis).'}
      </div>
    `;
  } else if (citation.status === 'not-checkable') {
    detailsHtml = '<div class="citation-card__reason">No DOI or PubMed ID was found.</div>';
  } else if (citation.status === 'failed' || citation.status === 'skip') {
    detailsHtml = '<div class="citation-card__reason">External lookup failed. Rescan to retry.</div>';
  }

  // Prefer the title as printed on the page, then the authoritative record
  // title from CrossRef/OpenAlex; many publishers' reference markup does not
  // expose a title that can be extracted reliably.
  const displayTitle =
    citation.title ||
    citation.referenceText ||
    citation.validation?.matchedData?.title ||
    citation.details?.title ||
    citation.doi ||
    'Untitled reference';
  const safeTitle = escapeHtml(displayTitle);
  const safeId = escapeHtml(citation.id);
  const identifier = citation.doi || (citation.pmid ? `PMID: ${citation.pmid}` : '');
  const safeIdentifier = escapeHtml(identifier);

  return `
    <div class="citation-card ${statusClass}" data-id="${safeId}">
      <div class="citation-card__header">
        <span class="citation-card__status">${statusIcons[citation.status] || '?'}</span>
        <span class="citation-card__title">${safeTitle}</span>
      </div>
      ${safeIdentifier ? `<div class="citation-card__doi">${safeIdentifier}</div>` : ''}
      ${detailsHtml}
    </div>
  `;
}

/**
 * Show empty state
 */
function showEmptyState(message: string) {
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">📄</div>
      <div class="empty-state__text">${escapeHtml(message)}</div>
    </div>
  `;
}

// Initialize
init();
