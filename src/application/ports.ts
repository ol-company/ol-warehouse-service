// Cổng dữ liệu của service kho. Mọi thao tác chạy trong "phạm vi tenant" — hiện thực bên dưới
// đặt app.tenant_id cho PostgreSQL RLS, nên kể cả khi code quên điều kiện tenant, DB vẫn chặn.
import type { Item, StockMovement, Warehouse } from '../domain/types.js';

export interface WarehouseRepository {
  list(): Promise<Warehouse[]>;
  get(id: string): Promise<Warehouse | null>;
  create(input: { code: string; name: string; address: string | null }): Promise<Warehouse>;
}

export interface ItemRepository {
  list(warehouseId: string): Promise<Item[]>;
  get(warehouseId: string, itemId: string): Promise<Item | null>;
  create(input: { warehouseId: string; sku: string; name: string; uom: string }): Promise<Item>;
  // Cộng/trừ tồn kho nguyên tử; trả null nếu kết quả sẽ âm hoặc mặt hàng không thuộc kho
  applyDelta(warehouseId: string, itemId: string, delta: string): Promise<Item | null>;
}

export interface MovementRepository {
  // Trả null nếu idempotencyKey đã dùng (yêu cầu lặp lại)
  insert(input: {
    itemId: string;
    delta: string;
    reason: string;
    idempotencyKey: string;
    actor: string;
  }): Promise<StockMovement | null>;
  findByKey(idempotencyKey: string): Promise<StockMovement | null>;
  list(itemId: string, limit: number): Promise<StockMovement[]>;
}

export interface TenantRepositories {
  warehouses: WarehouseRepository;
  items: ItemRepository;
  movements: MovementRepository;
}

export interface TenantUnitOfWork {
  // Chạy fn trong một transaction đã gắn tenantId
  run<T>(tenantId: string, fn: (repos: TenantRepositories) => Promise<T>): Promise<T>;
}
