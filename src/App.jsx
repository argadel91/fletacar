import { useState, useEffect, useCallback, useRef } from "react";
import { jsPDF } from "jspdf";

// ─── Constants ───
const TABS = ["dashboard", "facturas", "hojas_ruta", "clientes"];
const ESTADO_FACTURA = ["Pendiente", "Pagada", "Vencida", "Anulada"];
const ESTADO_RUTA = ["Planificada", "En curso", "Completada", "Cancelada"];

const estadoColor = {
  Pendiente: "#e8a735", Pagada: "#2ecc71", Vencida: "#e74c3c", Anulada: "#95a5a6",
  Planificada: "#3498db", "En curso": "#e8a735", Completada: "#2ecc71", Cancelada: "#e74c3c",
};

const STORAGE_KEYS = {
  facturas: "fletacar_facturas",
  hojas_ruta: "fletacar_hojas_ruta",
  clientes: "fletacar_clientes",
  darkMode: "fletacar_darkMode",
};

const emptyFactura = { numero: "", clienteId: "", cliente: "", fecha: "", vencimiento: "", importe: "", iva: "21", concepto: "", estado: "Pendiente", notas: "" };
const emptyRuta = { codigo: "", conductor: "", vehiculo: "", fecha: "", origen: "Valencia", destino: "", estado: "Planificada", paradas: "", bultos: "", km: "", notas: "" };
const emptyCliente = { nombre: "", nif: "", direccion: "", ciudad: "", cp: "", telefono: "", email: "", notas: "" };

const tabLabels = { dashboard: "Panel de Control", facturas: "Facturas", hojas_ruta: "Hojas de Ruta", clientes: "Clientes" };

// ─── Utilities ───
const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const formatCurrency = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
const formatDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
};

const loadData = (key) => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : []; } catch { return []; } };
const saveData = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error("Storage error:", e); } };

function getNextNumber(items, prefix, field) {
  let max = 0;
  items.forEach(item => {
    const val = item[field] || "";
    if (val.startsWith(prefix)) {
      const n = parseInt(val.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefix + String(max + 1).padStart(3, "0");
}

function detectOverdueInvoices(facturas) {
  const today = new Date().toISOString().slice(0, 10);
  return facturas.map(f => {
    if (f.estado === "Pendiente" && f.vencimiento && f.vencimiento < today) {
      return { ...f, estado: "Vencida" };
    }
    return f;
  });
}

function exportCSV(rows, columns, filename) {
  const header = columns.map(c => c.label).join(";");
  const body = rows.map(r => columns.map(c => {
    let v = String(r[c.key] ?? "").replace(/"/g, '""');
    return `"${v}"`;
  }).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportJSON(data) {
  const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fletacar_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (typeof data !== "object" || data === null) throw new Error("Invalid");
        resolve(data);
      } catch { reject(new Error("Formato inválido")); }
    };
    reader.onerror = () => reject(new Error("Error de lectura"));
    reader.readAsText(file);
  });
}

function getMonthlyRevenue(facturas, months = 6) {
  const now = new Date();
  const result = [];
  const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = monthNames[d.getMonth()];
    let sum = 0;
    facturas.forEach(f => {
      if (f.estado === "Pagada" && f.fecha && f.fecha.startsWith(key)) {
        sum += (parseFloat(f.importe) || 0) * (1 + (parseFloat(f.iva) || 0) / 100);
      }
    });
    result.push({ label, value: sum });
  }
  return result;
}

function sortItems(items, config) {
  if (!config.key) return items;
  return [...items].sort((a, b) => {
    let aVal = a[config.key], bVal = b[config.key];
    if (!isNaN(parseFloat(aVal)) && !isNaN(parseFloat(bVal))) {
      aVal = parseFloat(aVal); bVal = parseFloat(bVal);
    } else {
      aVal = String(aVal || "").toLowerCase(); bVal = String(bVal || "").toLowerCase();
    }
    if (aVal < bVal) return config.dir === "asc" ? -1 : 1;
    if (aVal > bVal) return config.dir === "asc" ? 1 : -1;
    return 0;
  });
}

// ─── Styles ───
const css = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap');

:root {
  --bg: #faf9f7; --bg2: #ffffff; --bg3: #f3f1ed; --bg4: #e8e5df;
  --border: #ddd8d0; --text: #1a1814; --text2: #7a756c; --text3: #a09a90;
  --accent: #c84b1a; --accent2: #a83d14;
  --accent-light: #c84b1a15; --accent-mid: #c84b1a30;
  --navy: #1e2a3a; --navy-light: #2c3e50;
  --success: #2d8a4e; --success-bg: #2d8a4e12;
  --warning: #c87b1a; --warning-bg: #c87b1a12;
  --danger: #c42b2b; --danger-bg: #c42b2b10;
  --blue: #2563eb; --blue-bg: #2563eb10;
  --radius: 10px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,.06);
  --shadow-md: 0 4px 16px rgba(0,0,0,.08);
}

[data-theme="dark"] {
  --bg: #111117; --bg2: #1a1a24; --bg3: #22222e; --bg4: #2a2a38;
  --border: #33334a; --text: #e4e4ec; --text2: #8888a4; --text3: #5a5a74;
  --accent: #e05522; --accent2: #c84b1a;
  --accent-light: #e0552218; --accent-mid: #e0552230;
  --navy: #0c0c16; --navy-light: #161622;
  --success: #3ddc84; --success-bg: #3ddc8415;
  --warning: #ffb74d; --warning-bg: #ffb74d15;
  --danger: #ff5252; --danger-bg: #ff525215;
  --blue: #448aff; --blue-bg: #448aff15;
  --shadow-sm: 0 1px 4px rgba(0,0,0,.25);
  --shadow-md: 0 4px 20px rgba(0,0,0,.35);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: 'Outfit', sans-serif; -webkit-font-smoothing: antialiased; }

.app { display: flex; height: 100vh; width: 100%; overflow: hidden; }

.sidebar {
  width: 256px; min-width: 256px; background: var(--navy);
  display: flex; flex-direction: column; padding: 0;
}
.sidebar-logo {
  padding: 24px 22px 20px; display: flex; align-items: center; gap: 14px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.sidebar-logo .logo-mark {
  width: 42px; height: 42px; background: var(--accent);
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 800; font-size: 18px; font-family: 'Outfit', sans-serif;
  letter-spacing: -1px; box-shadow: 0 2px 8px rgba(200,75,26,.35);
}
.sidebar-logo h1 {
  font-family: 'Outfit', sans-serif; font-size: 20px;
  font-weight: 800; color: #fff; letter-spacing: -0.5px; line-height: 1.15;
}
.sidebar-logo .loc {
  font-size: 11.5px; color: rgba(255,255,255,.45); font-weight: 400;
  display: flex; align-items: center; gap: 4px; margin-top: 1px;
}
.sidebar-logo .loc svg { opacity: .6; }

.sidebar-nav { padding: 20px 14px; flex: 1; }
.nav-section-label {
  font-size: 10px; font-weight: 700; color: rgba(255,255,255,.25);
  text-transform: uppercase; letter-spacing: 1.5px; padding: 0 12px; margin-bottom: 10px;
}
.nav-item {
  display: flex; align-items: center; gap: 12px; padding: 11px 14px;
  border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;
  color: rgba(255,255,255,.55); transition: all .15s; margin-bottom: 3px;
}
.nav-item:hover { background: rgba(255,255,255,.07); color: rgba(255,255,255,.85); }
.nav-item.active {
  background: var(--accent); color: #fff;
  box-shadow: 0 2px 8px rgba(200,75,26,.3);
}
.nav-item.active svg { stroke: #fff; }

.dark-toggle {
  display: flex; align-items: center; gap: 12px; padding: 11px 14px;
  margin: 0 14px 6px; border-radius: 8px; cursor: pointer;
  color: rgba(255,255,255,.45); font-size: 13px; font-weight: 500;
  transition: all .15s;
}
.dark-toggle:hover { background: rgba(255,255,255,.07); color: rgba(255,255,255,.8); }

.sidebar-footer {
  padding: 18px 22px; border-top: 1px solid rgba(255,255,255,.06);
  font-size: 11px; color: rgba(255,255,255,.2); display: flex; flex-direction: column; gap: 2px;
}
.sidebar-footer .empresa { color: rgba(255,255,255,.35); font-weight: 600; }

.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
.topbar {
  height: 68px; min-height: 68px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 32px; border-bottom: 1px solid var(--border); background: var(--bg2);
  box-shadow: var(--shadow-sm);
}
.topbar h2 { font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
.topbar-actions { display: flex; gap: 10px; align-items: center; }

.content { flex: 1; overflow-y: auto; padding: 32px; }

.btn {
  display: inline-flex; align-items: center; gap: 7px; padding: 9px 18px;
  border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1px solid var(--border); background: var(--bg2);
  color: var(--text); transition: all .15s; font-family: 'Outfit', sans-serif;
  box-shadow: var(--shadow-sm);
}
.btn:hover { background: var(--bg3); border-color: var(--text3); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); box-shadow: 0 2px 8px rgba(200,75,26,.25); }
.btn-primary:hover { background: var(--accent2); border-color: var(--accent2); }
.btn-danger { color: var(--danger); border-color: rgba(196,43,43,.25); box-shadow: none; }
.btn-danger:hover { background: var(--danger-bg); }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-icon { padding: 7px; width: 34px; height: 34px; justify-content: center; box-shadow: none; }

.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-bottom: 28px; }
.stat-card {
  background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 22px; position: relative; overflow: hidden; box-shadow: var(--shadow-sm);
  transition: box-shadow .2s;
}
.stat-card:hover { box-shadow: var(--shadow-md); }
.stat-card .stat-icon {
  width: 40px; height: 40px; border-radius: 10px; display: flex;
  align-items: center; justify-content: center; margin-bottom: 14px;
}
.stat-card .stat-icon.amber { background: var(--warning-bg); color: var(--warning); }
.stat-card .stat-icon.green { background: var(--success-bg); color: var(--success); }
.stat-card .stat-icon.red { background: var(--danger-bg); color: var(--danger); }
.stat-card .stat-icon.blue { background: var(--blue-bg); color: var(--blue); }
.stat-label { font-size: 12px; color: var(--text2); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .7px; font-weight: 600; }
.stat-value { font-family: 'JetBrains Mono', monospace; font-size: 28px; font-weight: 700; letter-spacing: -1px; }

.search-box {
  display: flex; align-items: center; gap: 8px; background: var(--bg3);
  border: 1px solid var(--border); border-radius: 8px; padding: 0 12px;
  transition: border-color .15s;
}
.search-box:focus-within { border-color: var(--accent); }
.search-box input {
  background: none; border: none; color: var(--text); font-size: 13px;
  padding: 9px 0; width: 200px; outline: none; font-family: 'Outfit', sans-serif;
}
.search-box input::placeholder { color: var(--text3); }

.table-wrap { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); overflow-x: auto; box-shadow: var(--shadow-sm); }
table { width: 100%; border-collapse: collapse; min-width: 700px; }
thead { background: var(--bg3); }
th {
  padding: 12px 16px; font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1px; color: var(--text2); text-align: left; border-bottom: 1px solid var(--border);
}
th.sortable { cursor: pointer; user-select: none; transition: color .15s; }
th.sortable:hover { color: var(--accent); }
.sort-ind { font-size: 10px; margin-left: 3px; opacity: .6; }
td { padding: 13px 16px; font-size: 13.5px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--bg3); }
.mono { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; letter-spacing: -.3px; }

.section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.section-header h3 {
  font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 700;
  color: var(--text2); text-transform: uppercase; letter-spacing: .8px;
}
.section-header .line { flex: 1; height: 1px; background: var(--border); }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex;
  align-items: center; justify-content: center; z-index: 100; padding: 20px;
  backdrop-filter: blur(6px);
}
.modal {
  background: var(--bg2); border: 1px solid var(--border); border-radius: 14px;
  width: 100%; max-width: 580px; max-height: 90vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,.15);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 22px 26px; border-bottom: 1px solid var(--border);
}
.modal-header h3 { font-family: 'Outfit', sans-serif; font-size: 17px; font-weight: 700; }
.modal-body { padding: 26px; }
.modal-footer { padding: 16px 26px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }

.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; font-weight: 600; color: var(--text2); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px; }
.form-input, .form-select, .form-textarea {
  width: 100%; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; color: var(--text); font-size: 13.5px;
  font-family: 'Outfit', sans-serif; outline: none; transition: border-color .15s;
}
.form-input:focus, .form-select:focus, .form-textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
.form-textarea { resize: vertical; min-height: 70px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text2); }
.empty-state p { margin-top: 12px; font-size: 14px; }

.filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 20px; }
.filter-chip {
  padding: 7px 16px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; border: 1px solid var(--border); background: var(--bg2);
  color: var(--text2); transition: all .15s;
}
.filter-chip:hover { border-color: var(--text3); color: var(--text); }
.filter-chip.active { background: var(--navy); color: #fff; border-color: var(--navy); }

.welcome-banner {
  background: var(--navy); border-radius: 14px; padding: 32px 36px;
  margin-bottom: 28px; position: relative; overflow: hidden;
  box-shadow: 0 4px 20px rgba(30,42,58,.25);
}
.welcome-banner::before {
  content: ''; position: absolute; top: -40px; right: -20px;
  width: 180px; height: 180px; border-radius: 50%;
  background: var(--accent); opacity: .12;
}
.welcome-banner::after {
  content: ''; position: absolute; bottom: -60px; right: 60px;
  width: 120px; height: 120px; border-radius: 50%;
  background: var(--accent); opacity: .08;
}
.welcome-banner h2 {
  font-size: 24px; font-weight: 800; color: #fff; margin-bottom: 6px;
  letter-spacing: -0.5px; position: relative; z-index: 1;
}
.welcome-banner p {
  font-size: 14px; color: rgba(255,255,255,.55); position: relative; z-index: 1;
}
.welcome-banner .fletacar-accent { color: var(--accent); }

.toast-container {
  position: fixed; bottom: 24px; right: 24px; z-index: 300;
  display: flex; flex-direction: column-reverse; gap: 8px; pointer-events: none;
}
.toast {
  padding: 13px 22px; border-radius: 10px; font-size: 13px; font-weight: 600;
  display: flex; align-items: center; gap: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.18);
  animation: toastIn .35s ease; pointer-events: auto; font-family: 'Outfit', sans-serif;
}
.toast-success { background: #1e7a3e; color: #fff; }
.toast-error { background: #c42b2b; color: #fff; }
.toast-info { background: var(--navy); color: #fff; }
@keyframes toastIn { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.chart-wrap {
  background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 24px; margin-bottom: 28px; box-shadow: var(--shadow-sm);
}

@media (max-width: 768px) {
  .sidebar { width: 64px; min-width: 64px; }
  .sidebar-logo h1, .sidebar-logo .loc, .nav-label, .sidebar-footer, .nav-section-label, .dark-label { display: none; }
  .sidebar-logo { justify-content: center; padding: 18px 8px; }
  .nav-item { justify-content: center; padding: 11px; }
  .dark-toggle { justify-content: center; }
  .content { padding: 16px; }
  .topbar { padding: 0 16px; }
  .form-row { grid-template-columns: 1fr; }
  .stat-grid { grid-template-columns: 1fr 1fr; }
  table { font-size: 12px; }
  th, td { padding: 8px 10px; }
  .hide-mobile { display: none; }
  .welcome-banner { padding: 24px 20px; }
  .welcome-banner h2 { font-size: 18px; }
}
`;

// ─── Icons ───
const Icon = ({ type, size = 18 }) => {
  const s = { width: size, height: size, display: "inline-block", verticalAlign: "middle" };
  const icons = {
    dashboard: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    facturas: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    hojas_ruta: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 10-16 0c0 3 2.7 7 8 11.7z"/></svg>,
    clientes: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
    plus: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    search: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    trash: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>,
    edit: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    truck: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    close: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    alert: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    clock: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    download: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    duplicate: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
    sun: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
    moon: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    csv: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>,
    backup: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
    check: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    upload: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  };
  return icons[type] || null;
};

// ─── Small components ───
const Badge = ({ label }) => (
  <span style={{
    display: "inline-block", padding: "3px 10px", borderRadius: 4,
    fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
    background: (estadoColor[label] || "#888") + "22",
    color: estadoColor[label] || "#888",
    border: `1px solid ${estadoColor[label] || "#888"}44`,
    textTransform: "uppercase",
  }}>{label}</span>
);

function ToastContainer({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <Icon type={t.type === "error" ? "alert" : "check"} size={16} />
          {t.message}
        </div>
      ))}
    </div>
  );
}

function MiniChart({ data }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = 100 / data.length;
  return (
    <svg viewBox="0 0 400 160" style={{ width: "100%", height: 160 }}>
      {data.map((d, i) => {
        const h = (d.value / max) * 110;
        const x = i * (400 / data.length) + 10;
        const w = (400 / data.length) - 20;
        return (
          <g key={i}>
            <rect x={x} y={120 - h} width={w} height={h} rx={5} fill="var(--accent)" opacity={d.value > 0 ? 0.8 : 0.15} />
            {d.value > 0 && (
              <text x={x + w / 2} y={115 - h} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="'JetBrains Mono', monospace" fill="var(--text2)">
                {formatCurrency(d.value).replace(/\s/g, "")}
              </text>
            )}
            <text x={x + w / 2} y={145} textAnchor="middle" fontSize="11" fontWeight="600" fontFamily="'Outfit', sans-serif" fill="var(--text3)">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Toast hook ───
function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((message, type = "success") => {
    const id = generateId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);
  return { toasts, show };
}

// ─── PDF Generators ───
function generateFacturaPDF(f) {
  const doc = new jsPDF();
  const base = parseFloat(f.importe) || 0;
  const ivaPct = parseFloat(f.iva) || 0;
  const ivaAmount = base * (ivaPct / 100);
  const total = base + ivaAmount;
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(30, 42, 58);
  doc.rect(0, 0, pageW, 52, "F");
  doc.setFillColor(200, 75, 26);
  doc.rect(0, 52, pageW, 3, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("FLETACAR", 20, 26);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Fletacar S.L.  ·  Valencia, España", 20, 35);
  doc.text("Gestión de Fletes y Logística", 20, 42);

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURA", pageW - 20, 22, { align: "right" });
  doc.setFontSize(16);
  doc.text(f.numero || "Sin número", pageW - 20, 34, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text((f.estado || "").toUpperCase(), pageW - 20, 44, { align: "right" });

  let y = 72;
  doc.setTextColor(120, 117, 108);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE", 20, y);
  doc.text("FECHA EMISIÓN", 110, y);
  doc.text("FECHA VENCIMIENTO", 155, y);
  y += 7;
  doc.setTextColor(26, 24, 20);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(f.cliente || "—", 20, y);
  doc.setFontSize(10);
  doc.text(formatDate(f.fecha), 110, y);
  doc.text(formatDate(f.vencimiento), 155, y);

  y += 18;
  doc.setDrawColor(221, 216, 208);
  doc.setLineWidth(0.4);
  doc.line(20, y, pageW - 20, y);
  y += 14;

  doc.setFillColor(243, 241, 237);
  doc.rect(20, y - 6, pageW - 40, 14, "F");
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(120, 117, 108);
  doc.text("CONCEPTO", 26, y + 2);
  doc.text("BASE", 120, y + 2, { align: "right" });
  doc.text("IVA", 150, y + 2, { align: "right" });
  doc.text("TOTAL", pageW - 26, y + 2, { align: "right" });
  y += 16;

  doc.setTextColor(26, 24, 20);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const conceptoLines = doc.splitTextToSize(f.concepto || "Servicio de transporte", 85);
  doc.text(conceptoLines, 26, y);
  doc.text(formatCurrency(base), 120, y, { align: "right" });
  doc.text(`${ivaPct}%`, 150, y, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(formatCurrency(total), pageW - 26, y, { align: "right" });

  y += Math.max(conceptoLines.length * 5, 8) + 12;
  doc.setDrawColor(221, 216, 208);
  doc.line(20, y, pageW - 20, y);
  y += 12;

  const boxX = pageW - 100;
  doc.setFillColor(250, 249, 247);
  doc.setDrawColor(221, 216, 208);
  doc.roundedRect(boxX, y - 4, 80, 48, 3, 3, "FD");
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 117, 108);
  doc.text("Base imponible", boxX + 8, y + 6);
  doc.setTextColor(26, 24, 20);
  doc.text(formatCurrency(base), boxX + 72, y + 6, { align: "right" });
  doc.setTextColor(120, 117, 108);
  doc.text(`IVA (${ivaPct}%)`, boxX + 8, y + 17);
  doc.setTextColor(26, 24, 20);
  doc.text(formatCurrency(ivaAmount), boxX + 72, y + 17, { align: "right" });
  doc.setDrawColor(200, 75, 26);
  doc.setLineWidth(0.6);
  doc.line(boxX + 6, y + 24, boxX + 74, y + 24);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(200, 75, 26);
  doc.text("TOTAL", boxX + 8, y + 36);
  doc.text(formatCurrency(total), boxX + 72, y + 36, { align: "right" });
  y += 60;

  if (f.notas) {
    doc.setTextColor(120, 117, 108);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("NOTAS", 20, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 78, 72);
    const notasLines = doc.splitTextToSize(f.notas, pageW - 40);
    doc.text(notasLines, 20, y);
  }

  const footerY = doc.internal.pageSize.getHeight() - 16;
  doc.setDrawColor(221, 216, 208);
  doc.setLineWidth(0.3);
  doc.line(20, footerY - 8, pageW - 20, footerY - 8);
  doc.setFontSize(8);
  doc.setTextColor(160, 154, 144);
  doc.setFont("helvetica", "normal");
  doc.text("Fletacar S.L.  ·  Valencia, España  ·  Documento generado automáticamente", pageW / 2, footerY, { align: "center" });

  doc.save(`Factura_${f.numero || "borrador"}.pdf`);
}

function generateRutaPDF(r) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(30, 42, 58);
  doc.rect(0, 0, pageW, 52, "F");
  doc.setFillColor(200, 75, 26);
  doc.rect(0, 52, pageW, 3, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("FLETACAR", 20, 26);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Fletacar S.L.  ·  Valencia, España", 20, 35);
  doc.text("Gestión de Fletes y Logística", 20, 42);

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("HOJA DE RUTA", pageW - 20, 22, { align: "right" });
  doc.setFontSize(16);
  doc.text(r.codigo || "Sin código", pageW - 20, 34, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text((r.estado || "").toUpperCase(), pageW - 20, 44, { align: "right" });

  let y = 72;

  // Info grid
  const infoFields = [
    ["CONDUCTOR", r.conductor || "—"],
    ["VEHÍCULO", r.vehiculo || "—"],
    ["FECHA", formatDate(r.fecha)],
    ["ESTADO", r.estado || "—"],
  ];
  infoFields.forEach(([label, value], i) => {
    const col = i % 2 === 0 ? 20 : 110;
    if (i === 2) y += 20;
    doc.setTextColor(120, 117, 108);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(label, col, y);
    doc.setTextColor(26, 24, 20);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(value, col, y + 7);
  });
  y += 28;

  // Separator
  doc.setDrawColor(221, 216, 208);
  doc.setLineWidth(0.4);
  doc.line(20, y, pageW - 20, y);
  y += 16;

  // Route visualization
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(120, 117, 108);
  doc.text("ITINERARIO", 20, y);
  y += 12;

  const stops = [r.origen || "Origen"];
  if (r.paradas) r.paradas.split(",").map(p => p.trim()).filter(Boolean).forEach(p => stops.push(p));
  stops.push(r.destino || "Destino");

  stops.forEach((stop, i) => {
    const isFirst = i === 0;
    const isLast = i === stops.length - 1;
    // Circle
    if (isFirst || isLast) {
      doc.setFillColor(200, 75, 26);
      doc.circle(30, y, 4, "F");
      doc.setTextColor(200, 75, 26);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setFillColor(221, 216, 208);
      doc.circle(30, y, 3, "F");
      doc.setTextColor(26, 24, 20);
      doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(11);
    doc.text(stop, 42, y + 1);

    // Connecting line
    if (!isLast) {
      doc.setDrawColor(200, 200, 190);
      doc.setLineWidth(0.8);
      doc.line(30, y + 5, 30, y + 18);
    }
    y += 22;
  });

  y += 6;
  doc.setDrawColor(221, 216, 208);
  doc.setLineWidth(0.4);
  doc.line(20, y, pageW - 20, y);
  y += 14;

  // Details boxes
  const details = [];
  if (r.bultos) details.push(["BULTOS", r.bultos]);
  if (r.km) details.push(["KM ESTIMADOS", `${parseInt(r.km).toLocaleString("es-ES")} km`]);

  if (details.length) {
    details.forEach(([label, value], i) => {
      const bx = 20 + i * 80;
      doc.setFillColor(250, 249, 247);
      doc.setDrawColor(221, 216, 208);
      doc.roundedRect(bx, y - 2, 70, 30, 3, 3, "FD");
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(120, 117, 108);
      doc.text(label, bx + 10, y + 8);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(26, 24, 20);
      doc.text(String(value), bx + 10, y + 22);
    });
    y += 40;
  }

  if (r.notas) {
    doc.setTextColor(120, 117, 108);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("NOTAS", 20, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 78, 72);
    const notasLines = doc.splitTextToSize(r.notas, pageW - 40);
    doc.text(notasLines, 20, y);
  }

  const footerY = doc.internal.pageSize.getHeight() - 16;
  doc.setDrawColor(221, 216, 208);
  doc.setLineWidth(0.3);
  doc.line(20, footerY - 8, pageW - 20, footerY - 8);
  doc.setFontSize(8);
  doc.setTextColor(160, 154, 144);
  doc.setFont("helvetica", "normal");
  doc.text("Fletacar S.L.  ·  Valencia, España  ·  Documento generado automáticamente", pageW / 2, footerY, { align: "center" });

  doc.save(`HojaRuta_${r.codigo || "borrador"}.pdf`);
}

// ─── Forms ───
function Modal({ title, onClose, children, onSave, saveLabel = "Guardar" }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn btn-icon" onClick={onClose} style={{ boxShadow: "none" }}><Icon type="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={onSave}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

function FacturaForm({ data, onChange, clientes }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  const handleClienteSelect = (e) => {
    const id = e.target.value;
    if (id === "__manual__") {
      set("clienteId", "");
    } else {
      const c = clientes.find(c => c.id === id);
      onChange({ ...data, clienteId: id, cliente: c ? c.nombre : "" });
    }
  };
  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Nº Factura</label>
          <input className="form-input" placeholder="FLC-001" value={data.numero} onChange={e => set("numero", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Cliente</label>
          {clientes.length > 0 ? (
            <>
              <select className="form-select" value={data.clienteId || "__manual__"} onChange={handleClienteSelect} style={{ marginBottom: 8 }}>
                <option value="__manual__">Escribir manualmente</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.nif ? ` (${c.nif})` : ""}</option>)}
              </select>
              {!data.clienteId && (
                <input className="form-input" placeholder="Nombre del cliente" value={data.cliente} onChange={e => set("cliente", e.target.value)} />
              )}
            </>
          ) : (
            <input className="form-input" placeholder="Nombre del cliente" value={data.cliente} onChange={e => set("cliente", e.target.value)} />
          )}
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Fecha emisión</label>
          <input className="form-input" type="date" value={data.fecha} onChange={e => set("fecha", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Fecha vencimiento</label>
          <input className="form-input" type="date" value={data.vencimiento} onChange={e => set("vencimiento", e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Importe base (€)</label>
          <input className="form-input" type="number" step="0.01" placeholder="0.00" value={data.importe} onChange={e => set("importe", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">IVA (%)</label>
          <select className="form-select" value={data.iva} onChange={e => set("iva", e.target.value)}>
            <option value="0">0% (Exento)</option><option value="4">4% (Superreducido)</option>
            <option value="10">10% (Reducido)</option><option value="21">21% (General)</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Concepto</label>
        <input className="form-input" placeholder="Transporte de mercancía, flete nacional..." value={data.concepto} onChange={e => set("concepto", e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Estado</label>
        <select className="form-select" value={data.estado} onChange={e => set("estado", e.target.value)}>
          {ESTADO_FACTURA.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Notas</label>
        <textarea className="form-textarea" placeholder="Observaciones adicionales..." value={data.notas} onChange={e => set("notas", e.target.value)} />
      </div>
    </>
  );
}

function RutaForm({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Código ruta</label>
          <input className="form-input" placeholder="FLC-R001" value={data.codigo} onChange={e => set("codigo", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Fecha</label>
          <input className="form-input" type="date" value={data.fecha} onChange={e => set("fecha", e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Conductor</label>
          <input className="form-input" placeholder="Nombre completo" value={data.conductor} onChange={e => set("conductor", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Vehículo / Matrícula</label>
          <input className="form-input" placeholder="1234 ABC" value={data.vehiculo} onChange={e => set("vehiculo", e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Origen</label>
          <input className="form-input" placeholder="Valencia" value={data.origen} onChange={e => set("origen", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Destino</label>
          <input className="form-input" placeholder="Ciudad / cliente" value={data.destino} onChange={e => set("destino", e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Nº Bultos</label>
          <input className="form-input" type="number" placeholder="0" value={data.bultos} onChange={e => set("bultos", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Km estimados</label>
          <input className="form-input" type="number" placeholder="0" value={data.km} onChange={e => set("km", e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Estado</label>
        <select className="form-select" value={data.estado} onChange={e => set("estado", e.target.value)}>
          {ESTADO_RUTA.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Paradas intermedias (separadas por coma)</label>
        <input className="form-input" placeholder="Albacete, Madrid, Zaragoza..." value={data.paradas} onChange={e => set("paradas", e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Notas</label>
        <textarea className="form-textarea" placeholder="Observaciones de la ruta..." value={data.notas} onChange={e => set("notas", e.target.value)} />
      </div>
    </>
  );
}

function ClienteForm({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Nombre / Razón social</label>
          <input className="form-input" placeholder="Empresa S.L." value={data.nombre} onChange={e => set("nombre", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">NIF / CIF</label>
          <input className="form-input" placeholder="B12345678" value={data.nif} onChange={e => set("nif", e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Dirección</label>
        <input className="form-input" placeholder="Calle, número, piso..." value={data.direccion} onChange={e => set("direccion", e.target.value)} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Ciudad</label>
          <input className="form-input" placeholder="Valencia" value={data.ciudad} onChange={e => set("ciudad", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Código Postal</label>
          <input className="form-input" placeholder="46001" value={data.cp} onChange={e => set("cp", e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Teléfono</label>
          <input className="form-input" placeholder="600 000 000" value={data.telefono} onChange={e => set("telefono", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" placeholder="email@ejemplo.com" value={data.email} onChange={e => set("email", e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Notas</label>
        <textarea className="form-textarea" placeholder="Observaciones..." value={data.notas} onChange={e => set("notas", e.target.value)} />
      </div>
    </>
  );
}

// ─── Main App ───
export default function FletacarApp() {
  const [tab, setTab] = useState("dashboard");
  const [facturas, setFacturas] = useState([]);
  const [rutas, setRutas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState("Todos");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, dir: "asc" });
  const { toasts, show: toast } = useToast();
  const restoreRef = useRef(null);

  useEffect(() => {
    const f = loadData(STORAGE_KEYS.facturas);
    const fixed = detectOverdueInvoices(f);
    setFacturas(fixed);
    if (JSON.stringify(f) !== JSON.stringify(fixed)) saveData(STORAGE_KEYS.facturas, fixed);
    setRutas(loadData(STORAGE_KEYS.hojas_ruta));
    setClientes(loadData(STORAGE_KEYS.clientes));
    setDarkMode(localStorage.getItem(STORAGE_KEYS.darkMode) === "true");
    setLoading(false);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem(STORAGE_KEYS.darkMode, String(darkMode));
  }, [darkMode]);

  const updateFacturas = useCallback((d) => { setFacturas(d); saveData(STORAGE_KEYS.facturas, d); }, []);
  const updateRutas = useCallback((d) => { setRutas(d); saveData(STORAGE_KEYS.hojas_ruta, d); }, []);
  const updateClientes = useCallback((d) => { setClientes(d); saveData(STORAGE_KEYS.clientes, d); }, []);

  const openNew = (type) => {
    if (type === "factura") {
      setModal({ type, mode: "new", data: { ...emptyFactura, numero: getNextNumber(facturas, "FLC-", "numero"), fecha: new Date().toISOString().slice(0, 10) } });
    } else if (type === "ruta") {
      setModal({ type, mode: "new", data: { ...emptyRuta, codigo: getNextNumber(rutas, "FLC-R", "codigo"), fecha: new Date().toISOString().slice(0, 10) } });
    } else {
      setModal({ type, mode: "new", data: { ...emptyCliente } });
    }
  };
  const openEdit = (type, item) => setModal({ type, mode: "edit", data: { ...item }, id: item.id });

  const handleSave = () => {
    if (!modal) return;
    const { type, mode, data, id } = modal;
    if (type === "factura") {
      if (mode === "new") updateFacturas([{ ...data, id: generateId(), createdAt: Date.now() }, ...facturas]);
      else updateFacturas(facturas.map(f => f.id === id ? { ...f, ...data } : f));
      toast(mode === "new" ? "Factura creada" : "Factura actualizada");
    } else if (type === "ruta") {
      if (mode === "new") updateRutas([{ ...data, id: generateId(), createdAt: Date.now() }, ...rutas]);
      else updateRutas(rutas.map(r => r.id === id ? { ...r, ...data } : r));
      toast(mode === "new" ? "Hoja de ruta creada" : "Hoja de ruta actualizada");
    } else {
      if (mode === "new") updateClientes([{ ...data, id: generateId(), createdAt: Date.now() }, ...clientes]);
      else updateClientes(clientes.map(c => c.id === id ? { ...c, ...data } : c));
      toast(mode === "new" ? "Cliente creado" : "Cliente actualizado");
    }
    setModal(null);
  };

  const handleDelete = (type, id) => {
    if (type === "factura") updateFacturas(facturas.filter(f => f.id !== id));
    else if (type === "ruta") updateRutas(rutas.filter(r => r.id !== id));
    else updateClientes(clientes.filter(c => c.id !== id));
    toast("Eliminado correctamente");
    setConfirmDelete(null);
  };

  const handleDuplicate = (type, item) => {
    const clone = { ...item, id: generateId(), createdAt: Date.now() };
    if (type === "factura") {
      clone.numero = getNextNumber(facturas, "FLC-", "numero");
      clone.estado = "Pendiente";
      updateFacturas([clone, ...facturas]);
      toast("Factura duplicada");
    } else if (type === "ruta") {
      clone.codigo = getNextNumber(rutas, "FLC-R", "codigo");
      clone.estado = "Planificada";
      updateRutas([clone, ...rutas]);
      toast("Hoja de ruta duplicada");
    }
  };

  const toggleSort = (key) => {
    setSortConfig(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };
  const sortInd = (key) => sortConfig.key === key ? <span className="sort-ind">{sortConfig.dir === "asc" ? "▲" : "▼"}</span> : null;

  // Stats
  const totalFacturado = facturas.reduce((s, f) => s + (parseFloat(f.importe) || 0) * (1 + (parseFloat(f.iva) || 0) / 100), 0);
  const facturasPendientes = facturas.filter(f => f.estado === "Pendiente").length;
  const facturasVencidas = facturas.filter(f => f.estado === "Vencida").length;
  const cobrado = facturas.filter(f => f.estado === "Pagada").reduce((s, f) => s + (parseFloat(f.importe) || 0) * (1 + (parseFloat(f.iva) || 0) / 100), 0);
  const rutasActivas = rutas.filter(r => r.estado === "En curso" || r.estado === "Planificada").length;
  const rutasCompletadas = rutas.filter(r => r.estado === "Completada").length;
  const totalBultos = rutas.reduce((s, r) => s + (parseInt(r.bultos) || 0), 0);
  const totalKm = rutas.reduce((s, r) => s + (parseInt(r.km) || 0), 0);

  // Filters
  const filteredFacturas = sortItems(facturas.filter(f => {
    const ms = !search || [f.numero, f.cliente, f.concepto].some(v => (v || "").toLowerCase().includes(search.toLowerCase()));
    const me = filterEstado === "Todos" || f.estado === filterEstado;
    return ms && me;
  }), sortConfig);

  const filteredRutas = sortItems(rutas.filter(r => {
    const ms = !search || [r.codigo, r.conductor, r.origen, r.destino, r.vehiculo].some(v => (v || "").toLowerCase().includes(search.toLowerCase()));
    const me = filterEstado === "Todos" || r.estado === filterEstado;
    return ms && me;
  }), sortConfig);

  const filteredClientes = sortItems(clientes.filter(c => {
    return !search || [c.nombre, c.nif, c.ciudad, c.email].some(v => (v || "").toLowerCase().includes(search.toLowerCase()));
  }), sortConfig);

  // CSV exports
  const exportFacturasCSV = () => {
    exportCSV(facturas, [
      { key: "numero", label: "Nº Factura" }, { key: "cliente", label: "Cliente" },
      { key: "fecha", label: "Fecha" }, { key: "vencimiento", label: "Vencimiento" },
      { key: "importe", label: "Base (€)" }, { key: "iva", label: "IVA %" },
      { key: "concepto", label: "Concepto" }, { key: "estado", label: "Estado" },
    ], "facturas_fletacar.csv");
    toast("CSV de facturas exportado");
  };
  const exportRutasCSV = () => {
    exportCSV(rutas, [
      { key: "codigo", label: "Código" }, { key: "conductor", label: "Conductor" },
      { key: "vehiculo", label: "Vehículo" }, { key: "origen", label: "Origen" },
      { key: "destino", label: "Destino" }, { key: "paradas", label: "Paradas" },
      { key: "bultos", label: "Bultos" }, { key: "km", label: "Km" },
      { key: "fecha", label: "Fecha" }, { key: "estado", label: "Estado" },
    ], "rutas_fletacar.csv");
    toast("CSV de rutas exportado");
  };
  const exportClientesCSV = () => {
    exportCSV(clientes, [
      { key: "nombre", label: "Nombre" }, { key: "nif", label: "NIF" },
      { key: "direccion", label: "Dirección" }, { key: "ciudad", label: "Ciudad" },
      { key: "cp", label: "CP" }, { key: "telefono", label: "Teléfono" },
      { key: "email", label: "Email" },
    ], "clientes_fletacar.csv");
    toast("CSV de clientes exportado");
  };

  // Backup / Restore
  const handleBackup = () => {
    exportJSON({ facturas, hojas_ruta: rutas, clientes });
    toast("Backup descargado");
  };
  const handleRestore = async (file) => {
    if (!file) return;
    try {
      const data = await importJSON(file);
      if (data.facturas) updateFacturas(data.facturas);
      if (data.hojas_ruta) updateRutas(data.hojas_ruta);
      if (data.clientes) updateClientes(data.clientes);
      toast("Datos restaurados correctamente");
    } catch {
      toast("Error al importar datos", "error");
    }
    if (restoreRef.current) restoreRef.current.value = "";
  };

  const switchTab = (t) => {
    setTab(t); setSearch(""); setFilterEstado("Todos");
    setSortConfig({ key: null, dir: "asc" });
  };

  const getNewLabel = () => {
    if (tab === "facturas") return "Nueva Factura";
    if (tab === "hojas_ruta") return "Nueva Ruta";
    if (tab === "clientes") return "Nuevo Cliente";
    return "";
  };
  const getNewType = () => {
    if (tab === "facturas") return "factura";
    if (tab === "hojas_ruta") return "ruta";
    return "cliente";
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'Outfit', sans-serif", gap: 12 }}>
      <div style={{ width: 32, height: 32, background: "#c84b1a", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14 }}>F</div>
      Cargando Fletacar...
    </div>
  );

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* ─── Sidebar ─── */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-mark">F</div>
            <div>
              <h1>Fletacar</h1>
              <div className="loc">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 10-16 0c0 3 2.7 7 8 11.7z"/></svg>
                Valencia, España
              </div>
            </div>
          </div>
          <nav className="sidebar-nav">
            <div className="nav-section-label">Gestión</div>
            {TABS.map(t => (
              <div key={t} className={`nav-item ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>
                <Icon type={t === "dashboard" ? "dashboard" : t} />
                <span className="nav-label">{tabLabels[t]}</span>
              </div>
            ))}
          </nav>
          <div className="dark-toggle" onClick={() => setDarkMode(!darkMode)}>
            <Icon type={darkMode ? "sun" : "moon"} size={16} />
            <span className="dark-label">{darkMode ? "Modo Claro" : "Modo Oscuro"}</span>
          </div>
          <div className="sidebar-footer">
            <span className="empresa">Fletacar S.L.</span>
            <span>Valencia · v2.0</span>
          </div>
        </aside>

        {/* ─── Main ─── */}
        <div className="main">
          <header className="topbar">
            <h2>{tabLabels[tab]}</h2>
            <div className="topbar-actions">
              {tab === "dashboard" && (
                <>
                  <button className="btn btn-sm" onClick={handleBackup}><Icon type="backup" size={14} /> <span className="hide-mobile">Backup</span></button>
                  <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                    <Icon type="upload" size={14} /> <span className="hide-mobile">Restaurar</span>
                    <input ref={restoreRef} type="file" accept=".json" hidden onChange={e => handleRestore(e.target.files[0])} />
                  </label>
                </>
              )}
              {tab !== "dashboard" && (
                <>
                  <div className="search-box">
                    <Icon type="search" size={15} />
                    <input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                  {tab === "facturas" && <button className="btn btn-sm" onClick={exportFacturasCSV}><Icon type="csv" size={14} /> <span className="hide-mobile">CSV</span></button>}
                  {tab === "hojas_ruta" && <button className="btn btn-sm" onClick={exportRutasCSV}><Icon type="csv" size={14} /> <span className="hide-mobile">CSV</span></button>}
                  {tab === "clientes" && <button className="btn btn-sm" onClick={exportClientesCSV}><Icon type="csv" size={14} /> <span className="hide-mobile">CSV</span></button>}
                  <button className="btn btn-primary" onClick={() => openNew(getNewType())}>
                    <Icon type="plus" size={15} /> <span className="hide-mobile">{getNewLabel()}</span>
                  </button>
                </>
              )}
            </div>
          </header>

          <div className="content">
            {/* ─── Dashboard ─── */}
            {tab === "dashboard" && (
              <>
                <div className="welcome-banner">
                  <h2>Bienvenido a <span className="fletacar-accent">Fletacar</span></h2>
                  <p>Panel de control · Gestión de fletes y logística desde Valencia</p>
                </div>

                <div className="section-header"><h3>Facturación</h3><div className="line" /></div>
                <div className="stat-grid">
                  <div className="stat-card">
                    <div className="stat-icon amber"><Icon type="facturas" size={20} /></div>
                    <div className="stat-label">Total Facturado</div>
                    <div className="stat-value" style={{ color: "var(--warning)", fontSize: 23 }}>{formatCurrency(totalFacturado)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon green"><Icon type="facturas" size={20} /></div>
                    <div className="stat-label">Cobrado</div>
                    <div className="stat-value" style={{ color: "var(--success)", fontSize: 23 }}>{formatCurrency(cobrado)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon blue"><Icon type="clock" size={20} /></div>
                    <div className="stat-label">Pendientes</div>
                    <div className="stat-value">{facturasPendientes}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon red"><Icon type="alert" size={20} /></div>
                    <div className="stat-label">Vencidas</div>
                    <div className="stat-value" style={{ color: "var(--danger)" }}>{facturasVencidas}</div>
                  </div>
                </div>

                <div className="section-header"><h3>Ingresos Mensuales (Cobrado)</h3><div className="line" /></div>
                <div className="chart-wrap">
                  {facturas.some(f => f.estado === "Pagada") ? (
                    <MiniChart data={getMonthlyRevenue(facturas, 6)} />
                  ) : (
                    <div className="empty-state" style={{ padding: "30px 20px" }}><p>No hay datos de cobro para mostrar</p></div>
                  )}
                </div>

                <div className="section-header"><h3>Logística y Rutas</h3><div className="line" /></div>
                <div className="stat-grid">
                  <div className="stat-card">
                    <div className="stat-icon blue"><Icon type="truck" size={20} /></div>
                    <div className="stat-label">Rutas Activas</div>
                    <div className="stat-value">{rutasActivas}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon green"><Icon type="hojas_ruta" size={20} /></div>
                    <div className="stat-label">Completadas</div>
                    <div className="stat-value" style={{ color: "var(--success)" }}>{rutasCompletadas}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon amber"><Icon type="truck" size={20} /></div>
                    <div className="stat-label">Bultos Totales</div>
                    <div className="stat-value">{totalBultos.toLocaleString("es-ES")}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon blue"><Icon type="hojas_ruta" size={20} /></div>
                    <div className="stat-label">Km Recorridos</div>
                    <div className="stat-value">{totalKm.toLocaleString("es-ES")}</div>
                  </div>
                </div>

                <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                  <div className="stat-card">
                    <div className="stat-icon blue"><Icon type="clientes" size={20} /></div>
                    <div className="stat-label">Clientes</div>
                    <div className="stat-value">{clientes.length}</div>
                  </div>
                </div>

                <div className="section-header"><h3>Últimas Facturas</h3><div className="line" /></div>
                {facturas.length === 0 ? (
                  <div className="empty-state"><Icon type="facturas" size={40} /><p>No hay facturas registradas aún</p>
                    <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { switchTab("facturas"); setTimeout(() => openNew("factura"), 100); }}><Icon type="plus" size={15} /> Crear factura</button>
                  </div>
                ) : (
                  <div className="table-wrap" style={{ marginBottom: 28 }}>
                    <table>
                      <thead><tr><th>Nº</th><th>Cliente</th><th>Importe</th><th>Estado</th><th className="hide-mobile">Fecha</th></tr></thead>
                      <tbody>
                        {facturas.slice(0, 5).map(f => (
                          <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => switchTab("facturas")}>
                            <td className="mono">{f.numero || "—"}</td>
                            <td>{f.cliente || "—"}</td>
                            <td className="mono">{f.importe ? formatCurrency(parseFloat(f.importe) * (1 + (parseFloat(f.iva) || 0) / 100)) : "—"}</td>
                            <td><Badge label={f.estado} /></td>
                            <td className="mono hide-mobile">{formatDate(f.fecha)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="section-header"><h3>Últimas Hojas de Ruta</h3><div className="line" /></div>
                {rutas.length === 0 ? (
                  <div className="empty-state"><Icon type="hojas_ruta" size={40} /><p>No hay hojas de ruta registradas aún</p>
                    <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { switchTab("hojas_ruta"); setTimeout(() => openNew("ruta"), 100); }}><Icon type="plus" size={15} /> Crear ruta</button>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Código</th><th>Conductor</th><th>Ruta</th><th>Estado</th><th className="hide-mobile">Fecha</th></tr></thead>
                      <tbody>
                        {rutas.slice(0, 5).map(r => (
                          <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => switchTab("hojas_ruta")}>
                            <td className="mono">{r.codigo || "—"}</td>
                            <td>{r.conductor || "—"}</td>
                            <td>{r.origen && r.destino ? `${r.origen} → ${r.destino}` : "—"}</td>
                            <td><Badge label={r.estado} /></td>
                            <td className="mono hide-mobile">{formatDate(r.fecha)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ─── Facturas ─── */}
            {tab === "facturas" && (
              <>
                <div className="filter-bar" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["Todos", ...ESTADO_FACTURA].map(e => (
                      <span key={e} className={`filter-chip ${filterEstado === e ? "active" : ""}`} onClick={() => setFilterEstado(e)}>{e}</span>
                    ))}
                  </div>
                </div>
                {filteredFacturas.length === 0 ? (
                  <div className="empty-state"><Icon type="facturas" size={48} /><p>{facturas.length === 0 ? "Aún no has creado ninguna factura" : "No se encontraron resultados"}</p>
                    {facturas.length === 0 && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => openNew("factura")}><Icon type="plus" size={15} /> Crear primera factura</button>}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th className="sortable" onClick={() => toggleSort("numero")}>Nº Factura{sortInd("numero")}</th>
                          <th className="sortable" onClick={() => toggleSort("cliente")}>Cliente{sortInd("cliente")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("concepto")}>Concepto{sortInd("concepto")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("fecha")}>Fecha{sortInd("fecha")}</th>
                          <th className="sortable" onClick={() => toggleSort("importe")}>Importe Total{sortInd("importe")}</th>
                          <th className="sortable" onClick={() => toggleSort("estado")}>Estado{sortInd("estado")}</th>
                          <th style={{ width: 150 }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFacturas.map(f => {
                          const total = (parseFloat(f.importe) || 0) * (1 + (parseFloat(f.iva) || 0) / 100);
                          return (
                            <tr key={f.id}>
                              <td className="mono">{f.numero || "—"}</td>
                              <td>{f.cliente || "—"}</td>
                              <td className="hide-mobile" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.concepto || "—"}</td>
                              <td className="mono hide-mobile">{formatDate(f.fecha)}</td>
                              <td className="mono">{formatCurrency(total)}</td>
                              <td><Badge label={f.estado} /></td>
                              <td>
                                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                  <button className="btn btn-sm" onClick={() => generateFacturaPDF(f)} title="Descargar PDF" style={{ background: "var(--accent)", color: "#fff", borderColor: "var(--accent)", padding: "5px 10px", fontSize: 11 }}>
                                    <Icon type="download" size={13} /> PDF
                                  </button>
                                  <button className="btn btn-icon btn-sm" onClick={() => handleDuplicate("factura", f)} title="Duplicar"><Icon type="duplicate" size={14} /></button>
                                  <button className="btn btn-icon btn-sm" onClick={() => openEdit("factura", f)} title="Editar"><Icon type="edit" size={14} /></button>
                                  <button className="btn btn-icon btn-sm btn-danger" onClick={() => setConfirmDelete({ type: "factura", id: f.id, label: f.numero || "esta factura" })} title="Eliminar"><Icon type="trash" size={14} /></button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ─── Hojas de Ruta ─── */}
            {tab === "hojas_ruta" && (
              <>
                <div className="filter-bar">
                  {["Todos", ...ESTADO_RUTA].map(e => (
                    <span key={e} className={`filter-chip ${filterEstado === e ? "active" : ""}`} onClick={() => setFilterEstado(e)}>{e}</span>
                  ))}
                </div>
                {filteredRutas.length === 0 ? (
                  <div className="empty-state"><Icon type="hojas_ruta" size={48} /><p>{rutas.length === 0 ? "Aún no has creado ninguna hoja de ruta" : "No se encontraron resultados"}</p>
                    {rutas.length === 0 && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => openNew("ruta")}><Icon type="plus" size={15} /> Crear primera ruta</button>}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th className="sortable" onClick={() => toggleSort("codigo")}>Código{sortInd("codigo")}</th>
                          <th className="sortable" onClick={() => toggleSort("conductor")}>Conductor{sortInd("conductor")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("vehiculo")}>Vehículo{sortInd("vehiculo")}</th>
                          <th className="sortable" onClick={() => toggleSort("destino")}>Ruta{sortInd("destino")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("bultos")}>Bultos{sortInd("bultos")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("km")}>Km{sortInd("km")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("fecha")}>Fecha{sortInd("fecha")}</th>
                          <th className="sortable" onClick={() => toggleSort("estado")}>Estado{sortInd("estado")}</th>
                          <th style={{ width: 150 }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRutas.map(r => (
                          <tr key={r.id}>
                            <td className="mono">{r.codigo || "—"}</td>
                            <td>{r.conductor || "—"}</td>
                            <td className="mono hide-mobile">{r.vehiculo || "—"}</td>
                            <td>
                              {r.origen && r.destino ? `${r.origen} → ${r.destino}` : "—"}
                              {r.paradas && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>vía {r.paradas}</div>}
                            </td>
                            <td className="hide-mobile">{r.bultos || "—"}</td>
                            <td className="mono hide-mobile">{r.km ? `${parseInt(r.km).toLocaleString("es-ES")} km` : "—"}</td>
                            <td className="mono hide-mobile">{formatDate(r.fecha)}</td>
                            <td><Badge label={r.estado} /></td>
                            <td>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button className="btn btn-icon btn-sm" onClick={() => generateRutaPDF(r)} title="Descargar PDF"><Icon type="download" size={14} /></button>
                                <button className="btn btn-icon btn-sm" onClick={() => handleDuplicate("ruta", r)} title="Duplicar"><Icon type="duplicate" size={14} /></button>
                                <button className="btn btn-icon btn-sm" onClick={() => openEdit("ruta", r)} title="Editar"><Icon type="edit" size={14} /></button>
                                <button className="btn btn-icon btn-sm btn-danger" onClick={() => setConfirmDelete({ type: "ruta", id: r.id, label: r.codigo || "esta ruta" })} title="Eliminar"><Icon type="trash" size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ─── Clientes ─── */}
            {tab === "clientes" && (
              <>
                {filteredClientes.length === 0 ? (
                  <div className="empty-state"><Icon type="clientes" size={48} /><p>{clientes.length === 0 ? "Aún no has registrado ningún cliente" : "No se encontraron resultados"}</p>
                    {clientes.length === 0 && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => openNew("cliente")}><Icon type="plus" size={15} /> Crear primer cliente</button>}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th className="sortable" onClick={() => toggleSort("nombre")}>Nombre{sortInd("nombre")}</th>
                          <th className="sortable" onClick={() => toggleSort("nif")}>NIF{sortInd("nif")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("ciudad")}>Ciudad{sortInd("ciudad")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("telefono")}>Teléfono{sortInd("telefono")}</th>
                          <th className="sortable hide-mobile" onClick={() => toggleSort("email")}>Email{sortInd("email")}</th>
                          <th style={{ width: 90 }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClientes.map(c => (
                          <tr key={c.id}>
                            <td style={{ fontWeight: 600 }}>{c.nombre || "—"}</td>
                            <td className="mono">{c.nif || "—"}</td>
                            <td className="hide-mobile">{c.ciudad || "—"}</td>
                            <td className="mono hide-mobile">{c.telefono || "—"}</td>
                            <td className="hide-mobile">{c.email || "—"}</td>
                            <td>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button className="btn btn-icon btn-sm" onClick={() => openEdit("cliente", c)} title="Editar"><Icon type="edit" size={14} /></button>
                                <button className="btn btn-icon btn-sm btn-danger" onClick={() => setConfirmDelete({ type: "cliente", id: c.id, label: c.nombre || "este cliente" })} title="Eliminar"><Icon type="trash" size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ─── Modals ─── */}
        {modal && (
          <Modal
            title={`${modal.mode === "new" ? (modal.type === "cliente" ? "Nuevo" : "Nueva") : "Editar"} ${modal.type === "factura" ? "Factura" : modal.type === "ruta" ? "Hoja de Ruta" : "Cliente"}`}
            onClose={() => setModal(null)}
            onSave={handleSave}
          >
            {modal.type === "factura"
              ? <FacturaForm data={modal.data} onChange={d => setModal({ ...modal, data: d })} clientes={clientes} />
              : modal.type === "ruta"
              ? <RutaForm data={modal.data} onChange={d => setModal({ ...modal, data: d })} />
              : <ClienteForm data={modal.data} onChange={d => setModal({ ...modal, data: d })} />}
          </Modal>
        )}

        {confirmDelete && (
          <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
              <div className="modal-header"><h3>Confirmar eliminación</h3></div>
              <div className="modal-body" style={{ textAlign: "center" }}>
                <div style={{ color: "var(--danger)", marginBottom: 14 }}><Icon type="alert" size={38} /></div>
                <p style={{ fontSize: 15 }}>¿Eliminar <strong>{confirmDelete.label}</strong>?</p>
                <p style={{ color: "var(--text2)", fontSize: 13, marginTop: 8 }}>Esta acción no se puede deshacer.</p>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                <button className="btn" style={{ background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" }} onClick={() => handleDelete(confirmDelete.type, confirmDelete.id)}>Eliminar</button>
              </div>
            </div>
          </div>
        )}

        <ToastContainer toasts={toasts} />
      </div>
    </>
  );
}
