// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CitationData } from '../sidebar';

let renderCitationCard: (citation: CitationData) => string;

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn(),
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
    },
  });
  ({ renderCitationCard } = await import('../sidebar'));
});

describe('renderCitationCard', () => {
  it('uses the failed identifier rather than identifier presence for unverified copy', () => {
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
  });
});
