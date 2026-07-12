# Chrome Web Store Submission Details

## Extension Name
Citicious

## Short Description (132 characters max)
Detect retracted scientific articles and potentially fake citations by validating DOIs against CrossRef and OpenAlex databases.

## Detailed Description
Citicious helps researchers, reviewers, and readers verify the integrity of scientific citations.

When you visit a page containing academic references, Citicious automatically extracts DOIs and validates them against CrossRef and OpenAlex, two of the largest public scholarly metadata databases.

What it detects:
- Retracted articles, expressions of concern, and corrections: surfaced from CrossRef retraction metadata (powered by the Retraction Watch Database) and the OpenAlex retraction flag
- Fake or hallucinated citations: DOIs that exist in no academic database and also fail to resolve at doi.org, which may indicate AI-generated or fabricated references
- Metadata mismatches: citations where the listed title critically differs from the actual publication record

To avoid false accusations, a DOI that is registered (resolves at doi.org) but is simply not indexed in scholarly databases (for example a dataset, software, or thesis) is labeled "Unverified" rather than fake.

How it works:
- A top banner warns you if the article you are currently reading has been retracted
- Inline badges appear next to each reference in the bibliography, showing its verification status
- A sidebar panel provides a detailed summary of all citations on the page
- A manual DOI checker in the popup lets you verify any DOI on demand

All processing happens locally in your browser. DOIs are sent only to public APIs (CrossRef, OpenAlex, and the doi.org resolver) for verification. No personal data is collected, stored, or shared.

Open source: https://github.com/choxos/citicious

## Category
Productivity

## Language
English

## Single Purpose Description (required by Chrome Web Store)
This extension validates scientific citations by checking DOIs against public academic databases to detect retracted or non-existent references.

## Permission Justifications

### sidePanel
Used to display a detailed sidebar panel showing the verification status of all citations found on the current page.

### storage
Used to cache DOI and PubMed ID validation results locally (with a 24-hour expiry) so the same identifiers are not re-queried from the public APIs on every page load. The cache holds DOIs/PMIDs, their public validation results, any metadata comparison outcome, and, when a reference title was read from the page for comparison, that publicly visible title; no personal data.

### Host Permissions
Network host permissions are limited to the three public API endpoints the extension queries to validate DOIs: `https://api.crossref.org/*`, `https://api.openalex.org/*`, and `https://doi.org/*`. Page access is granted separately through the content script match pattern below, so the extension can locate citations across publisher and repository domains.

### Content Script Matches (https://*/*)
The content script is declared for all HTTPS sites so it can automatically detect citations on any webpage that contains scientific references, since academic content appears across many different publisher, repository, and preprint domains. It activates only on pages that appear academic (known scholarly domains, a DOI in the URL, or scholarly citation meta tags). It reads only citation identifiers (DOIs and PubMed IDs) and reference titles for local comparison; no browsing history or personal data is collected, and nothing beyond the identifiers is transmitted.

## Privacy Policy URL
https://github.com/choxos/citicious/blob/main/PRIVACY_POLICY.md
