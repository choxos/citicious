// Retraction types
export interface RetractionDetails {
  recordId: number;
  title: string | null;
  journal: string | null;
  publisher: string | null;
  authors: string[];
  retractionDate: string | null;
  retractionNature: string | null;
  reason: string[];
  retractionNoticeUrl: string | null;
  originalPaperDate: string | null;
  source?: 'publisher' | 'retraction-watch'; // Source of retraction info
}

export interface RetractionCheckRequest {
  doi?: string;
  pmid?: string;
}

export interface RetractionCheckResponse {
  isRetracted: boolean;
  details?: RetractionDetails;
}

// Citation validation types
export interface CitationInput {
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
}

export interface Discrepancy {
  field: string;
  provided: string;
  actual: string;
  severity: 'minor' | 'major' | 'critical';
}

export interface MatchedData {
  doi: string;
  title: string;
  authors: { name: string; given?: string; family?: string }[];
  year: number;
  journal: string;
  publisher?: string;
  type?: string;
  volume?: string;
  issue?: string;
  pages?: string;
}

// Citation status - simplified for user clarity
export type CitationStatus =
  | 'verified'       // ✓ DOI exists in CrossRef/OpenAlex
  | 'retracted'      // ⚠️ In RWD as retraction
  | 'concern'        // ⚠️ In RWD as expression of concern
  | 'correction'     // ⚠️ In RWD as correction
  | 'fake-likely'    // ❌ DOI doesn't exist (404), high confidence fake
  | 'fake-probably'  // ⚠️ Metadata very different, medium confidence fake
  | 'skip';          // No badge - can't determine (API error, no DOI/URL)

export interface CitationValidationResponse {
  exists: boolean;
  confidence: number;
  source: 'crossref' | 'openalex' | 'none';
  matchedData?: MatchedData;
  discrepancies: Discrepancy[];
  status: CitationStatus;
}

// Batch check types
export interface BatchCheckRequest {
  items: (RetractionCheckRequest | CitationInput)[];
}

export interface BatchCheckResponse {
  results: (RetractionCheckResponse | CitationValidationResponse)[];
}

// CrossRef API types
export interface CrossRefWork {
  doi: string;
  title: string;
  authors: { given?: string; family?: string; name: string }[];
  year: number;
  journal: string;
  publisher?: string;
  type?: string;
  volume?: string;
  issue?: string;
  pages?: string;
}

// CrossRef lookup result - distinguishes found/not_found/error
export type CrossRefLookupResult =
  | { status: 'found'; work: CrossRefWork }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

// OpenAlex API types
export interface OpenAlexWork {
  doi: string;
  title: string;
  authors: { name: string; orcid?: string }[];
  year: number;
  journal: string;
  openAlexId: string;
  citedByCount?: number;
}

// OpenAlex lookup result - distinguishes found/not_found/error
export type OpenAlexLookupResult =
  | { status: 'found'; work: OpenAlexWork }
  | { status: 'not_found' }
  | { status: 'error'; message: string };
