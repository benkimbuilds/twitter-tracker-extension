const CUSTOM_SITES_KEY = "twitterTrackerCustomSites";
const DEFAULT_SITE_ID = "twitter";
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
