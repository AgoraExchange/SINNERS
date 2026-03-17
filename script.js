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
    "Jgarcia": "Admin!:",   // <-- new user
    "Ctorres": "Admin!@:",   // <-- new user
    "Dmazzulla": "ADMIN!!:"   // <-- new user
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

  /* =========================================================
   WORKSPACE PATCH — add missing methods used by add-ons
   Paste ABOVE the Notes/Evidence add-on block
   ========================================================= */
(() => {
  if (typeof Workspace === "undefined") return;

  // Add listEntries if missing
  if (typeof Workspace.listEntries !== "function") {
    Workspace.listEntries = async (dirHandle) => {
      const out = { files: [], dirs: [] };
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === "file") out.files.push(name);
        else if (handle.kind === "directory") out.dirs.push(name);
      }
      out.files.sort();
      out.dirs.sort();
      return out;
    };
  }

  // Add writeFile if missing
  if (typeof Workspace.writeFile !== "function") {
    Workspace.writeFile = async (dirHandle, filename, blobOrText, mime = "") => {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      if (blobOrText instanceof Blob) {
        await writable.write(blobOrText);
      } else {
        await writable.write(new Blob([String(blobOrText ?? "")], { type: mime || "text/plain" }));
      }
      await writable.close();
      return filename;
    };
  }

  // Add readFile if missing
  if (typeof Workspace.readFile !== "function") {
    Workspace.readFile = async (dirHandle, filename) => {
      const fileHandle = await dirHandle.getFileHandle(filename);
      return await fileHandle.getFile();
    };
  }
})();

    // =========================================================
  // NOTES + EVIDENCE ADD-ON (paste above the final "})();")
  // Works with:
  // - Workspace Mode: writes to /notes and /evidence folders
  // - Fallback Mode: uses existing IndexedDB stores (no DB version bump)
  // =========================================================
  (() => {
    // ---------- Guard: pages must exist ----------
    const pageNotes = $("#page-notes");
    const pageEvidence = $("#page-evidence");
    if (!pageNotes || !pageEvidence) return;

    // Extend Pages map so showPage() can toggle them
    try {
      Pages.notes = pageNotes;
      Pages.evidence = pageEvidence;
    } catch (_) {}

    // ---------- Helpers ----------
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const safeText = (s, max = 200000) => String(s ?? "").replace(/\r/g, "").slice(0, max);
    const csvTags = (s) => String(s || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 50);

    function sanitizeFolderName(name, maxLen = 64) {
      const raw = String(name || "").trim();
      if (!raw) return "";
      const safe = raw
        .replace(/[\\/\x00-\x1F\x7F]+/g, "_")
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._\-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
      return safe.slice(0, maxLen) || "bag";
    }

    function sanitizeFilename(name, maxLen = 120) {
      const raw = String(name || "file").trim() || "file";
      const cleaned = raw
        .replace(/[\\/\x00-\x1F\x7F]+/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[^a-zA-Z0-9 ._\-()\[\]]/g, "_");
      return cleaned.slice(0, maxLen) || "file";
    }

    async function ensureDir(rootHandle, name) {
      // Workspace.dir() already creates directories, but notes/evidence weren't in the original ensureStructure list.
      return await Workspace.dir(rootHandle, name);
    }

    /* =========================================================
   NOTES: OPEN EXISTING (imports a JSON note file)
   Replaces btnOpenNote behavior with file picker import
   ========================================================= */
(() => {
  const btn = document.getElementById("btnOpenNote");
  if (!btn) return;

  // Replace listeners by cloning
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);

  // Hidden file input
  let inp = document.getElementById("noteImportFile");
  if (!inp) {
    inp = document.createElement("input");
    inp.type = "file";
    inp.id = "noteImportFile";
    inp.accept = "application/json";
    inp.hidden = true;
    document.body.appendChild(inp);
  }

  function toast(title, message) {
    try { Toasts.push({ title, message }); }
    catch { alert(`${title}\n\n${message}`); }
  }

  async function readJSON(file) {
    return JSON.parse(await file.text());
  }

  // Minimal “save note” that matches YOUR add-on storage (cases store in IDB)
  async function saveNote(note) {
    if (typeof Store !== "undefined" && Store?.state?.mode === "workspace") {
      const notesDir = await Workspace.dir(Store.state.rootHandle, "notes");
      await Workspace.writeJSON(notesDir, `${note.noteId}.json`, note);
      return;
    }
    // fallback IDB (your add-on uses cases store for notes)
    await DB.set("cases", `note:${note.noteId}`, note);
  }

  clone.textContent = "Open Existing";

  clone.addEventListener("click", () => inp.click());

  inp.addEventListener("change", async () => {
    try {
      const f = inp.files?.[0];
      inp.value = "";
      if (!f) return;

      const raw = await readJSON(f);
      const payload = raw?.payload ? raw.payload : raw; // supports wrapped exports or raw notes
      if (!payload || typeof payload !== "object") throw new Error("Invalid note JSON.");

      payload.noteId = payload.noteId || `note_${Date.now()}`;
      payload.createdAt = payload.createdAt || new Date().toISOString();
      payload.updatedAt = payload.updatedAt || new Date().toISOString();

      await saveNote(payload);

      toast("Notes", "Imported. Refreshing list…");

      // If your add-on overwrote nav(), switching to notes will force render
      if (typeof nav === "function") nav("notes");
    } catch (e) {
      toast("Import Error", String(e?.message || e));
    }
  });
})();

    // ==============
    // NOTES STORAGE
    // ==============
    // Fallback uses existing object store "cases" to avoid DB version bump:
    // keys: "note:<id>" and "notes:index"
    const NOTE_STORE = "cases";
    const NOTE_INDEX_KEY = "notes:index";

    async function notes_index_get() {
      return (await DB.get(NOTE_STORE, NOTE_INDEX_KEY)) || [];
    }
    async function notes_index_set(list) {
      await DB.set(NOTE_STORE, NOTE_INDEX_KEY, list);
    }

    async function notes_list() {
      if (Store.state.mode === "workspace") {
        const notesDir = await ensureDir(Store.state.rootHandle, "notes");
        const files = await Workspace.listFiles(notesDir);
        const jsons = files.filter(f => f.endsWith(".json") && f !== "_index.json");

        // If index exists, use it; else build a slim list (fast enough for normal sizes)
        try {
          const idx = await Workspace.readJSON(notesDir, "_index.json");
          if (Array.isArray(idx)) return idx;
        } catch {}

        const out = [];
        for (const fn of jsons.slice(0, 2000)) {
          try {
            const n = await Workspace.readJSON(notesDir, fn);
            out.push({
              noteId: n.noteId,
              title: n.title || "Untitled",
              category: n.category || "Other",
              tags: Array.isArray(n.tags) ? n.tags : [],
              caseId: n.caseId || "",
              caseNumber: n.caseNumber || "",
              createdAt: n.createdAt || "",
              updatedAt: n.updatedAt || "",
              createdBy: n.createdBy || ""
            });
          } catch {}
        }
        out.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
        // best effort index write
        try { await Workspace.writeJSON(notesDir, "_index.json", out); } catch {}
        return out;
      }

      // Fallback
      const idx = await notes_index_get();
      if (Array.isArray(idx) && idx.length) return idx;

      // No index yet: scan keys in NOTE_STORE
      const keys = await DB.keys(NOTE_STORE);
      const out = [];
      for (const k of keys) {
        if (String(k).startsWith("note:")) {
          const n = await DB.get(NOTE_STORE, k);
          if (n) {
            out.push({
              noteId: n.noteId,
              title: n.title || "Untitled",
              category: n.category || "Other",
              tags: Array.isArray(n.tags) ? n.tags : [],
              caseId: n.caseId || "",
              caseNumber: n.caseNumber || "",
              createdAt: n.createdAt || "",
              updatedAt: n.updatedAt || "",
              createdBy: n.createdBy || ""
            });
          }
        }
      }
      out.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
      await notes_index_set(out);
      return out;
    }

    async function notes_get(noteId) {
      if (Store.state.mode === "workspace") {
        const notesDir = await ensureDir(Store.state.rootHandle, "notes");
        return await Workspace.readJSON(notesDir, `${noteId}.json`);
      }
      return await DB.get(NOTE_STORE, `note:${noteId}`);
    }

    async function notes_upsert(note) {
      const n = { ...note, updatedAt: nowISO() };

      if (Store.state.mode === "workspace") {
        const notesDir = await ensureDir(Store.state.rootHandle, "notes");
        await Workspace.writeJSON(notesDir, `${n.noteId}.json`, n);

        let idx = [];
        try { idx = await Workspace.readJSON(notesDir, "_index.json"); } catch {}
        if (!Array.isArray(idx)) idx = [];
        const slim = {
          noteId: n.noteId,
          title: n.title || "Untitled",
          category: n.category || "Other",
          tags: Array.isArray(n.tags) ? n.tags : [],
          caseId: n.caseId || "",
          caseNumber: n.caseNumber || "",
          createdAt: n.createdAt || nowISO(),
          updatedAt: n.updatedAt || nowISO(),
          createdBy: n.createdBy || ""
        };
        const i = idx.findIndex(x => x.noteId === n.noteId);
        if (i >= 0) idx[i] = slim; else idx.unshift(slim);
        idx.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
        await Workspace.writeJSON(notesDir, "_index.json", idx.slice(0, 4000));
      } else {
        await DB.set(NOTE_STORE, `note:${n.noteId}`, n);
        let idx = await notes_index_get();
        if (!Array.isArray(idx)) idx = [];
        const slim = {
          noteId: n.noteId,
          title: n.title || "Untitled",
          category: n.category || "Other",
          tags: Array.isArray(n.tags) ? n.tags : [],
          caseId: n.caseId || "",
          caseNumber: n.caseNumber || "",
          createdAt: n.createdAt || nowISO(),
          updatedAt: n.updatedAt || nowISO(),
          createdBy: n.createdBy || ""
        };
        const i = idx.findIndex(x => x.noteId === n.noteId);
        if (i >= 0) idx[i] = slim; else idx.unshift(slim);
        idx.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
        await notes_index_set(idx.slice(0, 4000));
      }

      try { await Store.auditAppend({ type: "note.upsert", msg: `Saved note ${n.noteId}` }); } catch {}
      return n;
    }

    async function notes_delete(noteId) {
      if (Store.state.mode === "workspace") {
        const notesDir = await ensureDir(Store.state.rootHandle, "notes");
        try { await notesDir.removeEntry(`${noteId}.json`); } catch {}
        let idx = [];
        try { idx = await Workspace.readJSON(notesDir, "_index.json"); } catch {}
        if (!Array.isArray(idx)) idx = [];
        idx = idx.filter(x => x.noteId !== noteId);
        try { await Workspace.writeJSON(notesDir, "_index.json", idx); } catch {}
      } else {
        await DB.del(NOTE_STORE, `note:${noteId}`);
        let idx = await notes_index_get();
        if (!Array.isArray(idx)) idx = [];
        idx = idx.filter(x => x.noteId !== noteId);
        await notes_index_set(idx);
      }
      try { await Store.auditAppend({ type: "note.delete", msg: `Deleted note ${noteId}` }); } catch {}
    }

    // =================
    // EVIDENCE STORAGE
    // =================
    // Fallback uses existing stores:
    // - bags/meta + bag index -> "reports"
    // - file blobs -> "osintHistory"
    const BAG_STORE = "reports";
    const BAG_INDEX_KEY = "evidence:index";
    const FILE_STORE = "osintHistory"; // stores blobs as {blob,name,type,size}

    async function bags_index_get() {
      return (await DB.get(BAG_STORE, BAG_INDEX_KEY)) || [];
    }
    async function bags_index_set(list) {
      await DB.set(BAG_STORE, BAG_INDEX_KEY, list);
    }

    async function bags_list() {
      if (Store.state.mode === "workspace") {
        const eDir = await ensureDir(Store.state.rootHandle, "evidence");
        // index first
        try {
          const idx = await Workspace.readJSON(eDir, "_index.json");
          if (Array.isArray(idx)) return idx;
        } catch {}

        // else build by scanning directories (one level)
        const ent = await Workspace.listEntries(eDir);
        const out = [];
        for (const d of (ent.dirs || []).slice(0, 2000)) {
          try {
            const bagDir = await eDir.getDirectoryHandle(d, { create: false });
            const meta = await Workspace.readJSON(bagDir, "bag.json");
            out.push({
              bagKey: d,
              label: meta.label || d,
              date: meta.date || "",
              caseId: meta.caseId || "",
              caseNumber: meta.caseNumber || "",
              createdBy: meta.createdBy || "",
              createdAt: meta.createdAt || "",
              updatedAt: meta.updatedAt || ""
            });
          } catch {}
        }
        out.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
        try { await Workspace.writeJSON(eDir, "_index.json", out); } catch {}
        return out;
      }

      // Fallback
      const idx = await bags_index_get();
      if (Array.isArray(idx) && idx.length) return idx;

      const keys = await DB.keys(BAG_STORE);
      const out = [];
      for (const k of keys) {
        if (String(k).startsWith("bag:")) {
          const b = await DB.get(BAG_STORE, k);
          if (b) out.push(b);
        }
      }
      out.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
      await bags_index_set(out);
      return out;
    }

    async function bag_get(bagKeyOrId) {
      if (Store.state.mode === "workspace") {
        const eDir = await ensureDir(Store.state.rootHandle, "evidence");
        const bagDir = await eDir.getDirectoryHandle(bagKeyOrId, { create: true });
        const meta = await Workspace.readJSON(bagDir, "bag.json").catch(() => ({}));
        const manifest = await Workspace.readJSON(bagDir, "manifest.json").catch(() => ([]));
        return { ...meta, bagKey: bagKeyOrId, items: Array.isArray(manifest) ? manifest : [] };
      }

      const meta = await DB.get(BAG_STORE, `bag:${bagKeyOrId}`);
      const items = (await DB.get(BAG_STORE, `bagitems:${bagKeyOrId}`)) || [];
      return { ...(meta || {}), bagKey: bagKeyOrId, items: Array.isArray(items) ? items : [] };
    }

    async function bag_upsert(bag) {
      const b = { ...bag, updatedAt: nowISO() };

      if (Store.state.mode === "workspace") {
        const eDir = await ensureDir(Store.state.rootHandle, "evidence");
        const bagDir = await eDir.getDirectoryHandle(b.bagKey, { create: true });

        const meta = {
          bagKey: b.bagKey,
          label: b.label || b.bagKey,
          date: b.date || "",
          caseId: b.caseId || "",
          caseNumber: b.caseNumber || "",
          createdBy: b.createdBy || "",
          notes: b.notes || "",
          createdAt: b.createdAt || nowISO(),
          updatedAt: b.updatedAt
        };

        await Workspace.writeJSON(bagDir, "bag.json", meta);
        await Workspace.writeJSON(bagDir, "manifest.json", Array.isArray(b.items) ? b.items : []);

        let idx = [];
        try { idx = await Workspace.readJSON(eDir, "_index.json"); } catch {}
        if (!Array.isArray(idx)) idx = [];
        const slim = {
          bagKey: b.bagKey,
          label: meta.label,
          date: meta.date,
          caseId: meta.caseId,
          caseNumber: meta.caseNumber,
          createdBy: meta.createdBy,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt
        };
        const i = idx.findIndex(x => x.bagKey === b.bagKey);
        if (i >= 0) idx[i] = slim; else idx.unshift(slim);
        idx.sort((a,c)=>String(c.updatedAt||"").localeCompare(String(a.updatedAt||"")));
        await Workspace.writeJSON(eDir, "_index.json", idx.slice(0, 4000));

      } else {
        // Fallback
        const slim = {
          bagKey: b.bagKey,
          label: b.label || b.bagKey,
          date: b.date || "",
          caseId: b.caseId || "",
          caseNumber: b.caseNumber || "",
          createdBy: b.createdBy || "",
          notes: b.notes || "",
          createdAt: b.createdAt || nowISO(),
          updatedAt: b.updatedAt
        };
        await DB.set(BAG_STORE, `bag:${b.bagKey}`, slim);
        await DB.set(BAG_STORE, `bagitems:${b.bagKey}`, Array.isArray(b.items) ? b.items : []);

        let idx = await bags_index_get();
        if (!Array.isArray(idx)) idx = [];
        const i = idx.findIndex(x => x.bagKey === b.bagKey);
        if (i >= 0) idx[i] = slim; else idx.unshift(slim);
        idx.sort((a,c)=>String(c.updatedAt||"").localeCompare(String(a.updatedAt||"")));
        await bags_index_set(idx.slice(0, 4000));
      }

      try { await Store.auditAppend({ type: "evidence.upsert", msg: `Saved bag ${b.bagKey}` }); } catch {}
      return b;
    }

    async function bag_delete(bagKeyOrId) {
      if (Store.state.mode === "workspace") {
        const eDir = await ensureDir(Store.state.rootHandle, "evidence");
        try { await eDir.removeEntry(bagKeyOrId, { recursive: true }); } catch {}
        let idx = [];
        try { idx = await Workspace.readJSON(eDir, "_index.json"); } catch {}
        if (!Array.isArray(idx)) idx = [];
        idx = idx.filter(x => x.bagKey !== bagKeyOrId);
        try { await Workspace.writeJSON(eDir, "_index.json", idx); } catch {}
      } else {
        await DB.del(BAG_STORE, `bag:${bagKeyOrId}`);
        await DB.del(BAG_STORE, `bagitems:${bagKeyOrId}`);

        // delete blobs
        const keys = await DB.keys(FILE_STORE);
        for (const k of keys) {
          if (String(k).startsWith(`evfile:${bagKeyOrId}:`)) await DB.del(FILE_STORE, k);
        }

        let idx = await bags_index_get();
        if (!Array.isArray(idx)) idx = [];
        idx = idx.filter(x => x.bagKey !== bagKeyOrId);
        await bags_index_set(idx);
      }
      try { await Store.auditAppend({ type: "evidence.delete", msg: `Deleted bag ${bagKeyOrId}` }); } catch {}
    }

    async function bag_add_files(bagKey, files) {
      const arr = Array.from(files || []);
      if (!arr.length) return [];

      const bag = await bag_get(bagKey);
      const items = Array.isArray(bag.items) ? bag.items : [];

      if (Store.state.mode === "workspace") {
        const eDir = await ensureDir(Store.state.rootHandle, "evidence");
        const bagDir = await eDir.getDirectoryHandle(bagKey, { create: true });

        for (const f of arr) {
          const id = uid("evf");
          const safe = sanitizeFilename(f.name);
          const stored = `${id}__${safe}`;
          await Workspace.writeFile(bagDir, stored, f);
          items.unshift({
            id,
            storedName: stored,
            originalName: f.name,
            mime: f.type || "",
            size: f.size || 0,
            addedAt: nowISO(),
            note: ""
          });
        }

        bag.items = items;
        await bag_upsert(bag);
        return items;
      }

      // Fallback: store blobs in FILE_STORE
      for (const f of arr) {
        const id = uid("evf");
        await DB.set(FILE_STORE, `evfile:${bagKey}:${id}`, {
          blob: f,
          name: f.name,
          type: f.type || "",
          size: f.size || 0
        });
        items.unshift({
          id,
          originalName: f.name,
          mime: f.type || "",
          size: f.size || 0,
          addedAt: nowISO(),
          note: ""
        });
      }

      bag.items = items;
      await bag_upsert(bag);
      return items;
    }

    async function bag_get_file_url(bagKey, item) {
      try {
        if (Store.state.mode === "workspace") {
          const eDir = await ensureDir(Store.state.rootHandle, "evidence");
          const bagDir = await eDir.getDirectoryHandle(bagKey, { create: false });
          const f = await Workspace.readFile(bagDir, item.storedName);
          return URL.createObjectURL(f);
        }
        const rec = await DB.get(FILE_STORE, `evfile:${bagKey}:${item.id}`);
        if (rec?.blob) return URL.createObjectURL(rec.blob);
      } catch {}
      return "";
    }

    // =========================
    // NOTES UI wiring
    // =========================
    const noteEls = {
      list: $("#noteList"),
      filter: $("#noteFilter"),
      catFilter: $("#noteCategoryFilter"),
      btnNew: $("#btnNewNote"),
      btnOpen: $("#btnOpenNote"),
      btnSave: $("#btnSaveNote"),
      btnDel: $("#btnDeleteNote"),
      metaPill: $("#noteMetaPill"),
      editorEmpty: $("#noteEditorEmpty"),
      editor: $("#noteEditor"),
      title: $("#noteTitle"),
      category: $("#noteCategory"),
      caseLink: $("#noteCaseLink"),
      tags: $("#noteTags"),
      body: $("#noteBody"),
      idPill: $("#noteIdPill"),
      storagePill: $("#noteStoragePill"),
    };

    let notesCache = [];
    let activeNoteId = null;
    let noteDirty = false;

    function noteStorageLabel() {
      return Store.state.mode === "workspace" ? "Workspace (Drive)" : "Fallback (IndexedDB)";
    }

    async function fillCaseSelect(selectEl, includeNoneText = "None") {
      const cases = await Store.caseList();
      selectEl.innerHTML = "";
      const o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = includeNoneText;
      selectEl.appendChild(o0);

      for (const c of cases) {
        const o = document.createElement("option");
        o.value = c.caseId;
        o.textContent = `${c.caseNumber ? `[${c.caseNumber}] ` : ""}${c.title || c.caseId}`;
        o.dataset.caseNumber = c.caseNumber || "";
        selectEl.appendChild(o);
      }
    }

    function setNoteEditorVisible(on) {
      noteEls.editorEmpty.hidden = !!on;
      noteEls.editor.hidden = !on;
      noteEls.btnDel.disabled = !on;
      noteEls.btnSave.disabled = !on || !noteDirty;
    }

    function setNoteDirty(on) {
      noteDirty = !!on;
      noteEls.btnSave.disabled = !activeNoteId || !noteDirty;
    }

    function noteSlimTitle(n) {
      const cat = n.category ? `[${n.category}] ` : "";
      const cn = n.caseNumber ? `${n.caseNumber} — ` : "";
      return `${cat}${cn}${n.title || n.noteId}`;
    }

    async function notes_render_list() {
      noteEls.storagePill.textContent = `Storage: ${noteStorageLabel()}`;

      notesCache = await notes_list();
      const q = (noteEls.filter.value || "").trim().toLowerCase();
      const cat = noteEls.catFilter.value || "";

      const filtered = notesCache.filter(n => {
        const hay = `${n.title||""} ${n.category||""} ${(n.tags||[]).join(" ")} ${n.caseNumber||""} ${n.caseId||""}`.toLowerCase();
        if (q && !hay.includes(q)) return false;
        if (cat && (n.category||"") !== cat) return false;
        return true;
      });

      noteEls.list.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No notes yet.";
        noteEls.list.appendChild(empty);
        return;
      }

      for (const n of filtered) {
        const it = document.createElement("div");
        it.className = "item";
        it.classList.toggle("active", activeNoteId === n.noteId);

        const t = document.createElement("div");
        t.textContent = noteSlimTitle(n);

        const meta = document.createElement("div");
        meta.className = "meta";
        if (n.updatedAt) meta.appendChild(Object.assign(document.createElement("span"), { textContent: `Updated ${formatMiniDate(n.updatedAt)}` }));
        if (n.createdBy) meta.appendChild(Object.assign(document.createElement("span"), { textContent: `By ${n.createdBy}` }));
        if (n.tags?.length) meta.appendChild(Object.assign(document.createElement("span"), { textContent: `#${n.tags.join(" #")}` }));

        it.appendChild(t);
        it.appendChild(meta);

        it.addEventListener("click", async () => {
          if (noteDirty) {
            Toasts.push({ title: "Notes", message: "Save or discard changes before switching notes." });
            return;
          }
          await notes_open(n.noteId);
          await notes_render_list();
        });

        noteEls.list.appendChild(it);
      }
    }

    async function notes_open(noteId) {
      const n = await notes_get(noteId);
      activeNoteId = n.noteId;

      await fillCaseSelect(noteEls.caseLink, "None");
      noteEls.caseLink.value = n.caseId || "";

      noteEls.title.value = n.title || "";
      noteEls.category.value = n.category || "Other";
      noteEls.tags.value = Array.isArray(n.tags) ? n.tags.join(", ") : "";
      noteEls.body.value = n.body || "";

      noteEls.idPill.textContent = `Note: ${n.noteId}`;
      noteEls.storagePill.textContent = `Storage: ${noteStorageLabel()}`;
      noteEls.metaPill.textContent = `Created ${formatMiniDate(n.createdAt)} • Updated ${formatMiniDate(n.updatedAt)} • By ${n.createdBy || "—"}`;

      setNoteEditorVisible(true);
      setNoteDirty(false);
    }

    function note_draft(existing) {
      const caseId = noteEls.caseLink.value || "";
      const opt = noteEls.caseLink.selectedOptions?.[0];
      const caseNumber = opt?.dataset?.caseNumber || "";

      return {
        noteId: activeNoteId,
        title: safeText(noteEls.title.value, 240) || "Untitled",
        category: noteEls.category.value || "Other",
        tags: csvTags(noteEls.tags.value),
        caseId,
        caseNumber,
        body: safeText(noteEls.body.value, 200000),
        createdAt: existing?.createdAt || nowISO(),
        updatedAt: nowISO(),
        createdBy: existing?.createdBy || (sessionStorage.getItem("sinners_user") || "Admin")
      };
    }

    async function notes_new() {
      const id = uid("note");
      activeNoteId = id;

      await fillCaseSelect(noteEls.caseLink, "None");
      noteEls.caseLink.value = "";

      noteEls.title.value = "";
      noteEls.category.value = "Other";
      noteEls.tags.value = "";
      noteEls.body.value = "";

      noteEls.idPill.textContent = `Note: ${id}`;
      noteEls.storagePill.textContent = `Storage: ${noteStorageLabel()}`;
      noteEls.metaPill.textContent = "New note (not saved yet)";

      setNoteEditorVisible(true);
      setNoteDirty(true);

      Toasts.push({ title: "Notes", message: "New note ready. Type then hit Save." });
      await notes_render_list();
    }

    async function notes_save() {
      if (!activeNoteId) return;
      let existing = null;
      try { existing = await notes_get(activeNoteId); } catch {}
      const draft = note_draft(existing);
      await notes_upsert(draft);
      Toasts.push({ title: "Notes", message: "Saved." });
      setNoteDirty(false);
      await notes_render_list();
      await notes_open(activeNoteId);
    }

    async function notes_delete_ui() {
      if (!activeNoteId) return;
      const id = activeNoteId;

      Modal.open({
        title: "Delete Note",
        body: `Delete note "${id}"? This cannot be undone.`,
        actions: [
          { label: "Cancel" },
          {
            label: "Delete",
            primary: true,
            onClick: async () => {
              await notes_delete(id);
              Toasts.push({ title: "Notes", message: "Deleted." });
              activeNoteId = null;
              noteEls.metaPill.textContent = "No note loaded";
              noteEls.idPill.textContent = "Note: none";
              setNoteEditorVisible(false);
              setNoteDirty(false);
              await notes_render_list();
            }
          }
        ]
      });
    }

    // Notes events
    noteEls.btnNew?.addEventListener("click", notes_new);
    noteEls.btnOpen?.addEventListener("click", async () => {
      await notes_render_list();
      Toasts.push({ title: "Notes", message: "Click a note in the list to open." });
    });
    noteEls.btnSave?.addEventListener("click", notes_save);
    noteEls.btnDel?.addEventListener("click", notes_delete_ui);

    noteEls.filter?.addEventListener("input", () => notes_render_list());
    noteEls.catFilter?.addEventListener("change", () => notes_render_list());

    [noteEls.title, noteEls.category, noteEls.caseLink, noteEls.tags, noteEls.body].forEach(el => {
      if (!el) return;
      el.addEventListener("input", () => { if (activeNoteId) setNoteDirty(true); });
      el.addEventListener("change", () => { if (activeNoteId) setNoteDirty(true); });
    });

    // =========================
    // EVIDENCE UI wiring
    // =========================
    const bagEls = {
      list: $("#bagList"),
      filter: $("#bagFilter"),
      caseFilter: $("#bagCaseFilter"),
      btnNew: $("#btnNewBag"),
      btnUpload: $("#btnUploadEvidence"),
      btnSave: $("#btnSaveBag"),
      btnDel: $("#btnDeleteBag"),
      fileInput: $("#evidenceFileInput"),
      metaPill: $("#bagMetaPill"),
      detailEmpty: $("#bagDetailEmpty"),
      detail: $("#bagDetail"),
      label: $("#bagLabel"),
      date: $("#bagDate"),
      caseLink: $("#bagCaseLink"),
      by: $("#bagBy"),
      notes: $("#bagNotes"),
      items: $("#bagItems"),
      idPill: $("#bagIdPill"),
      storagePill: $("#bagStoragePill")
    };

    let bagsCache = [];
    let activeBagKey = null;
    let bagDirty = false;
    let urlCache = new Map(); // itemId -> url

    function bagStorageLabel() {
      return Store.state.mode === "workspace" ? "Workspace (Drive)" : "Fallback (IndexedDB)";
    }

    function setBagEditorVisible(on) {
      bagEls.detailEmpty.hidden = !!on;
      bagEls.detail.hidden = !on;
      bagEls.btnUpload.disabled = !on;
      bagEls.btnSave.disabled = !on || !bagDirty;
      bagEls.btnDel.disabled = !on;
    }

    function setBagDirty(on) {
      bagDirty = !!on;
      bagEls.btnSave.disabled = !activeBagKey || !bagDirty;
    }

    async function bags_render_list() {
      bagEls.storagePill.textContent = `Storage: ${bagStorageLabel()}`;

      // Fill case dropdowns
      await (async () => {
        const cases = await Store.caseList();

        // case filter
        bagEls.caseFilter.innerHTML = "";
        const a0 = document.createElement("option");
        a0.value = "";
        a0.textContent = "All cases";
        bagEls.caseFilter.appendChild(a0);
        for (const c of cases) {
          const o = document.createElement("option");
          o.value = c.caseId;
          o.textContent = `${c.caseNumber ? `[${c.caseNumber}] ` : ""}${c.title || c.caseId}`;
          o.dataset.caseNumber = c.caseNumber || "";
          bagEls.caseFilter.appendChild(o);
        }

        // bag case link
        bagEls.caseLink.innerHTML = "";
        const n0 = document.createElement("option");
        n0.value = "";
        n0.textContent = "None";
        bagEls.caseLink.appendChild(n0);
        for (const c of cases) {
          const o = document.createElement("option");
          o.value = c.caseId;
          o.textContent = `${c.caseNumber ? `[${c.caseNumber}] ` : ""}${c.title || c.caseId}`;
          o.dataset.caseNumber = c.caseNumber || "";
          bagEls.caseLink.appendChild(o);
        }
      })();

      bagsCache = await bags_list();
      const q = (bagEls.filter.value || "").trim().toLowerCase();
      const cf = bagEls.caseFilter.value || "";

      const filtered = bagsCache.filter(b => {
        const hay = `${b.label||""} ${b.date||""} ${b.caseNumber||""} ${b.caseId||""}`.toLowerCase();
        if (q && !hay.includes(q)) return false;
        if (cf && (b.caseId || "") !== cf) return false;
        return true;
      });

      bagEls.list.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No evidence bags yet.";
        bagEls.list.appendChild(empty);
        return;
      }

      for (const b of filtered) {
        const it = document.createElement("div");
        it.className = "item";
        it.classList.toggle("active", activeBagKey === b.bagKey);

        const t = document.createElement("div");
        t.textContent = `${b.date ? `${b.date} — ` : ""}${b.caseNumber ? `${b.caseNumber} — ` : ""}${b.label || b.bagKey}`;

        const meta = document.createElement("div");
        meta.className = "meta";
        if (b.updatedAt) meta.appendChild(Object.assign(document.createElement("span"), { textContent: `Updated ${formatMiniDate(b.updatedAt)}` }));
        if (b.createdBy) meta.appendChild(Object.assign(document.createElement("span"), { textContent: `By ${b.createdBy}` }));

        it.appendChild(t);
        it.appendChild(meta);

        it.addEventListener("click", async () => {
          if (bagDirty) {
            Toasts.push({ title: "Evidence", message: "Save or discard changes before switching bags." });
            return;
          }
          await bag_open(b.bagKey);
          await bags_render_list();
        });

        bagEls.list.appendChild(it);
      }
    }

    async function bag_open(bagKey) {
      // clear URLs
      for (const u of urlCache.values()) { try { URL.revokeObjectURL(u); } catch {} }
      urlCache.clear();

      const b = await bag_get(bagKey);
      activeBagKey = bagKey;

      bagEls.label.value = b.label || "";
      bagEls.date.value = b.date || "";
      bagEls.by.value = b.createdBy || (sessionStorage.getItem("sinners_user") || "Admin");
      bagEls.notes.value = b.notes || "";
      bagEls.caseLink.value = b.caseId || "";

      bagEls.idPill.textContent = `Bag: ${bagKey}`;
      bagEls.storagePill.textContent = `Storage: ${bagStorageLabel()}`;
      bagEls.metaPill.textContent = `Created ${formatMiniDate(b.createdAt || nowISO())} • Updated ${formatMiniDate(b.updatedAt || nowISO())}`;

      setBagEditorVisible(true);
      setBagDirty(false);

      await bag_render_items(bagKey, Array.isArray(b.items) ? b.items : []);
    }

    async function bag_render_items(bagKey, items) {
      bagEls.items.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No files yet. Upload images/PDFs/text and add notes per file.";
        bagEls.items.appendChild(empty);
        return;
      }

      for (const item of items) {
        const wrap = document.createElement("div");
        wrap.className = "bag-item";

        const head = document.createElement("div");
        head.className = "bag-item-head";

        const left = document.createElement("div");
        const name = document.createElement("div");
        name.style.fontWeight = "700";
        name.textContent = item.originalName || item.storedName || item.id;

        const meta = document.createElement("div");
        meta.className = "muted";
        meta.style.fontSize = "12px";
        meta.textContent = `${item.mime || "file"} • ${item.size ? `${item.size} bytes` : ""} • ${item.addedAt ? formatMiniDate(item.addedAt) : ""}`;

        left.appendChild(name);
        left.appendChild(meta);

        const right = document.createElement("div");
        right.className = "pill";
        right.textContent = item.id;

        head.appendChild(left);
        head.appendChild(right);

        // Preview thumb for images
        const isImg = (item.mime || "").startsWith("image/");
        const isPdf = (item.mime || "") === "application/pdf";

        if (isImg) {
          const row = document.createElement("div");
          row.className = "row gap";
          row.style.alignItems = "flex-start";
          row.style.marginTop = "10px";

          const thumb = document.createElement("div");
          thumb.className = "thumb";
          const img = document.createElement("img");
          img.alt = "preview";

          const url = await bag_get_file_url(bagKey, item);
          if (url) { urlCache.set(item.id, url); img.src = url; }

          thumb.appendChild(img);
          row.appendChild(thumb);

          const noteWrap = document.createElement("div");
          noteWrap.className = "bag-item-note";
          noteWrap.style.flex = "1";

          const ta = document.createElement("textarea");
          ta.value = item.note || "";
          ta.placeholder = "Per-file notes (what is this image / why it matters)…";
          ta.addEventListener("input", () => {
            item.note = safeText(ta.value, 2000);
            setBagDirty(true);
          });

          noteWrap.appendChild(ta);
          row.appendChild(noteWrap);

          wrap.appendChild(head);
          wrap.appendChild(row);
        } else {
          wrap.appendChild(head);

          // PDF/link action
          if (isPdf) {
            const url = await bag_get_file_url(bagKey, item);
            if (url) {
              urlCache.set(item.id, url);
              const a = document.createElement("a");
              a.className = "btn ghost";
              a.href = url;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.textContent = "Open PDF";
              a.style.marginTop = "10px";
              wrap.appendChild(a);
            }
          }

          // Notes text area
          const ta = document.createElement("textarea");
          ta.value = item.note || "";
          ta.placeholder = "Per-file notes…";
          ta.style.marginTop = "10px";
          ta.addEventListener("input", () => {
            item.note = safeText(ta.value, 2000);
            setBagDirty(true);
          });
          wrap.appendChild(ta);
        }

        bagEls.items.appendChild(wrap);
      }
    }

    function bag_draft(existing, items) {
      const caseId = bagEls.caseLink.value || "";
      const opt = bagEls.caseLink.selectedOptions?.[0];
      const caseNumber = opt?.dataset?.caseNumber || "";

      return {
        bagKey: activeBagKey,
        label: safeText(bagEls.label.value, 120) || existing?.label || activeBagKey,
        date: safeText(bagEls.date.value, 32) || existing?.date || "",
        caseId,
        caseNumber,
        createdBy: safeText(bagEls.by.value, 80) || existing?.createdBy || (sessionStorage.getItem("sinners_user") || "Admin"),
        notes: safeText(bagEls.notes.value, 8000) || "",
        createdAt: existing?.createdAt || nowISO(),
        updatedAt: nowISO(),
        items: Array.isArray(items) ? items : []
      };
    }

    async function bag_new() {
      const label = `Evidence_${new Date().toISOString().slice(0,10)}`;
      const folder = sanitizeFolderName(label) || uid("bag");

      // ensure uniqueness in workspace
      let bagKey = folder;
      if (Store.state.mode === "workspace") {
        try {
          const eDir = await ensureDir(Store.state.rootHandle, "evidence");
          let attempt = bagKey, n = 2;
          while (true) {
            try { await eDir.getDirectoryHandle(attempt, { create: false }); attempt = `${bagKey}_${n++}`; }
            catch { bagKey = attempt; break; }
          }
        } catch {}
      } else {
        // in fallback we can just use uid for unique
        bagKey = uid("bag");
      }

      const meta = {
        bagKey,
        label: label,
        date: new Date().toISOString().slice(0,10),
        caseId: "",
        caseNumber: "",
        createdBy: sessionStorage.getItem("sinners_user") || "Admin",
        notes: "",
        createdAt: nowISO(),
        updatedAt: nowISO(),
        items: []
      };

      await bag_upsert(meta);
      Toasts.push({ title: "Evidence", message: "New bag created. Upload files next." });
      await bag_open(bagKey);
      await bags_render_list();
    }

    async function bag_save_ui() {
      if (!activeBagKey) return;
      const existing = await bag_get(activeBagKey);
      const items = Array.isArray(existing.items) ? existing.items : [];
      const draft = bag_draft(existing, items);
      await bag_upsert(draft);
      Toasts.push({ title: "Evidence", message: "Bag saved." });
      setBagDirty(false);
      await bags_render_list();
      await bag_open(activeBagKey);
    }

    async function bag_delete_ui() {
      if (!activeBagKey) return;
      const key = activeBagKey;

      Modal.open({
        title: "Delete Evidence Bag",
        body: `Delete bag "${key}"? Workspace mode deletes the folder/files too.`,
        actions: [
          { label: "Cancel" },
          {
            label: "Delete",
            primary: true,
            onClick: async () => {
              await bag_delete(key);
              Toasts.push({ title: "Evidence", message: "Deleted." });
              activeBagKey = null;
              setBagEditorVisible(false);
              setBagDirty(false);
              bagEls.metaPill.textContent = "No bag loaded";
              bagEls.idPill.textContent = "Bag: none";
              await bags_render_list();
            }
          }
        ]
      });
    }

    async function bag_upload_click() {
      if (!activeBagKey) return;
      bagEls.fileInput.click();
    }

    bagEls.fileInput?.addEventListener("change", async () => {
      if (!activeBagKey) return;
      const files = bagEls.fileInput.files;
      if (!files || !files.length) return;

      Toasts.push({ title: "Evidence", message: "Uploading…" });
      await bag_add_files(activeBagKey, files);
      bagEls.fileInput.value = "";
      await bag_open(activeBagKey);
      await bags_render_list();
      setBagDirty(false);
      Toasts.push({ title: "Evidence", message: "Upload complete." });
    });

    bagEls.btnNew?.addEventListener("click", bag_new);
    bagEls.btnUpload?.addEventListener("click", bag_upload_click);
    bagEls.btnSave?.addEventListener("click", bag_save_ui);
    bagEls.btnDel?.addEventListener("click", bag_delete_ui);

    bagEls.filter?.addEventListener("input", () => bags_render_list());
    bagEls.caseFilter?.addEventListener("change", () => bags_render_list());

    [bagEls.label, bagEls.date, bagEls.caseLink, bagEls.by, bagEls.notes].forEach(el => {
      if (!el) return;
      el.addEventListener("input", () => { if (activeBagKey) setBagDirty(true); });
      el.addEventListener("change", () => { if (activeBagKey) setBagDirty(true); });
    });

    // =========================
    // Route hook: render lists on navigation
    // =========================
    const _nav = nav;
    nav = (route) => {
      _nav(route);

      // defer to allow showPage() to toggle
      setTimeout(async () => {
        if (route === "notes") {
          try {
            await fillCaseSelect(noteEls.caseLink, "None");
            await notes_render_list();
            noteEls.storagePill.textContent = `Storage: ${noteStorageLabel()}`;
          } catch (e) {
            Toasts.push({ title: "Notes", message: `Error: ${String(e?.message || e)}` });
          }
        }

        if (route === "evidence") {
          try {
            await bags_render_list();
            bagEls.storagePill.textContent = `Storage: ${bagStorageLabel()}`;
          } catch (e) {
            Toasts.push({ title: "Evidence", message: `Error: ${String(e?.message || e)}` });
          }
        }
      }, 0);
    };

    // Initial paint safety: if someone reloads on notes/evidence route later
    // (Your app currently sets a default route, but this prevents blank states.)
    setTimeout(async () => {
      if (AppState?.activeRoute === "notes") await notes_render_list();
      if (AppState?.activeRoute === "evidence") await bags_render_list();
    }, 400);
  })();

  /* =========================================================
   FORWARD (OUTLOOK) ADD-ON — paste above final "})();"
   - Adds Forward buttons for Note/Case/Report
   - Exports JSON and opens Outlook compose prefilled
   - User manually attaches downloaded JSON (browser limitation)
   ========================================================= */
(() => {
  // ---------- Config ----------
  const OUTLOOK_COMPOSE = "https://outlook.office.com/mail/deeplink/compose";

  // ---------- Helpers ----------
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const $ = (sel, root = document) => root.querySelector(sel);
  const nowISO = () => new Date().toISOString();

  function safeText(s, max = 5000) {
    return String(s ?? "").replace(/\r/g, "").slice(0, max);
  }

  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function openOutlookCompose({ to = "", subject = "", body = "" }) {
    // Outlook web compose URL params
    const url = new URL(OUTLOOK_COMPOSE);
    if (to) url.searchParams.set("to", to);
    if (subject) url.searchParams.set("subject", subject);
    if (body) url.searchParams.set("body", body);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  function promptEmail(defaultEmail = "") {
    // Simple & fast. You can later upgrade to a modal + contact list.
    const email = window.prompt("Forward to (investigator email):", defaultEmail);
    return (email || "").trim();
  }

  // ---------- UI Injection (adds buttons in page-head rows) ----------
  function injectForwardButton(pageId, buttonId, label) {
    const page = document.getElementById(pageId);
    if (!page) return null;

    // Find the first ".page-head .row.gap" button row inside this page
    const head = page.querySelector(".page-head");
    if (!head) return null;
    const row = head.querySelector(".row.gap");
    if (!row) return null;

    // Avoid duplicates
    if (document.getElementById(buttonId)) return document.getElementById(buttonId);

    const btn = document.createElement("button");
    btn.className = "btn ghost";
    btn.id = buttonId;
    btn.textContent = label;

    // Put it near the end
    row.appendChild(btn);
    return btn;
  }

  // Add buttons
  const btnForwardNote = injectForwardButton("page-notes", "btnForwardNote", "Forward Note");
  const btnForwardCase = injectForwardButton("page-cases", "btnForwardCase", "Forward Case");
  const btnForwardReport = injectForwardButton("page-reports", "btnForwardReport", "Forward Report");

  // ---------- State access ----------
  // We depend on your existing globals created earlier in the file:
  // - AppState (active note/report/case selections)
  // - Store (caseGet/reportGet/etc)
  // - notes_get (or Store.noteGet) if you used the Notes add-on
  // If any are missing, we fail gracefully.

  function toast(title, message) {
    try {
      Toasts.push({ title, message });
    } catch {
      alert(`${title}\n\n${message}`);
    }
  }

  // ---------- Forward NOTE ----------
  btnForwardNote?.addEventListener("click", async () => {
    try {
      // Determine the current note id
      let noteId = null;

      // If you used the Notes add-on I gave earlier, it stores local "activeNoteId"
      // but inside that closure. So instead we infer from the UI pill when possible.
      const pill = document.getElementById("noteIdPill");
      const pillText = pill?.textContent || "";
      const match = pillText.match(/Note:\s*(.+)$/i);
      if (match) noteId = match[1].trim();

      // Fallback: try AppState.note.noteId if your main script has it
      if (!noteId && typeof AppState !== "undefined") {
        noteId = AppState?.note?.noteId || null;
      }

      if (!noteId || noteId === "none") {
        toast("Forward", "Open a note first.");
        return;
      }

      // Pull note payload
      let note = null;
      if (typeof notes_get === "function") note = await notes_get(noteId);
      else if (typeof Store !== "undefined" && typeof Store.noteGet === "function") note = await Store.noteGet(noteId);
      else {
        toast("Forward", "Note storage API not found in script. (notes_get / Store.noteGet missing)");
        return;
      }

      const to = promptEmail("");
      if (!to) return;

      const filename = `sinners_note_${note.noteId}.json`;
      const exported = {
        exportType: "SINNERS_NOTE",
        exportedAt: nowISO(),
        payload: note
      };

      // Download JSON (user will attach it in Outlook)
      downloadJSON(filename, exported);

      const subject = `SINNERS NOTE: ${safeText(note.title || note.noteId, 120)}`;
      const body =
`SINNERS Forward — NOTE

From: ${safeText(note.createdBy || "Unknown", 120)}
Created: ${safeText(note.createdAt || "", 60)}
Updated: ${safeText(note.updatedAt || "", 60)}
Category: ${safeText(note.category || "Other", 40)}
Linked Case: ${safeText(note.caseNumber || note.caseId || "None", 80)}

ATTACHMENT:
- ${filename}

INSTRUCTIONS:
1) Attach the downloaded JSON file to this email.
2) Receiver opens SINNERS → Settings → Import Bundle OR Notes → Import (if you add that later).
3) It will recreate the note with original author + timestamps.

(Attachments cannot be auto-added by browser for security. This is expected.)`;

      openOutlookCompose({ to, subject, body });
      toast("Forward", "Downloaded export + opened Outlook compose. Attach the JSON and send.");
    } catch (e) {
      toast("Forward Error", String(e?.message || e));
    }
  });

  // ---------- Forward CASE ----------
  btnForwardCase?.addEventListener("click", async () => {
    try {
      let caseId = null;

      // Prefer selected case from AppState if present
      if (typeof AppState !== "undefined") {
        caseId = AppState?.selectedCaseId || AppState?.activeCaseId || null;
      }

      if (!caseId) {
        toast("Forward", "Select a case first (Cases page) or set an active case.");
        return;
      }

      if (typeof Store === "undefined" || typeof Store.caseGet !== "function") {
        toast("Forward", "Store.caseGet not found.");
        return;
      }

      const c = await Store.caseGet(caseId);

      const to = promptEmail("");
      if (!to) return;

      const filename = `sinners_case_${c.caseId}.json`;
      const exported = {
        exportType: "SINNERS_CASE",
        exportedAt: nowISO(),
        payload: c
      };

      downloadJSON(filename, exported);

      const subject = `SINNERS CASE: ${safeText(c.caseNumber || c.title || c.caseId, 120)}`;
      const body =
`SINNERS Forward — CASE

Case: ${safeText(c.caseNumber || "—", 80)}
Title: ${safeText(c.title || "—", 200)}
Status: ${safeText(c.status || "Open", 40)}
Assigned: ${safeText(c.assigned || "", 80)}
Updated: ${safeText(c.updatedAt || "", 60)}

ATTACHMENT:
- ${filename}

INSTRUCTIONS:
1) Attach the downloaded JSON to this email.
2) Receiver imports it into SINNERS (import feature).
3) Case will appear with original data and timestamps.`;

      openOutlookCompose({ to, subject, body });
      toast("Forward", "Downloaded export + opened Outlook compose. Attach the JSON and send.");
    } catch (e) {
      toast("Forward Error", String(e?.message || e));
    }
  });

  // ---------- Forward REPORT ----------
  btnForwardReport?.addEventListener("click", async () => {
    try {
      // Identify report id and case id.
      // Your UI uses reportIdPill "Report: <id>" and reportCasePill "Case: <...>"
      const reportIdPill = document.getElementById("reportIdPill");
      const reportCasePill = document.getElementById("reportCasePill");

      let reportId = null;
      let caseId = null;

      const ridText = reportIdPill?.textContent || "";
      const ridMatch = ridText.match(/Report:\s*(.+)$/i);
      if (ridMatch) reportId = ridMatch[1].trim();
      if (!reportId || reportId === "none") reportId = null;

      // Best source of caseId is AppState.report.caseId if it exists
      if (typeof AppState !== "undefined") caseId = AppState?.report?.caseId || null;

      if (!reportId) {
        toast("Forward", "Load a report first (Reports page).");
        return;
      }

      if (typeof Store === "undefined" || typeof Store.reportGet !== "function") {
        toast("Forward", "Store.reportGet not found.");
        return;
      }

      // Workspace mode requires caseId for reportGet in my earlier architecture.
      let rep = null;
      try {
        rep = caseId ? await Store.reportGet(reportId, caseId) : await Store.reportGet(reportId);
      } catch {
        // If your Store.reportGet needs caseId but we don't have it, give a helpful message
        toast("Forward", "Could not load report. If you're in Workspace Mode, make sure a case is active / report is loaded with caseId.");
        return;
      }

      const to = promptEmail("");
      if (!to) return;

      const filename = `sinners_report_${rep.reportId}.json`;
      const exported = {
        exportType: "SINNERS_REPORT",
        exportedAt: nowISO(),
        payload: rep
      };

      downloadJSON(filename, exported);

      const subject = `SINNERS REPORT: ${safeText(rep.reportNumber || rep.reportId, 120)} — ${safeText(rep.type || "Report", 120)}`;
      const body =
`SINNERS Forward — REPORT

Report: ${safeText(rep.reportNumber || rep.reportId, 80)}
Case: ${safeText(rep.caseNumber || rep.caseId || "", 100)}
Type: ${safeText(rep.type || "", 120)}
Reason: ${safeText(rep.reason || "", 120)}
Confidence: ${safeText(rep.confidence || "", 40)}
Updated: ${safeText(rep.updatedAt || "", 60)}

ATTACHMENT:
- ${filename}

INSTRUCTIONS:
1) Attach the downloaded JSON to this email.
2) Receiver imports it into SINNERS (import feature).
3) Report will load in the same format with original author/timestamps.`;

      openOutlookCompose({ to, subject, body });
      toast("Forward", "Downloaded export + opened Outlook compose. Attach the JSON and send.");
    } catch (e) {
      toast("Forward Error", String(e?.message || e));
    }
  });

  // ---------- Optional: auto-refresh buttons enabling/disabling ----------
  // We gently enable/disable based on what looks loaded.
  function refreshForwardButtons() {
    try {
      // Note enabled if note pill has a real id
      const noteP = document.getElementById("noteIdPill")?.textContent || "";
      const noteOk = /Note:\s*(?!none\b)/i.test(noteP);
      if (btnForwardNote) btnForwardNote.disabled = !noteOk;

      // Case enabled if AppState has a selected or active case
      const caseOk = (typeof AppState !== "undefined") && (!!AppState.selectedCaseId || !!AppState.activeCaseId);
      if (btnForwardCase) btnForwardCase.disabled = !caseOk;

      // Report enabled if reportId pill is not "none"
      const repP = document.getElementById("reportIdPill")?.textContent || "";
      const repOk = /Report:\s*(?!none\b)/i.test(repP);
      if (btnForwardReport) btnForwardReport.disabled = !repOk;
    } catch {}
  }

  // Run often enough to stay accurate without being annoying
  setInterval(refreshForwardButtons, 800);
  refreshForwardButtons();

})();

/* =========================================================
   FORWARD NOTE FIX — paste near bottom (above final "})();")
   Makes Forward Note work even if notes_get / Store.noteGet
   aren't available by reading from Workspace or IndexedDB.
   ========================================================= */
(() => {
  const btn = document.getElementById("btnForwardNote");
  if (!btn) return;

  // --- Remove previous listeners by cloning the button ---
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);

  const OUTLOOK_COMPOSE = "https://outlook.office.com/mail/deeplink/compose";
  const nowISO = () => new Date().toISOString();

  function safeText(s, max = 5000) {
    return String(s ?? "").replace(/\r/g, "").slice(0, max);
  }

  function toast(title, message) {
    try { Toasts.push({ title, message }); }
    catch { alert(`${title}\n\n${message}`); }
  }

  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function openOutlookCompose({ to = "", subject = "", body = "" }) {
    const url = new URL(OUTLOOK_COMPOSE);
    if (to) url.searchParams.set("to", to);
    if (subject) url.searchParams.set("subject", subject);
    if (body) url.searchParams.set("body", body);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  function promptEmail(defaultEmail = "") {
    const email = window.prompt("Forward to (investigator email):", defaultEmail);
    return (email || "").trim();
  }

  async function getNoteIdFromUI() {
    const pill = document.getElementById("noteIdPill");
    const txt = pill?.textContent || "";
    const m = txt.match(/Note:\s*(.+)$/i);
    if (m) return m[1].trim();

    // fallback to AppState if present
    try { return AppState?.note?.noteId || null; } catch { return null; }
  }

  async function getNoteFromStorage(noteId) {
    // 1) Workspace mode: notes/<noteId>.json
    try {
      if (typeof Store !== "undefined" && Store?.state?.mode === "workspace") {
        const notesDir = await Workspace.dir(Store.state.rootHandle, "notes");
        const note = await Workspace.readJSON(notesDir, `${noteId}.json`);
        if (note) return note;
      }
    } catch {}

    // 2) IndexedDB mode: try multiple stores/keys
    if (typeof DB === "undefined") return null;

    const tries = [
      { store: "notes", key: `note:${noteId}` },
      { store: "cases", key: `note:${noteId}` },
      { store: "notes", key: noteId },
      { store: "cases", key: noteId },
    ];

    for (const t of tries) {
      try {
        const v = await DB.get(t.store, t.key);
        if (v) return v;
      } catch {}
    }

    return null;
  }

  clone.addEventListener("click", async () => {
    try {
      const noteId = await getNoteIdFromUI();
      if (!noteId || noteId === "none") {
        toast("Forward", "Open a note first.");
        return;
      }

      const note = await getNoteFromStorage(noteId);
      if (!note) {
        toast("Forward", "Couldn’t find that note in storage. Save it first, then try again.");
        return;
      }

      const to = promptEmail("");
      if (!to) return;

      const filename = `sinners_note_${note.noteId || noteId}.json`;
      const exported = {
        exportType: "SINNERS_NOTE",
        exportedAt: nowISO(),
        payload: note
      };

      downloadJSON(filename, exported);

      const subject = `SINNERS NOTE: ${safeText(note.title || note.noteId || noteId, 120)}`;
      const body =
`SINNERS Forward — NOTE

From: ${safeText(note.createdBy || "Unknown", 120)}
Created: ${safeText(note.createdAt || "", 60)}
Updated: ${safeText(note.updatedAt || "", 60)}
Category: ${safeText(note.category || "Other", 40)}
Linked Case: ${safeText(note.caseNumber || note.caseId || "None", 80)}

ATTACHMENT:
- ${filename}

INSTRUCTIONS:
1) Attach the downloaded JSON file to this email.
2) Receiver imports it into SINNERS (Settings → Import Bundle, or your future Notes Import).
3) It will preserve author + timestamps.

(Browsers can’t auto-attach files to Outlook for security.)`;

      openOutlookCompose({ to, subject, body });
      toast("Forward", "Downloaded export + opened Outlook compose. Attach the JSON and send.");
    } catch (e) {
      toast("Forward Error", String(e?.message || e));
    }
  });
})();


/* =========================================================
   NOTES: OPEN EXISTING (FIXED) — updates notes:index so list shows
   Paste ABOVE the final "})();"
   ========================================================= */
(() => {
  const btn = document.getElementById("btnOpenNote");
  if (!btn) return;

  // Replace listeners by cloning (nukes old handlers)
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);

  // Make label obvious
  clone.textContent = "Open Existing";

  // Hidden file input
  let inp = document.getElementById("noteImportFile");
  if (!inp) {
    inp = document.createElement("input");
    inp.type = "file";
    inp.id = "noteImportFile";
    inp.accept = "application/json";
    inp.hidden = true;
    document.body.appendChild(inp);
  }

  function toast(title, message) {
    try { Toasts.push({ title, message }); }
    catch { alert(`${title}\n\n${message}`); }
  }

  async function readJSON(file) {
    return JSON.parse(await file.text());
  }

  function slimFromNote(n) {
    return {
      noteId: n.noteId,
      title: n.title || "Untitled",
      category: n.category || "Other",
      tags: Array.isArray(n.tags) ? n.tags : [],
      caseId: n.caseId || "",
      caseNumber: n.caseNumber || "",
      createdAt: n.createdAt || "",
      updatedAt: n.updatedAt || "",
      createdBy: n.createdBy || ""
    };
  }

  async function updateNotesIndexWith(noteObj) {
    // Workspace mode: update notes/_index.json
    if (typeof Store !== "undefined" && Store?.state?.mode === "workspace") {
      const notesDir = await Workspace.dir(Store.state.rootHandle, "notes");

      let idx = [];
      try { idx = await Workspace.readJSON(notesDir, "_index.json"); } catch {}
      if (!Array.isArray(idx)) idx = [];

      const slim = slimFromNote(noteObj);
      const i = idx.findIndex(x => x.noteId === slim.noteId);
      if (i >= 0) idx[i] = slim;
      else idx.unshift(slim);

      idx.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      await Workspace.writeJSON(notesDir, "_index.json", idx.slice(0, 4000));
      return;
    }

    // Fallback mode: update cases/"notes:index"
    let idx = await DB.get("cases", "notes:index");
    if (!Array.isArray(idx)) idx = [];

    const slim = slimFromNote(noteObj);
    const i = idx.findIndex(x => x.noteId === slim.noteId);
    if (i >= 0) idx[i] = slim;
    else idx.unshift(slim);

    idx.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    await DB.set("cases", "notes:index", idx.slice(0, 4000));
  }

  async function saveImportedNote(noteObj) {
    // Workspace: write notes/<id>.json
    if (typeof Store !== "undefined" && Store?.state?.mode === "workspace") {
      const notesDir = await Workspace.dir(Store.state.rootHandle, "notes");
      await Workspace.writeJSON(notesDir, `${noteObj.noteId}.json`, noteObj);
      await updateNotesIndexWith(noteObj);
      return;
    }

    // Fallback: store in cases as note:<id>
    await DB.set("cases", `note:${noteObj.noteId}`, noteObj);
    await updateNotesIndexWith(noteObj);
  }

  clone.addEventListener("click", () => inp.click());

  inp.addEventListener("change", async () => {
    try {
      const f = inp.files?.[0];
      inp.value = "";
      if (!f) return;

      const raw = await readJSON(f);
      const payload = raw?.payload ? raw.payload : raw; // supports wrapped exports OR raw note JSON

      if (!payload || typeof payload !== "object") throw new Error("Invalid note JSON.");

      // normalize required fields
      payload.noteId = payload.noteId || `note_${Date.now()}`;
      payload.createdAt = payload.createdAt || new Date().toISOString();
      payload.updatedAt = payload.updatedAt || new Date().toISOString();
      payload.createdBy = payload.createdBy || (sessionStorage.getItem("sinners_user") || "Admin");
      payload.title = payload.title || "Untitled";
      payload.category = payload.category || "Other";
      payload.tags = Array.isArray(payload.tags) ? payload.tags : [];

      await saveImportedNote(payload);

      toast("Notes", "Imported. Opening Notes page…");

      // This triggers your nav override (from Notes add-on) to re-render the list.
      if (typeof nav === "function") {
        nav("dashboard");
        setTimeout(() => nav("notes"), 0);
      }
    } catch (e) {
      toast("Import Error", String(e?.message || e));
    }
  });
})();


/* =========================================================
   CALENDAR MODULE (local-first)
   - Route: "calendar"
   - Storage: workspace logs/calendar_<user>.json OR IndexedDB agenda/calendar:<user>
   ========================================================= */
(() => {
  const page = document.getElementById("page-calendar");
  if (!page) return;

  // Register page for router
  try { Pages.calendar = page; } catch {}

  const elNow = document.getElementById("calNowPill");
  const elMonth = document.getElementById("calMonthLabel");
  const elGrid = document.getElementById("calGrid");
  const elSelected = document.getElementById("calSelectedPill");
  const elList = document.getElementById("calList");
  const elUpcoming = document.getElementById("calUpcoming");

  const btnPrev = document.getElementById("btnCalPrev");
  const btnNext = document.getElementById("btnCalNext");
  const btnToday = document.getElementById("btnCalToday");
  const btnNew = document.getElementById("btnCalNew");
  const btnNewForDay = document.getElementById("btnCalNewForDay");
  const btnClearDay = document.getElementById("btnCalClearDay");

  // ---------- Helpers ----------
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

  function toast(title, message) {
    try { Toasts.push({ title, message }); }
    catch { alert(`${title}\n\n${message}`); }
  }

  function userKey() {
    try {
      const u = sessionStorage.getItem("sinners_user") || "Admin";
      return String(u).trim() || "Admin";
    } catch { return "Admin"; }
  }

  // ---------- Storage ----------
  async function loadCalendar() {
    const u = userKey();
    if (Store?.state?.mode === "workspace") {
      const logs = await Workspace.dir(Store.state.rootHandle, "logs");
      try {
        const data = await Workspace.readJSON(logs, `calendar_${u}.json`);
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    }
    return (await DB.get("agenda", `calendar:${u}`)) || [];
  }

  async function saveCalendar(items) {
    const u = userKey();
    const clean = Array.isArray(items) ? items.slice(0, 5000) : [];
    if (Store?.state?.mode === "workspace") {
      const logs = await Workspace.dir(Store.state.rootHandle, "logs");
      await Workspace.writeJSON(logs, `calendar_${u}.json`, clean);
      return;
    }
    await DB.set("agenda", `calendar:${u}`, clean);
  }

  // ---------- State ----------
  let view = new Date(); // month being shown
  view.setDate(1);
  let selectedDay = null; // YYYY-MM-DD
  let items = []; // [{id, date, time, title, notes, createdBy, createdAt, updatedAt}]

  // ---------- UI ----------
  function renderNowPill() {
    const d = new Date();
    elNow.textContent = `Local: ${d.toLocaleString()}`;
  }

  function monthLabel(d) {
    const m = d.toLocaleString(undefined, { month: "long", year: "numeric" });
    return m;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function dayHasItems(dayStr) {
    return items.some(x => x.date === dayStr);
  }

  function countDayItems(dayStr) {
    return items.filter(x => x.date === dayStr).length;
  }

  function renderGrid() {
    elMonth.textContent = monthLabel(view);

    const first = new Date(view);
    const startDow = first.getDay(); // 0 sun
    const start = new Date(first);
    start.setDate(first.getDate() - startDow);

    const today = new Date();
    const selected = selectedDay;

    elGrid.innerHTML = "";

    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);

      const dayStr = ymd(d);
      const cell = document.createElement("div");
      cell.className = "cal-day";

      if (d.getMonth() !== view.getMonth()) cell.classList.add("muted");
      if (sameDay(d, today)) cell.classList.add("today");
      if (selected && selected === dayStr) cell.classList.add("selected");

      const n = document.createElement("div");
      n.className = "n";
      n.textContent = String(d.getDate());
      cell.appendChild(n);

      if (dayHasItems(dayStr)) {
        const dot = document.createElement("div");
        dot.className = "dot";
        const c = Math.min(4, countDayItems(dayStr));
        for (let k = 0; k < c; k++) dot.appendChild(document.createElement("span"));
        cell.appendChild(dot);
      }

      cell.addEventListener("click", () => {
        selectedDay = dayStr;
        elSelected.textContent = `Selected: ${dayStr}`;
        btnNewForDay.disabled = false;
        btnClearDay.disabled = !dayHasItems(dayStr);
        renderGrid();
        renderDayList();
        renderUpcoming();
      });

      elGrid.appendChild(cell);
    }
  }

  function renderDayList() {
    elList.innerHTML = "";
    if (!selectedDay) {
      const m = document.createElement("div");
      m.className = "muted";
      m.textContent = "Click a day on the calendar to view reminders.";
      elList.appendChild(m);
      return;
    }

    const dayItems = items
      .filter(x => x.date === selectedDay)
      .sort((a,b) => String(a.time||"").localeCompare(String(b.time||"")));

    if (!dayItems.length) {
      const m = document.createElement("div");
      m.className = "muted";
      m.textContent = "No reminders on this day.";
      elList.appendChild(m);
      return;
    }

    for (const it of dayItems) {
      const card = document.createElement("div");
      card.className = "cal-item";

      const top = document.createElement("div");
      top.className = "top";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = `${it.time ? it.time + " — " : ""}${it.title || "Untitled"}`;

      const del = document.createElement("button");
      del.className = "btn ghost";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        items = items.filter(x => x.id !== it.id);
        await saveCalendar(items);
        toast("Calendar", "Deleted.");
        btnClearDay.disabled = !dayHasItems(selectedDay);
        renderGrid();
        renderDayList();
        renderUpcoming();
      });

      top.appendChild(title);
      top.appendChild(del);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `By ${it.createdBy || "Admin"} • Updated ${new Date(it.updatedAt || it.createdAt || Date.now()).toLocaleString()}`;

      const notes = document.createElement("div");
      notes.className = "muted";
      notes.style.marginTop = "8px";
      notes.textContent = it.notes || "";

      card.appendChild(top);
      card.appendChild(meta);
      if (it.notes) card.appendChild(notes);

      elList.appendChild(card);
    }
  }

  function renderUpcoming() {
    elUpcoming.innerHTML = "";

    const now = new Date();
    const start = new Date(now);
    start.setHours(0,0,0,0);

    const end = new Date(start);
    end.setDate(start.getDate() + 14);

    const upcoming = items
      .filter(x => {
        const d = new Date(x.date + "T00:00:00");
        return d >= start && d <= end;
      })
      .sort((a,b) => {
        const ad = a.date + " " + (a.time || "99:99");
        const bd = b.date + " " + (b.time || "99:99");
        return ad.localeCompare(bd);
      })
      .slice(0, 20);

    if (!upcoming.length) {
      const m = document.createElement("div");
      m.className = "muted";
      m.textContent = "No upcoming reminders in the next 14 days.";
      elUpcoming.appendChild(m);
      return;
    }

    for (const it of upcoming) {
      const row = document.createElement("div");
      row.className = "item";

      const t = document.createElement("div");
      t.textContent = `${it.date}${it.time ? " " + it.time : ""} — ${it.title || "Untitled"}`;

      const m = document.createElement("div");
      m.className = "meta";
      m.textContent = `By ${it.createdBy || "Admin"}`;

      row.appendChild(t);
      row.appendChild(m);

      row.addEventListener("click", () => {
        selectedDay = it.date;
        elSelected.textContent = `Selected: ${it.date}`;
        btnNewForDay.disabled = false;
        btnClearDay.disabled = !dayHasItems(it.date);
        view = new Date(it.date + "T00:00:00");
        view.setDate(1);
        renderGrid();
        renderDayList();
        renderUpcoming();
      });

      elUpcoming.appendChild(row);
    }
  }

  function openNewModal(datePref = null) {
    const wrap = document.createElement("div");

    const date = document.createElement("input");
    date.placeholder = "YYYY-MM-DD";
    date.value = datePref || ymd(new Date());

    const time = document.createElement("input");
    time.placeholder = "HH:MM (optional)";
    time.value = "";

    const title = document.createElement("input");
    title.placeholder = "Reminder title (e.g., Follow up with witness, pull footage)";

    const notes = document.createElement("textarea");
    notes.rows = 4;
    notes.placeholder = "Notes (optional)";

    [date, time, title, notes].forEach(el => {
      el.style.marginTop = "10px";
      el.style.width = "100%";
    });

    wrap.appendChild(date);
    wrap.appendChild(time);
    wrap.appendChild(title);
    wrap.appendChild(notes);

    Modal.open({
      title: "New Reminder",
      body: wrap,
      actions: [
        { label: "Cancel" },
        {
          label: "Save",
          primary: true,
          onClick: async () => {
            const d = String(date.value || "").trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
              toast("Calendar", "Invalid date. Use YYYY-MM-DD.");
              return;
            }

            const item = {
              id: uid("cal"),
              date: d,
              time: String(time.value || "").trim().slice(0, 5),
              title: String(title.value || "").trim().slice(0, 140) || "Untitled",
              notes: String(notes.value || "").trim().slice(0, 4000),
              createdBy: (sessionStorage.getItem("sinners_user") || "Admin"),
              createdAt: nowISO(),
              updatedAt: nowISO()
            };

            items.unshift(item);
            await saveCalendar(items);

            toast("Calendar", "Saved.");
            selectedDay = d;
            elSelected.textContent = `Selected: ${d}`;
            btnNewForDay.disabled = false;
            btnClearDay.disabled = !dayHasItems(d);

            view = new Date(d + "T00:00:00");
            view.setDate(1);

            renderGrid();
            renderDayList();
            renderUpcoming();
          }
        }
      ]
    });
  }

  async function clearSelectedDay() {
    if (!selectedDay) return;
    const d = selectedDay;
    const before = items.length;
    items = items.filter(x => x.date !== d);
    if (items.length === before) return;
    await saveCalendar(items);
    toast("Calendar", "Cleared day.");
    btnClearDay.disabled = true;
    renderGrid();
    renderDayList();
    renderUpcoming();
  }

  // ---------- Wire buttons ----------
  btnPrev?.addEventListener("click", () => {
    view.setMonth(view.getMonth() - 1);
    renderGrid();
  });
  btnNext?.addEventListener("click", () => {
    view.setMonth(view.getMonth() + 1);
    renderGrid();
  });
  btnToday?.addEventListener("click", () => {
    const t = new Date();
    view = new Date(t); view.setDate(1);
    selectedDay = ymd(t);
    elSelected.textContent = `Selected: ${selectedDay}`;
    btnNewForDay.disabled = false;
    btnClearDay.disabled = !dayHasItems(selectedDay);
    renderGrid();
    renderDayList();
    renderUpcoming();
  });
  btnNew?.addEventListener("click", () => openNewModal(selectedDay || null));
  btnNewForDay?.addEventListener("click", () => selectedDay && openNewModal(selectedDay));
  btnClearDay?.addEventListener("click", clearSelectedDay);

  // ---------- Router hook ----------
  // Your script already has nav(route). We wrap it safely.
  const _nav = (typeof nav === "function") ? nav : null;
  if (_nav) {
    nav = (route) => {
      _nav(route);
      if (route === "calendar") {
        // render on entry
        setTimeout(async () => {
          try {
            renderNowPill();
            items = await loadCalendar();

            // default to today on first open
            if (!selectedDay) selectedDay = ymd(new Date());
            elSelected.textContent = `Selected: ${selectedDay}`;
            btnNewForDay.disabled = false;
            btnClearDay.disabled = !dayHasItems(selectedDay);

            view = new Date(selectedDay + "T00:00:00");
            view.setDate(1);

            renderGrid();
            renderDayList();
            renderUpcoming();
          } catch (e) {
            toast("Calendar", `Error: ${String(e?.message || e)}`);
          }
        }, 0);
      }
    };
  }

  // Keep local time fresh
  renderNowPill();
  setInterval(renderNowPill, 1000);
})();

// =========================
// PATCH: Reports "Save" should auto-create a draft if none is loaded
// Paste this RIGHT ABOVE the final "})();"
// =========================
(() => {
  // Guard: only run if these exist in your current build
  if (typeof btnSaveReport === "undefined" || !btnSaveReport) return;
  if (typeof saveReport !== "function" || typeof createNewReport !== "function") return;

  // Override the save button behavior (this replaces whatever was wired earlier)
  btnSaveReport.onclick = async () => {
    try {
      const hasLoadedReport =
        AppState &&
        AppState.report &&
        AppState.report.reportId &&
        AppState.report.caseId;

      // If no report loaded, auto-create a new one (requires an active case)
      if (!hasLoadedReport) {
        const cid = AppState?.activeCaseId || AppState?.report?.caseId;

        if (!cid) {
          Toasts?.push?.({ title: "Report", message: "Set an active case first (Cases → Set Active), then Save again." });
          if (typeof showPage === "function") showPage("cases");
          return;
        }

        // Create a new report draft tied to active case
        await createNewReport(cid);
      }

      // Now save the report normally
      await saveReport();
      Toasts?.push?.({ title: "Report", message: "Saved." });

    } catch (e) {
      Toasts?.push?.({ title: "Report Save Error", message: String(e?.message || e) });
      console.error("Report Save Error:", e);
    }
  };
})();

})();
