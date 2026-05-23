const paths = {
  summary: "../data/public_summary.json",
  providers: "../data/provider_fingerprints.csv",
  geo: "../data/provider_geo_truth_score.csv",
  independence: "../data/provider_independence_index.csv",
  archetypes: "../data/infrastructure_archetypes.csv",
  countries: "../data/country_virtual_location_pressure.csv",
  hosting: "../data/hosting_dependency_index.csv",
  providerCountries: "../data/provider_country_map.csv",
  providerHosting: "../data/provider_hosting_cluster_map.csv",
  externalIndependence: "../data/external_provider_independence_signals.csv",
  externalOverlap: "../data/external_provider_overlap_signals.csv",
  externalAsn: "../data/external_asn_multi_provider_clusters.csv",
  externalOperators: "../data/external_hosting_operator_footprint.csv",
  externalProviderOperators: "../data/external_provider_hosting_dependency.csv",
  externalRelationships: "../data/external_provider_relationship_clusters.csv",
  externalSharedPrefixes: "../data/external_shared_prefix_evidence.csv",
  atlasCountries: "../data/atlas_country_summary.csv",
  atlasAsn: "../data/atlas_asn_summary.csv",
  atlasProviderCountries: "../data/atlas_provider_country.csv",
  atlasProviderAsn: "../data/atlas_provider_asn.csv",
  atlasProviderCountryAsn: "../data/atlas_provider_country_asn.csv",
  tiers: "../data/market_structure_tiers.csv",
  methodology: "../docs/methodology.md",
  safety: "../docs/data_safety.md",
};

const tierGrades = {
  "Large independent/global VPN providers": ["A"],
  "Mostly independent commercial VPN providers": ["B"],
  "Mixed dependency VPN providers": ["C"],
  "Concentrated or reseller-like VPN providers": ["D"],
};

const state = {
  summary: {},
  providers: [],
  archetypes: [],
  countries: [],
  hosting: [],
  providerCountries: [],
  providerHosting: [],
  externalIndependenceByProvider: new Map(),
  externalOverlapByProvider: new Map(),
  externalAsnClusters: [],
  externalOperators: [],
  externalProviderOperators: [],
  externalRelationships: [],
  externalSharedPrefixes: [],
  atlasCountries: [],
  atlasAsn: [],
  atlasProviderCountries: [],
  atlasProviderAsn: [],
  atlasProviderCountryAsn: [],
  tiers: [],
  geoByProvider: new Map(),
  independenceByProvider: new Map(),
  providerSort: { key: "geo", direction: "desc" },
  hostingSort: { key: "dependency_score", direction: "desc" },
  atlasMetric: "prefix_count",
  atlasFilters: {
    provider: "",
    country: "",
    asn: "",
    minPrefix: 0,
    search: "",
  },
  selected: { type: "overview", key: "" },
};

function parseCsv(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/);
  const headers = splitCsvLine(lines.shift());
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = splitCsvLine(line);
    rows.push(Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])));
  }
  return rows;
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function loadCsv(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return parseCsv(await response.text());
}

async function loadText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.text();
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function scoreCell(value) {
  return `<span class="score">${percent(value)}</span>`;
}

function gradeCell(value) {
  return `<span class="grade grade-${value.toLowerCase()}">${value}</span>`;
}

function splitExamples(value) {
  return String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
}

function valueForProviderSort(row, key) {
  const geo = state.geoByProvider.get(row.provider);
  const independence = state.independenceByProvider.get(row.provider);
  const values = {
    provider: row.provider,
    infra_model: row.infra_model,
    grade: independence?.independence_grade ?? "",
    geo: Number(geo?.geo_truth_score ?? 0),
    mmdb: Number(geo?.mmdb_country_match_rate ?? 0),
    hosting: Number(row.hosting_diversity_score ?? 0),
    confidence: row.confidence,
  };
  return values[key] ?? "";
}

function compareValues(left, right, direction) {
  if (typeof left === "number" && typeof right === "number") {
    return direction === "asc" ? left - right : right - left;
  }
  return direction === "asc"
    ? String(left).localeCompare(String(right))
    : String(right).localeCompare(String(left));
}

function filteredProviders() {
  const selectedProvider = document.getElementById("providerFilter").value;
  const archetype = document.getElementById("archetypeFilter").value;
  const grade = document.getElementById("gradeFilter").value;
  return state.providers.filter((provider) => {
    const independence = state.independenceByProvider.get(provider.provider);
    const matchesProvider = !selectedProvider || provider.provider === selectedProvider;
    const matchesArchetype = !archetype || provider.infra_model === archetype;
    const matchesGrade = !grade || independence?.independence_grade === grade;
    const matchesCountry = state.selected.type !== "country" || providersForCountry(state.selected.key).has(provider.provider);
    const matchesHosting = state.selected.type !== "hosting" || providersForHosting(state.selected.key).has(provider.provider);
    const matchesAsn = state.selected.type !== "asn" || providersForAsn(state.selected.key).has(provider.provider);
    const matchesRelationship = state.selected.type !== "relationship" || providersForRelationship(state.selected.key).has(provider.provider);
    const matchesAtlasCountry = state.selected.type !== "atlas-country" || providersForAtlasCountry(state.selected.key).has(provider.provider);
    const matchesAtlasFilters = providerMatchesAtlasFilters(provider.provider);
    return matchesProvider && matchesArchetype && matchesGrade && matchesCountry && matchesHosting && matchesAsn && matchesRelationship && matchesAtlasCountry && matchesAtlasFilters;
  });
}

function renderProviders() {
  const rows = filteredProviders();
  rows.sort((left, right) => compareValues(
    valueForProviderSort(left, state.providerSort.key),
    valueForProviderSort(right, state.providerSort.key),
    state.providerSort.direction,
  ));

  document.getElementById("providerRows").innerHTML = rows.map((provider) => {
    const geo = state.geoByProvider.get(provider.provider);
    const independence = state.independenceByProvider.get(provider.provider);
    return `
      <tr data-provider="${escapeHtml(provider.provider)}">
        <td><button class="link-button" data-provider-select="${escapeHtml(provider.provider)}">${escapeHtml(provider.provider)}</button></td>
        <td>${escapeHtml(provider.infra_model)}</td>
        <td>${gradeCell(independence?.independence_grade ?? "D")}</td>
        <td>${scoreCell(geo?.geo_truth_score ?? 0)}</td>
        <td>${scoreCell(geo?.mmdb_country_match_rate ?? 0)}</td>
        <td>${scoreCell(provider.hosting_diversity_score)}</td>
        <td>${escapeHtml(provider.confidence)}</td>
      </tr>
    `;
  }).join("");
  setText("providerVisibleCount", `${rows.length} shown`);
  updateSortLabels("[data-sort]", state.providerSort);
  document.querySelectorAll("[data-provider-select]").forEach((button) => {
    button.addEventListener("click", () => selectProvider(button.dataset.providerSelect));
  });
}

function renderHosting() {
  const activeProviders = activeProviderSet();
  const relevantClusters = clustersForProviders(activeProviders);
  const rows = state.hosting
    .filter((row) => !activeProviders.size || relevantClusters.has(row.hosting_cluster))
    .sort((left, right) => {
    const key = state.hostingSort.key;
    const leftValue = key === "hosting_cluster" ? left[key] : Number(left[key] ?? 0);
    const rightValue = key === "hosting_cluster" ? right[key] : Number(right[key] ?? 0);
    return compareValues(leftValue, rightValue, state.hostingSort.direction);
  });
  document.getElementById("hostingRows").innerHTML = rows.slice(0, 18).map((row) => `
    <tr class="click-row ${isSelected("hosting", row.hosting_cluster)}" data-hosting="${escapeHtml(row.hosting_cluster)}">
      <td><strong>${escapeHtml(row.hosting_cluster)}</strong><div class="muted">${escapeHtml(row.dependency_class)}</div></td>
      <td>${escapeHtml(row.provider_count)}</td>
      <td>${scoreCell(row.dependency_score)}</td>
      <td>${escapeHtml(row.provider_examples)}</td>
      <td>${escapeHtml(row.country_examples)}</td>
    </tr>
  `).join("");
  updateSortLabels("[data-hosting-sort]", state.hostingSort);
  document.querySelectorAll("[data-hosting]").forEach((row) => {
    row.addEventListener("click", () => selectHosting(row.dataset.hosting));
  });
}

function updateSortLabels(selector, sort) {
  document.querySelectorAll(selector).forEach((button) => {
    const key = button.dataset.sort || button.dataset.hostingSort;
    const label = button.textContent.replace(/\s+[↑↓]$/, "");
    button.textContent = key === sort.key ? `${label} ${sort.direction === "asc" ? "↑" : "↓"}` : label;
  });
}

function isSelected(type, key) {
  return state.selected.type === type && state.selected.key === key ? "is-selected" : "";
}

function renderBars(id, rows, labelKey, valueKey, options = {}) {
  const max = Math.max(...rows.map((row) => Number(row[valueKey]) || 0), 1);
  document.getElementById(id).innerHTML = rows.map((row) => {
    const value = Number(row[valueKey]) || 0;
    const key = row[labelKey];
    const width = `${Math.max(4, (value / max) * 100)}%`;
    const selectedClass = isSelected(options.type, key);
    return `
      <button class="bar-row ${selectedClass}" data-bar-type="${escapeHtml(options.type || "")}" data-bar-key="${escapeHtml(key)}">
        <span class="bar-label">
          <strong>${escapeHtml(key)}</strong>
          <span>${value}</span>
        </span>
        <span class="track"><span class="fill" style="width: ${width}"></span></span>
      </button>
    `;
  }).join("");
  document.querySelectorAll(`#${id} [data-bar-key]`).forEach((button) => {
    button.addEventListener("click", () => {
      if (options.type === "archetype") selectArchetype(button.dataset.barKey);
      if (options.type === "tier") selectTier(button.dataset.barKey);
    });
  });
}

function renderRanked(id, rows, titleKey, scoreKey, meta, type, scoreMode = "percent") {
  document.getElementById(id).innerHTML = rows.slice(0, 12).map((row) => `
    <button class="rank-row ${isSelected(type, row[titleKey])}" data-rank-type="${escapeHtml(type)}" data-rank-key="${escapeHtml(row[titleKey])}">
      <span class="rank-label">
        <strong>${escapeHtml(row[titleKey])}</strong>
        <span class="score">${scoreMode === "count" ? escapeHtml(row[scoreKey]) : percent(row[scoreKey])}</span>
      </span>
      <span class="rank-meta">${escapeHtml(meta(row))}</span>
    </button>
  `).join("");
  document.querySelectorAll(`#${id} [data-rank-key]`).forEach((button) => {
    button.addEventListener("click", () => {
      if (type === "country") selectCountry(button.dataset.rankKey);
      if (type === "asn") selectAsn(button.dataset.rankKey);
      if (type === "relationship") selectRelationship(button.dataset.rankKey);
    });
  });
}

function setSelection(type, key) {
  state.selected = { type, key };
  renderProviders();
  renderSelectionDetails();
  renderStaticPanels();
  renderHosting();
}

function clearSelection() {
  setSelection("overview", "");
}

function isCurrentSelection(type, key) {
  return state.selected.type === type && state.selected.key === key;
}

function selectProvider(providerName) {
  if (isCurrentSelection("provider", providerName) && document.getElementById("providerFilter").value === providerName) {
    document.getElementById("providerFilter").value = "";
    clearSelection();
    return;
  }
  document.getElementById("providerFilter").value = providerName;
  syncAtlasFilterOptions();
  setSelection("provider", providerName);
}

function selectArchetype(name) {
  if (isCurrentSelection("archetype", name) && document.getElementById("archetypeFilter").value === name) {
    document.getElementById("archetypeFilter").value = "";
    clearSelection();
    return;
  }
  document.getElementById("archetypeFilter").value = name;
  syncAtlasFilterOptions();
  setSelection("archetype", name);
}

function selectTier(name) {
  const grades = tierGrades[name] || [];
  if (isCurrentSelection("tier", name)) {
    document.getElementById("gradeFilter").value = "";
    clearSelection();
    return;
  }
  document.getElementById("gradeFilter").value = grades[0] || "";
  syncAtlasFilterOptions();
  setSelection("tier", name);
}

function selectCountry(name) {
  if (isCurrentSelection("country", name)) {
    clearSelection();
    return;
  }
  setSelection("country", name);
}

function selectHosting(name) {
  if (isCurrentSelection("hosting", name)) {
    clearSelection();
    return;
  }
  setSelection("hosting", name);
}

function selectAsn(name) {
  if (isCurrentSelection("asn", name)) {
    clearSelection();
    return;
  }
  setSelection("asn", name);
}

function selectRelationship(name) {
  if (isCurrentSelection("relationship", name)) {
    clearSelection();
    return;
  }
  setSelection("relationship", name);
}

function selectAtlasCountry(name) {
  if (isCurrentSelection("atlas-country", name)) {
    clearSelection();
    return;
  }
  setSelection("atlas-country", name);
}

function renderSelectionDetails() {
  const typeLabel = {
    overview: "Overview",
    provider: "Provider",
    archetype: "Archetype",
    tier: "Market tier",
    country: "Country",
    hosting: "Hosting cluster",
    asn: "ASN cluster",
    relationship: "Relationship",
    "atlas-country": "Atlas country",
  }[state.selected.type] || "Overview";
  setText("selectionType", typeLabel);

  let html = "";
  if (state.selected.type === "provider") {
    const provider = state.providers.find((row) => row.provider === state.selected.key);
    const geo = state.geoByProvider.get(state.selected.key);
    const independence = state.independenceByProvider.get(state.selected.key);
    const external = state.externalIndependenceByProvider.get(state.selected.key);
    const overlaps = state.externalOverlapByProvider.get(state.selected.key) || [];
    const asnClusters = externalAsnForProvider(state.selected.key);
    const atlasAsns = atlasAsnForProvider(state.selected.key);
    const operatorRows = externalOperatorsForProvider(state.selected.key);
    const visibleAsnContexts = asnClusters.length ? asnClusters : atlasAsnToClusterRows(atlasAsns);
    html = `
      <h3>${escapeHtml(state.selected.key)}</h3>
      <div class="detail-grid">
        <span>Grade</span><strong>${escapeHtml(independence?.independence_grade || "")}</strong>
        <span>Geo truth</span><strong>${percent(geo?.geo_truth_score)}</strong>
        <span>MMDB match</span><strong>${percent(geo?.mmdb_country_match_rate)}</strong>
        <span>Hosting diversity</span><strong>${percent(provider?.hosting_diversity_score)}</strong>
        <span>Archive independence</span><strong>${external ? percent(external.external_independence_score) : "n/a"}</strong>
        <span>ASN contexts</span><strong>${visibleAsnContexts.length}</strong>
        <span>Operator signals</span><strong>${operatorRows.length}</strong>
      </div>
      <p>${escapeHtml(provider?.infra_model || "")}</p>
      <p><strong>Overlap signals:</strong> ${escapeHtml(formatOverlaps(overlaps))}</p>
      ${renderMiniRows("Top operators", operatorRows.slice(0, 4).map((row) => ({
        label: row.operator,
        value: percent(row.provider_share),
      })))}
      ${renderMiniRows("ASN / Network Intelligence", visibleAsnContexts.slice(0, 5).map((row) => ({
        label: row.asn_cluster,
        value: `${row.operator} · ASN ${row.asn || "n/a"}`,
        type: "asn",
        key: row.asn_cluster,
      })))}
      ${renderMiniRows("Relationship clusters", relationshipClustersForProvider(state.selected.key).slice(0, 4).map((row) => ({
        label: row.relationship_cluster,
        value: `${percent(row.relationship_score)} · ${row.providers}`,
        type: "relationship",
        key: row.relationship_cluster,
      })))}
    `;
  } else if (state.selected.type === "archetype") {
    const row = state.archetypes.find((item) => item.archetype === state.selected.key);
    html = `
      <h3>${escapeHtml(state.selected.key)}</h3>
      <p>${escapeHtml(row?.description || "")}</p>
      <div class="detail-grid">
        <span>Providers</span><strong>${escapeHtml(row?.providers_count || "")}</strong>
        <span>Median geo truth</span><strong>${percent(row?.median_geo_truth)}</strong>
        <span>Median independence</span><strong>${percent(row?.median_independence)}</strong>
      </div>
    `;
  } else if (state.selected.type === "tier") {
    const row = state.tiers.find((item) => item.tier_name === state.selected.key);
    html = `
      <h3>${escapeHtml(state.selected.key)}</h3>
      <p>${escapeHtml(row?.description || "")}</p>
      <div class="detail-grid">
        <span>Providers</span><strong>${escapeHtml(row?.providers_count || "")}</strong>
        <span>Filter grade</span><strong>${escapeHtml((tierGrades[state.selected.key] || []).join(", "))}</strong>
      </div>
    `;
  } else if (state.selected.type === "country") {
    const row = state.countries.find((item) => item.country === state.selected.key);
    const providers = [...providersForCountry(state.selected.key)].slice(0, 8);
    html = `
      <h3>${escapeHtml(state.selected.key)}</h3>
      <div class="detail-grid">
        <span>Pressure</span><strong>${percent(row?.virtual_location_pressure)}</strong>
        <span>MMDB match</span><strong>${percent(row?.mmdb_country_match_rate)}</strong>
        <span>Providers</span><strong>${escapeHtml(row?.providers_observed || "")}</strong>
        <span>Hosting clusters</span><strong>${escapeHtml(row?.hosting_cluster_count || "")}</strong>
      </div>
      <p><strong>Provider examples:</strong> ${escapeHtml(providers.join("; ") || row?.provider_examples || "No examples")}</p>
    `;
  } else if (state.selected.type === "hosting") {
    const row = state.hosting.find((item) => item.hosting_cluster === state.selected.key);
    html = `
      <h3>${escapeHtml(state.selected.key)}</h3>
      <p>${escapeHtml(row?.dependency_class || "")}. Cluster name is anonymized; examples show observed public aggregate membership only.</p>
      <div class="detail-grid">
        <span>Dependency</span><strong>${percent(row?.dependency_score)}</strong>
        <span>Providers</span><strong>${escapeHtml(row?.provider_count || "")}</strong>
        <span>Countries</span><strong>${escapeHtml(row?.country_count || "")}</strong>
      </div>
      <p><strong>Provider examples:</strong> ${escapeHtml(row?.provider_examples || "")}</p>
      <p><strong>Country examples:</strong> ${escapeHtml(row?.country_examples || "")}</p>
    `;
  } else if (state.selected.type === "asn") {
    const row = state.externalAsnClusters.find((item) => item.asn_cluster === state.selected.key);
    const atlasAsn = state.selected.key.startsWith("AtlasASN-")
      ? state.selected.key.slice("AtlasASN-".length)
      : "";
    const atlasProviders = atlasAsn
      ? [...new Set(state.atlasProviderCountryAsn.filter((item) => item.asn === atlasAsn).map((item) => item.provider))]
      : [];
    const providers = row ? splitExamples(row.provider_examples || "") : atlasProviders;
    const atlasRows = atlasAsn ? state.atlasProviderCountryAsn.filter((item) => item.asn === atlasAsn) : [];
    const operator = row?.operator || atlasRows.find((item) => item.operator)?.operator || "";
    const prefixTotal = atlasRows.reduce((sum, item) => sum + Number(item.prefix_count || 0), 0);
    html = `
      <h3>${escapeHtml(state.selected.key)}</h3>
      <p>${escapeHtml(operator)}</p>
      <div class="detail-grid">
        <span>ASN</span><strong>${escapeHtml(row?.asn || atlasAsn || "")}</strong>
        <span>Providers</span><strong>${escapeHtml(row?.provider_count || providers.length || "")}</strong>
        <span>Observed bucket</span><strong>${escapeHtml(row?.observed_records_bucket || atlasRows[0]?.observed_records_bucket || "")}</strong>
        <span>/24 prefixes</span><strong>${escapeHtml(prefixTotal || "")}</strong>
      </div>
      <p><strong>Providers in this ASN context:</strong> ${escapeHtml(providers.join("; "))}</p>
      <p><strong>Main table:</strong> filtered to providers from this ASN cluster.</p>
    `;
  } else if (state.selected.type === "relationship") {
    const row = state.externalRelationships.find((item) => item.relationship_cluster === state.selected.key);
    const providers = splitExamples(row?.providers || "");
    html = `
      <h3>${escapeHtml(state.selected.key)}</h3>
      <p>${escapeHtml(row?.providers || "")}</p>
      <div class="detail-grid">
        <span>Relationship score</span><strong>${percent(row?.relationship_score)}</strong>
        <span>Confidence</span><strong>${escapeHtml(row?.confidence || "")}</strong>
        <span>Shared exact count</span><strong>${escapeHtml(row?.shared_exact_count || "")}</strong>
        <span>Shared prefix count</span><strong>${escapeHtml(row?.shared_prefix_count || "")}</strong>
        <span>Shared ASN count</span><strong>${escapeHtml(row?.shared_asn_count || "")}</strong>
      </div>
      <p><strong>Evidence:</strong> ${escapeHtml(row?.evidence || "")}</p>
      <p><strong>Main table:</strong> filtered to ${escapeHtml(providers.join("; "))}</p>
    `;
  } else if (state.selected.type === "atlas-country") {
    const row = state.atlasCountries.find((item) => item.country === state.selected.key);
    const providers = [...providersForAtlasCountry(state.selected.key)].slice(0, 10);
    html = `
      <h3>${escapeHtml(state.selected.key)}</h3>
      <p>Atlas country footprint from the consolidated infrastructure atlas layer.</p>
      <div class="detail-grid">
        <span>Providers</span><strong>${escapeHtml(row?.provider_count || "")}</strong>
        <span>ASNs</span><strong>${escapeHtml(row?.asn_count || "")}</strong>
        <span>Prefixes</span><strong>${escapeHtml(row?.prefix_count || "")}</strong>
        <span>Observed bucket</span><strong>${escapeHtml(row?.observed_records_bucket || "")}</strong>
      </div>
      <p><strong>Provider examples:</strong> ${escapeHtml(providers.join("; ") || "No examples")}</p>
      <p><strong>Main table:</strong> filtered to providers observed in this atlas country.</p>
    `;
  } else {
    html = `
      <h3>Research Overview</h3>
      <p>Select a provider, market tier, archetype, country, or hosting cluster to inspect the signal and update the provider table.</p>
      <div class="detail-grid">
        <span>Visible providers</span><strong>${filteredProviders().length}</strong>
        <span>Safety boundary</span><strong>Aggregate only</strong>
      </div>
    `;
  }
  document.getElementById("selectionDetails").innerHTML = html;
  bindMiniRowActions();
}

function renderStaticPanels() {
  const activeProviders = activeProviderSet();
  const visibleCountries = filterCountriesForProviders(activeProviders);
  const atlasRows = filteredAtlasBase(activeProviders);
  renderBars("tierBars", state.tiers, "tier_name", "providers_count", { type: "tier" });
  renderBars("archetypeBars", state.archetypes, "archetype", "providers_count", { type: "archetype" });
  renderRanked(
    "countryList",
    visibleCountries,
    "country",
    "virtual_location_pressure",
    (row) => `${row.providers_observed} providers, ${percent(row.mmdb_country_match_rate)} MMDB country match`,
    "country",
  );
  renderRanked(
    "asnList",
    filterAsnForProviders(activeProviders),
    "asn_cluster",
    "provider_count",
    (row) => `${row.operator || "unknown operator"} · ASN ${row.asn || "n/a"} · ${row.observed_records_bucket}`,
    "asn",
    "count",
  );
  renderRanked(
    "relationshipList",
    filterRelationshipsForProviders(activeProviders),
    "relationship_cluster",
    "relationship_score",
    (row) => `${row.providers} · ${row.confidence}`,
    "relationship",
  );
  renderAtlasMap(aggregateAtlasCountries(atlasRows));
  renderAtlasTables(atlasRows);
}

function activeProviderSet() {
  const rows = state.providers.filter((provider) => {
    const selectedProvider = document.getElementById("providerFilter").value;
    const archetype = document.getElementById("archetypeFilter").value;
    const grade = document.getElementById("gradeFilter").value;
    const independence = state.independenceByProvider.get(provider.provider);
    return (!selectedProvider || provider.provider === selectedProvider)
      && (!archetype || provider.infra_model === archetype)
      && (!grade || independence?.independence_grade === grade);
  });
  let providers = new Set(rows.map((row) => row.provider));
  const selectedProviders = providersForSelection();
  if (selectedProviders) {
    providers = new Set([...providers].filter((provider) => selectedProviders.has(provider)));
  }
  const atlasProviders = providersForAtlasFilters();
  if (atlasProviders) {
    providers = new Set([...providers].filter((provider) => atlasProviders.has(provider)));
  }
  return providers;
}

function providersForSelection() {
  if (state.selected.type === "provider") return new Set([state.selected.key]);
  if (state.selected.type === "country") return providersForCountry(state.selected.key);
  if (state.selected.type === "hosting") return providersForHosting(state.selected.key);
  if (state.selected.type === "asn") return providersForAsn(state.selected.key);
  if (state.selected.type === "relationship") return providersForRelationship(state.selected.key);
  if (state.selected.type === "atlas-country") return providersForAtlasCountry(state.selected.key);
  return null;
}

function providersForCountry(country) {
  return new Set(state.providerCountries
    .filter((row) => row.country === country)
    .map((row) => row.provider));
}

function providersForHosting(cluster) {
  return new Set(state.providerHosting
    .filter((row) => row.hosting_cluster === cluster)
    .map((row) => row.provider));
}

function providersForAsn(cluster) {
  const row = state.externalAsnClusters.find((item) => item.asn_cluster === cluster);
  if (row) return new Set(splitExamples(row.provider_examples || ""));
  if (cluster.startsWith("AtlasASN-") && !cluster.slice("AtlasASN-".length).includes("-")) {
    const asn = cluster.slice("AtlasASN-".length);
    return new Set(state.atlasProviderCountryAsn
      .filter((item) => item.asn === asn)
      .map((item) => item.provider));
  }
  const atlasRow = atlasClusterSource(cluster);
  return new Set(atlasRow ? [atlasRow.provider] : []);
}

function providersForRelationship(cluster) {
  const row = state.externalRelationships.find((item) => item.relationship_cluster === cluster);
  return new Set(splitExamples(row?.providers || ""));
}

function providersForAtlasCountry(country) {
  return new Set(state.atlasProviderCountries
    .filter((row) => row.country === country)
    .map((row) => row.provider));
}

function atlasFilterValues() {
  return {
    provider: document.getElementById("providerFilter")?.value || "",
    country: state.atlasFilters.country,
    asn: state.atlasFilters.asn,
    minPrefix: Number(state.atlasFilters.minPrefix) || 0,
    search: state.atlasFilters.search.trim().toLowerCase(),
  };
}

function atlasRowMatches(row, providers = null) {
  const filters = atlasFilterValues();
  if (providers && providers.size && !providers.has(row.provider)) return false;
  if (filters.provider && row.provider !== filters.provider) return false;
  if (filters.country && row.country !== filters.country) return false;
  if (filters.asn && row.asn !== filters.asn) return false;
  if (filters.minPrefix && Number(row.prefix_count || 0) < filters.minPrefix) return false;
  if (filters.search) {
    const haystack = [row.provider, row.country, row.country_code, row.asn, row.operator].join(" ").toLowerCase();
    if (!haystack.includes(filters.search)) return false;
  }
  return true;
}

function filteredAtlasBase(providers = null) {
  return state.atlasProviderCountryAsn.filter((row) => atlasRowMatches(row, providers));
}

function providersForAtlasFilters() {
  const filters = atlasFilterValues();
  if (!filters.provider && !filters.country && !filters.asn && !filters.minPrefix && !filters.search) {
    return null;
  }
  return new Set(filteredAtlasBase(null).map((row) => row.provider));
}

function providerMatchesAtlasFilters(provider) {
  const atlasProviders = providersForAtlasFilters();
  return !atlasProviders || atlasProviders.has(provider);
}

function countriesForProviders(providers) {
  return new Set(state.providerCountries
    .filter((row) => providers.has(row.provider))
    .map((row) => row.country));
}

function clustersForProviders(providers) {
  return new Set(state.providerHosting
    .filter((row) => providers.has(row.provider))
    .map((row) => row.hosting_cluster));
}

function filterCountriesForProviders(providers) {
  if (!providers.size || providers.size === state.providers.length) {
    return state.countries;
  }
  const countryNames = countriesForProviders(providers);
  return state.countries.filter((row) => countryNames.has(row.country));
}

function externalAsnForProvider(provider) {
  return state.externalAsnClusters.filter((row) => splitExamples(row.provider_examples).includes(provider));
}

function atlasAsnForProvider(provider) {
  return state.atlasProviderAsn
    .filter((row) => row.provider === provider)
    .sort((left, right) => Number(right.prefix_count) - Number(left.prefix_count));
}

function externalOperatorsForProvider(provider) {
  return state.externalProviderOperators
    .filter((row) => row.provider === provider)
    .sort((left, right) => Number(right.provider_share) - Number(left.provider_share));
}

function relationshipClustersForProvider(provider) {
  return state.externalRelationships.filter((row) => splitExamples(row.providers).includes(provider));
}

function filterAsnForProviders(providers) {
  if (!providers.size || providers.size === state.providers.length) {
    return state.externalAsnClusters.slice(0, 12);
  }
  const externalRows = state.externalAsnClusters
    .filter((row) => splitExamples(row.provider_examples).some((provider) => providers.has(provider)));
  const atlasRows = atlasAsnToClusterRows(state.atlasProviderAsn
    .filter((row) => providers.has(row.provider)));
  return [...externalRows, ...atlasRows]
    .sort((left, right) => Number(right.provider_count || 0) - Number(left.provider_count || 0))
    .slice(0, 12);
}

function filterRelationshipsForProviders(providers) {
  if (!providers.size || providers.size === state.providers.length) {
    return state.externalRelationships.slice(0, 12);
  }
  return state.externalRelationships
    .filter((row) => splitExamples(row.providers).some((provider) => providers.has(provider)))
    .slice(0, 12);
}

function filterAtlasCountriesForProviders(providers) {
  if (!providers.size || providers.size === state.providers.length) {
    return state.atlasCountries.slice(0, 18);
  }
  const byCountry = new Map();
  for (const row of state.atlasProviderCountries) {
    if (!providers.has(row.provider)) continue;
    if (!byCountry.has(row.country)) {
      byCountry.set(row.country, {
        country: row.country,
        providerSet: new Set(),
        prefix_count: 0,
        asn_count: 0,
        observed_records_bucket: row.observed_records_bucket,
        data_origin: row.data_origin,
      });
    }
    const item = byCountry.get(row.country);
    item.providerSet.add(row.provider);
    item.prefix_count += Number(row.prefix_count) || 0;
    item.asn_count += Number(row.asn_count) || 0;
  }
  return [...byCountry.values()]
    .map((row) => ({
      country: row.country,
      provider_count: row.providerSet.size,
      asn_count: row.asn_count,
      prefix_count: row.prefix_count,
      observed_records_bucket: row.observed_records_bucket,
      data_origin: row.data_origin,
    }))
    .sort((left, right) => Number(right[state.atlasMetric]) - Number(left[state.atlasMetric]))
    .slice(0, 18);
}

function atlasAsnToClusterRows(rows) {
  return rows.map((row) => ({
    asn_cluster: `AtlasASN-${row.provider}-${row.asn}`,
    asn: row.asn,
    operator: row.operator,
    provider_count: 1,
    observed_records_bucket: row.observed_records_bucket,
    provider_examples: row.provider,
    atlas_provider: row.provider,
  }));
}

function atlasClusterSource(cluster) {
  if (!cluster.startsWith("AtlasASN-")) return null;
  return state.atlasProviderAsn.find((row) => `AtlasASN-${row.provider}-${row.asn}` === cluster) || null;
}

function formatOverlaps(overlaps) {
  if (!overlaps.length) return "No high-confidence public overlap pair in archive dataset";
  return overlaps.slice(0, 3).map((row) => {
    const other = row.provider_a === state.selected.key ? row.provider_b : row.provider_a;
    return `${other} ${percent(row.relationship_score)} (${row.confidence})`;
  }).join("; ");
}

function renderMiniRows(title, rows) {
  if (!rows.length) return `<p><strong>${escapeHtml(title)}:</strong> none</p>`;
  return `
    <p><strong>${escapeHtml(title)}</strong></p>
    <div class="mini-list">
      ${rows.map((row) => `
        <div class="mini-row">
          ${row.type ? `<button data-mini-type="${escapeHtml(row.type)}" data-mini-key="${escapeHtml(row.key)}">${escapeHtml(row.label)}</button>` : `<span>${escapeHtml(row.label)}</span>`}
          <strong>${escapeHtml(row.value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function bindMiniRowActions() {
  document.querySelectorAll("[data-mini-type]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.miniType === "asn") selectAsn(button.dataset.miniKey);
      if (button.dataset.miniType === "relationship") selectRelationship(button.dataset.miniKey);
    });
  });
}

function aggregateAtlasCountries(rows) {
  const byCountry = new Map();
  for (const row of rows) {
    if (!row.country || row.country === "Unknown") continue;
    if (!byCountry.has(row.country)) {
      byCountry.set(row.country, {
        country: row.country,
        providerSet: new Set(),
        asnSet: new Set(),
        prefix_count: 0,
        observed_records_bucket: row.observed_records_bucket,
        data_origin: row.data_origin,
      });
    }
    const item = byCountry.get(row.country);
    item.providerSet.add(row.provider);
    if (row.asn && row.asn !== "0") item.asnSet.add(row.asn);
    item.prefix_count += Number(row.prefix_count) || 0;
  }
  return [...byCountry.values()].map((row) => ({
    country: row.country,
    provider_count: row.providerSet.size,
    asn_count: row.asnSet.size,
    prefix_count: row.prefix_count,
    observed_records_bucket: row.observed_records_bucket,
    data_origin: row.data_origin,
  }));
}

function aggregateAtlasBy(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const id = row[key] || "Unknown";
    if (!out.has(id)) {
      out.set(id, {
        key: id,
        providerSet: new Set(),
        countrySet: new Set(),
        asnSet: new Set(),
        prefix_count: 0,
        operator: row.operator || "",
      });
    }
    const item = out.get(id);
    item.providerSet.add(row.provider);
    if (row.country && row.country !== "Unknown") item.countrySet.add(row.country);
    if (row.asn && row.asn !== "0") item.asnSet.add(row.asn);
    item.prefix_count += Number(row.prefix_count) || 0;
    if (!item.operator && row.operator) item.operator = row.operator;
  }
  return [...out.values()].map((row) => ({
    ...row,
    provider_count: row.providerSet.size,
    country_count: row.countrySet.size,
    asn_count: row.asnSet.size,
  })).sort((left, right) => Number(right.prefix_count) - Number(left.prefix_count));
}

function renderAtlasMap(rows) {
  const metric = state.atlasMetric;
  const sortedRows = [...rows].sort((left, right) => Number(right[metric]) - Number(left[metric]));
  const mapEl = document.getElementById("atlasMap");
  if (window.Plotly && sortedRows.length) {
    mapEl.classList.add("plotly-map");
    const values = sortedRows.map((row) => Number(row[metric]) || 0);
    Plotly.react("atlasMap", [{
      type: "choropleth",
      locationmode: "country names",
      locations: sortedRows.map((row) => row.country),
      customdata: sortedRows.map((row) => row.country),
      z: values,
      text: sortedRows.map((row) => `${row.country}: ${formatNumber(row[metric])}`),
      colorscale: [
        [0, "#18202d"],
        [0.28, "#2a6477"],
        [0.62, "#5cc7d8"],
        [1, "#e7b75b"],
      ],
      marker: { line: { color: "rgba(255,255,255,.35)", width: 0.35 } },
      colorbar: {
        title: atlasMetricLabel(metric),
        tickfont: { color: "#828ca2" },
        titlefont: { color: "#c3cad8" },
      },
      hovertemplate: "%{location}<br>%{z:,} " + atlasMetricLabel(metric) + "<extra></extra>",
    }], {
      margin: { t: 4, r: 4, b: 4, l: 4 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      geo: {
        projection: { type: "natural earth" },
        showframe: false,
        showcoastlines: true,
        coastlinecolor: "rgba(255,255,255,.18)",
        showcountries: true,
        countrycolor: "rgba(255,255,255,.16)",
        showland: true,
        landcolor: "#151b25",
        showocean: true,
        oceancolor: "#0b0f16",
        bgcolor: "rgba(0,0,0,0)",
      },
      font: { color: "#c3cad8", family: "Hanken Grotesk, sans-serif" },
    }, {
      displayModeBar: false,
      responsive: true,
    });
    if (mapEl.removeAllListeners) mapEl.removeAllListeners("plotly_click");
    mapEl.on("plotly_click", (event) => {
      const country = event.points && event.points[0] && event.points[0].customdata;
      if (!country) return;
      applyAtlasCountryClick(country);
    });
    return;
  }

  mapEl.classList.remove("plotly-map");
  const tileRows = sortedRows.slice(0, 18);
  const maxMetric = Math.max(...tileRows.map((row) => Number(row[metric]) || 0), 1);
  mapEl.innerHTML = tileRows.map((row) => {
    const heat = Math.max(0.12, (Number(row[metric]) || 0) / maxMetric).toFixed(2);
    return `
      <button class="atlas-tile ${isSelected("atlas-country", row.country)}" style="--heat:${heat}" data-atlas-country="${escapeHtml(row.country)}">
        <strong>${escapeHtml(row.country)}</strong>
        <span>${escapeHtml(row.provider_count)} providers</span>
        <span>${escapeHtml(row.asn_count)} ASNs · ${escapeHtml(row.prefix_count)} prefixes</span>
      </button>
    `;
  }).join("");
  document.querySelectorAll("[data-atlas-country]").forEach((button) => {
    button.addEventListener("click", () => applyAtlasCountryClick(button.dataset.atlasCountry));
  });
}

function renderAtlasTables(rows) {
  const providerRows = aggregateAtlasBy(rows, "provider").slice(0, 8);
  const asnRows = aggregateAtlasBy(rows, "asn").filter((row) => row.key && row.key !== "0").slice(0, 8);
  const countryRows = aggregateAtlasBy(rows, "country").slice(0, 8);
  const providers = new Set(rows.map((row) => row.provider));
  const countries = new Set(rows.map((row) => row.country).filter(Boolean));
  const asns = new Set(rows.map((row) => row.asn).filter((asn) => asn && asn !== "0"));

  document.getElementById("atlasStats").innerHTML = `
    <span><strong>${formatNumber(state.summary.hosting_cluster_count)}</strong> hosting clusters</span>
    <span><strong>${formatNumber(providers.size)}</strong> view atlas providers</span>
    <span><strong>${formatNumber(countries.size)}</strong> view countries</span>
    <span><strong>${formatNumber(asns.size)}</strong> view ASNs</span>
  `;

  document.getElementById("atlasProviderRows").innerHTML = providerRows.map((row) => `
    <button class="mini-row" data-atlas-provider="${escapeHtml(row.key)}">
      <span>${escapeHtml(row.key)}</span>
      <strong>${formatNumber(row.prefix_count)} /24 · ${formatNumber(row.country_count)} countries</strong>
    </button>
  `).join("");
  document.getElementById("atlasAsnRows").innerHTML = asnRows.map((row) => `
    <button class="mini-row" data-atlas-asn="${escapeHtml(row.key)}">
      <span>AS${escapeHtml(row.key)} ${escapeHtml(row.operator || "")}</span>
      <strong>${formatNumber(row.prefix_count)} /24 · ${formatNumber(row.provider_count)} providers</strong>
    </button>
  `).join("");
  document.getElementById("atlasCountryRows").innerHTML = countryRows.map((row) => `
    <button class="mini-row" data-atlas-country="${escapeHtml(row.key)}">
      <span>${escapeHtml(row.key)}</span>
      <strong>${formatNumber(row.prefix_count)} /24 · ${formatNumber(row.provider_count)} providers</strong>
    </button>
  `).join("");
  document.querySelectorAll("[data-atlas-provider]").forEach((button) => {
    button.addEventListener("click", () => applyAtlasProviderClick(button.dataset.atlasProvider));
  });
  document.querySelectorAll("[data-atlas-asn]").forEach((button) => {
    button.addEventListener("click", () => applyAtlasAsnClick(button.dataset.atlasAsn));
  });
  document.querySelectorAll("#atlasCountryRows [data-atlas-country]").forEach((button) => {
    button.addEventListener("click", () => applyAtlasCountryClick(button.dataset.atlasCountry));
  });
}

function atlasMetricLabel(metric) {
  return {
    prefix_count: "/24 prefixes",
    provider_count: "providers",
    asn_count: "ASNs",
  }[metric] || metric;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function markdownToHtml(markdown) {
  const html = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) {
      closeList();
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
    } else {
      closeList();
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  closeList();
  return html.join("");
}

async function openDoc(doc) {
  const modal = document.getElementById("docModal");
  const title = doc === "safety" ? "Data Safety" : "Methodology";
  const text = await loadText(paths[doc]);
  setText("modalTitle", title);
  document.getElementById("modalBody").innerHTML = markdownToHtml(text);
  modal.showModal();
}

function setSelectOptions(select, options, current, allLabel = "All") {
  select.innerHTML = [`<option value="">${escapeHtml(allLabel)}</option>`, ...options.map((option) => `
    <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
  `)].join("");
  select.value = options.some((option) => option.value === current) ? current : "";
  return select.value;
}

function syncAtlasFilterOptions() {
  const countrySelect = document.getElementById("atlasCountryFilter");
  const asnSelect = document.getElementById("atlasAsnFilter");
  if (!countrySelect || !asnSelect) return;

  const countryOptions = [...new Set(atlasRowsForFilterOptions("country").map((row) => row.country).filter(Boolean))]
    .sort()
    .map((name) => ({ value: name, label: name }));
  const asnOptions = [...new Map(atlasRowsForFilterOptions("asn")
    .filter((row) => row.asn && row.asn !== "0")
    .map((row) => [row.asn, { value: row.asn, label: `AS${row.asn}${row.operator ? ` - ${row.operator}` : ""}` }])).values()]
    .sort((left, right) => left.label.localeCompare(right.label));

  state.atlasFilters.country = setSelectOptions(countrySelect, countryOptions, state.atlasFilters.country);
  state.atlasFilters.asn = setSelectOptions(asnSelect, asnOptions, state.atlasFilters.asn);
}

function atlasRowsForFilterOptions(exclude) {
  const provider = document.getElementById("providerFilter")?.value || "";
  const archetype = document.getElementById("archetypeFilter")?.value || "";
  const grade = document.getElementById("gradeFilter")?.value || "";
  const allowed = new Set(state.providers
    .filter((row) => {
      const independence = state.independenceByProvider.get(row.provider);
      return (!provider || row.provider === provider)
        && (!archetype || row.infra_model === archetype)
        && (!grade || independence?.independence_grade === grade);
    })
    .map((row) => row.provider));
  const search = state.atlasFilters.search.trim().toLowerCase();
  return state.atlasProviderCountryAsn.filter((row) => {
    if (!allowed.has(row.provider)) return false;
    if (exclude !== "country" && state.atlasFilters.country && row.country !== state.atlasFilters.country) return false;
    if (exclude !== "asn" && state.atlasFilters.asn && row.asn !== state.atlasFilters.asn) return false;
    if (state.atlasFilters.minPrefix && Number(row.prefix_count || 0) < state.atlasFilters.minPrefix) return false;
    if (search) {
      const haystack = [row.provider, row.country, row.country_code, row.asn, row.operator].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function updateAtlasFilterState() {
  state.atlasFilters = {
    provider: "",
    country: document.getElementById("atlasCountryFilter").value,
    asn: document.getElementById("atlasAsnFilter").value,
    minPrefix: Number(document.getElementById("atlasMinPrefix").value) || 0,
    search: document.getElementById("atlasSearch").value,
  };
  syncAtlasFilterOptions();
  state.selected = { type: "overview", key: "" };
  renderProviders();
  renderSelectionDetails();
  renderStaticPanels();
  renderHosting();
}

function applyAtlasProviderClick(provider) {
  if (document.getElementById("providerFilter").value === provider && isCurrentSelection("provider", provider)) {
    document.getElementById("providerFilter").value = "";
    clearSelection();
  } else {
    document.getElementById("providerFilter").value = provider;
    setSelection("provider", provider);
  }
  syncAtlasFilterOptions();
}

function applyAtlasAsnClick(asn) {
  const key = `AtlasASN-${asn}`;
  if (state.atlasFilters.asn === asn && isCurrentSelection("asn", key)) {
    state.atlasFilters.asn = "";
    document.getElementById("atlasAsnFilter").value = "";
    clearSelection();
  } else {
    state.atlasFilters.asn = asn;
    document.getElementById("atlasAsnFilter").value = asn;
    setSelection("asn", key);
  }
  syncAtlasFilterOptions();
}

function applyAtlasCountryClick(country) {
  if (state.atlasFilters.country === country && isCurrentSelection("atlas-country", country)) {
    state.atlasFilters.country = "";
    document.getElementById("atlasCountryFilter").value = "";
    clearSelection();
  } else {
    state.atlasFilters.country = country;
    document.getElementById("atlasCountryFilter").value = country;
    setSelection("atlas-country", country);
  }
  syncAtlasFilterOptions();
}

function resetFilters() {
  document.getElementById("providerFilter").value = "";
  document.getElementById("archetypeFilter").value = "";
  document.getElementById("gradeFilter").value = "";
  document.getElementById("atlasMetric").value = "prefix_count";
  document.getElementById("atlasCountryFilter").value = "";
  document.getElementById("atlasAsnFilter").value = "";
  document.getElementById("atlasMinPrefix").value = "0";
  document.getElementById("atlasSearch").value = "";
  state.providerSort = { key: "geo", direction: "desc" };
  state.atlasMetric = "prefix_count";
  state.atlasFilters = { provider: "", country: "", asn: "", minPrefix: 0, search: "" };
  state.selected = { type: "overview", key: "" };
  syncAtlasFilterOptions();
  renderProviders();
  renderSelectionDetails();
  renderStaticPanels();
  renderHosting();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function init() {
  const [summary, providers, geo, independence, archetypes, countries, hosting, providerCountries, providerHosting, externalIndependence, externalOverlap, externalAsn, externalOperators, externalProviderOperators, externalRelationships, externalSharedPrefixes, atlasCountries, atlasAsn, atlasProviderCountries, atlasProviderAsn, atlasProviderCountryAsn, tiers] = await Promise.all([
    fetch(paths.summary).then((response) => response.json()),
    loadCsv(paths.providers),
    loadCsv(paths.geo),
    loadCsv(paths.independence),
    loadCsv(paths.archetypes),
    loadCsv(paths.countries),
    loadCsv(paths.hosting),
    loadCsv(paths.providerCountries),
    loadCsv(paths.providerHosting),
    loadCsv(paths.externalIndependence),
    loadCsv(paths.externalOverlap),
    loadCsv(paths.externalAsn),
    loadCsv(paths.externalOperators),
    loadCsv(paths.externalProviderOperators),
    loadCsv(paths.externalRelationships),
    loadCsv(paths.externalSharedPrefixes),
    loadCsv(paths.atlasCountries),
    loadCsv(paths.atlasAsn),
    loadCsv(paths.atlasProviderCountries),
    loadCsv(paths.atlasProviderAsn),
    loadCsv(paths.atlasProviderCountryAsn),
    loadCsv(paths.tiers),
  ]);

  state.providers = providers;
  state.summary = summary;
  state.archetypes = archetypes;
  state.countries = countries.sort((left, right) => Number(right.virtual_location_pressure) - Number(left.virtual_location_pressure));
  state.hosting = hosting;
  state.providerCountries = providerCountries;
  state.providerHosting = providerHosting;
  state.externalIndependenceByProvider = new Map(externalIndependence.map((row) => [row.provider, row]));
  state.externalAsnClusters = externalAsn.sort((left, right) => Number(right.provider_count) - Number(left.provider_count));
  state.externalOperators = externalOperators;
  state.externalProviderOperators = externalProviderOperators;
  state.externalRelationships = externalRelationships.sort((left, right) => Number(right.relationship_score) - Number(left.relationship_score));
  state.externalSharedPrefixes = externalSharedPrefixes;
  state.atlasCountries = atlasCountries.sort((left, right) => Number(right.provider_count) - Number(left.provider_count));
  state.atlasAsn = atlasAsn.sort((left, right) => Number(right.provider_count) - Number(left.provider_count));
  state.atlasProviderCountries = atlasProviderCountries;
  state.atlasProviderAsn = atlasProviderAsn;
  state.atlasProviderCountryAsn = atlasProviderCountryAsn;
  state.externalOverlapByProvider = new Map();
  externalOverlap.forEach((row) => {
    [row.provider_a, row.provider_b].forEach((provider) => {
      if (!state.externalOverlapByProvider.has(provider)) state.externalOverlapByProvider.set(provider, []);
      state.externalOverlapByProvider.get(provider).push(row);
    });
  });
  state.tiers = tiers;
  state.geoByProvider = new Map(geo.map((row) => [row.provider, row]));
  state.independenceByProvider = new Map(independence.map((row) => [row.provider, row]));

  const providerFilter = document.getElementById("providerFilter");
  providers.map((row) => row.provider).sort().forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    providerFilter.append(option);
  });

  const archetypeFilter = document.getElementById("archetypeFilter");
  [...new Set(providers.map((row) => row.infra_model))].sort().forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    archetypeFilter.append(option);
  });
  syncAtlasFilterOptions();

  document.getElementById("providerFilter").addEventListener("change", () => {
    const value = document.getElementById("providerFilter").value;
    state.selected = value ? { type: "provider", key: value } : { type: "overview", key: "" };
    syncAtlasFilterOptions();
    renderProviders();
    renderSelectionDetails();
    renderStaticPanels();
    renderHosting();
  });
  document.getElementById("archetypeFilter").addEventListener("change", () => {
    const value = document.getElementById("archetypeFilter").value;
    state.selected = value ? { type: "archetype", key: value } : { type: "overview", key: "" };
    syncAtlasFilterOptions();
    renderProviders();
    renderSelectionDetails();
    renderStaticPanels();
    renderHosting();
  });
  document.getElementById("gradeFilter").addEventListener("change", () => {
    state.selected = { type: "overview", key: "" };
    syncAtlasFilterOptions();
    renderProviders();
    renderSelectionDetails();
    renderStaticPanels();
    renderHosting();
  });
  document.getElementById("atlasMetric").addEventListener("change", () => {
    state.atlasMetric = document.getElementById("atlasMetric").value;
    renderStaticPanels();
  });
  ["atlasCountryFilter", "atlasAsnFilter", "atlasMinPrefix"].forEach((id) => {
    document.getElementById(id).addEventListener("change", updateAtlasFilterState);
  });
  document.getElementById("atlasSearch").addEventListener("input", updateAtlasFilterState);
  document.getElementById("resetFilters").addEventListener("click", resetFilters);
  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      state.providerSort = {
        key,
        direction: state.providerSort.key === key && state.providerSort.direction === "desc" ? "asc" : "desc",
      };
      renderProviders();
    });
  });
  document.querySelectorAll("[data-hosting-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.hostingSort;
      state.hostingSort = {
        key,
        direction: state.hostingSort.key === key && state.hostingSort.direction === "desc" ? "asc" : "desc",
      };
      renderHosting();
    });
  });
  document.querySelectorAll("[data-doc]").forEach((button) => {
    button.addEventListener("click", () => openDoc(button.dataset.doc));
  });
  document.getElementById("modalClose").addEventListener("click", () => document.getElementById("docModal").close());

  renderProviders();
  renderSelectionDetails();
  renderStaticPanels();
  renderHosting();
}

init().catch((error) => {
  document.body.innerHTML = `<main class="error"><h1>Dashboard load failed</h1><p>${escapeHtml(error.message)}</p></main>`;
});
