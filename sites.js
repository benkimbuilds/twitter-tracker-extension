const CUSTOM_SITES_KEY = "twitterTrackerCustomSites";
const STAY_HARD_ENABLED_KEY = "twitterTrackerStayHardEnabled";
const BLOCKED_OPEN_MINUTES_KEY = "twitterTrackerBlockedOpenMinutes";
const TIMED_BLOCKS_KEY = "twitterTrackerTimedBlocks";
const HISTORY_EXCLUDED_SITES_KEY = "twitterTrackerHistoryExcludedSites";
const DEFAULT_SITE_ID = "twitter";
const DEFAULT_BLOCKED_OPEN_MINUTES = 10;
const MIN_BLOCKED_OPEN_MINUTES = 0;
const MAX_BLOCKED_OPEN_MINUTES = 180;
const DEFAULT_BLOCK_TIMER_MINUTES = 30;
const MIN_BLOCK_TIMER_MINUTES = 1;
const MAX_BLOCK_TIMER_MINUTES = 1440;
const DEFAULT_TRACKED_SITES = [
  {
    id: "linkedin",
    label: "LinkedIn",
    domains: ["linkedin.com"],
    isCustom: false
  },
  {
    id: "youtube",
    label: "YouTube",
    domains: ["youtube.com"],
    isCustom: false
  },
  {
    id: "twitter",
    label: "Twitter",
    domains: ["x.com", "twitter.com"],
    isCustom: false
  },
  {
    id: "facebook",
    label: "Facebook",
    domains: ["facebook.com"],
    isCustom: false
  },
  {
    id: "instagram",
    label: "Instagram",
    domains: ["instagram.com"],
    isCustom: false
  }
];

function cloneTrackedSite(site) {
  return {
    id: site.id,
    label: site.label,
    domains: [...site.domains],
    isCustom: site.isCustom === true
  };
}

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function normalizeDomainInput(value) {
  if (typeof value !== "string") {
    return null;
  }

  let normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    return null;
  }

  if (!/^[a-z][a-z\d+.-]*:\/\//.test(normalizedValue)) {
    normalizedValue = `https://${normalizedValue}`;
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    let hostname = parsedUrl.hostname.trim().toLowerCase();

    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }

    if (!hostname || hostname.includes(" ") || !hostname.includes(".")) {
      return null;
    }

    return hostname;
  } catch {
    return null;
  }
}

function createCustomSiteId(domain) {
  return `custom:${domain}`;
}

function createCustomSite(value) {
  const domain = normalizeDomainInput(value);
  if (!domain) {
    return null;
  }

  return {
    id: createCustomSiteId(domain),
    label: domain,
    domains: [domain],
    isCustom: true
  };
}

function normalizeCustomSite(site) {
  if (!site || typeof site !== "object" || Array.isArray(site)) {
    return null;
  }

  const domains = Array.isArray(site.domains)
    ? [...new Set(site.domains.map(normalizeDomainInput).filter(Boolean))]
    : [];
  const primaryDomain = domains[0];

  if (!primaryDomain) {
    return null;
  }

  const label =
    typeof site.label === "string" && site.label.trim() ? site.label.trim() : primaryDomain;
  const id =
    typeof site.id === "string" && site.id.startsWith("custom:") && site.id.trim()
      ? site.id.trim()
      : createCustomSiteId(primaryDomain);

  return {
    id,
    label,
    domains,
    isCustom: true
  };
}

function normalizeCustomSites(customSites) {
  if (!Array.isArray(customSites)) {
    return [];
  }

  const seenSiteIds = new Set(DEFAULT_TRACKED_SITES.map((site) => site.id));
  const normalizedSites = [];

  customSites.forEach((site) => {
    const normalizedSite = normalizeCustomSite(site);
    if (!normalizedSite || seenSiteIds.has(normalizedSite.id)) {
      return;
    }

    seenSiteIds.add(normalizedSite.id);
    normalizedSites.push(normalizedSite);
  });

  return normalizedSites;
}

function getTrackedSites(customSites) {
  return [...DEFAULT_TRACKED_SITES.map(cloneTrackedSite), ...normalizeCustomSites(customSites)];
}

function getTrackedSiteMap(customSites) {
  return Object.fromEntries(getTrackedSites(customSites).map((site) => [site.id, site]));
}

function getTrackedSiteIds(customSites) {
  return getTrackedSites(customSites).map((site) => site.id);
}

function getFallbackSiteId(customSites) {
  const trackedSites = getTrackedSites(customSites);
  return trackedSites.some((site) => site.id === DEFAULT_SITE_ID)
    ? DEFAULT_SITE_ID
    : (trackedSites[0]?.id ?? null);
}

function findTrackedSiteIdByHostname(hostname, customSites) {
  if (typeof hostname !== "string" || !hostname) {
    return null;
  }

  const normalizedHostname = hostname.toLowerCase();
  return (
    getTrackedSites(customSites).find((site) =>
      site.domains.some((domain) => matchesDomain(normalizedHostname, domain))
    )?.id ?? null
  );
}

function findTrackedSiteIdByUrl(url, customSites) {
  if (!url) {
    return null;
  }

  try {
    return findTrackedSiteIdByHostname(new URL(url).hostname, customSites);
  } catch {
    return null;
  }
}

function normalizeBlockedSites(blockedSites, customSites) {
  const trackedSiteIds = getTrackedSiteIds(customSites);

  if (!blockedSites || typeof blockedSites !== "object" || Array.isArray(blockedSites)) {
    return Object.fromEntries(trackedSiteIds.map((siteId) => [siteId, true]));
  }

  return Object.fromEntries(
    trackedSiteIds.map((siteId) => [siteId, blockedSites[siteId] !== false])
  );
}

function normalizeHistoryExcludedSites(historyExcludedSites, customSites) {
  const trackedSiteIds = getTrackedSiteIds(customSites);

  if (!historyExcludedSites || typeof historyExcludedSites !== "object" || Array.isArray(historyExcludedSites)) {
    return Object.fromEntries(trackedSiteIds.map((siteId) => [siteId, false]));
  }

  return Object.fromEntries(
    trackedSiteIds.map((siteId) => [siteId, historyExcludedSites[siteId] === true])
  );
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeBlockedOpenMinutes(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_BLOCKED_OPEN_MINUTES;
  }

  return Math.min(MAX_BLOCKED_OPEN_MINUTES, Math.max(MIN_BLOCKED_OPEN_MINUTES, Math.round(value)));
}

function normalizeBlockTimerMinutes(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_BLOCK_TIMER_MINUTES;
  }

  return Math.min(MAX_BLOCK_TIMER_MINUTES, Math.max(MIN_BLOCK_TIMER_MINUTES, Math.round(value)));
}

function normalizeTimedBlocks(timedBlocks, customSites, now = Date.now()) {
  const trackedSiteMap = getTrackedSiteMap(customSites);

  if (!timedBlocks || typeof timedBlocks !== "object" || Array.isArray(timedBlocks)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(timedBlocks)
      .filter(
        ([siteId, expiresAt]) =>
          siteId in trackedSiteMap && Number.isFinite(expiresAt) && Math.round(expiresAt) > now
      )
      .map(([siteId, expiresAt]) => [siteId, Math.round(expiresAt)])
  );
}

function getTimedBlockExpiry(siteId, timedBlocks, now = Date.now()) {
  if (!siteId || !timedBlocks || typeof timedBlocks !== "object" || Array.isArray(timedBlocks)) {
    return null;
  }

  const expiresAt = timedBlocks[siteId];
  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  const roundedExpiry = Math.round(expiresAt);
  return roundedExpiry > now ? roundedExpiry : null;
}

function getRemainingMinutesUntil(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.ceil((timestamp - now) / 60000));
}

function getSiteBlockState(
  siteId,
  { isBlockModeEnabled = false, blockedSites = {}, timedBlocks = {}, now = Date.now() } = {}
) {
  const timedBlockExpiresAt = getTimedBlockExpiry(siteId, timedBlocks, now);

  if (timedBlockExpiresAt) {
    return {
      isBlocked: true,
      reason: "timer",
      timedBlockExpiresAt,
      remainingMinutes: getRemainingMinutesUntil(timedBlockExpiresAt, now)
    };
  }

  const isBlockedByMode = Boolean(siteId) && isBlockModeEnabled && blockedSites[siteId] === true;

  return {
    isBlocked: isBlockedByMode,
    reason: isBlockedByMode ? "mode" : null,
    timedBlockExpiresAt: null,
    remainingMinutes: 0
  };
}

function createEmptyDayEntry() {
  return {
    total: 0,
    sites: {},
    blockedTotal: 0,
    blockedSites: {},
    savedMinutes: 0,
    savedSites: {}
  };
}

function normalizeTrackedMetricMap(metricMap, trackedSiteMap) {
  if (!metricMap || typeof metricMap !== "object" || Array.isArray(metricMap)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metricMap)
      .filter(([siteId, count]) => siteId in trackedSiteMap && Number.isFinite(count) && count > 0)
      .map(([siteId, count]) => [siteId, Math.round(count)])
  );
}

function normalizeDayEntry(entry, trackedSiteMap) {
  if (typeof entry === "number") {
    return {
      ...createEmptyDayEntry(),
      total: entry,
      sites: entry > 0 && trackedSiteMap.twitter ? { twitter: entry } : {}
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return createEmptyDayEntry();
  }

  const sites = normalizeTrackedMetricMap(entry.sites, trackedSiteMap);
  const blockedSites = normalizeTrackedMetricMap(entry.blockedSites, trackedSiteMap);
  const savedSites = normalizeTrackedMetricMap(entry.savedSites, trackedSiteMap);
  const derivedTotal = Object.values(sites).reduce((sum, count) => sum + count, 0);
  const derivedBlockedTotal = Object.values(blockedSites).reduce((sum, count) => sum + count, 0);
  const derivedSavedMinutes = Object.values(savedSites).reduce((sum, minutes) => sum + minutes, 0);

  return {
    total: Number.isFinite(entry.total) && entry.total >= derivedTotal ? Math.round(entry.total) : derivedTotal,
    sites,
    blockedTotal:
      Number.isFinite(entry.blockedTotal) && entry.blockedTotal >= derivedBlockedTotal
        ? Math.round(entry.blockedTotal)
        : derivedBlockedTotal,
    blockedSites,
    savedMinutes:
      Number.isFinite(entry.savedMinutes) && entry.savedMinutes >= derivedSavedMinutes
        ? Math.round(entry.savedMinutes)
        : derivedSavedMinutes,
    savedSites
  };
}

function normalizeDailyCounts(dailyCounts, trackedSiteMap) {
  if (!dailyCounts || typeof dailyCounts !== "object" || Array.isArray(dailyCounts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(dailyCounts).map(([dateKey, entry]) => [dateKey, normalizeDayEntry(entry, trackedSiteMap)])
  );
}
