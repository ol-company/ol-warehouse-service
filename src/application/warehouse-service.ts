// Use case kho. Phân quyền đã được SecureRouter kiểm ở route; ở đây chỉ còn quy tắc nghiệp vụ.
import { ConflictError, NotFoundError } from '@ol/node-kit';
import type { TenantUnitOfWork } from './ports.js';

export class WarehouseService {
  private readonly uow: TenantUnitOfWork;
  constructor(deps: { uow: TenantUnitOfWork }) {
    this.uow = deps.uow;
  }

  listWarehouses(tenantId: string) {
    return this.uow.run(tenantId, (r) => r.warehouses.list());
  }

  getWarehouse(tenantId: string, warehouseId: string) {
    return this.uow.run(tenantId, async (r) => {
      const w = await r.warehouses.get(warehouseId);
      if (!w) throw new NotFoundError('Không tìm thấy kho'); // Kho của tenant khác cũng là "không tìm thấy"
      return w;
    });
  }

  createWarehouse(tenantId: string, input: { code: string; name: string; address?: string | null }) {
    return this.uow.run(tenantId, (r) => r.warehouses.create({ code: input.code, name: input.name, address: input.address ?? null }));
  }

  listItems(tenantId: string, warehouseId: string) {
    return this.uow.run(tenantId, async (r) => {
      if (!(await r.warehouses.get(warehouseId))) throw new NotFoundError('Không tìm thấy kho');
      return r.items.list(warehouseId);
    });
  }

  createItem(tenantId: string, warehouseId: string, input: { sku: string; name: string; uom?: string }) {
    return this.uow.run(tenantId, async (r) => {
      if (!(await r.warehouses.get(warehouseId))) throw new NotFoundError('Không tìm thấy kho');
      return r.items.create({ warehouseId, sku: input.sku, name: input.name, uom: input.uom ?? 'EA' });
    });
  }

  listMovements(tenantId: string, warehouseId: string, itemId: string, limit: number) {
    return this.uow.run(tenantId, async (r) => {
      if (!(await r.items.get(warehouseId, itemId))) throw new NotFoundError('Không tìm thấy mặt hàng');
      return r.movements.list(itemId, limit);
    });
  }

  // Điều chỉnh tồn kho, an toàn khi gửi lại (idempotent):
  //  - Lần đầu: ghi movement + cập nhật tồn kho trong CÙNG transaction
  //  - Gửi lại cùng Idempotency-Key: không đổi gì, trả lại kết quả cũ
  adjustStock(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    input: { delta: string; reason: string; idempotencyKey: string; actor: string },
  ) {
    return this.uow.run(tenantId, async (r) => {
      const item = await r.items.get(warehouseId, itemId);
      if (!item) throw new NotFoundError('Không tìm thấy mặt hàng');
      const movement = await r.movements.insert({ itemId, delta: input.delta, reason: input.reason, idempotencyKey: input.idempotencyKey, actor: input.actor });
      if (!movement) {
        const previous = await r.movements.findByKey(input.idempotencyKey);
        if (previous?.itemId !== itemId) throw new ConflictError('Idempotency-Key đã dùng cho thao tác khác');
        return { item, movement: previous, replayed: true };
      }
      const updated = await r.items.applyDelta(warehouseId, itemId, input.delta);
      // Ném lỗi → transaction rollback → movement vừa ghi cũng bị hủy
      if (!updated) throw new ConflictError('Tồn kho không đủ để xuất');
      return { item: updated, movement, replayed: false };
    });
  }
}
