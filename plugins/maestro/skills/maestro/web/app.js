/* dash-web client v3 - macOS-style window, sidebar views, SVG charts.
   No external libraries. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const I18n = window.I18n;
  const t = (key, vars) => I18n.t(key, vars);

  const KINDS = ["quick", "code", "ui", "hard"];
  const STATUS_CLASS = {
    running: "running", done: "done", failed: "failed", timeout: "failed",
    stalled: "stalled", blocked: "stalled", stopped: "stopped", lost: "stopped",
    pending: "pending", skipped: "skipped", paused: "paused",
  };
  const FAIL_GROUP = new Set(["failed", "timeout", "stalled", "blocked", "lost"]);
  const NOTIFY_STATUS = new Set(["done", "failed", "blocked", "stalled", "timeout"]);

  const VIEWS = ["overview", "jobs", "timeline", "plans", "models", "processes", "settings"];
  const ROUTE = {
    overview: "tong-quan", jobs: "cong-viec", timeline: "dong-thoi-gian",
    plans: "ke-hoach", models: "model", processes: "tien-trinh", settings: "cai-dat",
  };
  const viewLabel = (v) => t("nav." + v);
  const kindLabel = (k) => t("kind." + k);

  const statusClass = (s) => STATUS_CLASS[s] || "stopped";
  const statusLabel = (s) => t("status." + s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const shortModel = (m) => String(m || "").replace(/^opencode\//, "");
  const pad2 = (n) => String(n).padStart(2, "0");

  function dur(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ":" + pad2(m) : pad2(m)) + ":" + pad2(r);
  }
  const kfmt = (n) => I18n.compact(n);
  const hhmm = (ms) => I18n.time(ms);
  const hhmmss = (ms) => I18n.time(ms, true);
  function baseName(dir) {
    const s = String(dir || "").replace(/[\\/]+$/, "");
    return s.split(/[\\/]/).pop() || s || t("common.unknown");
  }
  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const relTime = (ts) => I18n.rel(ts);

  // ---------- storage ----------
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }

  // ---------- toast ----------
  const TOAST_MS = 5000;
  const TOAST_ICON = { success: "✓", error: "✕", warning: "!", info: "i" };
  function toastType(kind) {
    if (kind === "ok" || kind === "success" || kind === "good") return "success";
    if (kind === "bad" || kind === "error") return "error";
    if (kind === "warn" || kind === "warning") return "warning";
    return "info";
  }
  function toast(message, kind, detail) {
    let title = message;
    if (message && typeof message === "object") {
      title = message.title;
      detail = message.detail;
      kind = message.type || kind;
    }
    const box = $("#toasts");
    if (!box) return;
    const type = toastType(kind);
    const el = document.createElement("div");
    el.className = "toast t-" + type;
    el.setAttribute("role", "status");
    el.innerHTML =
      '<span class="toast-ico" aria-hidden="true">' + TOAST_ICON[type] + "</span>" +
      '<span class="toast-main"><b class="toast-title"></b>' +
        (detail ? '<span class="toast-detail"></span>' : "") + "</span>" +
      '<button class="toast-x" type="button" aria-label="' + esc(t("common.close")) + '">×</button>' +
      '<span class="toast-progress" aria-hidden="true"></span>';
    $(".toast-title", el).textContent = String(title == null ? "" : title);
    if (detail) {
      const d = $(".toast-detail", el);
      d.textContent = String(detail);
      d.title = String(detail);
    }
    box.prepend(el);
    requestAnimationFrame(() => el.classList.add("show"));
    while (box.children.length > 4) {
      const oldest = box.lastElementChild;
      if (!oldest) break;
      oldest.remove();
    }
    let remaining = TOAST_MS;
    let started = Date.now();
    let timer = null;
    const dismiss = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      el.classList.remove("show");
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 260);
    };
    const start = () => { started = Date.now(); timer = setTimeout(dismiss, Math.max(0, remaining)); };
    const pause = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      remaining -= Date.now() - started;
      const bar = $(".toast-progress", el);
      if (bar) bar.style.animationPlayState = "paused";
    };
    const resume = () => {
      if (timer || remaining <= 0) return;
      const bar = $(".toast-progress", el);
      if (bar) bar.style.animationPlayState = "running";
      start();
    };
    el.addEventListener("mouseenter", pause);
    el.addEventListener("mouseleave", resume);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", resume);
    const close = $(".toast-x", el);
    if (close) close.addEventListener("click", (e) => { e.stopPropagation(); dismiss(); });
    start();
  }

  // ---------- notification center ----------
  const NOTIF_KEY = "oc-notifications";
  const NOTIF_MAX = 30;
  let notifications = [];
  try {
    const raw = load(NOTIF_KEY, []);
    notifications = Array.isArray(raw) ? raw.filter((n) => n && n.type && n.at) : [];
  } catch { notifications = []; }
  let notifOpen = false;

  const notifLabel = (type) => t("notif." + type);

  function saveNotifications() {
    notifications = notifications.slice(0, NOTIF_MAX);
    store(NOTIF_KEY, notifications);
    renderBell();
  }

  function pushNotification(type, job, extra) {
    const id = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 7);
    notifications.unshift({
      id,
      type,
      jobId: job && job.id ? job.id : null,
      name: job ? (job.name || job.id || "") : "",
      model: shortModel(job && job.model ? job.model : ""),
      at: Date.now(),
      read: false,
      extra: extra || "",
    });
    saveNotifications();
    if (notifOpen) renderNotifList();
  }

  function renderBell() {
    const badge = $("#bellBadge");
    if (!badge) return;
    const unread = notifications.filter((n) => !n.read).length;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = unread === 0;
  }

  function renderNotifList() {
    const box = $("#notifList");
    if (!box) return;
    if (!notifications.length) {
      box.innerHTML = '<div class="np-empty">' + esc(t("notif.empty")) + "</div>";
      return;
    }
    const today = startOfToday();
    const groups = [
      { key: "today", label: t("notif.today"), items: notifications.filter((n) => Number(n.at) >= today) },
      { key: "earlier", label: t("notif.earlier"), items: notifications.filter((n) => Number(n.at) < today) },
    ];
    box.innerHTML = groups.filter((g) => g.items.length).map((g) => {
      const rows = g.items.map((n) => {
        const icon = n.type === "finished" ? "✓" : n.type === "failed" ? "✕"
          : n.type === "paused" ? "❚❚" : n.type === "resumed" ? "▶"
          : n.type === "rated" ? "★" : "•";
        const title = esc(n.name || notifLabel(n.type));
        const sub = [notifLabel(n.type), n.model, n.extra].filter(Boolean).join(" · ");
        return '<button type="button" class="np-item' + (n.read ? "" : " unread") + '"' +
          ' data-nid="' + esc(n.id) + '"' + (n.jobId ? ' data-job="' + esc(n.jobId) + '"' : "") + ">" +
          '<span class="np-ico ' + esc(n.type) + '" aria-hidden="true">' + icon + "</span>" +
          '<span class="np-main"><b>' + title + "</b><span>" + esc(sub) + "</span></span>" +
          '<span class="np-time">' + esc(relTime(n.at)) + "</span></button>";
      }).join("");
      return '<div class="np-group">' + esc(g.label) + "</div>" + rows;
    }).join("");
  }

  function setNotifOpen(open) {
    notifOpen = !!open;
    const panel = $("#notifPanel");
    const btn = $("#bellBtn");
    if (panel) panel.hidden = !notifOpen;
    if (btn) btn.setAttribute("aria-expanded", notifOpen ? "true" : "false");
    if (notifOpen) {
      renderNotifList();
      const first = $("#notifRead");
      if (first) first.focus({ preventScroll: true });
    }
  }

  function markAllRead() {
    let changed = false;
    notifications.forEach((n) => { if (!n.read) { n.read = true; changed = true; } });
    if (changed) saveNotifications();
    renderNotifList();
  }

  function clearNotifications() {
    notifications = [];
    saveNotifications();
    renderNotifList();
  }

  function wireNotifications() {
    const btn = $("#bellBtn");
    if (btn) btn.addEventListener("click", (e) => { e.stopPropagation(); setNotifOpen(!notifOpen); });
    const read = $("#notifRead");
    if (read) read.addEventListener("click", markAllRead);
    const clear = $("#notifClear");
    if (clear) clear.addEventListener("click", clearNotifications);
    const list = $("#notifList");
    if (list) list.addEventListener("click", (e) => {
      const item = e.target.closest(".np-item");
      if (!item) return;
      const n = notifications.find((x) => x.id === item.dataset.nid);
      if (n && !n.read) { n.read = true; saveNotifications(); }
      setNotifOpen(false);
      if (item.dataset.job) openDrawer(item.dataset.job);
    });
    document.addEventListener("click", (e) => {
      if (!notifOpen) return;
      const panel = $("#notifPanel");
      if (panel && panel.contains(e.target)) return;
      if (btn && btn.contains(e.target)) return;
      setNotifOpen(false);
    });
    renderBell();
  }

  // ---------- state ----------
  const S = {
    state: null,
    view: "overview",
    range: ["today", "24h", "7d"].includes(load("oc-range", "today")) ? load("oc-range", "today") : "today",
    filters: Object.assign(
      { project: "", status: "", model: "", kind: "", q: "" },
      load("oc-filters", {}) || {}
    ),
    filterOptSig: "",
    theme: load("oc-theme", "light") === "dark" ? "dark" : "light",
    notify: load("oc-notify", false) === true && ("Notification" in window) && Notification.permission === "granted",
    sound: load("oc-sound", false) === true,
    interval: [2, 5, 10].includes(Number(load("oc-interval", 2))) ? Number(load("oc-interval", 2)) : 2,
    collapsed: load("oc-side-collapsed", false) === true,
    compact: load("oc-compact", false) === true,
    density: (load("oc-density", "comfortable") === "compact" ? "compact" : "comfortable"),
    reducedMotion: load("oc-reduced-motion", false) === true,
    toastOnDone: load("oc-toast", true) !== false,
    sort: Object.assign({ key: "startedAt", dir: -1 }, load("oc-jsort", {}) || {}),
    page: 1,
    msort: { key: "model", dir: 1 },
    batches: [],
    selectedBatch: load("oc-batch", null),
    models: null,
    metrics: null,
    metricsAt: 0,
    metricsSig: "",
    drawer: { id: null, tab: "log", job: null, brief: null, briefId: null },
    drawerNoteDirty: false,
    version: null,
  };
  let jobsById = new Map();
  const liveLines = new Map();
  const prevStatus = new Map();
  const pausedFallback = new Map();
  let audioCtx = null;
  let pollTimer = null;
  let hiddenTimer = null;
  let lastRefresh = 0;
  let fetchInFlight = false;
  let fetchStartedAt = 0;

  const C = window.Charts || {};

  // ---------- theme ----------
  function applyTheme(theme) {
    S.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = S.theme;
    const on = S.theme === "dark";
    document.querySelectorAll(".theme-switch").forEach((btn) => {
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    syncSettings();
  }

  // ---------- sidebar / compact ----------
  let collapseTimer = null;
  function applyChrome() {
    document.body.classList.toggle("side-collapsed", !!S.collapsed);
    document.body.classList.toggle("compact", !!S.compact || S.density === "compact");
    document.body.classList.toggle("reduced-motion", !!S.reducedMotion);
    const label = t(S.collapsed ? "sidebar.open" : "sidebar.collapse");
    const btn = $("#collapseBtn");
    if (btn) {
      btn.setAttribute("aria-label", label);
      btn.title = label;
      btn.setAttribute("aria-expanded", S.collapsed ? "false" : "true");
    }
    const menu = $("#menuBtn");
    if (menu) {
      const ml = t(document.body.classList.contains("side-open") ? "sidebar.collapse" : "sidebar.open");
      menu.setAttribute("aria-label", ml);
      menu.title = ml;
    }
    syncSettings();
  }
  function setCollapsed(v, opts) {
    opts = opts || {};
    v = !!v;
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
    if (!opts.immediate && v === S.collapsed && document.body.classList.contains("side-collapsed") === v) {
      applyChrome();
      return;
    }
    S.collapsed = v;
    store("oc-side-collapsed", S.collapsed);
    if (!v) { S.compact = false; store("oc-compact", false); }
    if (opts.immediate) {
      document.body.classList.toggle("side-collapsed", v);
      document.body.classList.add("booted");
      applyChrome();
      return;
    }
    document.body.classList.add("side-fading");
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      document.body.classList.toggle("side-collapsed", v);
      document.body.classList.add("booted");
      applyChrome();
      requestAnimationFrame(() => document.body.classList.remove("side-fading"));
    }, 150);
  }
  function toggleSidebarMobile(force) {
    const open = force != null ? !!force : !document.body.classList.contains("side-open");
    document.body.classList.toggle("side-open", open);
    const scrim = $("#sidebarScrim");
    if (scrim) scrim.hidden = !open;
    const btn = $("#menuBtn");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    applyChrome();
  }

  // ---------- routing ----------
  function viewFromHash() {
    const h = String(location.hash || "").replace(/^#\/?/, "").trim();
    const found = VIEWS.find((v) => ROUTE[v] === h);
    return found || "overview";
  }
  function go(view) {
    if (!VIEWS.includes(view)) view = "overview";
    const hash = "#/" + ROUTE[view];
    if (location.hash === hash) applyView(view);
    else location.hash = hash;
  }
  function applyView(view) {
    if (!VIEWS.includes(view)) view = "overview";
    const _pop = $("#userPopover");
    if (_pop && !_pop.hidden) { _pop.hidden = true; const _uc = $("#userCard"); if (_uc) _uc.setAttribute("aria-expanded", "false"); }
    S.view = view;
    S.page = 1;
    $$(".navitem").forEach((a) => {
      const on = a.dataset.view === view;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    VIEWS.forEach((v) => {
      const el = document.getElementById("view-" + v);
      if (el) el.hidden = v !== view;
    });
    const titleEl = $("#pageTitle"), tb = $("#titlebarTitle");
    if (titleEl) titleEl.textContent = viewLabel(view);
    if (tb) tb.textContent = "Maestro — " + viewLabel(view);
    document.title = (view === "overview" && S.state && S.state.today && S.state.today.running
      ? "(" + S.state.today.running + ") " : "") + "Maestro · " + viewLabel(view);
    store("oc-view", view);
    toggleSidebarMobile(false);
    syncSearchResults();
    refreshView(view);
    if (C.hideTip) C.hideTip();
  }

  function refreshView(view) {
    if (view === "overview") renderOverview();
    else if (view === "jobs") renderJobs();
    else if (view === "timeline") { loadTimeline(); renderTimelineCharts(); }
    else if (view === "plans") { loadBatches(); renderPlans(); }
    else if (view === "models") { loadModels(); renderModels(); }
    else if (view === "processes") renderProcesses();
    else if (view === "settings") { syncSettings(); refreshSettingsView(); }
  }

  // ---------- polling ----------
  let transitionsSeeded = false;
  const prevRating = new Map();
   async function poll() {
     fetchInFlight = true;
     fetchStartedAt = Date.now();
     updateConnLabel();
     try {
       const res = await fetch("/api/state", { cache: "no-store" });
       if (!res.ok) throw new Error("HTTP " + res.status);
       const next = await res.json();
       S.state = next;
       lastRefresh = Date.now();
       jobsById = new Map((next.jobs || []).map((j) => [j.id, j]));
       handleTransitions(next);
       if (S.drawer.id) {
         const sj = jobsById.get(S.drawer.id);
         if (sj) S.drawer.job = Object.assign({}, S.drawer.job, sj);
       }
       fetchInFlight = false;
       setOnline(true);
       updateChromeData();
       refreshView(S.view);
       if (S.drawer.id) renderDrawer();
     } catch {
       fetchInFlight = false;
       setOnline(false);
     }
     updateConnLabel();
   }

  function handleTransitions(state) {
    const seen = new Set();
    for (const j of state.jobs || []) {
      seen.add(j.id);
      const was = prevStatus.get(j.id);
      const ratingWas = prevRating.get(j.id);
      if (transitionsSeeded) {
        if (was === undefined && j.status === "running") {
          pushNotification("started", j);
        } else if (was === "running" && j.status === "paused") {
          pushNotification("paused", j);
          if (S.toastOnDone) toast(t("toast.jobPaused"), "warning", j.name || j.id);
        } else if (was === "paused" && j.status === "running") {
          pushNotification("resumed", j);
          if (S.toastOnDone) toast(t("toast.jobResumed"), "info", j.name || j.id);
        } else if (was === "running" && NOTIFY_STATUS.has(j.status)) {
          const failed = FAIL_GROUP.has(j.status);
          notifyJob(j);
          pushNotification(failed ? "failed" : "finished", j);
          if (S.toastOnDone) toast(failed ? t("toast.jobFailed") : t("toast.jobDone"), failed ? "error" : "success",
            (j.name || j.id) + " · " + dur(elapsedOf(j)));
        }
        if (ratingWas && j.rating && ratingWas !== j.rating) {
          pushNotification("rated", j, t(j.rating === "good" ? "rating.good" : "rating.bad"));
        }
      }
      prevStatus.set(j.id, j.status);
      if (j.rating) prevRating.set(j.id, j.rating);
      else prevRating.delete(j.id);
    }
    if (prevStatus.size > 800) {
      for (const id of Array.from(prevStatus.keys())) if (!seen.has(id)) prevStatus.delete(id);
    }
    // First load with an empty center (new window, cleared storage): fill it from jobs that ended in the last 24 h,
    // so the bell shows what happened while no dashboard window was open.
    if (!transitionsSeeded && !notifications.length) {
      const since = Date.now() - 24 * 3600 * 1000;
      const ended = (state.jobs || [])
        .filter((j) => NOTIFY_STATUS.has(j.status) && (j.endedAt || 0) > since && !/^bench-/.test(j.name || ""))
        .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
        .slice(0, NOTIF_MAX);
      notifications = ended.map((j) => ({
        id: "seed-" + j.id,
        type: FAIL_GROUP.has(j.status) ? "failed" : "finished",
        jobId: j.id,
        name: j.name || j.id,
        model: shortModel(j.model || ""),
        at: j.endedAt,
        read: true,
        extra: "",
      }));
      if (notifications.length) saveNotifications();
    }
    transitionsSeeded = true;
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => { if (!document.hidden) poll(); }, S.interval * 1000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function restartPolling() {
    startPolling();
    const iv = $("#refreshIv");
    if (iv) iv.textContent = t("refresh.every", { n: S.interval });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
      if (S.notify && !hiddenTimer) hiddenTimer = setInterval(() => poll(), 10000);
    } else {
      if (hiddenTimer) { clearInterval(hiddenTimer); hiddenTimer = null; }
      poll();
      startPolling();
      refreshView(S.view);
    }
  });

  // ---------- connection ----------
   function connStatusText() {
     if (document.body.classList.contains("offline")) return t("conn.offline");
     const now = Date.now();
     if (fetchInFlight && fetchStartedAt && (now - fetchStartedAt) > 1000) return t("conn.updating");
     if (lastRefresh && (now - lastRefresh) <= 5000) return t("conn.live");
     return t("conn.updating");
   }
   function updateConnLabel() {
     const text = connStatusText();
     ["#connText", "#tbConnText"].forEach((sel) => {
       const el = $(sel);
       if (el) el.textContent = text;
     });
   }
   function setOnline(ok) {
     document.body.classList.toggle("offline", !ok);
     ["#connDot", "#connDotTop"].forEach((sel) => {
       const el = $(sel);
       if (el) el.classList.toggle("bad", !ok);
     });
     updateUserCard();
     const rt = $("#refreshTime");
     if (rt) rt.textContent = ok && lastRefresh ? hhmmss(lastRefresh) : "--:--:--";
     updateConnLabel();
   }

  function updateUserCard() {
    const dot = $("#userStatusDot");
    const text = $("#userStatusText");
    const offline = document.body.classList.contains("offline");
    if (dot) dot.classList.toggle("bad", offline);
    if (text) {
      text.classList.toggle("offline", offline);
      if (offline) text.textContent = t("conn.offline");
      else {
        const running = (S.state && S.state.jobs) ? S.state.jobs.filter((j) => j.status === "running").length : 0;
        text.textContent = running > 0 ? t("user.runningJobs", { n: running }) : t("user.idle");
      }
    }
    const uc = $("#userCard");
    if (uc) uc.setAttribute("aria-expanded", $("#userPopover") && !$("#userPopover").hidden ? "true" : "false");
  }

  function updateChromeData() {
    if (!S.state) return;
    const running = (S.state.jobs || []).filter((j) => j.status === "running").length;
    const max = S.state.maxParallel || 3;
    const slots = running + "/" + max;
    ["#slots", "#slotsTop"].forEach((sel) => { const el = $(sel); if (el) el.textContent = slots; });
    const bj = $("#badgeJobs");
    if (bj) { bj.hidden = !running; bj.textContent = String(running); }
    updateUserCard();
    const bc = $("#badgeProcs");
    const procs = (S.state.processes || []).length;
    if (bc) { bc.hidden = !procs; bc.textContent = String(procs); }
  }

  function updateTitle() {
    const running = (S.state && S.state.today && S.state.today.running) || 0;
    document.title = (running ? "(" + running + ") " : "") + "Maestro · " + viewLabel(S.view);
  }

  // ---------- notifications ----------
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { audioCtx = new Ctx(); } catch { audioCtx = null; }
    return audioCtx;
  }

  function chime() {
    if (!S.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      const t0 = ctx.currentTime;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const at = t0 + i * 0.13;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.06, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.55);
      });
    } catch { /* audio unavailable */ }
  }

  function notifyJob(job) {
    const d = dur(elapsedOf(job));
    const body = statusLabel(job.status) + " · " + shortModel(job.model || "—") + " · " + d;
    if (S.notify && "Notification" in window && Notification.permission === "granted") {
      try { new Notification(job.name || job.id, { body, tag: job.id }); } catch { /* ignore */ }
    }
    if (S.sound) chime();
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      toast(t("toast.notifyUnsupported"), "error");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Promise.race([
          Notification.requestPermission().catch(() => "denied"),
          new Promise((resolve) => setTimeout(() => resolve("default"), 12000)),
        ]);
      } catch { perm = "denied"; }
    }
    if (perm === "granted") {
      S.notify = true;
      store("oc-notify", true);
      toast(t("toast.notifyOn"), "success");
    } else if (perm === "default") {
      S.notify = false;
      toast(t("toast.notifyPending"), "error");
    } else {
      S.notify = false;
      store("oc-notify", false);
      toast(t("toast.notifyDenied"), "error");
    }
    syncSettings();
  }

  // ---------- elapsed ----------
  function elapsedOf(j) {
    if (!j) return 0;
    const start = Number(j.startedAt) || 0;
    if (!start) return 0;
    const end = Number(j.endedAt) || 0;
    const pausedMs = Number(j.pausedMs) || 0;
    if (end) return Math.max(0, end - start - pausedMs);
    let value = Date.now() - start - pausedMs;
    if (j.paused) {
      const pausedAt = Number(j.pausedAt) || 0;
      if (pausedAt > start) value -= Math.max(0, Date.now() - pausedAt);
      else {
        const id = j.id || "?";
        if (!pausedFallback.has(id)) pausedFallback.set(id, value);
        value = pausedFallback.get(id);
      }
    } else if (j.id) {
      pausedFallback.delete(j.id);
    }
    return Math.max(0, value);
  }

  function updateElapsed() {
    $$("[data-start]").forEach((el) => {
      const start = Number(el.dataset.start) || 0;
      if (!start) return;
      const end = Number(el.dataset.end) || 0;
      const paused = el.dataset.paused === "1";
      const pausedMs = Number(el.dataset.pausedMs) || 0;
      const pausedAt = Number(el.dataset.pausedAt) || 0;
      let ms;
      if (end) ms = end - start - pausedMs;
      else if (paused) {
        ms = Date.now() - start - pausedMs - (pausedAt > start ? Date.now() - pausedAt : 0);
      } else {
        ms = Date.now() - start - pausedMs;
      }
      el.textContent = dur(Math.max(0, ms));
    });
  }
  setInterval(updateElapsed, 1000);

  // ---------- metrics ----------
  function metricsStale() {
    return !S.metrics || Date.now() - S.metricsAt > 7000;
  }
  async function ensureMetrics(force) {
    if (!force && !metricsStale()) return S.metrics;
    try {
      const res = await fetch("/api/metrics?range=" + encodeURIComponent(S.range), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const m = await res.json();
      S.metrics = m;
      S.metricsAt = Date.now();
      return m;
    } catch {
      return S.metrics;
    }
  }

  async function loadMetricsAndRender() {
    await ensureMetrics(true);
    if (S.view === "overview") renderOverview(true);
    else if (S.view === "timeline") renderTimelineCharts(true);
  }

  // ---------- KPI ----------
  function kpiCard(label, valueHtml, sub, cls, sparkKey) {
    return '<div class="kpi ' + (cls || "") + '">' +
      '<div class="kpi-label">' + esc(label) + "</div>" +
      '<div class="kpi-value">' + valueHtml + "</div>" +
      '<div class="kpi-sub">' + esc(sub) + "</div>" +
      '<div class="kpi-spark" data-spark="' + esc(sparkKey) + '"></div>' +
    "</div>";
  }

  function renderOverview(forceCharts) {
    const m = S.metrics;
    if (!m) return;
    const box = $("#kpis");
    if (box) {
      const k = m.kpis || {};
      const max = (S.state && S.state.maxParallel) || 3;
      const cards = [
        kpiCard(t("kpi.running"), String(k.running || 0) + "<small>/" + max + "</small>", t("kpi.runningSub"), "accent", "running"),
        kpiCard(t("kpi.done"), String(k.done || 0), t("kpi.doneSub"), "", "done"),
        kpiCard(t("kpi.failed"), String(k.failed || 0), t("kpi.failedSub"), k.failed ? "bad" : "", "failed"),
        kpiCard(t("kpi.success"), k.successRate == null ? "—" : I18n.dec(k.successRate, 1) + "<small>%</small>", t("kpi.successSub"), "", "successRate"),
        kpiCard(t("kpi.tokens"), kfmt(k.tokens || 0), t("kpi.tokensSub"), "", "tokens"),
        kpiCard(t("kpi.avg"), k.avgSeconds == null ? "—" : dur(k.avgSeconds * 1000), t("kpi.avgSub"), "", "avgSeconds"),
      ];
      box.innerHTML = cards.join("");
      const sp = m.sparklines || {};
      $$("[data-spark]", box).forEach((el) => {
        const key = el.dataset.spark;
        const vals = sp[key] || [];
        if (C.sparkline) C.sparkline(el, vals, { height: 34, color: key === "failed" ? "var(--c-failed)" : "var(--chart-2)" });
      });
    }

    const legend = $("#hourLegend");
    if (legend) {
      legend.innerHTML =
        '<span class="lg-item"><i style="background:var(--c-done)"></i>' + esc(t("legend.done")) + "</span>" +
        '<span class="lg-item"><i style="background:var(--c-failed)"></i>' + esc(t("legend.failed")) + "</span>" +
        '<span class="lg-item"><i style="background:var(--c-other)"></i>' + esc(t("legend.other")) + "</span>";
    }
    if (C.stackedBarChart) {
      C.stackedBarChart($("#chartHourly"), { buckets: m.jobsPerBucket || [], mode: m.mode }, { height: 236 });
    }

    if (C.donutChart) {
      const sc = m.statusCounts || {};
      let failed = 0, other = 0;
      for (const [s, n] of Object.entries(sc)) {
        if (s === "done" || s === "running") continue;
        if (FAIL_GROUP.has(s)) failed += Number(n) || 0;
        else other += Number(n) || 0;
      }
      const items = [
        { label: t("status.done"), value: Number(sc.done) || 0, color: "var(--c-done)" },
        { label: t("status.running"), value: Number(sc.running) || 0, color: "var(--c-running)" },
        { label: t("status.failed"), value: failed, color: "var(--c-failed)" },
        { label: t("legend.other"), value: other, color: "var(--c-other)" },
      ].filter((i) => i.value > 0);
      const total = items.reduce((s, i) => s + i.value, 0);
      C.donutChart($("#chartStatus"), { items }, { height: 236, centerValue: String(total), centerLabel: t("chart.job") });
    }

    if (C.hBarChart) {
      const items = (m.tokensByModel || []).slice(0, 9).map((x) => ({
        label: shortModel(x.model), value: x.tokens,
        tip: "<b>" + esc(shortModel(x.model)) + "</b><span>" + kfmt(x.tokens) + " " + esc(t("table.tokens").toLowerCase()) + "</span>",
      }));
      C.hBarChart($("#chartTokens"), { items }, { height: 236, label: t("card.tokensByModel") });
    }

    if (C.areaChart) {
      C.areaChart($("#chartConcurrency"), {
        points: m.concurrency || [],
      }, { height: 236, dayMode: m.mode === "day", valueLabel: t("chart.parallel"), label: t("card.concurrency") });
    }

    renderLive();
    renderFeed();
    updateElapsed();
  }

  // ---------- live ----------
  function jobActionsHtml(j, compact) {
    if (!j || j.status !== "running") return "";
    const pauseLabel = j.paused ? t("job.resume") : t("job.pause");
    const pauseTitle = j.paused ? t("job.resumeTitle") : t("job.pauseTitle");
    const icon = j.paused
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5l11 7-11 7V5z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
    return '<button type="button" class="rowact pause" data-act="' + (j.paused ? "resume" : "pause") + '" data-id="' + esc(j.id) + '"' +
      ' title="' + esc(pauseTitle) + '" aria-label="' + esc(pauseLabel) + '">' + icon +
      (compact ? "" : "<span>" + esc(pauseLabel) + "</span>") + "</button>" +
      '<button type="button" class="rowact stop" data-act="stop" data-id="' + esc(j.id) + '" title="' + esc(t("job.stopTitle")) + '" aria-label="' + esc(t("job.stop")) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>';
  }

  function renderLive() {
    const body = $("#liveBody");
    if (!body) return;
    const running = ((S.state && S.state.jobs) || []).filter((j) => j.status === "running");
    const countEl = $("#liveCount");
    if (countEl) countEl.textContent = running.length ? t("live.count", { n: running.length }) : "";
    if (!running.length) {
      body.innerHTML = '<div class="empty">' + esc(t("live.empty")) + "</div>";
      return;
    }
    const now = Date.now();
    body.innerHTML = running.map((j) => {
      const lastEvent = Number(j.lastEventAt) || 0;
      const stale = !!lastEvent && now - lastEvent > 90000 && !j.paused;
      const cached = liveLines.get(j.id);
      const line = (cached && cached.line) || j.lastActivity || "";
      const lastNote = cached && now - cached.at < 6000 ? cached.line : (j.lastActivity || line);
      return '<article class="live-card' + (stale ? " stale" : "") + (j.paused ? " is-paused" : "") + '" data-live-card="' + esc(j.id) + '">' +
        '<div class="live-top">' +
          (j.paused
            ? '<span class="pill paused"><i class="dot"></i>' + esc(t("status.paused")) + "</span>"
            : '<span class="pill running"><i class="dot"></i>' + esc(t("status.running")) + "</span>") +
          '<span class="live-name" title="' + esc(j.title || j.name || j.id) + '">' + esc(j.name || j.id) + "</span>" +
          (stale ? '<span class="silent">' + esc(t("live.silent")) + "</span>" : "") +
          '<span class="live-acts">' + jobActionsHtml(j, true) + "</span>" +
        "</div>" +
        '<div class="live-meta">' +
          '<span class="live-proj" title="' + esc(j.dir || "") + '">' + esc(baseName(j.dir)) + "</span>" +
          '<span class="mono" title="' + esc(j.model || "") + '">' + esc(shortModel(j.model)) + "</span>" +
          (j.kind ? '<span class="kindpill">' + esc(kindLabel(j.kind)) + "</span>" : "") +
        "</div>" +
        '<div class="live-nums">' +
          '<span><i>' + esc(t("live.time")) + '</i><b data-start="' + (Number(j.startedAt) || 0) + '" data-end="0"' +
            ' data-paused="' + (j.paused ? "1" : "0") + '" data-paused-ms="' + (Number(j.pausedMs) || 0) + '"' +
            ' data-paused-at="' + (Number(j.pausedAt) || 0) + '">…</b></span>' +
          "<span><i>" + esc(t("live.steps")) + "</i><b>" + (Number(j.steps) || 0) + "</b></span>" +
          "<span><i>" + esc(t("live.tokens")) + "</i><b>" + kfmt(j.tokens || 0) + "</b></span>" +
        "</div>" +
        '<div class="live-last" data-live-id="' + esc(j.id) + '" title="' + esc(lastNote) + '">› ' + esc(lastNote || "—") + "</div>" +
      "</article>";
    }).join("");
    $$(".live-card", body).forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        openDrawer(el.dataset.liveCard);
      });
    });
    $$("[data-act]", body).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        runJobAction(btn.dataset.act, btn.dataset.id, btn);
      });
    });
  }

  async function refreshLiveLines() {
    if (!S.state || document.hidden) return;
    const running = (S.state.jobs || []).filter((j) => j.status === "running");
    for (const j of running) {
      const cached = liveLines.get(j.id);
      if (cached && Date.now() - cached.at < 3500) continue;
      liveLines.set(j.id, { line: cached ? cached.line : "", at: Date.now() });
      fetch("/api/log/" + encodeURIComponent(j.id) + "?lines=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : ""))
        .then((text) => {
          const line = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() || "";
          liveLines.set(j.id, { line, at: Date.now() });
          $$(".live-last").forEach((el) => {
            if (el.dataset.liveId === j.id) {
              el.textContent = "› " + (line || "—");
              el.title = line || "";
            }
          });
        })
        .catch(() => { /* ignore */ });
    }
  }

  // ---------- feed ----------
  const EVENT_META = {
    start: { key: "event.start", cls: "running", icon: "▶" },
    done: { key: "event.done", cls: "done", icon: "✓" },
    failed: { key: "event.failed", cls: "failed", icon: "!" },
    rated: { key: "event.rated", cls: "rated", icon: "★" },
  };

  function renderFeed() {
    const box = $("#recentFeed");
    if (!box) return;
    const events = (S.metrics && S.metrics.recentEvents) || [];
    if (!events.length) {
      box.innerHTML = '<div class="empty">' + esc(t("feed.empty")) + "</div>";
      return;
    }
    box.innerHTML = events.slice(0, 15).map((e) => {
      const meta = EVENT_META[e.type] || EVENT_META.start;
      const detail = e.type === "rated"
        ? " · " + t(e.rating === "good" ? "rating.good" : "rating.bad")
        : "";
      return '<button type="button" class="feed-item" data-job="' + esc(e.jobId) + '">' +
        '<span class="feed-ico ' + meta.cls + '">' + meta.icon + "</span>" +
        '<span class="feed-main"><b title="' + esc(e.name) + '">' + esc(e.name) + "</b>" +
          "<span>" + esc(t(meta.key)) + " · " + esc(e.project) + esc(detail) + "</span></span>" +
        '<span class="feed-time" title="' + esc(I18n.date(e.at)) + '">' + esc(relTime(e.at)) + "</span>" +
      "</button>";
    }).join("");
    $$(".feed-item", box).forEach((el) => {
      el.addEventListener("click", () => openDrawer(el.dataset.job));
    });
  }

  // ---------- jobs ----------
  function saveFilters() { store("oc-filters", S.filters); }

  function syncFilterChips() {
    $$("#fStatus .chipbtn").forEach((b) => {
      b.classList.toggle("active", (b.dataset.value || "") === (S.filters.status || ""));
    });
    $$("#fKind .chipbtn").forEach((b) => {
      b.classList.toggle("active", (b.dataset.value || "") === (S.filters.kind || ""));
    });
    const p = $("#fProject"); if (p) p.value = [...p.options].some((o) => o.value === S.filters.project) ? S.filters.project : "";
    const m = $("#fModel"); if (m) m.value = [...m.options].some((o) => o.value === S.filters.model) ? S.filters.model : "";
    const q = $("#fSearch");
    if (q && document.activeElement !== q) q.value = S.filters.q || "";
  }

  function syncFilterOptions() {
    if (!S.state) return;
    const jobs = S.state.jobs || [];
    const projects = new Map();
    const models = new Set();
    for (const j of jobs) {
      if (j.dir && !projects.has(j.dir)) projects.set(j.dir, baseName(j.dir));
      if (j.model) models.add(j.model);
    }
    const sig = [...projects.keys()].sort().join("|") + "::" + [...models].sort().join("|");
    if (sig === S.filterOptSig) return;
    S.filterOptSig = sig;

    const p = $("#fProject");
    if (p) {
      const cur = S.filters.project || "";
      p.innerHTML = '<option value="">' + esc(t("filter.allProjects")) + "</option>" +
        [...projects.entries()].sort((a, b) => a[1].localeCompare(b[1], I18n.locale))
          .map(([dir, name]) => '<option value="' + esc(dir) + '">' + esc(name) + "</option>").join("");
      p.value = projects.has(cur) ? cur : "";
      if (!projects.has(cur)) S.filters.project = "";
    }
    const m = $("#fModel");
    if (m) {
      const cur = S.filters.model || "";
      m.innerHTML = '<option value="">' + esc(t("filter.allModels")) + "</option>" +
        [...models].sort((a, b) => shortModel(a).localeCompare(shortModel(b), I18n.locale))
          .map((id) => '<option value="' + esc(id) + '">' + esc(shortModel(id)) + "</option>").join("");
      m.value = models.has(cur) ? cur : "";
      if (!models.has(cur)) S.filters.model = "";
    }
  }

  function rangeCutoff() {
    if (S.range === "24h") return Date.now() - 24 * 3600 * 1000;
    if (S.range === "7d") return Date.now() - 7 * 24 * 3600 * 1000;
    return startOfToday();
  }

  function baseFiltered(ignoreStatus) {
    const cutoff = rangeCutoff();
    const f = S.filters;
    const q = String(f.q || "").trim().toLowerCase();
    return ((S.state && S.state.jobs) || []).filter((j) => {
      if (j.startedAt && j.startedAt < cutoff) return false;
      if (f.project && j.dir !== f.project) return false;
      if (f.model && j.model !== f.model) return false;
      if (f.kind && j.kind !== f.kind) return false;
      if (!ignoreStatus) {
        if (f.status === "failed") { if (!FAIL_GROUP.has(j.status)) return false; }
        else if (f.status === "stopped") { if (j.status !== "stopped") return false; }
        else if (f.status && j.status !== f.status) return false;
      }
      if (q) {
        const hay = [j.name, j.id, j.title, j.model, j.dir, j.lastActivity, j.batchJob]
          .map((v) => String(v || "").toLowerCase()).join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function filteredJobs() { return baseFiltered(false); }

  function sortValue(j, key) {
    if (key === "project") return baseName(j.dir);
    if (key === "rating") return j.rating || "";
    if (key === "status") return j.status || "";
    return j[key];
  }

  function sortedJobs(list) {
    const { key, dir } = S.sort;
    return list.slice().sort((a, b) => {
      let va = sortValue(a, key), vb = sortValue(b, key);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va || "").localeCompare(String(vb || ""), I18n.locale) * dir;
      }
      return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
    });
  }

  function jobRow(j) {
    const s = j.status || "lost";
    const sc = statusClass(s);
    const rating = j.rating === "good"
      ? '<span class="jrate good" title="' + esc(t("rating.title")) + '">✓</span>'
      : j.rating === "bad"
        ? '<span class="jrate bad" title="' + esc(t("rating.badTitle")) + '">✗</span>'
        : '<span class="mut">—</span>';
    const scope = j.outOfScope && j.outOfScope.length
      ? ' <span class="jscope" title="' + esc(t("scope.out", { list: j.outOfScope.join(", ") })) + '">!scope</span>'
      : "";
    const paused = j.paused && s === "running";
    return '<tr class="jrow" data-id="' + esc(j.id) + '">' +
      '<td><span class="pill ' + (paused ? "paused" : sc) + '">' + (s === "running" ? '<i class="dot"></i>' : "") +
        esc(paused ? t("status.paused") : statusLabel(s)) + "</span></td>" +
      '<td><div class="jname" title="' + esc(j.title || j.name || j.id) + '">' + esc(j.name || j.id) +
        (j.attempt > 1 ? '<span class="retry">↻' + j.attempt + "</span>" : "") + scope + "</div></td>" +
      '<td><div class="jproj" title="' + esc(j.dir || "") + '">' + esc(baseName(j.dir) || "—") + "</div></td>" +
      '<td><div class="jcell-model" title="' + esc(j.model || "") + '">' + esc(shortModel(j.model) || "—") + "</div></td>" +
      "<td>" + (j.kind ? '<span class="kindpill">' + esc(kindLabel(j.kind)) + "</span>" : '<span class="mut">—</span>') + "</td>" +
      '<td><span class="jdur" data-start="' + (Number(j.startedAt) || 0) + '" data-end="' + (Number(j.endedAt) || 0) + '"' +
        ' data-paused="' + (paused ? "1" : "0") + '" data-paused-ms="' + (Number(j.pausedMs) || 0) + '"' +
        ' data-paused-at="' + (Number(j.pausedAt) || 0) + '">' + dur(elapsedOf(j)) + "</span></td>" +
      '<td class="jnum">' + (Number(j.steps) || 0) + "</td>" +
      '<td class="jnum">' + kfmt(j.tokens || 0) + "</td>" +
      "<td>" + rating + "</td>" +
      '<td><div class="jlast" title="' + esc(j.lastActivity || "") + '">' + esc(j.lastActivity || "—") + "</div></td>" +
      '<td class="act-col">' + (j.status === "running" ? '<div class="rowacts">' + jobActionsHtml(j, true) + "</div>" : '<span class="mut">—</span>') + "</td>" +
    "</tr>";
  }

  function chipsHtml() {
    const list = baseFiltered(true);
    let running = 0, done = 0, failed = 0, stopped = 0;
    for (const j of list) {
      if (j.status === "running") running++;
      else if (j.status === "done") done++;
      else if (FAIL_GROUP.has(j.status)) failed++;
      else stopped++;
    }
    return '<span class="schip running"><i></i>' + esc(t("chip.running")) + " <b>" + running + "</b></span>" +
      '<span class="schip done"><i></i>' + esc(t("chip.done")) + " <b>" + done + "</b></span>" +
      '<span class="schip failed"><i></i>' + esc(t("chip.failed")) + " <b>" + failed + "</b></span>" +
      '<span class="schip other"><i></i>' + esc(t("chip.other")) + " <b>" + stopped + "</b></span>";
  }

  function renderJobs() {
    syncFilterOptions();
    syncFilterChips();
    const chips = $("#jobChips");
    if (chips) chips.innerHTML = chipsHtml();
    const body = $("#jobsBody");
    if (!body) return;
    const jobs = sortedJobs(filteredJobs());
    const countEl = $("#jobsCount");
    if (countEl) countEl.textContent = jobs.length ? t("jobs.count", { n: jobs.length }) : "";
    const per = 20;
    const pages = Math.max(1, Math.ceil(jobs.length / per));
    if (S.page > pages) S.page = pages;
    const slice = jobs.slice((S.page - 1) * per, S.page * per);
    if (!jobs.length) {
      body.innerHTML = '<tr><td colspan="11"><div class="empty">' + esc(t("jobs.empty")) + "</div></td></tr>";
    } else {
      body.innerHTML = slice.map(jobRow).join("");
    }
    $$("#jobsTable th[data-sort]").forEach((th) => {
      const on = th.dataset.sort === S.sort.key;
      th.classList.toggle("sorted", on);
      th.dataset.dir = on ? (S.sort.dir > 0 ? "asc" : "desc") : "";
    });
    renderPager(jobs.length, pages);
    if (!body._wired) {
      body._wired = true;
      body.addEventListener("click", (e) => {
        const act = e.target.closest("button[data-act]");
        if (act) {
          e.stopPropagation();
          runJobAction(act.dataset.act, act.dataset.id, act);
          return;
        }
        const tr = e.target.closest("tr.jrow");
        if (tr && tr.dataset.id) openDrawer(tr.dataset.id);
      });
    }
  }

  function renderPager(total, pages) {
    const box = $("#jobsPager");
    if (!box) return;
    if (!total) { box.innerHTML = ""; return; }
    box.innerHTML =
      '<span class="pager-info">' + esc(t("pager.info", { total, page: S.page, pages })) + "</span>" +
      '<div class="pager-btns">' +
        '<button type="button" class="pbtn" data-page="' + (S.page - 1) + '"' + (S.page <= 1 ? " disabled" : "") + ">" + esc(t("pager.prev")) + "</button>" +
        '<button type="button" class="pbtn" data-page="' + (S.page + 1) + '"' + (S.page >= pages ? " disabled" : "") + ">" + esc(t("pager.next")) + "</button>" +
      "</div>";
  }

  let pagerWired = false;
  function wirePager() {
    const box = $("#jobsPager");
    if (!box || pagerWired) return;
    pagerWired = true;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-page]");
      if (!b || b.disabled) return;
      S.page = Math.max(1, Number(b.dataset.page) || 1);
      renderJobs();
      const card = $("#view-jobs .jobs-card");
      if (card) card.scrollIntoView({ block: "start" });
    });
  }

  // ---------- timeline ----------
  const TL = { hours: 6, data: null, geom: null, sig: "" };
  function tlHours() {
    if (S.range === "24h") return 24;
    if (S.range === "7d") return 168;
    return Math.max(1, Math.ceil((Date.now() - startOfToday()) / 3600_000));
  }

  async function loadTimeline(force) {
    const hours = tlHours();
    if (!force && TL.data && TL.hours === hours) return;
    try {
      const res = await fetch("/api/timeline?hours=" + encodeURIComponent(hours), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      TL.data = await res.json();
      TL.hours = hours;
      renderTimeline();
      renderTimelineCharts();
    } catch { /* keep the previous chart */ }
  }

  function layoutLane(list) {
    const sorted = list.slice().sort((a, b) => a.startedAt - b.startedAt);
    const rowEnds = [];
    const placed = [];
    for (const j of sorted) {
      const st = Number(j.startedAt) || 0;
      const en = Number(j.endedAt) || Date.now();
      let row = rowEnds.findIndex((end) => end <= st - 1000);
      if (row < 0) { row = rowEnds.length; rowEnds.push(en); }
      else rowEnds[row] = en;
      placed.push({ j, row });
    }
    return { placed, rows: Math.max(1, rowEnds.length) };
  }

  function renderTimelineCharts(force) {
    const m = S.metrics;
    if (!m) return;
    const el = $("#chartConcurrencyTl");
    if (el && C.areaChart) {
      C.areaChart(el, { points: m.concurrency || [] },
        { height: 170, dayMode: m.mode === "day", valueLabel: t("chart.parallel"), label: t("card.concurrency") });
    }
    const info = $("#tlRangeInfo");
    if (info) {
      const rangeKey = S.range === "today" ? "timeline.rangeToday" : S.range === "24h" ? "timeline.range24" : "timeline.range7";
      info.textContent = t(rangeKey) + " · " + t("timeline.buckets", { n: (m.jobsPerBucket || []).length });
    }
  }

  function renderTimeline() {
    const wrap = $("#ganttWrap");
    if (!wrap) return;
    const d = TL.data;
    const countEl = $("#tlCount");
    if (!d || !Array.isArray(d.jobs) || !d.jobs.length) {
      wrap.innerHTML = '<div class="empty">' + esc(t("timeline.empty", { hours: TL.hours })) + "</div>";
      if (countEl) countEl.textContent = "";
      TL.geom = null;
      return;
    }
    if (countEl) countEl.textContent = t("timeline.jobs", { n: d.jobs.length });

    const hours = Number(d.hours) || TL.hours;
    const from = Number(d.from) || (Date.now() - hours * 3600 * 1000);
    const now = Number(d.now) || Date.now();
    const span = Math.max(1, (now - from) * 1.02);
    TL.geom = { from, span };

    const pxPerHour = hours <= 1 ? 340 : hours <= 8 ? 180 : hours <= 30 ? 110 : 46;
    const chartW = Math.max(560, Math.round(hours * pxPerHour));

    const groups = new Map();
    for (const j of d.jobs) {
      const key = j.project || t("common.unknown");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(j);
    }

    const nowPct = Math.max(0, Math.min(100, ((now - from) / span) * 100));
    const stepMin = hours <= 1 ? 10 : hours <= 8 ? 60 : hours <= 30 ? 120 : 720;
    const stepMs = stepMin * 60000;
    let tickAt = Math.ceil(from / stepMs) * stepMs;
    const ticks = [];
    while (tickAt <= from + span && ticks.length < 220) {
      ticks.push(tickAt);
      tickAt += stepMs;
    }
    const axisHtml = ticks.map((t) => {
      const left = ((t - from) / span) * 100;
      const lbl = hours > 30 ? pad2(new Date(t).getDate()) + "/" + pad2(new Date(t).getMonth() + 1) + " " + hhmm(t) : hhmm(t);
      return '<div class="tick" style="left:' + left.toFixed(2) + '%">' + lbl + "</div>";
    }).join("") +
      '<div class="gnow" style="left:' + nowPct.toFixed(2) + '%"></div>' +
      '<div class="gnow-label" id="gNowLabel" style="left:' + nowPct.toFixed(2) + '%">' + esc(t("timeline.now")) + "</div>";

    const lanesHtml = [...groups.entries()].map(([project, list]) => {
      const { placed, rows } = layoutLane(list);
       const laneH = Math.max(34, rows * 24 + 4);
      const bars = placed.map(({ j, row }) => {
        const st = Math.max(Number(j.startedAt) || from, from);
        const running = j.status === "running";
        const rawEnd = running ? now : Math.min(Number(j.endedAt) || now, from + span);
        const left = Math.max(0, Math.min(100, ((st - from) / span) * 100));
        const width = Math.max(0.5, Math.min(100 - left, ((rawEnd - st) / span) * 100));
        return '<button type="button" class="gbar s-' + statusClass(j.status) + (running ? " live" : "") + '"' +
           ' style="left:' + left.toFixed(2) + "%;width:" + width.toFixed(2) + "%;top:" + (row * 24 + 4) + 'px"' +
          ' data-id="' + esc(j.id) + '" data-name="' + esc(j.name) + '" data-model="' + esc(shortModel(j.model)) + '"' +
          ' data-status="' + esc(statusLabel(j.status)) + '" data-gstart="' + st + '" data-gend="' + (Number(j.endedAt) || 0) + '"' +
          ' data-tokens="' + (Number(j.tokens) || 0) + '" data-live="' + (running ? "1" : "0") + '">' +
          '<span class="gbar-t">' + esc(j.name) + "</span></button>";
      }).join("");
      return '<div class="grow lane">' +
        '<div class="glabel"><span class="lane-name" title="' + esc(project) + '">' + esc(project) + "</span>" +
           '<span class="lane-count">' + esc(t("timeline.laneCount", { n: list.length })) + "</span></div>" +
        '<div class="gtrack" style="height:' + laneH + 'px">' + bars +
          '<div class="gnow" style="left:' + nowPct.toFixed(2) + '%"></div></div>' +
      "</div>";
    }).join("");

    wrap.innerHTML = '<div class="gantt-scroll"><div class="gantt-grid" style="--chartw:' + chartW + 'px">' +
      '<div class="grow head"><div class="glabel">' + esc(t("timeline.project")) + '</div><div class="gtrack axis">' + axisHtml + "</div></div>" +
      lanesHtml +
    "</div></div>";
  }

  function tickGantt() {
    if (S.view !== "timeline" || !TL.geom) return;
    const { from, span } = TL.geom;
    const now = Date.now();
    $$('.gbar[data-live="1"]').forEach((el) => {
      const st = Number(el.dataset.gstart) || now;
      const left = Math.max(0, ((st - from) / span) * 100);
      const width = Math.max(0.5, Math.min(100 - left, ((now - st) / span) * 100));
      el.style.width = width.toFixed(2) + "%";
    });
    const pct = Math.max(0, Math.min(100, ((now - from) / span) * 100)).toFixed(2);
    $$(".gnow").forEach((el) => { el.style.left = pct + "%"; });
    const lbl = $("#gNowLabel");
    if (lbl) lbl.style.left = pct + "%";
  }
  setInterval(tickGantt, 1000);

  let ganttWired = false;
  function wireGantt() {
    const wrap = $("#ganttWrap");
    if (!wrap || ganttWired) return;
    ganttWired = true;
    const tip = $("#gTip");
    wrap.addEventListener("mousemove", (e) => {
      const bar = e.target.closest(".gbar");
      if (!bar || !tip) { if (tip) tip.hidden = true; return; }
      const st = Number(bar.dataset.gstart) || 0;
      const en = Number(bar.dataset.gend) || 0;
      const ms = en ? Math.max(0, en - st) : Date.now() - st;
      tip.innerHTML = "<b>" + esc(bar.dataset.name) + "</b>" +
        "<span>" + esc(bar.dataset.model || "—") + " · " + esc(bar.dataset.status) + "</span>" +
        "<span>" + dur(ms) + " · " + kfmt(bar.dataset.tokens) + " " + esc(t("table.tokens").toLowerCase()) + "</span>";
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      let x = e.clientX + 14;
      let y = e.clientY + 14;
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
      tip.style.left = Math.max(8, x) + "px";
      tip.style.top = Math.max(8, y) + "px";
    });
    wrap.addEventListener("mouseleave", () => { if (tip) tip.hidden = true; });
    wrap.addEventListener("click", (e) => {
      const bar = e.target.closest(".gbar");
      if (bar && bar.dataset.id) {
        if (tip) tip.hidden = true;
        openDrawer(bar.dataset.id);
      }
    });
  }

  // ---------- plans ----------
  async function loadBatches(force) {
    try {
      const res = await fetch("/api/batches", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const list = await res.json();
      S.batches = Array.isArray(list) ? list : [];
      const running = S.batches.filter((b) => b.status === "running" || b.status === "paused").length;
      const badge = $("#badgePlans");
      if (badge) { badge.hidden = !running; badge.textContent = String(running); }
      if (!S.selectedBatch || !S.batches.some((b) => b.id === S.selectedBatch)) {
        S.selectedBatch = S.batches[0] ? S.batches[0].id : null;
      }
      if (S.view === "plans") renderPlans();
    } catch { /* keep previous */ }
  }

  function batchCounts(b) {
    const jobs = Array.isArray(b.jobs) ? b.jobs : [];
    let done = 0, failed = 0, running = 0;
    for (const j of jobs) {
      if (!j) continue;
      if (j.state === "done") done++;
      else if (j.state === "failed") failed++;
      else if (j.state === "running") running++;
    }
    return { total: jobs.length, done, failed, running };
  }

  function ringSvg(pct, size) {
    const r = size / 2 - 4;
    const circ = 2 * Math.PI * r;
    const dash = (Math.max(0, Math.min(100, pct)) / 100) * circ;
    return '<svg class="pring" viewBox="0 0 ' + size + " " + size + '" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="3.5"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--c-done)" stroke-width="3.5" stroke-linecap="round"' +
        ' stroke-dasharray="' + dash.toFixed(1) + " " + (circ - dash).toFixed(1) + '" transform="rotate(-90 ' + size / 2 + " " + size / 2 + ')"/>' +
    "</svg>";
  }

  function renderPlans() {
    const listEl = $("#plansList");
    if (!listEl) return;
    const list = S.batches || [];
    const countEl = $("#plansCount");
    if (countEl) countEl.textContent = list.length ? t("plans.count", { n: list.length }) : "";
    if (!list.length) {
      listEl.innerHTML = '<div class="empty">' + esc(t("plans.empty")) + "</div>";
      clearPlanDetail();
      return;
    }
    listEl.innerHTML = list.map((b) => {
      const c = batchCounts(b);
      const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
      const started = Number(b.startedAt) || 0;
      const ended = Number(b.endedAt) || 0;
      const paused = b.status === "paused";
      return '<button type="button" class="batch-row' + (b.id === S.selectedBatch ? " selected" : "") + '" data-batch="' + esc(b.id) + '">' +
        ringSvg(pct, 38) +
        '<span class="br-main"><b title="' + esc(b.name || b.id) + '">' + esc(b.name || b.id) + "</b>" +
          "<span>" + esc(baseName(b.dir) || "—") + " · " + (started ? hhmm(started) + " · " : "") +
          dur((ended || Date.now()) - started) + "</span></span>" +
        '<span class="br-side"><span class="pill ' + (paused ? "paused" : statusClass(b.status)) + '">' +
          esc(paused ? t("status.paused") : statusLabel(b.status)) + "</span>" +
          '<span class="br-prog">' + c.done + "/" + c.total + "</span></span>" +
      "</button>";
    }).join("");
    renderPlanDetail();
  }

  function clearPlanDetail() {
    const title = $("#planTitle");
    if (title) title.textContent = t("plans.detailTitle");
    const sub = $("#planSub");
    if (sub) sub.textContent = t("plans.selectHint");
    const bd = $("#planBadge");
    if (bd) bd.textContent = "";
    const acts = $("#planActions");
    if (acts) { acts.hidden = true; acts.innerHTML = ""; }
    const donut = $("#planDonut");
    if (donut) donut.innerHTML = '<div class="chart-empty">' + esc(t("common.noData")) + "</div>";
    const waves = $("#planWaves");
    if (waves) waves.innerHTML = '<div class="empty">' + esc(t("plans.noneSelected")) + "</div>";
    const bars = $("#planDurations");
    if (bars) bars.innerHTML = '<div class="chart-empty">' + esc(t("common.noData")) + "</div>";
  }

  function batchJobDuration(b, job) {
    const full = jobsById.get(job.jobId);
    if (full) return Math.max(0, elapsedOf(full) / 1000);
    return 0;
  }

  function renderPlanDetail() {
    const b = (S.batches || []).find((x) => x.id === S.selectedBatch);
    if (!b) { clearPlanDetail(); return; }
    const c = batchCounts(b);
    const title = $("#planTitle");
    if (title) title.textContent = b.name || b.id;
    const sub = $("#planSub");
    if (sub) sub.textContent = (b.dir || "—") + " · " + t("plans.started", { time: I18n.date(Number(b.startedAt) || Date.now()) });
    const bd = $("#planBadge");
    const paused = b.status === "paused";
    if (bd) bd.innerHTML = '<span class="pill ' + (paused ? "paused" : statusClass(b.status)) + '">' +
      esc(paused ? t("status.paused") : statusLabel(b.status)) + "</span>";

    const acts = $("#planActions");
    if (acts) {
      const canPause = b.status === "running" || b.status === "paused";
      if (!canPause) {
        acts.hidden = true;
        acts.innerHTML = "";
      } else {
        acts.hidden = false;
        const label = paused ? t("plans.resume") : t("plans.pause");
        const tip = paused ? t("plans.resumeTitle") : t("plans.pauseTitle");
        acts.innerHTML = '<button type="button" class="actbtn ' + (paused ? "resume" : "pause") + '" data-batch-act="' +
          (paused ? "resume" : "pause") + '" data-batch="' + esc(b.id) + '" title="' + esc(tip) + '">' +
          (paused ? "▶ " : "⏸ ") + esc(label) + "</button>";
      }
    }

    if (C.donutChart) {
      C.donutChart($("#planDonut"), {
        items: [
          { label: t("status.done"), value: c.done, color: "var(--c-done)" },
          { label: t("status.running"), value: c.running, color: "var(--c-running)" },
          { label: t("status.failed"), value: c.failed, color: "var(--c-failed)" },
          { label: t("status.pending"), value: Math.max(0, c.total - c.done - c.failed - c.running), color: "var(--c-other)" },
        ].filter((i) => i.value > 0),
      }, { height: 210, centerValue: c.done + "/" + c.total, centerLabel: t("plans.jobsDone") });
    }

    const wavesEl = $("#planWaves");
    if (wavesEl) {
      const waves = Array.isArray(b.waves) ? b.waves : [];
      const jobs = Array.isArray(b.jobs) ? b.jobs : [];
      wavesEl.innerHTML = waves.map((names, wi) => {
        const chips = (Array.isArray(names) ? names : []).map((name) => {
          const job = jobs.find((x) => x && x.name === name) || { name, kind: "", state: "pending" };
          const state = job.state || "pending";
          const cls = ["pending", "running", "done", "failed", "skipped"].includes(state) ? state : "pending";
          const model = job.model ? shortModel(job.model) : "auto";
          return '<button type="button" class="bchip st-' + cls + '"' +
            (job.jobId ? ' data-job="' + esc(job.jobId) + '"' : "") +
            ' data-name="' + esc(job.name) + '" data-after="' + esc((job.after || []).join(",")) + '"' +
            ' title="' + esc(job.name + " · " + (job.kind || "—") + " · " + model) + '">' +
            '<span class="bchip-top"><span class="bchip-name">' + esc(job.name) + "</span>" +
              (state === "running" ? '<i class="dot"></i>' : "") + "</span>" +
            '<span class="bchip-meta"><span class="kindpill">' + esc(job.kind || "—") + "</span>" +
              '<span class="bchip-model">' + esc(model) + "</span></span>" +
          "</button>";
        }).join("") || '<div class="hint">' + esc(t("plans.noJobs")) + "</div>";
        return '<div class="wave"><div class="wave-head">' + esc(t("plans.wave", { n: wi + 1 })) + "<span>" + esc(t("plans.waveJobs", { n: (names || []).length })) + "</span></div>" +
          '<div class="wave-jobs">' + chips + "</div></div>";
      }).join("") || '<div class="empty">' + esc(t("plans.noWaves")) + "</div>";
      $$(".bchip", wavesEl).forEach((chip) => {
        chip.addEventListener("click", () => { if (chip.dataset.job) openDrawer(chip.dataset.job); });
      });
    }

    if (C.barChart) {
      const jobs = (Array.isArray(b.jobs) ? b.jobs : []).filter(Boolean);
      const items = jobs.map((job) => {
        const seconds = batchJobDuration(b, job);
        const color = job.state === "done" ? "var(--c-done)"
          : job.state === "failed" ? "var(--c-failed)"
            : job.state === "running" ? "var(--c-running)" : "var(--c-other)";
        return {
          label: job.name,
          value: Math.round(seconds * 10) / 10,
          color,
          tip: "<b>" + esc(job.name) + "</b><span>" + esc(job.state ? statusLabel(job.state) : t("status.pending")) + " · " + dur(seconds * 1000) + "</span>",
        };
      });
      C.barChart($("#planDurations"), { items }, { height: Math.max(150, Math.min(260, 70 + items.length * 22)) });
    }
  }

  let plansWired = false;
  function wirePlans() {
    const listEl = $("#plansList");
    if (listEl && !plansWired) {
      listEl.addEventListener("click", (e) => {
        const row = e.target.closest("[data-batch]");
        if (!row) return;
        S.selectedBatch = row.dataset.batch;
        store("oc-batch", S.selectedBatch);
        renderPlans();
      });
    }
    const detail = $("#view-plans");
    if (detail && !detail._wired) {
      detail._wired = true;
      detail.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-batch-act]");
        if (!b) return;
        runBatchAction(b.dataset.batchAct, b.dataset.batch, b);
      });
    }
    plansWired = true;
  }

  // ---------- models ----------
  const MODEL_COLS = [
    { key: "model", labelKey: "table.model", num: false, get: (r) => r.short || r.id },
    { key: "fix", label: "fix", num: true, get: (r) => benchScore(r, "fix") },
    { key: "code", label: "code", num: true, get: (r) => benchScore(r, "code") },
    { key: "ui", label: "ui", num: true, get: (r) => benchScore(r, "ui") },
    { key: "rk-quick", label: "#quick", num: true, get: (r) => (r.ranks && r.ranks.quick) || null },
    { key: "rk-code", label: "#code", num: true, get: (r) => (r.ranks && r.ranks.code) || null },
    { key: "rk-ui", label: "#ui", num: true, get: (r) => (r.ranks && r.ranks.ui) || null },
    { key: "rk-hard", label: "#hard", num: true, get: (r) => (r.ranks && r.ranks.hard) || null },
    { key: "jobs", labelKey: "col.jobs", num: true, get: (r) => r.stats.jobs },
    { key: "success", labelKey: "col.success", num: true, get: (r) => r.stats.success },
    { key: "infra", labelKey: "col.infra", num: true, get: (r) => r.stats.infra },
    { key: "good", labelKey: "col.good", num: true, get: (r) => r.stats.good },
    { key: "bad", labelKey: "col.bad", num: true, get: (r) => r.stats.bad },
    { key: "avg", labelKey: "col.avg", num: true, get: (r) => r.stats.avgSecs },
    { key: "dead", labelKey: "col.status", num: true, get: (r) => (Number(r.stats.deadUntil) > Date.now() ? 1 : 0) },
  ];

  function benchScore(r, task) {
    const b = r.bench && r.bench[task];
    return b ? Number(b.score) || 0 : null;
  }

  async function loadModels(force) {
    if (!force && S.models && Date.now() - (S.models._at || 0) < 25000) return;
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      data._at = Date.now();
      S.models = data;
      if (S.view === "models") renderModels();
    } catch { /* keep previous */ }
  }

  function pctText(v) {
    if (v == null || Number.isNaN(Number(v))) return "—";
    return Math.round(Number(v) * 100) + "%";
  }

  function benchCell(r, task) {
    const b = r.bench && r.bench[task];
    if (!b) return '<span class="mut">—</span>';
    const pct = Math.max(0, Math.min(100, Math.round((Number(b.score) || 0) * 100)));
    const bits = [pct + "%"];
    if (b.seconds) bits.push(b.seconds + "s");
    if (b.tested) bits.push(String(b.tested));
    if (b.skipped) bits.push(t("models.skipped"));
    return '<div class="benchcell" title="' + esc(bits.join(" · ")) + '">' +
      '<span class="bpct">' + pct + '%</span><span class="minibar"><i style="width:' + pct + '%"></i></span></div>';
  }

  function rankCell(r, kind) {
    const n = r.ranks && r.ranks[kind];
    return n ? '<span class="rankbadge">#' + n + "</span>" : '<span class="mut">—</span>';
  }

  function successCell(v) {
    if (v == null) return '<span class="mut">—</span>';
    const pct = Math.max(0, Math.min(100, Math.round(Number(v) * 100)));
    return '<span class="bpct">' + pct + '%</span><span class="minibar" style="margin-top:3px"><i style="width:' + pct + '%"></i></span>';
  }

  function renderModels() {
    const data = S.models;
    if (!data) return;
    const upd = $("#modelsUpdated");
    if (upd) upd.textContent = data.updated ? t("models.updated", { date: String(data.updated).slice(0, 10) }) : "";
    renderKindCards(data);
    renderModelCharts(data);
    const head = $("#modelHead");
    const body = $("#modelBody");
    if (!head || !body) return;
    const rows = Array.isArray(data.models) ? data.models.slice() : [];
    const col = MODEL_COLS.find((c) => c.key === S.msort.key) || MODEL_COLS[0];
    rows.sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (col.num) {
        const na = va == null ? -Infinity : Number(va);
        const nb = vb == null ? -Infinity : Number(vb);
        return (na - nb) * S.msort.dir;
      }
      return String(va == null ? "" : va).localeCompare(String(vb == null ? "" : vb), I18n.locale) * S.msort.dir;
    });

    const colLabel = (c) => (c.labelKey ? t(c.labelKey) : c.label);
    head.innerHTML = "<tr>" + MODEL_COLS.map((c) => {
      const arrow = S.msort.key === c.key ? '<span class="arrow">' + (S.msort.dir > 0 ? "▲" : "▼") + "</span>" : "";
      return '<th class="' + (c.num ? "num" : "") + '" data-key="' + c.key + '" title="' + esc(t("models.sortBy", { label: colLabel(c) })) + '">' +
        esc(colLabel(c)) + arrow + "</th>";
    }).join("") + "</tr>";

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="15"><div class="empty">' + esc(t("models.empty")) + "</div></td></tr>";
      return;
    }

    body.innerHTML = rows.map((r) => {
      const st = r.stats || {};
      const dead = Number(st.deadUntil) > Date.now();
      return "<tr>" +
        '<td><div class="model-name" title="' + esc(r.id) + '">' + esc(r.short || r.id) + "</div>" +
          (r.note ? '<div class="model-note" title="' + esc(r.note) + '">' + esc(r.note) + "</div>" : "") + "</td>" +
        "<td>" + benchCell(r, "fix") + "</td>" +
        "<td>" + benchCell(r, "code") + "</td>" +
        "<td>" + benchCell(r, "ui") + "</td>" +
        "<td>" + rankCell(r, "quick") + "</td>" +
        "<td>" + rankCell(r, "code") + "</td>" +
        "<td>" + rankCell(r, "ui") + "</td>" +
        "<td>" + rankCell(r, "hard") + "</td>" +
        '<td class="num">' + (Number(st.jobs) || 0) + "</td>" +
        '<td class="num">' + successCell(st.success) + "</td>" +
        '<td class="num">' + (Number(st.infra) || 0) + "</td>" +
        '<td class="num good-t">' + (Number(st.good) || 0) + "</td>" +
        '<td class="num bad-t">' + (Number(st.bad) || 0) + "</td>" +
        '<td class="num mono">' + (st.avgSecs == null ? "—" : dur(st.avgSecs * 1000)) + "</td>" +
        "<td>" + (dead
          ? '<span class="pill stalled" title="' + esc(t("models.deadTitle", { time: I18n.date(Number(st.deadUntil)) })) + '">' + esc(t("models.dead")) + "</span>"
          : '<span class="mut">' + esc(t("models.ready")) + "</span>") + "</td>" +
      "</tr>";
    }).join("");
  }

  function renderKindCards(data) {
    const box = $("#kindCards");
    if (!box) return;
    const models = Array.isArray(data.models) ? data.models : [];
    box.innerHTML = KINDS.map((kind) => {
      const ranked = models
        .filter((m) => m.ranks && m.ranks[kind])
        .sort((a, b) => a.ranks[kind] - b.ranks[kind])
        .slice(0, 5);
      const max = Math.max(0.0001, ...ranked.map((m) => Number(m.ranks[kind]) ? 6 - m.ranks[kind] : 0));
      const rows = ranked.map((m) => {
        const weight = 6 - m.ranks[kind];
        const pct = Math.round((weight / max) * 100);
        const score = benchScore(m, kind === "quick" ? "fix" : kind);
        return '<div class="rk-row">' +
          '<span class="rk-name" title="' + esc(m.id) + '">' + esc(m.short || m.id) + "</span>" +
          '<span class="rk-track"><i style="width:' + pct + '%"></i></span>' +
          '<span class="rk-val">' + (score == null ? "—" : Math.round(score * 100) + "%") + "</span>" +
        "</div>";
      }).join("") || '<div class="hint">' + esc(t("models.notRanked")) + "</div>";
      return '<section class="card kind-card">' +
        '<header class="card-head"><div><h2>' + esc(kindLabel(kind)) + "</h2></div></header>" +
        '<div class="rk-list">' + rows + "</div>" +
      "</section>";
    }).join("");
  }

  function renderModelCharts(data) {
    const models = (Array.isArray(data.models) ? data.models : []).filter((m) => m.stats && Number(m.stats.jobs) > 0);
    if (C.scatterChart) {
      const points = models.filter((m) => m.stats.success != null && m.stats.avgSecs != null).map((m) => ({
        x: Math.round(Number(m.stats.success) * 100),
        y: Number(m.stats.avgSecs) || 0,
        jobs: Number(m.stats.jobs) || 1,
        label: m.short || m.id,
        sub: t("models.successSub", { pct: pctText(m.stats.success), dur: dur(Number(m.stats.avgSecs) * 1000), n: m.stats.jobs }),
        color: "var(--chart-2)",
      }));
      C.scatterChart($("#chartScatter"), { points }, { height: 280, xLabel: t("models.xLabel"), valueLabel: t("models.seconds") });
    }
    if (C.hBarChart) {
      const items = models.slice().sort((a, b) => Number(b.stats.jobs) - Number(a.stats.jobs)).slice(0, 9).map((m) => ({
        label: m.short || m.id,
        value: Number(m.stats.jobs) || 0,
        tip: "<b>" + esc(m.short || m.id) + "</b><span>" + esc(t("timeline.jobs", { n: Number(m.stats.jobs) || 0 })) + "</span>",
      }));
      C.hBarChart($("#chartJobsByModel"), { items }, { height: 280, label: t("card.jobsByModel") });
    }
  }

  let modelHeadWired = false;
  function wireModelHead() {
    const head = $("#modelHead");
    if (!head || modelHeadWired) return;
    modelHeadWired = true;
    head.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-key]");
      if (!th) return;
      const key = th.dataset.key;
      if (S.msort.key === key) S.msort.dir *= -1;
      else S.msort = { key, dir: 1 };
      renderModels();
    });
  }

  // ---------- processes ----------
   function renderProcessMachine() {
     const el = $("#procMachine");
     if (!el) return;
     const h = S.health || {};
     const cores = h.cores;
     const cpuBusy = typeof h.cpuBusy === "number" ? h.cpuBusy : 0;
     const memFree = h.memFreeMb;
     const memTotal = h.memTotalMb;
     const st = S.state;
     const running = st && st.today ? (st.today.running || 0)
       : (st && Array.isArray(st.jobs) ? st.jobs.filter((j) => j.status === "running").length : 0);
     const limit = (h.maxParallel || (st && st.maxParallel) || 3);
     const ramFreeGb = memFree != null ? (memFree / 1024) : null;
     const ramTotalGb = memTotal != null ? (memTotal / 1024) : null;
     const cpuPct = Math.round(cpuBusy * 100);
     const ramPct = (ramFreeGb != null && ramTotalGb) ? Math.max(0, Math.min(100, (ramFreeGb / ramTotalGb) * 100)) : 0;
     const jobPct = limit ? Math.max(0, Math.min(100, (running / limit) * 100)) : 0;
     const rows = [
       { label: t("machine.cpuBusy"), value: cpuPct + "%", pct: cpuPct },
       { label: t("machine.ram"), value: (ramFreeGb != null && ramTotalGb != null ? ramFreeGb.toFixed(1) + " / " + ramTotalGb.toFixed(1) + " GB" : "—"), pct: ramPct },
       { label: t("machine.jobs"), value: running + " / " + limit, pct: jobPct },
     ];
     el.innerHTML = '<div class="pm-title">' + esc(t("settings.machine")) + "</div>" +
       rows.map((r) => (
         '<div class="pm-row">' +
           '<div class="pm-top"><span class="pm-label">' + esc(r.label) + '</span><span class="pm-val">' + esc(r.value) + '</span></div>' +
           '<div class="pm-bar"><div class="pm-fill" style="width:' + r.pct + '%"></div></div>' +
         '</div>'
       )).join("");
   }
   function renderProcesses() {
    const body = $("#procBody");
    if (!body) return;
    const ps = (S.state && S.state.processes) || [];
    const countEl = $("#procCount");
    if (countEl) countEl.textContent = ps.length ? t("proc.count", { n: ps.length }) : "";
    const orphans = ps.filter((p) => p.orphan);
    const hint = $("#orphanHint");
    if (hint) {
      if (orphans.length) {
        hint.hidden = false;
        hint.innerHTML = '<span class="orphan-pill">' + esc(t("proc.orphanPill")) + "</span>" +
          "<span>" + esc(t("proc.orphan", { n: orphans.length })) + "</span>";
      } else {
        hint.hidden = true;
        hint.innerHTML = "";
      }
    }
    if (C.donutChart) {
      const byType = new Map();
      for (const p of ps) {
        const type = p.type || "node";
        byType.set(type, (byType.get(type) || 0) + 1);
      }
      const items = [...byType.entries()].map(([type, n]) => ({
        label: type,
        value: n,
      }));
       C.donutChart($("#chartProcTypes"), { items }, { height: 260, centerValue: String(ps.length), centerLabel: t("proc.processes") });
     }
     renderProcessMachine();
    if (!ps.length) {
      body.innerHTML = '<div class="empty">' + esc(t("proc.empty")) + "</div>";
      return;
    }
    const groups = new Map();
    for (const p of ps) {
      const type = p.type || "node";
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(p);
    }
    let html = "";
    for (const [type, list] of groups) {
      const label = (list[0] && list[0].label) || type;
      html += '<div class="pgroup">' +
        '<div class="pgroup-head">' +
          '<span class="ppill t-' + String(type).replace(/\s+/g, "-") + '">' + esc(label) + "</span>" +
          '<span class="pcount">' + esc(t("proc.count", { n: list.length })) + "</span>" +
        "</div>" +
        '<div class="ptable-wrap"><table class="ptable"><thead><tr>' +
          '<th>' + esc(t("proc.table.type")) + '</th><th>' + esc(t("proc.table.pid")) + '</th><th class="ppid-col">' + esc(t("proc.table.ppid")) + '</th><th>' + esc(t("proc.table.time")) + '</th><th>' + esc(t("proc.table.cmd")) + '</th>' +
        "</tr></thead><tbody>";
      for (const p of list) {
        const typeText = p.type === "powershell"
          ? esc(p.label) + " · " + esc(t("proc.children", { n: p.children || 0 }))
          : p.type === "oc controller"
            ? "oc " + esc(p.mode || "controller")
            : esc(p.label || p.type || "node");
        html += '<tr class="' + (p.jobId ? "clickable" : "") + '"' + (p.jobId ? ' data-job="' + esc(p.jobId) + '"' : "") + ">" +
          '<td><span class="proctype">' + typeText + (p.orphan ? ' <span class="orphan-pill">' + esc(t("proc.orphanPill")) + "</span>" : "") + "</span></td>" +
          '<td class="mono">' + p.pid + "</td>" +
          '<td class="mono ppid-col">' + (p.ppid || "—") + "</td>" +
          '<td class="mono" data-start="' + (Number(p.startedAt) || 0) + '" data-end="0">' +
            (p.startedAt ? dur(Date.now() - p.startedAt) : "—") + "</td>" +
          '<td class="cmd mono" title="' + esc(p.cmd || "") + '">' + esc(p.cmdShort || "—") + "</td>" +
        "</tr>";
      }
      html += "</tbody></table></div></div>";
    }
    body.innerHTML = html;
    $$("tr[data-job]", body).forEach((tr) => {
      tr.addEventListener("click", () => openDrawer(tr.dataset.job));
    });
    updateElapsed();
  }

  // ---------- settings ----------
  function setSwitch(sel, on, labelOn, labelOff) {
    const el = $(sel);
    if (!el) return;
    el.classList.toggle("on", !!on);
    el.setAttribute("aria-checked", on ? "true" : "false");
    const sp = el.querySelector("span");
    if (sp) sp.textContent = on ? (labelOn || t("common.on")) : (labelOff || t("common.off"));
  }

  function syncSettings() {
    setSwitch("#setNotify", S.notify);
    setSwitch("#setSound", S.sound);
    setSwitch("#setSidebar", S.collapsed);
    setSwitch("#setToast", S.toastOnDone, t("common.on"), t("common.off"));
    setSwitch("#setReducedMotion", S.reducedMotion, t("common.on"), t("common.off"));
    // theme now toggle switch
    $$("#setInterval button").forEach((b) => b.classList.toggle("active", Number(b.dataset.interval) === S.interval));
    $$("#setRange button").forEach((b) => b.classList.toggle("active", b.dataset.range === S.range));
    $$("#setLang button").forEach((b) => b.classList.toggle("active", b.dataset.lang === (window.I18n && window.I18n.lang)));
    $$("#setDensity button").forEach((b) => b.classList.toggle("active", b.dataset.density === S.density));
    const st = $("#setTheme");
    if (st) { const on = S.theme === "dark"; st.classList.toggle("on", on); st.setAttribute("aria-checked", on ? "true" : "false"); }
    const pt = $("#popTheme");
    if (pt) { const on = S.theme === "dark"; pt.classList.toggle("on", on); pt.setAttribute("aria-checked", on ? "true" : "false"); }
  }

  async function refreshSettingsView() {
    try {
       const h = S.health || {};
       const cpu = $("#machineCpu");
       if (cpu) cpu.textContent = (h.cores != null ? h.cores : (navigator.hardwareConcurrency != null ? navigator.hardwareConcurrency : "—"));
       const ram = $("#machineRam");
       if (ram) {
         if (h.memFreeMb != null && h.memTotalMb) {
           ram.textContent = (h.memFreeMb / 1024).toFixed(1) + " / " + (h.memTotalMb / 1024).toFixed(1) + " GB";
         } else {
           ram.textContent = navigator.deviceMemory != null ? ("≈ " + navigator.deviceMemory + " GB") : t("machine.unavailable");
         }
       }
       const jobs = $("#machineJobs");
       const st = S.state;
       if (jobs) {
         const running = st && st.today ? (st.today.running || 0)
           : (st && Array.isArray(st.jobs) ? st.jobs.filter((j) => j.status === "running").length : 0);
         const limit = (h.maxParallel || (st && st.maxParallel) || 3);
         jobs.textContent = running + " / " + limit;
       }
      const port = $("#settingsPort");
      if (port) port.textContent = "4790";

      let models = S.models;
      if (!models) {
        try {
          const res = await fetch("/api/models", { cache: "no-store" });
          if (res.ok) { models = await res.json(); S.models = models; }
        } catch { models = null; }
      }
      const avail = new Set((models && Array.isArray(models.models) ? models.models : []).map((m) => String(m.id).split("/")[0]));
      const runners = ["opencode", "ollama", "claude", "codex", "antigravity"];
      const box = $("#settingsAgents");
      if (box) {
        box.innerHTML = runners.map((r) => {
          const on = avail.has(r);
          return '<div class="agent-row">' +
            '<span class="agent-dot' + (on ? " on" : "") + '" aria-hidden="true"></span>' +
            '<span class="agent-name">' + esc(r) + '</span>' +
            '<span class="agent-meta">' + esc(on ? t("common.on") : t("common.off")) + '</span>' +
            '</div>';
        }).join("");
      }
    } catch { /* visual-only, never throw */ }
  }

  // ---------- drawer ----------
  function metaCell(label, value, mono) {
    return '<div class="mcell"><span class="mlabel">' + esc(label) + "</span>" +
      '<span class="mval' + (mono ? " mono" : "") + '">' + esc(value || "—") + "</span></div>";
  }

  function absPath(dir, rel) {
    const s = String(rel || "").replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(s) || s.startsWith("/")) return s;
    const d = String(dir || "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!d) return s;
    return d + "/" + s.replace(/^\.?\//, "");
  }

  function vscodeHref(abs) {
    return "vscode://file/" + encodeURI(abs).replace(/#/g, "%23").replace(/\?/g, "%3F");
  }

  function fileListHtml(files, dir, scope) {
    if (!files.length) return '<div class="hint">' + esc(scope ? t("files.noScope") : t("files.none")) + "</div>";
    return '<ul class="filelist' + (scope ? " scope" : "") + '">' + files.map((f) => {
      const abs = absPath(dir, f);
      return "<li><span class=\"fpath\" title=\"" + esc(abs) + "\">" + esc(f) + "</span>" +
        '<a class="vsclink" href="' + esc(vscodeHref(abs)) + '" title="' + esc(t("files.open") + " " + abs) + '">' + esc(t("files.open")) + "</a></li>";
    }).join("") + "</ul>";
  }

  function renderDrawer() {
    const id = S.drawer.id;
    if (!id) return;
    const j = S.drawer.job || jobsById.get(id);
    if (!j) return;

    const title = $("#dTitle");
    if (title) title.textContent = j.title || j.name || j.id;
    const st = $("#dStatus");
    if (st) {
      const paused = j.paused && j.status === "running";
      st.innerHTML = '<span class="pill ' + (paused ? "paused" : statusClass(j.status)) + '">' +
        (j.status === "running" ? '<i class="dot"></i>' : "") + esc(paused ? t("status.paused") : statusLabel(j.status)) + "</span>" +
        '<span class="jid">' + esc(j.id) + "</span>" +
        (j.batch ? '<span class="kindpill">'+esc(t("job.batch",{n:j.batchJob || j.batch}))+ "</span>" : "");
    }

    const stopBtn = $("#dStop");
    if (stopBtn) stopBtn.hidden = j.status !== "running";
    const pauseBtn = $("#dPause");
    if (pauseBtn) {
      const show = j.status === "running";
      pauseBtn.hidden = !show;
      if (show) {
        const lbl = pauseBtn.querySelector("span");
        if (lbl) lbl.textContent = j.paused ? t("job.resume") : t("job.pause");
        pauseBtn.classList.toggle("resume", !!j.paused);
        pauseBtn.dataset.act = j.paused ? "resume" : "pause";
        pauseBtn.dataset.id = j.id;
        pauseBtn.title = j.paused ? t("job.resumeTitle") : t("job.pauseTitle");
      }
    }

    const rateNow = $("#dRateNow");
    if (rateNow) {
      rateNow.textContent = j.rating === "good"
        ? t("rate.nowGood")
        : j.rating === "bad"
          ? t("rate.nowBad")
          : t("rate.nowNone");
    }
    const note = $("#dNote");
    if (note && !S.drawerNoteDirty && document.activeElement !== note) {
      note.value = j.ratingNote || "";
    }

    const tab = S.drawer.tab || "log";
    $$("#dTabs button").forEach((b) => b.classList.toggle("active", b.dataset.dtab === tab));
    $$(".dpanel").forEach((p) => { p.hidden = p.dataset.dpanel !== tab; });

    const elapsed = dur(elapsedOf(j));
    const meta = $("#dMeta");
    if (meta) {
      meta.innerHTML =
        metaCell(t("meta.model"), j.model || "—", true) +
        metaCell(t("meta.kind"), j.kind ? kindLabel(j.kind) : "—") +
        metaCell(t("meta.dir"), j.dir) +
        metaCell(t("meta.time"), elapsed + (j.status === "running" ? (j.paused ? " (" + t("meta.paused") + ")" : " (" + t("meta.running") + ")") : "")) +
        metaCell(t("meta.start"), j.startedAt ? I18n.date(j.startedAt) : "—") +
        metaCell(t("meta.scope"), j.scope && j.scope.length ? j.scope.join(", ") : t("meta.wholeFolder"), true) +
        metaCell(t("meta.steps"), String(j.steps || 0)) +
        metaCell(t("meta.tokens"), kfmt(j.tokens || 0)) +
        metaCell(t("meta.files"), String((j.filesTouched && j.filesTouched.length) || 0)) +
        metaCell(t("meta.rating"), j.rating === "good" ? t("meta.ratedGood") : j.rating === "bad" ? t("meta.ratedBad") : t("meta.notRated"));
    }

    const attempts = $("#dAttempts");
    if (attempts) {
      const list = (j.attempts && j.attempts.length) ? j.attempts : null;
      if (list) {
        attempts.innerHTML = "<h3>" + esc(t("attempts.title")) + "</h3>" +
          '<div class="chain">' + list.map((a, i) =>
            '<span class="chain-item ' + statusClass(a.status) + '">' +
              (i > 0 ? '<i class="arrow">→</i>' : "") +
              "<b>" + esc(shortModel(a.model)) + "</b><span>" + esc(statusLabel(a.status)) + "</span>" +
            "</span>"
          ).join("") + "</div>" +
          (j.attempt > 1 ? '<div class="hint">' + esc(t("attempts.hint", { n: j.attempt, model: shortModel(j.model) })) + "</div>" : "");
      } else if (j.chain && j.chain.length > 1) {
        attempts.innerHTML = "<h3>" + esc(t("attempts.chain")) + "</h3>" +
          '<div class="chain">' + j.chain.map((m, i) =>
            '<span class="chain-item">' + (i > 0 ? '<i class="arrow">→</i>' : "") + "<b>" + esc(shortModel(m)) + "</b></span>"
          ).join("") + "</div>" +
          '<div class="hint">' + esc(t("attempts.chainHint")) + "</div>";
      } else {
        attempts.innerHTML = "<h3>" + esc(t("attempts.chain")) + "</h3>" +
          '<div class="hint">' + esc(t("attempts.none", { model: shortModel(j.model) || "—" })) + "</div>";
      }
    }

    const hints = $("#dHints");
    if (hints) {
      const parts = [];
      if (j.paused) {
        parts.push('<div class="hintbox warn">' + esc(t("hints.paused")) + "</div>");
      }
      if (j.status === "blocked") {
        parts.push('<div class="hintbox warn">' + esc(t("hints.blocked")) + "</div>");
      }
      if (j.denied) {
        parts.push('<div class="hintbox warn">' + esc(t("hints.denied", { n: Number(j.denied) || 0 })) + "</div>");
      }
      if (j.outOfScope && j.outOfScope.length) {
        parts.push('<div class="hintbox bad">' + esc(t("hints.scope", { n: j.outOfScope.length })) + "</div>");
      }
      hints.innerHTML = parts.join("");
    }

    const files = $("#dFiles");
    if (files) {
      const touched = j.filesTouched || [];
      files.innerHTML = "<h3>" + esc(t("files.title", { n: touched.length })) + "</h3>" +
        (j.dir ? '<div class="dirlink">' + esc(t("files.dir")) + ' <span class="mono" title="' + esc(j.dir) + '">' + esc(j.dir) + "</span>" +
          '<a class="vsclink" href="' + esc(vscodeHref(absPath("", j.dir))) + '" title="' + esc(t("files.openDir")) + '">' + esc(t("files.openDir")) + "</a></div>" : "") +
        fileListHtml(touched, j.dir, false);
    }

    const scope = $("#dScope");
    if (scope) {
      const oos = j.outOfScope || [];
      scope.innerHTML = "<h3>" + esc(t("files.scopeTitle", { n: oos.length })) + "</h3>" + fileListHtml(oos, j.dir, true);
    }

    const err = $("#dError");
    if (err) {
      if (j.error) err.innerHTML = '<h3>' + esc(t("error.title")) + '</h3><div class="errbox">' + esc(j.error) + "</div>";
      else err.innerHTML = "";
    }

    const final = $("#dFinal");
    if (final) {
      const last = String(j.lastText || "").trim();
      final.innerHTML = "<h3>" + esc(t("final.title")) + "</h3>" +
        (last ? '<div class="final">' + esc(last) + "</div>" : '<div class="hint">' + esc(t("final.none")) + "</div>");
    }

    if (tab === "brief") ensureBrief();
  }

  // ---------- drawer log ----------
  let logState = { id: null, text: "" };
  let autoScroll = true;

  function logClass(line) {
    if (/!!|^\S+\s+(ERROR|WARN|RETRY)\b/.test(line)) return "lg-err";
    const m = /^\d{2}:\d{2}:\d{2}\s+(\S+)/.exec(line);
    const tag = m ? m[1] : "";
    if (/^(write|edit|multiedit|patch|apply_patch)$/.test(tag)) return "lg-edit";
    if (tag === "bash") return "lg-bash";
    if (tag === "say") return "lg-say";
    if (tag === "START" || tag === "END" || tag === "PAUSE") return "lg-head";
    return "lg-dim";
  }

  function paintLog(text, stick) {
    const box = $("#logBox");
    if (!box) return;
    const prev = box.scrollTop;
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const frag = document.createDocumentFragment();
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      count++;
      const div = document.createElement("div");
      div.className = "lg " + logClass(line);
      div.textContent = line;
      frag.appendChild(div);
    }
    if (!count) {
      const div = document.createElement("div");
      div.className = "lg lg-dim";
      div.textContent = t("drawer.noLog");
      frag.appendChild(div);
    }
    box.innerHTML = "";
    box.appendChild(frag);
    const lc = $("#logCount");
    if (lc) lc.textContent = count ? t("drawer.lines", { n: count }) : "";
    box.scrollTop = stick ? box.scrollHeight : prev;
  }

  async function refreshLog() {
    const id = S.drawer.id;
    if (!id || S.drawer.tab !== "log") return;
    try {
      const res = await fetch("/api/log/" + encodeURIComponent(id) + "?lines=300", { cache: "no-store" });
      if (S.drawer.id !== id) return;
      if (!res.ok) {
        if (logState.id !== id) { logState = { id, text: "" }; paintLog("", false); }
        return;
      }
      const text = await res.text();
      if (S.drawer.id !== id) return;
      if (logState.id === id && logState.text === text) return;
      const stick = logState.id !== id ? true : autoScroll;
      logState = { id, text };
      paintLog(text, stick);
    } catch { /* ignore */ }
  }

  async function ensureBrief() {
    const id = S.drawer.id;
    const box = $("#briefBox");
    if (!id || !box) return;
    if (S.drawer.briefId === id) {
      box.textContent = S.drawer.brief || t("drawer.empty");
      return;
    }
    box.textContent = t("drawer.loadingBrief");
    try {
      const res = await fetch("/api/job/" + encodeURIComponent(id) + "/brief", { cache: "no-store" });
      if (S.drawer.id !== id) return;
      const text = res.ok ? await res.text() : t("drawer.noBrief");
      S.drawer.briefId = id;
      S.drawer.brief = text;
      box.textContent = text;
    } catch {
      box.textContent = t("drawer.briefError");
    }
  }

  // ---------- drawer open/close ----------
  let drawerTimer = null;

  function stopDrawerPoll() {
    if (drawerTimer) { clearInterval(drawerTimer); drawerTimer = null; }
  }
  function startDrawerPoll() {
    stopDrawerPoll();
    drawerTimer = setInterval(() => {
      if (document.hidden || !S.drawer.id) return;
      refreshDrawer();
    }, 2000);
  }

  async function refreshDrawer() {
    const id = S.drawer.id;
    if (!id) return;
    try {
      const res = await fetch("/api/job/" + encodeURIComponent(id), { cache: "no-store" });
      if (res.ok) {
        const job = await res.json();
        if (S.drawer.id !== id) return;
        S.drawer.job = Object.assign({}, S.drawer.job, job);
        renderDrawer();
      }
    } catch { /* ignore */ }
    await refreshLog();
    const j = S.drawer.job;
    if (j && j.status !== "running" && j.status !== "lost") stopDrawerPoll();
  }

  async function openDrawer(id) {
    if (!id) return;
    S.drawer = { id, tab: "log", job: jobsById.get(id) || null, brief: null, briefId: null };
    S.drawerNoteDirty = false;
    autoScroll = true;
    logState = { id: null, text: "" };
    const box = $("#logBox");
    if (box) box.innerHTML = "";
    const lc = $("#logCount");
    if (lc) lc.textContent = "";
    const note = $("#dNote");
    if (note) note.value = "";
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#drawerOverlay").classList.add("show");
    document.body.classList.add("drawer-open");
    renderDrawer();
    await refreshDrawer();
    if (S.drawer.id === id) startDrawerPoll();
    const close = $("#dClose");
    if (close) close.focus();
  }

  function closeDrawer() {
    S.drawer.id = null;
    stopDrawerPoll();
    const dr = $("#drawer");
    if (dr) { dr.classList.remove("open"); dr.setAttribute("aria-hidden", "true"); }
    const ov = $("#drawerOverlay");
    if (ov) ov.classList.remove("show");
    document.body.classList.remove("drawer-open");
  }

  // ---------- actions ----------
  async function postAction(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OC-Action": "1" },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !data || data.ok === false) {
      throw new Error((data && (data.message || data.error)) || "HTTP " + res.status);
    }
    return data;
  }

  function busy(btn, on) {
    if (!btn) return;
    if (on) {
      btn.dataset.wasDisabled = btn.disabled ? "1" : "";
      btn.disabled = true;
      btn.classList.add("busy");
    } else {
      btn.disabled = btn.dataset.wasDisabled === "1";
      btn.classList.remove("busy");
    }
  }

  async function runJobAction(act, id, btn) {
    if (!id || !act) return;
    busy(btn, true);
    try {
      if (act === "stop") {
        const j = jobsById.get(id) || S.drawer.job;
        const ok = window.confirm(t("confirm.stop", { name: ((j && (j.name || j.id)) || id) }));
        if (!ok) { busy(btn, false); return; }
      }
      const r = await postAction("/api/job/" + encodeURIComponent(id) + "/" + act);
      toast(r.message || t("toast.jobUpdated"), "ok");
      if (S.drawer.id === id) {
        if (act === "pause") S.drawer.job = Object.assign({}, S.drawer.job, { paused: true, pausedAt: Date.now() });
        else if (act === "resume") S.drawer.job = Object.assign({}, S.drawer.job, { paused: false, pausedAt: null });
        else if (act === "stop") S.drawer.job = Object.assign({}, S.drawer.job, { status: "stopped", endedAt: Date.now() });
        renderDrawer();
      }
      await poll();
    } catch (e) {
      toast(t("toast.actionFailed", { msg: e.message }), "bad");
    } finally {
      busy(btn, false);
    }
  }

  async function runBatchAction(act, id, btn) {
    if (!id || !act) return;
    busy(btn, true);
    try {
      const r = await postAction("/api/batch/" + encodeURIComponent(id) + "/" + act);
      toast(r.message || t("toast.planUpdated"), "ok");
      await loadBatches(true);
    } catch (e) {
      toast(t("toast.actionFailed", { msg: e.message }), "bad");
    } finally {
      busy(btn, false);
    }
  }

  async function rateCurrent(verdict) {
    const j = S.drawer.job;
    if (!j || !j.id) return;
    const noteEl = $("#dNote");
    const note = noteEl ? noteEl.value.trim() : "";
    try {
      const r = await postAction("/api/job/" + encodeURIComponent(j.id) + "/rate", { verdict, note });
      toast(r.message || t("rate.saved"), "ok");
      S.drawer.job = Object.assign({}, j, { rating: verdict, ratingNote: note });
      S.drawerNoteDirty = false;
      renderDrawer();
      poll();
    } catch (e) {
      toast(t("rate.failed", { msg: e.message }), "bad");
    }
  }

  async function copyJobId() {
    const id = S.drawer.id;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      toast(t("job.copied"), "ok");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = id;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast(t("job.copied"), "ok"); }
      catch { toast(t("job.copyFailed"), "bad"); }
      ta.remove();
    }
  }

  // ---------- global search ----------
  let searchWired = false;
  function syncSearchResults() {
    const input = $("#globalSearch");
    const box = $("#searchResults");
    if (!input || !box) return;
    const q = String(input.value || "").trim().toLowerCase();
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    const jobs = ((S.state && S.state.jobs) || []).filter((j) => {
      const hay = [j.name, j.id, j.title, j.model].map((v) => String(v || "").toLowerCase()).join(" ");
      return hay.includes(q);
    }).slice(0, 8);
    if (!jobs.length) {
      box.hidden = false;
      box.innerHTML = '<div class="sr-empty">'+esc(t("search.empty"))+"</div>";
      return;
    }
    box.hidden = false;
    box.innerHTML = jobs.map((j) => '<button type="button" class="sr-item" data-job="' + esc(j.id) + '">' +
      '<span class="pill ' + statusClass(j.status) + '">' + esc(statusLabel(j.status)) + "</span>" +
      '<span class="sr-main"><b>' + esc(j.name || j.id) + "</b><span>" + esc(shortModel(j.model) || "—") + " · " + esc(baseName(j.dir)) + "</span></span>" +
      '<span class="sr-id mono">' + esc(j.id) + "</span>" +
    "</button>").join("");
    $$(".sr-item", box).forEach((el) => {
      el.addEventListener("click", () => {
        openDrawer(el.dataset.job);
        box.hidden = true;
        input.value = "";
      });
    });
  }

  function wireSearch() {
    const input = $("#globalSearch");
    const box = $("#searchResults");
    if (!input || !box || searchWired) return;
    searchWired = true;
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(syncSearchResults, 110);
    });
    input.addEventListener("focus", syncSearchResults);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { box.hidden = true; input.blur(); }
      if (e.key === "Enter") {
        const first = $(".sr-item", box);
        if (first) { first.click(); }
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#searchBox")) box.hidden = true;
    });
  }

  // ---------- macOS window ----------
  function wireWindow() {
    const close = $("#tlClose"), min = $("#tlMin"), max = $("#tlMax");
    if (close) close.addEventListener("click", () => {
      try { window.close(); } catch { /* ignore */ }
      setTimeout(() => {
        if (!window.closed) toast(t("toast.closeWindow"), "bad");
      }, 260);
    });
    if (min) min.addEventListener("click", () => {
      const next = !S.compact;
      S.compact = next;
      if (next) S.collapsed = true;
      store("oc-compact", S.compact);
      store("oc-side-collapsed", S.collapsed);
      applyChrome();
      toast(next ? t("toast.compactOn") : t("toast.compactOff"));
    });
    if (max) max.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) {
          if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
          else toast(t("toast.fsUnsupported"), "bad");
        } else if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch { toast(t("toast.fsFailed"), "bad"); }
    });
  }

  // ---------- wiring ----------
  function wireStatic() {
    const nav = $("#sideNav");
    if (nav) {
      nav.addEventListener("click", (e) => {
        const a = e.target.closest(".navitem");
        if (!a) return;
        e.preventDefault();
        go(a.dataset.view);
      });
    }

    const collapseBtn = $("#collapseBtn");
    if (collapseBtn) collapseBtn.addEventListener("click", () => setCollapsed(!S.collapsed));

    const menuBtn = $("#menuBtn");
    if (menuBtn) menuBtn.addEventListener("click", () => toggleSidebarMobile());
    const scrim = $("#sidebarScrim");
    if (scrim) scrim.addEventListener("click", () => toggleSidebarMobile(false));

    // user card popover
    function closeUserPopover() {
      const pop = $("#userPopover");
      if (pop) pop.hidden = true;
      const uc = $("#userCard");
      if (uc) uc.setAttribute("aria-expanded", "false");
    }
    function toggleUserPopover() {
      const pop = $("#userPopover");
      if (!pop) return;
      pop.hidden = !pop.hidden;
      const uc = $("#userCard");
      if (uc) uc.setAttribute("aria-expanded", pop.hidden ? "false" : "true");
    }
    function openAbout() {
      const bd = $("#aboutBackdrop");
      if (bd) bd.hidden = false;
      const av = $("#aboutVersion");
      if (av) av.textContent = "opencode " + (S.version || "—");
    }
    function closeAbout() {
      const bd = $("#aboutBackdrop");
      if (bd) bd.hidden = true;
    }

    const userCard = $("#userCard");
    if (userCard) {
      userCard.addEventListener("click", (e) => { e.stopPropagation(); toggleUserPopover(); });
      userCard.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleUserPopover(); }
      });
    }
    const upopSettings = $("#upopSettings");
    if (upopSettings) upopSettings.addEventListener("click", (e) => { e.stopPropagation(); closeUserPopover(); go("settings"); });
    const upopAbout = $("#upopAbout");
    if (upopAbout) upopAbout.addEventListener("click", (e) => { e.stopPropagation(); closeUserPopover(); openAbout(); });

    const aboutClose = $("#aboutClose");
    if (aboutClose) aboutClose.addEventListener("click", closeAbout);
    const aboutBackdrop = $("#aboutBackdrop");
    if (aboutBackdrop) aboutBackdrop.addEventListener("click", (e) => { if (e.target === aboutBackdrop) closeAbout(); });

    // theme switches
    const toggleTheme = () => {
      const next = S.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      store("oc-theme", next);
    };
    ["#setTheme", "#popTheme"].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener("click", (e) => { e.stopPropagation(); toggleTheme(); });
    });

    // language segmented control in settings
    const setLangEl = $("#setLang");
    if (setLangEl) setLangEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-lang]");
      if (!b) return;
      if (window.I18n && typeof window.I18n.setLang === "function") window.I18n.setLang(b.dataset.lang);
    });

    // outside click closes popover
    document.addEventListener("click", (e) => {
      const pop = $("#userPopover");
      const uc = $("#userCard");
      if (pop && !pop.hidden) {
        if (!pop.contains(e.target) && !(uc && uc.contains(e.target))) closeUserPopover();
      }
    });
    // Esc closes popover
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const pop = $("#userPopover");
      if (pop && !pop.hidden) { closeUserPopover(); e.preventDefault(); }
    });

    const rangeSeg = $("#rangeSeg");
    if (rangeSeg) {
      rangeSeg.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-range]");
        if (!b) return;
        setRange(b.dataset.range);
      });
    }

    const fStatus = $("#fStatus");
    if (fStatus) fStatus.addEventListener("click", (e) => {
      const b = e.target.closest(".chipbtn");
      if (!b) return;
      S.filters.status = b.dataset.value || "";
      S.page = 1;
      saveFilters();
      renderJobs();
    });
    const fKind = $("#fKind");
    if (fKind) fKind.addEventListener("click", (e) => {
      const b = e.target.closest(".chipbtn");
      if (!b) return;
      S.filters.kind = b.dataset.value || "";
      S.page = 1;
      saveFilters();
      renderJobs();
    });
    const fProject = $("#fProject");
    if (fProject) fProject.addEventListener("change", (e) => {
      S.filters.project = e.target.value || "";
      S.page = 1;
      saveFilters();
      renderJobs();
    });
    const fModel = $("#fModel");
    if (fModel) fModel.addEventListener("change", (e) => {
      S.filters.model = e.target.value || "";
      S.page = 1;
      saveFilters();
      renderJobs();
    });
    let searchTimer = null;
    const fSearch = $("#fSearch");
    if (fSearch) fSearch.addEventListener("input", (e) => {
      S.filters.q = e.target.value || "";
      S.page = 1;
      saveFilters();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderJobs, 140);
    });

    const jobsHead = $("#jobsTable thead");
    if (jobsHead) jobsHead.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const key = th.dataset.sort;
      if (S.sort.key === key) S.sort.dir *= -1;
      else S.sort = { key, dir: key === "startedAt" ? -1 : 1 };
      store("oc-jsort", S.sort);
      renderJobs();
    });

    const dClose = $("#dClose");
    if (dClose) dClose.addEventListener("click", closeDrawer);
    const ov = $("#drawerOverlay");
    if (ov) ov.addEventListener("click", closeDrawer);
    const dStop = $("#dStop");
    if (dStop) dStop.addEventListener("click", () => runJobAction("stop", S.drawer.id, dStop));
    const dPause = $("#dPause");
    if (dPause) dPause.addEventListener("click", () => runJobAction(dPause.dataset.act || "pause", S.drawer.id, dPause));
    const dGood = $("#dGood");
    if (dGood) dGood.addEventListener("click", () => rateCurrent("good"));
    const dBad = $("#dBad");
    if (dBad) dBad.addEventListener("click", () => rateCurrent("bad"));
    const dCopy = $("#dCopy");
    if (dCopy) dCopy.addEventListener("click", copyJobId);

    const dTabs = $("#dTabs");
    if (dTabs) dTabs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-dtab]");
      if (!b) return;
      S.drawer.tab = b.dataset.dtab;
      renderDrawer();
      if (S.drawer.tab === "log") refreshLog();
    });

    const dNote = $("#dNote");
    if (dNote) dNote.addEventListener("input", () => { S.drawerNoteDirty = true; });

    const logBox = $("#logBox");
    if (logBox) logBox.addEventListener("scroll", () => {
      autoScroll = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 32;
    });

    // settings
    const sw = (sel, fn) => { const el = $(sel); if (el) el.addEventListener("click", fn); };
    sw("#setNotify", async () => {
      if (S.notify) { S.notify = false; store("oc-notify", false); toast(t("toast.notifyOff")); syncSettings(); return; }
      await enableNotifications();
    });
    sw("#setSound", () => {
      S.sound = !S.sound;
      store("oc-sound", S.sound);
      if (S.sound) { ensureAudio(); chime(); toast(t("toast.soundOn"), "ok"); }
      else toast(t("toast.soundOff"));
      syncSettings();
    });
    sw("#setSidebar", () => setCollapsed(!S.collapsed));

    sw("#setToast", () => {
      S.toastOnDone = !S.toastOnDone;
      store("oc-toast", S.toastOnDone);
      syncSettings();
      toast(S.toastOnDone ? t("common.on") : t("common.off"));
    });
    sw("#setReducedMotion", () => {
      S.reducedMotion = !S.reducedMotion;
      store("oc-reduced-motion", S.reducedMotion);
      applyChrome();
      syncSettings();
    });

    const setDensityEl = $("#setDensity");
    if (setDensityEl) setDensityEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-density]");
      if (!b) return;
      S.density = b.dataset.density === "compact" ? "compact" : "comfortable";
      S.compact = S.density === "compact";
      store("oc-density", S.density);
      store("oc-compact", S.compact);
      applyChrome();
      syncSettings();
    });

    const setIntervalEl = $("#setInterval");
    if (setIntervalEl) setIntervalEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-interval]");
      if (!b) return;
      S.interval = Number(b.dataset.interval) || 2;
      store("oc-interval", S.interval);
      restartPolling();
      syncSettings();
      toast(t("toast.interval", { n: S.interval }));
    });
    const setRangeEl = $("#setRange");
    if (setRangeEl) setRangeEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-range]");
      if (!b) return;
      setRangeValue(b.dataset.range);
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || (e.target && e.target.isContentEditable);
      if (e.key === "Escape") {
        if (S.drawer.id) { closeDrawer(); return; }
        const ab = $("#aboutBackdrop");
        if (ab && !ab.hidden) { ab.hidden = true; return; }
        const pop = $("#userPopover");
        if (pop && !pop.hidden) { pop.hidden = true; const uc = $("#userCard"); if (uc) uc.setAttribute("aria-expanded","false"); return; }
        const sr = $("#searchResults");
        if (sr && !sr.hidden) { sr.hidden = true; return; }
        if (document.body.classList.contains("side-open")) { toggleSidebarMobile(false); return; }
        if (typing) e.target.blur();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        const s = $("#globalSearch");
        if (s) { s.focus(); if (s.select) s.select(); }
        return;
      }
      if (/^[1-7]$/.test(e.key)) {
        e.preventDefault();
        go(VIEWS[Number(e.key) - 1]);
      }
    });

    wireGantt();
    wirePlans();
    wireModelHead();
    wirePager();
    wireSearch();
    wireWindow();
    wireNotifications();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && S.drawer.id) refreshDrawer();
    });
  }

  function setRange(range) {
    if (!["today", "24h", "7d"].includes(range)) range = "today";
    S.range = range;
    store("oc-range", range);
    S.page = 1;
    syncRangeButtons();
    loadMetricsAndRender();
    if (S.view === "timeline") { TL.data = null; loadTimeline(true); }
    if (S.view === "jobs") renderJobs();
  }
  const setRangeValue = setRange;

  function syncRangeButtons() {
    $$("#rangeSeg button").forEach((b) => {
      const on = b.dataset.range === S.range;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    syncSettings();
  }

  function tickClock() {
    const el = $("#clock");
    if (el) el.textContent = hhmmss(Date.now());
  }
  setInterval(tickClock, 1000);

  // ---------- health / version ----------
  async function loadHealth() {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) return;
       const h = await res.json();
       S.health = h;
       S.version = h.opencodeVersion || null;
      const txt = "opencode " + (S.version || "—");
      const el = $("#ocVersion");
      if (el) el.textContent = txt;
      const pv = $("#upopVersion");
      if (pv) pv.textContent = txt;
      const av = $("#aboutVersion");
      if (av) av.textContent = txt;
    } catch { /* ignore */ }
  }

  // ---------- init ----------
  function init() {
    applyTheme(S.theme);
    applyChrome();
    syncRangeButtons();
    syncFilterChips();
    wireStatic();
    if (window.I18n && typeof window.I18n.applyStatic === "function") { try { window.I18n.applyStatic(document); } catch (e) {} }
    if (window.I18n && typeof window.I18n.onChange === "function") {
      window.I18n.onChange(() => {
        try { window.I18n.applyStatic(document); } catch (e) {}
        applyTheme(S.theme);
        applyChrome();
        updateUserCard();
        syncSettings();
        if (S.view === "settings") refreshSettingsView();
        const iv = $("#refreshIv"); if (iv) iv.textContent = t("refresh.every", { n: S.interval });
        const t = $("#titlebarTitle");
        // refresh current view labels
        refreshView(S.view);

      });
    }
    tickClock();
    if (S.filters.status && !["", "running", "done", "failed", "stopped"].includes(S.filters.status)) S.filters.status = "";
    if (S.filters.kind && !KINDS.includes(S.filters.kind)) S.filters.kind = "";
    const startView = viewFromHash();
    window.addEventListener("hashchange", () => applyView(viewFromHash()));
    applyView(startView);
    poll();
    startPolling();
    restartPolling();
    loadHealth();
    ensureMetrics(true).then(() => { if (S.view === "overview") renderOverview(); });
    loadBatches();
    loadModels();

    setInterval(() => { if (!document.hidden && S.view === "overview") refreshLiveLines(); }, 4000);
    setInterval(() => { if (!document.hidden) ensureMetrics(true).then(() => { if (S.view === "overview") renderOverview(); else if (S.view === "timeline") renderTimelineCharts(); }); }, 15000);
     setInterval(() => { if (!document.hidden) loadBatches(); }, 12000);
     setInterval(() => { if (!document.hidden) updateConnLabel(); }, 1000);
  }

  init();
})();
