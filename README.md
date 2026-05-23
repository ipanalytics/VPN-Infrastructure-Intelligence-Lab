# VPN Infrastructure Intelligence Lab

Static research dashboard and aggregate datasets for VPN infrastructure analysis.

The public repository contains only derived CSV/JSON summaries, documentation, validation scripts, and the GitHub Pages dashboard. Raw observations, endpoint inventories, MMDB databases, and local analysis inputs are outside the published boundary.

## Public Scope

- VPN provider infrastructure fingerprints
- Provider independence and geo-truth signals
- Country-level virtual-location pressure metrics
- ASN and hosting footprint summaries
- Anonymized hosting dependency clusters
- Interactive static dashboard for GitHub Pages
- Methodology, scoring, interpretation, and data-safety notes

## Data Boundary

The public data layer is aggregate-only.

Excluded from public outputs:

- Raw VPN exit IP addresses
- Endpoint and node inventories
- CIDR/network range lists
- OpenVPN/WireGuard configuration files
- Real-time detection or blocklist feeds
- MMDB/source databases
- Non-VPN rows, including Tor, iCloud Private Relay, and unattributed proxy data

Scores are infrastructure research signals. They are not legal claims, ownership claims, abuse claims, blocklist decisions, or provider verdicts.

## Repository Layout

```text
.github/workflows/  GitHub Pages deployment workflow
dashboard/          Static dashboard application
data/               Public aggregate CSV/JSON datasets
docs/               Methodology and interpretation notes
scripts/            Dataset build and public-output validation scripts
README.md           Project overview
.nojekyll           GitHub Pages static-file marker
```

Local-only paths excluded from the public repository:

```text
internal/                  Private source material
external/                  Local source-repo cache
prompt.md                  Local project prompt/notes
dashboard/untitled folder/ Old local dashboard draft
*.mmdb, *.sqlite, *.db     Private databases
```

## Dashboard

The dashboard is a static site under `dashboard/`. It loads public datasets from `data/` and can be served by GitHub Pages from the repository root.

Primary entry point:

```text
dashboard/index.html
```

## Dataset Build

Public datasets are generated locally from private inputs:

```bash
python3 scripts/build_public_dataset.py
python3 scripts/validate_outputs.py
```

The validation script checks public files for raw infrastructure leakage patterns such as IP-like values, CIDR-like values, forbidden raw-data columns, and accidental public database files.

## Current Public Summary

The generated summary is available at:

```text
data/public_summary.json
```

The dashboard displays the active Atlas view separately from the full canonical provider set, because not every canonical VPN provider appears in every source layer.
