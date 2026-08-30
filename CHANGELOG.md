# Changelog

All notable changes to Citicious are documented in this file.

## 0.2.0 - 2026-08-30

### Added

- Explicit coverage for recognized structured bibliography entries, including visible **Not checked** results for references without a DOI or PubMed ID.
- PubMed ID extraction and OpenAlex validation alongside DOI checks.
- A sidebar coverage summary, overflow disclosure, retryable failure states, and improved popup status details.
- CI, dependency update automation, lockfiles, and broader extension test coverage.

### Changed

- Limited each page scan to 500 recognized references and deduplicated repeated identifiers before network lookup.
- Coalesced concurrent lookups, added bounded timeouts, and cached successful results locally for 24 hours.
- Merged Crossref and OpenAlex signals so retractions, expressions of concern, corrections, and metadata discrepancies are reported conservatively.
- Updated the optional backend with request limits, rate limiting, configurable CORS, safer error responses, and bounded upstream requests.

### Fixed

- Recognized bibliography entries are no longer silently omitted when they lack a supported identifier, including on SAGE journal pages.
- DOI existence checks now fall back to the DOI resolver before a citation can be labeled not found.
- Lazy and single-page application updates now trigger a bounded rescan without duplicating active work.

### Security

- Restricted extension network access to Crossref, OpenAlex, and doi.org.
- Added backend input caps, origin controls, rate limits, timeout handling, and error redaction.
