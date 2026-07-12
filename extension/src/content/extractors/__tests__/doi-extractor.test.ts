// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  scanPageForDois,
  extractCurrentArticleDoi,
  findReferenceSection,
  extractReferenceDois,
  isValidDoi,
} from '../doi-extractor';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('extractCurrentArticleDoi', () => {
  it('reads the DOI from a citation_doi meta tag', () => {
    document.head.innerHTML = '<meta name="citation_doi" content="10.1038/s41586-020-2649-2">';
    const current = extractCurrentArticleDoi(document);
    expect(current?.doi).toBe('10.1038/s41586-020-2649-2');
    expect(current?.context).toBe('current-article');
  });

  it('reads the DOI from a data-doi attribute', () => {
    document.body.innerHTML = '<div data-doi="10.1234/Example.DOI"></div>';
    const current = extractCurrentArticleDoi(document);
    // normalized to lowercase
    expect(current?.doi).toBe('10.1234/example.doi');
  });

  it('returns null when no DOI is present', () => {
    document.body.innerHTML = '<p>No identifiers here.</p>';
    expect(extractCurrentArticleDoi(document)).toBeNull();
  });

  it('rejects a malformed data-doi value instead of extracting garbage', () => {
    document.body.innerHTML = '<div data-doi="not-a-doi-at-all"></div>';
    expect(extractCurrentArticleDoi(document)).toBeNull();
  });
});

describe('isValidDoi', () => {
  it('accepts well-formed DOIs including ones with parentheses', () => {
    expect(isValidDoi('10.1038/s41586-020-2649-2')).toBe(true);
    expect(isValidDoi('10.1016/s0140-6736(97)11096-0')).toBe(true);
  });

  it('rejects malformed strings', () => {
    expect(isValidDoi('not-a-doi')).toBe(false);
    expect(isValidDoi('10.12/short-prefix')).toBe(false);
    expect(isValidDoi('10.1234/')).toBe(false);
  });
});

describe('findReferenceSection', () => {
  it('finds an ol.references container', () => {
    document.body.innerHTML = '<ol class="references"><li>Ref</li></ol>';
    expect(findReferenceSection(document)?.tagName).toBe('OL');
  });

  it('finds a section via a standalone "References" heading', () => {
    document.body.innerHTML =
      '<section><h2>References</h2><ol><li>Ref</li></ol></section>';
    const section = findReferenceSection(document);
    expect(section?.tagName).toBe('SECTION');
  });

  it('finds a doc-bibliography role container', () => {
    document.body.innerHTML = '<div role="doc-bibliography"><p>Ref</p></div>';
    expect(findReferenceSection(document)).not.toBeNull();
  });

  it('ignores unrelated sidebar headings', () => {
    document.body.innerHTML = '<aside><h3>References &amp; Citations</h3></aside>';
    expect(findReferenceSection(document)).toBeNull();
  });

  it('skips an empty jump-target anchor and finds the real list (PLOS layout)', () => {
    document.body.innerHTML =
      '<a id="references"></a><ol class="references"><li>Doe J. A study. <a href="https://doi.org/10.1234/abc">link</a></li></ol>';
    const section = findReferenceSection(document);
    expect(section?.tagName).toBe('OL');
  });
});

describe('extractReferenceDois', () => {
  it('extracts DOIs from doi.org links', () => {
    document.body.innerHTML =
      '<ol class="references"><li>Doe J. A study. <a href="https://doi.org/10.1234/ABC">link</a></li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations).toHaveLength(1);
    expect(citations[0].doi).toBe('10.1234/abc');
    expect(citations[0].context).toBe('reference');
  });

  it('extracts DOIs from plain text', () => {
    document.body.innerHTML =
      '<ol class="references"><li>Smith J. Another study. doi:10.5555/xyz123</li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.map((c) => c.doi)).toContain('10.5555/xyz123');
  });

  it('deduplicates repeated DOIs', () => {
    document.body.innerHTML = `
      <ol class="references">
        <li><a href="https://doi.org/10.1234/dup">a</a></li>
        <li>also doi:10.1234/dup</li>
      </ol>`;
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.filter((c) => c.doi === '10.1234/dup')).toHaveLength(1);
  });

  it('extracts PubMed IDs for references without a DOI', () => {
    document.body.innerHTML =
      '<ol class="references"><li>Lee K. A paper. PMID: 12345678</li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.some((c) => c.pmid === '12345678')).toBe(true);
  });

  it('extracts PubMed IDs from pubmed.ncbi.nlm.nih.gov links', () => {
    document.body.innerHTML =
      '<ol class="references"><li>Kim H. Linked paper. <a href="https://pubmed.ncbi.nlm.nih.gov/87654321/">PubMed</a></li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.some((c) => c.pmid === '87654321')).toBe(true);
  });

  it('strips URL query strings and fragments from DOIs found in links', () => {
    document.body.innerHTML =
      '<ol class="references"><li><a href="https://doi.org/10.1234/abc?utm_source=x#section">link</a></li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations[0].doi).toBe('10.1234/abc');
  });

  it('keeps balanced parentheses that are part of the DOI', () => {
    document.body.innerHTML =
      '<ol class="references"><li>Wakefield A. doi:10.1016/S0140-6736(97)11096-0</li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.map((c) => c.doi)).toContain('10.1016/s0140-6736(97)11096-0');
  });

  it('strips an unbalanced trailing parenthesis from a DOI in prose', () => {
    document.body.innerHTML =
      '<ol class="references"><li>See the study (doi:10.1234/abc123).</li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.map((c) => c.doi)).toContain('10.1234/abc123');
  });
});

describe('scanPageForDois', () => {
  it('returns the current article plus deduplicated references', () => {
    document.head.innerHTML = '<meta name="citation_doi" content="10.1000/current">';
    document.body.innerHTML = `
      <ol class="references">
        <li><a href="https://doi.org/10.1234/ref-one">one</a></li>
        <li>doi:10.1234/ref-two</li>
      </ol>`;
    const citations = scanPageForDois(document);
    const current = citations.find((c) => c.context === 'current-article');
    const refs = citations.filter((c) => c.context === 'reference');
    expect(current?.doi).toBe('10.1000/current');
    expect(refs.map((c) => c.doi).sort()).toEqual(['10.1234/ref-one', '10.1234/ref-two']);
  });
});
