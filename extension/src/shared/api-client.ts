import type { FullCheckResult, ExtractedCitation, RetractionDetails, Discrepancy, MatchedData } from './types';

const CROSSREF_BASE_URL = 'https://api.crossref.org';
const OPENALEX_BASE_URL = 'https://api.openalex.org';
// DOI Handle System REST API. Resolves ANY registered DOI regardless of
// registration agency (Crossref, DataCite, mEDRA, ...), so it is the
// authoritative existence check used to avoid falsely branding real DOIs "fake".
const DOI_RESOLVER_URL = 'https://doi.org/api/handles';

// Email for polite pool access (better rate limits)
const CONTACT_EMAIL = 'choxos@users.noreply.github.com';
const USER_AGENT = `Citicious/0.1.0 (mailto:${CONTACT_EMAIL})`;

// A skip result reused whenever we cannot determine anything.
const SKIP_RESULT: FullCheckResult = {
  status: 'skip',
  isRetracted: false,
  retractionDetails: null,
  validation: null,
};

type RetractionStatus = 'retracted' | 'concern' | 'correction';

/**
 * Normalize DOI for API lookup
 */
function normalizeDoi(doi: string): string {
  return doi.toLowerCase().trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
}

/**
 * Encode a DOI for use in a URL path while preserving the slash that
 * separates the registrant prefix from the suffix.
 */
function encodeDoiPath(doi: string): string {
  return encodeURIComponent(doi).replace(/%2F/gi, '/');
}

/**
 * fetch wrapper that retries once on HTTP 429 (rate limited), honoring
 * Retry-After (capped at 5s) so heavy reference lists don't silently
 * degrade to "skip".
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 1
): Promise<Response> {
  const response = await fetch(url, options);
  if (response.status === 429 && retries > 0) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
    const waitMs = Math.min(Number.isFinite(retryAfter) ? retryAfter : 1, 5) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return fetchWithRetry(url, options, retries - 1);
  }
  return response;
}

/**
 * Calculate string similarity (simple word overlap)
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 1;

  // Simple word overlap similarity (Jaccard over words longer than 2 chars)
  const aWords = new Set(aLower.split(/\s+/).filter((w) => w.length > 2));
  const bWords = new Set(bLower.split(/\s+/).filter((w) => w.length > 2));
  const intersection = [...aWords].filter((w) => bWords.has(w));
  const union = new Set([...aWords, ...bWords]);

  return union.size > 0 ? intersection.length / union.size : 0;
}

/**
 * Check CrossRef for a DOI
 */
async function checkCrossRef(
  doi: string
): Promise<{ status: 'found' | 'not_found' | 'error'; work?: any }> {
  const normalizedDoi = normalizeDoi(doi);

  try {
    const response = await fetchWithRetry(
      `${CROSSREF_BASE_URL}/works/${encodeURIComponent(normalizedDoi)}`,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
      }
    );

    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'error' };

    const data = await response.json();
    return { status: 'found', work: data.message };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Check OpenAlex for a DOI
 */
async function checkOpenAlex(
  doi: string
): Promise<{ status: 'found' | 'not_found' | 'error'; work?: any }> {
  const normalizedDoi = normalizeDoi(doi);

  try {
    const response = await fetchWithRetry(
      `${OPENALEX_BASE_URL}/works/doi:${encodeURIComponent(normalizedDoi)}?mailto=${CONTACT_EMAIL}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
        },
      }
    );

    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'error' };

    const data = await response.json();
    return { status: 'found', work: data };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Look up an OpenAlex work by PubMed ID.
 */
async function checkOpenAlexByPmid(
  pmid: string
): Promise<{ status: 'found' | 'not_found' | 'error'; work?: any }> {
  try {
    const response = await fetchWithRetry(
      `${OPENALEX_BASE_URL}/works/pmid:${encodeURIComponent(pmid)}?mailto=${CONTACT_EMAIL}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
        },
      }
    );

    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'error' };

    const data = await response.json();
    return { status: 'found', work: data };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Authoritative existence check via the DOI resolver (Handle System).
 * responseCode 1 = handle exists; anything else (100/200/...) = not registered.
 */
async function checkDoiResolver(doi: string): Promise<'exists' | 'not_found' | 'error'> {
  const normalizedDoi = normalizeDoi(doi);

  try {
    const response = await fetch(`${DOI_RESOLVER_URL}/${encodeDoiPath(normalizedDoi)}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (response.status === 404) return 'not_found';
    if (!response.ok) return 'error';

    const data = await response.json();
    return data?.responseCode === 1 ? 'exists' : 'not_found';
  } catch {
    return 'error';
  }
}

/**
 * Classify a Crossref `update-to[].type` (or relation) into our status taxonomy.
 */
function classifyUpdateType(type: string): RetractionStatus | null {
  const t = (type || '').toLowerCase();
  if (t.includes('retract') || t.includes('withdrawal') || t.includes('removal')) {
    return 'retracted';
  }
  if (t.includes('concern')) return 'concern';
  if (
    t.includes('correction') ||
    t.includes('corrigendum') ||
    t.includes('erratum') ||
    t.includes('addendum')
  ) {
    return 'correction';
  }
  return null;
}

const SEVERITY_RANK: Record<RetractionStatus, number> = {
  retracted: 3,
  concern: 2,
  correction: 1,
};

function buildCrossrefDetails(work: any, update: any): RetractionDetails {
  return {
    recordId: 0,
    title: work.title?.[0] || null,
    journal: work['container-title']?.[0] || null,
    publisher: work.publisher || null,
    authors:
      work.author?.map((a: any) => (a.given && a.family ? `${a.given} ${a.family}` : a.name)) || [],
    retractionDate: update?.updated?.['date-time'] || null,
    retractionNature: update?.type || 'Retraction',
    reason: [],
    retractionNoticeUrl: update?.DOI ? `https://doi.org/${update.DOI}` : null,
    originalPaperDate: null,
    source: 'publisher',
  };
}

/**
 * Detect retraction / expression-of-concern / correction from Crossref metadata.
 * Picks the most severe signal when several are present.
 */
function classifyRetraction(
  crossrefWork: any
): { status: RetractionStatus; details: RetractionDetails } | null {
  let best: { status: RetractionStatus; details: RetractionDetails } | null = null;

  const updateTo = crossrefWork['update-to'];
  if (Array.isArray(updateTo)) {
    for (const update of updateTo) {
      const status = classifyUpdateType(update?.type || '');
      if (status && (!best || SEVERITY_RANK[status] > SEVERITY_RANK[best.status])) {
        best = { status, details: buildCrossrefDetails(crossrefWork, update) };
      }
    }
  }
  if (best) return best;

  // Fallback: relation field
  const relation = crossrefWork.relation;
  if (relation) {
    for (const relType of ['is-retracted-by', 'has-retraction']) {
      if (relation[relType]) {
        return {
          status: 'retracted',
          details: buildCrossrefDetails(crossrefWork, {
            type: 'Retraction',
            DOI: relation[relType]?.[0]?.id,
          }),
        };
      }
    }
  }

  return null;
}

function buildOpenAlexRetractionDetails(work: any): RetractionDetails {
  return {
    recordId: 0,
    title: work.title || work.display_name || null,
    journal: work.primary_location?.source?.display_name || null,
    publisher: work.primary_location?.source?.host_organization_name || null,
    authors:
      work.authorships?.map((a: any) => a.author?.display_name).filter(Boolean) || [],
    retractionDate: null,
    retractionNature: 'Retraction',
    reason: [],
    retractionNoticeUrl: null,
    originalPaperDate: work.publication_date || null,
    source: 'retraction-watch',
  };
}

/**
 * Transform a CrossRef work into our matched-data format
 */
function crossrefToMatchedData(work: any): MatchedData {
  const authors =
    work.author?.map((a: any) => ({
      given: a.given,
      family: a.family,
      name: a.given && a.family ? `${a.given} ${a.family}` : a.name || 'Unknown',
    })) || [];

  const year =
    work['published-print']?.['date-parts']?.[0]?.[0] ||
    work['published-online']?.['date-parts']?.[0]?.[0] ||
    work.issued?.['date-parts']?.[0]?.[0] ||
    work.created?.['date-parts']?.[0]?.[0];

  return {
    doi: work.DOI,
    title: work.title?.[0] || '',
    authors,
    year: year || 0,
    journal: work['container-title']?.[0] || '',
    publisher: work.publisher,
  };
}

/**
 * Transform an OpenAlex work into our matched-data format
 */
function openalexToMatchedData(work: any): MatchedData {
  const authors =
    work.authorships?.map((a: any) => ({
      name: a.author?.display_name || 'Unknown',
    })) || [];

  return {
    doi: work.doi?.replace('https://doi.org/', '') || '',
    title: work.title || work.display_name || '',
    authors,
    year: work.publication_year || 0,
    journal: work.primary_location?.source?.display_name || '',
  };
}

/**
 * Compare provided citation metadata against the authoritative record.
 */
function compareMetadata(
  provided: { title?: string; authors?: string[]; year?: number; journal?: string },
  actual: MatchedData
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  if (provided.title && actual.title) {
    const titleSimilarity = stringSimilarity(provided.title, actual.title);
    if (titleSimilarity < 0.9) {
      discrepancies.push({
        field: 'title',
        provided: provided.title,
        actual: actual.title,
        severity: titleSimilarity < 0.5 ? 'critical' : 'major',
      });
    }
  }

  if (provided.year && actual.year && provided.year !== actual.year) {
    const yearDiff = Math.abs(provided.year - actual.year);
    discrepancies.push({
      field: 'year',
      provided: String(provided.year),
      actual: String(actual.year),
      severity: yearDiff > 2 ? 'major' : 'minor',
    });
  }

  if (provided.authors?.length && actual.authors?.length) {
    const providedFirstAuthor = provided.authors[0].toLowerCase();
    const actualFirstAuthor = actual.authors[0].name.toLowerCase();
    const authorSimilarity = stringSimilarity(providedFirstAuthor, actualFirstAuthor);

    if (authorSimilarity < 0.7) {
      discrepancies.push({
        field: 'authors',
        provided: provided.authors[0],
        actual: actual.authors[0].name,
        severity: 'major',
      });
    }
  }

  return discrepancies;
}

/** A real DOI that resolves but is absent from scholarly databases. */
function unverifiedResult(doi: string): FullCheckResult {
  return {
    status: 'unverified',
    isRetracted: false,
    retractionDetails: null,
    validation: {
      exists: true,
      confidence: 0.5,
      source: 'none',
      discrepancies: [
        {
          field: 'doi',
          provided: doi,
          actual: 'Resolves at doi.org but not indexed in CrossRef/OpenAlex',
          severity: 'minor',
        },
      ],
      status: 'unverified',
    },
  };
}

/** A DOI that exists in neither scholarly DBs nor the DOI resolver. */
function fakeLikelyResult(doi: string): FullCheckResult {
  return {
    status: 'fake-likely',
    isRetracted: false,
    retractionDetails: null,
    validation: {
      exists: false,
      confidence: 0,
      source: 'none',
      discrepancies: [
        { field: 'doi', provided: doi, actual: 'NOT FOUND', severity: 'critical' },
      ],
      status: 'fake-likely',
    },
  };
}

export class CiticiousAPI {
  /**
   * Check a single citation (validation + retraction status)
   */
  async checkCitation(citation: {
    doi?: string;
    pmid?: string;
    url?: string;
    title?: string;
    authors?: string[];
    year?: number;
    journal?: string;
  }): Promise<FullCheckResult> {
    if (citation.doi) return this.checkByDoi(citation);
    if (citation.pmid) return this.checkByPmid(citation);
    // No identifier we can validate -> skip
    return SKIP_RESULT;
  }

  /**
   * Resolve metadata + retraction + mismatch for a work already found in a
   * scholarly database.
   */
  private buildResultFromMatch(
    citation: { title?: string; authors?: string[]; year?: number; journal?: string },
    matchedData: MatchedData,
    source: 'crossref' | 'openalex',
    rawCrossrefWork: any,
    openalexWork: any
  ): FullCheckResult {
    const discrepancies = compareMetadata(citation, matchedData);

    // Retraction / concern / correction
    let retraction: { status: RetractionStatus; details: RetractionDetails } | null = null;
    if (rawCrossrefWork) {
      retraction = classifyRetraction(rawCrossrefWork);
    }
    if (!retraction && openalexWork?.is_retracted) {
      retraction = { status: 'retracted', details: buildOpenAlexRetractionDetails(openalexWork) };
    }

    if (retraction) {
      return {
        status: retraction.status,
        isRetracted: retraction.status === 'retracted',
        retractionDetails: retraction.details,
        validation: {
          exists: true,
          confidence: 1.0,
          source,
          matchedData,
          discrepancies,
          status: retraction.status,
        },
      };
    }

    // Conservative metadata-mismatch detection: only flag when a real title was
    // confidently extracted AND it is critically dissimilar from the record.
    const criticalTitleMismatch = discrepancies.some(
      (d) => d.field === 'title' && d.severity === 'critical'
    );
    if (criticalTitleMismatch && (citation.title?.trim().length || 0) > 25) {
      return {
        status: 'fake-probably',
        isRetracted: false,
        retractionDetails: null,
        validation: {
          exists: true,
          confidence: 0.4,
          source,
          matchedData,
          discrepancies,
          status: 'fake-probably',
        },
      };
    }

    return {
      status: 'verified',
      isRetracted: false,
      retractionDetails: null,
      validation: {
        exists: true,
        confidence: 1.0,
        source,
        matchedData,
        discrepancies,
        status: 'verified',
      },
    };
  }

  /**
   * Check a citation by DOI.
   */
  private async checkByDoi(citation: {
    doi?: string;
    title?: string;
    authors?: string[];
    year?: number;
    journal?: string;
  }): Promise<FullCheckResult> {
    if (!citation.doi) return SKIP_RESULT;

    const crossrefResult = await checkCrossRef(citation.doi);

    if (crossrefResult.status === 'found') {
      return this.buildResultFromMatch(
        citation,
        crossrefToMatchedData(crossrefResult.work),
        'crossref',
        crossrefResult.work,
        null
      );
    }

    // CrossRef did not return the work -> try OpenAlex
    const openalexResult = await checkOpenAlex(citation.doi);

    if (openalexResult.status === 'found') {
      return this.buildResultFromMatch(
        citation,
        openalexToMatchedData(openalexResult.work),
        'openalex',
        null,
        openalexResult.work
      );
    }

    // Neither scholarly DB has it. If both were merely ambiguous (errors), we
    // cannot conclude anything.
    if (crossrefResult.status === 'error' && openalexResult.status === 'error') {
      return SKIP_RESULT;
    }

    // At least one DB definitively reported the DOI as not found. Consult the
    // authoritative DOI resolver before accusing the reference of being fake.
    const resolver = await checkDoiResolver(citation.doi);
    if (resolver === 'exists') {
      // Real DOI, just not in scholarly databases (e.g. dataset, software, thesis).
      return unverifiedResult(citation.doi);
    }
    if (resolver === 'not_found') {
      return fakeLikelyResult(citation.doi);
    }
    // Resolver itself was unreachable -> don't accuse, skip.
    return SKIP_RESULT;
  }

  /**
   * Check a citation by PubMed ID. PubMed is authoritative for PMIDs, so we do
   * not flag "fake" on a PMID miss; we resolve via OpenAlex and, when a DOI is
   * found, defer to the full DOI pipeline.
   */
  private async checkByPmid(citation: {
    pmid?: string;
    title?: string;
    authors?: string[];
    year?: number;
    journal?: string;
  }): Promise<FullCheckResult> {
    if (!citation.pmid) return SKIP_RESULT;

    const result = await checkOpenAlexByPmid(citation.pmid);
    if (result.status !== 'found') {
      // not_found / error: cannot conclude (OpenAlex isn't authoritative for PMIDs)
      return SKIP_RESULT;
    }

    const work = result.work;
    const doi = work.doi ? normalizeDoi(work.doi) : undefined;
    if (doi) {
      return this.checkByDoi({ ...citation, doi });
    }

    // Found in OpenAlex but has no DOI
    return this.buildResultFromMatch(
      citation,
      openalexToMatchedData(work),
      'openalex',
      null,
      work
    );
  }

  /**
   * Batch check multiple citations with a concurrency limit.
   */
  async checkBatch(
    citations: ExtractedCitation[]
  ): Promise<Map<string, FullCheckResult>> {
    const results = new Map<string, FullCheckResult>();
    const BATCH_SIZE = 5;

    for (let i = 0; i < citations.length; i += BATCH_SIZE) {
      const batch = citations.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (c) => {
          const result = await this.checkCitation({
            doi: c.doi,
            pmid: c.pmid,
            url: c.url,
            title: c.title,
            authors: c.authors,
            year: c.year,
            journal: c.journal,
          });
          return { id: c.id, result };
        })
      );

      for (const { id, result } of batchResults) {
        results.set(id, result);
      }
    }

    return results;
  }
}

// Export singleton instance
export const citiciousAPI = new CiticiousAPI();
