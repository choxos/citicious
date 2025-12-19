import type { CitationStatus, RetractionDetails, Discrepancy } from '../../shared/types';

// Badge configuration per status
const BADGE_CONFIG: Record<CitationStatus, { icon: string; label: string; className: string }> = {
  retracted: { icon: '⚠️', label: 'RETRACTED', className: 'citicious-badge--retracted' },
  fake: { icon: '❌', label: 'FAKE', className: 'citicious-badge--fake' },
  suspicious: { icon: '❓', label: 'SUSPICIOUS', className: 'citicious-badge--suspicious' },
  verified: { icon: '✓', label: 'Verified', className: 'citicious-badge--verified' },
  checking: { icon: '⟳', label: 'Checking...', className: 'citicious-badge--checking' },
  unknown: { icon: '?', label: 'Unknown', className: 'citicious-badge--unknown' },
};

/**
 * Create and inject a top banner for retracted articles
 */
export function injectTopBanner(
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[]
): HTMLElement {
  // Remove existing banner if any
  const existingBanner = document.getElementById('citicious-top-banner');
  if (existingBanner) {
    existingBanner.remove();
  }

  const banner = document.createElement('div');
  banner.id = 'citicious-top-banner';
  banner.className = `citicious-banner citicious-banner--${status}`;

  let content = '';

  if (status === 'retracted') {
    content = `
      <div class="citicious-banner__icon">⚠️</div>
      <div class="citicious-banner__content">
        <div class="citicious-banner__title">This article has been RETRACTED</div>
        <div class="citicious-banner__details">
          ${details?.retractionNature ? `<span class="citicious-banner__nature">${details.retractionNature}</span>` : ''}
          ${details?.retractionDate ? `<span class="citicious-banner__date">Retracted: ${new Date(details.retractionDate).toLocaleDateString()}</span>` : ''}
          ${details?.reason?.length ? `<span class="citicious-banner__reason">Reason: ${details.reason.slice(0, 2).join(', ')}</span>` : ''}
        </div>
        ${details?.retractionNoticeUrl ? `<a href="${details.retractionNoticeUrl}" target="_blank" class="citicious-banner__link">View retraction notice →</a>` : ''}
      </div>
      <button class="citicious-banner__close" aria-label="Dismiss banner">×</button>
    `;
  } else if (status === 'fake') {
    content = `
      <div class="citicious-banner__icon">❌</div>
      <div class="citicious-banner__content">
        <div class="citicious-banner__title">This citation may be FAKE or hallucinated</div>
        <div class="citicious-banner__details">
          ${discrepancies?.length ? `<span class="citicious-banner__reason">Issues found: ${discrepancies.map(d => d.field).join(', ')}</span>` : 'Could not verify this citation in academic databases.'}
        </div>
      </div>
      <button class="citicious-banner__close" aria-label="Dismiss banner">×</button>
    `;
  } else if (status === 'suspicious') {
    content = `
      <div class="citicious-banner__icon">❓</div>
      <div class="citicious-banner__content">
        <div class="citicious-banner__title">This citation has suspicious discrepancies</div>
        <div class="citicious-banner__details">
          ${discrepancies?.map(d => `<span class="citicious-banner__discrepancy">${d.field}: "${d.provided}" vs "${d.actual}"</span>`).join(' ') || ''}
        </div>
      </div>
      <button class="citicious-banner__close" aria-label="Dismiss banner">×</button>
    `;
  }

  banner.innerHTML = content;

  // Add close button handler
  const closeBtn = banner.querySelector('.citicious-banner__close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.classList.add('citicious-banner--hidden');
      setTimeout(() => banner.remove(), 300);
    });
  }

  // Insert at top of body
  document.body.insertBefore(banner, document.body.firstChild);

  // Add body padding to prevent content overlap
  document.body.style.marginTop = `${banner.offsetHeight}px`;

  return banner;
}

/**
 * Inject a badge next to a citation element
 */
export function injectBadge(
  element: HTMLElement,
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[],
  onClick?: () => void
): HTMLElement {
  // Remove existing badge if any
  const existingBadge = element.querySelector('.citicious-badge');
  if (existingBadge) {
    existingBadge.remove();
  }

  const config = BADGE_CONFIG[status];
  const badge = document.createElement('span');
  badge.className = `citicious-badge ${config.className}`;
  badge.setAttribute('data-citicious-status', status);

  badge.innerHTML = `
    <span class="citicious-badge__icon">${config.icon}</span>
    <span class="citicious-badge__label">${config.label}</span>
  `;

  // Add tooltip with details
  if (status === 'retracted' && details) {
    badge.title = `Retracted: ${details.reason?.join(', ') || 'Unknown reason'}`;
  } else if (status === 'fake') {
    badge.title = 'This citation could not be verified in academic databases';
  } else if (status === 'suspicious' && discrepancies?.length) {
    badge.title = `Discrepancies found: ${discrepancies.map(d => `${d.field}`).join(', ')}`;
  } else if (status === 'verified') {
    badge.title = 'Citation verified in academic databases';
  }

  // Add click handler
  if (onClick) {
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
  }

  // Insert after the element (or at the end if it's a block element)
  if (element.tagName === 'LI' || element.tagName === 'P' || element.tagName === 'DIV') {
    // For block elements, prepend the badge
    element.insertBefore(badge, element.firstChild);
  } else {
    // For inline elements, insert after
    element.insertAdjacentElement('afterend', badge);
  }

  return badge;
}

/**
 * Update an existing badge's status
 */
export function updateBadge(
  element: HTMLElement,
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[]
): void {
  const existingBadge = element.querySelector('.citicious-badge') as HTMLElement;
  if (!existingBadge) return;

  const config = BADGE_CONFIG[status];

  // Update classes
  existingBadge.className = `citicious-badge ${config.className}`;
  existingBadge.setAttribute('data-citicious-status', status);

  // Update content
  existingBadge.innerHTML = `
    <span class="citicious-badge__icon">${config.icon}</span>
    <span class="citicious-badge__label">${config.label}</span>
  `;

  // Update tooltip
  if (status === 'retracted' && details) {
    existingBadge.title = `Retracted: ${details.reason?.join(', ') || 'Unknown reason'}`;
  } else if (status === 'fake') {
    existingBadge.title = 'This citation could not be verified';
  } else if (status === 'suspicious' && discrepancies?.length) {
    existingBadge.title = `Discrepancies: ${discrepancies.map(d => d.field).join(', ')}`;
  }
}

/**
 * Remove all Citicious badges from the page
 */
export function removeAllBadges(): void {
  document.querySelectorAll('.citicious-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.citicious-banner').forEach((banner) => banner.remove());
  document.body.style.marginTop = '';
}

/**
 * Get the status icon for use in sidebar
 */
export function getStatusIcon(status: CitationStatus): string {
  return BADGE_CONFIG[status]?.icon || '?';
}
