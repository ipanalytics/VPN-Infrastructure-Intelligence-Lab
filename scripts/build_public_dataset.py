#!/usr/bin/env python3
import csv
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import maxminddb


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "internal" / "raw" / "vpn.csv"
GEO_MMDB = ROOT / "internal" / "raw" / "geo.mmdb"
DATA = ROOT / "data"
EXTERNAL_OVERLAP = ROOT / "external" / "github" / "ipanalytics-vpn-overlap"
EXTERNAL_ASN = ROOT / "external" / "github" / "ipanalytics-asn-vpn"
EXTERNAL_ATLAS = ROOT / "external" / "github" / "ipanalytics-vpn-atlas"
EXCLUDED_PROVIDERS = {"Unattributed Proxy", "Tor", "iCloud Private Relay"}
PUBLIC_TYPE = "vpn"


COUNTRY_FALLBACKS = {
    "AC": "Ascension Island",
    "AN": "Netherlands Antilles",
    "AG": "Antigua and Barbuda",
    "BQ": "Caribbean Netherlands",
    "CW": "Curacao",
    "EU": "European Union",
    "IC": "Canary Islands",
    "SX": "Sint Maarten",
    "UK": "United Kingdom",
    "XK": "Kosovo",
}


def yes(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def bucket_count(value):
    value = int(value)
    if value < 50:
        return "lt-50"
    if value < 100:
        return "50-99"
    if value < 500:
        return "100-499"
    if value < 1000:
        return "500-999"
    if value < 5000:
        return "1k-4.9k"
    if value < 10000:
        return "5k-9.9k"
    return "10k-plus"


def level(value):
    if value >= 0.75:
        return "high"
    if value >= 0.45:
        return "medium"
    return "low"


def grade(score):
    if score >= 0.82:
        return "A"
    if score >= 0.65:
        return "B"
    if score >= 0.45:
        return "C"
    return "D"


def confidence_label(rows, avg_confidence):
    if rows >= 1000 and avg_confidence >= 70:
        return "high"
    if rows >= 100 and avg_confidence >= 50:
        return "medium"
    return "low"


def norm_log(value, maximum):
    if maximum <= 0:
        return 0.0
    return math.log1p(value) / math.log1p(maximum)


def rounded(value):
    return f"{max(0.0, min(1.0, value)):.2f}"


def country_name(code, mmdb_names):
    code = (code or "").upper()
    return mmdb_names.get(code) or COUNTRY_FALLBACKS.get(code) or code or "Unknown"


def load_country_names():
    names = dict(COUNTRY_FALLBACKS)
    iso_tab = Path("/usr/share/zoneinfo/iso3166.tab")
    if iso_tab.exists():
        for line in iso_tab.read_text(encoding="utf-8", errors="ignore").splitlines():
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t", 1)
            if len(parts) == 2:
                names[parts[0].upper()] = parts[1]
    return names


def mmdb_location(reader, ip):
    try:
        record = reader.get(ip)
    except Exception:
        return "", "", ""
    if not record:
        return "", "", ""
    location = record.get("location") or {}
    code = (location.get("country_code") or "").upper()
    name = location.get("country_name") or ""
    city = location.get("city_name") or ""
    return code, name, city


def archetype_for(row):
    if row["country_spread_score"] >= 0.75 and row["independence_score"] >= 0.75:
        return "global-premium-mesh"
    if row["hosting_concentration"] >= 0.75 and row["country_count"] <= 5:
        return "single-hosting-vpn"
    if row["shared_infra_score"] >= 0.70 and row["independence_score"] < 0.45:
        return "white-label-reseller-cluster"
    if row["geo_truth_score"] < 0.45 and row["country_count"] >= 10:
        return "virtual-location-heavy-provider"
    if row["hosting_ratio"] >= 0.80 and row["country_spread_score"] >= 0.45:
        return "multi-hosting-commercial-vpn"
    return "regional-datacenter-vpn"


def read_raw():
    if not RAW.exists():
        raise SystemExit(f"missing private input: {RAW}")
    if not GEO_MMDB.exists():
        raise SystemExit(f"missing private GeoIP input: {GEO_MMDB}")

    providers = defaultdict(lambda: {
        "rows": 0,
        "hosting": 0,
        "confidence_sum": 0.0,
        "countries": set(),
        "country_counts": Counter(),
        "cities": set(),
        "asns": set(),
        "asn_counts": Counter(),
        "country_match_rows": 0,
        "country_checked_rows": 0,
    })
    countries = defaultdict(lambda: {
        "rows": 0,
        "hosting": 0,
        "city_rows": 0,
        "providers": Counter(),
        "asns": set(),
        "asn_counts": Counter(),
        "country_match_rows": 0,
        "country_checked_rows": 0,
    })
    hosting = defaultdict(lambda: {
        "rows": 0,
        "providers": Counter(),
        "countries": Counter(),
    })
    mmdb_names = load_country_names()
    skipped = Counter()

    with maxminddb.open_database(str(GEO_MMDB)) as geo_reader:
        with RAW.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                provider = row.get("provider", "").strip() or "Unknown"
                type_name = row.get("type", "").strip().lower()
                if provider in EXCLUDED_PROVIDERS or type_name != PUBLIC_TYPE:
                    skipped[provider or type_name or "unknown"] += 1
                    continue

                ip = row.get("ip", "").strip()
                country = row.get("country", "").strip().upper()
                city = row.get("city", "").strip()
                asn_org = row.get("asn_org", "").strip()
                is_hosting = yes(row.get("is_hosting"))
                try:
                    conf = float(row.get("confidence") or 0)
                except ValueError:
                    conf = 0.0

                mmdb_country, mmdb_country_name, mmdb_city = mmdb_location(geo_reader, ip)
                if mmdb_country and mmdb_country_name:
                    mmdb_names[mmdb_country] = mmdb_country_name
                checked = bool(country and mmdb_country)
                matched = checked and country == mmdb_country
                city_value = city or mmdb_city

                p = providers[provider]
                p["rows"] += 1
                p["hosting"] += int(is_hosting)
                p["confidence_sum"] += conf
                p["country_checked_rows"] += int(checked)
                p["country_match_rows"] += int(matched)
                if country:
                    p["countries"].add(country)
                    p["country_counts"][country] += 1
                if city_value:
                    p["cities"].add(city_value)
                if asn_org:
                    p["asns"].add(asn_org)
                    p["asn_counts"][asn_org] += 1

                if country:
                    c = countries[country]
                    c["rows"] += 1
                    c["hosting"] += int(is_hosting)
                    c["providers"][provider] += 1
                    c["country_checked_rows"] += int(checked)
                    c["country_match_rows"] += int(matched)
                    if city_value:
                        c["city_rows"] += 1
                    if asn_org:
                        c["asns"].add(asn_org)
                        c["asn_counts"][asn_org] += 1

                if asn_org:
                    h = hosting[asn_org]
                    h["rows"] += 1
                    h["providers"][provider] += 1
                    if country:
                        h["countries"][country] += 1

    return providers, countries, hosting, mmdb_names, skipped


def read_external_csv(path):
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def provider_lookup(allowed_providers):
    lower_counts = Counter(provider.lower() for provider in allowed_providers)
    lookup = {
        "exact": set(allowed_providers),
        "lower": {
            provider.lower(): provider
            for provider in allowed_providers
            if lower_counts[provider.lower()] == 1
        },
    }
    lookup["lower"].update({
        "keepsolid vpn unlimited": "VPN Unlimited",
        "ovpn": "OVPN",
        "purevpn": "PureVPN",
        "slickvpn": "SlickVPN",
        "vpnsecure": "VPNSecure",
    })
    return lookup


def canonical_provider(name, lookup):
    clean = (name or "").strip()
    if clean in lookup["exact"]:
        return clean
    return lookup["lower"].get(clean.lower(), "")


def split_provider_names(value, lookup):
    names = []
    seen = set()
    for raw in str(value or "").replace(",", ";").split(";"):
        clean = raw.strip()
        if not clean:
            continue
        provider = canonical_provider(clean, lookup)
        if provider and provider not in seen:
            names.append(provider)
            seen.add(provider)
    return names


def filter_provider_examples(value, lookup, limit=10):
    examples = []
    seen = set()
    for raw in str(value or "").split(";"):
        clean = raw.strip()
        if not clean:
            continue
        name = clean.rsplit(" (", 1)[0].strip()
        provider = canonical_provider(name, lookup)
        if provider and provider not in seen:
            suffix = clean[len(name):]
            examples.append(f"{provider}{suffix}")
            seen.add(provider)
        if len(examples) >= limit:
            break
    return "; ".join(examples)


def write_csv(path, rows, fieldnames):
    DATA.mkdir(exist_ok=True)
    with (DATA / path).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    providers, countries, hosting, mmdb_names, skipped = read_raw()
    max_countries = max((len(v["countries"]) for v in providers.values()), default=1)
    max_asns = max((len(v["asns"]) for v in providers.values()), default=1)

    provider_rows = []
    geo_rows = []
    independence_rows = []
    archetype_map = []

    for provider, values in sorted(providers.items()):
        rows = values["rows"]
        country_count = len(values["countries"])
        city_count = len(values["cities"])
        asn_count = len(values["asns"])
        top_asn = values["asn_counts"].most_common(1)[0][1] if values["asn_counts"] else rows
        concentration = top_asn / rows if rows else 1.0
        hosting_ratio = values["hosting"] / rows if rows else 0.0
        avg_confidence = values["confidence_sum"] / rows if rows else 0.0
        match_rate = values["country_match_rows"] / values["country_checked_rows"] if values["country_checked_rows"] else 0.0
        country_spread = norm_log(country_count, max_countries)
        hosting_diversity = norm_log(asn_count, max_asns) * (1.0 - concentration * 0.35)
        city_precision = min(1.0, norm_log(city_count, max(1, country_count * 8)))
        shared = min(1.0, concentration * 0.75 + (1.0 - hosting_diversity) * 0.25)
        geo_truth = (
            country_spread * 0.35
            + hosting_diversity * 0.20
            + city_precision * 0.15
            + min(avg_confidence / 100, 1) * 0.10
            + match_rate * 0.20
        )
        independence = hosting_diversity * 0.45 + country_spread * 0.30 + (1.0 - concentration) * 0.25
        conf_label = confidence_label(rows, avg_confidence)
        infra_model = archetype_for({
            "country_spread_score": country_spread,
            "independence_score": independence,
            "hosting_concentration": concentration,
            "country_count": country_count,
            "shared_infra_score": shared,
            "geo_truth_score": geo_truth,
            "hosting_ratio": hosting_ratio,
        })

        provider_rows.append({
            "provider": provider,
            "primary_type": PUBLIC_TYPE,
            "observed_records_bucket": bucket_count(rows),
            "country_count": country_count,
            "city_count": city_count,
            "hosting_cluster_count": asn_count,
            "infra_model": infra_model,
            "country_spread_score": rounded(country_spread),
            "hosting_diversity_score": rounded(hosting_diversity),
            "shared_infra_score": rounded(shared),
            "hosting_ratio": rounded(hosting_ratio),
            "mmdb_country_match_rate": rounded(match_rate),
            "confidence": conf_label,
        })
        geo_rows.append({
            "provider": provider,
            "observed_countries": country_count,
            "geo_truth_score": rounded(geo_truth),
            "mmdb_country_match_rate": rounded(match_rate),
            "virtual_location_likelihood": level(1.0 - geo_truth),
            "city_precision_quality": level(city_precision),
            "confidence": conf_label,
        })
        independence_rows.append({
            "provider": provider,
            "independence_grade": grade(independence),
            "independence_score": rounded(independence),
            "hosting_concentration": level(concentration),
            "shared_footprint": level(shared),
            "geo_diversity": level(country_spread),
            "confidence": conf_label,
        })
        archetype_map.append({
            "provider": provider,
            "archetype": infra_model,
            "independence_grade": grade(independence),
            "geo_truth_score": rounded(geo_truth),
            "confidence": conf_label,
        })

    archetype_stats = {}
    for row in archetype_map:
        archetype_stats.setdefault(row["archetype"], {"providers_count": 0, "geo": [], "independence": []})
        archetype_stats[row["archetype"]]["providers_count"] += 1
        archetype_stats[row["archetype"]]["geo"].append(float(row["geo_truth_score"]))
        match = next(item for item in independence_rows if item["provider"] == row["provider"])
        archetype_stats[row["archetype"]]["independence"].append(float(match["independence_score"]))

    descriptions = {
        "global-premium-mesh": "Large distributed footprint with high diversity signals",
        "multi-hosting-commercial-vpn": "Broad commercial footprint with heavy hosting usage",
        "regional-datacenter-vpn": "Regional or mid-sized datacenter-oriented footprint",
        "white-label-reseller-cluster": "High shared-infrastructure and low independence signals",
        "single-hosting-vpn": "Narrow footprint concentrated in one hosting pattern",
        "virtual-location-heavy-provider": "Broad geography with weaker plausibility signals",
    }
    archetype_rows = []
    for name, stats in sorted(archetype_stats.items()):
        archetype_rows.append({
            "archetype": name,
            "description": descriptions.get(name, "Infrastructure pattern cluster"),
            "providers_count": stats["providers_count"],
            "median_geo_truth": rounded(sorted(stats["geo"])[len(stats["geo"]) // 2]),
            "median_independence": rounded(sorted(stats["independence"])[len(stats["independence"]) // 2]),
        })

    country_rows = []
    for country, values in sorted(countries.items(), key=lambda item: country_name(item[0], mmdb_names)):
        rows = values["rows"]
        provider_count = len(values["providers"])
        asn_count = len(values["asns"])
        top_asn = values["asn_counts"].most_common(1)[0][1] if values["asn_counts"] else rows
        concentration = top_asn / rows if rows else 1.0
        hosting_ratio = values["hosting"] / rows if rows else 0.0
        city_precision = values["city_rows"] / rows if rows else 0.0
        match_rate = values["country_match_rows"] / values["country_checked_rows"] if values["country_checked_rows"] else 0.0
        pressure = hosting_ratio * 0.30 + concentration * 0.35 + (1.0 - city_precision) * 0.20 + (1.0 - match_rate) * 0.15
        country_rows.append({
            "country": country_name(country, mmdb_names),
            "providers_observed": provider_count,
            "hosting_cluster_count": asn_count,
            "provider_examples": "; ".join(name for name, _count in values["providers"].most_common(6)),
            "local_hosting_diversity": level(1.0 - concentration),
            "remote_hosting_dependency": level(hosting_ratio),
            "mmdb_country_match_rate": rounded(match_rate),
            "virtual_location_pressure": rounded(pressure),
            "confidence": confidence_label(rows, 70),
        })

    hosting_rows = []
    provider_hosting_rows = []
    max_hosting_providers = max((len(v["providers"]) for v in hosting.values()), default=1)
    for index, (_name, values) in enumerate(
        sorted(hosting.items(), key=lambda item: (len(item[1]["providers"]), item[1]["rows"]), reverse=True),
        start=1,
    ):
        provider_count = len(values["providers"])
        country_count = len(values["countries"])
        score = norm_log(provider_count, max_hosting_providers) * 0.70 + norm_log(country_count, 100) * 0.30
        if score >= 0.80:
            dep_class = "core-vpn-hosting"
        elif score >= 0.55:
            dep_class = "important-vpn-hosting"
        elif score >= 0.30:
            dep_class = "niche-vpn-hosting"
        else:
            dep_class = "limited-signal-hosting"
        provider_examples = [name for name, _count in values["providers"].most_common(6)]
        country_examples = [country_name(code, mmdb_names) for code, _count in values["countries"].most_common(5)]
        hosting_rows.append({
            "hosting_cluster": f"HostingCluster-{index:03d}",
            "provider_count": provider_count,
            "country_count": country_count,
            "provider_examples": "; ".join(provider_examples),
            "country_examples": "; ".join(country_examples),
            "observed_records_bucket": bucket_count(values["rows"]),
            "dependency_score": rounded(score),
            "dependency_class": dep_class,
        })
        for provider, count in values["providers"].most_common():
            provider_hosting_rows.append({
                "provider": provider,
                "hosting_cluster": f"HostingCluster-{index:03d}",
                "observed_records_bucket": bucket_count(count),
                "dependency_score": rounded(score),
                "dependency_class": dep_class,
            })

    provider_country_rows = []
    for provider, values in sorted(providers.items()):
        total = values["rows"] or 1
        for country, count in values["country_counts"].most_common():
            provider_country_rows.append({
                "provider": provider,
                "country": country_name(country, mmdb_names),
                "observed_records_bucket": bucket_count(count),
                "provider_country_share": rounded(count / total),
            })

    allowed_providers = set(providers)
    provider_by_name = provider_lookup(allowed_providers)

    external_independence_rows = []
    for row in read_external_csv(EXTERNAL_OVERLAP / "provider_independence_score.csv"):
        provider = canonical_provider(row.get("provider", ""), provider_by_name)
        if not provider:
            continue
        try:
            score = float(row.get("independence_score") or 0) / 100
            top_share = float(row.get("top_host_share_percent") or 0) / 100
        except ValueError:
            score = 0
            top_share = 0
        external_independence_rows.append({
            "provider": provider,
            "external_independence_score": rounded(score),
            "external_asn_count": row.get("asn_count", ""),
            "external_hosting_org_count": row.get("hosting_org_count", ""),
            "external_top_host_share": rounded(top_share),
            "external_concentration_level": row.get("concentration_level", ""),
            "source_repo": "ipanalytics/vpn-provider-overlap-intelligence",
        })

    external_overlap_rows = []
    for row in read_external_csv(EXTERNAL_OVERLAP / "provider_pair_exact_overlap.csv"):
        provider_a = canonical_provider(row.get("provider_a", ""), provider_by_name)
        provider_b = canonical_provider(row.get("provider_b", ""), provider_by_name)
        if not provider_a or not provider_b:
            continue
        try:
            score = float(row.get("relationship_score") or 0) / 100
        except ValueError:
            score = 0
        external_overlap_rows.append({
            "provider_a": provider_a,
            "provider_b": provider_b,
            "relationship_score": rounded(score),
            "confidence": row.get("confidence", ""),
            "shared_exact_count": row.get("shared_exact_ips", ""),
            "shared_prefix_count": row.get("shared_prefixes_24", ""),
            "shared_asn_count": row.get("shared_asns", ""),
            "source_repo": "ipanalytics/vpn-provider-overlap-intelligence",
        })

    external_asn_rows = []
    for index, row in enumerate(read_external_csv(EXTERNAL_ASN / "asn_multi_provider.csv"), start=1):
        names = split_provider_names(row.get("Names", ""), provider_by_name)
        if not names:
            continue
        external_asn_rows.append({
            "asn_cluster": f"ASNCluster-{index:03d}",
            "asn": row.get("ASN", ""),
            "operator": row.get("Org", ""),
            "provider_count": len(names),
            "observed_records_bucket": bucket_count(str(row.get("IPs", "0")).replace(",", "") or 0),
            "provider_examples": "; ".join(names[:8]),
            "source_repo": "ipanalytics/ASN-VPN-Network-Intelligence",
        })

    external_hosting_operator_rows = []
    for index, row in enumerate(read_external_csv(EXTERNAL_OVERLAP / "hosting_company_footprint.csv"), start=1):
        operator = row.get("asn_org", "")
        top_providers = filter_provider_examples(row.get("top_providers", ""), provider_by_name)
        if not operator or not top_providers:
            continue
        external_hosting_operator_rows.append({
            "operator_cluster": f"OperatorCluster-{index:03d}",
            "operator": operator,
            "provider_count": len(split_provider_names(top_providers, provider_by_name)),
            "asn_count": row.get("asn_count", ""),
            "country_count": row.get("country_count", ""),
            "observed_records_bucket": bucket_count(str(row.get("unique_ips", "0")).replace(",", "") or 0),
            "top_provider_examples": top_providers,
            "source_repo": "ipanalytics/vpn-provider-overlap-intelligence",
        })

    external_provider_operator_rows = []
    for row in read_external_csv(EXTERNAL_OVERLAP / "provider_hosting_dependency.csv"):
        provider = canonical_provider(row.get("provider", ""), provider_by_name)
        if not provider:
            continue
        try:
            share = float(row.get("provider_share_percent") or 0) / 100
        except ValueError:
            share = 0
        external_provider_operator_rows.append({
            "provider": provider,
            "operator": row.get("asn_org", ""),
            "provider_share": rounded(share),
            "asn_count": row.get("asn_count", ""),
            "observed_records_bucket": bucket_count(str(row.get("ip_count", "0")).replace(",", "") or 0),
            "source_repo": "ipanalytics/vpn-provider-overlap-intelligence",
        })

    external_relationship_cluster_rows = []
    for row in read_external_csv(EXTERNAL_OVERLAP / "provider_relationship_clusters.csv"):
        relationship_providers = split_provider_names(row.get("providers", ""), provider_by_name)
        if len(relationship_providers) < 2:
            continue
        try:
            score = float(row.get("relationship_score") or 0) / 100
        except ValueError:
            score = 0
        external_relationship_cluster_rows.append({
            "relationship_cluster": row.get("cluster_id", ""),
            "providers": "; ".join(relationship_providers),
            "relationship_score": rounded(score),
            "confidence": row.get("confidence", ""),
            "shared_exact_count": row.get("pair_shared_exact_ip_sum", ""),
            "shared_prefix_count": row.get("shared_prefixes_24", ""),
            "shared_asn_count": row.get("shared_asns", ""),
            "evidence": row.get("evidence", ""),
            "source_repo": "ipanalytics/vpn-provider-overlap-intelligence",
        })

    external_shared_prefix_rows = []
    for index, row in enumerate(read_external_csv(EXTERNAL_OVERLAP / "shared_prefix_examples.csv"), start=1):
        shared_providers = split_provider_names(row.get("providers", ""), provider_by_name)
        if len(shared_providers) < 2:
            continue
        external_shared_prefix_rows.append({
            "prefix_cluster": f"SharedPrefixCluster-{index:03d}",
            "asn": row.get("asn", ""),
            "operator": row.get("asn_org", ""),
            "observed_exact_count": row.get("observed_exact_ips_in_prefix", ""),
            "provider_count": len(shared_providers),
            "provider_examples": "; ".join(shared_providers),
            "source_repo": "ipanalytics/vpn-provider-overlap-intelligence",
        })

    atlas_country_rows = []
    for row in read_external_csv(EXTERNAL_ATLAS / "country_summary.csv"):
        atlas_country_rows.append({
            "country": country_name(row.get("country", ""), mmdb_names),
            "observed_records_bucket": bucket_count(str(row.get("ip_count", "0")).replace(",", "") or 0),
            "prefix_count": row.get("prefix_count", ""),
            "provider_count": row.get("provider_count", ""),
            "asn_count": row.get("asn_count", ""),
            "data_origin": "VPN-Infrastructure-Atlas",
        })

    atlas_asn_rows = []
    for row in read_external_csv(EXTERNAL_ATLAS / "asn_summary.csv"):
        atlas_asn_rows.append({
            "asn": row.get("asn", ""),
            "operator": row.get("asn_org", ""),
            "observed_records_bucket": bucket_count(str(row.get("ip_count", "0")).replace(",", "") or 0),
            "prefix_count": row.get("prefix_count", ""),
            "provider_count": row.get("provider_count", ""),
            "country_count": row.get("country_count", ""),
            "country_examples": "; ".join(country_name(code, mmdb_names) for code in row.get("countries", "").split()[:10]),
            "data_origin": "VPN-Infrastructure-Atlas",
        })

    atlas_provider_country_rows = []
    for row in read_external_csv(EXTERNAL_ATLAS / "provider_country.csv"):
        provider = canonical_provider(row.get("provider", ""), provider_by_name)
        if not provider:
            continue
        atlas_provider_country_rows.append({
            "provider": provider,
            "country": country_name(row.get("country", ""), mmdb_names),
            "observed_records_bucket": bucket_count(str(row.get("ip_count", "0")).replace(",", "") or 0),
            "prefix_count": row.get("prefix_count", ""),
            "asn_count": row.get("asn_count", ""),
            "hosting_record_bucket": bucket_count(str(row.get("hosting_ip_count", "0")).replace(",", "") or 0),
            "avg_confidence": row.get("avg_confidence", ""),
            "data_origin": "VPN-Infrastructure-Atlas",
        })

    atlas_provider_asn_rows = []
    for row in read_external_csv(EXTERNAL_ATLAS / "provider_asn.csv"):
        provider = canonical_provider(row.get("provider", ""), provider_by_name)
        if not provider:
            continue
        atlas_provider_asn_rows.append({
            "provider": provider,
            "asn": row.get("asn", ""),
            "operator": row.get("asn_org", ""),
            "country_count": row.get("country_count", ""),
            "country_examples": "; ".join(country_name(code, mmdb_names) for code in row.get("countries", "").split()[:10]),
            "observed_records_bucket": bucket_count(str(row.get("ip_count", "0")).replace(",", "") or 0),
            "prefix_count": row.get("prefix_count", ""),
            "avg_confidence": row.get("avg_confidence", ""),
            "data_origin": "VPN-Infrastructure-Atlas",
        })

    atlas_provider_country_asn_rows = []
    for row in read_external_csv(EXTERNAL_ATLAS / "provider_country_asn.csv"):
        provider = canonical_provider(row.get("provider", ""), provider_by_name)
        country_code = row.get("country", "").upper()
        if not provider:
            continue
        atlas_provider_country_asn_rows.append({
            "provider": provider,
            "country_code": country_code,
            "country": country_name(country_code, mmdb_names),
            "asn": row.get("asn", ""),
            "operator": row.get("asn_org", ""),
            "observed_records_bucket": bucket_count(str(row.get("ip_count", "0")).replace(",", "") or 0),
            "prefix_count": row.get("prefix_count", ""),
            "hosting_record_bucket": bucket_count(str(row.get("hosting_ip_count", "0")).replace(",", "") or 0),
            "exit_record_bucket": bucket_count(str(row.get("exit_node_count", "0")).replace(",", "") or 0),
            "avg_confidence": row.get("avg_confidence", ""),
            "data_origin": "VPN-Infrastructure-Atlas",
        })

    atlas_country_agg = {}
    for row in atlas_provider_country_asn_rows:
        country = row["country"]
        item = atlas_country_agg.setdefault(country, {"providers": set(), "asns": set(), "prefix_count": 0})
        item["providers"].add(row["provider"])
        if row["asn"] and row["asn"] != "0":
            item["asns"].add(row["asn"])
        item["prefix_count"] += int(row["prefix_count"] or 0)
    atlas_country_rows = [{
        "country": country,
        "observed_records_bucket": "aggregate",
        "prefix_count": values["prefix_count"],
        "provider_count": len(values["providers"]),
        "asn_count": len(values["asns"]),
        "data_origin": "VPN-Infrastructure-Atlas",
    } for country, values in sorted(atlas_country_agg.items())]

    atlas_asn_agg = {}
    for row in atlas_provider_country_asn_rows:
        asn = row["asn"]
        if not asn or asn == "0":
            continue
        item = atlas_asn_agg.setdefault(asn, {
            "operator": row["operator"],
            "providers": set(),
            "countries": set(),
            "prefix_count": 0,
        })
        item["providers"].add(row["provider"])
        item["countries"].add(row["country"])
        item["prefix_count"] += int(row["prefix_count"] or 0)
    atlas_asn_rows = [{
        "asn": asn,
        "operator": values["operator"],
        "observed_records_bucket": "aggregate",
        "prefix_count": values["prefix_count"],
        "provider_count": len(values["providers"]),
        "country_count": len(values["countries"]),
        "country_examples": "; ".join(sorted(values["countries"])[:10]),
        "data_origin": "VPN-Infrastructure-Atlas",
    } for asn, values in sorted(atlas_asn_agg.items())]

    grade_counts = Counter(row["independence_grade"] for row in independence_rows)
    market_rows = [
        {"tier": 1, "tier_name": "Large independent/global VPN providers", "providers_count": grade_counts["A"], "description": "High diversity and low shared-infrastructure signals"},
        {"tier": 2, "tier_name": "Mostly independent commercial VPN providers", "providers_count": grade_counts["B"], "description": "Broad or diverse footprint with moderate dependency"},
        {"tier": 3, "tier_name": "Mixed dependency VPN providers", "providers_count": grade_counts["C"], "description": "Mixed geography, hosting diversity, and concentration signals"},
        {"tier": 4, "tier_name": "Concentrated or reseller-like VPN providers", "providers_count": grade_counts["D"], "description": "High concentration or low independence signals"},
    ]

    feature_rows = [
        {"feature": "country_spread_score", "scope": "provider", "description": "Normalized country diversity"},
        {"feature": "hosting_diversity_score", "scope": "provider", "description": "Normalized hosting-cluster diversity with concentration penalty"},
        {"feature": "shared_infra_score", "scope": "provider", "description": "Concentration-derived shared infrastructure signal"},
        {"feature": "mmdb_country_match_rate", "scope": "provider/country", "description": "Share of observations where source country matched private geo.mmdb country"},
        {"feature": "geo_truth_score", "scope": "provider", "description": "Plausibility blend of geography, city precision, hosting diversity, MMDB match rate, and confidence"},
        {"feature": "virtual_location_pressure", "scope": "country", "description": "Country-level hosting concentration, city precision, and MMDB mismatch pressure signal"},
    ]

    write_csv("providers_public.csv", provider_rows, list(provider_rows[0].keys()))
    write_csv("provider_fingerprints.csv", provider_rows, list(provider_rows[0].keys()))
    write_csv("provider_geo_truth_score.csv", geo_rows, list(geo_rows[0].keys()))
    write_csv("provider_independence_index.csv", independence_rows, list(independence_rows[0].keys()))
    write_csv("country_virtual_location_pressure.csv", country_rows, list(country_rows[0].keys()))
    write_csv("infrastructure_archetypes.csv", archetype_rows, list(archetype_rows[0].keys()))
    write_csv("provider_archetype_map.csv", archetype_map, list(archetype_map[0].keys()))
    write_csv("hosting_dependency_index.csv", hosting_rows, list(hosting_rows[0].keys()))
    write_csv("provider_country_map.csv", provider_country_rows, list(provider_country_rows[0].keys()))
    write_csv("provider_hosting_cluster_map.csv", provider_hosting_rows, list(provider_hosting_rows[0].keys()))
    write_csv("market_structure_tiers.csv", market_rows, list(market_rows[0].keys()))
    write_csv("methodology_features.csv", feature_rows, list(feature_rows[0].keys()))
    if external_independence_rows:
        write_csv("external_provider_independence_signals.csv", external_independence_rows, list(external_independence_rows[0].keys()))
    if external_overlap_rows:
        write_csv("external_provider_overlap_signals.csv", external_overlap_rows, list(external_overlap_rows[0].keys()))
    if external_asn_rows:
        write_csv("external_asn_multi_provider_clusters.csv", external_asn_rows, list(external_asn_rows[0].keys()))
    if external_hosting_operator_rows:
        write_csv("external_hosting_operator_footprint.csv", external_hosting_operator_rows, list(external_hosting_operator_rows[0].keys()))
    if external_provider_operator_rows:
        write_csv("external_provider_hosting_dependency.csv", external_provider_operator_rows, list(external_provider_operator_rows[0].keys()))
    if external_relationship_cluster_rows:
        write_csv("external_provider_relationship_clusters.csv", external_relationship_cluster_rows, list(external_relationship_cluster_rows[0].keys()))
    if external_shared_prefix_rows:
        write_csv("external_shared_prefix_evidence.csv", external_shared_prefix_rows, list(external_shared_prefix_rows[0].keys()))
    if atlas_country_rows:
        write_csv("atlas_country_summary.csv", atlas_country_rows, list(atlas_country_rows[0].keys()))
    if atlas_asn_rows:
        write_csv("atlas_asn_summary.csv", atlas_asn_rows, list(atlas_asn_rows[0].keys()))
    if atlas_provider_country_rows:
        write_csv("atlas_provider_country.csv", atlas_provider_country_rows, list(atlas_provider_country_rows[0].keys()))
    if atlas_provider_asn_rows:
        write_csv("atlas_provider_asn.csv", atlas_provider_asn_rows, list(atlas_provider_asn_rows[0].keys()))
    if atlas_provider_country_asn_rows:
        write_csv("atlas_provider_country_asn.csv", atlas_provider_country_asn_rows, list(atlas_provider_country_asn_rows[0].keys()))

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider_count": len(provider_rows),
        "country_count": len(country_rows),
        "hosting_cluster_count": len(hosting_rows),
        "external_overlap_pairs": len(external_overlap_rows),
        "external_asn_clusters": len(external_asn_rows),
        "external_hosting_operators": len(external_hosting_operator_rows),
        "external_relationship_clusters": len(external_relationship_cluster_rows),
        "external_shared_prefix_evidence_rows": len(external_shared_prefix_rows),
        "atlas_country_rows": len(atlas_country_rows),
        "atlas_asn_rows": len(atlas_asn_rows),
        "atlas_provider_country_asn_rows": len(atlas_provider_country_asn_rows),
        "archive_sources": [
            "ipanalytics/vpn-provider-overlap-intelligence",
            "ipanalytics/ASN-VPN-Network-Intelligence",
            "ipanalytics/VPN-Infrastructure-Atlas",
        ],
        "included_type": PUBLIC_TYPE,
        "excluded_providers": sorted(EXCLUDED_PROVIDERS),
        "skipped_records": sum(skipped.values()),
        "geo_validation": "private geo.mmdb country match rate included as aggregate percentage only",
        "public_boundary": "aggregate-only; no raw IPs, networks, endpoint lists, or MMDB files",
    }
    (DATA / "public_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
