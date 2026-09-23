# Citicious

> Detect retracted articles and fake/hallucinated citations in scientific papers

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Citicious is a Chrome extension that helps researchers and readers identify:

- **Retracted articles** - Papers that have been formally retracted by journals
- **Retracted citations** - References in a paper that cite retracted articles
- **Fake citations** - Potentially hallucinated citations (e.g., from LLM-generated content)

## Features

- **Top Banner Alert** - Prominent warning when viewing a retracted article
- **Inline Badges** - A status beside each of up to 500 recognized bibliography entries, including entries that cannot be checked
- **Sidebar Panel** - Reference coverage and detailed results for the current page
- **Manual DOI Check** - Check any DOI directly from the popup
- **Broad Publisher Support** - Activates on pages carrying supported academic signals across publisher and repository sites

## How It Works

1. **Retraction Detection**: Checks both the [Retraction Watch Database](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/) signals exposed through Crossref and OpenAlex's `is_retracted` flag for every DOI. Expressions of concern and corrections are surfaced separately from full retractions.
2. **Citation Validation**: Verifies citations against the CrossRef and OpenAlex APIs.
3. **Fake Detection**: Flags a DOI as fake only when it is absent from CrossRef and OpenAlex **and** fails to resolve against the [DOI Handle System](https://www.doi.org/) (`doi.org`). A registered DOI that simply isn't indexed in scholarly databases (e.g. a dataset, software, or thesis) is shown as **Unverified**, never as fake.
4. **Metadata Checks**: Compares the cited title against the authoritative record and flags significant mismatches conservatively (only on a confidently-extracted, critically dissimilar title).

Each scanned structured bibliography entry is represented. References with a DOI or PubMed ID are checked; entries without either identifier are labeled **Not checked** instead of being omitted or counted as verified. Failed network lookups are labeled **Check failed** and can be retried with Rescan.

To keep hostile or malformed pages from triggering unbounded work, Citicious scans at most 500 references per page load. The coverage display discloses unknown overflow when additional entries were **Not scanned**; it does not claim an exact total beyond the scan limit.

## Screenshot

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠️ This article has been RETRACTED                          │
│ Retraction · Retracted: Jan 15, 2024 · Reason: Plagiarism   │
│ View retraction notice →                                     │
└──────────────────────────────────────────────────────────────┘
```

## Installation

### From a Release Archive

The `.tar.gz` archive is for local installation and must be extracted first:

```bash
mkdir citicious-extension-v0.2.1
tar -xzf citicious-extension-v0.2.1.tar.gz -C citicious-extension-v0.2.1
```

Then open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the extracted directory. The `.zip` archive is the package to upload to the Chrome Web Store.

### From Source (Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/choxos/citicious.git
   cd citicious
   ```

2. Install dependencies and build the extension:
   ```bash
   cd extension
   npm ci
   npm run build
   ```

3. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist` folder

### Build Release Archives

```bash
cd extension
npm ci
npm run package
```

This creates `citicious-extension-v0.2.1.zip` for Chrome Web Store submission and `citicious-extension-v0.2.1.tar.gz` for local installation.

## Citation Status Types

| Status | Badge | Description |
|--------|-------|-------------|
| Retracted | ⚠️ RETRACTED | Article has been formally retracted |
| Concern | ⚠️ CONCERN | Expression of concern issued for the article |
| Correction | 📝 CORRECTION | Correction / erratum issued for the article |
| Not found | ❌ DOI NOT FOUND | DOI does not exist in any database and fails to resolve at doi.org; possible typo or fabricated reference |
| Mismatch | ⚠️ TITLE MISMATCH | DOI exists but the cited title critically mismatches the record |
| Verified | ✓ Verified | Citation confirmed valid and not retracted |
| Unverified | ℹ Unverified | DOI resolves at doi.org but is not indexed in CrossRef/OpenAlex, or a PubMed ID could not be confirmed in OpenAlex |
| Not checked | — NOT CHECKED | No DOI or PubMed ID was available for an authoritative lookup |
| Check failed | ⚠ CHECK FAILED | A public API lookup failed or timed out; rescan to retry |

## Tech Stack

- **Extension**: Chrome Manifest V3, TypeScript, Webpack
- **External APIs**: CrossRef, OpenAlex, doi.org (DOI resolver)

The shipped extension calls those public APIs directly. The `backend/` service is an optional development component and is not contacted by the extension.

## Data Sources

- [Retraction Watch Database](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/) - retracted articles, surfaced via CrossRef metadata
- [CrossRef API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) - DOI metadata and retraction notices
- [OpenAlex API](https://docs.openalex.org/) - Open catalog of scholarly works (also provides an `is_retracted` flag and PMID lookups)
- [DOI Handle System](https://www.doi.org/the-identifier/resources/factsheets/doi-system-and-the-handle-system) - authoritative existence check across all DOI registration agencies

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

**Ahmad Sofi-Mahmudi**

- GitHub: [@choxos](https://github.com/choxos)
- LinkedIn: [asofimahmudi](https://www.linkedin.com/in/asofimahmudi/)
- X/Twitter: [@ASofiMahmudi](https://x.com/ASofiMahmudi)

## Acknowledgments

- [Crossref](https://www.crossref.org/) for the Retraction Watch Database API
- [OpenAlex](https://openalex.org/) for the open scholarly metadata API
- [Retraction Watch](https://retractionwatch.com/) for their invaluable work in tracking retractions
