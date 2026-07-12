// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  injectTopBanner,
  injectBadge,
  injectReferencesBanner,
  removeAllBadges,
} from '../badge-injector';
import type { RetractionDetails } from '../../../shared/types';

const details = (overrides: Partial<RetractionDetails> = {}): RetractionDetails => ({
  recordId: null,
  title: 'A Retracted Paper',
  journal: 'Journal of Examples',
  publisher: null,
  authors: [],
  retractionDate: null,
  retractionNature: 'Retraction',
  reason: [],
  retractionNoticeUrl: 'https://doi.org/10.1234/notice',
  originalPaperDate: null,
  source: 'retraction-watch',
  ...overrides,
});

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.marginTop = '';
  removeAllBadges();
});

// jsdom has no layout, so offsetHeight is always 0; give banners a height so
// the body push-down math is observable.
function withBannerHeight(fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return 48;
    },
  });
  try {
    fn();
  } finally {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
    }
  }
}

describe('injectTopBanner', () => {
  it('inserts a banner as the first body child and pushes content down', () => {
    document.body.innerHTML = '<main>content</main>';
    const banner = injectTopBanner('retracted', details());
    expect(banner).not.toBeNull();
    expect(document.body.firstElementChild?.id).toBe('citicious-top-banner');
    expect(document.body.style.marginTop).not.toBe('');
  });

  it('renders an accessible alert with brand, title, notice link, and attribution', () => {
    const banner = injectTopBanner('retracted', details())!;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.querySelector('.citicious-banner__brand')?.textContent).toBe('Citicious');
    expect(banner.querySelector('.citicious-banner__title')?.textContent).toBe('Retracted article');
    const link = banner.querySelector('.citicious-banner__link') as HTMLAnchorElement;
    expect(link.href).toContain('doi.org/10.1234/notice');
    expect(link.rel).toContain('noopener');
    expect(banner.querySelector('.citicious-banner__source')?.textContent).toContain('Retraction Watch');
    expect(banner.querySelector('.citicious-banner__close')?.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders no link for a non-http notice URL', () => {
    const banner = injectTopBanner(
      'retracted',
      details({ retractionNoticeUrl: 'javascript:alert(1)' })
    )!;
    expect(banner.querySelector('.citicious-banner__link')).toBeNull();
  });

  it('injects nothing for verified status', () => {
    expect(injectTopBanner('verified')).toBeNull();
    expect(document.getElementById('citicious-top-banner')).toBeNull();
  });

  it('restores the site-defined body margin when dismissed', () => {
    withBannerHeight(() => {
      document.body.style.marginTop = '17px';
      const banner = injectTopBanner('retracted', details())!;
      expect(document.body.style.marginTop).toBe('65px');
      (banner.querySelector('.citicious-banner__close') as HTMLButtonElement).click();
      expect(document.body.style.marginTop).toBe('17px');
    });
  });
});

describe('injectReferencesBanner', () => {
  it('restores the site-defined body margin when dismissed', () => {
    withBannerHeight(() => {
      document.body.style.marginTop = '9px';
      const banner = injectReferencesBanner({
        retracted: 1,
        notFound: 2,
        mismatch: 0,
        concern: 0,
        correction: 0,
      })!;
      expect(document.body.style.marginTop).toBe('57px');
      (banner.querySelector('.citicious-banner__close') as HTMLButtonElement).click();
      expect(document.body.style.marginTop).toBe('9px');
    });
  });

  it('renders per-severity chips and an accent for the highest severity', () => {
    const banner = injectReferencesBanner({
      retracted: 2,
      notFound: 0,
      mismatch: 1,
      concern: 0,
      correction: 3,
    })!;
    expect(banner.className).toContain('citicious-banner--summary-retracted');
    const chips = [...banner.querySelectorAll('.citicious-banner__chip')];
    expect(chips.map((c) => c.textContent)).toEqual([
      '2 retracted',
      '1 title mismatch',
      '3 corrections',
    ]);
    expect(chips[0].className).toContain('citicious-banner__chip--red');
    expect(chips[1].className).toContain('citicious-banner__chip--amber');
    expect(chips[2].className).toContain('citicious-banner__chip--yellow');
  });

  it('returns null when there is nothing to report', () => {
    expect(
      injectReferencesBanner({ retracted: 0, notFound: 0, mismatch: 0, concern: 0, correction: 0 })
    ).toBeNull();
  });

  it('renders chips as buttons that report their category when clicked', () => {
    const clicked: string[] = [];
    const banner = injectReferencesBanner(
      { retracted: 1, notFound: 0, mismatch: 0, concern: 0, correction: 2 },
      (category) => clicked.push(category)
    )!;
    const chips = [...banner.querySelectorAll('.citicious-banner__chip')];
    expect(chips.every((c) => c.tagName === 'BUTTON')).toBe(true);
    (chips[0] as HTMLButtonElement).click();
    (chips[1] as HTMLButtonElement).click();
    expect(clicked).toEqual(['retracted', 'correction']);
  });

  it('renders chips as plain spans without a click handler', () => {
    const banner = injectReferencesBanner({
      retracted: 1,
      notFound: 0,
      mismatch: 0,
      concern: 0,
      correction: 0,
    })!;
    expect(banner.querySelector('.citicious-banner__chip')?.tagName).toBe('SPAN');
  });
});

describe('injectBadge tooltips', () => {
  it('omits reason text when the reason list is empty', () => {
    document.body.innerHTML = '<li id="ref">Some reference</li>';
    const el = document.getElementById('ref') as HTMLElement;
    const badge = injectBadge(el, 'retracted', details({ reason: [] }))!;
    expect(badge.title).toBe('This article has been retracted');
    expect(badge.title).not.toContain('Unknown');
  });

  it('includes reasons when present', () => {
    document.body.innerHTML = '<li id="ref">Some reference</li>';
    const el = document.getElementById('ref') as HTMLElement;
    const badge = injectBadge(el, 'retracted', details({ reason: ['Data fabrication'] }))!;
    expect(badge.title).toContain('Data fabrication');
  });

  it('labels an unregistered DOI as not found rather than fake', () => {
    document.body.innerHTML = '<li id="ref">Some reference</li>';
    const el = document.getElementById('ref') as HTMLElement;
    const badge = injectBadge(el, 'fake-likely')!;
    expect(badge.querySelector('.citicious-badge__label')?.textContent).toBe('DOI NOT FOUND');
  });
});

describe('removeAllBadges', () => {
  it('removes badges and banners and restores the margin', () => {
    document.body.style.marginTop = '5px';
    document.body.innerHTML = '<li id="ref">Some reference</li>';
    document.body.style.marginTop = '5px';
    const el = document.getElementById('ref') as HTMLElement;
    injectBadge(el, 'retracted', details());
    injectTopBanner('retracted', details());
    removeAllBadges();
    expect(document.querySelectorAll('.citicious-badge, .citicious-banner')).toHaveLength(0);
    expect(document.body.style.marginTop).toBe('5px');
  });
});
