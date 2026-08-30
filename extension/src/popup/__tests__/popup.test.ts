// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

it('keeps incomplete reference coverage visible when problems are found', async () => {
  document.body.innerHTML = `
    <div id="page-status"></div>
    <div id="stats">
      <span id="retracted-count"></span>
      <span id="fake-count"></span>
      <span id="verified-count"></span>
    </div>
    <button id="rescan-btn"></button>
    <input id="doi-input">
    <button id="check-btn"></button>
    <div id="manual-result"></div>
  `;

  const citations = [
    { context: 'reference', status: 'retracted' },
    ...Array.from({ length: 44 }, () => ({ context: 'reference', status: 'verified' })),
    ...Array.from({ length: 31 }, () => ({ context: 'reference', status: 'not-checkable' })),
  ];
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
      sendMessage: vi.fn().mockResolvedValue({ citations, hasMoreReferences: true }),
    },
  });

  await import('../popup');

  await vi.waitFor(() => {
    expect(document.querySelector('.status-text')?.textContent).toContain(
      '1 problematic citation found'
    );
  });
  expect(document.querySelector('.status-coverage')?.textContent).toContain(
    '45/76 scanned references checked · 31 without DOI/PMID'
  );
  expect(document.querySelector('.status-coverage')?.textContent).toContain(
    'additional references not scanned (500-reference safety limit)'
  );
});
