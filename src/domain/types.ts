// Thực thể miền kho. Số lượng dùng chuỗi thập phân (string) để không mất độ chính xác như number.
export interface Warehouse {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  address: string | null;
  createdAt: Date;
}

export interface Item {
  id: string;
  tenantId: string;
  warehouseId: string;
  sku: string;
  name: string;
  uom: string;
  quantity: string; // Ví dụ "125.500"
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovement {
  id: number;
  itemId: string;
  delta: string;
  reason: string;
  idempotencyKey: string;
  actor: string;
  createdAt: Date;
}
