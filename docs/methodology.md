# Methodology

The lab converts private VPN infrastructure observations into public aggregate indicators. Non-VPN sources such as unattributed proxy data, Tor, and iCloud Private Relay are excluded from the public scoring layer.

## Provider Fingerprints

Provider fingerprints summarize breadth, concentration, hosting usage, geography, and confidence at provider level. The dataset does not expose raw endpoint identifiers.

## Geo Truth Score

Geo truth is a conservative signal for whether a provider's observed geography appears broad, stable, and plausible. It includes an aggregate country-match check against the private `geo.mmdb` database. It is not a claim that provider marketing is correct or incorrect.

## Provider Independence

The independence index estimates whether a provider appears to operate a diverse infrastructure footprint or depends heavily on narrow/shared hosting patterns. It is an infrastructure signal, not a legal ownership claim, accusation, or provider verdict.

## Virtual Location Pressure

Country-level pressure compares provider diversity with hosting concentration and city precision. Higher values indicate countries where observed VPN infrastructure appears more dependent on concentrated or remote hosting patterns.

## Hosting Dependency

Hosting dependency is published as anonymized clusters. The dashboard may show provider and country examples observed in a cluster, but it does not name the hosting operator or publish endpoint data.
