// Status types
export type CitationStatus = 'retracted' | 'fake' | 'suspicious' | 'verified' | 'checking' | 'unknown';

// Retraction details
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
  source?: 'publisher' | 'retraction-watch';
}

// Discrepancy found during validation
export interface Discrepancy {
  field: string;
  provided: string;
  actual: string;
  severity: 'minor' | 'major' | 'critical';
}

// Matched data from CrossRef/OpenAlex
export interface MatchedData {
  doi: string;
  title: string;
  authors: { name: string; given?: string; family?: string }[];
  year: number;
  journal: string;
  publisher?: string;
}

// Validation result
export interface ValidationResult {
  exists: boolean;
  confidence: number;
  source: 'crossref' | 'openalex' | 'none';
  matchedData?: MatchedData;
  discrepancies: Discrepancy[];
  status: CitationStatus;
}

// Full check result
export interface FullCheckResult {
  status: CitationStatus;
  isRetracted: boolean;
  retractionDetails: RetractionDetails | null;
  validation: ValidationResult | null;
}

// Extracted citation from page
export interface ExtractedCitation {
  id: string;
  doi?: string;
  pmid?: string;
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  element: HTMLElement;
  context: 'current-article' | 'reference';
}

// Citation with check result
export interface CheckedCitation extends ExtractedCitation {
  result?: FullCheckResult;
  checking: boolean;
}

// Message types for communication between content script and service worker
export type MessageType =
  | 'CHECK_CITATION'
  | 'CHECK_BATCH'
  | 'GET_PAGE_STATUS'
  | 'UPDATE_CITATION'
  | 'OPEN_SIDEBAR';

export interface Message {
  type: MessageType;
  payload?: any;
}

// Page scan result
export interface PageScanResult {
  currentArticle: ExtractedCitation | null;
  references: ExtractedCitation[];
  totalDOIs: number;
  url: string;
}
