import { initTags, tagMarkup, refreshTags, displayItem, titleEditMarkup } from './tag-ui.js?v=1789544929620';

const initialMonth = new Date();
initialMonth.setHours(0, 0, 0, 0);

const state = {
  view: "product",
  kind: "product",
  sourceType: "all",
  brand: "",
  status: "all",
  dateScope: "month",
  q: "",
  from: iso(new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1)),
  to: iso(monthEnd(initialMonth.getFullYear(), initialMonth.getMonth())),
  items: [],
  brands: [],
  months: [],
  totals: {},
  productPatrol: [],
  officialStats: null,
  visibleMonth: new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1),
  selectedDate: "",
  sourceQuery: "",
  sourceStatus: "all",
  displayMode: "cards",
  timelineLimit: 0
};

const $ = (selector) => document.querySelector(selector);
const calendar = $("#calendar");
const timeline = $("#timeline");
const brandSelect = $("#brandSelect");
const sourceMeta = $("#sourceMeta");
const isStaticSite = Boolean(window.CALENDAR_STATIC_DATA_URL);
let activeRequest = null;
let loadSeq = 0;
let currentDetailItem = null;
const SLOW_SOURCE_MS = 8000;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function compactText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthEnd(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}

function dateLabel(item) {
  const start = item.displayDate || (item.precision === "month" ? item.date.slice(0, 7) : item.date.slice(5));
  const end = item.endDate && item.endDate !== item.date
    ? `~${item.endDate.slice(0, 4) === item.date.slice(0, 4) ? item.endDate.slice(5) : item.endDate}`
    : "";
  return `${start}${end}`;
}

function precisionLabel(item) {
  if (item.precision === "monthEnd") return "月份范围";
  return item.precision === "month" ? "月份待确认" : "日期";
}

function eventDateTimeLabel(item) {
  const range = item.endDate && item.endDate !== item.date
    ? `${formatFullDate(item.date)} 至 ${formatFullDate(item.endDate)}`
    : formatFullDate(item.date);
  return `${range}${item.time ? ` ${item.time}` : ""}`;
}

function eventTableDateLabel(item) {
  const start = formatFullDate(item.date);
  if (!item.endDate || item.endDate === item.date) return start;
  return `${start} 至 ${formatFullDate(item.endDate)}`;
}

function eventLocationLabel(item) {
  const city = item.city || "";
  const address = item.address || "";
  if (city && address && !address.includes(city)) return `${city}｜${address}`;
  return address || city || "地址未填写";
}

function eventPrizeLabel(item) {
  return item.prize || "奖品未填写";
}

function eventPrizeSummary(item, maxLength = 54) {
  const prize = eventPrizeLabel(item).replace(/\s+/g, " ").trim();
  if (prize.length <= maxLength) return prize;
  return `${prize.slice(0, maxLength).replace(/[，、；;：:\s]+$/, "")}...`;
}

function sourceLabel(item) {
  if ((item.sourceTypes || []).includes("official") && (item.sourceTypes || []).includes("news")) return "官网+后台";
  return item.sourceType === "official" ? "官网巡查" : "后台新闻";
}

function itemSources(item) {
  if (Array.isArray(item.sources) && item.sources.length) return item.sources;
  if (!item.sourceUrl && !item.sourceName) return [];
  return [{ type: item.sourceType || "news", name: item.sourceName || sourceLabel(item), url: item.sourceUrl || "" }];
}

function sourceButtonLabel(source) {
  if (source.type === "official") return "官网";
  if (source.type === "news") return "后台";
  return "来源";
}

function eventSourceButtonLabel(source) {
  const name = source.name || "";
  if (/战报|结果|落幕/.test(name) || source.type === "result") return "战报原链接";
  if (/报名/.test(name)) return "报名原链接";
  return "原链接";
}

function sourceTypeLabel(value) {
  if (value === "official") return "官网巡查";
  if (value === "news") return "后台新闻";
  return "全部来源";
}

function eventStatusLabel(value) {
  if (value === "past") return "过往赛事";
  if (value === "upcoming") return "未来赛事";
  return "全部赛事";
}

function itemThumb(item) {
  return item.kind === "event" ? defaultThumb(item.kind, item.sourceType) : (item.image || defaultThumb(item.kind, item.sourceType));
}

function statusLabel(value) {
  if (value === "upcoming") return "未开始";
  if (value === "past") return "已过去";
  return "全部状态";
}

function formatFullDate(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : value;
}

function dateRangeText() {
  if (!state.from && !state.to) return "不限日期";
  if (state.from && state.to && state.from === state.to) return formatFullDate(state.from);
  return `${state.from ? formatFullDate(state.from) : "不限"} 至 ${state.to ? formatFullDate(state.to) : "不限"}`;
}

function visibleItems() {
  if (!state.selectedDate) return state.items;
  return state.items.filter((item) => item.date <= state.selectedDate && (item.endDate || item.date) >= state.selectedDate);
}

function monthSummary(items) {
  const buckets = new Map();
  for (const item of items) {
    const key = item.date.slice(0, 7);
    const bucket = buckets.get(key) || { month: key, product: 0, event: 0, total: 0 };
    bucket[item.kind] = (bucket[item.kind] || 0) + 1;
    bucket.total += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function staticFilterItems(items) {
  const kind = state.kind || "all";
  const sourceType = state.sourceType || "all";
  const q = compactText(state.q || "").toLowerCase();
  const month = visibleMonthKey();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return items.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (state.brand && item.brand !== state.brand) return false;
    if (sourceType !== "all" && !(item.sourceTypes || [item.sourceType || "news"]).includes(sourceType)) return false;
    if (state.dateScope === "month" && month && !state.from && !state.to) {
      const monthStart = `${month}-01`;
      const [year, monthNumber] = month.split("-").map(Number);
      const monthFinish = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;
      if ((item.endDate || item.date) < monthStart || item.date > monthFinish) return false;
    }
    if (state.from && (item.endDate || item.date) < state.from) return false;
    if (state.to && item.date > state.to) return false;
    if (state.status === "upcoming" && new Date(`${item.endDate || item.date}T00:00:00`) < today) return false;
    if (state.status === "past" && new Date(`${item.date}T00:00:00`) >= today) return false;
    if (q) {
      const sourceText = itemSources(item).map((source) => `${source.name} ${source.url}`).join(" ");
      const haystack = `${item.title} ${item.originalTitle || ""} ${item.brand} ${item.type} ${item.city} ${item.address} ${item.sourceName} ${sourceText}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

async function loadStaticCalendarData(signal) {
  const url = window.CALENDAR_STATIC_DATA_URL;
  if (!url) return null;
  if (!window.staticCalendarCache) {
    const response = await fetch(url, { signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    window.staticCalendarCache = await response.json();
  }
  const base = window.staticCalendarCache;
  const items = staticFilterItems((base.items || []).map(displayItem));
  return {
    ...base,
    items,
    months: monthSummary(items),
    totals: { ...(base.totals || {}), filtered: items.length },
    fromStaticSnapshot: true
  };
}

function sortedSources(item) {
  return itemSources(item).sort((a, b) => {
    if (a.type === b.type) return String(a.name).localeCompare(String(b.name), "zh-CN");
    if (a.type === "official") return -1;
    if (b.type === "official") return 1;
    if (a.type === "result") return -1;
    if (b.type === "result") return 1;
    return 0;
  });
}

function compactSources(item) {
  const result = [];
  const seenTypes = new Set();
  for (const source of sortedSources(item).filter((entry) => entry.url)) {
    const type = source.type || "source";
    if (seenTypes.has(type)) continue;
    seenTypes.add(type);
    result.push(source);
  }
  return result.slice(0, 2);
}

function sourceBrandLabel(gameKey) {
  const labels = {
    pkm: "宝可梦",
    ygo: "游戏王",
    ygo_rd: "游戏王 Rush",
    ws: "WS黑白双翼",
    ua: "UA",
    vg: "VG",
    gundam: "高达",
    dgm: "数码宝贝",
    dm: "决斗大师",
    op: "航海王",
    hololive: "hololive",
    conan: "柯南TCG",
    sve: "影之诗"
  };
  return labels[gameKey] || gameKey || "官网源";
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url || "";
  }
}

function setBodyView() {
  document.body.dataset.view = state.view;
}

function applyInitialUrlState() {
  const params = new URLSearchParams(window.location.search);
  const hasFrom = params.has("from");
  const hasTo = params.has("to");
  const hasStatus = params.has("status");
  const dateScope = params.get("dateScope");
  const view = params.get("view");
  if (["product", "event", "sources"].includes(view)) {
    state.view = view;
    state.kind = view === "event" ? "event" : "product";
  }
  const kind = params.get("kind");
  if (["product", "event", "all"].includes(kind)) state.kind = kind;
  const sourceType = params.get("sourceType");
  if (["all", "official", "news"].includes(sourceType)) state.sourceType = sourceType;
  const status = params.get("status");
  if (["all", "upcoming", "past"].includes(status)) state.status = status;
  else if (state.kind === "event" && !hasStatus) state.status = "upcoming";
  state.brand = params.get("brand") || state.brand;
  state.q = params.get("q") || state.q;
  state.displayMode = params.get("display") || state.displayMode;
  if (hasFrom) state.from = params.get("from") || "";
  if (hasTo) state.to = params.get("to") || "";
  if (state.kind === "event" && !hasFrom && !hasTo) {
    state.from = "";
    state.to = "";
    state.dateScope = "all";
  }
  if (hasFrom || hasTo) state.dateScope = "custom";
  state.selectedDate = params.get("selectedDate") || "";
  const month = params.get("month") || state.from.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [year, monthIndex] = month.split("-").map(Number);
    state.visibleMonth = new Date(year, monthIndex - 1, 1);
    if (params.has("month") && dateScope !== "all" && !hasFrom && !hasTo) {
      state.from = iso(new Date(year, monthIndex - 1, 1));
      state.to = iso(monthEnd(year, monthIndex - 1));
      state.dateScope = "month";
    }
  }
  if (dateScope === "all") state.dateScope = "all";
  if (dateScope === "year") state.dateScope = "year";
  const monthStart = iso(new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth(), 1));
  const monthFinish = iso(monthEnd(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth()));
  if (state.from === monthStart && state.to === monthFinish && dateScope !== "all") {
    state.dateScope = "month";
  }
}

function updateUrlState() {
  const params = new URLSearchParams();
  params.set("view", state.view);
  params.set("kind", state.kind);
  if (state.sourceType !== "all") params.set("sourceType", state.sourceType);
  params.set("status", state.status);
  if (state.brand) params.set("brand", state.brand);
  if (state.q) params.set("q", state.q);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  params.set("dateScope", state.dateScope);
  if (state.selectedDate) params.set("selectedDate", state.selectedDate);
  if (state.displayMode !== "cards") params.set("display", state.displayMode);
  params.set("month", `${state.visibleMonth.getFullYear()}-${String(state.visibleMonth.getMonth() + 1).padStart(2, "0")}`);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function setDefaultRangeForView(view) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (view === "product") {
    state.kind = "product";
    state.status = "all";
    state.selectedDate = "";
    state.from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    state.to = iso(monthEnd(now.getFullYear(), now.getMonth()));
    state.visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    state.dateScope = "month";
  } else if (view === "event") {
    state.kind = "event";
    state.status = "upcoming";
    state.selectedDate = "";
    state.from = "";
    state.to = "";
    state.visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    state.dateScope = "all";
  } else {
    state.kind = "product";
    state.status = "all";
  }
}

function timelineLimitStep() {
  if (state.kind === "event") return 80;
  return state.displayMode === "table" ? 240 : 80;
}

function resetTimelineLimit() {
  state.timelineLimit = timelineLimitStep();
}

function visibleMonthKey() {
  return `${state.visibleMonth.getFullYear()}-${String(state.visibleMonth.getMonth() + 1).padStart(2, "0")}`;
}

function setVisibleMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  if (year && month) state.visibleMonth = new Date(year, month - 1, 1);
}

function alignVisibleMonthToData() {
  if (state.kind !== "event" || state.from || state.to || state.selectedDate || !state.months.length) return;
  const months = state.months.map((item) => item.month).filter(Boolean).sort();
  if (!months.length || months.includes(visibleMonthKey())) return;
  const target = state.status === "upcoming" ? months[0] : months[months.length - 1];
  setVisibleMonthKey(target);
}

function defaultThumb(kind, sourceType = "news") {
  const fill = kind === "event" ? "#e8eef9" : sourceType === "official" ? "#e9f7f0" : "#fff4df";
  const ink = kind === "event" ? "#28519a" : sourceType === "official" ? "#13715a" : "#9b5b00";
  const text = kind === "event" ? "EVENT" : sourceType === "official" ? "OFFICIAL" : "NEWS";
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260"><rect width="420" height="260" fill="${fill}"/><text x="28" y="146" font-family="Arial" font-size="38" fill="${ink}">${text}</text></svg>`)}`;
}

async function loadData(options = {}) {
  const seq = ++loadSeq;
  if (activeRequest) activeRequest.abort();
  const controller = new AbortController();
  activeRequest = controller;
  if (isStaticSite && options.refreshData) {
    window.staticCalendarCache = null;
  }
  const params = new URLSearchParams({
    kind: state.kind,
    status: state.status,
    sourceType: state.sourceType,
    brand: state.brand,
    q: state.q,
    from: state.from,
    to: state.to,
    dateScope: state.dateScope,
    month: visibleMonthKey()
  });
  if (options.refreshOfficial) params.set("refreshOfficial", "1");
  if (options.refreshData) params.set("refreshData", "1");
  document.body.classList.add("isLoading");
  sourceMeta.textContent = isStaticSite
    ? "正在读取 GitHub 静态日历快照..."
    : options.refreshOfficial
      ? "正在重新抓取官网商品源..."
      : options.refreshData
        ? "正在刷新后台与数据库..."
        : "正在读取本地日历缓存...";
  try {
    const staticData = await loadStaticCalendarData(controller.signal);
    let data = staticData;
    if (!data) {
      const response = await fetch(`/api/calendar?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    }
    if (seq !== loadSeq) return;
    state.items = (data.items || []).map(displayItem);
    state.brands = data.brands || [];
    state.months = data.months || [];
    state.totals = data.totals || {};
    state.productPatrol = data.productPatrol || [];
    state.officialStats = data.officialStats || null;
    resetTimelineLimit();
    alignVisibleMonthToData();
    renderBrandOptions();
    setBodyView();
    render();
    const officialText = state.officialStats
      ? `官网 ${state.officialStats.count || 0} 条`
      : "官网巡查未返回";
    const cacheText = data.fromStaticSnapshot ? "GitHub 静态快照" : data.fromMemoryCache ? "页面缓存加速" : data.fromDiskCache ? (data.staleDiskCache ? "D盘缓存加速" : "D盘缓存加速") : "数据已更新";
    sourceMeta.textContent = `后台 ${data.totals?.posts || 0} 条 / ${officialText} / 8877 推特账号已排除 / ${cacheText} / ${new Date(data.generatedAt).toLocaleString("zh-CN")}`;
  } catch (error) {
    if (error.name === "AbortError") return;
    if (seq === loadSeq) sourceMeta.textContent = `读取失败：${error.message}`;
    throw error;
  } finally {
    if (seq === loadSeq) {
      document.body.classList.remove("isLoading");
      activeRequest = null;
    }
  }
}

function requestData(options = {}) {
  updateUrlState();
  loadData(options).catch((error) => {
    if (error.name !== "AbortError") sourceMeta.textContent = `读取失败：${error.message}`;
  });
}

function configureStaticSiteControls() {
  if (!isStaticSite) return;
  const officialRefreshBtn = $("#officialRefreshBtn");
  const refreshAllSourcesBtn = $("#refreshAllSourcesBtn");
  if (officialRefreshBtn) officialRefreshBtn.hidden = true;
  if (refreshAllSourcesBtn) refreshAllSourcesBtn.hidden = true;
}

function renderBrandOptions() {
  const current = brandSelect.value;
  brandSelect.innerHTML = `<option value="">全部品牌</option>${state.brands.map((brand) => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join("")}`;
  brandSelect.value = state.brands.includes(current) ? current : state.brand;
}

function renderQuickRangeLabels() {
  document.querySelectorAll(".quickRanges button").forEach((button) => {
    const label = state.kind === "event" ? button.dataset.eventLabel : button.dataset.productLabel;
    if (label) button.textContent = label;
  });
}

function renderControlState() {
  document.body.dataset.display = state.displayMode;
  renderQuickRangeLabels();
  document.querySelectorAll(".viewTabs .tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  document.querySelectorAll(".sourceTab").forEach((button) => {
    button.classList.toggle("active", button.dataset.sourceType === state.sourceType);
  });
  document.querySelectorAll(".displayBtn").forEach((button) => {
    button.classList.toggle("active", button.dataset.display === state.displayMode);
  });
  $("#displayTools").style.display = state.view === "sources" ? "none" : "";
  const filters = state.view === "sources" ? [
    { key: "view", label: "官网源管理" },
    { key: "sourceStatus", label: $("#sourceStatusSelect")?.selectedOptions?.[0]?.textContent || "全部状态", clearable: state.sourceStatus !== "all" },
    { key: "sourceQuery", label: state.sourceQuery ? `搜索：${state.sourceQuery}` : "", clearable: Boolean(state.sourceQuery) }
  ].filter((item) => item.label) : [
    { key: "view", label: state.kind === "product" ? "商品日历" : state.kind === "event" ? "赛事日历" : "官网源" },
    { key: "sourceType", label: state.sourceType !== "all" ? sourceTypeLabel(state.sourceType) : "", clearable: state.sourceType !== "all" },
    { key: "brand", label: state.brand || "", clearable: Boolean(state.brand) },
    { key: "status", label: state.status !== "all" ? (state.kind === "event" ? eventStatusLabel(state.status) : statusLabel(state.status)) : "", clearable: state.status !== "all" },
    { key: "date", label: dateRangeText(), clearable: Boolean(state.from || state.to) },
    { key: "selectedDate", label: state.selectedDate ? `选中：${formatFullDate(state.selectedDate)}` : "", clearable: Boolean(state.selectedDate) },
    { key: "q", label: state.q ? `搜索：${state.q}` : "", clearable: Boolean(state.q) }
  ].filter((item) => item.label);
  const activeFilters = $("#activeFilters");
  activeFilters.innerHTML = `
    <span class="filterLabel">当前筛选</span>
    ${filters.map((item) => `
      <button class="filterChip ${item.clearable ? "" : "locked"}" type="button" ${item.clearable ? `data-clear="${escapeHtml(item.key)}"` : "disabled"}>
        ${escapeHtml(item.label)}${item.clearable ? "<i>×</i>" : ""}
      </button>
    `).join("")}
    ${filters.some((item) => item.clearable) ? `<button class="filterReset" type="button" data-clear="all">重置筛选</button>` : ""}
  `;
  activeFilters.querySelectorAll("button[data-clear]").forEach((button) => {
    button.addEventListener("click", () => clearFilter(button.dataset.clear));
  });
}

function clearFilter(key) {
  if (key === "all") {
    state.sourceType = "all";
    state.brand = "";
    state.q = "";
    setDefaultRangeForView(state.view);
  }
  if (key === "sourceType") state.sourceType = "all";
  if (key === "brand") state.brand = "";
  if (key === "status") state.status = "all";
  if (key === "date") {
    state.from = "";
    state.to = "";
    state.selectedDate = "";
    state.dateScope = "all";
  }
  if (key === "q") state.q = "";
  if (key === "selectedDate") state.selectedDate = "";
  if (key === "sourceStatus") state.sourceStatus = "all";
  if (key === "sourceQuery") state.sourceQuery = "";
  syncControls();
  renderControlState();
  if (state.view === "sources") {
    renderOfficialPanel();
    return;
  }
  if (key === "selectedDate") {
    render();
    return;
  }
  requestData();
}

function render() {
  if (state.selectedDate && (state.from && state.selectedDate < state.from || state.to && state.selectedDate > state.to)) {
    state.selectedDate = "";
  }
  updateUrlState();
  const shownItems = visibleItems();
  $("#totalCount").textContent = state.totals.filtered || state.items.length || 0;
  $("#productCount").textContent = state.items.filter((item) => item.kind === "product").length;
  $("#eventCount").textContent = state.items.filter((item) => item.kind === "event").length;
  $("#officialCount").textContent = state.items.filter((item) => (item.sourceTypes || [item.sourceType || "news"]).includes("official")).length;
  $("#newsCount").textContent = state.items.filter((item) => (item.sourceTypes || [item.sourceType || "news"]).includes("news")).length;
  $("#filterCount").textContent = state.selectedDate
    ? `${shownItems.length} 条，${formatFullDate(state.selectedDate)}`
    : `${shownItems.length} 条，按日期升序显示`;
  $("#listTitle").textContent = state.selectedDate
    ? `${formatFullDate(state.selectedDate)} ${state.kind === "product" ? "商品" : "赛事"}`
    : state.kind === "product" ? "商品清单" : state.kind === "event" ? "赛事清单" : "近期日历";
  renderControlState();
  if (state.view === "sources") renderOfficialPanel();
  renderMonthChips();
  renderCalendar();
  renderTimeline();
}

function renderOfficialPanel() {
  const stats = state.officialStats?.sourceStats || [];
  const statByUrl = new Map(stats.map((item) => [item.url, item]));
  const okCount = stats.filter((item) => item.ok).length;
  const emptyCount = stats.filter((item) => item.ok && !Number(item.count || 0)).length;
  const badCount = stats.filter((item) => item.ok === false).length;
  const slowCount = stats.filter((item) => item.ok && Number(item.count || 0) > 0 && Number(item.elapsedMs || 0) >= SLOW_SOURCE_MS).length;
  $("#officialMeta").textContent = state.officialStats
    ? `${okCount}/${stats.length} 个源可访问，上次巡查 ${new Date(state.officialStats.generatedAt).toLocaleString("zh-CN")}`
    : "暂无巡查结果";
  const query = compactInput(state.sourceQuery);
  $("#sourceSummary").innerHTML = `
    <button class="${state.sourceStatus === "all" ? "active" : ""}" type="button" data-source-status="all"><b>${stats.length}</b><span>全部源</span></button>
    <button class="${state.sourceStatus === "bad" ? "active" : ""}" type="button" data-source-status="bad"><b>${badCount}</b><span>抓取失败</span></button>
    <button class="${state.sourceStatus === "slow" ? "active" : ""}" type="button" data-source-status="slow"><b>${slowCount}</b><span>响应缓慢</span></button>
    <button class="${state.sourceStatus === "empty" ? "active" : ""}" type="button" data-source-status="empty"><b>${emptyCount}</b><span>0 条数据</span></button>
    <button class="${state.sourceStatus === "ok" ? "active" : ""}" type="button" data-source-status="ok"><b>${Math.max(0, okCount - emptyCount - slowCount)}</b><span>正常有数据</span></button>
  `;
  $("#sourceSummary").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.sourceStatus = button.dataset.sourceStatus;
      $("#sourceStatusSelect").value = state.sourceStatus;
      renderControlState();
      renderOfficialPanel();
    });
  });
  const sources = state.productPatrol.map((source) => {
    const stat = statByUrl.get(source.url) || {};
    const ok = stat.ok !== false;
    const count = Number(stat.count || 0);
    const elapsedMs = Number(stat.elapsedMs || 0);
    const group = !ok ? "bad" : count === 0 ? "empty" : elapsedMs >= SLOW_SOURCE_MS ? "slow" : "ok";
    return { source, stat, ok, count, group, elapsedMs };
  }).filter(({ source, group }) => {
    if (state.sourceStatus !== "all" && state.sourceStatus !== group) return false;
    if (!query) return true;
    return `${sourceBrandLabel(source.game_key)} ${source.game_key} ${source.language} ${source.url} ${source.note || ""}`.toLowerCase().includes(query);
  });
  if (!sources.length) {
    $("#patrolList").innerHTML = `<div class="empty sourceEmpty">没有匹配的官网源。</div>`;
    return;
  }
  const groups = [
    ["bad", "抓取失败"],
    ["slow", "响应缓慢"],
    ["empty", "0 条数据"],
    ["ok", "正常有数据"]
  ];
  $("#patrolList").innerHTML = groups.map(([groupKey, groupTitle]) => {
    const groupSources = sources.filter((item) => item.group === groupKey);
    if (!groupSources.length) return "";
    return `
      <section class="patrolGroup">
        <h3>${escapeHtml(groupTitle)}<span>${groupSources.length}</span></h3>
        <div class="patrolGroupGrid">
          ${groupSources.sort((a, b) => b.elapsedMs - a.elapsedMs).map(({ source, stat, ok, count, group, elapsedMs }) => `
            <article class="patrolItem ${group === "empty" ? "zero" : group}">
              <span>
                <b>${escapeHtml(sourceBrandLabel(source.game_key))}</b>
                <small>${escapeHtml(source.language || "")} · ${escapeHtml(shortUrl(source.url))}</small>
              </span>
              <strong>${count}</strong>
              <em>${group === "slow" ? "慢源" : ok ? (count ? "正常" : "0条") : "失败"}</em>
              ${elapsedMs ? `<small class="elapsed">耗时 ${elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)} 秒` : `${elapsedMs} 毫秒`}</small>` : ""}
              ${stat.error ? `<p class="sourceError">${escapeHtml(stat.error)}</p>` : ""}
              <div class="patrolActions">
                <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">打开官网</a>
                ${isStaticSite ? '' : `<button type="button" data-source-url="${escapeHtml(source.url)}">刷新此源</button>`}
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");
  document.querySelectorAll("#patrolList button[data-source-url]").forEach((button) => {
    button.addEventListener("click", () => refreshOfficialSource(button.dataset.sourceUrl, button));
  });
}

async function refreshOfficialSource(url, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "刷新中";
  sourceMeta.textContent = `正在刷新 ${shortUrl(url)} ...`;
  try {
    const response = await fetch(`/api/official-products/refresh?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await loadData();
  } catch (error) {
    sourceMeta.textContent = `刷新失败：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function compactInput(value) {
  return String(value || "").trim().toLowerCase();
}

function setMonthRange(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  state.selectedDate = "";
  state.from = iso(first);
  state.to = iso(monthEnd(year, month - 1));
  state.visibleMonth = first;
  state.dateScope = "month";
  syncControls();
  requestData();
}

function setYearRange(year) {
  const selectedYear = Number(year);
  if (!selectedYear) return;
  state.selectedDate = "";
  state.from = iso(new Date(selectedYear, 0, 1));
  state.to = iso(new Date(selectedYear, 11, 31));
  state.visibleMonth = new Date(selectedYear, 0, 1);
  state.dateScope = "year";
  syncControls();
  requestData();
}

function monthPickerYearRange() {
  const now = new Date();
  const years = new Set([now.getFullYear(), now.getFullYear() + 1, state.visibleMonth.getFullYear()]);
  for (let year = 2019; year <= now.getFullYear() + 2; year += 1) years.add(year);
  for (const month of state.months) {
    const year = Number(String(month.month || "").slice(0, 4));
    if (year) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

function renderMonthPicker() {
  const yearSelect = $("#yearSelect");
  const monthSelect = $("#monthSelect");
  const visibleYear = state.visibleMonth.getFullYear();
  const visibleMonth = String(state.visibleMonth.getMonth() + 1).padStart(2, "0");
  const isFullYearRange = state.from && state.to && state.from === `${visibleYear}-01-01` && state.to === `${visibleYear}-12-31`;
  yearSelect.innerHTML = monthPickerYearRange()
    .map((year) => `<option value="${year}" ${year === visibleYear ? "selected" : ""}>${year}年</option>`)
    .join("");
  monthSelect.innerHTML = `<option value="" ${isFullYearRange ? "selected" : ""}>全年</option>` + Array.from({ length: 12 }, (_, index) => {
    const value = String(index + 1).padStart(2, "0");
    return `<option value="${value}" ${!isFullYearRange && value === visibleMonth ? "selected" : ""}>${index + 1}月</option>`;
  }).join("");
}

function applyMonthPicker() {
  const year = $("#yearSelect").value;
  const month = $("#monthSelect").value;
  resetTimelineLimit();
  if (month) setMonthRange(`${year}-${month}`);
  else setYearRange(year);
}

function renderMonthChips() {
  const now = new Date();
  const monthKeys = new Set();
  if (state.kind === "product") {
    for (let offset = -2; offset <= 5; offset += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      monthKeys.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    }
  }
  for (const month of state.months) monthKeys.add(month.month);
  if (!monthKeys.size) {
    monthKeys.add(`${state.visibleMonth.getFullYear()}-${String(state.visibleMonth.getMonth() + 1).padStart(2, "0")}`);
  }
  const activeMonth = state.dateScope === "month" && state.from && state.to && state.from.slice(0, 7) === state.to.slice(0, 7) ? state.from.slice(0, 7) : "";
  const rangeLabel = state.from || state.to
    ? `${state.from || "不限"} 至 ${state.to || "不限"}`
    : state.kind === "event" && state.status === "past"
      ? "全部过往赛事"
      : state.kind === "event" && state.status === "upcoming"
        ? "全部未来赛事"
        : "未限制日期";
  $("#activeRangeLabel").textContent = rangeLabel;
  renderMonthPicker();
  $("#monthChips").innerHTML = [...monthKeys].sort().map((monthKey) => {
    const summary = state.months.find((item) => item.month === monthKey);
    const total = summary?.total || 0;
    return `<button class="${monthKey === activeMonth ? "active" : ""}" type="button" data-month="${escapeHtml(monthKey)}">
      <span>${escapeHtml(monthKey.replace("-", "年"))}月</span>
      <b>${total || ""}</b>
    </button>`;
  }).join("");
  document.querySelectorAll("#monthChips button").forEach((button) => {
    button.addEventListener("click", () => setMonthRange(button.dataset.month));
  });
}

function renderCalendar() {
  const year = state.visibleMonth.getFullYear();
  const month = state.visibleMonth.getMonth();
  $("#monthTitle").textContent = `${year}年${String(month + 1).padStart(2, "0")}月`;
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const daysInMonth = monthEnd(year, month).getDate();
  const totalCells = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  calendar.innerHTML = weekdays.map((day) => `<div class="weekday">周${day}</div>`).join("");
  const byDate = new Map();
  for (const item of state.items) {
    const key = item.date;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(item);
  }
  for (let i = 0; i < totalCells; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = iso(day);
    const items = byDate.get(key) || [];
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    div.tabIndex = 0;
    div.className = `day${day.getMonth() === month ? "" : " other"}${key === iso(new Date()) ? " today" : ""}${items.length ? " hasItems" : ""}${key === state.selectedDate ? " selected" : ""}`;
    div.title = items.length ? `查看 ${key} 的 ${items.length} 条记录` : `${key} 暂无记录`;
    div.addEventListener("click", (event) => {
      if (event.target.closest(".mark")) return;
      state.selectedDate = state.selectedDate === key ? "" : key;
      render();
    });
    div.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedDate = state.selectedDate === key ? "" : key;
      render();
    });
    const productCount = items.filter((item) => item.kind === "product").length;
    const eventCount = items.filter((item) => item.kind === "event").length;
    const brandSummary = [...new Set(items.map((item) => item.brand).filter(Boolean))].slice(0, 2).join(" / ");
    div.innerHTML = `
      <div class="dayNum">
        <span>${day.getDate()}</span>
        ${items.length ? `<b>${items.length}</b>` : ""}
      </div>
      ${items.length ? `<div class="dayDots">
        ${productCount ? `<i class="legendProduct"></i><span>${productCount}</span>` : ""}
        ${eventCount ? `<i class="legendEvent"></i><span>${eventCount}</span>` : ""}
      </div>` : ""}
      ${items.length ? `<div class="daySummary">${escapeHtml(brandSummary || `${items.length} 条记录`)}</div>` : ""}
    `;
    const marks = document.createElement("div");
    marks.className = "marks";
    for (const item of items.slice(0, 2)) {
      const button = document.createElement("button");
      button.className = `mark ${item.kind} ${(item.sourceTypes || []).length > 1 ? "mixed" : item.sourceType === "official" ? "official" : "news"}`;
      button.textContent = item.kind === "event"
        ? `${item.city || item.brand || ""}${item.time ? ` ${item.time}` : ""}`
        : `${item.brand || ""}${item.type ? ` · ${item.type}` : ""}` || item.title;
      button.title = `${item.title}｜${sourceLabel(item)}`;
      button.addEventListener("click", () => openDetail(item));
      marks.appendChild(button);
    }
    if (items.length > 2) {
      const more = document.createElement("span");
      more.className = "mark more";
      more.textContent = `+${items.length - 2}`;
      marks.appendChild(more);
    }
    div.appendChild(marks);
    calendar.appendChild(div);
  }
}

function renderTimeline() {
  const items = visibleItems();
  const maxRows = state.timelineLimit || timelineLimitStep();
  if (!items.length) {
    const hint = state.q || state.brand || state.sourceType !== "all"
      ? "暂无匹配记录，当前筛选条件可能过窄。"
      : "暂无匹配日历，换个日期或来源试试。";
    timeline.innerHTML = `<div class="empty">${hint}</div>`;
    return;
  }
  if (state.displayMode === "table") {
    if (state.kind === "event") renderEventTable();
    else renderProductTable();
    return;
  }
  timeline.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let currentDate = "";
  const dateCounts = new Map();
  for (const item of items) dateCounts.set(item.date, (dateCounts.get(item.date) || 0) + 1);
  for (const item of items.slice(0, maxRows)) {
    if (item.date !== currentDate) {
      currentDate = item.date;
      const group = document.createElement("div");
      group.className = "dateDivider";
      group.innerHTML = `<b>${escapeHtml(formatFullDate(currentDate))}</b><span>${dateCounts.get(currentDate) || 0} 条</span>`;
      fragment.appendChild(group);
    }
    const row = document.createElement("article");
    const sourceClass = (item.sourceTypes || []).length > 1 ? "mixed" : item.sourceType === "official" ? "official" : "news";
    const thumbHtml = item.kind === "event" ? "" : `<img class="thumb" alt="" src="${escapeHtml(itemThumb(item))}" loading="lazy" decoding="async">`;
    const sourceLinks = compactSources(item)
      .map((source) => `<a class="sourceBtn ${escapeHtml(source.type)}" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.kind === "event" ? eventSourceButtonLabel(source) : sourceButtonLabel(source))}</a>`)
      .join("");
    const metaHtml = item.kind === "event" ? `
          <span class="pill kind-event">赛事日历</span>
          <span class="pill">${escapeHtml(item.brand || "未识别品牌")}</span>
        ` : `
          <span class="pill kind-product">商品</span>
          <span class="pill">${escapeHtml(item.brand || "未识别品牌")}</span>
          <span class="pill">${escapeHtml(item.type || "未分类")}</span>
          ${item.city ? `<span class="pill">${escapeHtml(item.city)}</span>` : ""}
          <span class="pill">${escapeHtml(item.sourceName || "来源未知")}</span>
        `;
    row.className = `item ${item.kind} ${sourceClass}`;
    row.innerHTML = `
      ${thumbHtml}
      <div class="dateBlock"><b>${escapeHtml(dateLabel(item))}</b><span>${escapeHtml(precisionLabel(item))}</span></div>
      <div class="content">
        <div class="titleLine">
          <h3 title="${escapeHtml(item.originalTitle || item.title)}">${escapeHtml(item.title)}</h3>
          ${item.kind === "event" ? "" : `<span class="sourceBadge ${sourceClass}">${sourceLabel(item)}</span>`}
        </div>
        <div class="meta">
          ${metaHtml}
        </div>
        ${tagMarkup(item)}
        ${item.kind === "event" ? `<div class="eventFields">
          <span><b>时间</b><span class="eventValue">${escapeHtml(eventDateTimeLabel(item))}</span></span>
          <span><b>地址</b><span class="eventValue">${escapeHtml(eventLocationLabel(item))}</span></span>
          <span><b>奖品</b><span class="eventValue" title="${escapeHtml(eventPrizeLabel(item))}">${escapeHtml(eventPrizeSummary(item, 72))}</span></span>
        </div>` : ""}
      </div>
      <div class="rowActions">
        <button class="openBtn" type="button">查看</button>
        ${sourceLinks}
        <button class="editTitleCommand" type="button" data-edit-title="${escapeHtml(item.id)}">改标题${item.titleIsManual ? ' · 人工' : ''}</button>
      </div>
    `;
    row.querySelector(".openBtn").addEventListener("click", () => openDetail(item));
    row.addEventListener("dblclick", () => openDetail(item));
    row.querySelector(".thumb")?.addEventListener("error", (event) => {
      event.currentTarget.src = defaultThumb(item.kind, item.sourceType);
    });
    fragment.appendChild(row);
  }
  timeline.appendChild(fragment);
  if (items.length > maxRows) {
    const more = document.createElement("div");
    more.className = "empty listMore";
    more.innerHTML = `<span>已显示前 ${maxRows} 条，共 ${items.length} 条。</span><button class="moreBtn" type="button">加载更多</button>`;
    more.querySelector(".moreBtn").addEventListener("click", () => {
      state.timelineLimit += timelineLimitStep();
      renderTimeline();
    });
    timeline.appendChild(more);
  }
}

function renderProductTable() {
  const items = visibleItems();
  const maxRows = state.timelineLimit || timelineLimitStep();
  const rows = items.slice(0, maxRows).map((item, index) => {
    const sources = compactSources(item);
    const primary = sources.find((source) => source.type === "official") || sources[0];
    const sourceSummary = sortedSources(item).map((source) => source.name || sourceButtonLabel(source)).filter(Boolean).slice(0, 3).join(" / ");
    return `
      <tr>
        <td><button class="tableDate" type="button" data-row="${index}">${escapeHtml(eventTableDateLabel(item))}</button></td>
        <td>${escapeHtml(item.brand || "未识别品牌")}</td>
        <td>${escapeHtml(item.type || "商品")}</td>
        <td>
          <button class="tableTitle" type="button" data-row="${index}" title="${escapeHtml(item.originalTitle || item.title)}">${escapeHtml(item.title)}</button>
          ${titleEditMarkup(item)}
          ${item.postCount > 1 ? `<span class="mergeNote">合并 ${item.postCount} 条</span>` : ""}
        </td>
        <td>${escapeHtml(sourceSummary || item.sourceName || "来源未知")}</td>
        <td class="userTagCell">${tagMarkup(item)}</td>
        <td>${primary?.url ? `<a class="sourceBtn ${escapeHtml(primary.type)}" href="${escapeHtml(primary.url)}" target="_blank" rel="noreferrer">${escapeHtml(sourceButtonLabel(primary))}</a>` : ""}</td>
      </tr>
    `;
  }).join("");
  timeline.innerHTML = `
    <div class="tableWrap">
      <table class="productTable">
        <thead>
          <tr>
            <th>日期</th>
            <th>品牌</th>
            <th>类型</th>
            <th>商品名</th>
            <th>来源</th>
            <th class="userTagHeading">标签</th>
            <th>原文</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${items.length > maxRows ? `<div class="empty listMore"><span>已显示前 ${maxRows} 条，共 ${items.length} 条。</span><button class="moreBtn" type="button">加载更多</button></div>` : ""}
  `;
  timeline.querySelectorAll("[data-row]").forEach((button) => {
    button.addEventListener("click", () => openDetail(items[Number(button.dataset.row)]));
  });
  timeline.querySelector(".moreBtn")?.addEventListener("click", () => {
    state.timelineLimit += timelineLimitStep();
    renderProductTable();
  });
}

function renderEventTable() {
  const items = visibleItems();
  const maxRows = state.timelineLimit || timelineLimitStep();
  const rows = items.slice(0, maxRows).map((item, index) => {
    const sources = compactSources(item);
    const primary = sources[0];
    return `
      <tr>
        <td><button class="tableDate" type="button" data-row="${index}">${escapeHtml(formatFullDate(item.date))}</button></td>
        <td>${escapeHtml(item.time || "待确认")}</td>
        <td>${escapeHtml(item.brand || "未识别品牌")}</td>
        <td>
          <button class="tableTitle" type="button" data-row="${index}" title="${escapeHtml(item.originalTitle || item.title)}">${escapeHtml(item.title)}</button>
          ${titleEditMarkup(item)}
          ${item.postCount > 1 ? `<span class="mergeNote">合并 ${item.postCount} 条</span>` : ""}
        </td>
        <td class="eventCityCell" title="${escapeHtml(eventLocationLabel(item))}">${escapeHtml(item.city || "待确认")}</td>
        <td>${escapeHtml(item.people || "100人以上")}</td>
        <td class="eventPrizeCell" title="${escapeHtml(eventPrizeLabel(item))}">${escapeHtml(eventPrizeSummary(item))}</td>
        <td>${primary?.url ? `<a class="sourceBtn ${escapeHtml(primary.type)}" href="${escapeHtml(primary.url)}" target="_blank" rel="noreferrer">${escapeHtml(eventSourceButtonLabel(primary))}</a>` : ""}</td>
        <td><button class="openBtn tableOpenBtn" type="button" data-row="${index}">查看</button></td>
      </tr>
    `;
  }).join("");
  timeline.innerHTML = `
    <div class="tableWrap">
      <table class="productTable eventTable">
        <thead>
          <tr>
            <th>日期</th>
            <th>时间</th>
            <th>品牌</th>
            <th>赛事名称</th>
            <th>城市</th>
            <th>人数</th>
            <th>奖品摘要</th>
            <th>原链接</th>
            <th>查看</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${items.length > maxRows ? `<div class="empty listMore"><span>已显示前 ${maxRows} 条，共 ${items.length} 条。</span><button class="moreBtn" type="button">加载更多</button></div>` : ""}
  `;
  timeline.querySelectorAll("[data-row]").forEach((button) => {
    button.addEventListener("click", () => openDetail(items[Number(button.dataset.row)]));
  });
  timeline.querySelector(".moreBtn")?.addEventListener("click", () => {
    state.timelineLimit += timelineLimitStep();
    renderEventTable();
  });
}

function openDetail(item) {
  const detailDialog = $("#detailDialog");
  currentDetailItem = item;
  detailDialog.dataset.kind = item.kind;
  if (item.kind === "event") {
    $("#detailImage").removeAttribute("src");
  } else {
    $("#detailImage").src = itemThumb(item);
  }
  $("#detailDate").textContent = dateLabel(item);
  $("#detailTitle").textContent = item.title;
  $("#detailTitleEdit").innerHTML = titleEditMarkup(item);
  $("#detailTags").innerHTML = item.kind === "event" ? `
    <span class="pill kind-event">赛事日历</span>
    <span class="pill">${escapeHtml(item.brand || "未识别品牌")}</span>
  ` : `
    <span class="pill kind-${item.kind}">${item.kind === "product" ? "商品日历" : "赛事日历"}</span>
    <span class="pill">${escapeHtml(sourceLabel(item))}</span>
    <span class="pill">${escapeHtml(item.brand || "未识别品牌")}</span>
    <span class="pill">${escapeHtml(item.type || "未分类")}</span>
    <span class="pill">置信度 ${Number(item.confidence || 0)}</span>
  `;
  const detailSources = item.kind === "event" ? compactSources(item) : sortedSources(item);
  $("#detailUserTags").innerHTML = tagMarkup(item);
  const sourceRows = detailSources
    .filter((source) => source.url)
    .map((source) => `<a class="sourceBtn ${escapeHtml(source.type)}" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.kind === "event" ? eventSourceButtonLabel(source) : (source.name || sourceButtonLabel(source)))}</a>`)
    .join("");
  const rows = item.kind === "event" ? [
    ["时间", eventDateTimeLabel(item)],
    ["城市地址", eventLocationLabel(item)],
    ["参赛规模", item.people || "100人以上"],
    ["奖品", eventPrizeLabel(item)]
  ] : [
    ["发售日期", dateLabel(item)],
    ["预约期", item.reservationFrom && item.reservationTo ? `${item.reservationFrom} 至 ${item.reservationTo}` : ""],
    ["商品类型", item.type],
    ["品牌", item.brand],
    ["来源", item.sourceName],
    ["数据类型", sourceLabel(item)],
    ["命中日期", item.reason],
    ["关联资讯", item.postCount > 1 ? `${item.postCount} 条` : ""],
    ["原标题", item.originalTitle && item.originalTitle !== item.title ? item.originalTitle : ""]
  ];
  $("#detailMeta").innerHTML = rows
    .filter(([, value]) => value)
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd class="${key === "奖品" ? "fullPrize" : ""}">${escapeHtml(value)}</dd>`)
    .join("") + (sourceRows ? `<dt>${item.kind === "event" ? "原链接" : "原文链接"}</dt><dd class="detailSources">${sourceRows}</dd>` : "");
  $("#detailExcerpt").textContent = item.kind === "event" ? "" : (item.excerpt || "");
  const primarySource = detailSources.find((source) => source.type === "official" && source.url) || detailSources.find((source) => source.url);
  $("#detailLink").href = primarySource?.url || "#";
  $("#detailLink").textContent = item.kind === "event" ? "打开原链接" : (primarySource?.type === "official" ? "查看官网原文" : "查看后台原文");
  $("#detailLink").style.display = primarySource?.url ? "inline-flex" : "none";
  $("#copyAddressBtn").style.display = item.kind === "event" ? "inline-flex" : "none";
  $("#copyTitleBtn").textContent = item.kind === "event" ? "复制赛事名称" : "复制商品名称";
  $("#detailDialog").showModal();
}

async function copyDetailValue(type, button) {
  if (!currentDetailItem) return;
  const sources = sortedSources(currentDetailItem);
  const primarySource = sources.find((source) => source.type === "official" && source.url) || sources.find((source) => source.url);
  const values = {
    title: currentDetailItem.title || "",
    address: eventLocationLabel(currentDetailItem),
    link: primarySource?.url || ""
  };
  const value = values[type];
  if (!value) return;
  try {
    if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  const original = button.textContent;
  button.textContent = "已复制";
  window.setTimeout(() => { button.textContent = original; }, 1200);
}

function syncControls() {
  $("#rangeSelect").value = state.status;
  $("#fromInput").value = state.from;
  $("#toInput").value = state.to;
  $("#searchInput").value = state.q;
  $("#sourceStatusSelect").value = state.sourceStatus;
  $("#sourceSearchInput").value = state.sourceQuery;
  brandSelect.value = state.brand;
}

function setDateRange(type) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  state.selectedDate = "";
  if (type === "all") {
    state.from = "";
    state.to = "";
    state.status = state.kind === "event" ? "upcoming" : "all";
    state.dateScope = "all";
    state.visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (type === "past") {
    state.from = "";
    state.to = "";
    state.status = "past";
    state.dateScope = "all";
    state.visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (type === "clear") {
    state.from = "";
    state.to = "";
    state.status = state.kind === "event" ? "all" : "upcoming";
    state.dateScope = "all";
  }
  if (type === "thisMonth") {
    state.status = "all";
    state.from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    state.to = iso(monthEnd(now.getFullYear(), now.getMonth()));
    state.visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    state.dateScope = "month";
  }
  if (type === "nextMonth") {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    state.status = "all";
    state.from = iso(next);
    state.to = iso(monthEnd(next.getFullYear(), next.getMonth()));
    state.visibleMonth = next;
    state.dateScope = "month";
  }
  if (type === "ninety") {
    const end = new Date(now);
    end.setDate(now.getDate() + 90);
    state.status = state.kind === "event" ? "upcoming" : "all";
    state.from = iso(now);
    state.to = iso(end);
    state.visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    state.dateScope = "custom";
  }
  syncControls();
  requestData();
}

function bindEvents() {
  document.querySelectorAll(".viewTabs .tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".viewTabs .tab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.view = button.dataset.view;
      if (state.view === "sources") state.displayMode = "cards";
      setDefaultRangeForView(state.view);
      resetTimelineLimit();
      setBodyView();
      syncControls();
      requestData();
    });
  });
  document.querySelectorAll(".sourceTab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".sourceTab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.sourceType = button.dataset.sourceType;
      state.selectedDate = "";
      resetTimelineLimit();
      requestData();
    });
  });
  document.querySelectorAll(".quickRanges button").forEach((button) => {
    button.addEventListener("click", () => setDateRange(button.dataset.range));
  });
  brandSelect.addEventListener("change", () => {
    state.brand = brandSelect.value;
    state.selectedDate = "";
    resetTimelineLimit();
    requestData();
  });
  $("#rangeSelect").addEventListener("change", (event) => {
    state.status = event.target.value;
    state.selectedDate = "";
    if (state.kind === "event" && state.status === "past") {
      state.from = "";
      state.to = "";
      syncControls();
    }
    resetTimelineLimit();
    requestData();
  });
  $("#fromInput").addEventListener("change", (event) => {
    state.from = event.target.value;
    state.dateScope = "custom";
    state.selectedDate = "";
    if (state.from) {
      const [year, month] = state.from.slice(0, 7).split("-").map(Number);
      state.visibleMonth = new Date(year, month - 1, 1);
    }
    resetTimelineLimit();
    requestData();
  });
  $("#toInput").addEventListener("change", (event) => {
    state.to = event.target.value;
    state.dateScope = "custom";
    state.selectedDate = "";
    if (state.from && state.to && state.from.slice(0, 7) === state.to.slice(0, 7)) {
      const [year, month] = state.from.slice(0, 7).split("-").map(Number);
      state.visibleMonth = new Date(year, month - 1, 1);
    }
    resetTimelineLimit();
    requestData();
  });
  $("#sourceSearchInput").addEventListener("input", (event) => {
    state.sourceQuery = event.target.value;
    renderControlState();
    renderOfficialPanel();
  });
  $("#sourceStatusSelect").addEventListener("change", (event) => {
    state.sourceStatus = event.target.value;
    renderControlState();
    renderOfficialPanel();
  });
  document.querySelectorAll(".displayBtn").forEach((button) => {
    button.addEventListener("click", () => {
      state.displayMode = button.dataset.display;
      resetTimelineLimit();
      updateUrlState();
      renderControlState();
      renderTimeline();
    });
  });
  $("#searchInput").addEventListener("input", (event) => {
    state.q = event.target.value;
    state.selectedDate = "";
    clearTimeout(window.searchTimer);
    window.searchTimer = setTimeout(requestData, 260);
  });
  $("#refreshBtn").addEventListener("click", () => {
    requestData({ refreshData: true });
    refreshTags(true);
  });
  $("#officialRefreshBtn")?.addEventListener("click", async () => {
    $("#officialRefreshBtn").disabled = true;
    try {
      await loadData({ refreshOfficial: true });
    } finally {
      $("#officialRefreshBtn").disabled = false;
    }
  });
  $("#refreshAllSourcesBtn")?.addEventListener("click", async () => {
    $("#refreshAllSourcesBtn").disabled = true;
    if ($("#officialRefreshBtn")) $("#officialRefreshBtn").disabled = true;
    try {
      await loadData({ refreshOfficial: true });
    } finally {
      $("#refreshAllSourcesBtn").disabled = false;
      if ($("#officialRefreshBtn")) $("#officialRefreshBtn").disabled = false;
    }
  });
  $("#prevMonth").addEventListener("click", () => {
    state.visibleMonth.setMonth(state.visibleMonth.getMonth() - 1);
    setMonthRange(`${state.visibleMonth.getFullYear()}-${String(state.visibleMonth.getMonth() + 1).padStart(2, "0")}`);
  });
  $("#nextMonth").addEventListener("click", () => {
    state.visibleMonth.setMonth(state.visibleMonth.getMonth() + 1);
    setMonthRange(`${state.visibleMonth.getFullYear()}-${String(state.visibleMonth.getMonth() + 1).padStart(2, "0")}`);
  });
  $("#applyMonthPicker").addEventListener("click", applyMonthPicker);
  $("#monthSelect").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyMonthPicker();
  });
  $("#yearSelect").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyMonthPicker();
  });
  $("#closeDialog").addEventListener("click", () => $("#detailDialog").close());
  $("#copyTitleBtn").addEventListener("click", (event) => copyDetailValue("title", event.currentTarget));
  $("#copyAddressBtn").addEventListener("click", (event) => copyDetailValue("address", event.currentTarget));
  $("#copyLinkBtn").addEventListener("click", (event) => copyDetailValue("link", event.currentTarget));
  $("#detailDialog").addEventListener("click", (event) => {
    if (event.target === $("#detailDialog")) $("#detailDialog").close();
  });
}

applyInitialUrlState();
configureStaticSiteControls();
setBodyView();
syncControls();
bindEvents();
initTags({
  findItem: id => state.items.find(item => item.id === id) || (currentDetailItem?.id === id ? currentDetailItem : null),
  update: () => {
    const scrollTop = timeline.scrollTop;
    const tableScroll = timeline.querySelector('.tableWrap')?.scrollTop || 0;
    state.items = isStaticSite && window.staticCalendarCache
      ? staticFilterItems(window.staticCalendarCache.items.map(displayItem))
      : state.items.map(displayItem);
    state.totals.filtered = state.items.length;
    state.months = monthSummary(state.items);
    render();
    timeline.scrollTop = scrollTop;
    if (timeline.querySelector('.tableWrap')) timeline.querySelector('.tableWrap').scrollTop = tableScroll;
    if (currentDetailItem) {
      currentDetailItem = displayItem(currentDetailItem);
      $("#detailTitle").textContent = currentDetailItem.title;
      $("#detailTitleEdit").innerHTML = titleEditMarkup(currentDetailItem);
      $("#detailUserTags").innerHTML = tagMarkup(currentDetailItem);
    }
    if (state.q && !isStaticSite) requestData();
  }
});
loadData().catch((error) => {
  sourceMeta.textContent = `读取失败：${error.message}`;
});
