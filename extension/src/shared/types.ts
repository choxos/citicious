// Status types - simplified for user clarity
export type CitationStatus =
  | 'verified'       // ✓ DOI exists in CrossRef/OpenAlex
  | 'retracted'      // ⚠️ In RWD as retraction
  | 'concern'        // ⚠️ In RWD as expression of concern
  | 'correction'     // ⚠️ In RWD as correction
  | 'fake-likely'    // ❌ DOI doesn't exist (404), high confidence fake
  | 'fake-probably'  // ⚠️ Metadata very different, medium confidence fake
  | 'skip'           // No badge - can't determine (API error, no DOI/URL)
  | 'checking';      // Loading state while validating

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
  url?: string;
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
