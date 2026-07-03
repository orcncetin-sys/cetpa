import { create } from 'zustand';
import type {
  Order, Lead, InventoryItem, Shipment, Quotation,
  Warehouse, InventoryMovement, Employee, Payroll, Consignment, StockDiscrepancy
} from '../types';

interface DataState {
  commissionRules: any[];
  setCommissionRules: (val: any[] | ((prev: any[]) => any[])) => void;
  suppliers: any[];
  setSuppliers: (val: any[] | ((prev: any[]) => any[])) => void;
  userSubscription: any | null;
  setUserSubscription: (val: any | null | ((prev: any | null) => any | null)) => void;
  paymentHistory: any[];
  setPaymentHistory: (val: any[] | ((prev: any[]) => any[])) => void;
  notifications: any[];
  setNotifications: (val: any[] | ((prev: any[]) => any[])) => void;
  fxPos: { usdBalance: number, usdBookRate: number, eurBalance: number, eurBookRate: number };
  setFxPos: (val: any | ((prev: any) => any)) => void;
  companySettings: Record<string, unknown>;
  setCompanySettings: (val: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  logoUrl: string | null;
  setLogoUrl: (val: string | null | ((prev: string | null) => string | null)) => void;
  geminiApiKeySetting: string;
  setGeminiApiKeySetting: (val: string | ((prev: string) => string)) => void;
  mikroSettings: Record<string, unknown>;
  setMikroSettings: (val: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  lucaSettings: Record<string, unknown>;
  setLucaSettings: (val: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  gibConnected: boolean;
  setGibConnected: (val: boolean | ((prev: boolean) => boolean)) => void;
  branchNames: string[];
  setBranchNames: (val: string[] | ((prev: string[]) => string[])) => void;
  exchangeRates: Record<string, number> | null;
  setExchangeRates: (val: Record<string, number> | null | ((prev: Record<string, number> | null) => Record<string, number> | null)) => void;
  notifPrefs: Record<string, boolean>;
  setNotifPrefs: (val: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  leads: Lead[];
  setLeads: (leads: Lead[]) => void;

  orders: Order[];
  setOrders: (orders: Order[]) => void;

  shipments: Shipment[];
  setShipments: (shipments: Shipment[]) => void;

  inventory: InventoryItem[];
  setInventory: (inventory: InventoryItem[]) => void;

  appQuotations: Quotation[];
  setAppQuotations: (quotations: Quotation[]) => void;

  warehouses: Warehouse[];
  setWarehouses: (warehouses: Warehouse[]) => void;

  inventoryMovements: InventoryMovement[];
  setInventoryMovements: (movements: InventoryMovement[]) => void;

  consignments: Consignment[];
  setConsignments: (consignments: Consignment[]) => void;

  stockDiscrepancies: StockDiscrepancy[];
  setStockDiscrepancies: (discrepancies: StockDiscrepancy[]) => void;

  employees: Employee[];
  setEmployees: (employees: Employee[]) => void;

  payrolls: Payroll[];
  setPayrolls: (payrolls: Payroll[]) => void;

  webhookConfigs: any[];
  setWebhookConfigs: (configs: any[]) => void;
  p547BankAccounts: any[];
  setP547BankAccounts: (accounts: any[]) => void;
  p547FixedAssets: any[];
  setP547FixedAssets: (assets: any[]) => void;
  p548Masraflar: any[];
  setP548Masraflar: (masraflar: any[]) => void;
  p552Records: any[];
  setP552Records: (records: any[]) => void;
  p554Bins: any[];
  setP554Bins: (bins: any[]) => void;
  p549Iadeler: any[];
  setP549Iadeler: (iadeler: any[]) => void;
  dashVergiDeadlines: any[];
  setDashVergiDeadlines: (deadlines: any[]) => void;
  supportTickets: any[];
  setSupportTickets: (tickets: any[]) => void;
  contracts: any[];
  setContracts: (contracts: any[]) => void;
  recurringOrders: any[];
  setRecurringOrders: (orders: any[]) => void;
  leaveRequests: any[];
  setLeaveRequests: (requests: any[]) => void;
  priceOverrides: any[];
  setPriceOverrides: (overrides: any[]) => void;
  monthlyTargets: Record<string, number>;
  setMonthlyTargets: (targets: Record<string, number>) => void;
  monthlyTarget: number;
  setMonthlyTarget: (target: number) => void;
  p567Ratings: Record<string, Record<string, number>>;
  setP567Ratings: (data: Record<string, Record<string, number>> | ((prev: Record<string, Record<string, number>>) => Record<string, Record<string, number>>)) => void;
  p573Rules: any[];
  setP573Rules: (data: any[] | ((prev: any[]) => any[])) => void;
  p579Batches: any[];
  setP579Batches: (data: any[] | ((prev: any[]) => any[])) => void;
  p584CountItems: any[];
  setP584CountItems: (data: any[] | ((prev: any[]) => any[])) => void;
  p612Draft: any;
  setP612Draft: (data: any | ((prev: any) => any)) => void;
  allBudgetsFirestore: Record<string, any[]>;
  setAllBudgetsFirestore: (budgets: Record<string, any[]>) => void;
  auditLogs: any[];
  setAuditLogs: (logs: any[]) => void;
  apPurchaseOrders: any[];
  setApPurchaseOrders: (orders: any[]) => void;
  p582Projects: any[];
  setP582Projects: (projects: any[]) => void;
  p595Tasks: any[];
  setP595Tasks: (tasks: any[]) => void;
  p597Contracts: any[];
  setP597Contracts: (contracts: any[]) => void;
  p605Capacity: any[];
  setP605Capacity: (capacity: any[]) => void;
  p618Projects: any[];
  setP618Projects: (projects: any[]) => void;
  p621Demands: any[];
  setP621Demands: (demands: any[]) => void;
  p623LCs: any[];
  setP623LCs: (lcs: any[]) => void;
  p624Orders: any[];
  setP624Orders: (orders: any[]) => void;
  p639Returns: any[];
  setP639Returns: (returns: any[]) => void;
  p640Subs: any[];
  setP640Subs: (subs: any[]) => void;
  p642Warranties: any[];
  setP642Warranties: (warranties: any[]) => void;
  p643Txns: any[];
  setP643Txns: (txns: any[]) => void;
}

export const useDataStore = create<DataState>((set) => ({
  commissionRules: [],
  setCommissionRules: (val) => set((state) => ({ commissionRules: typeof val === 'function' ? val(state.commissionRules) : val })),
  suppliers: [],
  setSuppliers: (val) => set((state) => ({ suppliers: typeof val === 'function' ? val(state.suppliers) : val })),
  userSubscription: null,
  setUserSubscription: (val) => set((state) => ({ userSubscription: typeof val === 'function' ? val(state.userSubscription) : val })),
  paymentHistory: [],
  setPaymentHistory: (val) => set((state) => ({ paymentHistory: typeof val === 'function' ? val(state.paymentHistory) : val })),
  notifications: [],
  setNotifications: (val) => set((state) => ({ notifications: typeof val === 'function' ? val(state.notifications) : val })),
  fxPos: { usdBalance: 0, usdBookRate: 0, eurBalance: 0, eurBookRate: 0 },
  setFxPos: (val) => set((state) => ({ fxPos: typeof val === 'function' ? val(state.fxPos) : val })),
  companySettings: {},
  setCompanySettings: (val) => set((state) => ({ companySettings: typeof val === 'function' ? val(state.companySettings) : val })),
  logoUrl: null,
  setLogoUrl: (val) => set((state) => ({ logoUrl: typeof val === 'function' ? val(state.logoUrl) : val })),
  geminiApiKeySetting: '',
  setGeminiApiKeySetting: (val) => set((state) => ({ geminiApiKeySetting: typeof val === 'function' ? val(state.geminiApiKeySetting) : val })),
  mikroSettings: {},
  setMikroSettings: (val) => set((state) => ({ mikroSettings: typeof val === 'function' ? val(state.mikroSettings) : val })),
  lucaSettings: {},
  setLucaSettings: (val) => set((state) => ({ lucaSettings: typeof val === 'function' ? val(state.lucaSettings) : val })),
  gibConnected: false,
  setGibConnected: (val) => set((state) => ({ gibConnected: typeof val === 'function' ? val(state.gibConnected) : val })),
  branchNames: [],
  setBranchNames: (val) => set((state) => ({ branchNames: typeof val === 'function' ? val(state.branchNames) : val })),
  exchangeRates: null,
  setExchangeRates: (val) => set((state) => ({ exchangeRates: typeof val === 'function' ? val(state.exchangeRates) : val })),
  notifPrefs: {},
  setNotifPrefs: (val) => set((state) => ({ notifPrefs: typeof val === 'function' ? val(state.notifPrefs) : val })),
  leads: [],
  setLeads: (leads) => set({ leads }),

  orders: [],
  setOrders: (orders) => set({ orders }),

  shipments: [],
  setShipments: (shipments) => set({ shipments }),

  inventory: [],
  setInventory: (inventory) => set({ inventory }),

  appQuotations: [],
  setAppQuotations: (appQuotations) => set({ appQuotations }),

  warehouses: [],
  setWarehouses: (warehouses) => set({ warehouses }),

  inventoryMovements: [],
  setInventoryMovements: (inventoryMovements) => set({ inventoryMovements }),

  consignments: [],
  setConsignments: (consignments) => set({ consignments }),

  stockDiscrepancies: [],
  setStockDiscrepancies: (stockDiscrepancies) => set({ stockDiscrepancies }),

  employees: [],
  setEmployees: (employees) => set({ employees }),

  payrolls: [],
  setPayrolls: (payrolls) => set({ payrolls }),

  webhookConfigs: [],
  setWebhookConfigs: (webhookConfigs) => set({ webhookConfigs }),
  p547BankAccounts: [],
  setP547BankAccounts: (p547BankAccounts) => set({ p547BankAccounts }),
  p547FixedAssets: [],
  setP547FixedAssets: (p547FixedAssets) => set({ p547FixedAssets }),
  p548Masraflar: [],
  setP548Masraflar: (p548Masraflar) => set({ p548Masraflar }),
  p552Records: [],
  setP552Records: (p552Records) => set({ p552Records }),
  p554Bins: [],
  setP554Bins: (p554Bins) => set({ p554Bins }),
  p549Iadeler: [],
  setP549Iadeler: (p549Iadeler) => set({ p549Iadeler }),
  dashVergiDeadlines: [],
  setDashVergiDeadlines: (dashVergiDeadlines) => set({ dashVergiDeadlines }),
  p567Ratings: {},
  setP567Ratings: (val) => set((state) => ({ p567Ratings: typeof val === 'function' ? val(state.p567Ratings) : val })),
  p573Rules: [],
  setP573Rules: (val) => set((state) => ({ p573Rules: typeof val === 'function' ? val(state.p573Rules) : val })),
  p579Batches: [],
  setP579Batches: (val) => set((state) => ({ p579Batches: typeof val === 'function' ? val(state.p579Batches) : val })),
  p584CountItems: [],
  setP584CountItems: (val) => set((state) => ({ p584CountItems: typeof val === 'function' ? val(state.p584CountItems) : val })),
  p612Draft: null,
  setP612Draft: (val) => set((state) => ({ p612Draft: typeof val === 'function' ? val(state.p612Draft) : val })),
  supportTickets: [],
  setSupportTickets: (supportTickets) => set({ supportTickets }),
  contracts: [],
  setContracts: (contracts) => set({ contracts }),
  recurringOrders: [],
  setRecurringOrders: (recurringOrders) => set({ recurringOrders }),
  leaveRequests: [],
  setLeaveRequests: (leaveRequests) => set({ leaveRequests }),
  priceOverrides: [],
  setPriceOverrides: (priceOverrides) => set({ priceOverrides }),
  monthlyTargets: {},
  setMonthlyTargets: (monthlyTargets) => set({ monthlyTargets }),
  monthlyTarget: 0,
  setMonthlyTarget: (monthlyTarget) => set({ monthlyTarget }),
  allBudgetsFirestore: {},
  setAllBudgetsFirestore: (allBudgetsFirestore) => set({ allBudgetsFirestore }),
  auditLogs: [],
  setAuditLogs: (auditLogs) => set({ auditLogs }),
  apPurchaseOrders: [],
  setApPurchaseOrders: (apPurchaseOrders) => set({ apPurchaseOrders }),
  p582Projects: [],
  setP582Projects: (p582Projects) => set({ p582Projects }),
  p595Tasks: [],
  setP595Tasks: (p595Tasks) => set({ p595Tasks }),
  p597Contracts: [],
  setP597Contracts: (p597Contracts) => set({ p597Contracts }),
  p605Capacity: [],
  setP605Capacity: (p605Capacity) => set({ p605Capacity }),
  p618Projects: [],
  setP618Projects: (p618Projects) => set({ p618Projects }),
  p621Demands: [],
  setP621Demands: (p621Demands) => set({ p621Demands }),
  p623LCs: [],
  setP623LCs: (p623LCs) => set({ p623LCs }),
  p624Orders: [],
  setP624Orders: (p624Orders) => set({ p624Orders }),
  p639Returns: [],
  setP639Returns: (p639Returns) => set({ p639Returns }),
  p640Subs: [],
  setP640Subs: (p640Subs) => set({ p640Subs }),
  p642Warranties: [],
  setP642Warranties: (p642Warranties) => set({ p642Warranties }),
  p643Txns: [],
  setP643Txns: (p643Txns) => set({ p643Txns }),
}));
