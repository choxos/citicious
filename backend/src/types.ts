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

export interface CitationValidationResponse {
  exists: boolean;
  confidence: number;
  source: 'crossref' | 'openalex' | 'none';
  matchedData?: MatchedData;
  discrepancies: Discrepancy[];
  status: 'verified' | 'fake' | 'suspicious' | 'unknown';
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
