import { describe, it, expect, vi, afterEach } from 'vitest';
import { citiciousAPI } from '../api-client';

// ---- fetch mocking helpers -------------------------------------------------

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

interface MockConfig {
  crossref?: Response;
  openalexDoi?: Response;
  openalexPmid?: Response;
  resolver?: Response;
}

function installFetch(cfg: MockConfig) {
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('doi.org/api/handles')) return cfg.resolver ?? mockResponse(404, {});
    if (url.includes('api.crossref.org')) return cfg.crossref ?? mockResponse(404, {});
    if (url.includes('openalex.org/works/pmid:')) return cfg.openalexPmid ?? mockResponse(404, {});
    if (url.includes('openalex.org/works/doi:')) return cfg.openalexDoi ?? mockResponse(404, {});
    throw new Error(`unexpected fetch url: ${url}`);
  }) as unknown as typeof fetch;
}

// ---- fixtures --------------------------------------------------------------

const crossrefWork = (overrides: Record<string, unknown> = {}) =>
  mockResponse(200, {
    message: {
      DOI: '10.1234/example',
      title: ['A Real Paper About Real Science'],
      author: [{ given: 'Jane', family: 'Doe' }],
      'container-title': ['Journal of Examples'],
      issued: { 'date-parts': [[2020]] },
      ...overrides,
    },
  });

const openalexWork = (overrides: Record<string, unknown> = {}) =>
  mockResponse(200, {
    doi: 'https://doi.org/10.1234/example',
    title: 'A Real Paper About Real Science',
    authorships: [{ author: { display_name: 'Jane Doe' } }],
    publication_year: 2020,
    primary_location: { source: { display_name: 'Journal of Examples' } },
    is_retracted: false,
    ...overrides,
  });

const resolverExists = mockResponse(200, { responseCode: 1, values: [] });
const resolverNotFound = mockResponse(200, { responseCode: 100 });

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- tests -----------------------------------------------------------------

describe('checkCitation by DOI', () => {
  it('marks a DOI found in CrossRef without updates as verified', async () => {
    installFetch({ crossref: crossrefWork() });
    const result = await citiciousAPI.checkCitation({ doi: '10.1234/example' });
    expect(result.status).toBe('verified');
    expect(result.isRetracted).toBe(false);
  });

  it('detects retraction from CrossRef update-to', async () => {
    installFetch({
      crossref: crossrefWork({
        'update-to': [{ type: 'retraction', DOI: '10.1234/retraction-notice' }],
      }),
    });
    const result = await citiciousAPI.checkCitation({ doi: '10.1234/example' });
    expect(result.status).toBe('retracted');
    expect(result.isRetracted).toBe(true);
    expect(result.retractionDetails?.retractionNoticeUrl).toContain('10.1234/retraction-notice');
  });

  it('detects expression of concern', async () => {
    installFetch({
      crossref: crossrefWork({ 'update-to': [{ type: 'expression_of_concern' }] }),
    });
    const result = await citiciousAPI.checkCitation({ doi: '10.1234/example' });
    expect(result.status).toBe('concern');
    expect(result.isRetracted).toBe(false);
  });

  it('detects correction / erratum', async () => {
    installFetch({
      crossref: crossrefWork({ 'update-to': [{ type: 'correction' }] }),
    });
    const result = await citiciousAPI.checkCitation({ doi: '10.1234/example' });
    expect(result.status).toBe('correction');
  });

  it('prefers the most severe signal when several updates exist', async () => {
    installFetch({
      crossref: crossrefWork({
        'update-to': [{ type: 'correction' }, { type: 'retraction' }],
      }),
    });
    const result = await citiciousAPI.checkCitation({ doi: '10.1234/example' });
    expect(result.status).toBe('retracted');
  });

  it('falls back to OpenAlex when CrossRef 404s', async () => {
    installFetch({ crossref: mockResponse(404, {}), openalexDoi: openalexWork() });
    const result = await citiciousAPI.checkCitation({ doi: '10.1234/example' });
    expect(result.status).toBe('verified');
    expect(result.validation?.source).toBe('openalex');
  });

  it('uses OpenAlex is_retracted in the fallback path', async () => {
    installFetch({
      crossref: mockResponse(404, {}),
      openalexDoi: openalexWork({ is_retracted: true }),
    });
    const result = await citiciousAPI.checkCitation({ doi: '10.1234/example' });
    expect(result.status).toBe('retracted');
    expect(result.isRetracted).toBe(true);
  });

  it('marks a DOI absent from both DBs but resolvable as unverified (NOT fake)', async () => {
    installFetch({
      crossref: mockResponse(404, {}),
      openalexDoi: mockResponse(404, {}),
      resolver: resolverExists,
    });
    const result = await citiciousAPI.checkCitation({ doi: '10.5281/zenodo.123456' });
    expect(result.status).toBe('unverified');
    expect(result.isRetracted).toBe(false);
  });

  it('marks a DOI absent everywhere (incl. resolver) as fake-likely', async () => {
    installFetch({
      crossref: mockResponse(404, {}),
      openalexDoi: mockResponse(404, {}),
      resolver: resolverNotFound,
    });
    const result = await citiciousAPI.checkCitation({ doi: '10.9999/nonexistent.fake.0001' });
    expect(result.status).toBe('fake-likely');
  });

  it('does not call something fake when both scholarly DBs error out', async () => {
    installFetch({
      crossref: mockResponse(500, {}),
      openalexDoi: mockResponse(500, {}),
    });
    const result = await citiciousAPI.checkCitation({ doi: '10.1234/example' });
    expect(result.status).toBe('skip');
  });

  it('flags fake-probably only on a critical title mismatch with a real provided title', async () => {
    installFetch({ crossref: crossrefWork() });
    const result = await citiciousAPI.checkCitation({
      doi: '10.1234/example',
      title: 'Fabricated unrelated citation title that matches nothing whatsoever',
    });
    expect(result.status).toBe('fake-probably');
  });

  it('stays verified when only the year differs (conservative)', async () => {
    installFetch({ crossref: crossrefWork() });
    const result = await citiciousAPI.checkCitation({
      doi: '10.1234/example',
      title: 'A Real Paper About Real Science',
      year: 2019,
    });
    expect(result.status).toBe('verified');
  });
});

describe('checkCitation by PMID', () => {
  it('resolves a PMID via OpenAlex and defers to the DOI pipeline', async () => {
    installFetch({
      openalexPmid: openalexWork(),
      crossref: crossrefWork(),
    });
    const result = await citiciousAPI.checkCitation({ pmid: '12345678' });
    expect(result.status).toBe('verified');
  });

  it('does not flag a PMID miss as fake (OpenAlex is not authoritative for PMIDs)', async () => {
    installFetch({ openalexPmid: mockResponse(404, {}) });
    const result = await citiciousAPI.checkCitation({ pmid: '99999999' });
    expect(result.status).toBe('skip');
  });
});

describe('checkCitation with no identifier', () => {
  it('skips when neither DOI nor PMID is present', async () => {
    installFetch({});
    const result = await citiciousAPI.checkCitation({ title: 'Some title' });
    expect(result.status).toBe('skip');
  });
});
