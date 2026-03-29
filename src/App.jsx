import { useState, useEffect, useCallback, useRef } from "react";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const TABS = ["dashboard", "facturas", "hojas_ruta", "clientes", "fiscal", "ajustes"];
const tabLabels = { dashboard: "Panel de Control", facturas: "Facturas", hojas_ruta: "Hojas de Ruta", clientes: "Clientes", fiscal: "Libro IVA", ajustes: "Ajustes" };
const ESTADO_FACTURA = ["Pendiente", "Pagada", "Vencida", "Anulada"];
const ESTADO_RUTA = ["Planificada", "En curso", "Completada", "Cancelada"];
const estadoColor = {
  Pendiente: "#e8a735", Pagada: "#2ecc71", Vencida: "#e74c3c", Anulada: "#95a5a6",
  Planificada: "#3498db", "En curso": "#e8a735", Completada: "#2ecc71", Cancelada: "#e74c3c",
};

const IVA_OPTIONS = [
  { value: "21", label: "21% General" },
  { value: "10", label: "10% Reducido" },
  { value: "4", label: "4% Superreducido" },
  { value: "0", label: "0% Exento" },
];
const RECARGO_EQ_RATES = { "21": 5.2, "10": 1.4, "4": 0.5, "0": 0 };
const IRPF_OPTIONS = [
  { value: "0", label: "Sin retención" },
  { value: "7", label: "7% (nuevo autónomo)" },
  { value: "15", label: "15% (autónomo)" },
];
const TIPO_FACTURA = ["Completa", "Simplificada", "Rectificativa"];
const FORMAS_PAGO = ["Transferencia bancaria", "Efectivo", "Domiciliación bancaria", "Tarjeta", "Pagaré", "Compensación"];

const STORAGE_KEYS = {
  facturas: "fletacar_facturas", hojas_ruta: "fletacar_hojas_ruta",
  clientes: "fletacar_clientes", empresa: "fletacar_empresa",
  darkMode: "fletacar_darkMode",
};

const defaultEmpresa = {
  razonSocial: "Fletacar S.L.", nif: "", direccion: "", ciudad: "Valencia",
  cp: "", provincia: "Valencia", telefono: "", email: "", web: "",
  iban: "", registroMercantil: "", esAutonomo: false,
  serieFactura: "FLC", serieRectificativa: "FLC-R",
};

const emptyFactura = {
  numero: "", serie: "", clienteId: "", cliente: "", clienteNif: "", clienteDireccion: "",
  fecha: "", vencimiento: "", importe: "", iva: "21",
  recargoEquivalencia: false, irpf: "0",
  concepto: "", tipoFactura: "Completa",
  facturaRectificadaNum: "", motivoRectificacion: "",
  formaPago: "Transferencia bancaria", estado: "Pendiente", notas: "",
  verifactuHash: "", verifactuPrevHash: "", verifactuTimestamp: "",
};
const emptyRuta = { codigo: "", conductor: "", vehiculo: "", fecha: "", origen: "Valencia", destino: "", estado: "Planificada", paradas: "", bultos: "", km: "", notas: "" };
const emptyCliente = { nombre: "", nif: "", direccion: "", ciudad: "", cp: "", provincia: "", telefono: "", email: "", notas: "" };

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════
const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const formatCurrency = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
const formatDate = (d) => { if (!d) return "—"; return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }); };

const loadData = (key) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : []; } catch { return []; } };
const loadObj = (key, def) => { try { const r = localStorage.getItem(key); return r ? { ...def, ...JSON.parse(r) } : def; } catch { return def; } };
const saveData = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error(e); } };

function computeAmounts(f) {
  const base = parseFloat(f.importe) || 0;
  const ivaPct = parseFloat(f.iva) || 0;
  const cuotaIva = Math.round(base * ivaPct) / 100;
  const recargoRate = f.recargoEquivalencia ? (RECARGO_EQ_RATES[f.iva] || 0) : 0;
  const cuotaRecargo = Math.round(base * recargoRate) / 100;
  const irpfPct = parseFloat(f.irpf) || 0;
  const cuotaIrpf = Math.round(base * irpfPct) / 100;
  const total = base + cuotaIva + cuotaRecargo - cuotaIrpf;
  return { base, ivaPct, cuotaIva, recargoRate, cuotaRecargo, irpfPct, cuotaIrpf, total };
}

function getNextFacturaNumber(facturas, serie) {
  const year = new Date().getFullYear();
  const prefix = `${serie}-${year}-`;
  let max = 0;
  facturas.forEach(f => {
    if ((f.numero || "").startsWith(prefix)) {
      const n = parseInt(f.numero.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefix + String(max + 1).padStart(4, "0");
}

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
  return facturas.map(f => f.estado === "Pendiente" && f.vencimiento && f.vencimiento < today ? { ...f, estado: "Vencida" } : f);
}

async function computeVerifactuHash(data, prevHash) {
  const record = `${data.numero}|${data.fecha}|${data.nifEmisor}|${data.clienteNif}|${data.total}|${new Date().toISOString()}|${prevHash || "GENESIS"}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(record));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function exportCSV(rows, columns, filename) {
  const h = columns.map(c => c.label).join(";");
  const b = rows.map(r => columns.map(c => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + h + "\n" + b], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function exportJSON(data) {
  const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `fletacar_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
}
function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => { try { const d = JSON.parse(e.target.result); if (typeof d !== "object" || d === null) throw 0; resolve(d); } catch { reject(new Error("Formato inválido")); } };
    reader.onerror = () => reject(new Error("Error de lectura"));
    reader.readAsText(file);
  });
}

function getMonthlyRevenue(facturas, months = 6) {
  const now = new Date();
  const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const result = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let sum = 0;
    facturas.forEach(f => { if (f.estado === "Pagada" && f.fecha && f.fecha.startsWith(key)) { sum += computeAmounts(f).total; } });
    result.push({ label: names[d.getMonth()], value: sum });
  }
  return result;
}

function getResumenTrimestral(facturas, year) {
  const trimestres = [[0,1,2],[3,4,5],[6,7,8],[9,10,11]];
  return trimestres.map((months, qi) => {
    const filtered = facturas.filter(f => {
      if (!f.fecha || f.estado === "Anulada") return false;
      const d = new Date(f.fecha);
      return d.getFullYear() === year && months.includes(d.getMonth());
    });
    let totalBase = 0, totalIva = 0, totalRecargo = 0, totalIrpf = 0, totalFinal = 0;
    filtered.forEach(f => {
      const a = computeAmounts(f);
      totalBase += a.base; totalIva += a.cuotaIva; totalRecargo += a.cuotaRecargo;
      totalIrpf += a.cuotaIrpf; totalFinal += a.total;
    });
    return { label: `${qi + 1}T ${year}`, count: filtered.length, totalBase, totalIva, totalRecargo, totalIrpf, totalFinal };
  });
}

function sortItems(items, config) {
  if (!config.key) return items;
  return [...items].sort((a, b) => {
    let aV = a[config.key], bV = b[config.key];
    if (!isNaN(parseFloat(aV)) && !isNaN(parseFloat(bV))) { aV = parseFloat(aV); bV = parseFloat(bV); }
    else { aV = String(aV || "").toLowerCase(); bV = String(bV || "").toLowerCase(); }
    if (aV < bV) return config.dir === "asc" ? -1 : 1;
    if (aV > bV) return config.dir === "asc" ? 1 : -1;
    return 0;
  });
}

// ═══════════════════════════════════════════
// CSS
// ═══════════════════════════════════════════
const css = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
:root {
  --bg:#faf9f7;--bg2:#fff;--bg3:#f3f1ed;--bg4:#e8e5df;
  --border:#ddd8d0;--text:#1a1814;--text2:#7a756c;--text3:#a09a90;
  --accent:#c84b1a;--accent2:#a83d14;--accent-light:#c84b1a15;--accent-mid:#c84b1a30;
  --navy:#1e2a3a;--navy-light:#2c3e50;
  --success:#2d8a4e;--success-bg:#2d8a4e12;--warning:#c87b1a;--warning-bg:#c87b1a12;
  --danger:#c42b2b;--danger-bg:#c42b2b10;--blue:#2563eb;--blue-bg:#2563eb10;
  --radius:10px;--shadow-sm:0 1px 3px rgba(0,0,0,.06);--shadow-md:0 4px 16px rgba(0,0,0,.08);
}
[data-theme="dark"]{
  --bg:#111117;--bg2:#1a1a24;--bg3:#22222e;--bg4:#2a2a38;
  --border:#33334a;--text:#e4e4ec;--text2:#8888a4;--text3:#5a5a74;
  --accent:#e05522;--accent2:#c84b1a;--accent-light:#e0552218;--accent-mid:#e0552230;
  --navy:#0c0c16;--navy-light:#161622;
  --success:#3ddc84;--success-bg:#3ddc8415;--warning:#ffb74d;--warning-bg:#ffb74d15;
  --danger:#ff5252;--danger-bg:#ff525215;--blue:#448aff;--blue-bg:#448aff15;
  --shadow-sm:0 1px 4px rgba(0,0,0,.25);--shadow-md:0 4px 20px rgba(0,0,0,.35);
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif;-webkit-font-smoothing:antialiased}
.app{display:flex;height:100vh;width:100%;overflow:hidden}
.sidebar{width:256px;min-width:256px;background:var(--navy);display:flex;flex-direction:column}
.sidebar-logo{padding:24px 22px 20px;display:flex;align-items:center;gap:14px;border-bottom:1px solid rgba(255,255,255,.08)}
.sidebar-logo .logo-mark{width:42px;height:42px;background:var(--accent);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;font-family:'Outfit',sans-serif;letter-spacing:-1px;box-shadow:0 2px 8px rgba(200,75,26,.35)}
.sidebar-logo h1{font-size:20px;font-weight:800;color:#fff;letter-spacing:-.5px;line-height:1.15}
.sidebar-logo .loc{font-size:11.5px;color:rgba(255,255,255,.45);font-weight:400;display:flex;align-items:center;gap:4px;margin-top:1px}
.sidebar-nav{padding:20px 14px;flex:1;overflow-y:auto}
.nav-section-label{font-size:10px;font-weight:700;color:rgba(255,255,255,.25);text-transform:uppercase;letter-spacing:1.5px;padding:0 12px;margin-bottom:10px;margin-top:16px}
.nav-section-label:first-child{margin-top:0}
.nav-item{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;color:rgba(255,255,255,.55);transition:all .15s;margin-bottom:3px}
.nav-item:hover{background:rgba(255,255,255,.07);color:rgba(255,255,255,.85)}
.nav-item.active{background:var(--accent);color:#fff;box-shadow:0 2px 8px rgba(200,75,26,.3)}
.dark-toggle{display:flex;align-items:center;gap:12px;padding:11px 14px;margin:0 14px 6px;border-radius:8px;cursor:pointer;color:rgba(255,255,255,.45);font-size:13px;font-weight:500;transition:all .15s}
.dark-toggle:hover{background:rgba(255,255,255,.07);color:rgba(255,255,255,.8)}
.sidebar-footer{padding:18px 22px;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:rgba(255,255,255,.2);display:flex;flex-direction:column;gap:2px}
.sidebar-footer .empresa{color:rgba(255,255,255,.35);font-weight:600}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
.topbar{height:68px;min-height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 32px;border-bottom:1px solid var(--border);background:var(--bg2);box-shadow:var(--shadow-sm)}
.topbar h2{font-size:18px;font-weight:700;letter-spacing:-.3px}
.topbar-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.content{flex:1;overflow-y:auto;padding:32px}
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg2);color:var(--text);transition:all .15s;font-family:'Outfit',sans-serif;box-shadow:var(--shadow-sm)}
.btn:hover{background:var(--bg3);border-color:var(--text3)}
.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 2px 8px rgba(200,75,26,.25)}
.btn-primary:hover{background:var(--accent2);border-color:var(--accent2)}
.btn-danger{color:var(--danger);border-color:rgba(196,43,43,.25);box-shadow:none}
.btn-danger:hover{background:var(--danger-bg)}
.btn-sm{padding:6px 12px;font-size:12px}
.btn-icon{padding:7px;width:34px;height:34px;justify-content:center;box-shadow:none}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;margin-bottom:28px}
.stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:22px;box-shadow:var(--shadow-sm);transition:box-shadow .2s}
.stat-card:hover{box-shadow:var(--shadow-md)}
.stat-card .stat-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.stat-card .stat-icon.amber{background:var(--warning-bg);color:var(--warning)}
.stat-card .stat-icon.green{background:var(--success-bg);color:var(--success)}
.stat-card .stat-icon.red{background:var(--danger-bg);color:var(--danger)}
.stat-card .stat-icon.blue{background:var(--blue-bg);color:var(--blue)}
.stat-label{font-size:12px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.7px;font-weight:600}
.stat-value{font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:700;letter-spacing:-1px}
.search-box{display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:0 12px;transition:border-color .15s}
.search-box:focus-within{border-color:var(--accent)}
.search-box input{background:none;border:none;color:var(--text);font-size:13px;padding:9px 0;width:200px;outline:none;font-family:'Outfit',sans-serif}
.search-box input::placeholder{color:var(--text3)}
.table-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);overflow-x:auto;box-shadow:var(--shadow-sm)}
table{width:100%;border-collapse:collapse;min-width:700px}
thead{background:var(--bg3)}
th{padding:12px 16px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text2);text-align:left;border-bottom:1px solid var(--border)}
th.sortable{cursor:pointer;user-select:none;transition:color .15s}
th.sortable:hover{color:var(--accent)}
.sort-ind{font-size:10px;margin-left:3px;opacity:.6}
td{padding:13px 16px;font-size:13.5px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--bg3)}
.mono{font-family:'JetBrains Mono',monospace;font-size:12.5px;letter-spacing:-.3px}
.section-header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.section-header h3{font-size:14px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;white-space:nowrap}
.section-header .line{flex:1;height:1px;background:var(--border)}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px;backdrop-filter:blur(6px)}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:14px;width:100%;max-width:640px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.15)}
.modal-header{display:flex;align-items:center;justify-content:space-between;padding:22px 26px;border-bottom:1px solid var(--border)}
.modal-header h3{font-size:17px;font-weight:700}
.modal-body{padding:26px}
.modal-footer{padding:16px 26px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px}
.form-group{margin-bottom:18px}
.form-label{display:block;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
.form-input,.form-select,.form-textarea{width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13.5px;font-family:'Outfit',sans-serif;outline:none;transition:border-color .15s}
.form-input:focus,.form-select:focus,.form-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-light)}
.form-input:read-only{background:var(--bg3);color:var(--text2)}
.form-textarea{resize:vertical;min-height:70px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.form-check{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;color:var(--text2)}
.form-check input[type="checkbox"]{width:18px;height:18px;accent-color:var(--accent);cursor:pointer}
.empty-state{text-align:center;padding:60px 20px;color:var(--text2)}
.empty-state p{margin-top:12px;font-size:14px}
.filter-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}
.filter-chip{padding:7px 16px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg2);color:var(--text2);transition:all .15s}
.filter-chip:hover{border-color:var(--text3);color:var(--text)}
.filter-chip.active{background:var(--navy);color:#fff;border-color:var(--navy)}
.welcome-banner{background:var(--navy);border-radius:14px;padding:32px 36px;margin-bottom:28px;position:relative;overflow:hidden;box-shadow:0 4px 20px rgba(30,42,58,.25)}
.welcome-banner::before{content:'';position:absolute;top:-40px;right:-20px;width:180px;height:180px;border-radius:50%;background:var(--accent);opacity:.12}
.welcome-banner::after{content:'';position:absolute;bottom:-60px;right:60px;width:120px;height:120px;border-radius:50%;background:var(--accent);opacity:.08}
.welcome-banner h2{font-size:24px;font-weight:800;color:#fff;margin-bottom:6px;letter-spacing:-.5px;position:relative;z-index:1}
.welcome-banner p{font-size:14px;color:rgba(255,255,255,.55);position:relative;z-index:1}
.welcome-banner .fletacar-accent{color:var(--accent)}
.toast-container{position:fixed;bottom:24px;right:24px;z-index:300;display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none}
.toast{padding:13px 22px;border-radius:10px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);animation:toastIn .35s ease;pointer-events:auto;font-family:'Outfit',sans-serif}
.toast-success{background:#1e7a3e;color:#fff}
.toast-error{background:#c42b2b;color:#fff}
@keyframes toastIn{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
.chart-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:28px;box-shadow:var(--shadow-sm)}
.amounts-box{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px 20px;margin-top:8px}
.amounts-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:var(--text2)}
.amounts-row.total{font-weight:700;font-size:15px;color:var(--accent);border-top:2px solid var(--accent);margin-top:6px;padding-top:10px}
.fiscal-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px;box-shadow:var(--shadow-sm)}
.fiscal-card h4{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:16px}
.ajustes-section{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:28px;margin-bottom:20px;box-shadow:var(--shadow-sm)}
.ajustes-section h3{font-size:16px;font-weight:700;margin-bottom:20px;letter-spacing:-.3px}
.verifactu-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;background:#2d8a4e15;color:#2d8a4e;border:1px solid #2d8a4e30;text-transform:uppercase;letter-spacing:.5px}
@media(max-width:768px){
  .sidebar{width:64px;min-width:64px}
  .sidebar-logo h1,.sidebar-logo .loc,.nav-label,.sidebar-footer,.nav-section-label,.dark-label{display:none}
  .sidebar-logo{justify-content:center;padding:18px 8px}
  .nav-item{justify-content:center;padding:11px}
  .dark-toggle{justify-content:center}
  .content{padding:16px}.topbar{padding:0 16px}
  .form-row,.form-row-3{grid-template-columns:1fr}
  .stat-grid{grid-template-columns:1fr 1fr}
  table{font-size:12px}th,td{padding:8px 10px}
  .hide-mobile{display:none}
  .welcome-banner{padding:24px 20px}.welcome-banner h2{font-size:18px}
}
`;

// ═══════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════
const Icon = ({ type, size = 18 }) => {
  const s = { width: size, height: size, display: "inline-block", verticalAlign: "middle" };
  const icons = {
    dashboard: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    facturas: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
    hojas_ruta: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 10-16 0c0 3 2.7 7 8 11.7z"/></svg>,
    clientes: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
    fiscal: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/></svg>,
    ajustes: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
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

// ═══════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════
const Badge = ({ label }) => (
  <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, background: (estadoColor[label] || "#888") + "22", color: estadoColor[label] || "#888", border: `1px solid ${estadoColor[label] || "#888"}44`, textTransform: "uppercase" }}>{label}</span>
);

function ToastContainer({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}><Icon type={t.type === "error" ? "alert" : "check"} size={16} />{t.message}</div>)}</div>;
}

function MiniChart({ data }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <svg viewBox="0 0 400 160" style={{ width: "100%", height: 160 }}>
      {data.map((d, i) => {
        const h = (d.value / max) * 110;
        const x = i * (400 / data.length) + 10;
        const w = (400 / data.length) - 20;
        return (
          <g key={i}>
            <rect x={x} y={120 - h} width={w} height={h} rx={5} fill="var(--accent)" opacity={d.value > 0 ? 0.8 : 0.15} />
            {d.value > 0 && <text x={x + w / 2} y={115 - h} textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono',monospace" fill="var(--text2)">{formatCurrency(d.value).replace(/\s/g, "")}</text>}
            <text x={x + w / 2} y={145} textAnchor="middle" fontSize="11" fontWeight="600" fontFamily="'Outfit',sans-serif" fill="var(--text3)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function AmountsPreview({ data }) {
  const a = computeAmounts(data);
  return (
    <div className="amounts-box">
      <div className="amounts-row"><span>Base imponible</span><span className="mono">{formatCurrency(a.base)}</span></div>
      <div className="amounts-row"><span>IVA ({a.ivaPct}%)</span><span className="mono">{formatCurrency(a.cuotaIva)}</span></div>
      {a.cuotaRecargo > 0 && <div className="amounts-row"><span>Recargo equiv. ({a.recargoRate}%)</span><span className="mono">{formatCurrency(a.cuotaRecargo)}</span></div>}
      {a.cuotaIrpf > 0 && <div className="amounts-row"><span>Retención IRPF ({a.irpfPct}%)</span><span className="mono" style={{ color: "var(--danger)" }}>-{formatCurrency(a.cuotaIrpf)}</span></div>}
      <div className="amounts-row total"><span>TOTAL FACTURA</span><span className="mono">{formatCurrency(a.total)}</span></div>
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((message, type = "success") => {
    const id = generateId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);
  return { toasts, show };
}

// ═══════════════════════════════════════════
// PDF GENERATORS
// ═══════════════════════════════════════════
async function generateFacturaPDF(f, empresa) {
  const doc = new jsPDF();
  const a = computeAmounts(f);
  const W = doc.internal.pageSize.getWidth();

  // Generate QR
  let qrDataUrl = null;
  try {
    const qrContent = `https://www2.agenciatributaria.gob.es/verifactu?nif=${encodeURIComponent(empresa.nif)}&num=${encodeURIComponent(f.numero)}&fecha=${encodeURIComponent(f.fecha)}&total=${a.total.toFixed(2)}`;
    qrDataUrl = await QRCode.toDataURL(qrContent, { width: 100, margin: 1 });
  } catch {}

  // Header
  doc.setFillColor(30, 42, 58); doc.rect(0, 0, W, 56, "F");
  doc.setFillColor(200, 75, 26); doc.rect(0, 56, W, 3, "F");

  doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.setFont("helvetica", "bold");
  doc.text(empresa.razonSocial || "Fletacar S.L.", 20, 20);
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
  doc.text(`NIF: ${empresa.nif || "Pendiente"}`, 20, 28);
  const addr = [empresa.direccion, empresa.cp, empresa.ciudad, empresa.provincia].filter(Boolean).join(", ");
  if (addr) doc.text(addr, 20, 34);
  const contact = [empresa.telefono, empresa.email].filter(Boolean).join("  ·  ");
  if (contact) doc.text(contact, 20, 40);
  if (empresa.registroMercantil) doc.text(empresa.registroMercantil, 20, 46);

  // Tipo + Número (right)
  doc.setFontSize(11); doc.setFont("helvetica", "bold");
  const tipoLabel = f.tipoFactura === "Rectificativa" ? "FACTURA RECTIFICATIVA" : f.tipoFactura === "Simplificada" ? "FACTURA SIMPLIFICADA" : "FACTURA";
  doc.text(tipoLabel, W - 20, 18, { align: "right" });
  doc.setFontSize(15);
  doc.text(f.numero || "—", W - 20, 30, { align: "right" });
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
  doc.text((f.estado || "").toUpperCase(), W - 20, 38, { align: "right" });
  if (f.tipoFactura === "Rectificativa" && f.facturaRectificadaNum) {
    doc.text(`Rectifica: ${f.facturaRectificadaNum}`, W - 20, 46, { align: "right" });
  }

  let y = 72;

  // Client block
  doc.setFillColor(243, 241, 237); doc.roundedRect(20, y - 6, W - 40, 32, 3, 3, "F");
  doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(120, 117, 108);
  doc.text("DATOS DEL CLIENTE", 26, y + 2);
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(26, 24, 20);
  doc.text(f.cliente || "—", 26, y + 12);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(80, 78, 72);
  const clientInfo = [`NIF: ${f.clienteNif || "—"}`, f.clienteDireccion || ""].filter(Boolean).join("  ·  ");
  doc.text(clientInfo, 26, y + 20);
  y += 40;

  // Dates
  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(120, 117, 108);
  doc.text("FECHA EMISIÓN", 20, y); doc.text("VENCIMIENTO", 80, y); doc.text("FORMA DE PAGO", 140, y);
  y += 7;
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(26, 24, 20);
  doc.text(formatDate(f.fecha), 20, y); doc.text(formatDate(f.vencimiento), 80, y);
  doc.text(f.formaPago || "—", 140, y);
  y += 5;
  if (f.formaPago === "Transferencia bancaria" && empresa.iban) {
    doc.setFontSize(8.5); doc.setTextColor(120, 117, 108);
    doc.text(`IBAN: ${empresa.iban}`, 140, y + 4);
    y += 6;
  }
  y += 10;

  // Table header
  doc.setDrawColor(221, 216, 208); doc.setLineWidth(0.4); doc.line(20, y, W - 20, y);
  y += 10;
  doc.setFillColor(243, 241, 237); doc.rect(20, y - 6, W - 40, 14, "F");
  doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(120, 117, 108);
  doc.text("CONCEPTO", 26, y + 2);
  doc.text("BASE", W - 90, y + 2, { align: "right" });
  doc.text("IVA", W - 55, y + 2, { align: "right" });
  doc.text("TOTAL", W - 26, y + 2, { align: "right" });
  y += 16;

  // Row
  doc.setTextColor(26, 24, 20); doc.setFontSize(10); doc.setFont("helvetica", "normal");
  const cLines = doc.splitTextToSize(f.concepto || "Servicio de transporte", 90);
  doc.text(cLines, 26, y);
  doc.text(formatCurrency(a.base), W - 90, y, { align: "right" });
  doc.text(`${a.ivaPct}%`, W - 55, y, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(formatCurrency(a.base + a.cuotaIva), W - 26, y, { align: "right" });
  y += Math.max(cLines.length * 5, 8) + 14;

  doc.setDrawColor(221, 216, 208); doc.line(20, y, W - 20, y);
  y += 14;

  // Desglose fiscal
  const boxX = W - 110; const boxW = 90;
  doc.setFillColor(250, 249, 247); doc.setDrawColor(221, 216, 208);
  let boxH = 62;
  if (a.cuotaRecargo > 0) boxH += 12;
  if (a.cuotaIrpf > 0) boxH += 12;
  doc.roundedRect(boxX, y - 4, boxW, boxH, 3, 3, "FD");

  let by = y + 6;
  const row = (label, val, color) => {
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(120, 117, 108);
    doc.text(label, boxX + 8, by);
    doc.setTextColor(...(color || [26, 24, 20]));
    doc.text(val, boxX + boxW - 8, by, { align: "right" });
    by += 12;
  };
  row("Base imponible", formatCurrency(a.base));
  row(`IVA (${a.ivaPct}%)`, formatCurrency(a.cuotaIva));
  if (a.cuotaRecargo > 0) row(`Rec. equiv. (${a.recargoRate}%)`, formatCurrency(a.cuotaRecargo));
  if (a.cuotaIrpf > 0) row(`IRPF (-${a.irpfPct}%)`, `-${formatCurrency(a.cuotaIrpf)}`, [196, 43, 43]);

  doc.setDrawColor(200, 75, 26); doc.setLineWidth(0.6);
  doc.line(boxX + 6, by - 4, boxX + boxW - 6, by - 4);
  by += 4;
  doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(200, 75, 26);
  doc.text("TOTAL", boxX + 8, by);
  doc.text(formatCurrency(a.total), boxX + boxW - 8, by, { align: "right" });

  // QR Verifactu
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, "PNG", 20, y - 2, 28, 28);
    doc.setFontSize(7); doc.setTextColor(160, 154, 144); doc.setFont("helvetica", "normal");
    doc.text("Verificación AEAT", 20, y + 29);
    if (f.verifactuHash) doc.text(f.verifactuHash.slice(0, 16) + "...", 20, y + 34);
  }

  y += boxH + 16;

  // Notas
  if (f.notas) {
    doc.setTextColor(120, 117, 108); doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
    doc.text("NOTAS", 20, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setTextColor(80, 78, 72); doc.setFontSize(8.5);
    doc.text(doc.splitTextToSize(f.notas, W - 40), 20, y);
  }

  // Footer
  const fy = doc.internal.pageSize.getHeight() - 14;
  doc.setDrawColor(221, 216, 208); doc.setLineWidth(0.3); doc.line(20, fy - 8, W - 20, fy - 8);
  doc.setFontSize(7); doc.setTextColor(160, 154, 144); doc.setFont("helvetica", "normal");
  doc.text("Factura generada conforme al RD 1619/2012  ·  Sistema Verifactu (Ley 11/2021, RD 1007/2023)", W / 2, fy - 2, { align: "center" });
  doc.text(`${empresa.razonSocial}  ·  NIF ${empresa.nif || "—"}  ·  ${empresa.ciudad || "Valencia"}`, W / 2, fy + 3, { align: "center" });

  doc.save(`Factura_${f.numero || "borrador"}.pdf`);
}

async function generateRutaPDF(r, empresa) {
  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(30, 42, 58); doc.rect(0, 0, W, 52, "F");
  doc.setFillColor(200, 75, 26); doc.rect(0, 52, W, 3, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.setFont("helvetica", "bold");
  doc.text(empresa.razonSocial || "Fletacar S.L.", 20, 24);
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
  doc.text(`NIF: ${empresa.nif || "—"}  ·  ${empresa.ciudad || "Valencia"}`, 20, 34);
  doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text("HOJA DE RUTA", W - 20, 22, { align: "right" });
  doc.setFontSize(16); doc.text(r.codigo || "—", W - 20, 34, { align: "right" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text((r.estado || "").toUpperCase(), W - 20, 44, { align: "right" });

  let y = 72;
  const field = (label, value, col) => {
    doc.setTextColor(120, 117, 108); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(label, col, y);
    doc.setTextColor(26, 24, 20); doc.setFontSize(11); doc.setFont("helvetica", "normal");
    doc.text(value || "—", col, y + 7);
  };
  field("CONDUCTOR", r.conductor, 20); field("VEHÍCULO", r.vehiculo, 110); y += 20;
  field("FECHA", formatDate(r.fecha), 20); field("ESTADO", r.estado, 110); y += 28;

  doc.setDrawColor(221, 216, 208); doc.setLineWidth(0.4); doc.line(20, y, W - 20, y); y += 16;
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(120, 117, 108);
  doc.text("ITINERARIO", 20, y); y += 12;

  const stops = [r.origen || "Origen"];
  if (r.paradas) r.paradas.split(",").map(p => p.trim()).filter(Boolean).forEach(p => stops.push(p));
  stops.push(r.destino || "Destino");
  stops.forEach((stop, i) => {
    const first = i === 0, last = i === stops.length - 1;
    if (first || last) { doc.setFillColor(200, 75, 26); doc.circle(30, y, 4, "F"); doc.setTextColor(200, 75, 26); doc.setFont("helvetica", "bold"); }
    else { doc.setFillColor(221, 216, 208); doc.circle(30, y, 3, "F"); doc.setTextColor(26, 24, 20); doc.setFont("helvetica", "normal"); }
    doc.setFontSize(11); doc.text(stop, 42, y + 1);
    if (!last) { doc.setDrawColor(200, 200, 190); doc.setLineWidth(0.8); doc.line(30, y + 5, 30, y + 18); }
    y += 22;
  });
  y += 6;
  if (r.bultos || r.km) {
    doc.setDrawColor(221, 216, 208); doc.line(20, y, W - 20, y); y += 14;
    if (r.bultos) { doc.setFillColor(250, 249, 247); doc.roundedRect(20, y - 2, 70, 30, 3, 3, "FD"); doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(120, 117, 108); doc.text("BULTOS", 30, y + 8); doc.setFontSize(14); doc.setTextColor(26, 24, 20); doc.text(String(r.bultos), 30, y + 22); }
    if (r.km) { const bx = r.bultos ? 100 : 20; doc.setFillColor(250, 249, 247); doc.roundedRect(bx, y - 2, 70, 30, 3, 3, "FD"); doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(120, 117, 108); doc.text("KM ESTIMADOS", bx + 10, y + 8); doc.setFontSize(14); doc.setTextColor(26, 24, 20); doc.text(`${parseInt(r.km).toLocaleString("es-ES")} km`, bx + 10, y + 22); }
    y += 40;
  }
  if (r.notas) {
    doc.setTextColor(120, 117, 108); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("NOTAS", 20, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setTextColor(80, 78, 72);
    doc.text(doc.splitTextToSize(r.notas, W - 40), 20, y);
  }
  const fy = doc.internal.pageSize.getHeight() - 16;
  doc.setDrawColor(221, 216, 208); doc.setLineWidth(0.3); doc.line(20, fy - 8, W - 20, fy - 8);
  doc.setFontSize(8); doc.setTextColor(160, 154, 144); doc.setFont("helvetica", "normal");
  doc.text(`${empresa.razonSocial}  ·  NIF ${empresa.nif || "—"}  ·  ${empresa.ciudad || "Valencia"}`, W / 2, fy, { align: "center" });
  doc.save(`HojaRuta_${r.codigo || "borrador"}.pdf`);
}

// ═══════════════════════════════════════════
// FORMS
// ═══════════════════════════════════════════
function Modal({ title, onClose, children, onSave, saveLabel = "Guardar" }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="btn btn-icon" onClick={onClose} style={{ boxShadow: "none" }}><Icon type="close" /></button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={onSave}>{saveLabel}</button></div>
      </div>
    </div>
  );
}

function FacturaForm({ data, onChange, clientes, facturas }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  const handleClienteSelect = (id) => {
    if (id === "__manual__") { set("clienteId", ""); }
    else {
      const c = clientes.find(c => c.id === id);
      if (c) onChange({ ...data, clienteId: id, cliente: c.nombre, clienteNif: c.nif || "", clienteDireccion: [c.direccion, c.cp, c.ciudad, c.provincia].filter(Boolean).join(", ") });
    }
  };
  return (
    <>
      <div className="form-row-3">
        <div className="form-group">
          <label className="form-label">Tipo factura</label>
          <select className="form-select" value={data.tipoFactura} onChange={e => set("tipoFactura", e.target.value)}>
            {TIPO_FACTURA.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Nº Factura</label>
          <input className="form-input" value={data.numero} readOnly style={{ fontFamily: "'JetBrains Mono', monospace" }} />
        </div>
        <div className="form-group">
          <label className="form-label">Estado</label>
          <select className="form-select" value={data.estado} onChange={e => set("estado", e.target.value)}>
            {ESTADO_FACTURA.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>

      {data.tipoFactura === "Rectificativa" && (
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Factura rectificada</label>
            <select className="form-select" value={data.facturaRectificadaNum} onChange={e => set("facturaRectificadaNum", e.target.value)}>
              <option value="">Seleccionar...</option>
              {facturas.filter(f => f.numero !== data.numero).map(f => <option key={f.id} value={f.numero}>{f.numero} - {f.cliente}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Motivo rectificación</label>
            <input className="form-input" placeholder="Motivo..." value={data.motivoRectificacion} onChange={e => set("motivoRectificacion", e.target.value)} />
          </div>
        </div>
      )}

      <div className="section-header" style={{ marginTop: 8 }}><h3>Cliente</h3><div className="line" /></div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Seleccionar cliente</label>
          {clientes.length > 0 ? (
            <select className="form-select" value={data.clienteId || "__manual__"} onChange={e => handleClienteSelect(e.target.value)}>
              <option value="__manual__">Escribir manualmente</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.nif ? ` (${c.nif})` : ""}</option>)}
            </select>
          ) : (
            <input className="form-input" placeholder="Nombre/razón social" value={data.cliente} onChange={e => set("cliente", e.target.value)} />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">NIF/CIF cliente</label>
          <input className="form-input" placeholder="B12345678" value={data.clienteNif} onChange={e => set("clienteNif", e.target.value)} readOnly={!!data.clienteId} />
        </div>
      </div>
      {!data.clienteId && clientes.length > 0 && (
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Nombre cliente</label>
            <input className="form-input" placeholder="Nombre/razón social" value={data.cliente} onChange={e => set("cliente", e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Dirección fiscal</label>
            <input className="form-input" placeholder="Dirección completa" value={data.clienteDireccion} onChange={e => set("clienteDireccion", e.target.value)} />
          </div>
        </div>
      )}

      <div className="section-header" style={{ marginTop: 8 }}><h3>Importes</h3><div className="line" /></div>
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
      <div className="form-group">
        <label className="form-label">Concepto / Descripción del servicio</label>
        <input className="form-input" placeholder="Transporte de mercancía, flete nacional..." value={data.concepto} onChange={e => set("concepto", e.target.value)} />
      </div>
      <div className="form-row-3">
        <div className="form-group">
          <label className="form-label">Base imponible (€)</label>
          <input className="form-input" type="number" step="0.01" placeholder="0.00" value={data.importe} onChange={e => set("importe", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Tipo IVA</label>
          <select className="form-select" value={data.iva} onChange={e => set("iva", e.target.value)}>
            {IVA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Retención IRPF</label>
          <select className="form-select" value={data.irpf} onChange={e => set("irpf", e.target.value)}>
            {IRPF_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-check">
            <input type="checkbox" checked={data.recargoEquivalencia || false} onChange={e => set("recargoEquivalencia", e.target.checked)} />
            Aplicar recargo de equivalencia ({RECARGO_EQ_RATES[data.iva] || 0}%)
          </label>
        </div>
        <div className="form-group">
          <label className="form-label">Forma de pago</label>
          <select className="form-select" value={data.formaPago} onChange={e => set("formaPago", e.target.value)}>
            {FORMAS_PAGO.map(fp => <option key={fp} value={fp}>{fp}</option>)}
          </select>
        </div>
      </div>
      <AmountsPreview data={data} />
      <div className="form-group" style={{ marginTop: 18 }}>
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
        <div className="form-group"><label className="form-label">Código ruta</label><input className="form-input" placeholder="FLC-R001" value={data.codigo} onChange={e => set("codigo", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Fecha</label><input className="form-input" type="date" value={data.fecha} onChange={e => set("fecha", e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Conductor</label><input className="form-input" placeholder="Nombre completo" value={data.conductor} onChange={e => set("conductor", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Vehículo / Matrícula</label><input className="form-input" placeholder="1234 ABC" value={data.vehiculo} onChange={e => set("vehiculo", e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Origen</label><input className="form-input" placeholder="Valencia" value={data.origen} onChange={e => set("origen", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Destino</label><input className="form-input" placeholder="Ciudad / cliente" value={data.destino} onChange={e => set("destino", e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Nº Bultos</label><input className="form-input" type="number" placeholder="0" value={data.bultos} onChange={e => set("bultos", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Km estimados</label><input className="form-input" type="number" placeholder="0" value={data.km} onChange={e => set("km", e.target.value)} /></div>
      </div>
      <div className="form-group"><label className="form-label">Estado</label><select className="form-select" value={data.estado} onChange={e => set("estado", e.target.value)}>{ESTADO_RUTA.map(e => <option key={e} value={e}>{e}</option>)}</select></div>
      <div className="form-group"><label className="form-label">Paradas intermedias (separadas por coma)</label><input className="form-input" placeholder="Albacete, Madrid, Zaragoza..." value={data.paradas} onChange={e => set("paradas", e.target.value)} /></div>
      <div className="form-group"><label className="form-label">Notas</label><textarea className="form-textarea" placeholder="Observaciones de la ruta..." value={data.notas} onChange={e => set("notas", e.target.value)} /></div>
    </>
  );
}

function ClienteForm({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Nombre / Razón social</label><input className="form-input" placeholder="Empresa S.L." value={data.nombre} onChange={e => set("nombre", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">NIF / CIF</label><input className="form-input" placeholder="B12345678" value={data.nif} onChange={e => set("nif", e.target.value)} /></div>
      </div>
      <div className="form-group"><label className="form-label">Dirección</label><input className="form-input" placeholder="Calle, número, piso..." value={data.direccion} onChange={e => set("direccion", e.target.value)} /></div>
      <div className="form-row-3">
        <div className="form-group"><label className="form-label">Ciudad</label><input className="form-input" placeholder="Valencia" value={data.ciudad} onChange={e => set("ciudad", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Código Postal</label><input className="form-input" placeholder="46001" value={data.cp} onChange={e => set("cp", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Provincia</label><input className="form-input" placeholder="Valencia" value={data.provincia} onChange={e => set("provincia", e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Teléfono</label><input className="form-input" placeholder="600 000 000" value={data.telefono} onChange={e => set("telefono", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" placeholder="email@ejemplo.com" value={data.email} onChange={e => set("email", e.target.value)} /></div>
      </div>
      <div className="form-group"><label className="form-label">Notas</label><textarea className="form-textarea" placeholder="Observaciones..." value={data.notas} onChange={e => set("notas", e.target.value)} /></div>
    </>
  );
}

// ═══════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════
export default function FletacarApp() {
  const [tab, setTab] = useState("dashboard");
  const [facturas, setFacturas] = useState([]);
  const [rutas, setRutas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [empresa, setEmpresa] = useState(defaultEmpresa);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState("Todos");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, dir: "asc" });
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const { toasts, show: toast } = useToast();
  const restoreRef = useRef(null);

  // Empresa form state for Ajustes
  const [empresaForm, setEmpresaForm] = useState(defaultEmpresa);

  useEffect(() => {
    const f = loadData(STORAGE_KEYS.facturas);
    const fixed = detectOverdueInvoices(f);
    setFacturas(fixed);
    if (JSON.stringify(f) !== JSON.stringify(fixed)) saveData(STORAGE_KEYS.facturas, fixed);
    setRutas(loadData(STORAGE_KEYS.hojas_ruta));
    setClientes(loadData(STORAGE_KEYS.clientes));
    const emp = loadObj(STORAGE_KEYS.empresa, defaultEmpresa);
    setEmpresa(emp); setEmpresaForm(emp);
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
  const updateEmpresa = useCallback((d) => { setEmpresa(d); saveData(STORAGE_KEYS.empresa, d); }, []);

  const openNew = (type) => {
    if (type === "factura") {
      const serie = empresa.serieFactura || "FLC";
      setModal({ type, mode: "new", data: { ...emptyFactura, numero: getNextFacturaNumber(facturas, serie), serie, fecha: new Date().toISOString().slice(0, 10) } });
    } else if (type === "ruta") {
      setModal({ type, mode: "new", data: { ...emptyRuta, codigo: getNextNumber(rutas, "FLC-R", "codigo"), fecha: new Date().toISOString().slice(0, 10) } });
    } else {
      setModal({ type, mode: "new", data: { ...emptyCliente } });
    }
  };
  const openEdit = (type, item) => setModal({ type, mode: "edit", data: { ...item }, id: item.id });

  const handleSave = async () => {
    if (!modal) return;
    const { type, mode, data, id } = modal;
    if (type === "factura") {
      let factura = { ...data };
      // Auto-set serie for rectificativas
      if (factura.tipoFactura === "Rectificativa" && mode === "new") {
        const serie = empresa.serieRectificativa || "FLC-R";
        factura.numero = getNextFacturaNumber(facturas, serie);
        factura.serie = serie;
      }
      // Compute and store amounts
      const amounts = computeAmounts(factura);
      factura.cuotaIva = amounts.cuotaIva;
      factura.cuotaRecargo = amounts.cuotaRecargo;
      factura.cuotaIrpf = amounts.cuotaIrpf;
      factura.total = amounts.total;
      // Verifactu hash for new invoices
      if (mode === "new") {
        try {
          const lastHash = facturas.length > 0 ? (facturas[0].verifactuHash || "") : "";
          const hash = await computeVerifactuHash({ ...factura, nifEmisor: empresa.nif, total: amounts.total }, lastHash);
          factura.verifactuHash = hash;
          factura.verifactuPrevHash = lastHash || "GENESIS";
          factura.verifactuTimestamp = new Date().toISOString();
        } catch {}
        updateFacturas([{ ...factura, id: generateId(), createdAt: Date.now() }, ...facturas]);
      } else {
        updateFacturas(facturas.map(f => f.id === id ? { ...f, ...factura } : f));
      }
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
    toast("Eliminado correctamente"); setConfirmDelete(null);
  };

  const handleDuplicate = (type, item) => {
    const clone = { ...item, id: generateId(), createdAt: Date.now() };
    if (type === "factura") {
      clone.numero = getNextFacturaNumber(facturas, empresa.serieFactura || "FLC");
      clone.estado = "Pendiente"; clone.verifactuHash = ""; clone.verifactuPrevHash = "";
      updateFacturas([clone, ...facturas]); toast("Factura duplicada");
    } else if (type === "ruta") {
      clone.codigo = getNextNumber(rutas, "FLC-R", "codigo"); clone.estado = "Planificada";
      updateRutas([clone, ...rutas]); toast("Hoja de ruta duplicada");
    }
  };

  const toggleSort = (key) => setSortConfig(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  const sortInd = (key) => sortConfig.key === key ? <span className="sort-ind">{sortConfig.dir === "asc" ? "▲" : "▼"}</span> : null;

  const switchTab = (t) => { setTab(t); setSearch(""); setFilterEstado("Todos"); setSortConfig({ key: null, dir: "asc" }); };

  // Stats
  const totalFacturado = facturas.reduce((s, f) => s + computeAmounts(f).total, 0);
  const facturasPendientes = facturas.filter(f => f.estado === "Pendiente").length;
  const facturasVencidas = facturas.filter(f => f.estado === "Vencida").length;
  const cobrado = facturas.filter(f => f.estado === "Pagada").reduce((s, f) => s + computeAmounts(f).total, 0);
  const rutasActivas = rutas.filter(r => r.estado === "En curso" || r.estado === "Planificada").length;
  const rutasCompletadas = rutas.filter(r => r.estado === "Completada").length;
  const totalBultos = rutas.reduce((s, r) => s + (parseInt(r.bultos) || 0), 0);
  const totalKm = rutas.reduce((s, r) => s + (parseInt(r.km) || 0), 0);

  // Filters
  const filteredFacturas = sortItems(facturas.filter(f => {
    const ms = !search || [f.numero, f.cliente, f.concepto, f.clienteNif].some(v => (v || "").toLowerCase().includes(search.toLowerCase()));
    return (filterEstado === "Todos" || f.estado === filterEstado) && ms;
  }), sortConfig);
  const filteredRutas = sortItems(rutas.filter(r => {
    const ms = !search || [r.codigo, r.conductor, r.origen, r.destino, r.vehiculo].some(v => (v || "").toLowerCase().includes(search.toLowerCase()));
    return (filterEstado === "Todos" || r.estado === filterEstado) && ms;
  }), sortConfig);
  const filteredClientes = sortItems(clientes.filter(c => !search || [c.nombre, c.nif, c.ciudad, c.email].some(v => (v || "").toLowerCase().includes(search.toLowerCase()))), sortConfig);

  // Fiscal
  const resumenTrimestral = getResumenTrimestral(facturas, fiscalYear);
  const libroFacturas = facturas.filter(f => {
    if (f.estado === "Anulada") return false;
    if (!f.fecha) return false;
    return new Date(f.fecha).getFullYear() === fiscalYear;
  });

  // CSV exports
  const exportFacturasCSV = () => { exportCSV(facturas, [{ key: "numero", label: "Nº" }, { key: "tipoFactura", label: "Tipo" }, { key: "cliente", label: "Cliente" }, { key: "clienteNif", label: "NIF Cliente" }, { key: "fecha", label: "Fecha" }, { key: "importe", label: "Base" }, { key: "iva", label: "IVA%" }, { key: "irpf", label: "IRPF%" }, { key: "formaPago", label: "Pago" }, { key: "estado", label: "Estado" }], "facturas_fletacar.csv"); toast("CSV exportado"); };
  const exportRutasCSV = () => { exportCSV(rutas, [{ key: "codigo", label: "Código" }, { key: "conductor", label: "Conductor" }, { key: "vehiculo", label: "Vehículo" }, { key: "origen", label: "Origen" }, { key: "destino", label: "Destino" }, { key: "bultos", label: "Bultos" }, { key: "km", label: "Km" }, { key: "fecha", label: "Fecha" }, { key: "estado", label: "Estado" }], "rutas_fletacar.csv"); toast("CSV exportado"); };
  const exportClientesCSV = () => { exportCSV(clientes, [{ key: "nombre", label: "Nombre" }, { key: "nif", label: "NIF" }, { key: "direccion", label: "Dirección" }, { key: "ciudad", label: "Ciudad" }, { key: "cp", label: "CP" }, { key: "provincia", label: "Provincia" }, { key: "telefono", label: "Teléfono" }, { key: "email", label: "Email" }], "clientes_fletacar.csv"); toast("CSV exportado"); };

  const handleBackup = () => { exportJSON({ facturas, hojas_ruta: rutas, clientes, empresa }); toast("Backup descargado"); };
  const handleRestore = async (file) => {
    if (!file) return;
    try {
      const d = await importJSON(file);
      if (d.facturas) updateFacturas(d.facturas);
      if (d.hojas_ruta) updateRutas(d.hojas_ruta);
      if (d.clientes) updateClientes(d.clientes);
      if (d.empresa) { updateEmpresa({ ...defaultEmpresa, ...d.empresa }); setEmpresaForm({ ...defaultEmpresa, ...d.empresa }); }
      toast("Datos restaurados");
    } catch { toast("Error al importar", "error"); }
    if (restoreRef.current) restoreRef.current.value = "";
  };

  const getNewLabel = () => ({ facturas: "Nueva Factura", hojas_ruta: "Nueva Ruta", clientes: "Nuevo Cliente" }[tab] || "");
  const getNewType = () => ({ facturas: "factura", hojas_ruta: "ruta", clientes: "cliente" }[tab] || "");

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'Outfit',sans-serif", gap: 12 }}>
      <div style={{ width: 32, height: 32, background: "#c84b1a", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14 }}>F</div>
      Cargando Fletacar...
    </div>
  );

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-mark">F</div>
            <div>
              <h1>Fletacar</h1>
              <div className="loc"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 10-16 0c0 3 2.7 7 8 11.7z"/></svg>{empresa.ciudad || "Valencia"}, España</div>
            </div>
          </div>
          <nav className="sidebar-nav">
            <div className="nav-section-label">Gestión</div>
            {["dashboard", "facturas", "hojas_ruta", "clientes"].map(t => (
              <div key={t} className={`nav-item ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>
                <Icon type={t} /> <span className="nav-label">{tabLabels[t]}</span>
              </div>
            ))}
            <div className="nav-section-label">Fiscal y Config</div>
            {["fiscal", "ajustes"].map(t => (
              <div key={t} className={`nav-item ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>
                <Icon type={t} /> <span className="nav-label">{tabLabels[t]}</span>
              </div>
            ))}
          </nav>
          <div className="dark-toggle" onClick={() => setDarkMode(!darkMode)}>
            <Icon type={darkMode ? "sun" : "moon"} size={16} /> <span className="dark-label">{darkMode ? "Modo Claro" : "Modo Oscuro"}</span>
          </div>
          <div className="sidebar-footer">
            <span className="empresa">{empresa.razonSocial}</span>
            <span>{empresa.ciudad || "Valencia"} · v2.0</span>
          </div>
        </aside>

        {/* MAIN */}
        <div className="main">
          <header className="topbar">
            <h2>{tabLabels[tab]}</h2>
            <div className="topbar-actions">
              {tab === "dashboard" && (
                <>
                  <button className="btn btn-sm" onClick={handleBackup}><Icon type="backup" size={14} /> <span className="hide-mobile">Backup</span></button>
                  <label className="btn btn-sm" style={{ cursor: "pointer" }}><Icon type="upload" size={14} /> <span className="hide-mobile">Restaurar</span><input ref={restoreRef} type="file" accept=".json" hidden onChange={e => handleRestore(e.target.files[0])} /></label>
                </>
              )}
              {["facturas", "hojas_ruta", "clientes"].includes(tab) && (
                <>
                  <div className="search-box"><Icon type="search" size={15} /><input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                  {tab === "facturas" && <button className="btn btn-sm" onClick={exportFacturasCSV}><Icon type="csv" size={14} /> <span className="hide-mobile">CSV</span></button>}
                  {tab === "hojas_ruta" && <button className="btn btn-sm" onClick={exportRutasCSV}><Icon type="csv" size={14} /> <span className="hide-mobile">CSV</span></button>}
                  {tab === "clientes" && <button className="btn btn-sm" onClick={exportClientesCSV}><Icon type="csv" size={14} /> <span className="hide-mobile">CSV</span></button>}
                  <button className="btn btn-primary" onClick={() => openNew(getNewType())}><Icon type="plus" size={15} /> <span className="hide-mobile">{getNewLabel()}</span></button>
                </>
              )}
            </div>
          </header>

          <div className="content">

            {/* DASHBOARD */}
            {tab === "dashboard" && (
              <>
                <div className="welcome-banner">
                  <h2>Bienvenido a <span className="fletacar-accent">Fletacar</span></h2>
                  <p>Panel de control · {empresa.razonSocial} · {empresa.ciudad || "Valencia"}</p>
                </div>
                {!empresa.nif && (
                  <div style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: 10, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600, color: "var(--warning)" }}>
                    <Icon type="alert" size={18} /> Configura los datos fiscales de tu empresa en <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => switchTab("ajustes")}>Ajustes</span> para cumplir con la normativa.
                  </div>
                )}
                <div className="section-header"><h3>Facturación</h3><div className="line" /></div>
                <div className="stat-grid">
                  <div className="stat-card"><div className="stat-icon amber"><Icon type="facturas" size={20} /></div><div className="stat-label">Total Facturado</div><div className="stat-value" style={{ color: "var(--warning)", fontSize: 23 }}>{formatCurrency(totalFacturado)}</div></div>
                  <div className="stat-card"><div className="stat-icon green"><Icon type="facturas" size={20} /></div><div className="stat-label">Cobrado</div><div className="stat-value" style={{ color: "var(--success)", fontSize: 23 }}>{formatCurrency(cobrado)}</div></div>
                  <div className="stat-card"><div className="stat-icon blue"><Icon type="clock" size={20} /></div><div className="stat-label">Pendientes</div><div className="stat-value">{facturasPendientes}</div></div>
                  <div className="stat-card"><div className="stat-icon red"><Icon type="alert" size={20} /></div><div className="stat-label">Vencidas</div><div className="stat-value" style={{ color: "var(--danger)" }}>{facturasVencidas}</div></div>
                </div>
                <div className="section-header"><h3>Ingresos Mensuales</h3><div className="line" /></div>
                <div className="chart-wrap">
                  {facturas.some(f => f.estado === "Pagada") ? <MiniChart data={getMonthlyRevenue(facturas, 6)} /> : <div className="empty-state" style={{ padding: "30px 20px" }}><p>Sin datos de cobro</p></div>}
                </div>
                <div className="section-header"><h3>Logística</h3><div className="line" /></div>
                <div className="stat-grid">
                  <div className="stat-card"><div className="stat-icon blue"><Icon type="truck" size={20} /></div><div className="stat-label">Rutas Activas</div><div className="stat-value">{rutasActivas}</div></div>
                  <div className="stat-card"><div className="stat-icon green"><Icon type="hojas_ruta" size={20} /></div><div className="stat-label">Completadas</div><div className="stat-value" style={{ color: "var(--success)" }}>{rutasCompletadas}</div></div>
                  <div className="stat-card"><div className="stat-icon amber"><Icon type="truck" size={20} /></div><div className="stat-label">Bultos</div><div className="stat-value">{totalBultos.toLocaleString("es-ES")}</div></div>
                  <div className="stat-card"><div className="stat-icon blue"><Icon type="hojas_ruta" size={20} /></div><div className="stat-label">Km</div><div className="stat-value">{totalKm.toLocaleString("es-ES")}</div></div>
                </div>
              </>
            )}

            {/* FACTURAS */}
            {tab === "facturas" && (
              <>
                <div className="filter-bar">
                  {["Todos", ...ESTADO_FACTURA].map(e => <span key={e} className={`filter-chip ${filterEstado === e ? "active" : ""}`} onClick={() => setFilterEstado(e)}>{e}</span>)}
                </div>
                {filteredFacturas.length === 0 ? (
                  <div className="empty-state"><Icon type="facturas" size={48} /><p>{facturas.length === 0 ? "Crea tu primera factura" : "Sin resultados"}</p>
                    {facturas.length === 0 && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => openNew("factura")}><Icon type="plus" size={15} /> Nueva Factura</button>}
                  </div>
                ) : (
                  <div className="table-wrap"><table>
                    <thead><tr>
                      <th className="sortable" onClick={() => toggleSort("numero")}>Nº{sortInd("numero")}</th>
                      <th className="hide-mobile">Tipo</th>
                      <th className="sortable" onClick={() => toggleSort("cliente")}>Cliente{sortInd("cliente")}</th>
                      <th className="sortable hide-mobile" onClick={() => toggleSort("fecha")}>Fecha{sortInd("fecha")}</th>
                      <th className="sortable" onClick={() => toggleSort("importe")}>Total{sortInd("importe")}</th>
                      <th className="sortable" onClick={() => toggleSort("estado")}>Estado{sortInd("estado")}</th>
                      <th style={{ width: 170 }}>Acciones</th>
                    </tr></thead>
                    <tbody>
                      {filteredFacturas.map(f => (
                        <tr key={f.id}>
                          <td className="mono">{f.numero || "—"}</td>
                          <td className="hide-mobile" style={{ fontSize: 11 }}>{f.tipoFactura || "Completa"}</td>
                          <td>{f.cliente || "—"}{f.clienteNif && <div style={{ fontSize: 11, color: "var(--text3)" }}>{f.clienteNif}</div>}</td>
                          <td className="mono hide-mobile">{formatDate(f.fecha)}</td>
                          <td className="mono">{formatCurrency(computeAmounts(f).total)}</td>
                          <td><Badge label={f.estado} /></td>
                          <td>
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <button className="btn btn-sm" onClick={() => generateFacturaPDF(f, empresa)} title="Descargar PDF" style={{ background: "var(--accent)", color: "#fff", borderColor: "var(--accent)", padding: "5px 10px", fontSize: 11 }}><Icon type="download" size={13} /> PDF</button>
                              <button className="btn btn-icon btn-sm" onClick={() => handleDuplicate("factura", f)} title="Duplicar"><Icon type="duplicate" size={14} /></button>
                              <button className="btn btn-icon btn-sm" onClick={() => openEdit("factura", f)} title="Editar"><Icon type="edit" size={14} /></button>
                              <button className="btn btn-icon btn-sm btn-danger" onClick={() => setConfirmDelete({ type: "factura", id: f.id, label: f.numero || "esta factura" })} title="Eliminar"><Icon type="trash" size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </>
            )}

            {/* HOJAS DE RUTA */}
            {tab === "hojas_ruta" && (
              <>
                <div className="filter-bar">
                  {["Todos", ...ESTADO_RUTA].map(e => <span key={e} className={`filter-chip ${filterEstado === e ? "active" : ""}`} onClick={() => setFilterEstado(e)}>{e}</span>)}
                </div>
                {filteredRutas.length === 0 ? (
                  <div className="empty-state"><Icon type="hojas_ruta" size={48} /><p>{rutas.length === 0 ? "Crea tu primera hoja de ruta" : "Sin resultados"}</p>
                    {rutas.length === 0 && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => openNew("ruta")}><Icon type="plus" size={15} /> Nueva Ruta</button>}
                  </div>
                ) : (
                  <div className="table-wrap"><table>
                    <thead><tr>
                      <th className="sortable" onClick={() => toggleSort("codigo")}>Código{sortInd("codigo")}</th>
                      <th className="sortable" onClick={() => toggleSort("conductor")}>Conductor{sortInd("conductor")}</th>
                      <th className="sortable hide-mobile" onClick={() => toggleSort("vehiculo")}>Vehículo{sortInd("vehiculo")}</th>
                      <th>Ruta</th>
                      <th className="sortable hide-mobile" onClick={() => toggleSort("bultos")}>Bultos{sortInd("bultos")}</th>
                      <th className="sortable hide-mobile" onClick={() => toggleSort("km")}>Km{sortInd("km")}</th>
                      <th className="sortable hide-mobile" onClick={() => toggleSort("fecha")}>Fecha{sortInd("fecha")}</th>
                      <th>Estado</th>
                      <th style={{ width: 150 }}>Acciones</th>
                    </tr></thead>
                    <tbody>
                      {filteredRutas.map(r => (
                        <tr key={r.id}>
                          <td className="mono">{r.codigo || "—"}</td>
                          <td>{r.conductor || "—"}</td>
                          <td className="mono hide-mobile">{r.vehiculo || "—"}</td>
                          <td>{r.origen && r.destino ? `${r.origen} → ${r.destino}` : "—"}{r.paradas && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>vía {r.paradas}</div>}</td>
                          <td className="hide-mobile">{r.bultos || "—"}</td>
                          <td className="mono hide-mobile">{r.km ? `${parseInt(r.km).toLocaleString("es-ES")} km` : "—"}</td>
                          <td className="mono hide-mobile">{formatDate(r.fecha)}</td>
                          <td><Badge label={r.estado} /></td>
                          <td>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button className="btn btn-sm" onClick={() => generateRutaPDF(r, empresa)} title="PDF" style={{ background: "var(--accent)", color: "#fff", borderColor: "var(--accent)", padding: "5px 10px", fontSize: 11 }}><Icon type="download" size={13} /> PDF</button>
                              <button className="btn btn-icon btn-sm" onClick={() => handleDuplicate("ruta", r)} title="Duplicar"><Icon type="duplicate" size={14} /></button>
                              <button className="btn btn-icon btn-sm" onClick={() => openEdit("ruta", r)} title="Editar"><Icon type="edit" size={14} /></button>
                              <button className="btn btn-icon btn-sm btn-danger" onClick={() => setConfirmDelete({ type: "ruta", id: r.id, label: r.codigo || "esta ruta" })} title="Eliminar"><Icon type="trash" size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </>
            )}

            {/* CLIENTES */}
            {tab === "clientes" && (
              <>
                {filteredClientes.length === 0 ? (
                  <div className="empty-state"><Icon type="clientes" size={48} /><p>{clientes.length === 0 ? "Registra tu primer cliente" : "Sin resultados"}</p>
                    {clientes.length === 0 && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => openNew("cliente")}><Icon type="plus" size={15} /> Nuevo Cliente</button>}
                  </div>
                ) : (
                  <div className="table-wrap"><table>
                    <thead><tr>
                      <th className="sortable" onClick={() => toggleSort("nombre")}>Nombre{sortInd("nombre")}</th>
                      <th className="sortable" onClick={() => toggleSort("nif")}>NIF{sortInd("nif")}</th>
                      <th className="sortable hide-mobile" onClick={() => toggleSort("ciudad")}>Ciudad{sortInd("ciudad")}</th>
                      <th className="hide-mobile">Teléfono</th>
                      <th className="hide-mobile">Email</th>
                      <th style={{ width: 90 }}>Acciones</th>
                    </tr></thead>
                    <tbody>
                      {filteredClientes.map(c => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 600 }}>{c.nombre || "—"}</td>
                          <td className="mono">{c.nif || "—"}</td>
                          <td className="hide-mobile">{c.ciudad || "—"}</td>
                          <td className="mono hide-mobile">{c.telefono || "—"}</td>
                          <td className="hide-mobile">{c.email || "—"}</td>
                          <td><div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-icon btn-sm" onClick={() => openEdit("cliente", c)} title="Editar"><Icon type="edit" size={14} /></button>
                            <button className="btn btn-icon btn-sm btn-danger" onClick={() => setConfirmDelete({ type: "cliente", id: c.id, label: c.nombre || "este cliente" })} title="Eliminar"><Icon type="trash" size={14} /></button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </>
            )}

            {/* FISCAL - LIBRO IVA */}
            {tab === "fiscal" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                  <label className="form-label" style={{ margin: 0 }}>Ejercicio</label>
                  <select className="form-select" style={{ width: 120 }} value={fiscalYear} onChange={e => setFiscalYear(parseInt(e.target.value))}>
                    {[...new Set(facturas.map(f => f.fecha ? new Date(f.fecha).getFullYear() : new Date().getFullYear())), new Date().getFullYear()].sort((a, b) => b - a).map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <button className="btn btn-sm" onClick={() => {
                    exportCSV(libroFacturas.map(f => { const a = computeAmounts(f); return { ...f, cuotaIva: a.cuotaIva.toFixed(2), cuotaRecargo: a.cuotaRecargo.toFixed(2), cuotaIrpf: a.cuotaIrpf.toFixed(2), totalCalc: a.total.toFixed(2) }; }),
                      [{ key: "numero", label: "Nº Factura" }, { key: "tipoFactura", label: "Tipo" }, { key: "fecha", label: "Fecha" }, { key: "cliente", label: "Cliente" }, { key: "clienteNif", label: "NIF" }, { key: "importe", label: "Base" }, { key: "iva", label: "IVA%" }, { key: "cuotaIva", label: "Cuota IVA" }, { key: "cuotaRecargo", label: "Rec. Equiv." }, { key: "cuotaIrpf", label: "IRPF" }, { key: "totalCalc", label: "Total" }],
                      `libro_iva_${fiscalYear}.csv`);
                    toast("Libro IVA exportado");
                  }}><Icon type="csv" size={14} /> Exportar Libro</button>
                </div>

                <div className="section-header"><h3>Resumen Trimestral (Modelo 303)</h3><div className="line" /></div>
                <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                  {resumenTrimestral.map(q => (
                    <div className="fiscal-card" key={q.label}>
                      <h4>{q.label} <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text3)" }}>({q.count} facturas)</span></h4>
                      <div className="amounts-row"><span>Base imponible</span><span className="mono">{formatCurrency(q.totalBase)}</span></div>
                      <div className="amounts-row"><span>IVA repercutido</span><span className="mono" style={{ color: "var(--success)" }}>{formatCurrency(q.totalIva)}</span></div>
                      {q.totalRecargo > 0 && <div className="amounts-row"><span>Rec. equivalencia</span><span className="mono">{formatCurrency(q.totalRecargo)}</span></div>}
                      {q.totalIrpf > 0 && <div className="amounts-row"><span>IRPF retenido</span><span className="mono" style={{ color: "var(--danger)" }}>-{formatCurrency(q.totalIrpf)}</span></div>}
                      <div className="amounts-row total"><span>Total</span><span className="mono">{formatCurrency(q.totalFinal)}</span></div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 24 }}>* Solo IVA repercutido (facturas emitidas). Para el Modelo 303 completo necesitas también las facturas recibidas (IVA soportado).</p>

                <div className="section-header"><h3>Libro Registro Facturas Emitidas</h3><div className="line" /></div>
                {libroFacturas.length === 0 ? (
                  <div className="empty-state"><p>No hay facturas para {fiscalYear}</p></div>
                ) : (
                  <div className="table-wrap"><table style={{ minWidth: 900 }}>
                    <thead><tr>
                      <th>Nº Factura</th><th>Tipo</th><th>Fecha</th><th>Cliente</th><th>NIF</th>
                      <th>Base</th><th>IVA%</th><th>Cuota IVA</th><th>Rec. Eq.</th><th>IRPF</th><th>Total</th>
                    </tr></thead>
                    <tbody>
                      {libroFacturas.map(f => {
                        const a = computeAmounts(f);
                        return (
                          <tr key={f.id}>
                            <td className="mono">{f.numero}</td>
                            <td style={{ fontSize: 11 }}>{f.tipoFactura || "Completa"}</td>
                            <td className="mono">{formatDate(f.fecha)}</td>
                            <td>{f.cliente}</td>
                            <td className="mono">{f.clienteNif || "—"}</td>
                            <td className="mono">{formatCurrency(a.base)}</td>
                            <td className="mono">{a.ivaPct}%</td>
                            <td className="mono">{formatCurrency(a.cuotaIva)}</td>
                            <td className="mono">{a.cuotaRecargo > 0 ? formatCurrency(a.cuotaRecargo) : "—"}</td>
                            <td className="mono">{a.cuotaIrpf > 0 ? `-${formatCurrency(a.cuotaIrpf)}` : "—"}</td>
                            <td className="mono" style={{ fontWeight: 600 }}>{formatCurrency(a.total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot style={{ background: "var(--bg3)", fontWeight: 700 }}>
                      <tr>
                        <td colSpan={5} style={{ textAlign: "right", fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px" }}>Totales {fiscalYear}</td>
                        <td className="mono">{formatCurrency(libroFacturas.reduce((s, f) => s + (parseFloat(f.importe) || 0), 0))}</td>
                        <td></td>
                        <td className="mono">{formatCurrency(libroFacturas.reduce((s, f) => s + computeAmounts(f).cuotaIva, 0))}</td>
                        <td className="mono">{formatCurrency(libroFacturas.reduce((s, f) => s + computeAmounts(f).cuotaRecargo, 0))}</td>
                        <td className="mono">{formatCurrency(libroFacturas.reduce((s, f) => s + computeAmounts(f).cuotaIrpf, 0))}</td>
                        <td className="mono">{formatCurrency(libroFacturas.reduce((s, f) => s + computeAmounts(f).total, 0))}</td>
                      </tr>
                    </tfoot>
                  </table></div>
                )}
              </>
            )}

            {/* AJUSTES */}
            {tab === "ajustes" && (
              <>
                <div className="ajustes-section">
                  <h3>Datos Fiscales de la Empresa</h3>
                  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 20 }}>Estos datos aparecerán en todas las facturas y documentos generados. Obligatorio según RD 1619/2012.</p>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Razón Social</label><input className="form-input" value={empresaForm.razonSocial} onChange={e => setEmpresaForm({ ...empresaForm, razonSocial: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">NIF / CIF</label><input className="form-input" placeholder="B12345678" value={empresaForm.nif} onChange={e => setEmpresaForm({ ...empresaForm, nif: e.target.value })} /></div>
                  </div>
                  <div className="form-group"><label className="form-label">Dirección fiscal</label><input className="form-input" placeholder="Calle, número, piso..." value={empresaForm.direccion} onChange={e => setEmpresaForm({ ...empresaForm, direccion: e.target.value })} /></div>
                  <div className="form-row-3">
                    <div className="form-group"><label className="form-label">Ciudad</label><input className="form-input" value={empresaForm.ciudad} onChange={e => setEmpresaForm({ ...empresaForm, ciudad: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Código Postal</label><input className="form-input" value={empresaForm.cp} onChange={e => setEmpresaForm({ ...empresaForm, cp: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Provincia</label><input className="form-input" value={empresaForm.provincia} onChange={e => setEmpresaForm({ ...empresaForm, provincia: e.target.value })} /></div>
                  </div>
                  <div className="form-row-3">
                    <div className="form-group"><label className="form-label">Teléfono</label><input className="form-input" value={empresaForm.telefono} onChange={e => setEmpresaForm({ ...empresaForm, telefono: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={empresaForm.email} onChange={e => setEmpresaForm({ ...empresaForm, email: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Web</label><input className="form-input" placeholder="www.fletacar.es" value={empresaForm.web} onChange={e => setEmpresaForm({ ...empresaForm, web: e.target.value })} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">IBAN (cuenta bancaria)</label><input className="form-input" placeholder="ES00 0000 0000 0000 0000 0000" value={empresaForm.iban} onChange={e => setEmpresaForm({ ...empresaForm, iban: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Registro Mercantil</label><input className="form-input" placeholder="Reg. Merc. Valencia, Tomo..." value={empresaForm.registroMercantil} onChange={e => setEmpresaForm({ ...empresaForm, registroMercantil: e.target.value })} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Serie facturas</label><input className="form-input" placeholder="FLC" value={empresaForm.serieFactura} onChange={e => setEmpresaForm({ ...empresaForm, serieFactura: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Serie rectificativas</label><input className="form-input" placeholder="FLC-R" value={empresaForm.serieRectificativa} onChange={e => setEmpresaForm({ ...empresaForm, serieRectificativa: e.target.value })} /></div>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                    <button className="btn btn-primary" onClick={() => { updateEmpresa(empresaForm); toast("Datos fiscales guardados"); }}>Guardar datos fiscales</button>
                  </div>
                </div>

                <div className="ajustes-section">
                  <h3>Sistema Verifactu</h3>
                  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 16 }}>Conforme a la Ley 11/2021 (Ley Antifraude) y RD 1007/2023. Cada factura nueva genera un hash SHA-256 encadenado para garantizar la integridad del registro.</p>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <div>
                      <div className="stat-label">Facturas con hash</div>
                      <div className="stat-value" style={{ fontSize: 22 }}>{facturas.filter(f => f.verifactuHash).length}</div>
                    </div>
                    <div>
                      <div className="stat-label">Último hash</div>
                      <div className="mono" style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                        {facturas.length > 0 && facturas[0].verifactuHash ? facturas[0].verifactuHash.slice(0, 32) + "..." : "Sin registros"}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}><span className="verifactu-badge"><Icon type="check" size={12} /> Verifactu activo</span></div>
                </div>

                <div className="ajustes-section">
                  <h3>Backup y restauración</h3>
                  <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 16 }}>Exporta o importa todos los datos de la aplicación (facturas, rutas, clientes y configuración).</p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button className="btn" onClick={handleBackup}><Icon type="backup" size={14} /> Descargar backup</button>
                    <label className="btn" style={{ cursor: "pointer" }}><Icon type="upload" size={14} /> Restaurar datos<input ref={restoreRef} type="file" accept=".json" hidden onChange={e => handleRestore(e.target.files[0])} /></label>
                  </div>
                </div>
              </>
            )}

          </div>
        </div>

        {/* MODALS */}
        {modal && (
          <Modal
            title={`${modal.mode === "new" ? (modal.type === "cliente" ? "Nuevo" : "Nueva") : "Editar"} ${modal.type === "factura" ? "Factura" : modal.type === "ruta" ? "Hoja de Ruta" : "Cliente"}`}
            onClose={() => setModal(null)} onSave={handleSave}
          >
            {modal.type === "factura" ? <FacturaForm data={modal.data} onChange={d => setModal({ ...modal, data: d })} clientes={clientes} facturas={facturas} />
              : modal.type === "ruta" ? <RutaForm data={modal.data} onChange={d => setModal({ ...modal, data: d })} />
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
