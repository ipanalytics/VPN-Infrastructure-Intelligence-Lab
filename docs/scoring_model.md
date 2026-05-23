# Scoring Model

Scores are normalized to `0.00`-`1.00`.

- `country_spread_score`: normalized country diversity.
- `hosting_diversity_score`: normalized ASN/hosting diversity.
- `shared_infra_score`: concentration signal derived from provider footprint concentration.
- `mmdb_country_match_rate`: aggregate share of observations where the source country matches the private `geo.mmdb` country.
- `geo_truth_score`: blend of country spread, city precision, hosting diversity, MMDB country match rate, and confidence.
- `independence_score`: blend of hosting diversity, geography, and low concentration.
- `virtual_location_pressure`: country-level concentration, hosting dependency, city-precision, and MMDB mismatch pressure signal.

Grades:

- `A`: highly independent infrastructure pattern
- `B`: mostly independent pattern
- `C`: mixed dependency pattern
- `D`: highly concentrated or reseller-like pattern
