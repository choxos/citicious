interface CitationData {
  id: string;
  doi?: string;
  title?: string;
  context: 'current-article' | 'reference';
  status: string;
  isRetracted: boolean;
  details?: any;
  validation?: any;
}

interface PageStatus {
  url: string;
  citations: CitationData[];
}

let currentTabId: number | null = null;

/**
 * Initialize sidebar
 */
async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    currentTabId = tab.id;
    await loadPageStatus();
  }

  // Listen for updates
  chrome.runtime.onMessage.addListener(handleMessage);
}

/**
 * Load page status from content script
 */
async function loadPageStatus() {
  if (!currentTabId) return;

  try {
    const response = await chrome.tabs.sendMessage(currentTabId, {
      type: 'GET_PAGE_STATUS',
    });

    if (response) {
      renderPageStatus(response);
    }
  } catch (error) {
    // Content script not loaded or page not relevant
    showEmptyState('This page does not contain academic content.');
  }
}

/**
 * Handle messages from content script
 */
function handleMessage(message: any) {
  if (message.type === 'UPDATE_PAGE_STATUS') {
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

  // Update stats
  const retracted = citations.filter((c) => c.status === 'retracted');
  const fake = citations.filter((c) => c.status === 'fake-likely' || c.status === 'fake-probably');
  const verified = citations.filter((c) => c.status === 'verified');

  document.getElementById('retracted-count')!.textContent = String(retracted.length);
  document.getElementById('fake-count')!.textContent = String(fake.length);
  document.getElementById('verified-count')!.textContent = String(verified.length);

  if (citations.length === 0) {
    showEmptyState('No citations found on this page.');
    return;
  }

  // Separate current article and references
  const currentArticle = citations.find((c) => c.context === 'current-article');
  const references = citations.filter((c) => c.context === 'reference');

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
function renderCitationCard(citation: CitationData): string {
  const statusIcons: Record<string, string> = {
    retracted: '⚠️',
    concern: '⚠️',
    correction: '📝',
    'fake-likely': '❌',
    'fake-probably': '⚠️',
    verified: '✓',
    checking: '⟳',
    skip: '',
  };

  const statusClass = ['retracted', 'fake-likely', 'fake-probably', 'concern', 'correction'].includes(citation.status)
    ? `citation-card--${citation.status}`
    : '';

  let detailsHtml = '';

  if (citation.status === 'retracted' && citation.details) {
    const reasons = citation.details.reason?.slice(0, 2).join(', ') || 'Unknown';
    detailsHtml = `
      <div class="citation-card__reason">
        <strong>Retraction reason:</strong> ${reasons}
      </div>
    `;
  } else if ((citation.status === 'fake-likely' || citation.status === 'fake-probably') && citation.validation?.discrepancies) {
    const discrepancies = citation.validation.discrepancies
      .map((d: any) => `${d.field}: "${d.provided}" → "${d.actual}"`)
      .join('<br>');
    detailsHtml = `
      <div class="citation-card__discrepancy">
        <strong>Discrepancies:</strong><br>${discrepancies}
      </div>
    `;
  }

  return `
    <div class="citation-card ${statusClass}" data-id="${citation.id}">
      <div class="citation-card__header">
        <span class="citation-card__status">${statusIcons[citation.status] || '?'}</span>
        <span class="citation-card__title">${citation.title || 'Untitled'}</span>
      </div>
      ${citation.doi ? `<div class="citation-card__doi">${citation.doi}</div>` : ''}
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
      <div class="empty-state__text">${message}</div>
    </div>
  `;
}

// Initialize
init();
