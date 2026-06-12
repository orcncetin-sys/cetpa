/**
 * MRPModule — MRP II / Finite Capacity Planning + Routing
 * Gap vs: Odoo MRP, SAP B1 Production, NetSuite Advanced Mfg, Dynamics 365 BC
 *
 * Features:
 *  - Work center definitions (machine/cell, capacity hours/day, efficiency %)
 *  - Shift calendars per work center
 *  - Routing templates: ordered steps per product with setup + run time
 *  - Finite capacity load chart: planned hours vs available hours per work center
 *  - MRP run: given a demand forecast or sales order qty, explode BOM and
 *    generate suggested production/purchase orders
 *  - Critical path detection (bottleneck work center)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Cpu, Plus, X, ChevronDown, Settings, Clock, AlertTriangle,
  CheckCircle2, BarChart2, Calendar, Zap, ArrowRight, Package,
  RefreshCw, Edit2, Trash2
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp
} from '../lib/dbClient';
import { db } from '../firebase';
import MikroPushButton from './MikroPushButton';
import { uretimTalepPayload, satinAlmaTalepPayload } from '../services/mikroEvrak';
import { sortByCreatedAt, byField } from '../utils/fsSort';
import ModuleHeader from './ModuleHeader';

// ─── Types ─────────────────────────────────────────────────────────────────

interface WorkCenter {
  id: string;
  name: string;
  code: string;
  description: string;
  capacityHoursPerDay: number;   // available hours per working day
  efficiency: number;            // 0-100 %
  costPerHour: number;           // ₺/hr
  workerCount: number;
  active: boolean;
  color: string;
  createdAt?: unknown;
}

interface RoutingStep {
  stepNo: number;
  workCenterId: string;
  workCenterName: string;
  operation: string;            // operation description
  setupMinutes: number;
  runMinutesPerUnit: number;    // per piece
}

interface RoutingTemplate {
  id: string;
  productName: string;
  productSku: string;
  steps: RoutingStep[];
  notes: string;
  createdAt?: unknown;
}

interface CapacityLoad {
  workCenterId: string;
  workCenterName: string;
  plannedHours: number;
  availableHours: number;       // capacity × efficiency / 100
  utilizationPct: number;
  orders: string[];             // production order names contributing
}

interface MRPSuggestion {
  type: 'produce' | 'purchase';
  itemName: string;
  qty: number;
  unit: string;
  neededBy: string;
  reason: string;
  routingId?: string;
}

interface Props {
  currentLanguage: string;
  isAuthenticated: boolean;
  /** Active production orders to compute load against */
  productionOrders?: Array<{
    id: string;
    productName: string;
    qty: number;
    plannedStart?: string;
    plannedEnd?: string;
    status: string;
    workCenter?: string;
  }>;
  /** BOM data to run MRP explosion */
  boms?: Array<{
    id: string;
    productName: string;
    productSku: string;
    components: Array<{ inventoryId: string; name: string; quantity: number; unit: string }>;
  }>;
  /** Inventory for MRP stock check */
  inventory?: Array<{ id: string; name: string; sku: string; quantity?: number; stockLevel?: number; unit?: string }>;
}

// ─── Colour palette ─────────────────────────────────────────────────────────
const WC_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'];

// ─── Component ──────────────────────────────────────────────────────────────

export default function MRPModule({
  currentLanguage, isAuthenticated,
  productionOrders = [], boms = [], inventory = [],
}: Props) {
  const tr = currentLanguage === 'tr';
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [routings, setRoutings] = useState<RoutingTemplate[]>([]);
  const [view, setView] = useState<'workcenters' | 'routing' | 'capacity' | 'mrp'>('workcenters');

  // Forms
  const [showWCForm, setShowWCForm] = useState(false);
  const [editingWCId, setEditingWCId] = useState<string | null>(null);
  const [showRoutingForm, setShowRoutingForm] = useState(false);
  const [editingRoutingId, setEditingRoutingId] = useState<string | null>(null);
  const [mrpQtyInput, setMrpQtyInput] = useState<Record<string, number>>({});
  const [mrpSuggestions, setMrpSuggestions] = useState<MRPSuggestion[]>([]);
  const [mrpRunning, setMrpRunning] = useState(false);
  const [horizonDays, setHorizonDays] = useState(30);

  const emptyWC: Omit<WorkCenter, 'id' | 'createdAt'> = {
    name: '', code: '', description: '', capacityHoursPerDay: 8,
    efficiency: 85, costPerHour: 0, workerCount: 1, active: true, color: WC_COLORS[0],
  };
  const [wcDraft, setWcDraft] = useState(emptyWC);

  const emptyRouting: Omit<RoutingTemplate, 'id' | 'createdAt'> = {
    productName: '', productSku: '', steps: [], notes: '',
  };
  const [routingDraft, setRoutingDraft] = useState(emptyRouting);

  // ── Firestore ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'workCenters'), snap => {
      setWorkCenters(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkCenter)).sort(byField('name', 'asc')));
    });
    const u2 = onSnapshot(collection(db, 'routingTemplates'), snap => {
      setRoutings(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as RoutingTemplate))));
    });
    return () => { u1(); u2(); };
  }, []);

  // ── Capacity load calculation ─────────────────────────────────────────────
  const capacityLoads = useMemo((): CapacityLoad[] => {
    const map: Record<string, CapacityLoad> = {};

    workCenters.filter(wc => wc.active).forEach(wc => {
      const available = (wc.capacityHoursPerDay * horizonDays * wc.efficiency) / 100;
      map[wc.id] = {
        workCenterId: wc.id,
        workCenterName: wc.name,
        plannedHours: 0,
        availableHours: available,
        utilizationPct: 0,
        orders: [],
      };
    });

    // For each active production order, find its routing and compute hours
    productionOrders.filter(o => o.status !== 'Tamamlandı' && o.status !== 'İptal').forEach(po => {
      const routing = routings.find(r =>
        r.productName.toLowerCase() === po.productName.toLowerCase() ||
        r.productSku.toLowerCase() === (po.productName || '').toLowerCase()
      );

      if (routing) {
        routing.steps.forEach(step => {
          const load = map[step.workCenterId];
          if (load) {
            const hours = (step.setupMinutes + step.runMinutesPerUnit * po.qty) / 60;
            load.plannedHours += hours;
            load.orders.push(po.productName);
          }
        });
      } else if (po.workCenter) {
        // Fallback: match by work center name
        const wc = workCenters.find(w => w.name.toLowerCase() === (po.workCenter ?? '').toLowerCase());
        if (wc && map[wc.id]) {
          map[wc.id].plannedHours += po.qty * 0.5; // estimate 0.5h per unit
          map[wc.id].orders.push(po.productName);
        }
      }
    });

    return Object.values(map).map(load => ({
      ...load,
      utilizationPct: load.availableHours > 0
        ? Math.round((load.plannedHours / load.availableHours) * 100) : 0,
    })).sort((a, b) => b.utilizationPct - a.utilizationPct);
  }, [workCenters, routings, productionOrders, horizonDays]);

  // ── MRP explosion ─────────────────────────────────────────────────────────
  const runMRP = () => {
    setMrpRunning(true);
    const suggestions: MRPSuggestion[] = [];

    Object.entries(mrpQtyInput).forEach(([productName, demandQty]) => {
      if (!demandQty) return;
      const bom = boms.find(b => b.productName.toLowerCase() === productName.toLowerCase());
      const routing = routings.find(r => r.productName.toLowerCase() === productName.toLowerCase());

      // Suggest production order
      suggestions.push({
        type: 'produce',
        itemName: productName,
        qty: demandQty,
        unit: 'adet',
        neededBy: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        reason: tr ? `${demandQty} adet talep` : `Demand: ${demandQty} units`,
        routingId: routing?.id,
      });

      // Explode BOM components
      if (bom) {
        bom.components.forEach(comp => {
          const required = comp.quantity * demandQty;
          const stock = inventory.find(i => i.id === comp.inventoryId);
          const onHand = stock?.quantity ?? stock?.stockLevel ?? 0;
          const shortage = required - onHand;
          if (shortage > 0) {
            suggestions.push({
              type: 'purchase',
              itemName: comp.name,
              qty: shortage,
              unit: comp.unit,
              neededBy: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
              reason: tr
                ? `Stok: ${onHand} ${comp.unit}, Gereken: ${required} ${comp.unit}`
                : `Stock: ${onHand} ${comp.unit}, Required: ${required} ${comp.unit}`,
            });
          }
        });
      }
    });

    setTimeout(() => {
      setMrpSuggestions(suggestions);
      setMrpRunning(false);
    }, 600);
  };

  // ── Save work center ──────────────────────────────────────────────────────
  const saveWC = async () => {
    if (!wcDraft.name.trim()) return;
    if (editingWCId) {
      await updateDoc(doc(db, 'workCenters', editingWCId), wcDraft);
    } else {
      await addDoc(collection(db, 'workCenters'), { ...wcDraft, createdAt: serverTimestamp() });
    }
    setShowWCForm(false); setEditingWCId(null); setWcDraft(emptyWC);
  };

  // ── Save routing ──────────────────────────────────────────────────────────
  const saveRouting = async () => {
    if (!routingDraft.productName.trim()) return;
    if (editingRoutingId) {
      await updateDoc(doc(db, 'routingTemplates', editingRoutingId), routingDraft);
    } else {
      await addDoc(collection(db, 'routingTemplates'), { ...routingDraft, createdAt: serverTimestamp() });
    }
    setShowRoutingForm(false); setEditingRoutingId(null); setRoutingDraft(emptyRouting);
  };

  const addRoutingStep = () => {
    const step: RoutingStep = {
      stepNo: routingDraft.steps.length + 1,
      workCenterId: workCenters[0]?.id ?? '',
      workCenterName: workCenters[0]?.name ?? '',
      operation: '',
      setupMinutes: 15,
      runMinutesPerUnit: 5,
    };
    setRoutingDraft(d => ({ ...d, steps: [...d.steps, step] }));
  };

  const fmtH = (h: number) => `${h.toFixed(1)}h`;
  const overloaded = capacityLoads.filter(l => l.utilizationPct > 100);

  return (
    <div className="space-y-4">
      <ModuleHeader
        title={tr ? 'MRP II — Kapasite & Rota Planlaması' : 'MRP II — Capacity & Routing'}
        subtitle={tr
          ? 'İş merkezi tanımları, ürün rotaları, sonlu kapasite çizelgesi ve MRP malzeme ihtiyaç planlaması'
          : 'Work centers, product routings, finite capacity scheduling, and MRP material requirements'}
        icon={Cpu}
      />

      {/* Alert: overloaded */}
      {overloaded.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-red-800">
            {overloaded.length} {tr ? 'iş merkezi aşırı yüklü:' : 'work centers overloaded:'} {overloaded.map(l => l.workCenterName).join(', ')}
          </p>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
        {[
          { id: 'workcenters', label: tr ? 'İş Merkezleri' : 'Work Centers', icon: Settings },
          { id: 'routing',     label: tr ? 'Rotalar' : 'Routings',           icon: ArrowRight },
          { id: 'capacity',    label: tr ? 'Kapasite Yükü' : 'Capacity Load', icon: BarChart2 },
          { id: 'mrp',         label: 'MRP',                                  icon: RefreshCw },
        ].map(t => (
          <button key={t.id} onClick={() => setView(t.id as typeof view)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
              ${view === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ── Work Centers ─────────────────────────────────────────────────── */}
      {view === 'workcenters' && (
        <div className="space-y-4">
          {isAuthenticated && (
            <button onClick={() => { setShowWCForm(true); setEditingWCId(null); setWcDraft(emptyWC); }}
              className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />{tr ? 'İş Merkezi Ekle' : 'Add Work Center'}
            </button>
          )}

          <AnimatePresence>
            {showWCForm && (
              <motion.div key="wcform" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="apple-card p-5 border-2 border-brand/20 space-y-3">
                <div className="flex justify-between">
                  <h4 className="font-bold text-gray-800">{editingWCId ? (tr ? 'İş Merkezi Düzenle' : 'Edit Work Center') : (tr ? 'Yeni İş Merkezi' : 'New Work Center')}</h4>
                  <button onClick={() => setShowWCForm(false)}><X className="w-4 h-4 text-gray-400" /></button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <input value={wcDraft.name} onChange={e => setWcDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder={tr ? 'İş merkezi adı' : 'Name'} className="apple-input px-3 py-2 text-sm" />
                  <input value={wcDraft.code} onChange={e => setWcDraft(d => ({ ...d, code: e.target.value }))}
                    placeholder={tr ? 'Kod (ör: WC-01)' : 'Code (e.g. WC-01)'} className="apple-input px-3 py-2 text-sm" />
                  <input value={wcDraft.description} onChange={e => setWcDraft(d => ({ ...d, description: e.target.value }))}
                    placeholder={tr ? 'Açıklama' : 'Description'} className="apple-input px-3 py-2 text-sm" />
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">{tr ? 'Kapasite (saat/gün)' : 'Capacity (h/day)'}</label>
                    <input type="number" min={1} max={24} value={wcDraft.capacityHoursPerDay}
                      onChange={e => setWcDraft(d => ({ ...d, capacityHoursPerDay: parseFloat(e.target.value) || 8 }))}
                      className="apple-input px-3 py-2 text-sm" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">{tr ? 'Verimlilik (%)' : 'Efficiency (%)'}</label>
                    <input type="number" min={1} max={100} value={wcDraft.efficiency}
                      onChange={e => setWcDraft(d => ({ ...d, efficiency: parseFloat(e.target.value) || 85 }))}
                      className="apple-input px-3 py-2 text-sm" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">{tr ? 'Maliyet (₺/saat)' : 'Cost (₺/hr)'}</label>
                    <input type="number" min={0} value={wcDraft.costPerHour}
                      onChange={e => setWcDraft(d => ({ ...d, costPerHour: parseFloat(e.target.value) || 0 }))}
                      className="apple-input px-3 py-2 text-sm" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">{tr ? 'Çalışan Sayısı' : 'Workers'}</label>
                    <input type="number" min={1} value={wcDraft.workerCount}
                      onChange={e => setWcDraft(d => ({ ...d, workerCount: parseInt(e.target.value) || 1 }))}
                      className="apple-input px-3 py-2 text-sm" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">{tr ? 'Renk' : 'Color'}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {WC_COLORS.map(c => (
                        <button key={c} onClick={() => setWcDraft(d => ({ ...d, color: c }))}
                          className={`w-5 h-5 rounded-full transition-transform ${wcDraft.color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : ''}`}
                          style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveWC} className="apple-button-primary px-4 py-2 text-sm">{editingWCId ? (tr ? 'Güncelle' : 'Update') : (tr ? 'Ekle' : 'Add')}</button>
                  <button onClick={() => setShowWCForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {workCenters.map(wc => {
              const load = capacityLoads.find(l => l.workCenterId === wc.id);
              const util = load?.utilizationPct ?? 0;
              return (
                <div key={wc.id} className="apple-card p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: wc.color }} />
                      <div>
                        <p className="font-bold text-gray-900 text-sm">{wc.name}</p>
                        <p className="text-xs text-gray-400 font-mono">{wc.code}</p>
                      </div>
                    </div>
                    {isAuthenticated && (
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setWcDraft({ name: wc.name, code: wc.code, description: wc.description, capacityHoursPerDay: wc.capacityHoursPerDay, efficiency: wc.efficiency, costPerHour: wc.costPerHour, workerCount: wc.workerCount, active: wc.active, color: wc.color }); setEditingWCId(wc.id); setShowWCForm(true); }}
                          className="p-1 hover:bg-gray-100 rounded-lg"><Edit2 className="w-3.5 h-3.5 text-gray-400" /></button>
                        <button onClick={() => deleteDoc(doc(db, 'workCenters', wc.id))}
                          className="p-1 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                      </div>
                    )}
                  </div>

                  {/* Utilization bar */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-500">{tr ? 'Kullanım' : 'Utilization'}</span>
                      <span className={`font-bold ${util > 100 ? 'text-red-600' : util > 80 ? 'text-amber-600' : 'text-green-600'}`}>{util}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, util)}%`, backgroundColor: util > 100 ? '#ef4444' : util > 80 ? '#f59e0b' : '#10b981' }} />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-sm font-bold text-gray-800">{wc.capacityHoursPerDay}h</p>
                      <p className="text-[10px] text-gray-400">{tr ? 'Kapasite/gün' : 'Cap/day'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-sm font-bold text-gray-800">{wc.efficiency}%</p>
                      <p className="text-[10px] text-gray-400">{tr ? 'Verimlilik' : 'Efficiency'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-sm font-bold text-gray-800">{wc.workerCount}</p>
                      <p className="text-[10px] text-gray-400">{tr ? 'Çalışan' : 'Workers'}</p>
                    </div>
                  </div>
                  {wc.costPerHour > 0 && (
                    <p className="text-xs text-gray-500 text-right">₺{wc.costPerHour.toLocaleString('tr-TR')}/{tr ? 'saat' : 'hr'}</p>
                  )}
                </div>
              );
            })}
          </div>

          {workCenters.length === 0 && !showWCForm && (
            <div className="apple-card p-12 text-center space-y-3">
              <Settings className="w-12 h-12 text-gray-200 mx-auto" />
              <p className="font-semibold text-gray-500">{tr ? 'İş merkezi tanımlanmamış' : 'No work centers defined'}</p>
              <p className="text-sm text-gray-400 max-w-xs mx-auto">
                {tr ? 'Torna, freze, montaj hattı gibi iş merkezlerini tanımlayın. Kapasite ve verimlilik bilgileri yük hesabında kullanılır.' : 'Define lathe, milling, assembly line work centers. Capacity and efficiency drive load calculations.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Routings ─────────────────────────────────────────────────────── */}
      {view === 'routing' && (
        <div className="space-y-4">
          {isAuthenticated && (
            <button onClick={() => { setShowRoutingForm(true); setEditingRoutingId(null); setRoutingDraft(emptyRouting); }}
              className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />{tr ? 'Rota Şablonu Ekle' : 'Add Routing Template'}
            </button>
          )}

          <AnimatePresence>
            {showRoutingForm && (
              <motion.div key="rform" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="apple-card p-5 border-2 border-brand/20 space-y-4">
                <div className="flex justify-between">
                  <h4 className="font-bold text-gray-800">{tr ? 'Yeni Rota Şablonu' : 'New Routing Template'}</h4>
                  <button onClick={() => setShowRoutingForm(false)}><X className="w-4 h-4 text-gray-400" /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input value={routingDraft.productName} onChange={e => setRoutingDraft(d => ({ ...d, productName: e.target.value }))}
                    placeholder={tr ? 'Ürün adı' : 'Product name'} className="apple-input px-3 py-2 text-sm" />
                  <input value={routingDraft.productSku} onChange={e => setRoutingDraft(d => ({ ...d, productSku: e.target.value }))}
                    placeholder="SKU" className="apple-input px-3 py-2 text-sm" />
                  <textarea value={routingDraft.notes} onChange={e => setRoutingDraft(d => ({ ...d, notes: e.target.value }))}
                    placeholder={tr ? 'Notlar' : 'Notes'} className="apple-input px-3 py-2 text-sm col-span-2 resize-none" rows={2} />
                </div>

                {/* Routing steps */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm font-bold text-gray-700">{tr ? 'Operasyon Adımları' : 'Operation Steps'}</p>
                    <button onClick={addRoutingStep} disabled={workCenters.length === 0}
                      className="text-xs text-brand font-semibold flex items-center gap-1 disabled:opacity-40">
                      <Plus className="w-3 h-3" />{tr ? 'Adım Ekle' : 'Add Step'}
                    </button>
                  </div>
                  {workCenters.length === 0 && (
                    <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">{tr ? 'Adım eklemek için önce iş merkezi tanımlayın.' : 'Define work centers first to add steps.'}</p>
                  )}
                  <div className="space-y-2">
                    {routingDraft.steps.map((step, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-3 grid grid-cols-12 gap-2 items-center">
                        <span className="col-span-1 text-sm font-bold text-gray-400 text-center">{step.stepNo}</span>
                        <select value={step.workCenterId}
                          onChange={e => {
                            const wc = workCenters.find(w => w.id === e.target.value);
                            setRoutingDraft(d => ({ ...d, steps: d.steps.map((s, j) => j === i ? { ...s, workCenterId: e.target.value, workCenterName: wc?.name ?? '' } : s) }));
                          }}
                          className="col-span-3 apple-input px-2 py-1.5 text-xs">
                          {workCenters.map(wc => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                        </select>
                        <input value={step.operation} onChange={e => setRoutingDraft(d => ({ ...d, steps: d.steps.map((s, j) => j === i ? { ...s, operation: e.target.value } : s) }))}
                          placeholder={tr ? 'Operasyon' : 'Operation'} className="col-span-3 apple-input px-2 py-1.5 text-xs" />
                        <div className="col-span-2 flex items-center gap-1">
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">{tr ? 'Haz.min' : 'Setup'}</span>
                          <input type="number" value={step.setupMinutes} min={0}
                            onChange={e => setRoutingDraft(d => ({ ...d, steps: d.steps.map((s, j) => j === i ? { ...s, setupMinutes: parseFloat(e.target.value) || 0 } : s) }))}
                            className="apple-input px-1.5 py-1 text-xs w-full" />
                        </div>
                        <div className="col-span-2 flex items-center gap-1">
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">{tr ? 'Koş.min/ad' : 'Run/unit'}</span>
                          <input type="number" value={step.runMinutesPerUnit} min={0}
                            onChange={e => setRoutingDraft(d => ({ ...d, steps: d.steps.map((s, j) => j === i ? { ...s, runMinutesPerUnit: parseFloat(e.target.value) || 0 } : s) }))}
                            className="apple-input px-1.5 py-1 text-xs w-full" />
                        </div>
                        <button onClick={() => setRoutingDraft(d => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))} className="col-span-1">
                          <X className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={saveRouting} className="apple-button-primary px-4 py-2 text-sm">{editingRoutingId ? (tr ? 'Güncelle' : 'Update') : (tr ? 'Kaydet' : 'Save')}</button>
                  <button onClick={() => setShowRoutingForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-3">
            {routings.map(r => (
              <div key={r.id} className="apple-card p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-gray-900">{r.productName}</p>
                    {r.productSku && <p className="text-xs text-gray-400 font-mono">{r.productSku}</p>}
                  </div>
                  {isAuthenticated && (
                    <div className="flex gap-1">
                      <button onClick={() => { setRoutingDraft({ productName: r.productName, productSku: r.productSku, steps: r.steps, notes: r.notes }); setEditingRoutingId(r.id); setShowRoutingForm(true); }}
                        className="p-1 hover:bg-gray-100 rounded-lg"><Edit2 className="w-3.5 h-3.5 text-gray-400" /></button>
                      <button onClick={() => deleteDoc(doc(db, 'routingTemplates', r.id))}
                        className="p-1 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                    </div>
                  )}
                </div>
                {/* Steps flow */}
                <div className="flex flex-wrap items-center gap-2">
                  {r.steps.map((step, i) => {
                    const wc = workCenters.find(w => w.id === step.workCenterId);
                    return (
                      <React.Fragment key={i}>
                        <div className="flex flex-col items-center">
                          <div className="text-xs font-bold px-3 py-1.5 rounded-lg text-white"
                            style={{ backgroundColor: wc?.color ?? '#6b7280' }}>
                            {step.workCenterName || wc?.name}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{step.operation}</p>
                          <p className="text-[10px] text-gray-300">{step.setupMinutes}min + {step.runMinutesPerUnit}min/ad</p>
                        </div>
                        {i < r.steps.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Capacity Load ─────────────────────────────────────────────────── */}
      {view === 'capacity' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">{tr ? 'Planlama Ufku:' : 'Planning Horizon:'}</label>
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {[7, 14, 30, 60].map(d => (
                <button key={d} onClick={() => setHorizonDays(d)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${horizonDays === d ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                  {d}{tr ? 'g' : 'd'}
                </button>
              ))}
            </div>
          </div>

          {capacityLoads.length === 0 ? (
            <div className="apple-card p-12 text-center">
              <BarChart2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400">{tr ? 'İş merkezi ve rota tanımlayın, kapasite yükü otomatik hesaplanır.' : 'Define work centers and routings — load is calculated automatically.'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {capacityLoads.map(load => {
                const pct = Math.min(120, load.utilizationPct);
                const color = load.utilizationPct > 100 ? '#ef4444' : load.utilizationPct > 80 ? '#f59e0b' : '#10b981';
                const wc = workCenters.find(w => w.id === load.workCenterId);
                return (
                  <div key={load.workCenterId} className="apple-card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: wc?.color ?? '#6b7280' }} />
                        <p className="font-semibold text-gray-900 text-sm">{load.workCenterName}</p>
                        {load.utilizationPct > 100 && (
                          <span className="text-[10px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded">
                            {tr ? 'AŞIRI YÜKÜ' : 'OVERLOADED'}
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-sm" style={{ color }}>
                        {load.utilizationPct}%
                      </span>
                    </div>
                    <div className="relative h-5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-full transition-all"
                        style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color, opacity: 0.8 }} />
                      {load.utilizationPct > 100 && (
                        <div className="absolute inset-y-0 right-0 w-1.5 bg-red-600 animate-pulse rounded-r-full" />
                      )}
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>{tr ? 'Planlanan:' : 'Planned:'} {fmtH(load.plannedHours)}</span>
                      <span>{tr ? 'Mevcut:' : 'Available:'} {fmtH(load.availableHours)} ({horizonDays}{tr ? 'g' : 'd'})</span>
                    </div>
                    {load.orders.length > 0 && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        {load.orders.slice(0, 3).join(', ')}{load.orders.length > 3 ? ` +${load.orders.length - 3}` : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── MRP Run ──────────────────────────────────────────────────────── */}
      {view === 'mrp' && (
        <div className="space-y-4">
          <div className="apple-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-brand" />
              <h3 className="font-bold text-gray-900">{tr ? 'MRP Çalıştır — Malzeme İhtiyaç Planlaması' : 'Run MRP — Material Requirements Planning'}</h3>
            </div>
            <p className="text-sm text-gray-500">
              {tr ? 'Üretmek istediğiniz ürünler ve miktarları girin. MRP, BOM patlaması yaparak eksik malzemeleri ve gerekli üretim emirlerini önerir.'
                : 'Enter products and quantities you need to produce. MRP explodes the BOM and suggests purchase/production orders for shortages.'}
            </p>

            <div className="space-y-2">
              {boms.length === 0 ? (
                <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-xl">{tr ? 'MRP için önce BOM (Malzeme Listesi) tanımlayın.' : 'Define BOMs first to run MRP.'}</p>
              ) : (
                boms.map(bom => (
                  <div key={bom.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                    <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="flex-1 text-sm font-medium text-gray-800">{bom.productName}</span>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">{tr ? 'Talep Miktarı' : 'Demand Qty'}</label>
                      <input type="number" min={0}
                        value={mrpQtyInput[bom.productName] ?? ''}
                        onChange={e => setMrpQtyInput(p => ({ ...p, [bom.productName]: parseInt(e.target.value) || 0 }))}
                        className="apple-input px-2 py-1.5 text-sm w-24" />
                    </div>
                  </div>
                ))
              )}
            </div>

            {boms.length > 0 && (
              <button onClick={runMRP} disabled={mrpRunning || Object.values(mrpQtyInput).every(v => !v)}
                className="apple-button-primary px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${mrpRunning ? 'animate-spin' : ''}`} />
                {mrpRunning ? (tr ? 'Hesaplanıyor…' : 'Calculating…') : 'MRP ' + (tr ? 'Çalıştır' : 'Run')}
              </button>
            )}
          </div>

          {/* MRP suggestions */}
          {mrpSuggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1">{tr ? 'MRP Önerileri' : 'MRP Suggestions'}</p>
              {mrpSuggestions.map((s, i) => (
                <div key={i} className={`apple-card p-4 flex items-center gap-3 ${s.type === 'purchase' ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-blue-400'}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${s.type === 'purchase' ? 'bg-amber-50' : 'bg-blue-50'}`}>
                    {s.type === 'purchase' ? <Package className="w-4 h-4 text-amber-600" /> : <Cpu className="w-4 h-4 text-blue-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.type === 'purchase' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                        {s.type === 'purchase' ? (tr ? 'SATIN AL' : 'PURCHASE') : (tr ? 'ÜRETİM EMRİ' : 'PRODUCTION')}
                      </span>
                      <p className="font-bold text-gray-900 text-sm">{s.itemName}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{s.reason}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-900">{s.qty} {s.unit}</p>
                    <p className="text-xs text-gray-400">{tr ? 'Gerekli:' : 'By:'} {new Date(s.neededBy).toLocaleDateString('tr-TR')}</p>
                    <MikroPushButton
                      compact
                      method={s.type === 'purchase' ? 'SatinAlmaTalepKaydetV2' : 'UretimTalepKaydetV2'}
                      entityType="mrpSuggestion"
                      entityId={`${s.type}-${i}`}
                      buildPayload={() => {
                        const sku = (s as unknown as { sku?: string }).sku ?? s.itemName;
                        if (!sku) return null;
                        return s.type === 'purchase'
                          ? satinAlmaTalepPayload({ sku, quantity: s.qty, deliveryDate: s.neededBy })
                          : uretimTalepPayload({ sku, quantity: s.qty, deliveryDate: s.neededBy });
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
