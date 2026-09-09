const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const authScreen = $("#auth-screen");
const app = $("#app");
const saveState = $("#save-state");

const listConfig = {
  acquisition: { container: "#acquisition-list", template: "#acquisition-template", stateKey: "acquisition" },
  existing: { container: "#existing-list", template: "#existing-template", stateKey: "existing" },
  problems: { container: "#problems-list", template: "#problems-template", stateKey: "problems" },
  nextWeek: { container: "#next-week-list", template: "#next-week-template", stateKey: "nextWeek" },
  priorities: { container: "#priorities-list", template: "#compact-template", stateKey: "priorities" },
  topProblems: { container: "#top-problems-list", template: "#compact-template", stateKey: "topProblems" },
  achievements: { container: "#achievements-list", template: "#compact-template", stateKey: "achievements" },
};

let workspaceKey = sessionStorage.getItem("war-workspace") || "";
let report = null;
let saveTimer = null;

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
    version: 4,
    weekStart,
    manager: "",
    metrics: {
      ftd: "",
      activeAffiliates: "",
      searchPlan: "",
    },
    acquisition: [],
    existing: [],
    problems: [],
    nextWeek: [],
    priorities: [],
    topProblems: [],
    achievements: [],
    noSearch: false,
    noSearchReason: "",
    noProblems: false,
    noTopProblems: false,
    noAchievements: false,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeReport(value, weekStart) {
  const base = blankReport(weekStart);
  if (!value || typeof value !== "object") return base;
  const sourceMetrics = value.metrics || {};

  return {
    ...base,
    manager: typeof value.manager === "string" ? value.manager : "",
    metrics: {
      ftd: sourceMetrics.ftd ?? "",
      activeAffiliates: sourceMetrics.activeAffiliates ?? "",
      searchPlan: sourceMetrics.searchPlan ?? "",
    },
    acquisition: Array.isArray(value.acquisition)
      ? value.acquisition.map((row) => ({
          id: row.id || id(),
          collapsed: row.collapsed !== false,
          kind: row.kind ?? "",
          partner: row.partner ?? "",
          geo: row.geo ?? "",
          source: row.source ?? "",
          result: row.result ?? "",
        }))
      : [],
    existing: Array.isArray(value.existing)
      ? value.existing.map((row) => ({
          id: row.id || id(),
          collapsed: row.collapsed !== false,
          email: row.email ?? row.partner ?? "",
          geo: row.geo ?? "",
          movement: row.movement === "grew" || row.movement === "fell" ? row.movement : "",
          reason: row.reason ?? row.fact ?? "",
          action: row.action ?? "",
        }))
      : [],
    problems: Array.isArray(value.problems)
      ? value.problems.map((row) => ({
          id: row.id || id(),
          collapsed: row.collapsed !== false,
          email: row.email ?? row.subject ?? "",
          problem: row.problem ?? "",
          resolution: row.resolution ?? row.action ?? "",
        }))
      : [],
    nextWeek: Array.isArray(value.nextWeek)
      ? value.nextWeek.map((row) => ({
          id: row.id || id(),
          collapsed: row.collapsed !== false,
          plan: row.plan ?? row.action ?? "",
          update: row.update ?? row.result ?? "",
        }))
      : [],
    priorities: normalizeCompactList(value.priorities),
    topProblems: normalizeCompactList(value.topProblems),
    achievements: normalizeCompactList(value.achievements),
    noSearch: value.noSearch === true,
    noSearchReason: typeof value.noSearchReason === "string" ? value.noSearchReason : "",
    noProblems: value.noProblems === true,
    noTopProblems: value.noTopProblems === true,
    noAchievements: value.noAchievements === true,
    weekStart,
  };
}

function normalizeCompactList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({ id: row.id || id(), collapsed: row.collapsed !== false, text: row.text ?? "" }));
}

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(`weekly-affiliate-report:${password}`);
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 24);
  }
  let hash = 2166136261;
  bytes.forEach((byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  });
  return Math.abs(hash >>> 0).toString(36);
}

function storageKey(weekStart = report.weekStart) {
  return `war:${workspaceKey}:${weekStart}`;
}

function loadReport(weekStart) {
  try {
    return normalizeReport(JSON.parse(localStorage.getItem(storageKey(weekStart))), weekStart);
  } catch {
    return blankReport(weekStart);
  }
}

function persistReport() {
  if (!report || !workspaceKey) return;
  report.updatedAt = new Date().toISOString();
  saveState.textContent = "Сохраняю...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(storageKey(), JSON.stringify(report));
    saveState.textContent = "Все сохранено";
  }, 250);
}

function enterApp() {
  authScreen.hidden = true;
  app.hidden = false;
  const week = mondayFor();
  report = loadReport(week);
  collapseAllSections();
  renderReport();
}

function leaveApp() {
  clearTimeout(saveTimer);
  if (report && workspaceKey) localStorage.setItem(storageKey(), JSON.stringify(report));
  sessionStorage.removeItem("war-workspace");
  workspaceKey = "";
  report = null;
  app.hidden = true;
  authScreen.hidden = false;
  $("#password").value = "";
  $("#password").focus();
}

function renderReport() {
  $("#week-start").value = report.weekStart;
  $("#manager-name").value = report.manager;
  $("#ftd").value = report.metrics.ftd;
  $("#active-affiliates").value = report.metrics.activeAffiliates;
  $("#search-plan").value = report.metrics.searchPlan;
  $("#no-search").checked = report.noSearch;
  $("#no-search-reason").value = report.noSearchReason;
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
    $$('[data-field]', node).forEach((field) => {
      field.value = item[field.dataset.field] ?? "";
    });
    fillRowSummary(type, item, node);
    container.append(node);
  });
}

function short(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function fillRowSummary(type, item, node) {
  const main = $("[data-summary-main]", node);
  const secondary = $("[data-summary-secondary]", node);
  const kindLabels = { newAffiliate: "Новый партнёр", newDeal: "Новая сделка", reactivated: "Реактивирован" };
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
  $('[data-row]:last-child [data-field]', container)?.focus();
  persistReport();
}

function removeRow(type, rowId) {
  const stateKey = listConfig[type].stateKey;
  report[stateKey] = report[stateKey].filter((item) => item.id !== rowId);
  renderList(type);
  renderAcquisitionSummary();
  renderMovementSummary();
  persistReport();
}

function updateRow(target) {
  const row = target.closest("[data-row]");
  if (!row) return;
  const type = row.dataset.type;
  const stateKey = listConfig[type].stateKey;
  const item = report[stateKey].find((candidate) => candidate.id === row.dataset.id);
  if (!item) return;
  item[target.dataset.field] = target.value;
  fillRowSummary(type, item, row);
  if (type === "acquisition") renderAcquisitionSummary();
  if (type === "existing") renderMovementSummary();
  persistReport();
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
  persistReport();
}

function closeHelp(exceptId = "") {
  $$('[data-help]').forEach((button) => {
    const popover = $(`#${button.dataset.help}`);
    const keepOpen = button.dataset.help === exceptId;
    popover.hidden = !keepOpen;
    button.setAttribute("aria-expanded", String(keepOpen));
  });
}

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("#password").value;
  if (password.length < 4) {
    $("#auth-error").textContent = "Минимум 4 символа.";
    return;
  }
  $("#auth-error").textContent = "";
  workspaceKey = await hashPassword(password);
  sessionStorage.setItem("war-workspace", workspaceKey);
  enterApp();
});

app.addEventListener("input", (event) => {
  const target = event.target;
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
  if (target.id === "no-search-reason") renderOptionalFields();
  persistReport();
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-row] [data-field]")) {
    updateRow(target);
    return;
  }
  if (target.id === "week-start") {
    clearTimeout(saveTimer);
    localStorage.setItem(storageKey(), JSON.stringify(report));
    report = loadReport(target.value);
    collapseAllSections();
    renderReport();
    return;
  }

  const checkboxBindings = {
    "no-search": "noSearch",
    "no-problems": "noProblems",
    "no-top-problems": "noTopProblems",
    "no-achievements": "noAchievements",
  };
  const key = checkboxBindings[target.id];
  if (!key) return;
  report[key] = target.checked;
  renderOptionalFields();
  persistReport();
  if (target.id === "no-search" && target.checked) $("#no-search-reason").focus();
});

app.addEventListener("click", (event) => {
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

$("#logout").addEventListener("click", leaveApp);

if (workspaceKey) enterApp();
