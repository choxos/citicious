# Citicious

> Detect retracted articles and fake/hallucinated citations in scientific papers

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Citicious is a Chrome extension that helps researchers and readers identify:

- **Retracted articles** - Papers that have been formally retracted by journals
- **Retracted citations** - References in a paper that cite retracted articles
- **Fake citations** - Potentially hallucinated citations (e.g., from LLM-generated content)

## Features

- **Top Banner Alert** - Prominent warning when viewing a retracted article
- **Inline Badges** - Visual indicators next to each reference
- **Sidebar Panel** - Detailed information about all citations on the page
- **Manual DOI Check** - Check any DOI directly from the popup
- **Works Everywhere** - Automatically activates on academic publisher websites

## How It Works

1. **Retraction Detection**: Uses the [Retraction Watch Database](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/) via the CrossRef API, and OpenAlex's `is_retracted` flag. Expressions of concern and corrections are surfaced separately from full retractions.
2. **Citation Validation**: Verifies citations against the CrossRef and OpenAlex APIs.
3. **Fake Detection**: Flags a DOI as fake only when it is absent from CrossRef and OpenAlex **and** fails to resolve against the [DOI Handle System](https://www.doi.org/) (`doi.org`). A registered DOI that simply isn't indexed in scholarly databases (e.g. a dataset, software, or thesis) is shown as **Unverified**, never as fake.
4. **Metadata Checks**: Compares the cited title against the authoritative record and flags significant mismatches conservatively (only on a confidently-extracted, critically dissimilar title).

## Screenshot

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠️ This article has been RETRACTED                          │
│ Retraction · Retracted: Jan 15, 2024 · Reason: Plagiarism   │
│ View retraction notice →                                     │
└──────────────────────────────────────────────────────────────┘
```

## Installation

### From Source (Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/choxos/citicious.git
   cd citicious
   ```

2. Install dependencies and build the extension:
   ```bash
   cd extension
   npm install
   npm run build
   ```

3. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist` folder

## Citation Status Types

| Status | Badge | Description |
|--------|-------|-------------|
| Retracted | ⚠️ RETRACTED | Article has been formally retracted |
| Concern | ⚠️ CONCERN | Expression of concern issued for the article |
| Correction | 📝 CORRECTION | Correction / erratum issued for the article |
| Not found | ❌ DOI NOT FOUND | DOI does not exist in any database and fails to resolve at doi.org; possible typo or fabricated reference |
| Mismatch | ⚠️ TITLE MISMATCH | DOI exists but the cited title critically mismatches the record |
| Verified | ✓ Verified | Citation confirmed valid and not retracted |
| Unverified | ℹ Unverified | DOI is registered (resolves at doi.org) but not indexed in CrossRef/OpenAlex |

## Tech Stack

- **Extension**: Chrome Manifest V3, TypeScript, Webpack
- **External APIs**: CrossRef, OpenAlex, doi.org (DOI resolver)

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
