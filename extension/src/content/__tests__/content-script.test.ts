// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FullCheckResult } from '../../shared/types';

const result = (status: FullCheckResult['status']): FullCheckResult => ({
  status,
  isRetracted: status === 'retracted',
  retractionDetails: null,
  validation: null,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock('../extractors/doi-extractor');
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('dynamic references', () => {
  it('does not repeat full bibliography discovery for unrelated mutations', async () => {
    document.head.innerHTML = '<meta name="citation_title" content="Test article">';
    document.body.innerHTML = '<main><div id="dynamic-content"></div></main>';
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });

    let mutationCallback: MutationCallback | undefined;
    class TestMutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }
      observe() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal('MutationObserver', TestMutationObserver);

    const extractor = await vi.importActual<typeof import('../extractors/doi-extractor')>(
      '../extractors/doi-extractor'
    );
    const findReferenceSection = vi.fn(extractor.findReferenceSection);
    vi.doMock('../extractors/doi-extractor', () => ({ ...extractor, findReferenceSection }));
    const sendMessage = vi.fn(
      async (message: { type: string; payload?: Array<{ id: string }> }) => {
        if (message.type !== 'CHECK_BATCH') return { success: true };
        return {
          results: (message.payload || []).map((citation) => ({
            id: citation.id,
            result: result('not-checkable'),
          })),
        };
      }
    );
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn() },
      },
    });

    await import('../content-script');
    expect(mutationCallback).toBeDefined();
    const callsAfterInitialScan = findReferenceSection.mock.calls.length;
    const container = document.getElementById('dynamic-content')!;

    for (let index = 0; index < 3; index++) {
      const unrelated = document.createElement('span');
      unrelated.textContent = `Unrelated update ${index}`;
      container.append(unrelated);
      mutationCallback!(
        [{
          type: 'childList',
          target: container,
          addedNodes: [unrelated],
          removedNodes: [],
        } as unknown as MutationRecord],
        {} as MutationObserver
      );
    }

    expect(findReferenceSection).toHaveBeenCalledTimes(callsAfterInitialScan);

    vi.useFakeTimers();
    const bibliography = document.createElement('ol');
    bibliography.className = 'reference-list';
    container.append(bibliography);
    mutationCallback!(
      [{
        type: 'childList',
        target: container,
        addedNodes: [bibliography],
        removedNodes: [],
      } as unknown as MutationRecord],
      {} as MutationObserver
    );
    const lateReference = document.createElement('li');
    lateReference.id = 'late-reference';
    lateReference.textContent = 'Late reference without an identifier';
    bibliography.append(lateReference);
    mutationCallback!(
      [{
        type: 'childList',
        target: bibliography,
        addedNodes: [lateReference],
        removedNodes: [],
      } as unknown as MutationRecord],
      {} as MutationObserver
    );
    await vi.runOnlyPendingTimersAsync();

    expect(findReferenceSection).toHaveBeenCalledTimes(callsAfterInitialScan + 1);
    expect(document.getElementById('late-reference')?.textContent).toContain('NOT CHECKED');
  });

  it('rescans an identifierless entry appended inside a bibliography', async () => {
    document.head.innerHTML = '<meta name="citation_title" content="Test article">';
    document.body.innerHTML = `
      <ol class="reference-list">
        <li id="initial-reference">Initial reference without an identifier</li>
      </ol>
    `;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });

    let mutationCallback: MutationCallback | undefined;
    class TestMutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }
      observe() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal('MutationObserver', TestMutationObserver);

    const sendMessage = vi.fn(
      async (message: { type: string; payload?: Array<{ id: string }> }) => {
        if (message.type !== 'CHECK_BATCH') return { success: true };
        return {
          results: (message.payload || []).map((citation) => ({
            id: citation.id,
            result: result('not-checkable'),
          })),
        };
      }
    );
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn() },
      },
    });

    await import('../content-script');
    await vi.waitFor(() => {
      expect(document.getElementById('initial-reference')?.textContent).toContain('NOT CHECKED');
    });
    expect(mutationCallback).toBeDefined();

    vi.useFakeTimers();
    const bibliography = document.querySelector('.reference-list')!;
    const appended = document.createElement('li');
    appended.id = 'appended-reference';
    appended.textContent = 'New reference without an identifier';
    bibliography.append(appended);
    mutationCallback!(
      [{
        type: 'childList',
        target: bibliography,
        addedNodes: [appended],
        removedNodes: [],
      } as unknown as MutationRecord],
      {} as MutationObserver
    );
    await vi.runOnlyPendingTimersAsync();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'CHECK_BATCH')).toHaveLength(2);
    expect(appended.textContent).toContain('NOT CHECKED');
  });

  it('clears the summary banner after the final flag disappears, including failed replacements', async () => {
    document.head.innerHTML = '<meta name="citation_title" content="Test article">';
    document.body.innerHTML = `
      <section role="doc-bibliography">
        <div role="listitem" id="flagged-reference">Reference doi:10.1000/retracted</div>
      </section>
    `;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });

    let failChecks = false;
    const sendMessage = vi.fn(
      async (message: { type: string; payload?: Array<{ id: string }> }) => {
        if (message.type !== 'CHECK_BATCH') return { success: true };
        if (failChecks) return { error: 'storage unavailable' };
        return {
          results: (message.payload || []).map((citation) => ({
            id: citation.id,
            result: result('retracted'),
          })),
        };
      }
    );
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn() },
      },
    });

    const { scanPage } = await import('../content-script');
    await vi.waitFor(() => {
      expect(document.getElementById('citicious-top-banner')).not.toBeNull();
    });

    document.getElementById('flagged-reference')?.remove();
    await scanPage();

    expect(document.getElementById('citicious-top-banner')).toBeNull();

    const bibliography = document.querySelector('[role="doc-bibliography"]')!;
    const nextFlagged = document.createElement('div');
    nextFlagged.setAttribute('role', 'listitem');
    nextFlagged.textContent = 'Replacement retraction doi:10.1000/retracted-again';
    bibliography.append(nextFlagged);
    await scanPage();
    expect(document.getElementById('citicious-top-banner')).not.toBeNull();

    failChecks = true;
    nextFlagged.remove();
    const failedReplacement = document.createElement('div');
    failedReplacement.setAttribute('role', 'listitem');
    failedReplacement.textContent = 'Failed replacement doi:10.1000/unavailable';
    bibliography.append(failedReplacement);
    await scanPage();

    expect(failedReplacement.textContent).toContain('CHECK FAILED');
    expect(document.getElementById('citicious-top-banner')).toBeNull();
  });

  it('rechecks an existing reference when a lazy-loaded identifier appears', async () => {
    document.head.innerHTML = '<meta name="citation_title" content="Test article">';
    document.body.innerHTML = `
      <section role="doc-bibliography">
        <div role="listitem" id="reference">Reference without an identifier</div>
      </section>
    `;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });

    let failChecks = false;
    const sendMessage = vi.fn(async (message: { type: string; payload?: Array<{ id: string; doi?: string }> }) => {
      if (message.type !== 'CHECK_BATCH') return { success: true };
      if (failChecks) return { error: 'storage unavailable' };
      return {
        results: (message.payload || []).map((citation) => ({
          id: citation.id,
          result: result(citation.doi ? 'verified' : 'not-checkable'),
        })),
      };
    });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn() },
      },
    });

    const { scanPage } = await import('../content-script');
    await vi.waitFor(() => {
      expect(document.querySelector('.citicious-badge')?.textContent).toContain('NOT CHECKED');
    });

    const link = document.createElement('a');
    link.href = 'https://doi.org/10.1000/lazy';
    link.textContent = '10.1000/lazy';
    document.getElementById('reference')?.append(link);
    await scanPage();

    const batches = sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'CHECK_BATCH');
    expect(batches).toHaveLength(2);
    expect(batches[1].payload?.[0].doi).toBe('10.1000/lazy');
    expect(document.querySelector('.citicious-badge')?.textContent).toContain('Verified');

    failChecks = true;
    const failedReference = document.createElement('div');
    failedReference.setAttribute('role', 'listitem');
    failedReference.textContent = 'Another reference. doi:10.1000/failure';
    document.querySelector('[role="doc-bibliography"]')?.append(failedReference);
    await scanPage();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'CHECK_BATCH')).toHaveLength(3);
    expect(failedReference.querySelector('.citicious-badge')?.textContent).toContain('CHECK FAILED');
    const updates = sendMessage.mock.calls.filter(
      ([message]) => message.type === 'UPDATE_PAGE_STATUS'
    );
    expect(JSON.stringify(updates.at(-1)?.[0].payload)).toContain('"status":"failed"');

    failChecks = false;
    const bibliography = document.querySelector('[role="doc-bibliography"]')!;
    bibliography.insertAdjacentHTML(
      'beforeend',
      Array.from(
        { length: 500 },
        (_, index) => `<div role="listitem">Reference doi:10.2000/capped-${index}</div>`
      ).join('')
    );
    await scanPage();

    const finalBatches = sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'CHECK_BATCH');
    expect(finalBatches.at(-1)?.payload).toHaveLength(498);
    const finalUpdates = sendMessage.mock.calls.filter(
      ([message]) => message.type === 'UPDATE_PAGE_STATUS'
    );
    expect(finalUpdates.at(-1)?.[0].payload.hasMoreReferences).toBe(true);
  });

  it('rechecks a tracked reference after the 500-element allowance is full', async () => {
    document.head.innerHTML = '<meta name="citation_title" content="Test article">';
    document.body.innerHTML = `<section role="doc-bibliography">${Array.from(
      { length: 500 },
      (_, index) => `<div role="listitem" id="reference-${index}">Reference ${index}</div>`
    ).join('')}</section>`;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });

    const sendMessage = vi.fn(
      async (message: { type: string; payload?: Array<{ id: string; doi?: string }> }) => {
        if (message.type !== 'CHECK_BATCH') return { success: true };
        return {
          results: (message.payload || []).map((citation) => ({
            id: citation.id,
            result: result(citation.doi ? 'verified' : 'not-checkable'),
          })),
        };
      }
    );
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn() },
      },
    });

    const { scanPage } = await import('../content-script');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.citicious-badge')).toHaveLength(500);
    });
    vi.useFakeTimers();

    const link = document.createElement('a');
    link.href = 'https://doi.org/10.1000/after-cap';
    link.textContent = '10.1000/after-cap';
    document.getElementById('reference-499')?.append(link);
    await scanPage();

    const batches = sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'CHECK_BATCH');
    expect(batches).toHaveLength(2);
    expect(batches[1].payload).toHaveLength(1);
    expect(batches[1].payload?.[0].doi).toBe('10.1000/after-cap');
    expect(document.getElementById('reference-499')?.textContent).toContain('Verified');
  });

  it('stops new lookups after 500 unique reference identifiers', async () => {
    document.head.innerHTML = '<meta name="citation_title" content="Test article">';
    document.body.innerHTML = `<section role="doc-bibliography">${Array.from(
      { length: 500 },
      (_, index) =>
        `<div role="listitem" id="reference-${index}">Reference doi:10.2000/initial-${index}</div>`
    ).join('')}</section>`;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });

    const sendMessage = vi.fn(
      async (message: { type: string; payload?: Array<{ id: string }> }) => {
        if (message.type !== 'CHECK_BATCH') return { success: true };
        return {
          results: (message.payload || []).map((citation) => ({
            id: citation.id,
            result: result('verified'),
          })),
        };
      }
    );
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn() },
      },
    });

    const { scanPage } = await import('../content-script');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.citicious-badge')).toHaveLength(500);
    });
    vi.useFakeTimers();

    document.getElementById('reference-0')!.textContent =
      'Changed reference doi:10.3000/over-budget';
    await scanPage();

    const batches = sendMessage.mock.calls.filter(
      ([message]) => message.type === 'CHECK_BATCH'
    );
    expect(batches).toHaveLength(1);
    const updates = sendMessage.mock.calls.filter(
      ([message]) => message.type === 'UPDATE_PAGE_STATUS'
    );
    expect(updates.at(-1)?.[0].payload.hasMoreReferences).toBe(true);
  });
});
