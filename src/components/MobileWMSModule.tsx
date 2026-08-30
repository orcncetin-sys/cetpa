import { useState, useEffect, useRef, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, incrementField } from '../lib/dbClient';
import { db } from '../firebase';
import { pushMikroEvrak, sayimPayload } from '../services/mikroEvrak';
import { Scan, Package, ArrowRight, ArrowLeft, RefreshCw, CheckCircle2, AlertCircle, Truck, Warehouse, X, Plus, MapPin, BarChart3, Pencil, Trash2 } from 'lucide-react';
import type { Warehouse as WarehouseRecord } from '../types';
import { confirmAction } from '../lib/confirm';


interface MobileWMSModuleProps {
  currentLanguage: string;
  isAuthenticated: boolean;
  inventory: any[];
  orders: any[];
  warehouses: WarehouseRecord[];
}

interface WMSLocation {
  id: string;
  code: string;     // e.g. A-01-01
  aisle: string;    // A
  rack: string;     // 01
  level: string;    // 01
  zone: 'receive' | 'storage' | 'pick' | 'ship' | 'return';
  // Konumlar önceden gerçek depo listesinden (warehouses) tamamen kopuktu —
  // "Depo Konumları" hep anlamsız/boş görünüyordu (2026-08-17 bildirimi).
  warehouseId?: string;
  active: boolean;
  createdAt: any;
  // 'mikro_import': server.ts Mikro depo senkronunda merge:true ile periyodik
  // ÜZERİNE YAZILIYOR (mikro-depo-<kod> id'si) — bu satırlar elle düzenlenirse/
  // silinirse bir sonraki senkronda değişiklik sessizce geri alınır/satır
  // yeniden oluşur. Düzenle/Sil bu yüzden bu satırlarda gösterilmez.
  source?: string;
}

const BOS_LOC_FORM = { aisle: 'A', rack: '01', level: '01', zone: 'storage' as WMSLocation['zone'], warehouseId: '' };

interface WMSTask {
  id: string;
  type: 'receive' | 'putaway' | 'pick' | 'transfer' | 'cycle_count';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  assignedTo?: string;
  referenceId?: string;   // order/receipt id
  referenceNo?: string;   // human-readable
  lines: WMSTaskLine[];
  priority: 'low' | 'normal' | 'high' | 'urgent';
  notes: string;
  createdAt: any;
  completedAt?: any;
}

interface WMSTaskLine {
  productId: string;
  productName: string;
  sku: string;
  qty: number;
  qtyDone: number;
  fromLocation?: string;
  toLocation?: string;
  lotNumber?: string;
  scanned: boolean;
}

interface CycleCountEntry {
  productId: string;
  productName: string;
  sku: string;
  systemQty: number;
  countedQty: number | null;
  location: string;
  counted: boolean;
}

export default function MobileWMSModule({ currentLanguage, isAuthenticated, inventory, orders, warehouses }: MobileWMSModuleProps) {
  const tr = currentLanguage === 'tr';
  const [view, setView] = useState<'dashboard' | 'receive' | 'pick' | 'transfer' | 'cycle' | 'locations' | 'tasks'>('dashboard');
  const [locations, setLocations] = useState<WMSLocation[]>([]);
  /**
   * GÖRÜNÜM listesi = wmsLocations ∪ (warehouses'tan türetilen satırlar).
   *
   * Mobil WMS "gerçek depoları" göstermiyordu (2026-08-28 bildirimi): depolar
   * `warehouses`ta duruyor (Depo QR Etiketleri onları listeliyor) ama bu ekran
   * yalnız `wmsLocations` okuyordu ve oraya yazan içe aktarma henüz
   * koşmamıştı. Türetilmiş satırlar SALT-GÖRÜNÜMdür (id `wh-` önekli):
   * düzenle/sil çıkmaz, çünkü kaynakları warehouses kaydıdır.
   */
  const konumlarBirlesik = useMemo<WMSLocation[]>(() => {
    const kapsananDepolar = new Set(locations.map(l => l.warehouseId).filter(Boolean));
    const turetilen = warehouses
      .filter(w => !kapsananDepolar.has(w.id))
      .map(w => ({
        id: `wh-${w.id}`,
        code: (w as unknown as { depoNo?: number }).depoNo != null
          ? `DEPO-${(w as unknown as { depoNo?: number }).depoNo}` : w.name.toUpperCase(),
        warehouseId: w.id,
        aisle: '—', rack: '—', level: '—',
        zone: 'storage' as WMSLocation['zone'],
        active: true,
      } as WMSLocation));
    return [...locations, ...turetilen];
  }, [locations, warehouses]);
  const [tasks, setTasks] = useState<WMSTask[]>([]);
  const [activeTask, setActiveTask] = useState<WMSTask | null>(null);
  const [scanInput, setScanInput] = useState('');
  const [scanResult, setScanResult] = useState<{ found: boolean; item?: any; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLocForm, setShowLocForm] = useState(false);
  const [cycleItems, setCycleItems] = useState<CycleCountEntry[]>([]);
  const [isMobileView] = useState(() => window.innerWidth < 768);
  const scanRef = useRef<HTMLInputElement>(null);

  // Location form
  const [locForm, setLocForm] = useState(BOS_LOC_FORM);
  // Konum listesinde düzenle/sil yoktu — yanlış girilen konum silinemiyordu
  // (2026-08-17 bildirimi). editingLocId doluysa form "Kaydet" güncelleme yapar.
  const [editingLocId, setEditingLocId] = useState<string | null>(null);
  const [locFormError, setLocFormError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(collection(db, 'wmsLocations'), snap => {
      // HAYALET FİLTRESİ (2026-08-28): source mikro* olup warehouseId'siz kayıt
      // eski `|| '1'` kodunun artığıdır (ekrandaki 'DEPO-1' böyle kalmıştı) —
      // gerçek depoya karşılık gelmez, listelenmez. Sunucu tarafı temizlik
      // /api/mikro/import/depo koşunca bunları kalıcı siler; bu filtre import
      // koşulana kadar da ekranı doğru tutar. Elle eklenen kayıtlarda source
      // yoktur, etkilenmezler.
      setLocations(snap.docs
        .map(d => ({ id: d.id, ...d.data() } as WMSLocation))
        .filter(l => !(String((l as unknown as { source?: string }).source ?? '').startsWith('mikro') && !l.warehouseId)));
      setLoading(false);
    }));
    unsubs.push(onSnapshot(collection(db, 'wmsTasks'), snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as WMSTask)));
    }));
    return () => unsubs.forEach(u => u());
  }, []);

  const saveLocation = async () => {
    const code = `${locForm.aisle}-${locForm.rack}-${locForm.level}`;
    // İki konum aynı kodu taşırsa barkod taraması (handleScan) ve bölge
    // varsayılanları (receive/ship fallback) ilkini bulup diğerini görmez —
    // sessizce yanlış konuma yönlendirebilir. Kayıttan önce engelle.
    const cakisan = locations.some(l => l.id !== editingLocId && l.code.toUpperCase() === code.toUpperCase());
    if (cakisan) { setLocFormError(tr ? `"${code}" kodlu konum zaten var.` : `A location with code "${code}" already exists.`); return; }
    setLocFormError(null);
    if (editingLocId) {
      await updateDoc(doc(db, 'wmsLocations', editingLocId), { code, ...locForm });
    } else {
      await addDoc(collection(db, 'wmsLocations'), {
        code, ...locForm, active: true, createdAt: serverTimestamp()
      });
    }
    setShowLocForm(false);
    setEditingLocId(null);
  };

  const openEditLocation = (l: WMSLocation) => {
    setLocForm({ aisle: l.aisle, rack: l.rack, level: l.level, zone: l.zone, warehouseId: l.warehouseId || '' });
    setEditingLocId(l.id);
    setLocFormError(null);
    setShowLocForm(true);
  };

  const confirmDeleteLocation = async (id: string) => {
    const ok = await confirmAction({
      title: tr ? 'Konumu Sil' : 'Delete Location',
      message: tr
        ? 'Bu konumu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.'
        : 'Are you sure you want to delete this location? This cannot be undone.',
      confirmLabel: tr ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'wmsLocations', id));
    } catch (e) {
      console.error('Konum silinemedi:', e);
      setLocFormError(tr ? 'Konum silinemedi.' : 'Could not delete location.');
    }
  };

  // Barcode / SKU scan handler
  const handleScan = (value: string) => {
    const term = value.trim().toUpperCase();
    if (!term) return;
    const item = inventory.find(i =>
      (i.sku || '').toUpperCase() === term ||
      (i.barcode || '').toUpperCase() === term ||
      (i.name || '').toUpperCase().includes(term)
    );
    if (item) {
      setScanResult({ found: true, item, message: item.name });
      // If active task, mark line as scanned
      if (activeTask) {
        const updatedLines = activeTask.lines.map(l =>
          l.sku.toUpperCase() === term ? { ...l, scanned: true, qtyDone: l.qty } : l
        );
        setActiveTask({ ...activeTask, lines: updatedLines });
      }
    } else {
      // Check locations
      const loc = locations.find(l => l.code.toUpperCase() === term);
      if (loc) {
        setScanResult({ found: true, message: `${tr ? 'Konum: ' : 'Location: '} ${loc.code} (${loc.zone})` });
      } else {
        setScanResult({ found: false, message: tr ? 'Ürün veya konum bulunamadı.' : 'Product or location not found.' });
      }
    }
    setTimeout(() => setScanResult(null), 3000);
    setScanInput('');
  };

  // Create receive task from orders
  const createReceiveTask = async (order: any) => {
    const lines: WMSTaskLine[] = (order.lineItems || []).map((li: any) => ({
      productId: li.productId || '',
      productName: li.productName || li.name || '',
      sku: li.sku || '',
      qty: li.qty || li.quantity || 0,
      qtyDone: 0,
      toLocation: locations.find(l => l.zone === 'receive')?.code || 'RECEIVE',
      scanned: false,
    }));

    await addDoc(collection(db, 'wmsTasks'), {
      type: 'receive',
      status: 'pending',
      referenceNo: order.orderNo || order.id,
      referenceId: order.id,
      lines,
      priority: 'normal',
      notes: '',
      createdAt: serverTimestamp(),
    });
  };

  // Create pick task
  const createPickTask = async (order: any) => {
    const lines: WMSTaskLine[] = (order.lineItems || []).map((li: any) => {
      const storLoc = locations.find(l => l.zone === 'storage');
      return {
        productId: li.productId || '',
        productName: li.productName || li.name || '',
        sku: li.sku || '',
        qty: li.qty || li.quantity || 0,
        qtyDone: 0,
        fromLocation: storLoc?.code || 'STORAGE',
        toLocation: locations.find(l => l.zone === 'ship')?.code || 'SHIP',
        scanned: false,
      };
    });

    await addDoc(collection(db, 'wmsTasks'), {
      type: 'pick',
      status: 'pending',
      referenceNo: order.orderNo || order.id,
      referenceId: order.id,
      lines,
      priority: 'normal',
      notes: '',
      createdAt: serverTimestamp(),
    });
  };

  const completeTask = async (task: WMSTask) => {
    await updateDoc(doc(db, 'wmsTasks', task.id), {
      status: 'completed',
      lines: task.lines,
      completedAt: serverTimestamp(),
    });
    // Görev tamamlanınca stok hareketi: mal kabul/yerleştirme → giriş, toplama → çıkış.
    // (Önce stok hiç hareket etmiyordu.) Atomik increment + hareket logu.
    const dir: 'in' | 'out' | null = (task.type === 'receive' || task.type === 'putaway') ? 'in' : task.type === 'pick' ? 'out' : null;
    if (dir) {
      for (const line of task.lines) {
        const qty = Number(line.qtyDone || line.qty) || 0;
        if (!line.productId || qty <= 0) continue;
        try {
          await incrementField('inventory', line.productId, 'stockLevel', dir === 'out' ? -qty : qty, 0);
          await addDoc(collection(db, 'inventoryMovements'), {
            type: dir, productId: line.productId, productName: line.productName, sku: line.sku,
            quantity: qty, note: `WMS ${task.type}`, timestamp: serverTimestamp(),
          });
        } catch (err) { console.error('[completeTask stok]', err); }
      }
    }
    setActiveTask(null);
  };

  // Cycle count setup
  const startCycleCount = () => {
    const items: CycleCountEntry[] = inventory.slice(0, 20).map(i => ({
      productId: i.id,
      productName: i.name,
      sku: i.sku || '',
      systemQty: i.quantity || i.stock || 0,
      countedQty: null,
      location: locations.find(l=>l.zone==='storage')?.code || 'STORAGE',
      counted: false,
    }));
    setCycleItems(items);
    setView('cycle');
  };

  const submitCycleCount = async () => {
    const discrepancies = cycleItems.filter(i => i.counted && i.countedQty !== null && i.countedQty !== i.systemQty);
    await addDoc(collection(db, 'wmsCycleCounts'), {
      date: new Date().toISOString().split('T')[0],
      items: cycleItems,
      discrepancyCount: discrepancies.length,
      createdAt: serverTimestamp(),
    });
    // Sayım sonuçlarını Mikro'ya da gönder (SayimSonuclariKaydetV2) — hata
    // lokal kaydı engellemez, syncLog'dan izlenir.
    const counted = cycleItems.filter(i => i.counted && i.countedQty !== null && i.sku);
    if (counted.length > 0) {
      pushMikroEvrak('SayimSonuclariKaydetV2',
        sayimPayload(counted.map(i => ({ sku: i.sku, counted: i.countedQty ?? 0 }))),
        { entityType: 'cycleCount', entityId: new Date().toISOString().slice(0, 10) }
      ).catch(() => { /* syncLog'da görünür */ });
    }
    // Sayım farklarını uygula: kanonik 'stockLevel' alanına yaz (önce 'quantity'ye
    // yazıyordu — app geneli stockLevel kullanıyor, düzeltme görünmüyordu) + hareket logu.
    for (const item of discrepancies) {
      if (item.countedQty === null) continue;
      const counted = Math.max(0, Number(item.countedQty) || 0);
      await updateDoc(doc(db, 'inventory', item.productId), { stockLevel: counted, quantity: counted });
      const delta = counted - (Number(item.systemQty) || 0);
      if (delta !== 0) {
        await addDoc(collection(db, 'inventoryMovements'), {
          type: delta >= 0 ? 'in' : 'out', productId: item.productId, productName: item.productName, sku: item.sku,
          quantity: Math.abs(delta), note: tr ? 'Sayım düzeltmesi' : 'Cycle-count adjustment', timestamp: serverTimestamp(),
        });
      }
    }
    setCycleItems([]);
    setView('dashboard');
  };

  // Stats
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
  const todayCompleted = tasks.filter(t => t.status === 'completed' && t.completedAt).length;


  const tabs = [
    { id: 'dashboard', label: tr ? 'Panel' : 'Dashboard', icon: BarChart3 },
    { id: 'tasks', label: tr ? 'Görevler' : 'Tasks', icon: Package },
    { id: 'receive', label: tr ? 'Teslim Al' : 'Receive', icon: Truck },
    { id: 'pick', label: tr ? 'Topla' : 'Pick', icon: ArrowRight },
    { id: 'locations', label: tr ? 'Konumlar' : 'Locations', icon: MapPin },
  ] as const;

  if (!isAuthenticated) return <div className="p-8 text-center text-gray-500">{tr ? 'Lütfen giriş yapın.' : 'Please sign in.'}</div>;
  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full" /></div>;

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-orange-500 flex items-center justify-center">
            <Warehouse className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{tr ? 'Mobil Depo Yönetimi' : 'Mobile WMS'}</h1>
            <p className="text-sm text-gray-500">{tr ? 'Depo operasyonları & barkod tarama' : 'Warehouse operations & barcode scanning'}</p>
          </div>
        </div>
      </div>

      {/* Scan bar — always visible */}
      <div className="apple-card p-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
          <Scan className="w-4 h-4 text-orange-600" />
        </div>
        <input
          ref={scanRef}
          className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400"
          placeholder={tr ? 'SKU veya barkod tarayın / girin...' : 'Scan or type SKU / barcode...'}
          value={scanInput}
          onChange={e => setScanInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput); }}
          autoFocus
        />
        <button onClick={() => handleScan(scanInput)}
          className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-medium">
          {tr ? 'Tara' : 'Scan'}
        </button>
      </div>

      {/* Scan result toast */}
      {scanResult && (
        <div className={`p-3 rounded-2xl flex items-center gap-3 text-sm font-medium ${scanResult.found ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
          {scanResult.found ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          {scanResult.found && scanResult.item ? (
            <div>
              <p>{scanResult.item.name}</p>
              <p className="text-xs opacity-75">{tr ? 'Stok: ' : 'Stock: '}{scanResult.item.quantity ?? scanResult.item.stock ?? 0} {tr ? 'adet' : 'units'}</p>
            </div>
          ) : (
            <p>{scanResult.message}</p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium transition-all ${view === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* DASHBOARD */}
      {view === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: tr ? 'Bekleyen Görev' : 'Pending Tasks', value: pendingTasks, color: 'text-orange-600', bg: 'bg-orange-50' },
              { label: tr ? 'Devam Eden' : 'In Progress', value: inProgressTasks, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: tr ? 'Tamamlanan' : 'Completed', value: todayCompleted, color: 'text-green-600', bg: 'bg-green-50' },
              { label: tr ? 'Konum Sayısı' : 'Locations', value: locations.length, color: 'text-purple-600', bg: 'bg-purple-50' },
            ].map((m,i) => (
              <div key={i} className={`apple-card p-4 ${m.bg}`}>
                <p className="text-xs text-gray-500">{m.label}</p>
                <p className={`text-2xl font-bold mt-1 ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: Truck, label: tr ? 'Mal Kabul' : 'Receive Goods', color: 'bg-blue-500', action: () => setView('receive') },
              { icon: ArrowRight, label: tr ? 'Sipariş Toplama' : 'Pick Orders', color: 'bg-green-500', action: () => setView('pick') },
              { icon: RefreshCw, label: tr ? 'Sayım Başlat' : 'Start Count', color: 'bg-purple-500', action: startCycleCount },
              { icon: ArrowLeft, label: tr ? 'Transfer' : 'Transfer', color: 'bg-orange-500', action: () => setView('tasks') },
            ].map((a,i) => (
              <button key={i} onClick={a.action}
                className="apple-card p-4 flex flex-col items-center gap-2 hover:shadow-md transition-shadow">
                <div className={`w-10 h-10 rounded-2xl ${a.color} flex items-center justify-center`}>
                  <a.icon className="w-5 h-5 text-white" />
                </div>
                <p className="text-sm font-medium text-center">{a.label}</p>
              </button>
            ))}
          </div>

          {/* Recent tasks */}
          {tasks.length > 0 && (
            <div className="apple-card p-4">
              <h3 className="font-semibold text-sm mb-3">{tr ? 'Son Görevler' : 'Recent Tasks'}</h3>
              <div className="space-y-2">
                {tasks.slice(0,5).map(t => (
                  <div key={t.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.status === 'completed' ? 'bg-green-500' : t.status === 'in_progress' ? 'bg-blue-500' : 'bg-orange-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium capitalize">{t.type.replace('_',' ')}</p>
                      <p className="text-xs text-gray-400">{t.referenceNo || t.id.slice(-6)}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      t.status === 'completed' ? 'bg-green-100 text-green-700' :
                      t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      'bg-orange-100 text-orange-700'
                    }`}>{t.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* RECEIVE VIEW */}
      {view === 'receive' && (
        <div className="space-y-4">
          <h2 className="font-semibold">{tr ? 'Mal Kabul' : 'Receive Goods'}</h2>
          {/* Pending orders */}
          <div className="space-y-2">
            {orders.filter(o => o.status === 'pending' || o.status === 'Beklemede').slice(0, 10).map(order => (
              <div key={order.id} className="apple-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{order.orderNo || order.id.slice(-8)}</p>
                    <p className="text-xs text-gray-500">{order.customerName || order.customer}</p>
                    <p className="text-xs text-gray-400">{(order.lineItems || []).length} {tr ? 'kalem' : 'lines'}</p>
                  </div>
                  <button onClick={() => createReceiveTask(order)}
                    className="apple-button-primary text-white px-3 py-1.5 rounded-full text-xs flex items-center gap-1">
                    <Plus className="w-3 h-3" /> {tr ? 'Görev Oluştur' : 'Create Task'}
                  </button>
                </div>
              </div>
            ))}
            {orders.filter(o => o.status === 'pending' || o.status === 'Beklemede').length === 0 && (
              <div className="p-8 text-center text-gray-400">
                <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>{tr ? 'Bekleyen sipariş bulunamadı.' : 'No pending orders found.'}</p>
              </div>
            )}
          </div>

          {/* Active receive tasks */}
          {tasks.filter(t => t.type === 'receive' && t.status !== 'completed').map(task => (
            <div key={task.id} className="apple-card p-4 border-2 border-blue-200">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium text-sm">{tr ? 'Görev: ' : 'Task: '}{task.referenceNo}</p>
                  <p className="text-xs text-gray-500">{task.lines.filter(l=>l.scanned).length}/{task.lines.length} {tr ? 'tarandı' : 'scanned'}</p>
                </div>
                <button onClick={() => setActiveTask(activeTask?.id === task.id ? null : task)}
                  className="text-xs px-3 py-1.5 rounded-full bg-blue-50 text-blue-700">
                  {activeTask?.id === task.id ? (tr ? 'Kapat' : 'Close') : (tr ? 'Aç' : 'Open')}
                </button>
              </div>
              {activeTask?.id === task.id && (
                <div className="space-y-2">
                  {activeTask.lines.map((line, i) => (
                    <div key={i} className={`flex items-center gap-3 p-2 rounded-xl ${line.scanned ? 'bg-green-50' : 'bg-gray-50'}`}>
                      {line.scanned ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> : <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{line.productName}</p>
                        <p className="text-xs text-gray-500">{line.sku}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{line.qtyDone}/{line.qty}</p>
                        <p className="text-xs text-gray-400">{line.toLocation}</p>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => completeTask(activeTask)}
                    className="w-full apple-button-primary text-white py-2.5 rounded-full text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4 inline mr-1" /> {tr ? 'Tamamla' : 'Complete'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* PICK VIEW */}
      {view === 'pick' && (
        <div className="space-y-4">
          <h2 className="font-semibold">{tr ? 'Sipariş Toplama' : 'Order Picking'}</h2>
          {orders.filter(o => o.status === 'confirmed' || o.status === 'Onaylandı').slice(0, 10).map(order => (
            <div key={order.id} className="apple-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{order.orderNo || order.id.slice(-8)}</p>
                  <p className="text-xs text-gray-500">{order.customerName || order.customer}</p>
                  <p className="text-xs text-gray-400">{(order.lineItems || []).length} {tr ? 'kalem' : 'lines'}</p>
                </div>
                <button onClick={() => createPickTask(order)}
                  className="apple-button-primary text-white px-3 py-1.5 rounded-full text-xs flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" /> {tr ? 'Topla' : 'Pick'}
                </button>
              </div>
            </div>
          ))}
          {orders.filter(o => o.status === 'confirmed' || o.status === 'Onaylandı').length === 0 && (
            <div className="p-8 text-center text-gray-400">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>{tr ? 'Toplanacak sipariş bulunamadı.' : 'No orders to pick.'}</p>
            </div>
          )}

          {/* Pick tasks in progress */}
          {tasks.filter(t => t.type === 'pick' && t.status !== 'completed').map(task => (
            <div key={task.id} className="apple-card p-4 border-2 border-green-200">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium text-sm">{task.referenceNo}</p>
                  <p className="text-xs text-gray-500">{task.lines.filter(l=>l.scanned).length}/{task.lines.length} {tr ? 'toplandı' : 'picked'}</p>
                </div>
                <button onClick={() => setActiveTask(activeTask?.id === task.id ? null : task)}
                  className="text-xs px-3 py-1.5 rounded-full bg-green-50 text-green-700">
                  {activeTask?.id === task.id ? (tr ? 'Kapat' : 'Close') : (tr ? 'Topla' : 'Pick')}
                </button>
              </div>
              {activeTask?.id === task.id && (
                <div className="space-y-2">
                  {activeTask.lines.map((line, i) => (
                    <div key={i} className={`flex items-center gap-3 p-2 rounded-xl ${line.scanned ? 'bg-green-50' : 'bg-gray-50'}`}>
                      {line.scanned ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> : <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{line.productName}</p>
                        <p className="text-xs text-gray-500 font-mono">{line.sku}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="font-medium">{line.qty} {tr ? 'adet' : 'pcs'}</p>
                        <p className="text-gray-400">{tr ? 'Yerden: ' : 'From: '}{line.fromLocation}</p>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => completeTask(activeTask)}
                    className="w-full apple-button-primary text-white py-2.5 rounded-full text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4 inline mr-1" /> {tr ? 'Toplama Tamamla' : 'Complete Pick'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* CYCLE COUNT */}
      {view === 'cycle' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{tr ? 'Envanter Sayımı' : 'Cycle Count'}</h2>
            <div className="flex gap-2">
              <button onClick={() => setView('dashboard')} className="apple-button-secondary px-3 py-1.5 rounded-full text-xs">
                {tr ? 'İptal' : 'Cancel'}
              </button>
              <button onClick={submitCycleCount} className="apple-button-primary text-white px-3 py-1.5 rounded-full text-xs">
                {tr ? 'Sayımı Kaydet' : 'Submit Count'}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {cycleItems.map((item, i) => (
              <div key={i} className={`apple-card p-4 ${item.counted ? 'border-2 border-green-200' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{item.productName}</p>
                    <p className="text-xs text-gray-500 font-mono">{item.sku}</p>
                    <p className="text-xs text-gray-400">{tr ? 'Sistem: ' : 'System: '}{item.systemQty} {tr ? 'adet' : 'units'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className="apple-input w-20 p-2 rounded-xl text-sm text-right"
                      placeholder={tr ? 'Sayılan' : 'Counted'}
                      value={item.countedQty ?? ''}
                      onChange={e => {
                        const raw = Number(e.target.value);
                        const val = Number.isFinite(raw) ? Math.max(0, raw) : 0; // negatif/NaN engeli
                        setCycleItems(prev => prev.map((ci, j) =>
                          j === i ? { ...ci, countedQty: val, counted: true } : ci
                        ));
                      }}
                    />
                    {item.counted && item.countedQty !== null && (
                      <span className={`text-xs font-medium ${item.countedQty === item.systemQty ? 'text-green-600' : 'text-red-500'}`}>
                        {item.countedQty === item.systemQty ? '✓' : `${item.countedQty > item.systemQty ? '+' : ''}${item.countedQty - item.systemQty}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TASKS VIEW */}
      {view === 'tasks' && (
        <div className="space-y-4">
          <h2 className="font-semibold">{tr ? 'Tüm Görevler' : 'All Tasks'}</h2>
          {tasks.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>{tr ? 'Görev bulunamadı.' : 'No tasks found.'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map(t => (
                <div key={t.id} className="apple-card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          t.type === 'receive' ? 'bg-blue-100 text-blue-700' :
                          t.type === 'pick' ? 'bg-green-100 text-green-700' :
                          t.type === 'transfer' ? 'bg-orange-100 text-orange-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>{t.type.replace('_',' ')}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          t.status === 'completed' ? 'bg-green-100 text-green-700' :
                          t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                          t.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-orange-100 text-orange-700'
                        }`}>{t.status}</span>
                      </div>
                      <p className="text-sm mt-1">{t.referenceNo || t.id.slice(-8)}</p>
                      <p className="text-xs text-gray-400">{t.lines.length} {tr ? 'kalem' : 'lines'} · {t.lines.filter(l=>l.scanned).length} {tr ? 'tamamlandı' : 'done'}</p>
                    </div>
                    {t.status !== 'completed' && (
                      <button onClick={() => setActiveTask(t)}
                        className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200">
                        {tr ? 'Devam Et' : 'Resume'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LOCATIONS VIEW */}
      {view === 'locations' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{tr ? 'Depo Konumları' : 'Warehouse Locations'}</h2>
            <button onClick={() => { setLocForm(BOS_LOC_FORM); setEditingLocId(null); setLocFormError(null); setShowLocForm(true); }}
              className="apple-button-primary text-white px-3 py-1.5 rounded-full text-xs flex items-center gap-1">
              <Plus className="w-3 h-3" /> {tr ? 'Konum Ekle' : 'Add Location'}
            </button>
          </div>

          {/* Zone summary */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {(['receive','storage','pick','ship','return'] as const).map(zone => {
              const count = locations.filter(l => l.zone === zone).length;
              return (
                <div key={zone} className="apple-card p-3 text-center">
                  <p className="text-xs text-gray-500 capitalize">{zone}</p>
                  <p className="text-xl font-bold mt-1">{count}</p>
                </div>
              );
            })}
          </div>

          <div className="apple-card overflow-hidden">
            {locations.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>{tr ? 'Konum bulunamadı.' : 'No locations found.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Kod' : 'Code'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Depo' : 'Warehouse'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Koridor' : 'Aisle'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Raf' : 'Rack'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Seviye' : 'Level'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Bölge' : 'Zone'}</th>
                    {isAuthenticated && <th className="p-3" />}
                  </tr>
                </thead>
                <tbody>
                  {[...konumlarBirlesik].sort((a,b) => a.code.localeCompare(b.code)).map(l => (
                    <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="p-3 font-mono font-medium">{l.code}</td>
                      <td className="p-3 text-xs">
                        {l.warehouseId
                          ? (warehouses.find(w => w.id === l.warehouseId)?.name ?? <span className="text-amber-500">{tr ? 'Bilinmeyen depo' : 'Unknown warehouse'}</span>)
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="p-3">{l.aisle}</td>
                      <td className="p-3">{l.rack}</td>
                      <td className="p-3">{l.level}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          l.zone === 'receive' ? 'bg-blue-50 text-blue-700' :
                          l.zone === 'storage' ? 'bg-green-50 text-green-700' :
                          l.zone === 'pick' ? 'bg-orange-50 text-orange-700' :
                          l.zone === 'ship' ? 'bg-purple-50 text-purple-700' :
                          'bg-gray-50 text-gray-700'
                        }`}>{l.zone}</span>
                      </td>
                      {isAuthenticated && (
                        <td className="p-3">
                          {l.id.startsWith('wh-') ? (
                            <span className="text-[10px] text-gray-400" title={tr ? 'Gerçek depo kaydından türedi (warehouses) — Depo sekmesinden yönetilir' : 'Derived from warehouse record'}>
                              {tr ? 'Depo' : 'WH'}
                            </span>
                          ) : l.source === 'mikro_import' ? (
                            // Mikro depo senkronu bu satırı periyodik olarak merge:true ile
                            // ÜZERİNE YAZIYOR — elle düzenleme/silme sessizce geri alınır/
                            // yeniden oluşur. Kafa karıştırmamak için düzenle/sil gizli.
                            <span title={tr ? 'Mikro depo senkronundan geliyor — burada düzenlenemez' : 'Synced from Mikro warehouse — cannot be edited here'} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 float-right">
                              {tr ? 'Mikro' : 'Mikro'}
                            </span>
                          ) : (
                            <div className="flex items-center gap-1 justify-end">
                              <button onClick={() => openEditLocation(l)} className="p-2.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => { void confirmDeleteLocation(l.id); }} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {/* LOCATION FORM MODAL */}
      {showLocForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingLocId ? (tr ? 'Konumu Düzenle' : 'Edit Location') : (tr ? 'Yeni Konum' : 'New Location')}</h2>
              <button onClick={() => { setShowLocForm(false); setEditingLocId(null); setLocFormError(null); }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Depo' : 'Warehouse'}</label>
              <select className="apple-input w-full p-3 rounded-xl text-sm" value={locForm.warehouseId} onChange={e=>setLocForm(p=>({...p,warehouseId:e.target.value}))}>
                <option value="">{tr ? 'Depo seçin' : 'Select warehouse'}</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Koridor' : 'Aisle'}</label>
                <input className="apple-input w-full p-3 rounded-xl text-sm" value={locForm.aisle} onChange={e=>setLocForm(p=>({...p,aisle:e.target.value.toUpperCase()}))} maxLength={3} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Raf No' : 'Rack No'}</label>
                <input className="apple-input w-full p-3 rounded-xl text-sm" value={locForm.rack} onChange={e=>setLocForm(p=>({...p,rack:e.target.value}))} maxLength={3} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Seviye' : 'Level'}</label>
                <input className="apple-input w-full p-3 rounded-xl text-sm" value={locForm.level} onChange={e=>setLocForm(p=>({...p,level:e.target.value}))} maxLength={3} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Önizleme' : 'Preview'}</label>
              <p className="font-mono text-sm bg-gray-50 p-2 rounded-xl">{locForm.aisle}-{locForm.rack}-{locForm.level}</p>
            </div>
            <select className="apple-input w-full p-3 rounded-xl text-sm" value={locForm.zone} onChange={e=>setLocForm(p=>({...p,zone:e.target.value as WMSLocation['zone']}))}>
              <option value="receive">Receive</option>
              <option value="storage">Storage</option>
              <option value="pick">Pick</option>
              <option value="ship">Ship</option>
              <option value="return">Return</option>
            </select>
            {locFormError && (
              <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{locFormError}</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setShowLocForm(false); setEditingLocId(null); setLocFormError(null); }} className="apple-button-secondary flex-1 p-3 rounded-full text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={saveLocation} className="apple-button-primary text-white flex-1 p-3 rounded-full text-sm">{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
