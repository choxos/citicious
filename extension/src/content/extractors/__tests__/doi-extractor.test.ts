// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  scanPageForDois,
  extractCurrentArticleDoi,
  findReferenceSection,
  extractReferenceDois,
  isValidDoi,
} from '../doi-extractor';

beforeEach(() => {
  vi.restoreAllMocks();
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
    document.body.innerHTML = '<article data-doi="10.1234/Example.DOI"></article>';
    const current = extractCurrentArticleDoi(document);
    // normalized to lowercase
    expect(current?.doi).toBe('10.1234/example.doi');
  });

  it('does not mistake a reference data-doi attribute for the current article', () => {
    document.body.innerHTML = `
      <section role="doc-bibliography">
        <div role="listitem" data-doi="10.1234/reference">Reference</div>
      </section>`;
    expect(extractCurrentArticleDoi(document)).toBeNull();
  });

  it('does not mistake a reference DOI element for the current article', () => {
    document.body.innerHTML = `
      <section role="doc-bibliography">
        <div role="listitem"><span class="doi">10.1234/reference</span></div>
      </section>`;
    expect(extractCurrentArticleDoi(document)).toBeNull();
  });

  it('returns null when no DOI is present', () => {
    document.body.innerHTML = '<p>No identifiers here.</p>';
    expect(extractCurrentArticleDoi(document)).toBeNull();
  });

  it('rejects a malformed data-doi value instead of extracting garbage', () => {
    document.body.innerHTML = '<div data-doi="not-a-doi-at-all"></div>';
    expect(extractCurrentArticleDoi(document)).toBeNull();
  });

  it('uses a DOI link target instead of concatenated Material Icons text', () => {
    document.body.innerHTML =
      '<a class="doi-link" href="https://doi.org/10.1002%2Fjrsm.1718"><span class="text">https://doi.org/10.1002/jrsm.1718</span><span class="icon material-icons">open_in_new</span></a>';
    expect(extractCurrentArticleDoi(document)?.doi).toBe('10.1002/jrsm.1718');
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

  it('follows a "References" toggle to the panel it opens and splits its rows', () => {
    document.body.innerHTML = `
      <div class="card">
        <button id="refrences" data-target="#collapseExample" aria-controls="collapseExample">
          <strong>References</strong>
        </button>
        <div class="collapse" id="collapseExample">
          <div id="reference-box">
            <div class="reference">
              <div class="line">[1] Doe J. A first work of sufficient length to be a reference. 2019.</div>
              <div class="line">[2] Roe J. A second work, also long enough to count as one. <a href="https://doi.org/10.1234/second">doi</a></div>
              <div class="line">[3] Poe J. A third work, still long enough to count as one. 2021.</div>
            </div>
          </div>
        </div>
      </div>`;
    const section = findReferenceSection(document);
    expect(section?.id).toBe('collapseExample');
    const citations = extractReferenceDois(section!);
    expect(citations).toHaveLength(3);
    expect(citations[1].doi).toBe('10.1234/second');
  });

  it('does not read an author byline with PubMed search links as a reference list', () => {
    document.body.innerHTML = `
      <section class="front-matter">
        <div class="ameta p">
          <div class="cg p">
            <a href="https://pubmed.ncbi.nlm.nih.gov/?term=%22Doe%20J%22[Author]">Doe J</a>
            <a href="https://pubmed.ncbi.nlm.nih.gov/?term=%22Roe%20J%22[Author]">Roe J</a>
            <a href="https://pubmed.ncbi.nlm.nih.gov/?term=%22Poe%20J%22[Author]">Poe J</a>
          </div>
          <ul class="d-buttons inline-list">
            <li><button>Author information</button></li>
            <li><button>Article notes</button></li>
            <li><button>Copyright and License information</button></li>
          </ul>
        </div>
      </section>`;
    expect(findReferenceSection(document)).toBeNull();
  });

  it('keeps every sibling reference block after the heading (Cambridge layout)', () => {
    document.body.innerHTML = `
      <div id="references-list" class="circle-list">
        <h2>References</h2>
        <div id="ref1" class="circle-list__item">
          <div class="circle-list__item__grouped__content">WHO &amp; FAO (2019) Sustainable healthy diets.</div>
        </div>
        <div id="ref2" class="circle-list__item">
          <div class="circle-list__item__grouped__content">Doe J (2021) A second work. <a href="https://doi.org/10.1234/second">link</a></div>
        </div>
      </div>`;
    const citations = extractReferenceDois(findReferenceSection(document)!);
    expect(citations).toHaveLength(2);
    expect(citations[1].doi).toBe('10.1234/second');
  });

  it('ignores a "References" heading that labels a sidebar tab (Wiley layout)', () => {
    document.body.innerHTML = `
      <article>
        <ul class="tab__nav">
          <li><a role="tab" href="#pane-figures"><h2>Figures</h2></a></li>
          <li><a role="tab" href="#pane-references"><h2>References</h2></a></li>
        </ul>
        <ul><li>MCM</li><li>mixture cure model</li></ul>
        <section class="article-section article-section__references">
          <h2><div role="button">References</div></h2>
          <div>
            <ul>
              <li data-bib-id="bib-1">Doe J. First reference. <a href="https://doi.org/10.1234/first">link</a></li>
              <li data-bib-id="bib-2">Roe J. Identifierless reference.</li>
            </ul>
          </div>
        </section>
      </article>`;
    const section = findReferenceSection(document);
    expect(section?.className).toBe('article-section article-section__references');
    const citations = extractReferenceDois(section!);
    expect(citations.map((citation) => citation.referenceText)).toEqual([
      'Doe J. First reference. link',
      'Roe J. Identifierless reference.',
    ]);
    expect(citations[0].doi).toBe('10.1234/first');
  });

  it('ignores article content before a standalone References heading', () => {
    document.body.innerHTML = `
      <article>
        <ul><li>Unrelated article navigation</li></ul>
        <h2>References</h2>
        <p>Doe J. First reference. doi:10.1234/first</p>
        <p>Roe J. Identifierless reference.</p>
        <p>Poe J. Third reference. doi:10.1234/third</p>
      </article>`;
    const citations = extractReferenceDois(findReferenceSection(document)!);
    expect(citations.map((citation) => citation.referenceText)).toEqual([
      'Doe J. First reference. doi:10.1234/first',
      'Roe J. Identifierless reference.',
      'Poe J. Third reference. doi:10.1234/third',
    ]);
  });

  it('prefers structured references over introductory prose after the heading', () => {
    document.body.innerHTML = `
      <article>
        <h2>References</h2>
        <p>The following works informed this analysis.</p>
        <ol>
          <li>Doe J. First reference. doi:10.1234/first</li>
          <li>Roe J. Identifierless reference.</li>
        </ol>
      </article>`;
    const citations = extractReferenceDois(findReferenceSection(document)!);
    expect(citations.map((citation) => citation.referenceText)).toEqual([
      'Doe J. First reference. doi:10.1234/first',
      'Roe J. Identifierless reference.',
    ]);
  });

  it('stops heading fallback before related post-reference lists', () => {
    document.body.innerHTML = `
      <article>
        <h2>References</h2>
        <p>Doe J. First reference. doi:10.1234/first</p>
        <p>Roe J. Identifierless reference.</p>
        <footer class="related-content">
          <ul><li>Read another article</li></ul>
        </footer>
      </article>`;
    const citations = extractReferenceDois(findReferenceSection(document)!);
    expect(citations.map((citation) => citation.referenceText)).toEqual([
      'Doe J. First reference. doi:10.1234/first',
      'Roe J. Identifierless reference.',
    ]);
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

  it('falls back to the DOI-bearing list when no known selector or heading matches', () => {
    document.body.innerHTML = `
      <main>
        <div class="bib-wrapper">
          <ol class="publisher-specific-list">
            <li>Doe J. First. <a href="https://doi.org/10.1234/one">link</a></li>
            <li>Roe J. Second. doi:10.1234/two</li>
            <li>Poe J. Third. doi:10.1234/three</li>
          </ol>
        </div>
      </main>`;
    const section = findReferenceSection(document);
    expect(section?.tagName).toBe('OL');
    expect(extractReferenceDois(section!)).toHaveLength(3);
  });

  it('ignores a related-articles sidebar in the content fallback', () => {
    document.body.innerHTML = `
      <main>
        <aside class="recommended">
          <ul>
            <li><a href="https://doi.org/10.1234/aside-one">a</a></li>
            <li><a href="https://doi.org/10.1234/aside-two">b</a></li>
            <li><a href="https://doi.org/10.1234/aside-three">c</a></li>
          </ul>
        </aside>
        <p>Prose that mentions doi:10.1234/inline once.</p>
      </main>`;
    expect(findReferenceSection(document)).toBeNull();
  });

  it('does not let an excluded sidebar qualify its neutral wrapper', () => {
    document.body.innerHTML = `
      <main>
        <div class="content-shell">
          <aside>
            <div><a href="https://doi.org/10.1234/aside-one">a</a></div>
            <div><a href="https://doi.org/10.1234/aside-two">b</a></div>
            <div><a href="https://doi.org/10.1234/aside-three">c</a></div>
          </aside>
          <p>Ordinary article prose.</p>
        </div>
      </main>`;
    expect(findReferenceSection(document)).toBeNull();
  });

  it('finds fallback references without descendant-wide element queries', () => {
    document.body.innerHTML = `
      <main>
        <div class="outer">
          <div class="tight-list">
            <p>First doi:10.1234/linear-one</p>
            <p>Second doi:10.1234/linear-two</p>
            <p>Third doi:10.1234/linear-three</p>
          </div>
        </div>
      </main>`;
    const querySelectorAll = vi.spyOn(Element.prototype, 'querySelectorAll');
    expect(findReferenceSection(document)?.className).toBe('tight-list');
    expect(querySelectorAll).not.toHaveBeenCalled();
  });
});

describe('extractReferenceDois', () => {
  it('keeps classless div references separate', () => {
    document.body.innerHTML = `
      <main>
        <div>
          <div>First reference. doi:10.1234/alpha</div>
          <div>Second reference. doi:10.1234/beta</div>
          <div>Third reference. doi:10.1234/gamma</div>
        </div>
      </main>`;
    const citations = extractReferenceDois(findReferenceSection(document)!);
    expect(citations.map((citation) => citation.doi)).toEqual([
      '10.1234/alpha',
      '10.1234/beta',
      '10.1234/gamma',
    ]);
  });

  it('keeps classless references linear in a hostile deep div tree', () => {
    const section = document.createElement('section');
    section.setAttribute('role', 'doc-bibliography');
    let container: HTMLElement = section;
    for (let index = 0; index < 500; index += 1) {
      const nested = document.createElement('div');
      container.append(nested);
      container = nested;
    }
    for (const doi of ['10.1234/deep-one', '10.1234/deep-two', '10.1234/deep-three']) {
      const reference = document.createElement('div');
      reference.textContent = `Reference doi:${doi}`;
      container.append(reference);
    }
    document.body.append(section);
    const textContent = vi.spyOn(Node.prototype, 'textContent', 'get');

    const citations = extractReferenceDois(section);

    expect(citations.map((citation) => citation.doi)).toEqual([
      '10.1234/deep-one',
      '10.1234/deep-two',
      '10.1234/deep-three',
    ]);
    expect(textContent.mock.calls.length).toBeLessThan(50);
  });

  it('does not use generic author name microdata as a citation title', () => {
    document.body.innerHTML = `
      <ol class="references">
        <li>
          <span itemprop="author" itemscope itemtype="https://schema.org/Person">
            <span itemprop="name">Jean-Baptiste van der Berg</span>
          </span>
          <span itemprop="name">Actual Real Article Title</span>
          doi:10.1234/microdata
        </li>
      </ol>`;
    const [citation] = extractReferenceDois(findReferenceSection(document)!);
    expect(citation.title).toBeUndefined();
  });

  it('uses explicit schema.org headline microdata as a citation title', () => {
    document.body.innerHTML = `
      <ol class="references">
        <li><span itemprop="headline">Actual Real Article Title</span> doi:10.1234/title</li>
      </ol>`;
    const [citation] = extractReferenceDois(findReferenceSection(document)!);
    expect(citation.title).toBe('Actual Real Article Title');
  });

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

  it('uses a visible DOI when a doi.org link has no parseable DOI', () => {
    document.body.innerHTML =
      '<ol class="references"><li>Smith J. doi:10.5555/fallback123 <a href="https://doi.org/about">DOI information</a></li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations[0].doi).toBe('10.5555/fallback123');
  });

  it('keeps repeated DOI occurrences as separate references', () => {
    document.body.innerHTML = `
      <ol class="references">
        <li><a href="https://doi.org/10.1234/dup">a</a></li>
        <li>also doi:10.1234/dup</li>
      </ol>`;
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.filter((c) => c.doi === '10.1234/dup')).toHaveLength(2);
  });

  it('keeps outer bibliography entries when they contain nested action lists', () => {
    document.body.innerHTML = `
      <ol class="references">
        <li id="outer-one">
          Doe J. A study. doi:10.1234/outer
          <ul><li>View article</li><li>Export citation</li></ul>
        </li>
        <li id="outer-two">Roe J. Identifierless reference.</li>
      </ol>`;
    const citations = extractReferenceDois(findReferenceSection(document)!);
    expect(citations.map((citation) => citation.element.id)).toEqual(['outer-one', 'outer-two']);
    expect(citations[0].doi).toBe('10.1234/outer');
  });

  it('does not duplicate a DOI repeated inside one reference', () => {
    document.body.innerHTML = `
      <ol class="references">
        <li><a href="https://doi.org/10.1234/dup">10.1234/dup</a></li>
      </ol>`;
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.filter((c) => c.doi === '10.1234/dup')).toHaveLength(1);
  });

  it('returns identifierless entries so coverage is explicit', () => {
    document.body.innerHTML = `
      <ol class="references">
        <li>Doe J. Identified work. <a href="https://doi.org/10.1234/one">DOI</a></li>
        <li>Roe J. Older book chapter without a persistent identifier.</li>
        <li>Poe J. PubMed work. PMID: 12345678</li>
      </ol>`;
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations).toHaveLength(3);
    const identifierless = citations.find((c) => !c.doi && !c.pmid);
    expect(identifierless?.referenceText).toContain('Older book chapter');
  });

  it('recognizes ARIA list items used by publisher reference widgets', () => {
    document.body.innerHTML = `
      <div role="doc-bibliography">
        <div role="listitem">First reference. doi:10.1234/one</div>
        <div role="listitem">Second reference without an identifier.</div>
      </div>`;
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations).toHaveLength(2);
    expect(citations[1].referenceText).toContain('Second reference');
  });

  it('excludes extension badges from reference text on a rescan', () => {
    document.body.innerHTML = `
      <ol class="references">
        <li>
          Reference text.
          <span class="citicious-badge">NOT CHECKED</span>
          <a href="https://doi.org/10.1234/lazy">DOI</a>
        </li>
      </ol>`;
    const citations = extractReferenceDois(findReferenceSection(document)!);
    expect(citations[0].referenceText).toContain('Reference text');
    expect(citations[0].referenceText).not.toContain('NOT CHECKED');
  });

  it('matches the 2025-06-01 archived SAGE bibliography for 10.1177/00491241221099552', () => {
    const archivedDois = [
      '10.1515/9781400829828',
      '10.1080/01621459.1996.10476902',
      '10.1080/01621459.1997.10474074',
      '10.1097/ede.0b013e31828c776c',
      '10.1073/pnas.1510507113',
      '10.1093/jas/sky277',
      '10.3386/t0343',
      '10.1093/esr/jcy037',
      '10.2139/ssrn.3588978',
      '10.1111/rssb.12348',
      '10.2307/j.ctv1c29t27',
      '10.1515/jci-2013-0021',
      '10.1002/sim.6973',
      '10.1146/annurev-soc-071913-043455',
      '10.1097/aln.0000000000003193',
      '10.1017/9781139161879',
      '10.1097/00001648-199901000-00008',
      '10.1038/s41467-020-19478-2',
      '10.1162/003465304323023688',
      '10.1111/rssb.12451',
      '10.1093/aje/kwj275',
      '10.1017/cbo9781139025751',
      '10.18637/jss.v047.i11',
      '10.1111/1467-9868.00381',
      '10.1093/pan/mpw015',
      '10.1093/biomet/82.4.669',
      '10.1093/aje/kwr352',
      '10.1515/jci-2013-0003',
      '10.1515/jci-2015-0004',
      '10.1214/09-ss057',
      '10.2307/2981697',
      '10.1007/978-1-4757-3692-2',
      '10.1002/sim.3565',
      '10.1016/j.eeh.2020.101356',
      '10.1002/sim.3554',
      '10.1002/sim.3532',
      '10.1515/jci-2016-0009',
      '10.18637/jss.v076.i12',
      '10.1162/rest_a_00153',
      '10.1017/s0266466605050516',
    ];
    const archivedPmids = ['34305477', '28089956'];
    const doiEntries = archivedDois.map(
      (doi) =>
        `<div role="listitem"><div class="citations"><div class="citation"><a href="https://doi.org/${doi}">${doi}</a></div></div></div>`
    );
    const pmidEntries = archivedPmids.map(
      (pmid) =>
        `<div role="listitem"><div class="citations"><div class="citation"><a href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/">PubMed</a></div></div></div>`
    );
    const identifierlessEntries = Array.from(
      { length: 34 },
      (_, index) =>
        `<div role="listitem"><div class="citations"><div class="citation">Identifierless reference ${index + 1}</div></div></div>`
    );
    document.body.innerHTML = `
      <section id="bibliography" role="doc-bibliography">
        <h2>References</h2>
        <div role="list">${[...doiEntries, ...pmidEntries, ...identifierlessEntries].join('')}</div>
      </section>`;
    const citations = extractReferenceDois(findReferenceSection(document)!);
    expect(citations).toHaveLength(76);
    expect(citations.filter((citation) => citation.doi).map((citation) => citation.doi)).toEqual(
      archivedDois
    );
    expect(
      citations.filter((citation) => citation.pmid && !citation.doi).map((citation) => citation.pmid)
    ).toEqual(archivedPmids);
    expect(citations.filter((citation) => !citation.doi && !citation.pmid)).toHaveLength(34);
  });

  it('stops extracting before cloning entries beyond the requested allowance', () => {
    document.body.innerHTML = `<section role="doc-bibliography">${Array.from(
      { length: 503 },
      (_, index) =>
        `<div role="listitem">Doe J. Synthetic reference number ${index + 1}. J Test. 2020.</div>`
    ).join('')}</section>`;
    const cloneNode = vi.spyOn(Element.prototype, 'cloneNode');
    const citations = extractReferenceDois(findReferenceSection(document)!, 101);
    expect(citations).toHaveLength(101);
    expect(cloneNode).toHaveBeenCalledTimes(101);
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

  it('extracts DOIs from percent-encoded doi.org links (Springer style)', () => {
    document.body.innerHTML =
      '<ol class="references"><li>Fitzmaurice C, et al. Global cancer burden. <a href="https://doi.org/10.1001%2Fjamaoncol.2016.5688">Article</a></li></ol>';
    const section = findReferenceSection(document)!;
    const citations = extractReferenceDois(section);
    expect(citations.map((c) => c.doi)).toContain('10.1001/jamaoncol.2016.5688');
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
  it('returns the current article plus every reference occurrence', () => {
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

  it('keeps a reference even when it repeats the current article DOI', () => {
    document.head.innerHTML = '<meta name="citation_doi" content="10.1000/current">';
    document.body.innerHTML = `
      <ol class="references">
        <li><a href="https://doi.org/10.1000/current">same DOI in bibliography</a></li>
      </ol>`;
    const citations = scanPageForDois(document);
    expect(citations.filter((c) => c.doi === '10.1000/current')).toHaveLength(2);
  });
});
