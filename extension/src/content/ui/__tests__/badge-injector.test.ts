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

describe('injectTopBanner', () => {
  it('inserts a banner as the first body child and pushes content down', () => {
    document.body.innerHTML = '<main>content</main>';
    const banner = injectTopBanner('retracted', details());
    expect(banner).not.toBeNull();
    expect(document.body.firstElementChild?.id).toBe('citicious-top-banner');
    expect(document.body.style.marginTop).not.toBe('');
  });

  it('injects nothing for verified status', () => {
    expect(injectTopBanner('verified')).toBeNull();
    expect(document.getElementById('citicious-top-banner')).toBeNull();
  });

  it('restores the site-defined body margin when dismissed', () => {
    document.body.style.marginTop = '17px';
    const banner = injectTopBanner('retracted', details())!;
    expect(document.body.style.marginTop).not.toBe('17px');
    (banner.querySelector('.citicious-banner__close') as HTMLButtonElement).click();
    expect(document.body.style.marginTop).toBe('17px');
  });
});

describe('injectReferencesBanner', () => {
  it('restores the site-defined body margin when dismissed', () => {
    document.body.style.marginTop = '9px';
    const banner = injectReferencesBanner(1, 2, 0)!;
    expect(document.body.style.marginTop).not.toBe('9px');
    (banner.querySelector('.citicious-banner__close') as HTMLButtonElement).click();
    expect(document.body.style.marginTop).toBe('9px');
  });

  it('returns null when there is nothing to report', () => {
    expect(injectReferencesBanner(0, 0, 0)).toBeNull();
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
