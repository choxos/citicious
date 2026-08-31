// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CitationData } from '../sidebar';

let renderCitationCard: (citation: CitationData) => string;
let handleRuntimeMessage: (
  message: { type: string; payload: { url: string; citations: CitationData[] } },
  sender: { tab?: { id?: number } }
) => void;
let handleTabActivated: (activeInfo: { tabId: number; windowId: number }) => void;
let handleTabUpdated: (tabId: number, changeInfo: { status?: string }) => void;
let sendTabMessage: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const addListener = vi.fn();
  const addTabActivatedListener = vi.fn();
  const addTabUpdatedListener = vi.fn();
  sendTabMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 7, windowId: 1 }]),
      sendMessage: sendTabMessage,
      onActivated: { addListener: addTabActivatedListener },
      onUpdated: { addListener: addTabUpdatedListener },
    },
    runtime: {
      onMessage: { addListener },
    },
  });
  ({ renderCitationCard } = await import('../sidebar'));
  await vi.waitFor(() => expect(addListener).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(addTabActivatedListener).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(addTabUpdatedListener).toHaveBeenCalledOnce());
  handleRuntimeMessage = addListener.mock.calls[0][0];
  handleTabActivated = addTabActivatedListener.mock.calls[0][0];
  handleTabUpdated = addTabUpdatedListener.mock.calls[0][0];
});

describe('renderCitationCard', () => {
  it('renders unverified copy from optional discrepancy data', () => {
    const citation: CitationData = {
      id: 'dual-id',
      doi: '10.1234/example',
      pmid: '99999999',
      context: 'reference',
      status: 'unverified',
      isRetracted: false,
      validation: {
        exists: true,
        confidence: 0.5,
        source: 'none',
        discrepancies: [{
          field: 'doi',
          provided: '10.1234/example',
          actual: 'Resolves at doi.org but not indexed in CrossRef/OpenAlex',
          severity: 'minor',
        }],
        status: 'unverified',
      },
    };

    expect(renderCitationCard(citation)).toContain('Registered DOI');
    citation.validation!.discrepancies[0].field = 'pmid';
    expect(renderCitationCard(citation)).toContain('PubMed ID not found');
    Reflect.deleteProperty(citation.validation!, 'discrepancies');
    expect(renderCitationCard(citation)).toContain('Registered DOI');
  });

  it('describes deadline-deferred checks without reporting a lookup failure', () => {
    const html = renderCitationCard({
      id: 'deferred',
      doi: '10.1234/deferred',
      context: 'reference',
      status: 'skip',
      isRetracted: false,
    });
    expect(html).toContain('Check deferred after the page time limit');
    expect(html).not.toContain('External lookup failed');
  });
});

describe('sidebar status updates', () => {
  it('isolates updates to the active tab across tab switches', async () => {
    document.body.innerHTML = `
      <span id="retracted-count"></span>
      <span id="fake-count"></span>
      <span id="verified-count"></span>
      <div id="content">Current tab</div>
    `;
    const message = {
      type: 'UPDATE_PAGE_STATUS',
      payload: { url: 'https://example.test', citations: [] },
    };

    handleRuntimeMessage(message, { tab: { id: 8 } });
    expect(document.getElementById('content')?.textContent).toBe('Current tab');

    handleRuntimeMessage(message, { tab: { id: 7 } });
    expect(document.getElementById('content')?.textContent).toContain('No citations found');

    handleTabActivated({ tabId: 8, windowId: 1 });
    await vi.waitFor(() => {
      expect(sendTabMessage).toHaveBeenLastCalledWith(8, { type: 'GET_PAGE_STATUS' });
    });
    handleRuntimeMessage(message, { tab: { id: 8 } });
    expect(document.getElementById('content')?.textContent).toContain('No citations found');
  });

  it('clears stale status while the active tab navigates', async () => {
    document.body.innerHTML = `
      <span id="retracted-count">4</span>
      <span id="fake-count">3</span>
      <span id="verified-count">2</span>
      <div id="content">Old article results</div>
    `;
    handleTabActivated({ tabId: 7, windowId: 1 });
    handleTabUpdated(7, { status: 'loading' });

    expect(document.getElementById('content')?.textContent).toContain('Checking this page');
    expect(document.getElementById('retracted-count')?.textContent).toBe('0');
    expect(document.getElementById('fake-count')?.textContent).toBe('0');
    expect(document.getElementById('verified-count')?.textContent).toBe('0');

    handleTabUpdated(7, { status: 'complete' });
    await vi.waitFor(() => {
      expect(sendTabMessage).toHaveBeenLastCalledWith(7, { type: 'GET_PAGE_STATUS' });
    });
  });
});
