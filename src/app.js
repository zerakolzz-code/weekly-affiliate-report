const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const app = $("#app");
const saveState = $("#save-state");
const STORAGE_KEY = "weekly-affiliate-report:demo:v1";

const listConfig = {
  acquisition: { container: "#acquisition-list", template: "#acquisition-template", stateKey: "acquisition" },
  existing: { container: "#existing-list", template: "#existing-template", stateKey: "existing" },
  problems: { container: "#problems-list", template: "#problems-template", stateKey: "problems" },
  nextWeek: { container: "#next-week-list", template: "#next-week-template", stateKey: "nextWeek" },
  priorities: { container: "#priorities-list", template: "#compact-template", stateKey: "priorities" },
  topProblems: { container: "#top-problems-list", template: "#compact-template", stateKey: "topProblems" },
  achievements: { container: "#achievements-list", template: "#compact-template", stateKey: "achievements" },
};

const kindLabels = {
  newAffiliate: "Новый партнёр",
  newDeal: "Новая сделка",
  reactivated: "Реактивирован",
};

let state = loadState();
let report = state.draft || null;
let activeReportId = "";
let saveTimer = null;
let submitLocked = false;

function id() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mondayFor(date = new Date()) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return toDateInput(result);
}

function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function blankReport(weekStart = mondayFor()) {
  return {
    id: id(),
    version: 6,
    weekStart,
    manager: "",
    metrics: { ftd: "", activeAffiliates: "", searchPlan: "" },
    acquisition: [],
    existing: [],
    problems: [],
    nextWeek: [],
    priorities: [],
    topProblems: [],
    achievements: [],
    noSearch: false,
    noSearchReason: "",
    noExisting: false,
    noProblems: false,
    noTopProblems: false,
    noAchievements: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCompactList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({ id: row.id || id(), collapsed: row.collapsed !== false, text: row.text ?? "" }));
}

function normalizeComments(value, fallbackCreatedAt) {
  if (!value || typeof value !== "object") return {};
  const comments = {};

  Object.entries(value).forEach(([target, rawThread]) => {
    const rawMessages = Array.isArray(rawThread)
      ? rawThread
      : typeof rawThread === "string" && rawThread.trim()
        ? [{ text: rawThread, author: "Без имени", createdAt: fallbackCreatedAt }]
        : [];
    const messages = rawMessages
      .filter((message) => message && typeof message === "object" && String(message.text || "").trim())
      .map((message) => ({
        id: message.id || id(),
        author: String(message.author || "Без имени").trim() || "Без имени",
        text: String(message.text || "").trim(),
        createdAt: message.createdAt || fallbackCreatedAt || new Date().toISOString(),
        replyTo: typeof message.replyTo === "string" ? message.replyTo : "",
      }));
    if (messages.length) comments[target] = messages;
  });

  return comments;
}

function normalizeReport(value, fallbackWeek = mondayFor()) {
  const base = blankReport(value?.weekStart || fallbackWeek);
  if (!value || typeof value !== "object") return base;
  const sourceMetrics = value.metrics || {};

  return {
    ...base,
    id: value.id || base.id,
    weekStart: typeof value.weekStart === "string" ? value.weekStart : fallbackWeek,
    manager: typeof value.manager === "string" ? value.manager : "",
    metrics: {
      ftd: sourceMetrics.ftd ?? "",
      activeAffiliates: sourceMetrics.activeAffiliates ?? "",
      searchPlan: sourceMetrics.searchPlan ?? "",
    },
    acquisition: Array.isArray(value.acquisition)
      ? value.acquisition.map((row) => ({
          id: row.id || id(), collapsed: row.collapsed !== false, kind: row.kind ?? "",
          partner: row.partner ?? "", geo: row.geo ?? "", source: row.source ?? "", result: row.result ?? "",
        }))
      : [],
    existing: Array.isArray(value.existing)
      ? value.existing.map((row) => ({
          id: row.id || id(), collapsed: row.collapsed !== false,
          email: row.email ?? row.partner ?? "", geo: row.geo ?? "",
          movement: row.movement === "grew" || row.movement === "fell" ? row.movement : "",
          reason: row.reason ?? row.fact ?? "", action: row.action ?? "",
        }))
      : [],
    problems: Array.isArray(value.problems)
      ? value.problems.map((row) => ({
          id: row.id || id(), collapsed: row.collapsed !== false,
          email: row.email ?? row.subject ?? "", problem: row.problem ?? "",
          resolution: row.resolution ?? row.action ?? "",
        }))
      : [],
    nextWeek: Array.isArray(value.nextWeek)
      ? value.nextWeek.map((row) => ({
          id: row.id || id(), collapsed: row.collapsed !== false,
          plan: row.plan ?? row.action ?? "", update: row.update ?? row.result ?? "",
        }))
      : [],
    priorities: normalizeCompactList(value.priorities),
    topProblems: normalizeCompactList(value.topProblems),
    achievements: normalizeCompactList(value.achievements),
    noSearch: value.noSearch === true,
    noSearchReason: typeof value.noSearchReason === "string" ? value.noSearchReason : "",
    noExisting: value.noExisting === true,
    noProblems: value.noProblems === true,
    noTopProblems: value.noTopProblems === true,
    noAchievements: value.noAchievements === true,
    createdAt: value.createdAt || base.createdAt,
    updatedAt: value.updatedAt || base.updatedAt,
    status: value.status === "submitted" ? "submitted" : undefined,
    submittedAt: value.submittedAt || undefined,
    comments: normalizeComments(value.comments, value.submittedAt || value.updatedAt || base.updatedAt),
  };
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && typeof stored === "object") {
      const normalizedState = {
        version: 1,
        draft: stored.draft ? normalizeReport(stored.draft) : null,
        reports: Array.isArray(stored.reports)
          ? stored.reports.map((item) => normalizeReport({ ...item, status: "submitted" }))
          : [],
        commentAuthor: typeof stored.commentAuthor === "string" ? stored.commentAuthor : "",
      };
      const reportsToCheck = [stored.draft, ...(Array.isArray(stored.reports) ? stored.reports : [])].filter(Boolean);
      const hasLegacyComments = reportsToCheck.some((item) => Object.values(item.comments || {})
        .some((thread) => typeof thread === "string" && thread.trim()));
      if (hasLegacyComments) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
        } catch {
          // Отчёт всё равно откроется; повторим сохранение при следующем изменении.
        }
      }
      return normalizedState;
    }
  } catch {
    // Начинаем с чистой демо-версии, если старое локальное состояние повреждено.
  }

  return { version: 1, draft: null, reports: [], commentAuthor: "" };
}

function persistState({ immediate = false } = {}) {
  if (report) {
    report.updatedAt = new Date().toISOString();
    state.draft = report;
  }
  saveState.textContent = "Сохраняю...";
  clearTimeout(saveTimer);
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveState.textContent = "Все сохранено";
      return true;
    } catch {
      saveState.textContent = "Не удалось сохранить";
      return false;
    }
  };
  if (immediate) return save();
  saveTimer = setTimeout(save, 220);
  return true;
}

function short(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function commentsFor(item, target) {
  const thread = item.comments?.[target];
  return Array.isArray(thread) ? thread : [];
}

function countComments(item) {
  return Object.values(item.comments || {}).reduce(
    (total, thread) => total + (Array.isArray(thread) ? thread.length : 0),
    0,
  );
}

function formatDate(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", options).format(date);
}

function weekRange(weekStart) {
  const start = new Date(`${weekStart}T12:00:00`);
  if (Number.isNaN(start.getTime())) return weekStart || "Неделя не указана";
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const startText = formatDate(start, { day: "2-digit", month: "2-digit" });
  const endText = formatDate(end, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${startText}–${endText}`;
}

function showView(view) {
  $("#reports-view").hidden = view !== "reports";
  $("#editor-view").hidden = view !== "editor";
  $("#report-detail-view").hidden = view !== "detail";
  $$('[data-view]').forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  saveState.hidden = view === "reports";
  if (view === "reports") renderReports();
  if (view === "editor") {
    if (!state.draft) {
      report = blankReport();
      state.draft = report;
      persistState({ immediate: true });
    } else {
      report = state.draft;
    }
    collapseAllSections();
    renderReport();
  }
}

function renderNav() {
  $("#reports-count").textContent = state.reports.length;
}

function renderReport() {
  $("#week-start").value = report.weekStart;
  $("#manager-name").value = report.manager;
  $("#ftd").value = report.metrics.ftd;
  $("#active-affiliates").value = report.metrics.activeAffiliates;
  $("#search-plan").value = report.metrics.searchPlan;
  $("#no-search").checked = report.noSearch;
  $("#no-search-reason").value = report.noSearchReason;
  $("#no-existing").checked = report.noExisting;
  $("#no-problems").checked = report.noProblems;
  $("#no-top-problems").checked = report.noTopProblems;
  $("#no-achievements").checked = report.noAchievements;
  Object.keys(listConfig).forEach(renderList);
  renderAcquisitionSummary();
  renderMovementSummary();
  renderOptionalFields();
}

function renderOptionalFields() {
  const reasonWrap = $("#no-search-reason-wrap");
  const reasonInput = $("#no-search-reason");
  reasonWrap.hidden = !report.noSearch;
  reasonWrap.classList.toggle("is-missing", report.noSearch && !report.noSearchReason.trim());
  reasonInput.required = report.noSearch;
  reasonInput.setAttribute("aria-required", String(report.noSearch));
  $$('[data-optional-content]').forEach((container) => {
    container.hidden = report[container.dataset.optionalContent] === true;
  });
}

function collapseAllSections(except = null) {
  $$('[data-section-card]').forEach((card) => {
    const isOpen = card === except;
    card.classList.toggle("is-collapsed", !isOpen);
    $("[data-toggle-section]", card)?.setAttribute("aria-expanded", String(isOpen));
  });
}

function renderList(type) {
  const config = listConfig[type];
  const container = $(config.container);
  container.replaceChildren();
  report[config.stateKey].forEach((item) => {
    const node = $(config.template).content.firstElementChild.cloneNode(true);
    node.dataset.type = type;
    node.dataset.id = item.id;
    node.classList.toggle("is-collapsed", item.collapsed);
    $("[data-toggle-row]", node)?.setAttribute("aria-expanded", String(!item.collapsed));
    $$('[data-field]', node).forEach((field) => { field.value = item[field.dataset.field] ?? ""; });
    fillRowSummary(type, item, node);
    container.append(node);
  });
}

function fillRowSummary(type, item, node) {
  const main = $("[data-summary-main]", node);
  const secondary = $("[data-summary-secondary]", node);
  const compactLabels = { priorities: "Приоритет", topProblems: "Проблема", achievements: "Достижение" };
  if (type === "acquisition") {
    main.textContent = [kindLabels[item.kind] || "Тип не выбран", short(item.partner, "Партнёр не указан"), short(item.geo), short(item.source)].filter(Boolean).join(" · ");
    secondary.textContent = short(item.result, "Статус не заполнен");
  } else if (type === "existing") {
    const movement = item.movement === "grew" ? "Рост" : item.movement === "fell" ? "Падение" : "Изменение не выбрано";
    main.textContent = [short(item.email, "Партнёр не указан"), short(item.geo), movement].filter(Boolean).join(" · ");
    secondary.textContent = short([item.reason, item.action].filter(Boolean).join(" · "), "Причина и действия не заполнены");
  } else if (type === "problems") {
    main.textContent = short(item.email, "Партнёр не указан");
    secondary.textContent = short([item.problem, item.resolution].filter(Boolean).join(" · "), "Проблема не заполнена");
  } else if (type === "nextWeek") {
    main.textContent = short(item.plan, "Пункт плана не заполнен");
    secondary.textContent = item.update ? `Апдейт: ${short(item.update)}` : "Апдейта пока нет";
  } else {
    main.textContent = short(item.text, `${compactLabels[type]} не заполнен`);
    secondary.textContent = "";
  }
}

function renderMovementSummary() {
  $("#grown-count").textContent = report.existing.filter((row) => row.movement === "grew").length;
  $("#fallen-count").textContent = report.existing.filter((row) => row.movement === "fell").length;
}

function renderAcquisitionSummary() {
  const filled = report.acquisition.filter((row) => String(row.partner || "").trim() && row.kind);
  $("#new-affiliates-count").textContent = filled.filter((row) => row.kind === "newAffiliate").length;
  $("#new-deals-count").textContent = filled.filter((row) => row.kind === "newDeal").length;
  $("#reactivated-count").textContent = filled.filter((row) => row.kind === "reactivated").length;
}

function addRow(type) {
  const stateKey = listConfig[type].stateKey;
  report[stateKey].forEach((item) => { item.collapsed = true; });
  const fields = type === "acquisition"
    ? { kind: "", partner: "", geo: "", source: "", result: "" }
    : type === "existing"
      ? { email: "", geo: "", movement: "", reason: "", action: "" }
      : type === "problems"
        ? { email: "", problem: "", resolution: "" }
        : type === "nextWeek"
          ? { plan: "", update: "" }
          : { text: "" };
  report[stateKey].push({ id: id(), collapsed: false, ...fields });
  renderList(type);
  renderAcquisitionSummary();
  renderMovementSummary();
  const container = $(listConfig[type].container);
  $("[data-row]:last-child [data-field]", container)?.focus();
  persistState();
}

function removeRow(type, rowId) {
  const stateKey = listConfig[type].stateKey;
  report[stateKey] = report[stateKey].filter((item) => item.id !== rowId);
  renderList(type);
  renderAcquisitionSummary();
  renderMovementSummary();
  persistState();
}

function updateRow(target) {
  const row = target.closest("[data-row]");
  if (!row) return;
  const type = row.dataset.type;
  const stateKey = listConfig[type].stateKey;
  const item = report[stateKey].find((candidate) => candidate.id === row.dataset.id);
  if (!item) return;
  item[target.dataset.field] = target.value;
  target.classList.remove("is-invalid");
  fillRowSummary(type, item, row);
  if (type === "acquisition") renderAcquisitionSummary();
  if (type === "existing") renderMovementSummary();
  persistState();
}

function setRowCollapsed(row, collapsed) {
  const type = row.dataset.type;
  const stateKey = listConfig[type].stateKey;
  const item = report[stateKey].find((candidate) => candidate.id === row.dataset.id);
  if (!item) return;
  if (!collapsed) {
    report[stateKey].forEach((candidate) => { candidate.collapsed = candidate.id !== item.id; });
    $$("[data-row]", $(listConfig[type].container)).forEach((otherRow) => {
      const isCurrent = otherRow.dataset.id === item.id;
      otherRow.classList.toggle("is-collapsed", !isCurrent);
      $("[data-toggle-row]", otherRow)?.setAttribute("aria-expanded", String(isCurrent));
    });
  }
  item.collapsed = collapsed;
  row.classList.toggle("is-collapsed", collapsed);
  $("[data-toggle-row]", row)?.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) $("[data-field]", row)?.focus();
  persistState();
}

function closeHelp(exceptId = "") {
  $$('[data-help]').forEach((button) => {
    const popover = $(`#${button.dataset.help}`);
    const keepOpen = button.dataset.help === exceptId;
    popover.hidden = !keepOpen;
    button.setAttribute("aria-expanded", String(keepOpen));
  });
}

function addValidationError(errors, message, selector, sectionIndex) {
  errors.push({ message, selector, sectionIndex });
}

function validateRows(errors, type, rows, fields, sectionIndex) {
  rows.forEach((row, index) => {
    fields.forEach(({ key, label, rule }) => {
      const value = String(row[key] ?? "").trim();
      if (!value || (rule && !rule(value))) {
        addValidationError(errors, `${label}, строка ${index + 1}`, `[data-type="${type}"][data-id="${row.id}"] [data-field="${key}"]`, sectionIndex);
      }
    });
  });
}

function validateReport() {
  const errors = [];
  const hasValue = (value) => String(value ?? "").trim() !== "";
  const isGeo = (value) => /^[A-Za-z]{2}$/.test(value);
  if (!hasValue(report.weekStart)) addValidationError(errors, "Неделя", "#week-start", -1);
  if (!hasValue(report.manager)) addValidationError(errors, "Менеджер", "#manager-name", -1);
  if (!hasValue(report.metrics.ftd)) addValidationError(errors, "FTD", "#ftd", 0);
  if (!hasValue(report.metrics.activeAffiliates)) addValidationError(errors, "Активные партнёры", "#active-affiliates", 0);

  if (!report.acquisition.length && !report.noSearch) {
    addValidationError(errors, "Добавь результат привлечения или отметь «Поиском не занимался»", "#no-search", 1);
  }
  if (report.noSearch && !hasValue(report.noSearchReason)) {
    addValidationError(errors, "Чем был занят вместо поиска", "#no-search-reason", 1);
  }
  validateRows(errors, "acquisition", report.acquisition, [
    { key: "kind", label: "Тип привлечения" },
    { key: "partner", label: "Почта / партнёр" },
    { key: "geo", label: "GEO из двух букв", rule: isGeo },
    { key: "source", label: "Источник" },
    { key: "result", label: "Статус" },
  ], 1);

  if (!report.noExisting && !report.existing.length) {
    addValidationError(errors, "Добавь изменение текущего партнёра или отметь «Изменений нет»", "#no-existing", 2);
  }
  if (!report.noExisting) {
    validateRows(errors, "existing", report.existing, [
      { key: "email", label: "Почта текущего партнёра" },
      { key: "geo", label: "GEO из двух букв", rule: isGeo },
      { key: "movement", label: "Изменение" },
      { key: "reason", label: "Причина изменения" },
      { key: "action", label: "Что делаем" },
    ], 2);
  }

  if (!report.noProblems && !report.problems.length) {
    addValidationError(errors, "Добавь проблему или отметь «Проблем нет»", "#no-problems", 3);
  }
  if (!report.noProblems) {
    validateRows(errors, "problems", report.problems, [
      { key: "email", label: "Почта партнёра в проблеме" },
      { key: "problem", label: "Описание проблемы" },
      { key: "resolution", label: "Решение / статус" },
    ], 3);
  }

  if (!hasValue(report.metrics.searchPlan)) addValidationError(errors, "План по поиску", "#search-plan", 4);
  if (!report.nextWeek.length) addValidationError(errors, "Добавь хотя бы один пункт на следующую неделю", '[data-add="nextWeek"]', 4);
  validateRows(errors, "nextWeek", report.nextWeek, [{ key: "plan", label: "План на следующую неделю" }], 4);

  if (!report.priorities.length) addValidationError(errors, "Добавь хотя бы один приоритет", '[data-add="priorities"]', 5);
  validateRows(errors, "priorities", report.priorities, [{ key: "text", label: "Приоритет" }], 5);
  if (!report.noTopProblems && !report.topProblems.length) {
    addValidationError(errors, "Добавь топ-проблему или отметь «Проблем нет»", "#no-top-problems", 5);
  }
  if (!report.noTopProblems) validateRows(errors, "topProblems", report.topProblems, [{ key: "text", label: "Топ-проблема" }], 5);
  if (!report.noAchievements && !report.achievements.length) {
    addValidationError(errors, "Добавь достижение или отметь «Достижений нет»", "#no-achievements", 5);
  }
  if (!report.noAchievements) validateRows(errors, "achievements", report.achievements, [{ key: "text", label: "Достижение" }], 5);
  return errors;
}

function showValidation(errors) {
  $$(".is-invalid", $("#editor-view")).forEach((element) => element.classList.remove("is-invalid"));
  const summary = $("#validation-summary");
  const list = $("#validation-list");
  list.replaceChildren();
  if (!errors.length) {
    summary.hidden = true;
    return;
  }
  errors.forEach((error) => {
    const item = document.createElement("li");
    item.textContent = error.message;
    list.append(item);
    $(error.selector)?.classList.add("is-invalid");
  });
  summary.hidden = false;
  const first = errors[0];
  const cards = $$('[data-section-card]');
  if (first.sectionIndex >= 0 && cards[first.sectionIndex]) collapseAllSections(cards[first.sectionIndex]);
  const target = $(first.selector);
  const row = target?.closest("[data-row]");
  if (row?.classList.contains("is-collapsed")) setRowCollapsed(row, false);
  target?.focus();
  summary.scrollIntoView({ behavior: "smooth", block: "start" });
}

function dismissValidation() {
  $("#validation-summary").hidden = true;
}

function submitReport() {
  if (submitLocked) return;
  submitLocked = true;
  const errors = validateReport();
  showValidation(errors);
  if (errors.length) {
    submitLocked = false;
    return;
  }
  clearTimeout(saveTimer);
  const snapshot = JSON.parse(JSON.stringify(report));
  snapshot.status = "submitted";
  snapshot.submittedAt = new Date().toISOString();
  snapshot.updatedAt = snapshot.submittedAt;
  snapshot.comments = {};
  if (snapshot.noExisting) snapshot.existing = [];
  if (snapshot.noProblems) snapshot.problems = [];
  if (snapshot.noTopProblems) snapshot.topProblems = [];
  if (snapshot.noAchievements) snapshot.achievements = [];
  state.reports.unshift(snapshot);
  state.draft = null;
  report = null;
  activeReportId = snapshot.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  saveState.textContent = "Все сохранено";
  renderNav();
  renderReports();
  renderSubmittedReport(snapshot);
  showView("detail");
  submitLocked = false;
}

function makeElement(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function renderReports() {
  const list = $("#reports-list");
  const empty = $("#reports-empty");
  list.replaceChildren();
  empty.hidden = state.reports.length > 0;
  renderNav();
  [...state.reports]
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
    .forEach((item) => {
      const button = makeElement("button", "report-list-item");
      button.type = "button";
      button.dataset.openReport = item.id;
      const main = makeElement("span", "report-list-main");
      main.append(makeElement("strong", "", item.manager || "Менеджер не указан"));
      main.append(makeElement("span", "", `Неделя ${weekRange(item.weekStart)}`));
      const metrics = makeElement("span", "report-list-metrics");
      const filled = item.acquisition.filter((row) => String(row.partner || "").trim() && row.kind);
      const newAffiliates = filled.filter((row) => row.kind === "newAffiliate").length;
      const newDeals = filled.filter((row) => row.kind === "newDeal").length;
      const reactivated = filled.filter((row) => row.kind === "reactivated").length;
      metrics.append(makeElement("span", "", `FTD ${item.metrics.ftd}`));
      metrics.append(makeElement("span", "", `Активные ${item.metrics.activeAffiliates}`));
      metrics.append(makeElement("span", "", `Новые партнёры ${newAffiliates}`));
      metrics.append(makeElement("span", "", `Новые сделки ${newDeals}`));
      metrics.append(makeElement("span", "", `Реактивации ${reactivated}`));
      const meta = makeElement("span", "report-list-meta");
      meta.append(makeElement("span", "", `Отправлен ${formatDate(item.submittedAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`));
      const comments = countComments(item);
      if (comments) meta.append(makeElement("span", "comment-count", `${comments} комм.`));
      meta.append(makeElement("span", "report-arrow", "→"));
      button.append(main, metrics, meta);
      list.append(button);
    });
}

function noteControl(item, target, label = "Комментарий") {
  const messages = commentsFor(item, target);
  const wrap = makeElement("div", `review-note${messages.length ? " has-note" : ""}`);
  wrap.dataset.noteTarget = target;
  wrap.dataset.noteLabel = label;
  const toggleText = messages.length ? `${messages.length} комм.` : `+ ${label.toLowerCase()}`;
  const toggle = makeElement("button", "note-toggle", toggleText);
  toggle.type = "button";
  toggle.dataset.noteToggle = target;
  toggle.setAttribute("aria-expanded", "false");
  const editor = makeElement("div", "note-editor");
  editor.hidden = true;

  if (messages.length) {
    const thread = makeElement("div", "thread-list");
    messages.forEach((message) => {
      const card = makeElement("article", `thread-message${message.replyTo ? " is-reply" : ""}`);
      card.dataset.commentId = message.id;
      const header = makeElement("div", "thread-message-header");
      header.append(makeElement("strong", "", message.author || "Без имени"));
      header.append(makeElement("time", "", formatDate(message.createdAt, {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })));
      card.append(header);
      if (message.replyTo) {
        const parent = messages.find((candidate) => candidate.id === message.replyTo);
        if (parent) {
          card.append(makeElement(
            "div",
            "thread-reply-context",
            `Ответ на ${parent.author}: ${short(parent.text, "сообщение")}`,
          ));
        }
      }
      card.append(makeElement("p", "", message.text));
      const reply = makeElement("button", "thread-reply-button", "Ответить");
      reply.type = "button";
      reply.dataset.replyMessage = message.id;
      reply.dataset.noteTarget = target;
      card.append(reply);
      thread.append(card);
    });
    editor.append(thread);
  }

  const composer = makeElement("div", "thread-composer");
  composer.dataset.commentComposer = target;
  composer.dataset.replyTo = "";
  const replyingTo = makeElement("div", "thread-replying-to");
  replyingTo.dataset.replyingTo = "";
  replyingTo.hidden = true;
  const replyText = makeElement("span", "");
  replyText.dataset.replyingText = "";
  const cancelReply = makeElement("button", "thread-cancel-reply", "Отменить ответ");
  cancelReply.type = "button";
  cancelReply.dataset.cancelReply = "";
  replyingTo.append(replyText, cancelReply);

  const fields = makeElement("div", "thread-fields");
  const author = makeElement("input", "thread-author");
  author.type = "text";
  author.placeholder = "Кто пишет";
  author.value = state.commentAuthor || "";
  author.dataset.commentAuthor = "";
  author.setAttribute("aria-label", "Кто пишет комментарий");
  const textarea = makeElement("textarea", "thread-input");
  textarea.rows = 2;
  textarea.placeholder = "Вопрос, правка или ответ";
  textarea.dataset.commentText = target;
  textarea.setAttribute("aria-label", "Текст комментария");
  fields.append(author, textarea);

  const actions = makeElement("div", "thread-composer-actions");
  const error = makeElement("span", "thread-error");
  error.dataset.commentError = "";
  const add = makeElement("button", "button button-primary thread-add", "Добавить");
  add.type = "button";
  add.dataset.addComment = target;
  actions.append(error, add);
  composer.append(replyingTo, fields, actions);
  editor.append(composer);
  wrap.append(toggle, editor);
  return wrap;
}

function detailValue(item, label, value, target) {
  const block = makeElement("div", `detail-value${commentsFor(item, target).length ? " has-note" : ""}`);
  block.append(makeElement("span", "detail-label", label));
  block.append(makeElement("strong", "detail-value-text", String(value ?? "").trim() || "—"));
  block.append(noteControl(item, target));
  return block;
}

function detailRow(item, title, meta, lines, target) {
  const row = makeElement("div", `detail-row${commentsFor(item, target).length ? " has-note" : ""}`);
  const heading = makeElement("div", "detail-row-heading");
  heading.append(makeElement("strong", "", title || "—"));
  if (meta) heading.append(makeElement("span", "", meta));
  row.append(heading);
  lines.filter((line) => line.value !== undefined && line.value !== "").forEach((line) => {
    const text = makeElement("p", "detail-row-line");
    text.append(makeElement("span", "", `${line.label}: `));
    text.append(document.createTextNode(String(line.value)));
    row.append(text);
  });
  row.append(noteControl(item, target));
  return row;
}

function detailSection(item, number, title, target) {
  const section = makeElement("section", `submitted-section${commentsFor(item, target).length ? " has-note" : ""}`);
  const heading = makeElement("div", "submitted-section-heading");
  heading.append(makeElement("span", "section-number", number), makeElement("h3", "", title));
  heading.append(noteControl(item, target, "Комментарий к разделу"));
  section.append(heading);
  return section;
}

function emptyDetail(text) {
  return makeElement("p", "detail-empty", text);
}

function renderSubmittedReport(item) {
  activeReportId = item.id;
  const root = $("#report-detail");
  root.replaceChildren();
  $("#detail-status").textContent = `Отправлен ${formatDate(item.submittedAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  const sheet = makeElement("article", "submitted-sheet");
  const header = makeElement("header", "submitted-header");
  const titleBlock = makeElement("div");
  titleBlock.append(makeElement("p", "eyebrow", "Weekly Affiliate Report"));
  titleBlock.append(makeElement("h2", "", item.manager || "Менеджер не указан"));
  titleBlock.append(makeElement("p", "submitted-period", `Неделя ${weekRange(item.weekStart)}`));
  header.append(titleBlock, noteControl(item, "report:general", "Комментарий к отчёту"));
  sheet.append(header);

  const results = detailSection(item, "01", "Результат недели", "section:results");
  const resultGrid = makeElement("div", "detail-metrics");
  resultGrid.append(
    detailValue(item, "FTD", item.metrics.ftd, "result:ftd"),
    detailValue(item, "Активные партнёры", item.metrics.activeAffiliates, "result:active"),
  );
  results.append(resultGrid);
  sheet.append(results);

  const acquisition = detailSection(item, "02", "Привлечение", "section:acquisition");
  const acquisitionCounts = makeElement("div", "detail-metrics detail-metrics-three");
  const filled = item.acquisition.filter((row) => row.partner && row.kind);
  acquisitionCounts.append(
    detailValue(item, "Новые партнёры", filled.filter((row) => row.kind === "newAffiliate").length, "acquisition:new"),
    detailValue(item, "Новые сделки", filled.filter((row) => row.kind === "newDeal").length, "acquisition:deals"),
    detailValue(item, "Реактивированы", filled.filter((row) => row.kind === "reactivated").length, "acquisition:reactivated"),
  );
  acquisition.append(acquisitionCounts);
  if (item.noSearch) acquisition.append(detailRow(item, "Поиском не занимался", "", [{ label: "Чем был занят", value: item.noSearchReason }], "acquisition:no-search"));
  item.acquisition.forEach((row) => {
    acquisition.append(detailRow(item, row.partner, `${kindLabels[row.kind] || "Тип не указан"} · ${row.geo} · ${row.source}`, [{ label: "Статус", value: row.result }], `acquisition:${row.id}`));
  });
  if (!item.acquisition.length && !item.noSearch) acquisition.append(emptyDetail("Данные не указаны."));
  sheet.append(acquisition);

  const existing = detailSection(item, "03", "Текущие партнёры", "section:existing");
  if (item.noExisting) existing.append(emptyDetail("Изменений по текущим партнёрам нет."));
  else if (!item.existing.length) existing.append(emptyDetail("Данные не указаны."));
  item.existing.forEach((row) => {
    existing.append(detailRow(item, row.email, `${row.geo} · ${row.movement === "grew" ? "Рост" : "Падение"}`, [{ label: "Причина", value: row.reason }, { label: "Что делаем", value: row.action }], `existing:${row.id}`));
  });
  sheet.append(existing);

  const problems = detailSection(item, "04", "Проблемы", "section:problems");
  if (item.noProblems) problems.append(emptyDetail("Проблем нет."));
  else item.problems.forEach((row) => {
    problems.append(detailRow(item, row.email, "", [{ label: "Проблема", value: row.problem }, { label: "Решение / статус", value: row.resolution }], `problem:${row.id}`));
  });
  sheet.append(problems);

  const nextWeek = detailSection(item, "05", "Следующая неделя", "section:next-week");
  nextWeek.append(detailValue(item, "План по поиску", item.metrics.searchPlan, "next-week:search-plan"));
  item.nextWeek.forEach((row) => {
    nextWeek.append(detailRow(item, row.plan, "", row.update ? [{ label: "Апдейт", value: row.update }] : [], `next-week:${row.id}`));
  });
  sheet.append(nextWeek);

  const summary = detailSection(item, "06", "Главное за неделю", "section:summary");
  const summaryGrid = makeElement("div", "detail-summary-grid");
  const groups = [
    { title: "Приоритеты", rows: item.priorities, prefix: "priority", empty: "Не указаны" },
    { title: "Топ проблем", rows: item.topProblems, prefix: "top-problem", empty: item.noTopProblems ? "Проблем нет" : "Не указаны" },
    { title: "Достижения", rows: item.achievements, prefix: "achievement", empty: item.noAchievements ? "Достижений нет" : "Не указаны" },
  ];
  groups.forEach((group) => {
    const column = makeElement("div", "detail-summary-column");
    column.append(makeElement("h4", "", group.title));
    if (!group.rows.length) column.append(emptyDetail(group.empty));
    group.rows.forEach((row, index) => {
      column.append(detailRow(item, `${index + 1}. ${row.text}`, "", [], `${group.prefix}:${row.id}`));
    });
    summaryGrid.append(column);
  });
  summary.append(summaryGrid);
  sheet.append(summary);
  root.append(sheet);
}

function activeSubmittedReport() {
  return state.reports.find((candidate) => candidate.id === activeReportId);
}

function refreshCommentThread(item, target) {
  const current = $$(".review-note[data-note-target]", $("#report-detail"))
    .find((node) => node.dataset.noteTarget === target);
  if (!current) return;
  const replacement = noteControl(item, target, current.dataset.noteLabel || "Комментарий");
  current.replaceWith(replacement);
  replacement.closest(".detail-row, .detail-value, .submitted-section")?.classList.add("has-note");
  const editor = $(".note-editor", replacement);
  editor.hidden = false;
  replacement.classList.add("is-open");
  $("[data-note-toggle]", replacement)?.setAttribute("aria-expanded", "true");
  $("[data-comment-text]", replacement)?.focus();
}

function addComment(button) {
  const item = activeSubmittedReport();
  const composer = button.closest("[data-comment-composer]");
  if (!item || !composer) return;
  const target = button.dataset.addComment;
  const author = $("[data-comment-author]", composer);
  const textarea = $("[data-comment-text]", composer);
  const error = $("[data-comment-error]", composer);
  const authorValue = author.value.trim();
  const textValue = textarea.value.trim();

  author.classList.toggle("is-invalid", !authorValue);
  textarea.classList.toggle("is-invalid", !textValue);
  if (!authorValue || !textValue) {
    error.textContent = !authorValue && !textValue
      ? "Укажи имя и напиши комментарий"
      : !authorValue
        ? "Укажи, кто пишет"
        : "Напиши комментарий";
    (!authorValue ? author : textarea).focus();
    return;
  }

  item.comments ||= {};
  item.comments[target] ||= [];
  const message = {
    id: id(),
    author: authorValue,
    text: textValue,
    createdAt: new Date().toISOString(),
    replyTo: composer.dataset.replyTo || "",
  };
  item.comments[target].push(message);
  const previousAuthor = state.commentAuthor;
  state.commentAuthor = authorValue;
  if (!persistState({ immediate: true })) {
    item.comments[target] = item.comments[target].filter((candidate) => candidate.id !== message.id);
    if (!item.comments[target].length) delete item.comments[target];
    state.commentAuthor = previousAuthor;
    error.textContent = "Не удалось сохранить. Попробуй убрать часть старых данных.";
    return;
  }
  refreshCommentThread(item, target);
}

function startReply(button) {
  const item = activeSubmittedReport();
  const wrap = button.closest(".review-note");
  const target = button.dataset.noteTarget;
  const message = commentsFor(item || {}, target).find((candidate) => candidate.id === button.dataset.replyMessage);
  if (!item || !wrap || !message) return;
  const editor = $(".note-editor", wrap);
  const composer = $("[data-comment-composer]", wrap);
  const replyingTo = $("[data-replying-to]", composer);
  editor.hidden = false;
  $("[data-note-toggle]", wrap)?.setAttribute("aria-expanded", "true");
  composer.dataset.replyTo = message.id;
  $("[data-replying-text]", replyingTo).textContent = `Ответ на ${message.author}: ${short(message.text, "сообщение")}`;
  replyingTo.hidden = false;
  $("[data-comment-text]", composer)?.focus();
}

function cancelReply(button) {
  const composer = button.closest("[data-comment-composer]");
  if (!composer) return;
  composer.dataset.replyTo = "";
  $("[data-replying-to]", composer).hidden = true;
  $("[data-comment-text]", composer)?.focus();
}

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-comment-author], [data-comment-text]")) {
    target.classList.remove("is-invalid");
    const error = $("[data-comment-error]", target.closest("[data-comment-composer]"));
    if (error) error.textContent = "";
    return;
  }
  if (!report) return;
  dismissValidation();
  if (target.matches("[data-row] [data-field]")) {
    updateRow(target);
    return;
  }
  const staticBindings = {
    "manager-name": ["manager"],
    ftd: ["metrics", "ftd"],
    "active-affiliates": ["metrics", "activeAffiliates"],
    "search-plan": ["metrics", "searchPlan"],
    "no-search-reason": ["noSearchReason"],
  };
  const path = staticBindings[target.id];
  if (!path) return;
  if (path.length === 1) report[path[0]] = target.value;
  else report[path[0]][path[1]] = target.value;
  target.classList.remove("is-invalid");
  if (target.id === "no-search-reason") renderOptionalFields();
  persistState();
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!report || $("#editor-view").hidden) return;
  dismissValidation();
  if (target.matches("[data-row] [data-field]")) {
    updateRow(target);
    return;
  }
  if (target.id === "week-start") {
    report.weekStart = target.value;
    target.classList.remove("is-invalid");
    persistState();
    return;
  }
  const checkboxBindings = {
    "no-search": "noSearch",
    "no-existing": "noExisting",
    "no-problems": "noProblems",
    "no-top-problems": "noTopProblems",
    "no-achievements": "noAchievements",
  };
  const key = checkboxBindings[target.id];
  if (!key) return;
  report[key] = target.checked;
  target.classList.remove("is-invalid");
  renderOptionalFields();
  persistState();
  if (target.id === "no-search" && target.checked) $("#no-search-reason").focus();
});

app.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    showView(viewButton.dataset.view);
    return;
  }
  const openReport = event.target.closest("[data-open-report]");
  if (openReport) {
    const item = state.reports.find((candidate) => candidate.id === openReport.dataset.openReport);
    if (item) {
      renderSubmittedReport(item);
      showView("detail");
    }
    return;
  }
  const noteToggle = event.target.closest("[data-note-toggle]");
  if (noteToggle) {
    const wrap = noteToggle.closest(".review-note");
    const editor = $(".note-editor", wrap);
    editor.hidden = !editor.hidden;
    wrap.classList.toggle("is-open", !editor.hidden);
    noteToggle.setAttribute("aria-expanded", String(!editor.hidden));
    if (!editor.hidden) {
      const author = $("[data-comment-author]", editor);
      (author?.value.trim() ? $("[data-comment-text]", editor) : author)?.focus();
    }
    return;
  }
  const replyButton = event.target.closest("[data-reply-message]");
  if (replyButton) {
    startReply(replyButton);
    return;
  }
  const cancelReplyButton = event.target.closest("[data-cancel-reply]");
  if (cancelReplyButton) {
    cancelReply(cancelReplyButton);
    return;
  }
  const addCommentButton = event.target.closest("[data-add-comment]");
  if (addCommentButton) {
    addComment(addCommentButton);
    return;
  }
  if (event.target.closest("#submit-report")) {
    submitReport();
    return;
  }
  if (!report) return;
  const helpButton = event.target.closest("[data-help]");
  if (helpButton) {
    const helpId = helpButton.dataset.help;
    const willOpen = $(`#${helpId}`).hidden;
    closeHelp(willOpen ? helpId : "");
    return;
  }
  if (!event.target.closest(".help-popover")) closeHelp();
  const sectionToggle = event.target.closest("[data-toggle-section]");
  if (sectionToggle) {
    const card = sectionToggle.closest("[data-section-card]");
    const willOpen = card.classList.contains("is-collapsed");
    collapseAllSections(willOpen ? card : null);
    closeHelp();
    return;
  }
  const rowToggle = event.target.closest("[data-toggle-row]");
  if (rowToggle) {
    const row = rowToggle.closest("[data-row]");
    setRowCollapsed(row, !row.classList.contains("is-collapsed"));
    return;
  }
  const collapseButton = event.target.closest("[data-collapse-row]");
  if (collapseButton) {
    setRowCollapsed(collapseButton.closest("[data-row]"), true);
    return;
  }
  const addButton = event.target.closest("[data-add]");
  if (addButton) {
    addRow(addButton.dataset.add);
    return;
  }
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    const row = removeButton.closest("[data-row]");
    removeRow(row.dataset.type, row.dataset.id);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeHelp();
});

renderNav();
if (state.draft) {
  collapseAllSections();
  renderReport();
  showView("editor");
} else if (state.reports.length) {
  renderReports();
  showView("reports");
} else {
  showView("editor");
}
