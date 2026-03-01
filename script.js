(() => {
  "use strict";

  // =========================
  // Utilities
  // =========================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const nowISO = () => new Date().toISOString();
  const uid = (prefix = "id") => `${prefix}_${crypto.getRandomValues(new Uint32Array(2)).join("")}_${Date.now()}`;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const safeOpen = (url) => window.open(url, "_blank", "noopener,noreferrer");

  function escapeLine(s) {
    return String(s ?? "").replace(/\r/g, "");
  }

  function parseCSVTags(s) {
    return String(s || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  function toLines(s) {
    return String(s || "")
      .split("\n")
      .map(x => x.trim())
      .filter(Boolean)
      .slice(0, 200);
  }

  function formatMiniDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  }

  // Human-friendly ID sanitizer (Case Number / Report Number)
  // Allows: letters, numbers, space, dash, underscore, dot, slash
  function sanitizeHumanId(s, maxLen = 40) {
    const raw = String(s || "").trim();
    if (!raw) return "";
    const cleaned = raw.replace(/[^a-zA-Z0-9 _.\-\/]/g, "");
    return cleaned.slice(0, maxLen);
  }

  // =========================
  // Notifications: queue + dedupe + rate-limit
  // =========================
  const Toasts = (() => {
    const host = $("#toasts");
    const queue = [];
    let showing = false;
    const lastShown = new Map(); // key -> timestamp
    const DEDUPE_MS = 1400;

    function keyOf(t, m) { return `${t}::${m}`; }

    function push({ title, message, ttl = 2600 }) {
      const k = keyOf(title, message);
      const t = Date.now();
      if (lastShown.has(k) && (t - lastShown.get(k)) < DEDUPE_MS) return;
      lastShown.set(k, t);
      queue.push({ title, message, ttl });
      pump();
    }

    async function pump() {
      if (showing) return;
      if (!queue.length) return;
      showing = true;

      const item = queue.shift();
      const el = document.createElement("div");
      el.className = "toast";
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = item.title;
      const m = document.createElement("div");
      m.className = "m";
      m.textContent = item.message;
      el.appendChild(t);
      el.appendChild(m);
      host.appendChild(el);

      await sleep(item.ttl);
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      el.style.transition = "opacity .2s ease, transform .2s ease";
      await sleep(220);
      el.remove();
      showing = false;
      pump();
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    return { push };
  })();

  // =========================
  // Modal
  // =========================
  const Modal = (() => {
    const host = $("#modalHost");

    function close() {
      host.hidden = true;
      host.innerHTML = "";
    }

    function open({ title, body, actions = [] }) {
      host.hidden = false;
      host.innerHTML = "";

      const modal = document.createElement("div");
      modal.className = "modal";

      const head = document.createElement("div");
      head.className = "modal-head";
      const h = document.createElement("h3");
      h.textContent = title || "Modal";
      const x = document.createElement("button");
      x.className = "iconbtn";
      x.textContent = "✕";
      x.addEventListener("click", close);
      head.appendChild(h);
      head.appendChild(x);

      const b = document.createElement("div");
      b.className = "modal-body";
      if (typeof body === "string") {
        const p = document.createElement("div");
        p.textContent = body;
        b.appendChild(p);
      } else if (body instanceof Node) {
        b.appendChild(body);
      }

      const foot = document.createElement("div");
      foot.className = "modal-foot";
      for (const a of actions) {
        const btn = document.createElement("button");
        btn.className = `btn ${a.primary ? "primary" : "ghost"}`;
        btn.textContent = a.label;
        btn.addEventListener("click", async () => {
          try { await a.onClick?.(); } finally { if (a.close !== false) close(); }
        });
        foot.appendChild(btn);
      }

      modal.appendChild(head);
      modal.appendChild(b);
      modal.appendChild(foot);
      host.appendChild(modal);

      host.addEventListener("click", (e) => { if (e.target === host) close(); }, { once: true });
      return { close };
    }

    return { open, close };
  })();

  // =========================
  // IndexedDB helper (generic)
  // =========================
  const DB = (() => {
    const DB_NAME = "sinners_db";
    const DB_VER = 1;

    function open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          const stores = ["handles", "settings", "cases", "reports", "agenda", "audit", "osintHistory"];
          for (const s of stores) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function get(store, key) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    }

    async function set(store, key, val) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    async function del(store, key) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    async function keys(store) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
      });
    }

    return { get, set, del, keys };
  })();

  // =========================
  // Workspace Manager (File System Access API)
  // =========================
  const Workspace = (() => {
    const HANDLE_KEY = "workspaceDirHandle";

    function supported() {
      return "showDirectoryPicker" in window;
    }

    async function verifyPermission(handle, readWrite = true) {
      const opts = { mode: readWrite ? "readwrite" : "read" };
      if ((await handle.queryPermission(opts)) === "granted") return true;
      if ((await handle.requestPermission(opts)) === "granted") return true;
      return false;
    }

    async function getSavedHandle() {
      return await DB.get("handles", HANDLE_KEY);
    }

    async function saveHandle(handle) {
      await DB.set("handles", HANDLE_KEY, handle);
    }

    async function forgetHandle() {
      await DB.del("handles", HANDLE_KEY);
    }

    async function ensureStructure(rootHandle) {
      const dirs = ["cases", "reports", "attachments", "templates", "exports", "logs"];
      for (const d of dirs) await rootHandle.getDirectoryHandle(d, { create: true });
    }

    async function choose() {
      if (!supported()) return { ok: false, reason: "no-fs-access" };
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      const ok = await verifyPermission(dir, true);
      if (!ok) return { ok: false, reason: "permission-denied" };
      await ensureStructure(dir);
      await saveHandle(dir);
      return { ok: true, handle: dir };
    }

    async function initFromSaved() {
      if (!supported()) return { ok: false, reason: "no-fs-access" };
      const h = await getSavedHandle();
      if (!h) return { ok: false, reason: "no-handle" };
      const ok = await verifyPermission(h, true);
      if (!ok) return { ok: false, reason: "permission-needed" };
      await ensureStructure(h);
      return { ok: true, handle: h };
    }

    async function dir(rootHandle, name) {
      return await rootHandle.getDirectoryHandle(name, { create: true });
    }

    async function writeJSON(dirHandle, filename, obj) {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(obj, null, 2));
      await writable.close();
    }

    async function readJSON(dirHandle, filename) {
      const fileHandle = await dirHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return JSON.parse(await file.text());
    }

    async function listFiles(dirHandle) {
      const out = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === "file") out.push(name);
      }
      return out.sort();
    }

    return {
      supported,
      choose,
      initFromSaved,
      forgetHandle,
      dir,
      writeJSON,
      readJSON,
      listFiles
    };
  })();

  // =========================
  // Store Abstraction (workspace files OR IndexedDB fallback)
  // =========================
  const Store = (() => {
    const state = {
      mode: "unknown", // "workspace" | "idb"
      rootHandle: null
    };

    async function setModeWorkspace(handle) {
      state.mode = "workspace";
      state.rootHandle = handle;
      await DB.set("settings", "storageMode", "workspace");
    }

    async function setModeIDB() {
      state.mode = "idb";
      state.rootHandle = null;
      await DB.set("settings", "storageMode", "idb");
    }

    async function loadMode() {
      const m = await DB.get("settings", "storageMode");
      return m || "unknown";
    }

    // ---------- Agenda ----------
    async function agendaGetAll() {
      if (state.mode === "workspace") {
        const logs = await Workspace.dir(state.rootHandle, "logs");
        try {
          const data = await Workspace.readJSON(logs, "agenda.json");
          return Array.isArray(data) ? data : [];
        } catch { return []; }
      }
      return (await DB.get("agenda", "items")) || [];
    }

    async function agendaSaveAll(items) {
      if (state.mode === "workspace") {
        const logs = await Workspace.dir(state.rootHandle, "logs");
        await Workspace.writeJSON(logs, "agenda.json", items);
        return;
      }
      await DB.set("agenda", "items", items);
    }

    // ---------- Audit ----------
    async function auditAppend(entry) {
      const item = { id: uid("audit"), at: nowISO(), ...entry };
      const list = (await DB.get("audit", "items")) || [];
      list.unshift(item);
      await DB.set("audit", "items", list.slice(0, 200));
      if (state.mode === "workspace") {
        const logs = await Workspace.dir(state.rootHandle, "logs");
        await Workspace.writeJSON(logs, "audit.json", list.slice(0, 200));
      }
    }

    async function auditGet() {
      if (state.mode === "workspace") {
        const logs = await Workspace.dir(state.rootHandle, "logs");
        try {
          const data = await Workspace.readJSON(logs, "audit.json");
          return Array.isArray(data) ? data : [];
        } catch { /* fallthrough */ }
      }
      return (await DB.get("audit", "items")) || [];
    }

    // ---------- Cases ----------
    async function caseList() {
      if (state.mode === "workspace") {
        const casesDir = await Workspace.dir(state.rootHandle, "cases");
        try {
          const idx = await Workspace.readJSON(casesDir, "_index.json");
          return Array.isArray(idx) ? idx : [];
        } catch {
          return [];
        }
      }
      const keys = await DB.keys("cases");
      const items = [];
      for (const k of keys) {
        if (String(k).startsWith("case:")) {
          const c = await DB.get("cases", k);
          if (c) items.push(c);
        }
      }
      items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return items;
    }

    async function caseGet(caseId) {
      if (state.mode === "workspace") {
        const casesDir = await Workspace.dir(state.rootHandle, "cases");
        const cdir = await casesDir.getDirectoryHandle(caseId, { create: true });
        return await Workspace.readJSON(cdir, "case.json");
      }
      return await DB.get("cases", `case:${caseId}`);
    }

    async function caseExists(caseId) {
      try {
        const c = await caseGet(caseId);
        return !!c;
      } catch { return false; }
    }

    async function caseUpsert(caseObj) {
      const c = {
        ...caseObj,
        updatedAt: nowISO()
      };

      if (state.mode === "workspace") {
        const casesDir = await Workspace.dir(state.rootHandle, "cases");
        const cdir = await casesDir.getDirectoryHandle(c.caseId, { create: true });
        await Workspace.writeJSON(cdir, "case.json", c);

        // update index
        const idxPath = "_index.json";
        let idx = [];
        try { idx = await Workspace.readJSON(casesDir, idxPath); } catch {}
        if (!Array.isArray(idx)) idx = [];

        const i = idx.findIndex(x => x.caseId === c.caseId);
        const slim = {
          caseId: c.caseId,
          caseNumber: c.caseNumber || "",
          title: c.title,
          status: c.status,
          assigned: c.assigned,
          tags: c.tags,
          updatedAt: c.updatedAt,
          createdAt: c.createdAt
        };
        if (i >= 0) idx[i] = slim; else idx.unshift(slim);

        idx.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        await Workspace.writeJSON(casesDir, idxPath, idx.slice(0, 500));
      } else {
        await DB.set("cases", `case:${c.caseId}`, c);
      }

      await auditAppend({ type: "case.upsert", msg: `Saved case ${c.caseId}${c.caseNumber ? ` (${c.caseNumber})` : ""}` });
      return c;
    }

    // ---------- Reports ----------
    async function reportUpsert(reportObj) {
      const r = { ...reportObj, updatedAt: nowISO() };

      if (state.mode === "workspace") {
        const reportsDir = await Workspace.dir(state.rootHandle, "reports");
        const caseDir = await reportsDir.getDirectoryHandle(r.caseId, { create: true });
        await Workspace.writeJSON(caseDir, `${r.reportId}.json`, r);
      } else {
        await DB.set("reports", `rep:${r.reportId}`, r);
      }
      await auditAppend({ type: "report.upsert", msg: `Saved report ${r.reportId}${r.reportNumber ? ` (${r.reportNumber})` : ""}` });
      return r;
    }

    async function reportGet(reportId, caseIdMaybe = null) {
      if (state.mode === "workspace") {
        if (!caseIdMaybe) throw new Error("caseId required for workspace report read");
        const reportsDir = await Workspace.dir(state.rootHandle, "reports");
        const caseDir = await reportsDir.getDirectoryHandle(caseIdMaybe, { create: true });
        return await Workspace.readJSON(caseDir, `${reportId}.json`);
      }
      return await DB.get("reports", `rep:${reportId}`);
    }

    async function reportListForCase(caseId) {
      if (state.mode === "workspace") {
        const reportsDir = await Workspace.dir(state.rootHandle, "reports");
        const caseDir = await reportsDir.getDirectoryHandle(caseId, { create: true });
        const files = await Workspace.listFiles(caseDir);
        return files
          .filter(n => n.endsWith(".json"))
          .map(n => n.replace(".json", ""));
      }
      const keys = await DB.keys("reports");
      const reps = [];
      for (const k of keys) {
        if (String(k).startsWith("rep:")) {
          const r = await DB.get("reports", k);
          if (r && r.caseId === caseId) reps.push(r);
        }
      }
      reps.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return reps.map(r => r.reportId);
    }

    async function reportListAllSlim() {
      if (state.mode === "workspace") {
        const cases = await caseList();
        const out = [];
        for (const c of cases) {
          const ids = await reportListForCase(c.caseId);
          for (const id of ids) out.push({ reportId: id, caseId: c.caseId });
        }
        return out;
      }
      const keys = await DB.keys("reports");
      const out = [];
      for (const k of keys) {
        if (String(k).startsWith("rep:")) {
          const r = await DB.get("reports", k);
          if (r) out.push({ reportId: r.reportId, caseId: r.caseId, title: r.type, reportNumber: r.reportNumber || "", updatedAt: r.updatedAt });
        }
      }
      out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return out;
    }

    // ---------- OSINT history ----------
    async function osintSaveForCase(caseId, entry) {
      const key = `osint:${caseId}`;
      const list = (await DB.get("osintHistory", key)) || [];
      list.unshift({ id: uid("osint"), at: nowISO(), ...entry });
      await DB.set("osintHistory", key, list.slice(0, 200));
      await auditAppend({ type: "osint.save", msg: `Saved OSINT run to case ${caseId}` });
    }

    async function osintGetForCase(caseId) {
      return (await DB.get("osintHistory", `osint:${caseId}`)) || [];
    }

    // ---------- Export/Import ----------
    async function exportBundle() {
      const payload = {
        exportedAt: nowISO(),
        mode: state.mode,
        settings: {
          activeCaseId: await DB.get("settings", "activeCaseId"),
          storageMode: state.mode
        },
        agenda: await agendaGetAll(),
        audit: await auditGet(),
        cases: await caseList().then(async (slim) => {
          const full = [];
          for (const c of slim) {
            try { full.push(await caseGet(c.caseId)); } catch {}
          }
          return full;
        }),
        reports: []
      };

      const cases = payload.cases;
      for (const c of cases) {
        const ids = await reportListForCase(c.caseId);
        for (const rid of ids) {
          try {
            const r = await (state.mode === "workspace"
              ? reportGet(rid, c.caseId)
              : reportGet(rid));
            payload.reports.push(r);
          } catch {}
        }
      }

      return payload;
    }

    async function importBundle(payload) {
      if (!payload || typeof payload !== "object") throw new Error("Invalid bundle");
      const agenda = Array.isArray(payload.agenda) ? payload.agenda : [];
      const cases = Array.isArray(payload.cases) ? payload.cases : [];
      const reports = Array.isArray(payload.reports) ? payload.reports : [];

      await agendaSaveAll(agenda);

      for (const c of cases) {
        if (!c?.caseId) continue;
        await caseUpsert(c);
      }
      for (const r of reports) {
        if (!r?.reportId || !r?.caseId) continue;
        await reportUpsert(r);
      }

      await auditAppend({ type: "import", msg: `Imported bundle with ${cases.length} cases / ${reports.length} reports` });
    }

    return {
      state,
      setModeWorkspace,
      setModeIDB,
      loadMode,
      agendaGetAll,
      agendaSaveAll,
      auditGet,
      auditAppend,
      caseList,
      caseGet,
      caseUpsert,
      caseExists,
      reportUpsert,
      reportGet,
      reportListForCase,
      reportListAllSlim,
      osintSaveForCase,
      osintGetForCase,
      exportBundle,
      importBundle
    };
  })();

  // =========================
  // Auth
  // =========================
// =========================
// Auth
// =========================
const Auth = (() => {
  const KEY = "sinners_session";

  // ✅ Add users here (username: password)
  // NOTE: This is still hardcoded (MVP). Later we can move this to a proper user store.
  const USERS = {
    "Nfranco": "Admin!",
    "Jgarcia": "Admin!:"   // <-- your new user
  };

  function isLoggedIn() {
    return sessionStorage.getItem(KEY) === "1";
  }

  function login(u, p) {
    const user = String(u || "").trim();
    const pass = String(p || "");

    if (USERS[user] && USERS[user] === pass) {
      sessionStorage.setItem(KEY, "1");
      sessionStorage.setItem("sinners_user", user);
      sessionStorage.setItem("sinners_role", "Admin"); // MVP: everyone here is Admin
      return true;
    }
    return false;
  }

  function logout() {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem("sinners_user");
    sessionStorage.removeItem("sinners_role");
  }

  function role() {
    return sessionStorage.getItem("sinners_role") || "Viewer";
  }

  function currentUser() {
    return sessionStorage.getItem("sinners_user") || "";
  }

  return { isLoggedIn, login, logout, role, currentUser };
})();

  // =========================
  // Router / UI shell
  // =========================
  const Views = {
    splash: $("#view-splash"),
    setup: $("#view-setup"),
    login: $("#view-login"),
    app: $("#view-app")
  };

  const Pages = {
    dashboard: $("#page-dashboard"),
    cases: $("#page-cases"),
    reports: $("#page-reports"),
    osint: $("#page-osint"),
    utils: $("#page-utils"),
    settings: $("#page-settings")
  };

  function forceCloseOverlays() {
    const cmdk = $("#cmdk");
    if (cmdk) cmdk.hidden = true;
    const mh = $("#modalHost");
    if (mh) { mh.hidden = true; mh.innerHTML = ""; }
  }

  function forceCloseOverlays() {
  // Command palette
  const cmdk = document.getElementById("cmdk");
  if (cmdk) cmdk.hidden = true;

  // Modal host
  const mh = document.getElementById("modalHost");
  if (mh) {
    mh.hidden = true;
    mh.innerHTML = "";
  }
}

function showView(name) {
  forceCloseOverlays(); // <-- critical
  for (const [k, el] of Object.entries(Views)) {
    el.setAttribute("aria-hidden", k === name ? "false" : "true");
  }
}

  function showPage(route) {
    for (const [k, el] of Object.entries(Pages)) el.hidden = k !== route;
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.route === route));
  }

  // =========================
  // Demo Seed (first run)
  // =========================
  async function seedIfEmpty() {
    const seeded = await DB.get("settings", "seeded");
    if (seeded) return;

    const demoCase = {
      caseId: uid("case"),
      caseNumber: "2026-INV-DEMO",
      title: "Demo Case — Social Handle Attribution",
      status: "Active",
      assigned: "Nfranco",
      tags: ["demo", "osint", "attribution"],
      subjects: ["@example_handle", "example@email.com"],
      timeline: ["Initial intake created.", "OSINT checks queued."],
      createdAt: nowISO(),
      updatedAt: nowISO()
    };

    try { await Store.caseUpsert(demoCase); }
    catch { await DB.set("cases", `case:${demoCase.caseId}`, demoCase); }

    const agenda = [{
      id: uid("ag"),
      pinned: true,
      title: "Welcome to SINNERS (MVP)",
      body: "Pick a workspace folder (recommended: Desktop/SINNERS). Use Cases → Create/Set Active. Reports support Case Number + Report Number.",
      tags: ["onboarding", "mvp"],
      due: "",
      createdAt: nowISO(),
      createdBy: "Admin"
    }];
    await DB.set("agenda", "items", agenda);

    await DB.set("settings", "seeded", true);
  }

  // =========================
  // Setup Wizard logic
  // =========================
  const setupSupportText = $("#setup-supportText");
  const setupStatus = $("#setupStatus");
  const btnSelectWorkspace = $("#btnSelectWorkspace");
  const btnUseFallback = $("#btnUseFallback");

  async function setupInit() {
    const fs = Workspace.supported();
    setupSupportText.textContent = fs
      ? "✅ Full workspace mode supported in this browser."
      : "⚠️ Workspace mode not supported here. Use fallback (IndexedDB) or switch to Chrome/Edge/Brave.";
    btnSelectWorkspace.disabled = !fs;
    setupStatus.textContent = "Not configured";
  }

  async function setupChooseWorkspace() {
    try {
      Toasts.push({ title: "Workspace", message: "Recommended folder: Desktop/SINNERS" });
      const res = await Workspace.choose();
      if (!res.ok) {
        Toasts.push({ title: "Workspace", message: "Permission denied or canceled." });
        return;
      }
      await Store.setModeWorkspace(res.handle);
      Toasts.push({ title: "Workspace Ready", message: "Folders created: cases/reports/attachments/templates/exports/logs" });
      setupStatus.textContent = "Configured (Workspace Mode)";
      showView("login");
    } catch (e) {
      Toasts.push({ title: "Workspace Error", message: String(e?.message || e) });
    }
  }

  async function setupUseFallback() {
    await Store.setModeIDB();
    Toasts.push({ title: "Fallback Mode", message: "Using IndexedDB storage + Export/Import." });
    setupStatus.textContent = "Configured (Fallback Mode)";
    showView("login");
  }

  // =========================
  // Login logic
  // =========================
  const loginForm = $("#loginForm");
  const loginUser = $("#loginUser");
  const loginPass = $("#loginPass");
  const loginError = $("#loginError");
  const btnBackToSetup = $("#btnBackToSetup");
  const btnTogglePass = $("#btnTogglePass");
  const capsHint = $("#capsHint");

  function setLoginError(msg) {
    loginError.hidden = !msg;
    loginError.textContent = msg || "";
  }

  function capsLockCheck(e) {
    const on = e.getModifierState && e.getModifierState("CapsLock");
    capsHint.hidden = !on;
  }

  // =========================
  // App state
  // =========================
  const AppState = {
    activeRoute: "dashboard",
    activeCaseId: null,
    selectedCaseId: null,
    report: { caseId: null, reportId: null, evidence: [] },
    redaction: false
  };

  // =========================
  // Dashboard
  // =========================
  const agendaList = $("#agendaList");
  const activityList = $("#activityList");
  const btnNewAgenda = $("#btnNewAgenda");
  const btnRefreshDash = $("#btnRefreshDash");
  const tileNewCase = $("#tileNewCase");
  const tileNewReport = $("#tileNewReport");
  const tileOsint = $("#tileOsint");
  const tileExport = $("#tileExport");

  function spanMeta(t) {
    const s = document.createElement("span");
    s.textContent = t;
    return s;
  }

  function agendaCard(item) {
    const el = document.createElement("div");
    el.className = "item";
    const title = document.createElement("div");
    title.textContent = (item.pinned ? "📌 " : "") + item.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.appendChild(spanMeta(`By ${item.createdBy || "Admin"}`));
    meta.appendChild(spanMeta(formatMiniDate(item.createdAt)));
    if (item.due) meta.appendChild(spanMeta(`Due ${item.due}`));
    if (Array.isArray(item.tags) && item.tags.length) meta.appendChild(spanMeta(`#${item.tags.join(" #")}`));

    const body = document.createElement("div");
    body.className = "muted";
    body.style.marginTop = "8px";
    body.textContent = item.body;

    el.appendChild(title);
    el.appendChild(meta);
    el.appendChild(body);
    return el;
  }

  async function renderDashboard() {
    agendaList.innerHTML = "";
    activityList.innerHTML = "";

    const agenda = await Store.agendaGetAll();
    const pinned = agenda.filter(a => a.pinned);
    const rest = agenda.filter(a => !a.pinned);
    const merged = [...pinned, ...rest].slice(0, 30);

    if (!merged.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No agenda posts yet.";
      agendaList.appendChild(empty);
    } else {
      for (const a of merged) agendaList.appendChild(agendaCard(a));
    }

    const audit = await Store.auditGet();
    const act = audit.slice(0, 10);
    if (!act.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No activity yet.";
      activityList.appendChild(empty);
    } else {
      for (const e of act) {
        const it = document.createElement("div");
        it.className = "item";
        const t = document.createElement("div");
        t.textContent = e.type;
        const m = document.createElement("div");
        m.className = "muted";
        m.style.marginTop = "6px";
        m.textContent = `${formatMiniDate(e.at)} — ${e.msg || ""}`;
        it.appendChild(t);
        it.appendChild(m);
        activityList.appendChild(it);
      }
    }
  }

  async function newAgendaModal() {
    if (Auth.role() !== "Admin") {
      Toasts.push({ title: "Access denied", message: "Admin only." });
      return;
    }

    const wrap = document.createElement("div");

    const title = document.createElement("input");
    title.placeholder = "Title";
    const body = document.createElement("textarea");
    body.rows = 5;
    body.placeholder = "Bulletin content…";
    const tags = document.createElement("input");
    tags.placeholder = "Tags (comma-separated)";
    const due = document.createElement("input");
    due.placeholder = "Due date (optional, e.g., 2026-03-01)";
    const pinned = document.createElement("label");
    pinned.className = "row gap";
    const pinCb = document.createElement("input");
    pinCb.type = "checkbox";
    const pinTxt = document.createElement("span");
    pinTxt.className = "muted";
    pinTxt.textContent = "Pin post";
    pinned.appendChild(pinCb);
    pinned.appendChild(pinTxt);

    [title, body, tags, due].forEach(el => {
      el.style.marginTop = "10px";
      el.style.width = "100%";
    });
    wrap.appendChild(title);
    wrap.appendChild(body);
    wrap.appendChild(tags);
    wrap.appendChild(due);
    wrap.appendChild(pinned);

    Modal.open({
      title: "New Agenda Post",
      body: wrap,
      actions: [
        { label: "Cancel" },
        {
          label: "Publish",
          primary: true,
          onClick: async () => {
            const agenda = await Store.agendaGetAll();
            agenda.unshift({
              id: uid("ag"),
              pinned: !!pinCb.checked,
              title: escapeLine(title.value).slice(0, 140) || "Untitled",
              body: escapeLine(body.value).slice(0, 4000) || "",
              tags: parseCSVTags(tags.value),
              due: escapeLine(due.value).slice(0, 32),
              createdAt: nowISO(),
              createdBy: "Admin"
            });
            await Store.agendaSaveAll(agenda.slice(0, 200));
            await Store.auditAppend({ type: "agenda.post", msg: `Published agenda: ${agenda[0].title}` });
            Toasts.push({ title: "Agenda", message: "Post published." });
            await renderDashboard();
          }
        }
      ]
    });
  }

  // =========================
  // Cases UI
  // =========================
  const caseListEl = $("#caseList");
  const caseFilter = $("#caseFilter");
  const caseStatusFilter = $("#caseStatusFilter");
  const btnCreateCase = $("#btnCreateCase");
  const btnReloadCases = $("#btnReloadCases");

  const caseDetailEmpty = $("#caseDetailEmpty");
  const caseDetail = $("#caseDetail");
  const caseTitle = $("#caseTitle");
  const caseStatus = $("#caseStatus");
  const caseAssigned = $("#caseAssigned");
  const caseTags = $("#caseTags");
  const caseSubjects = $("#caseSubjects");
  const caseTimeline = $("#caseTimeline");
  const btnCaseSave = $("#btnCaseSave");
  const btnCaseSetActive = $("#btnCaseSetActive");
  const btnCaseNewReport = $("#btnCaseNewReport");
  const btnCaseExport = $("#btnCaseExport");

  // Add Case Number field to detail panel dynamically (no HTML change required)
  let caseNumberInput = null;
  function ensureCaseNumberField() {
    if (caseNumberInput) return;
    const grid2 = caseDetail.querySelector(".grid-2");
    if (!grid2) return;

    // Insert a "Case Number" field next to Title/Status group by adding a new row below
    const container = document.createElement("div");
    container.className = "grid-2";
    container.style.marginTop = "0px";

    const lab = document.createElement("label");
    lab.className = "label";
    const sp = document.createElement("span");
    sp.textContent = "Case Number (human ID)";
    caseNumberInput = document.createElement("input");
    caseNumberInput.placeholder = "e.g., 2026-INV-0412";
    lab.appendChild(sp);
    lab.appendChild(caseNumberInput);

    const hint = document.createElement("label");
    hint.className = "label";
    const sp2 = document.createElement("span");
    sp2.textContent = "Internal Case ID";
    const readonly = document.createElement("input");
    readonly.disabled = true;
    readonly.id = "caseInternalId";
    hint.appendChild(sp2);
    hint.appendChild(readonly);

    container.appendChild(lab);
    container.appendChild(hint);

    // Insert after first two grid blocks (title/status)
    const grids = caseDetail.querySelectorAll(".grid-2");
    if (grids.length >= 1) grids[0].insertAdjacentElement("afterend", container);
  }

  async function renderCases() {
    ensureCaseNumberField();
    caseListEl.innerHTML = "";
    const all = await Store.caseList();

    const q = (caseFilter.value || "").toLowerCase();
    const st = caseStatusFilter.value || "";

    const filtered = all.filter(c => {
      const hay = `${c.caseNumber || ""} ${c.title || ""} ${(c.tags || []).join(" ")} ${c.status || ""} ${c.assigned || ""} ${c.caseId}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (st && c.status !== st) return false;
      return true;
    });

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No cases found.";
      caseListEl.appendChild(empty);
      return;
    }

    for (const c of filtered) {
      const it = document.createElement("div");
      it.className = "item";
      it.classList.toggle("active", AppState.selectedCaseId === c.caseId);

      const t = document.createElement("div");
      t.textContent = `${c.caseNumber ? `[${c.caseNumber}] ` : ""}${c.title || c.caseId}`;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.appendChild(spanMeta(c.status || "Open"));
      if (c.assigned) meta.appendChild(spanMeta(`@${c.assigned}`));
      if (c.tags?.length) meta.appendChild(spanMeta(`#${c.tags.join(" #")}`));
      meta.appendChild(spanMeta(`ID: ${c.caseId}`));
      if (c.updatedAt) meta.appendChild(spanMeta(`Updated ${formatMiniDate(c.updatedAt)}`));

      it.appendChild(t);
      it.appendChild(meta);

      it.addEventListener("click", async () => {
        AppState.selectedCaseId = c.caseId;
        await openCase(c.caseId);
        await renderCases();
      });

      caseListEl.appendChild(it);
    }
  }

  async function openCase(caseId) {
    ensureCaseNumberField();
    const c = await Store.caseGet(caseId);
    caseDetailEmpty.hidden = true;
    caseDetail.hidden = false;

    caseTitle.value = c.title || "";
    caseStatus.value = c.status || "Open";
    caseAssigned.value = c.assigned || "";
    caseTags.value = (c.tags || []).join(", ");
    caseSubjects.value = (c.subjects || []).join("\n");
    caseTimeline.value = (c.timeline || []).join("\n");

    if (caseNumberInput) caseNumberInput.value = c.caseNumber || "";
    const internal = $("#caseInternalId");
    if (internal) internal.value = c.caseId || "";
  }

  async function createCaseModal() {
    const wrap = document.createElement("div");

    const caseNumber = document.createElement("input");
    caseNumber.placeholder = "Case Number (optional) e.g., 2026-INV-0412";

    const title = document.createElement("input");
    title.placeholder = "Case title (required)";

    const assigned = document.createElement("input");
    assigned.placeholder = "Assigned investigator (e.g., Nfranco)";

    const tags = document.createElement("input");
    tags.placeholder = "Tags (comma-separated)";

    const subjects = document.createElement("textarea");
    subjects.rows = 3;
    subjects.placeholder = "Subjects (one per line)";

    [caseNumber, title, assigned, tags, subjects].forEach(el => {
      el.style.marginTop = "10px";
      el.style.width = "100%";
    });

    wrap.appendChild(caseNumber);
    wrap.appendChild(title);
    wrap.appendChild(assigned);
    wrap.appendChild(tags);
    wrap.appendChild(subjects);

    Modal.open({
      title: "Create Case",
      body: wrap,
      actions: [
        { label: "Cancel" },
        {
          label: "Create",
          primary: true,
          onClick: async () => {
            const cn = sanitizeHumanId(caseNumber.value, 40);

            const c = {
              caseId: uid("case"), // internal id stays stable for filesystem
              caseNumber: cn,
              title: escapeLine(title.value).slice(0, 200) || "Untitled Case",
              status: "Open",
              assigned: escapeLine(assigned.value).slice(0, 80) || "Nfranco",
              tags: parseCSVTags(tags.value),
              subjects: toLines(subjects.value),
              timeline: [],
              createdAt: nowISO(),
              updatedAt: nowISO()
            };

            await Store.caseUpsert(c);
            Toasts.push({ title: "Case", message: `Created${cn ? ` (${cn})` : ""}.` });

            AppState.selectedCaseId = c.caseId;
            await renderCases();
            await openCase(c.caseId);
          }
        }
      ]
    });
  }

  async function saveSelectedCase() {
    if (!AppState.selectedCaseId) return;
    const old = await Store.caseGet(AppState.selectedCaseId);

    const updated = {
      ...old,
      caseNumber: sanitizeHumanId(caseNumberInput?.value || "", 40),
      title: escapeLine(caseTitle.value).slice(0, 200),
      status: caseStatus.value,
      assigned: escapeLine(caseAssigned.value).slice(0, 80),
      tags: parseCSVTags(caseTags.value),
      subjects: toLines(caseSubjects.value),
      timeline: toLines(caseTimeline.value)
    };

    await Store.caseUpsert(updated);
    Toasts.push({ title: "Case", message: "Saved." });
    await renderCases();
  }

  async function setActiveCase(caseId) {
    AppState.activeCaseId = caseId;
    await DB.set("settings", "activeCaseId", caseId);
    updateActiveCasePill();
    Toasts.push({ title: "Active Case", message: caseId });
  }

  async function getActiveCaseNumber() {
    if (!AppState.activeCaseId) return "";
    try {
      const c = await Store.caseGet(AppState.activeCaseId);
      return c.caseNumber || "";
    } catch { return ""; }
  }

  function updateActiveCasePill() {
    const pill = $("#activeCasePill");
    pill.textContent = AppState.activeCaseId ? `Active: ${AppState.activeCaseId}` : "No active case";
  }

  // =========================
  // Reports UI
  // =========================
  const reportCasePill = $("#reportCasePill");
  const reportIdPill = $("#reportIdPill");
  const toggleRedaction = $("#toggleRedaction");

  const repType = $("#repType");
  const repReason = $("#repReason");
  const repConfidence = $("#repConfidence");
  const repScope = $("#repScope");
  const repSummary = $("#repSummary");
  const repMethods = $("#repMethods");
  const repFindings = $("#repFindings");
  const repNext = $("#repNext");
  const evidenceList = $("#evidenceList");

  const btnCreateReport = $("#btnCreateReport");
  const btnLoadReport = $("#btnLoadReport");
  const btnSaveReport = $("#btnSaveReport");
  const btnExportReportJson = $("#btnExportReportJson");
  const btnPrintPdf = $("#btnPrintPdf");
  const btnAddEvidence = $("#btnAddEvidence");

  // Add Report Number input dynamically at top of report card
  let repNumberInput = null;
  async function ensureReportNumberField() {
    if (repNumberInput) return;

    // Insert right under the first row in report card
    const page = $("#page-reports");
    const card = page?.querySelector(".card");
    if (!card) return;

    const firstRow = card.querySelector(".row.gap");
    if (!firstRow) return;

    const block = document.createElement("div");
    block.className = "grid-2";
    block.style.marginTop = "10px";

    const lab = document.createElement("label");
    lab.className = "label";
    const sp = document.createElement("span");
    sp.textContent = "Report Number (human ID)";
    repNumberInput = document.createElement("input");
    repNumberInput.placeholder = "e.g., RPT-0007";
    lab.appendChild(sp);
    lab.appendChild(repNumberInput);

    const lab2 = document.createElement("label");
    lab2.className = "label";
    const sp2 = document.createElement("span");
    sp2.textContent = "Case Number";
    const cn = document.createElement("input");
    cn.id = "repCaseNumber";
    cn.disabled = true;
    lab2.appendChild(sp2);
    lab2.appendChild(cn);

    block.appendChild(lab);
    block.appendChild(lab2);

    firstRow.insertAdjacentElement("afterend", block);
  }

  function redactIfNeeded(s) {
    if (!AppState.redaction) return s;
    const str = String(s || "");
    if (!str.trim()) return str;
    return "█".repeat(clamp(str.length, 6, 140));
  }

  function renderEvidence(items) {
    evidenceList.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No evidence items yet.";
      evidenceList.appendChild(empty);
      return;
    }

    items.forEach((ev, idx) => {
      const it = document.createElement("div");
      it.className = "item";

      const top = document.createElement("div");
      top.textContent = `${idx + 1}. ${redactIfNeeded(ev.label || "Evidence")}`;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.appendChild(spanMeta(`Collected: ${redactIfNeeded(ev.collectedBy || "N/A")}`));
      meta.appendChild(spanMeta(`At: ${ev.collectedAt ? formatMiniDate(ev.collectedAt) : "N/A"}`));
      meta.appendChild(spanMeta(`Confidence: ${ev.confidence || "Medium"}`));

      const link = document.createElement("div");
      link.className = "muted";
      link.style.marginTop = "6px";
      link.textContent = redactIfNeeded(ev.sourceUrl || "");

      const notes = document.createElement("div");
      notes.className = "muted";
      notes.style.marginTop = "6px";
      notes.textContent = redactIfNeeded(ev.notes || "");

      const row = document.createElement("div");
      row.className = "row gap";
      row.style.marginTop = "10px";

      const openBtn = document.createElement("button");
      openBtn.className = "btn ghost";
      openBtn.textContent = "Open Link";
      openBtn.disabled = !ev.sourceUrl;
      openBtn.addEventListener("click", () => {
        if (ev.sourceUrl) safeOpen(ev.sourceUrl);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "btn ghost";
      delBtn.textContent = "Remove";
      delBtn.addEventListener("click", () => {
        const r = currentReportDraft();
        r.evidence.splice(idx, 1);
        loadReportDraft(r);
      });

      row.appendChild(openBtn);
      row.appendChild(delBtn);

      it.appendChild(top);
      it.appendChild(meta);
      it.appendChild(link);
      it.appendChild(notes);
      it.appendChild(row);

      evidenceList.appendChild(it);
    });
  }

  function currentReportDraft() {
    return {
      reportId: AppState.report.reportId,
      reportNumber: sanitizeHumanId(repNumberInput?.value || "", 40),
      caseId: AppState.report.caseId,
      caseNumber: AppState.report.caseNumber || "",
      type: repType.value,
      reason: repReason.value,
      confidence: repConfidence.value,
      scope: escapeLine(repScope.value).slice(0, 300),
      summary: escapeLine(repSummary.value).slice(0, 6000),
      methods: escapeLine(repMethods.value).slice(0, 4000),
      findings: escapeLine(repFindings.value).slice(0, 9000),
      nextSteps: escapeLine(repNext.value).slice(0, 4000),
      evidence: AppState.report.evidence || [],
      createdAt: AppState.report.createdAt || nowISO(),
      updatedAt: nowISO(),
      author: "Nfranco"
    };
  }

  async function loadReportDraft(r) {
    await ensureReportNumberField();

    AppState.report.reportId = r.reportId;
    AppState.report.reportNumber = r.reportNumber || "";
    AppState.report.caseId = r.caseId;
    AppState.report.caseNumber = r.caseNumber || "";
    AppState.report.createdAt = r.createdAt;
    AppState.report.evidence = Array.isArray(r.evidence) ? r.evidence : [];

    reportCasePill.textContent = `Case ID: ${r.caseId || "none"}`;
    reportIdPill.textContent = `Report ID: ${r.reportId || "none"}`;

    if (repNumberInput) repNumberInput.value = r.reportNumber || "";
    const cn = $("#repCaseNumber");
    if (cn) cn.value = r.caseNumber || "";

    repType.value = r.type || "OSINT Lead";
    repReason.value = r.reason || "Unknown / Other";
    repConfidence.value = r.confidence || "Medium";
    repScope.value = r.scope || "";
    repSummary.value = r.summary || "";
    repMethods.value = r.methods || "";
    repFindings.value = r.findings || "";
    repNext.value = r.nextSteps || "";

    renderEvidence(AppState.report.evidence);
  }

  async function createNewReport(caseId = null) {
    await ensureReportNumberField();

    const cid = caseId || AppState.activeCaseId;
    if (!cid) {
      Toasts.push({ title: "Report", message: "Set an active case first." });
      showPage("cases");
      return;
    }

    // Pull caseNumber for display + export
    let cn = "";
    try {
      const c = await Store.caseGet(cid);
      cn = c.caseNumber || "";
    } catch {}

    AppState.report = {
      reportId: uid("rep"),
      reportNumber: "",
      caseId: cid,
      caseNumber: cn,
      createdAt: nowISO(),
      evidence: []
    };

    await loadReportDraft(currentReportDraft());
    Toasts.push({ title: "Report", message: `New draft created${cn ? ` for ${cn}` : ""}.` });
    showPage("reports");
  }

  async function saveReport() {
    const r = currentReportDraft();
    if (!r.caseId || !r.reportId) {
      Toasts.push({ title: "Report", message: "No report loaded." });
      return;
    }
    await Store.reportUpsert(r);
    Toasts.push({ title: "Report", message: "Saved." });
  }

  async function openReportModal() {
    const cid = AppState.activeCaseId;
    if (!cid) {
      Toasts.push({ title: "Report", message: "Set an active case first." });
      return;
    }
    const ids = await Store.reportListForCase(cid);
    if (!ids.length) {
      Toasts.push({ title: "Report", message: "No reports found for active case." });
      return;
    }

    const list = document.createElement("div");
    list.className = "listbox";
    for (const id of ids) {
      const it = document.createElement("div");
      it.className = "item";
      it.textContent = id;
      it.addEventListener("click", async () => {
        try {
          const r = await Store.reportGet(id, cid);
          await loadReportDraft(r);
          Toasts.push({ title: "Report", message: "Loaded." });
          Modal.close();
          showPage("reports");
        } catch (e) {
          Toasts.push({ title: "Report", message: `Failed to load: ${String(e?.message || e)}` });
        }
      });
      list.appendChild(it);
    }

    Modal.open({
      title: `Open Report (Case ${cid})`,
      body: list,
      actions: [{ label: "Close" }]
    });
  }

  function addEvidenceModal() {
    const wrap = document.createElement("div");
    const label = document.createElement("input"); label.placeholder = "Label (e.g., Profile screenshot, registry record)";
    const url = document.createElement("input"); url.placeholder = "Source URL";
    const by = document.createElement("input"); by.placeholder = "Collected by"; by.value = "Nfranco";
    const conf = document.createElement("select");
    ["Low", "Medium", "High"].forEach(x => { const o = document.createElement("option"); o.textContent = x; conf.appendChild(o); });
    conf.value = "Medium";
    const notes = document.createElement("textarea"); notes.rows = 4; notes.placeholder = "Notes";

    [label, url, by, conf, notes].forEach(el => { el.style.marginTop = "10px"; el.style.width = "100%"; });

    wrap.appendChild(label);
    wrap.appendChild(url);
    wrap.appendChild(by);
    wrap.appendChild(conf);
    wrap.appendChild(notes);

    Modal.open({
      title: "Add Evidence",
      body: wrap,
      actions: [
        { label: "Cancel" },
        {
          label: "Add",
          primary: true,
          onClick: () => {
            const ev = {
              label: escapeLine(label.value).slice(0, 180) || "Evidence",
              sourceUrl: escapeLine(url.value).slice(0, 1200),
              collectedBy: escapeLine(by.value).slice(0, 80),
              collectedAt: nowISO(),
              confidence: conf.value,
              notes: escapeLine(notes.value).slice(0, 2000)
            };
            const r = currentReportDraft();
            r.evidence = r.evidence || [];
            r.evidence.unshift(ev);
            loadReportDraft(r);
            Toasts.push({ title: "Evidence", message: "Added." });
          },
          close: true
        }
      ]
    });
  }

  function exportJSONDownload(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  // =========================
  // OSINT Launcher (library unchanged)
  // =========================
  const osintCategory = $("#osintCategory");
  const btnGenerateOsint = $("#btnGenerateOsint");
  const btnSelectAllOsint = $("#btnSelectAllOsint");
  const btnClearOsint = $("#btnClearOsint");
  const btnRunOsint = $("#btnRunOsint");
  const btnSaveOsintHistory = $("#btnSaveOsintHistory");
  const osintLinksEl = $("#osintLinks");
  const osintCount = $("#osintCount");

  const inUsername = $("#inUsername");
  const inEmail = $("#inEmail");
  const inPhone = $("#inPhone");
  const inName = $("#inName");
  const inDomain = $("#inDomain");
  const inIP = $("#inIP");

  // Same OSINT library you had (kept intact for safety/consistency)
  const OSINT_LIBRARY = [
    { cat: "Search Engines / Dorks", items: [
      { label: "Google: username exact", url: "https://www.google.com/search?q=%22{username}%22" },
      { label: "Google: email exact", url: "https://www.google.com/search?q=%22{email}%22" },
      { label: "Google: phone exact", url: "https://www.google.com/search?q=%22{phone}%22" },
      { label: "Google: name exact", url: "https://www.google.com/search?q=%22{name}%22" },
      { label: "Google: site:{domain}", url: "https://www.google.com/search?q=site%3A{domain}" },
      { label: "Google: {domain} filetype:pdf", url: "https://www.google.com/search?q=site%3A{domain}+filetype%3Apdf" },
      { label: "Google: {domain} filetype:xls OR xlsx", url: "https://www.google.com/search?q=site%3A{domain}+(filetype%3Axls+OR+filetype%3Axlsx)" },
      { label: "Google: {domain} filetype:doc OR docx", url: "https://www.google.com/search?q=site%3A{domain}+(filetype%3Adoc+OR+filetype%3Adocx)" },
      { label: "Google: {domain} 'password' (careful)", url: "https://www.google.com/search?q=site%3A{domain}+password" },
      { label: "Google: {domain} 'confidential'", url: "https://www.google.com/search?q=site%3A{domain}+confidential" },
      { label: "Bing: username", url: "https://www.bing.com/search?q=%22{username}%22" },
      { label: "DuckDuckGo: username", url: "https://duckduckgo.com/?q=%22{username}%22" },
      { label: "Yandex: username", url: "https://yandex.com/search/?text=%22{username}%22" }
    ]},
    { cat: "Social Platforms", items: [
      { label: "Instagram: @{username}", url: "https://www.instagram.com/{username}/" },
      { label: "TikTok: @{username}", url: "https://www.tiktok.com/@{username}" },
      { label: "X (Twitter): @{username}", url: "https://x.com/{username}" },
      { label: "Reddit user", url: "https://www.reddit.com/user/{username}/" },
      { label: "GitHub user", url: "https://github.com/{username}" },
      { label: "YouTube search: username", url: "https://www.youtube.com/results?search_query={username}" },
      { label: "Facebook search: name", url: "https://www.facebook.com/search/top?q={name}" },
      { label: "LinkedIn search: name", url: "https://www.linkedin.com/search/results/all/?keywords={name}" }
    ]},
    { cat: "Email / Identity (general discovery)", items: [
      { label: "Google: email + breach keyword (general)", url: "https://www.google.com/search?q=%22{email}%22+breach" },
      { label: "Google: email + paste", url: "https://www.google.com/search?q=%22{email}%22+paste" },
      { label: "Google: username + email", url: "https://www.google.com/search?q=%22{username}%22+%22{email}%22" }
    ]},
    { cat: "Domain Intel", items: [
      { label: "SecurityTrails (domain)", url: "https://securitytrails.com/domain/{domain}/dns" },
      { label: "crt.sh (cert search)", url: "https://crt.sh/?q=%25.{domain}" },
      { label: "Wayback: domain", url: "https://web.archive.org/web/*/{domain}/*" },
      { label: "BuiltWith", url: "https://builtwith.com/{domain}" }
    ]},
    { cat: "IP / Network Intel", items: [
      { label: "Shodan (ip)", url: "https://www.shodan.io/host/{ip}" },
      { label: "Censys (ip)", url: "https://search.censys.io/search?resource=hosts&q={ip}" },
      { label: "AbuseIPDB", url: "https://www.abuseipdb.com/check/{ip}" },
      { label: "IPinfo", url: "https://ipinfo.io/{ip}" }
    ]},
    { cat: "Images / Reverse Search", items: [
      { label: "Google Images", url: "https://images.google.com/" },
      { label: "TinEye", url: "https://tineye.com/" },
      { label: "Yandex Images", url: "https://yandex.com/images/" },
      { label: "Bing Visual Search", url: "https://www.bing.com/visualsearch" }
    ]},
    { cat: "Advanced Dorks (careful + legit)", items: [
      { label: "site:{domain} intitle:index.of", url: "https://www.google.com/search?q=site%3A{domain}+intitle%3A%22index+of%22" },
      { label: "site:{domain} ext:log", url: "https://www.google.com/search?q=site%3A{domain}+filetype%3Alog" },
      { label: "site:{domain} ext:bak", url: "https://www.google.com/search?q=site%3A{domain}+filetype%3Abak" },
      { label: "site:{domain} swagger", url: "https://www.google.com/search?q=site%3A{domain}+swagger" },
      { label: "site:{domain} graphql", url: "https://www.google.com/search?q=site%3A{domain}+graphql" }
    ]}
  ];

  // ensure 50+ by adding a small bonus pack
  OSINT_LIBRARY.push({
    cat: "Bonus",
    items: [
      { label: "Google: username + scam", url: "https://www.google.com/search?q=%22{username}%22+scam" },
      { label: "Google: email + invoice", url: "https://www.google.com/search?q=%22{email}%22+invoice" },
      { label: "Google: phone + WhatsApp", url: "https://www.google.com/search?q=%22{phone}%22+WhatsApp" },
      { label: "GitHub code search: username", url: "https://github.com/search?q={username}&type=code" },
      { label: "Pastebin via Google", url: "https://www.google.com/search?q=site%3Apastebin.com+%22{email}%22" },
      { label: "Google: site:{domain} login", url: "https://www.google.com/search?q=site%3A{domain}+login" },
      { label: "Google: site:{domain} admin", url: "https://www.google.com/search?q=site%3A{domain}+admin" },
      { label: "Google: {domain} api_key", url: "https://www.google.com/search?q=site%3A{domain}+%22api_key%22" }
    ]
  });

  // lightweight MD5 for non-security uses (gravatar-ish)
  function md5(str) {
    function rrot(n, c) { return (n << c) | (n >>> (32 - c)); }
    function tohex(n) { let s = "", v; for (let i = 0; i < 4; i++) { v = (n >>> (i * 8)) & 255; s += ("0" + v.toString(16)).slice(-2); } return s; }
    function cmn(q, a, b, x, s, t) { return rrot((a + q + x + t) | 0, s) + b | 0; }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

    const msg = unescape(encodeURIComponent(str));
    const n = msg.length;
    const words = [];
    for (let i = 0; i < n; i++) words[i >> 2] |= msg.charCodeAt(i) << ((i % 4) * 8);
    words[n >> 2] |= 0x80 << ((n % 4) * 8);
    words[(((n + 8) >> 6) << 4) + 14] = n * 8;

    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < words.length; i += 16) {
      const oa = a, ob = b, oc = c, od = d;

      a = ff(a, b, c, d, words[i+0]||0, 7, -680876936);
      d = ff(d, a, b, c, words[i+1]||0, 12, -389564586);
      c = ff(c, d, a, b, words[i+2]||0, 17, 606105819);
      b = ff(b, c, d, a, words[i+3]||0, 22, -1044525330);
      a = ff(a, b, c, d, words[i+4]||0, 7, -176418897);
      d = ff(d, a, b, c, words[i+5]||0, 12, 1200080426);
      c = ff(c, d, a, b, words[i+6]||0, 17, -1473231341);
      b = ff(b, c, d, a, words[i+7]||0, 22, -45705983);
      a = ff(a, b, c, d, words[i+8]||0, 7, 1770035416);
      d = ff(d, a, b, c, words[i+9]||0, 12, -1958414417);
      c = ff(c, d, a, b, words[i+10]||0, 17, -42063);
      b = ff(b, c, d, a, words[i+11]||0, 22, -1990404162);
      a = ff(a, b, c, d, words[i+12]||0, 7, 1804603682);
      d = ff(d, a, b, c, words[i+13]||0, 12, -40341101);
      c = ff(c, d, a, b, words[i+14]||0, 17, -1502002290);
      b = ff(b, c, d, a, words[i+15]||0, 22, 1236535329);

      a = gg(a, b, c, d, words[i+1]||0, 5, -165796510);
      d = gg(d, a, b, c, words[i+6]||0, 9, -1069501632);
      c = gg(c, d, a, b, words[i+11]||0, 14, 643717713);
      b = gg(b, c, d, a, words[i+0]||0, 20, -373897302);
      a = gg(a, b, c, d, words[i+5]||0, 5, -701558691);
      d = gg(d, a, b, c, words[i+10]||0, 9, 38016083);
      c = gg(c, d, a, b, words[i+15]||0, 14, -660478335);
      b = gg(b, c, d, a, words[i+4]||0, 20, -405537848);
      a = gg(a, b, c, d, words[i+9]||0, 5, 568446438);
      d = gg(d, a, b, c, words[i+14]||0, 9, -1019803690);
      c = gg(c, d, a, b, words[i+3]||0, 14, -187363961);
      b = gg(b, c, d, a, words[i+8]||0, 20, 1163531501);
      a = gg(a, b, c, d, words[i+13]||0, 5, -1444681467);
      d = gg(d, a, b, c, words[i+2]||0, 9, -51403784);
      c = gg(c, d, a, b, words[i+7]||0, 14, 1735328473);
      b = gg(b, c, d, a, words[i+12]||0, 20, -1926607734);

      a = hh(a, b, c, d, words[i+5]||0, 4, -378558);
      d = hh(d, a, b, c, words[i+8]||0, 11, -2022574463);
      c = hh(c, d, a, b, words[i+11]||0, 16, 1839030562);
      b = hh(b, c, d, a, words[i+14]||0, 23, -35309556);
      a = hh(a, b, c, d, words[i+1]||0, 4, -1530992060);
      d = hh(d, a, b, c, words[i+4]||0, 11, 1272893353);
      c = hh(c, d, a, b, words[i+7]||0, 16, -155497632);
      b = hh(b, c, d, a, words[i+10]||0, 23, -1094730640);
      a = hh(a, b, c, d, words[i+13]||0, 4, 681279174);
      d = hh(d, a, b, c, words[i+0]||0, 11, -358537222);
      c = hh(c, d, a, b, words[i+3]||0, 16, -722521979);
      b = hh(b, c, d, a, words[i+6]||0, 23, 76029189);
      a = hh(a, b, c, d, words[i+9]||0, 4, -640364487);
      d = hh(d, a, b, c, words[i+12]||0, 11, -421815835);
      c = hh(c, d, a, b, words[i+15]||0, 16, 530742520);
      b = hh(b, c, d, a, words[i+2]||0, 23, -995338651);

      a = ii(a, b, c, d, words[i+0]||0, 6, -198630844);
      d = ii(d, a, b, c, words[i+7]||0, 10, 1126891415);
      c = ii(c, d, a, b, words[i+14]||0, 15, -1416354905);
      b = ii(b, c, d, a, words[i+5]||0, 21, -57434055);
      a = ii(a, b, c, d, words[i+12]||0, 6, 1700485571);
      d = ii(d, a, b, c, words[i+3]||0, 10, -1894986606);
      c = ii(c, d, a, b, words[i+10]||0, 15, -1051523);
      b = ii(b, c, d, a, words[i+1]||0, 21, -2054922799);
      a = ii(a, b, c, d, words[i+8]||0, 6, 1873313359);
      d = ii(d, a, b, c, words[i+15]||0, 10, -30611744);
      c = ii(c, d, a, b, words[i+6]||0, 15, -1560198380);
      b = ii(b, c, d, a, words[i+13]||0, 21, 1309151649);
      a = ii(a, b, c, d, words[i+4]||0, 6, -145523070);
      d = ii(d, a, b, c, words[i+11]||0, 10, -1120210379);
      c = ii(c, d, a, b, words[i+2]||0, 15, 718787259);
      b = ii(b, c, d, a, words[i+9]||0, 21, -343485551);

      a = (a + oa) | 0;
      b = (b + ob) | 0;
      c = (c + oc) | 0;
      d = (d + od) | 0;
    }
    return (tohex(a) + tohex(b) + tohex(c) + tohex(d));
  }

  function renderOsintCategories() {
    osintCategory.innerHTML = "";
    OSINT_LIBRARY.forEach((c, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${c.cat} (${c.items.length})`;
      osintCategory.appendChild(o);
    });
  }

  function buildVars() {
    const email = escapeLine(inEmail.value).trim();
    return {
      username: encodeURIComponent(escapeLine(inUsername.value).trim()),
      email: encodeURIComponent(email),
      phone: encodeURIComponent(escapeLine(inPhone.value).trim()),
      name: encodeURIComponent(escapeLine(inName.value).trim()),
      domain: encodeURIComponent(escapeLine(inDomain.value).trim()),
      ip: encodeURIComponent(escapeLine(inIP.value).trim()),
      email_md5: md5(email.trim().toLowerCase())
    };
  }

  function templateUrl(u, vars) {
    return u.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  }

  function generateOsintLinks() {
    osintLinksEl.innerHTML = "";
    const cat = OSINT_LIBRARY[Number(osintCategory.value) || 0];
    const vars = buildVars();

    const items = cat.items.map(x => ({
      label: x.label,
      url: templateUrl(x.url, vars)
    }));

    items.forEach((x) => {
      const it = document.createElement("div");
      it.className = "item";

      const row = document.createElement("div");
      row.className = "row gap";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;

      const label = document.createElement("div");
      label.className = "grow";
      label.textContent = x.label;

      const openBtn = document.createElement("button");
      openBtn.className = "btn ghost";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => safeOpen(x.url));

      row.appendChild(cb);
      row.appendChild(label);
      row.appendChild(openBtn);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.appendChild(spanMeta(x.url));

      it.appendChild(row);
      it.appendChild(meta);

      it.dataset.url = x.url;
      it.dataset.checked = "1";

      cb.addEventListener("change", () => {
        it.dataset.checked = cb.checked ? "1" : "0";
        osintCount.textContent = `${selectedOsintUrls().length} selected`;
      });

      osintLinksEl.appendChild(it);
    });

    osintCount.textContent = `${items.length} links`;
    Toasts.push({ title: "OSINT", message: `Generated ${items.length} links.` });
  }

  function selectedOsintUrls() {
    return $$(".item", osintLinksEl)
      .filter(el => el.dataset.checked === "1")
      .map(el => el.dataset.url)
      .filter(Boolean);
  }

  async function saveOsintRun() {
    if (!AppState.activeCaseId) {
      Toasts.push({ title: "OSINT", message: "Set an active case first." });
      return;
    }
    const urls = selectedOsintUrls();
    if (!urls.length) {
      Toasts.push({ title: "OSINT", message: "No links selected." });
      return;
    }
    await Store.osintSaveForCase(AppState.activeCaseId, {
      category: OSINT_LIBRARY[Number(osintCategory.value) || 0].cat,
      inputs: {
        username: escapeLine(inUsername.value),
        email: escapeLine(inEmail.value),
        phone: escapeLine(inPhone.value),
        name: escapeLine(inName.value),
        domain: escapeLine(inDomain.value),
        ip: escapeLine(inIP.value)
      },
      urls
    });
    Toasts.push({ title: "OSINT", message: "Saved to case history." });
  }

  // =========================
  // Utilities
  // =========================
  const tsInput = $("#tsInput");
  const tsOutput = $("#tsOutput");
  const btnTsConvert = $("#btnTsConvert");
  const btnTsNow = $("#btnTsNow");

  function convertTimestamp() {
    const raw = (tsInput.value || "").trim();
    if (!raw) return;
    let d = null;

    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      d = raw.length <= 10 ? new Date(n * 1000) : new Date(n);
    } else {
      const t = Date.parse(raw);
      if (!Number.isNaN(t)) d = new Date(t);
    }

    if (!d || Number.isNaN(d.getTime())) {
      tsOutput.textContent = "Invalid timestamp.";
      return;
    }

    const out = {
      local: d.toString(),
      iso: d.toISOString(),
      epochSeconds: Math.floor(d.getTime() / 1000),
      epochMs: d.getTime()
    };
    tsOutput.textContent = JSON.stringify(out, null, 2);
  }

  const hashInput = $("#hashInput");
  const hashOutput = $("#hashOutput");
  const btnHash = $("#btnHash");
  const btnHashClear = $("#btnHashClear");

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function doHash() {
    const text = hashInput.value || "";
    const sha = await sha256Hex(text);
    const m = md5(text);
    hashOutput.textContent = JSON.stringify({ sha256: sha, md5: m }, null, 2);
  }

  const urlInput = $("#urlInput");
  const urlOutput = $("#urlOutput");
  const btnUrlClean = $("#btnUrlClean");
  const btnUrlCopy = $("#btnUrlCopy");

  function cleanUrl() {
    const raw = (urlInput.value || "").trim();
    if (!raw) return;
    try {
      const u = new URL(raw);
      const bad = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","fbclid","mc_cid","mc_eid","igshid","ref","ref_src","spm"];
      bad.forEach(k => u.searchParams.delete(k));
      urlOutput.textContent = u.toString();
      Toasts.push({ title: "URL", message: "Cleaned." });
    } catch {
      urlOutput.textContent = "Invalid URL.";
    }
  }

  const cidrInput = $("#cidrInput");
  const cidrOutput = $("#cidrOutput");
  const btnCidr = $("#btnCidr");
  const btnCidrClear = $("#btnCidrClear");

  function ipToInt(ip) {
    const parts = ip.split(".").map(x => Number(x));
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }
  function intToIp(n) {
    return [(n >>> 24) & 255,(n >>> 16) & 255,(n >>> 8) & 255,n & 255].join(".");
  }

  function calcCidr() {
    const raw = (cidrInput.value || "").trim();
    const m = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    if (!m) { cidrOutput.textContent = "Invalid format."; return; }
    const ip = m[1];
    const prefix = Number(m[2]);
    if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) { cidrOutput.textContent = "Invalid prefix."; return; }

    const ipInt = ipToInt(ip);
    if (ipInt === null) { cidrOutput.textContent = "Invalid IP."; return; }

    const mask = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
    const network = ipInt & mask;
    const broadcast = (network | (~mask >>> 0)) >>> 0;

    const firstHost = prefix >= 31 ? network : (network + 1) >>> 0;
    const lastHost = prefix >= 31 ? broadcast : (broadcast - 1) >>> 0;
    const hosts = prefix >= 31 ? (prefix === 31 ? 2 : 1) : (broadcast - network - 1);

    cidrOutput.textContent = JSON.stringify({
      ip,
      prefix,
      mask: intToIp(mask >>> 0),
      network: intToIp(network >>> 0),
      broadcast: intToIp(broadcast >>> 0),
      firstHost: intToIp(firstHost),
      lastHost: intToIp(lastHost),
      usableHosts: hosts
    }, null, 2);
  }

  // =========================
  // Command Palette (Ctrl/⌘+K)
  // =========================
  const cmdk = $("#cmdk");
  const cmdkInput = $("#cmdkInput");
  const cmdkList = $("#cmdkList");
  const btnCmd = $("#btnCmd");

  const Commands = [
    { name: "Go: Dashboard", kbd: "G D", run: () => nav("dashboard") },
    { name: "Go: Cases", kbd: "G C", run: () => nav("cases") },
    { name: "Go: Reports", kbd: "G R", run: () => nav("reports") },
    { name: "Go: OSINT Launcher", kbd: "G O", run: () => nav("osint") },
    { name: "Go: Utilities", kbd: "G U", run: () => nav("utils") },
    { name: "New: Case", kbd: "N C", run: () => createCaseModal() },
    { name: "New: Report (active case)", kbd: "N R", run: () => createNewReport() },
    { name: "Export: Bundle", kbd: "E B", run: () => exportAll() }
  ];

  function openCmdk() {
    cmdk.hidden = false;
    cmdkInput.value = "";
    renderCmdk("");
    cmdkInput.focus();
  }
  function closeCmdk() { cmdk.hidden = true; }
  function renderCmdk(q) {
    cmdkList.innerHTML = "";
    const query = (q || "").toLowerCase();
    const list = Commands.filter(c => c.name.toLowerCase().includes(query)).slice(0, 12);
    list.forEach(c => {
      const it = document.createElement("div");
      it.className = "cmdk-item";
      const name = document.createElement("div");
      name.textContent = c.name;
      const k = document.createElement("div");
      k.className = "cmdk-kbd";
      k.textContent = c.kbd || "";
      it.appendChild(name);
      it.appendChild(k);
      it.addEventListener("click", () => { closeCmdk(); c.run(); });
      cmdkList.appendChild(it);
    });
  }

  // =========================
  // Settings: Export/Import + workspace controls
  // =========================
  const settingsWorkspaceText = $("#settingsWorkspaceText");
  const btnRePickWorkspace = $("#btnRePickWorkspace");
  const btnForgetWorkspace = $("#btnForgetWorkspace");
  const btnExportAll = $("#btnExportAll");
  const fileImport = $("#fileImport");
  const btnExport = $("#tileExport");

  async function exportAll() {
    const payload = await Store.exportBundle();
    exportJSONDownload(`SINNERS_export_${Date.now()}.json`, payload);
    Toasts.push({ title: "Export", message: "Bundle downloaded." });
  }

  async function importAllFromFile(file) {
    const text = await file.text();
    const payload = JSON.parse(text);
    await Store.importBundle(payload);
    Toasts.push({ title: "Import", message: "Bundle imported." });
    await refreshAll();
  }

  async function refreshAll() {
    updateWorkspaceBadge();
    await renderDashboard();
    await renderCases();
  }

  async function updateWorkspaceBadge() {
    const badge = $("#workspaceBadge");
    const s = Store.state.mode === "workspace" ? "Workspace (Drive)" : "Fallback (IndexedDB)";
    badge.textContent = `Storage: ${s}`;
    settingsWorkspaceText.textContent =
      Store.state.mode === "workspace"
        ? "Workspace mode active. Data is stored as files/folders in your chosen directory."
        : "Fallback mode active. Data is stored in browser IndexedDB. Use Export/Import for portability.";
  }

  // =========================
  // Navigation + Global Search
  // =========================
  function nav(route) {
    AppState.activeRoute = route;
    showPage(route);
  }

  const globalSearch = $("#globalSearch");
  async function doGlobalSearch(q) {
    const query = (q || "").trim().toLowerCase();
    if (!query) return;

    const cases = await Store.caseList();
    const cHit = cases.find(c => (`${c.caseNumber||""} ${c.title||""} ${(c.tags||[]).join(" ")} ${c.caseId}`).toLowerCase().includes(query));

    if (cHit) {
      nav("cases");
      AppState.selectedCaseId = cHit.caseId;
      await openCase(cHit.caseId);
      await renderCases();
      Toasts.push({ title: "Search", message: `Opened case: ${cHit.title}` });
      return;
    }

    const reps = await Store.reportListAllSlim();
    const rHit = reps.find(r => (`${r.reportNumber||""} ${r.reportId} ${r.caseId}`).toLowerCase().includes(query));
    if (rHit) {
      try {
        const r = await Store.reportGet(rHit.reportId, rHit.caseId);
        await loadReportDraft(r);
        await setActiveCase(rHit.caseId);
        nav("reports");
        Toasts.push({ title: "Search", message: `Opened report: ${rHit.reportNumber || rHit.reportId}` });
        return;
      } catch {}
    }

    const agenda = await Store.agendaGetAll();
    const aHit = agenda.find(a => (`${a.title} ${a.body} ${(a.tags||[]).join(" ")}`).toLowerCase().includes(query));
    if (aHit) {
      nav("dashboard");
      Toasts.push({ title: "Search", message: "Match found in agenda." });
      return;
    }

    Toasts.push({ title: "Search", message: "No matches." });
  }

  // =========================
  // Boot sequence
  // =========================
  async function boot() {
    showView("splash");
    await seedIfEmpty();
    await sleep(750);

    const wantedMode = await Store.loadMode();

    if (wantedMode === "workspace" && Workspace.supported()) {
      const res = await Workspace.initFromSaved();
      if (res.ok) {
        await Store.setModeWorkspace(res.handle);
      } else {
        await DB.set("settings", "storageMode", "unknown");
      }
    } else if (wantedMode === "idb") {
      await Store.setModeIDB();
    }

    if (Store.state.mode === "unknown") {
      showView("setup");
      await setupInit();
      return;
    }

    showView("login");
    if (Auth.isLoggedIn()) {
      await enterApp();
    }
  }

  async function enterApp() {
    showView("app");
    nav("dashboard");

    AppState.activeCaseId = await DB.get("settings", "activeCaseId");
    updateActiveCasePill();
    await updateWorkspaceBadge();

    renderOsintCategories();
    await refreshAll();

    await ensureReportNumberField();
    await loadReportDraft({
      reportId: null,
      reportNumber: "",
      caseId: AppState.activeCaseId || null,
      caseNumber: await getActiveCaseNumber(),
      type: "OSINT Lead",
      reason: "Threat Assessment",
      confidence: "Medium",
      scope: "",
      summary: "",
      methods: "",
      findings: "",
      nextSteps: "",
      evidence: [],
      createdAt: nowISO()
    });
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // =========================
  // Event wiring
  // =========================
  function wire() {
    // Setup
    btnSelectWorkspace.addEventListener("click", setupChooseWorkspace);
    btnUseFallback.addEventListener("click", setupUseFallback);

    // Login
    btnBackToSetup.addEventListener("click", () => showView("setup"));
    btnTogglePass.addEventListener("click", () => { loginPass.type = loginPass.type === "password" ? "text" : "password"; });
    loginPass.addEventListener("keydown", capsLockCheck);
    loginUser.addEventListener("keydown", capsLockCheck);

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setLoginError("");

      const u = (loginUser.value || "").trim();
      const p = (loginPass.value || "").trim();

      const ok = Auth.login(u, p);
      if (!ok) {
        setLoginError("Invalid credentials.");
        Toasts.push({ title: "Login", message: "Denied." });
        return;
      }

      Toasts.push({ title: "Access Granted", message: "Welcome, Admin." });
      await Store.auditAppend({ type: "auth.login", msg: "Admin logged in" });
      await enterApp();
    });

    // Sidebar nav
    $$(".nav-item").forEach(b => b.addEventListener("click", () => nav(b.dataset.route)));

    // Logout
    $("#btnLogout").addEventListener("click", async () => {
      Auth.logout();
      Toasts.push({ title: "Logged out", message: "Session cleared." });
      showView("login");
    });

    // Dashboard actions
    btnNewAgenda.addEventListener("click", newAgendaModal);
    btnRefreshDash.addEventListener("click", renderDashboard);

    tileNewCase.addEventListener("click", () => { nav("cases"); createCaseModal(); });
    tileNewReport.addEventListener("click", () => createNewReport());
    tileOsint.addEventListener("click", () => nav("osint"));
    tileExport.addEventListener("click", exportAll);

    // Top quick actions
    $("#btnQuickNewCase").addEventListener("click", () => { nav("cases"); createCaseModal(); });
    $("#btnQuickNewReport").addEventListener("click", () => createNewReport());

    // Cases
    btnCreateCase.addEventListener("click", createCaseModal);
    btnReloadCases.addEventListener("click", renderCases);
    caseFilter.addEventListener("input", renderCases);
    caseStatusFilter.addEventListener("change", renderCases);
    btnCaseSave.addEventListener("click", saveSelectedCase);

    btnCaseSetActive.addEventListener("click", async () => {
      if (!AppState.selectedCaseId) return;
      await setActiveCase(AppState.selectedCaseId);
    });

    btnCaseNewReport.addEventListener("click", async () => {
      if (!AppState.selectedCaseId) return;
      await setActiveCase(AppState.selectedCaseId);
      await createNewReport(AppState.selectedCaseId);
    });

    btnCaseExport.addEventListener("click", async () => {
      if (!AppState.selectedCaseId) return;
      const c = await Store.caseGet(AppState.selectedCaseId);
      exportJSONDownload(`case_${c.caseNumber || c.caseId}.json`, c);
      Toasts.push({ title: "Export", message: "Case JSON downloaded." });
    });

    // Reports
    btnCreateReport.addEventListener("click", () => createNewReport());
    btnLoadReport.addEventListener("click", openReportModal);
    btnSaveReport.addEventListener("click", saveReport);

    btnExportReportJson.addEventListener("click", () => {
      const r = currentReportDraft();
      if (!r.reportId) { Toasts.push({ title: "Report", message: "No report loaded." }); return; }

      // if redaction on, mask free-text fields in export
      const out = AppState.redaction ? {
        ...r,
        scope: redactIfNeeded(r.scope),
        summary: redactIfNeeded(r.summary),
        methods: redactIfNeeded(r.methods),
        findings: redactIfNeeded(r.findings),
        nextSteps: redactIfNeeded(r.nextSteps),
        evidence: (r.evidence || []).map(ev => ({
          ...ev,
          label: redactIfNeeded(ev.label),
          sourceUrl: redactIfNeeded(ev.sourceUrl),
          notes: redactIfNeeded(ev.notes),
          collectedBy: redactIfNeeded(ev.collectedBy)
        }))
      } : r;

      exportJSONDownload(`report_${r.reportNumber || r.reportId}.json`, out);
      Toasts.push({ title: "Export", message: "Report JSON downloaded." });
    });

    btnPrintPdf.addEventListener("click", async () => {
      Toasts.push({ title: "PDF", message: "Use the print dialog → Save as PDF." });
      window.print();
    });

    btnAddEvidence.addEventListener("click", addEvidenceModal);

    toggleRedaction.addEventListener("change", () => {
      AppState.redaction = !!toggleRedaction.checked;
      const r = currentReportDraft();
      loadReportDraft(r);
      Toasts.push({ title: "Redaction", message: AppState.redaction ? "ON" : "OFF" });
    });

    // OSINT
    btnGenerateOsint.addEventListener("click", generateOsintLinks);
    btnSelectAllOsint.addEventListener("click", () => {
      $$(".item", osintLinksEl).forEach(el => {
        el.dataset.checked = "1";
        el.querySelector("input[type=checkbox]").checked = true;
      });
      osintCount.textContent = `${selectedOsintUrls().length} selected`;
    });
    btnClearOsint.addEventListener("click", () => {
      osintLinksEl.innerHTML = "";
      osintCount.textContent = "0 links";
    });
    btnRunOsint.addEventListener("click", () => {
      const urls = selectedOsintUrls();
      if (!urls.length) { Toasts.push({ title: "OSINT", message: "No links selected." }); return; }
      urls.slice(0, 20).forEach(u => safeOpen(u));
      if (urls.length > 20) Toasts.push({ title: "OSINT", message: "Opened first 20 tabs (anti-chaos guard)." });
    });
    btnSaveOsintHistory.addEventListener("click", saveOsintRun);

    // Utilities
    btnTsConvert.addEventListener("click", convertTimestamp);
    btnTsNow.addEventListener("click", () => { tsInput.value = nowISO(); convertTimestamp(); });
    btnHash.addEventListener("click", doHash);
    btnHashClear.addEventListener("click", () => { hashInput.value = ""; hashOutput.textContent = ""; });
    btnUrlClean.addEventListener("click", cleanUrl);
    btnUrlCopy.addEventListener("click", async () => {
      const t = urlOutput.textContent || "";
      if (!t) return;
      try {
        await navigator.clipboard.writeText(t);
        Toasts.push({ title: "URL", message: "Copied." });
      } catch {
        Toasts.push({ title: "URL", message: "Copy failed (browser permissions)." });
      }
    });
    btnCidr.addEventListener("click", calcCidr);
    btnCidrClear.addEventListener("click", () => { cidrInput.value = ""; cidrOutput.textContent = ""; });

    // Settings
    btnRePickWorkspace.addEventListener("click", async () => {
      showView("setup");
      await setupInit();
      Toasts.push({ title: "Workspace", message: "Reconfigure workspace." });
    });

    btnForgetWorkspace.addEventListener("click", async () => {
      await Workspace.forgetHandle();
      await DB.set("settings", "storageMode", "unknown");
      Toasts.push({ title: "Workspace", message: "Forgot workspace handle." });
      showView("setup");
      await setupInit();
    });

    btnExportAll.addEventListener("click", exportAll);

    fileImport.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        await importAllFromFile(f);
      } catch (err) {
        Toasts.push({ title: "Import", message: `Failed: ${String(err?.message || err)}` });
      } finally {
        fileImport.value = "";
      }
    });

    // Global search
    globalSearch.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") await doGlobalSearch(globalSearch.value);
    });

    // Command palette
    btnCmd.addEventListener("click", openCmdk);
    cmdkInput.addEventListener("input", () => renderCmdk(cmdkInput.value));
    document.addEventListener("keydown", (e) => {
      const metaK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (metaK) {
        // Only allow CmdK when app view is visible
        if (Views.app.getAttribute("aria-hidden") === "false") {
          e.preventDefault();
          openCmdk();
        }
      }
      if (e.key === "Escape") {
        if (!cmdk.hidden) closeCmdk();
        Modal.close();
      }
    });
    cmdk.addEventListener("click", (e) => { if (e.target === cmdk) closeCmdk(); });

    // Print: hide cmdk/modals if open
    window.addEventListener("beforeprint", () => { closeCmdk(); Modal.close(); });
  }

  // =========================
  // Service Worker (optional)
  // =========================
  async function registerSW() {
    try {
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.register("./sw.js");
      }
    } catch {
      // silent
    }
  }

  // =========================
  // Start
  // =========================
  wire();
  registerSW();
  boot();

})();