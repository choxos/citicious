import { citiciousAPI } from '../shared/api-client';

/**
 * Initialize popup
 */
async function init() {
  // Load page status
  await loadPageStatus();

  // Set up manual check
  const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
  const doiInput = document.getElementById('doi-input') as HTMLInputElement;

  checkBtn.addEventListener('click', () => handleManualCheck(doiInput.value));
  doiInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleManualCheck(doiInput.value);
    }
  });
}

/**
 * Load page status from current tab
 */
async function loadPageStatus() {
  const statusEl = document.getElementById('page-status')!;
  const statsEl = document.getElementById('stats')!;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      statusEl.innerHTML = `
        <div class="status-box">
          <div class="status-icon">📄</div>
          <div class="status-text">No active tab</div>
        </div>
      `;
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_PAGE_STATUS',
    });

    if (response && response.citations) {
      const citations = response.citations;

      const retracted = citations.filter((c: any) => c.status === 'retracted' || c.status === 'concern' || c.status === 'correction');
      const fake = citations.filter((c: any) => c.status === 'fake-likely' || c.status === 'fake-probably');
      const verified = citations.filter((c: any) => c.status === 'verified');

      // Update stats
      document.getElementById('retracted-count')!.textContent = String(retracted.length);
      document.getElementById('fake-count')!.textContent = String(fake.length);
      document.getElementById('verified-count')!.textContent = String(verified.length);
      statsEl.style.display = 'flex';

      // Show status
      if (retracted.length > 0 || fake.length > 0) {
        const currentArticleRetracted = citations.some(
          (c: any) => c.context === 'current-article' && c.status === 'retracted'
        );

        if (currentArticleRetracted) {
          statusEl.innerHTML = `
            <div class="status-box status-box--retracted">
              <div class="status-icon">⚠️</div>
              <div class="status-text">This article is RETRACTED</div>
            </div>
          `;
        } else {
          statusEl.innerHTML = `
            <div class="status-box status-box--retracted">
              <div class="status-icon">⚠️</div>
              <div class="status-text">${retracted.length + fake.length} problematic citations found</div>
            </div>
          `;
        }
      } else if (verified.length > 0) {
        statusEl.innerHTML = `
          <div class="status-box status-box--clean">
            <div class="status-icon">✓</div>
            <div class="status-text">All ${verified.length} citations verified</div>
          </div>
        `;
      } else {
        statusEl.innerHTML = `
          <div class="status-box">
            <div class="status-icon">📄</div>
            <div class="status-text">Scanning page...</div>
          </div>
        `;
      }
    } else {
      statusEl.innerHTML = `
        <div class="status-box">
          <div class="status-icon">📄</div>
          <div class="status-text">No citations found on this page</div>
        </div>
      `;
    }
  } catch (error) {
    statusEl.innerHTML = `
      <div class="status-box">
        <div class="status-icon">📄</div>
        <div class="status-text">This page does not contain academic content</div>
      </div>
    `;
  }
}

/**
 * Handle manual DOI check
 */
async function handleManualCheck(doi: string) {
  const resultEl = document.getElementById('manual-result')!;
  const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;

  if (!doi.trim()) {
    resultEl.innerHTML = '';
    return;
  }

  // Show loading state
  checkBtn.disabled = true;
  resultEl.innerHTML = '<div class="manual-check__result manual-check__result--unknown">Checking...</div>';

  try {
    const result = await citiciousAPI.checkCitation({ doi: doi.trim() });

    if (result.isRetracted) {
      const reasons = result.retractionDetails?.reason?.slice(0, 2).join(', ') || 'Unknown';
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--retracted">
          <strong>⚠️ RETRACTED</strong><br>
          Reason: ${reasons}
        </div>
      `;
    } else if (result.status === 'fake-likely') {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--retracted">
          <strong>❌ FAKE (likely)</strong><br>
          DOI could not be found in academic databases.
        </div>
      `;
    } else if (result.status === 'fake-probably') {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--unknown">
          <strong>⚠️ FAKE (probably)</strong><br>
          Significant metadata discrepancies found.
        </div>
      `;
    } else if (result.status === 'concern') {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--retracted">
          <strong>⚠️ EXPRESSION OF CONCERN</strong><br>
          This paper has an expression of concern.
        </div>
      `;
    } else if (result.status === 'correction') {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--unknown">
          <strong>📝 CORRECTION ISSUED</strong><br>
          A correction has been issued for this paper.
        </div>
      `;
    } else if (result.status === 'verified') {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--verified">
          <strong>✓ Verified</strong><br>
          This citation exists and is not retracted.
        </div>
      `;
    } else {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--unknown">
          <strong>? Unknown</strong><br>
          Could not determine status.
        </div>
      `;
    }
  } catch (error) {
    resultEl.innerHTML = `
      <div class="manual-check__result manual-check__result--unknown">
        <strong>Error</strong><br>
        Could not check DOI. Please try again.
      </div>
    `;
  } finally {
    checkBtn.disabled = false;
  }
}

// Initialize
init();
