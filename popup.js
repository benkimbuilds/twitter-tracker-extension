const DAILY_COUNTS_KEY = "twitterDailyCounts";
const CHART_DAYS = 14;
const SVG_NS = "http://www.w3.org/2000/svg";

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateKeyForOffset(offset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLabel(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function getChartData(dailyCounts) {
  return Array.from({ length: CHART_DAYS }, (_, index) => {
    const offset = index - (CHART_DAYS - 1);
    const dateKey = getDateKeyForOffset(offset);
    return {
      dateKey,
      count: dailyCounts[dateKey] ?? 0
    };
  });
}

function clearChart() {
  const chart = document.getElementById("historyChart");
  while (chart.firstChild) {
    chart.removeChild(chart.firstChild);
  }
  return chart;
}

function appendSvgElement(parent, tagName, attributes) {
  const element = document.createElementNS(SVG_NS, tagName);
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, String(value));
  });
  parent.appendChild(element);
  return element;
}

function renderChart(dailyCounts) {
  const chart = clearChart();
  const data = getChartData(dailyCounts);
  const values = data.map((entry) => entry.count);
  const maxValue = Math.max(...values, 1);
  const width = 320;
  const height = 180;
  const padding = { top: 18, right: 34, bottom: 20, left: 12 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const yAxisTicks = Array.from({ length: 4 }, (_, index) => {
    const ratio = 1 - index / 3;
    return {
      value: Math.round(maxValue * ratio),
      y: padding.top + (innerHeight / 3) * index
    };
  });

  appendSvgElement(chart, "path", {
    d: `M ${padding.left} ${padding.top} H ${width - padding.right} V ${height - padding.bottom} H ${padding.left} Z`,
    fill: "rgba(255,255,255,0.02)",
    stroke: "rgba(255,255,255,0.06)"
  });

  yAxisTicks.forEach(({ value, y }) => {
    appendSvgElement(chart, "line", {
      x1: padding.left,
      y1: y,
      x2: width - padding.right,
      y2: y,
      stroke: "rgba(255,255,255,0.08)",
      "stroke-dasharray": "4 6"
    });

    appendSvgElement(chart, "text", {
      x: width - padding.right + 8,
      y: y + 4,
      fill: "rgba(139,152,165,0.92)",
      "font-size": "10",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "text-anchor": "start"
    }).textContent = String(value);
  });

  const points = data.map((entry, index) => {
    const x = padding.left + (innerWidth / (data.length - 1)) * index;
    const y = padding.top + innerHeight - (entry.count / maxValue) * innerHeight;
    return { x, y, count: entry.count };
  });

  const polylinePoints = points.map(({ x, y }) => `${x},${y}`).join(" ");
  appendSvgElement(chart, "polyline", {
    points: polylinePoints,
    fill: "none",
    stroke: "#1d9bf0",
    "stroke-width": "3",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });

  points.forEach(({ x, y, count }) => {
    appendSvgElement(chart, "circle", {
      cx: x,
      cy: y,
      r: 4,
      fill: "#0f1419",
      stroke: "#86cbff",
      "stroke-width": "2"
    }).appendChild(document.createElementNS(SVG_NS, "title")).textContent = `${count} opens`;
  });

  document.getElementById("startLabel").textContent = formatLabel(data[0].dateKey);
  document.getElementById("endLabel").textContent = formatLabel(data[data.length - 1].dateKey);
}

async function getDailyCounts() {
  const stored = await chrome.storage.local.get(DAILY_COUNTS_KEY);
  const dailyCounts = stored[DAILY_COUNTS_KEY];

  if (!dailyCounts || typeof dailyCounts !== "object" || Array.isArray(dailyCounts)) {
    return {};
  }

  return dailyCounts;
}

async function renderPopup() {
  const dailyCounts = await getDailyCounts();
  document.getElementById("todayCount").textContent = String(dailyCounts[getTodayKey()] ?? 0);
  renderChart(dailyCounts);
}

async function resetToday() {
  const dailyCounts = await getDailyCounts();
  dailyCounts[getTodayKey()] = 0;
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: dailyCounts });
}

async function clearHistory() {
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: {} });
}

document.getElementById("resetTodayButton").addEventListener("click", resetToday);
document.getElementById("clearHistoryButton").addEventListener("click", clearHistory);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[DAILY_COUNTS_KEY]) {
    return;
  }

  const dailyCounts = changes[DAILY_COUNTS_KEY].newValue ?? {};
  document.getElementById("todayCount").textContent = String(dailyCounts[getTodayKey()] ?? 0);
  renderChart(dailyCounts);
});

renderPopup();
