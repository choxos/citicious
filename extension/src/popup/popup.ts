import { citiciousAPI } from '../shared/api-client';
import { escapeHtml } from '../shared/utils';
import { isValidDoi, normalizeDoi } from '../content/extractors/doi-extractor';

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

  // Set up rescan
  const rescanBtn = document.getElementById('rescan-btn') as HTMLButtonElement;
  rescanBtn.addEventListener('click', handleRescan);
}

/**
 * Ask the content script to rescan the current page
 */
async function handleRescan() {
  const rescanBtn = document.getElementById('rescan-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('page-status')!;

  rescanBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      rescanBtn.disabled = false;
      return;
    }

    statusEl.innerHTML = `
      <div class="status-box">
        <div class="status-icon">⟳</div>
        <div class="status-text">Rescanning page...</div>
      </div>
    `;
    // The content script responds after the scan (including API checks)
    // has finished
    await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN_PAGE' });
    await loadPageStatus();
    rescanBtn.disabled = false;
  } catch {
    // No content script on this page (non-academic or restricted page)
    statusEl.innerHTML = `
      <div class="status-box">
        <div class="status-icon">📄</div>
        <div class="status-text">This page does not contain academic content</div>
      </div>
    `;
    rescanBtn.disabled = false;
  }
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

      const retracted = citations.filter((c: any) => c.status === 'retracted');
      const concerns = citations.filter(
        (c: any) => c.status === 'concern' || c.status === 'correction'
      );
      const suspicious = citations.filter(
        (c: any) => c.status === 'fake-likely' || c.status === 'fake-probably'
      );
      const verified = citations.filter((c: any) => c.status === 'verified');
      const problematic = retracted.length + concerns.length + suspicious.length;

      // Update stats
      document.getElementById('retracted-count')!.textContent = String(retracted.length);
      document.getElementById('fake-count')!.textContent = String(suspicious.length);
      document.getElementById('verified-count')!.textContent = String(verified.length);
      statsEl.style.display = 'flex';

      // Show status
      if (problematic > 0) {
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
              <div class="status-text">${problematic} problematic citation${problematic > 1 ? 's' : ''} found</div>
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

  // Normalize (doi.org prefix, query strings, trailing punctuation) and
  // validate syntax before any lookup
  const cleanedDoi = normalizeDoi(doi);
  if (!isValidDoi(cleanedDoi)) {
    resultEl.innerHTML = `
      <div class="manual-check__result manual-check__result--unknown">
        <strong>Not a valid DOI format</strong><br>
        A DOI looks like 10.1234/abc123. Check for a typo.
      </div>
    `;
    return;
  }

  // Show loading state
  checkBtn.disabled = true;
  resultEl.innerHTML = '<div class="manual-check__result manual-check__result--unknown">Checking...</div>';

  try {
    const result = await citiciousAPI.checkCitation({ doi: cleanedDoi });

    if (result.isRetracted) {
      const reasons = result.retractionDetails?.reason?.length
        ? `<br>Reason: ${escapeHtml(result.retractionDetails.reason.slice(0, 2).join(', '))}`
        : '';
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--retracted">
          <strong>⚠️ RETRACTED</strong>${reasons}
        </div>
      `;
    } else if (result.status === 'fake-likely') {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--retracted">
          <strong>❌ DOI NOT FOUND</strong><br>
          This DOI is not registered at doi.org or indexed in academic databases. It may be a typo or a fabricated reference.
        </div>
      `;
    } else if (result.status === 'fake-probably') {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--unknown">
          <strong>⚠️ METADATA MISMATCH</strong><br>
          Citation details differ significantly from the published record.
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
    } else if (result.status === 'unverified') {
      resultEl.innerHTML = `
        <div class="manual-check__result manual-check__result--unknown">
          <strong>ℹ Unverified</strong><br>
          This DOI is registered (resolves at doi.org) but is not indexed in CrossRef/OpenAlex; common for datasets, software, or theses.
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
