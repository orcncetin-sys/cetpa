import { create } from 'zustand';
import type {
  Order, Lead, InventoryItem, Shipment, Quotation,
  Warehouse, InventoryMovement, Employee, Payroll, Consignment, StockDiscrepancy
} from '../types';

interface DataState {
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
}

export const useDataStore = create<DataState>((set) => ({
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
}));
