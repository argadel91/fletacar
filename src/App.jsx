import { useState, useEffect, useCallback } from "react";

const TABS = ["dashboard", "facturas", "hojas_ruta"];

const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const formatCurrency = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
};

const ESTADO_FACTURA = ["Pendiente", "Pagada", "Vencida", "Anulada"];
const ESTADO_RUTA = ["Planificada", "En curso", "Completada", "Cancelada"];

const estadoColor = {
  Pendiente: "#e8a735", Pagada: "#2ecc71", Vencida: "#e74c3c", Anulada: "#95a5a6",
  Planificada: "#3498db", "En curso": "#e8a735", Completada: "#2ecc71", Cancelada: "#e74c3c",
};

const Icon = ({ type, size = 18 }) => {
  const s = { width: size, height: size, display: "inline-block", verticalAlign: "middle" };
  const icons = {
    dashboard: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    facturas: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    hojas_ruta: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 10-16 0c0 3 2.7 7 8 11.7z"/></svg>,
    plus: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    search: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    trash: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>,
    edit: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    truck: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    close: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    alert: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    clock: <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  };
  return icons[type] || null;
};

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

// ─── Storage helpers (localStorage) ───
const STORAGE_KEYS = { facturas: "fletacar_facturas", hojas_ruta: "fletacar_hojas_ruta" };

const loadData = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
const saveData = (key, data) => {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error("Storage error:", e); }
};

// ─── Styles ───
const css = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap');

:root {
  --bg: #faf9f7;
  --bg2: #ffffff;
  --bg3: #f3f1ed;
  --bg4: #e8e5df;
  --border: #ddd8d0;
  --text: #1a1814;
  --text2: #7a756c;
  --text3: #a09a90;
  --accent: #c84b1a;
  --accent2: #a83d14;
  --accent-light: #c84b1a15;
  --accent-mid: #c84b1a30;
  --navy: #1e2a3a;
  --navy-light: #2c3e50;
  --success: #2d8a4e;
  --success-bg: #2d8a4e12;
  --warning: #c87b1a;
  --warning-bg: #c87b1a12;
  --danger: #c42b2b;
  --danger-bg: #c42b2b10;
  --blue: #2563eb;
  --blue-bg: #2563eb10;
  --radius: 10px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,.06);
  --shadow-md: 0 4px 16px rgba(0,0,0,.08);
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

.table-wrap { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm); }
table { width: 100%; border-collapse: collapse; }
thead { background: var(--bg3); }
th {
  padding: 12px 16px; font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1px; color: var(--text2); text-align: left; border-bottom: 1px solid var(--border);
}
td { padding: 13px 16px; font-size: 13.5px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--bg3); }
.mono { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; letter-spacing: -.3px; }

.section-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
}
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

.empty-state {
  text-align: center; padding: 60px 20px; color: var(--text2);
}
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

@media (max-width: 768px) {
  .sidebar { width: 64px; min-width: 64px; }
  .sidebar-logo h1, .sidebar-logo .loc, .nav-label, .sidebar-footer, .nav-section-label { display: none; }
  .sidebar-logo { justify-content: center; padding: 18px 8px; }
  .nav-item { justify-content: center; padding: 11px; }
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

const emptyFactura = { numero: "", cliente: "", fecha: "", vencimiento: "", importe: "", iva: "21", concepto: "", estado: "Pendiente", notas: "" };
const emptyRuta = { codigo: "", conductor: "", vehiculo: "", fecha: "", origen: "Valencia", destino: "", estado: "Planificada", paradas: "", bultos: "", km: "", notas: "" };

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

function FacturaForm({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Nº Factura</label>
          <input className="form-input" placeholder="FLC-001" value={data.numero} onChange={e => set("numero", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Cliente</label>
          <input className="form-input" placeholder="Nombre del cliente" value={data.cliente} onChange={e => set("cliente", e.target.value)} />
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

export default function FletacarApp() {
  const [tab, setTab] = useState("dashboard");
  const [facturas, setFacturas] = useState([]);
  const [rutas, setRutas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState("Todos");
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    setFacturas(loadData(STORAGE_KEYS.facturas));
    setRutas(loadData(STORAGE_KEYS.hojas_ruta));
    setLoading(false);
  }, []);

  const updateFacturas = useCallback((newData) => { setFacturas(newData); saveData(STORAGE_KEYS.facturas, newData); }, []);
  const updateRutas = useCallback((newData) => { setRutas(newData); saveData(STORAGE_KEYS.hojas_ruta, newData); }, []);

  const openNew = (type) => setModal({ type, mode: "new", data: type === "factura" ? { ...emptyFactura } : { ...emptyRuta } });
  const openEdit = (type, item) => setModal({ type, mode: "edit", data: { ...item }, id: item.id });

  const handleSave = () => {
    if (!modal) return;
    const { type, mode, data, id } = modal;
    if (type === "factura") {
      if (mode === "new") updateFacturas([{ ...data, id: generateId(), createdAt: Date.now() }, ...facturas]);
      else updateFacturas(facturas.map(f => f.id === id ? { ...f, ...data } : f));
    } else {
      if (mode === "new") updateRutas([{ ...data, id: generateId(), createdAt: Date.now() }, ...rutas]);
      else updateRutas(rutas.map(r => r.id === id ? { ...r, ...data } : r));
    }
    setModal(null);
  };

  const handleDelete = (type, id) => {
    if (type === "factura") updateFacturas(facturas.filter(f => f.id !== id));
    else updateRutas(rutas.filter(r => r.id !== id));
    setConfirmDelete(null);
  };

  const totalFacturado = facturas.reduce((s, f) => s + (parseFloat(f.importe) || 0) * (1 + (parseFloat(f.iva) || 0) / 100), 0);
  const facturasPendientes = facturas.filter(f => f.estado === "Pendiente").length;
  const facturasVencidas = facturas.filter(f => f.estado === "Vencida").length;
  const cobrado = facturas.filter(f => f.estado === "Pagada").reduce((s, f) => s + (parseFloat(f.importe) || 0) * (1 + (parseFloat(f.iva) || 0) / 100), 0);
  const rutasActivas = rutas.filter(r => r.estado === "En curso" || r.estado === "Planificada").length;
  const rutasCompletadas = rutas.filter(r => r.estado === "Completada").length;
  const totalBultos = rutas.reduce((s, r) => s + (parseInt(r.bultos) || 0), 0);
  const totalKm = rutas.reduce((s, r) => s + (parseInt(r.km) || 0), 0);

  const filteredFacturas = facturas.filter(f => {
    const matchSearch = !search || [f.numero, f.cliente, f.concepto].some(v => (v || "").toLowerCase().includes(search.toLowerCase()));
    const matchEstado = filterEstado === "Todos" || f.estado === filterEstado;
    return matchSearch && matchEstado;
  });
  const filteredRutas = rutas.filter(r => {
    const matchSearch = !search || [r.codigo, r.conductor, r.origen, r.destino, r.vehiculo].some(v => (v || "").toLowerCase().includes(search.toLowerCase()));
    const matchEstado = filterEstado === "Todos" || r.estado === filterEstado;
    return matchSearch && matchEstado;
  });

  const tabLabels = { dashboard: "Panel de Control", facturas: "Facturas", hojas_ruta: "Hojas de Ruta" };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#faf9f7", color: "#1a1814", fontFamily: "'Outfit', sans-serif", gap: 12 }}>
      <div style={{ width: 32, height: 32, background: "#c84b1a", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14 }}>F</div>
      Cargando Fletacar...
    </div>
  );

  return (
    <>
      <style>{css}</style>
      <div className="app">
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
              <div key={t} className={`nav-item ${tab === t ? "active" : ""}`} onClick={() => { setTab(t); setSearch(""); setFilterEstado("Todos"); }}>
                <Icon type={t === "dashboard" ? "dashboard" : t === "facturas" ? "facturas" : "hojas_ruta"} />
                <span className="nav-label">{tabLabels[t]}</span>
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="empresa">Fletacar S.L.</span>
            <span>Valencia · v1.0</span>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <h2>{tabLabels[tab]}</h2>
            <div className="topbar-actions">
              {tab !== "dashboard" && (
                <>
                  <div className="search-box">
                    <Icon type="search" size={15} />
                    <input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                  <button className="btn btn-primary" onClick={() => openNew(tab === "facturas" ? "factura" : "ruta")}>
                    <Icon type="plus" size={15} /> <span className="hide-mobile">{tab === "facturas" ? "Nueva Factura" : "Nueva Ruta"}</span>
                  </button>
                </>
              )}
            </div>
          </header>

          <div className="content">
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

                <div className="section-header"><h3>Últimas Facturas</h3><div className="line" /></div>
                {facturas.length === 0 ? (
                  <div className="empty-state"><Icon type="facturas" size={40} /><p>No hay facturas registradas aún</p>
                    <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { setTab("facturas"); setTimeout(() => openNew("factura"), 100); }}><Icon type="plus" size={15} /> Crear factura</button>
                  </div>
                ) : (
                  <div className="table-wrap" style={{ marginBottom: 28 }}>
                    <table>
                      <thead><tr><th>Nº</th><th>Cliente</th><th>Importe</th><th>Estado</th><th className="hide-mobile">Fecha</th></tr></thead>
                      <tbody>
                        {facturas.slice(0, 5).map(f => (
                          <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => setTab("facturas")}>
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
                    <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { setTab("hojas_ruta"); setTimeout(() => openNew("ruta"), 100); }}><Icon type="plus" size={15} /> Crear ruta</button>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Código</th><th>Conductor</th><th>Ruta</th><th>Estado</th><th className="hide-mobile">Fecha</th></tr></thead>
                      <tbody>
                        {rutas.slice(0, 5).map(r => (
                          <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setTab("hojas_ruta")}>
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

            {tab === "facturas" && (
              <>
                <div className="filter-bar">
                  {["Todos", ...ESTADO_FACTURA].map(e => (
                    <span key={e} className={`filter-chip ${filterEstado === e ? "active" : ""}`} onClick={() => setFilterEstado(e)}>{e}</span>
                  ))}
                </div>
                {filteredFacturas.length === 0 ? (
                  <div className="empty-state"><Icon type="facturas" size={48} /><p>{facturas.length === 0 ? "Aún no has creado ninguna factura" : "No se encontraron resultados"}</p>
                    {facturas.length === 0 && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => openNew("factura")}><Icon type="plus" size={15} /> Crear primera factura</button>}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Nº Factura</th><th>Cliente</th><th className="hide-mobile">Concepto</th><th className="hide-mobile">Fecha</th><th>Importe Total</th><th>Estado</th><th style={{ width: 90 }}>Acciones</th></tr></thead>
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
                                <div style={{ display: "flex", gap: 4 }}>
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
                      <thead><tr><th>Código</th><th>Conductor</th><th className="hide-mobile">Vehículo</th><th>Ruta</th><th className="hide-mobile">Bultos</th><th className="hide-mobile">Km</th><th className="hide-mobile">Fecha</th><th>Estado</th><th style={{ width: 90 }}>Acciones</th></tr></thead>
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
          </div>
        </div>

        {modal && (
          <Modal
            title={`${modal.mode === "new" ? "Nueva" : "Editar"} ${modal.type === "factura" ? "Factura" : "Hoja de Ruta"}`}
            onClose={() => setModal(null)}
            onSave={handleSave}
          >
            {modal.type === "factura"
              ? <FacturaForm data={modal.data} onChange={d => setModal({ ...modal, data: d })} />
              : <RutaForm data={modal.data} onChange={d => setModal({ ...modal, data: d })} />}
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
      </div>
    </>
  );
}
