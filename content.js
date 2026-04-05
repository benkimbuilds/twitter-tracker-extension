const DAILY_COUNTS_KEY = "twitterDailyCounts";
const BADGE_POSITION_KEY = "twitterTrackerBadgePosition";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const BLOCKED_SITES_KEY = "twitterTrackerBlockedSites";
const BADGE_ID = "twitter-open-tracker-badge";
const BLOCKER_ID = "twitter-open-tracker-blocker";
const TRACKED_SITES = {
  facebook: {
    domains: ["facebook.com"],
    label: "Facebook"
  },
  instagram: {
    domains: ["instagram.com"],
    label: "Instagram"
  },
  linkedin: {
    domains: ["linkedin.com"],
    label: "LinkedIn"
  },
  twitter: {
    domains: ["x.com", "twitter.com"],
    label: "Twitter"
  },
  youtube: {
    domains: ["youtube.com"],
    label: "YouTube"
  }
};
const TRACKED_SITE_IDS = Object.keys(TRACKED_SITES);
const DEFAULT_BADGE_POSITION = { top: 16, left: null, right: 16 };
let currentBadgeCount = 0;
let isBlockModeEnabled = false;
let blockedSitesState = Object.fromEntries(TRACKED_SITE_IDS.map((siteId) => [siteId, true]));

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function getCurrentSiteId() {
  return (
    Object.entries(TRACKED_SITES).find(([, site]) =>
      site.domains.some((domain) => matchesDomain(window.location.hostname, domain))
    )?.[0] ?? null
  );
}

function normalizeDayEntry(entry) {
  if (typeof entry === "number") {
    return {
      total: entry,
      sites: entry > 0 ? { twitter: entry } : {}
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {
      total: 0,
      sites: {}
    };
  }

  const sites =
    entry.sites && typeof entry.sites === "object" && !Array.isArray(entry.sites)
      ? Object.fromEntries(
          Object.entries(entry.sites)
            .filter(([siteId, count]) => siteId in TRACKED_SITES && Number.isFinite(count) && count > 0)
            .map(([siteId, count]) => [siteId, count])
        )
      : {};
  const derivedTotal = Object.values(sites).reduce((sum, count) => sum + count, 0);
  const total = Number.isFinite(entry.total) && entry.total >= derivedTotal ? entry.total : derivedTotal;

  return {
    total,
    sites
  };
}

function normalizeBlockedSites(blockedSites) {
  if (!blockedSites || typeof blockedSites !== "object" || Array.isArray(blockedSites)) {
    return Object.fromEntries(TRACKED_SITE_IDS.map((siteId) => [siteId, true]));
  }

  return Object.fromEntries(
    TRACKED_SITE_IDS.map((siteId) => [siteId, blockedSites[siteId] !== false])
  );
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyBadgePosition(badge, position = DEFAULT_BADGE_POSITION) {
  badge.style.top = `${position.top ?? DEFAULT_BADGE_POSITION.top}px`;
  badge.style.left = position.left == null ? "auto" : `${position.left}px`;
  badge.style.right = position.right == null ? "auto" : `${position.right}px`;
}

async function saveBadgePosition(position) {
  await chrome.storage.local.set({ [BADGE_POSITION_KEY]: position });
}

async function loadBadgePosition() {
  const stored = await chrome.storage.local.get(BADGE_POSITION_KEY);
  const position = stored[BADGE_POSITION_KEY];

  if (!position || typeof position !== "object" || Array.isArray(position)) {
    return DEFAULT_BADGE_POSITION;
  }

  return {
    top: typeof position.top === "number" ? position.top : DEFAULT_BADGE_POSITION.top,
    left: typeof position.left === "number" ? position.left : null,
    right: typeof position.right === "number" ? position.right : null
  };
}

function enableDragging(badge) {
  if (badge.dataset.dragEnabled === "true") {
    return;
  }

  badge.dataset.dragEnabled = "true";

  let dragState = null;
  let didDrag = false;

  badge.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const rect = badge.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height
    };

    didDrag = false;
    badge.setPointerCapture(event.pointerId);
    badge.classList.add("is-dragging");
    event.preventDefault();
  });

  badge.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }

    const movedX = Math.abs(event.clientX - dragState.startX);
    const movedY = Math.abs(event.clientY - dragState.startY);
    if (movedX > 4 || movedY > 4) {
      didDrag = true;
    }

    const maxLeft = window.innerWidth - dragState.width - 8;
    const maxTop = window.innerHeight - dragState.height - 8;
    const left = clamp(event.clientX - dragState.offsetX, 8, Math.max(8, maxLeft));
    const top = clamp(event.clientY - dragState.offsetY, 8, Math.max(8, maxTop));

    applyBadgePosition(badge, { top, left, right: null });
  });

  async function finishDrag(event) {
    if (!dragState) {
      return;
    }

    const rect = badge.getBoundingClientRect();
    const position = {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      right: null
    };

    dragState = null;
    badge.classList.remove("is-dragging");

    if (event.pointerId != null && badge.hasPointerCapture(event.pointerId)) {
      badge.releasePointerCapture(event.pointerId);
    }

    await saveBadgePosition(position);

    if (!didDrag) {
      await chrome.runtime.sendMessage({ type: "OPEN_TRACKER_POPUP", siteId: getCurrentSiteId() });
    }
  }

  badge.addEventListener("pointerup", finishDrag);
  badge.addEventListener("pointercancel", finishDrag);
}

function ensureBadge() {
  let badge = document.getElementById(BADGE_ID);

  if (badge) {
    return badge;
  }

  badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.setAttribute("aria-live", "polite");
  badge.title = "Drag to move";
  document.documentElement.appendChild(badge);
  enableDragging(badge);
  return badge;
}

function ensureBlocker() {
  let blocker = document.getElementById(BLOCKER_ID);

  if (blocker) {
    return blocker;
  }

  blocker = document.createElement("section");
  blocker.id = BLOCKER_ID;
  blocker.hidden = true;
  blocker.tabIndex = -1;
  blocker.setAttribute("aria-live", "polite");
  blocker.innerHTML = `
    <div class="twitter-open-tracker-blocker__panel">
      <p class="twitter-open-tracker-blocker__eyebrow">Block mode on</p>
      <h1 class="twitter-open-tracker-blocker__title"></h1>
      <p class="twitter-open-tracker-blocker__copy"></p>
      <p class="twitter-open-tracker-blocker__count"></p>
      <button class="twitter-open-tracker-blocker__button" type="button">Open tracker controls</button>
    </div>
  `;

  blocker.querySelector("button")?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "OPEN_TRACKER_POPUP", siteId: getCurrentSiteId() });
  });

  document.documentElement.appendChild(blocker);
  return blocker;
}

function getTodayCount(dailyCounts, siteId) {
  if (!dailyCounts || typeof dailyCounts !== "object") {
    return 0;
  }

  const todayEntry = normalizeDayEntry(dailyCounts[getTodayKey()]);
  return todayEntry.sites[siteId] ?? 0;
}

function getTodayTotal(dailyCounts) {
  if (!dailyCounts || typeof dailyCounts !== "object") {
    return 0;
  }

  return normalizeDayEntry(dailyCounts[getTodayKey()]).total;
}

function getBadgeCount(dailyCounts, siteId) {
  return siteId ? getTodayCount(dailyCounts, siteId) : getTodayTotal(dailyCounts);
}

function renderCount(count) {
  const badge = ensureBadge();
  const siteId = getCurrentSiteId();
  const siteLabel = siteId ? TRACKED_SITES[siteId].label : "All tracked sites";
  badge.textContent = "👀";
  badge.setAttribute("aria-label", `${siteLabel} opens today: ${count}`);
}

function renderBlocker(count) {
  const blocker = ensureBlocker();
  const siteId = getCurrentSiteId();
  const siteLabel = siteId ? TRACKED_SITES[siteId].label : "This site";
  blocker.querySelector(".twitter-open-tracker-blocker__title").textContent = `${siteLabel} is blocked`;
  blocker.querySelector(".twitter-open-tracker-blocker__copy").textContent =
    `Social Open Tracker is hiding ${siteLabel} until you switch that site's blocker off.`;
  blocker.querySelector(".twitter-open-tracker-blocker__count").textContent =
    `Today's ${siteLabel} opens: ${count}`;
}

function isCurrentSiteBlocked() {
  const currentSiteId = getCurrentSiteId();
  return currentSiteId !== null && isBlockModeEnabled && blockedSitesState[currentSiteId] === true;
}

function renderSurface() {
  const badge = ensureBadge();
  const blocker = ensureBlocker();
  const shouldShowBlocker = isCurrentSiteBlocked();

  badge.hidden = shouldShowBlocker;
  blocker.hidden = !shouldShowBlocker;
  document.documentElement.classList.toggle("twitter-open-tracker-page-blocked", shouldShowBlocker);

  if (shouldShowBlocker) {
    renderBlocker(currentBadgeCount);
    blocker.focus({ preventScroll: true });
    return;
  }

  renderCount(currentBadgeCount);
}

async function initializeBadge() {
  const siteId = getCurrentSiteId();
  const [storedValues, storedPosition] = await Promise.all([
    chrome.storage.local.get([DAILY_COUNTS_KEY, BLOCK_MODE_KEY, BLOCKED_SITES_KEY]),
    loadBadgePosition()
  ]);
  const badge = ensureBadge();

  applyBadgePosition(badge, storedPosition);
  currentBadgeCount = getBadgeCount(storedValues[DAILY_COUNTS_KEY], siteId);
  isBlockModeEnabled = storedValues[BLOCK_MODE_KEY] === true;
  blockedSitesState = normalizeBlockedSites(storedValues[BLOCKED_SITES_KEY]);
  renderSurface();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[DAILY_COUNTS_KEY]) {
    currentBadgeCount = getBadgeCount(changes[DAILY_COUNTS_KEY].newValue, getCurrentSiteId());
  }

  if (changes[BADGE_POSITION_KEY]) {
    applyBadgePosition(ensureBadge(), changes[BADGE_POSITION_KEY].newValue ?? DEFAULT_BADGE_POSITION);
  }

  if (changes[BLOCK_MODE_KEY]) {
    isBlockModeEnabled = changes[BLOCK_MODE_KEY].newValue === true;
  }

  if (changes[BLOCKED_SITES_KEY]) {
    blockedSitesState = normalizeBlockedSites(changes[BLOCKED_SITES_KEY].newValue);
  }

  renderSurface();
});

window.addEventListener("resize", async () => {
  const badge = document.getElementById(BADGE_ID);
  if (!badge) {
    return;
  }

  const rect = badge.getBoundingClientRect();
  const top = clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 8));
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8));
  const position = {
    top: Math.round(top),
    left: Math.round(left),
    right: null
  };

  applyBadgePosition(badge, position);
  await saveBadgePosition(position);
});

initializeBadge();
