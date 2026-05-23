# Data Safety

The public repository is intentionally built from aggregate outputs only.

## Private Inputs

Private raw inputs live under `internal/` and are ignored by git. They may include raw endpoint observations, MMDB files, provider health snapshots, and other operational context used for local analysis.

## Public Boundary

Public files may include provider-level, country-level, archetype-level, ASN/operator-level, and anonymized hosting-cluster-level summaries. Public files must not include raw IP addresses, CIDR ranges, endpoint inventories, provider node lists, or MMDB databases.

The public scoring layer includes only VPN rows. Unattributed proxy data, Tor, and iCloud Private Relay are filtered out before aggregate datasets are written.

## Validation

Public-output validation:

```bash
python3 scripts/validate_outputs.py
```

The validator checks public CSV/JSON/HTML/JS/CSS/Markdown files for common raw infrastructure leakage patterns and fails when forbidden column names or IP-like values appear.
