// API của Warehouse service. Phạm vi phân quyền:
//   tenants/<t>                       → liệt kê/tạo kho
//   tenants/<t>/warehouses/<w>        → mọi thao tác bên trong một kho (gán quyền theo từng kho được)
import { handle, policy, SecureRouter, ValidationError } from '@ol/node-kit';
import { z } from 'zod';
import type { Cradle } from '../../container.js';

const tenantScope = (p: Record<string, string>) => `tenants/${p.tenantId}`;
const warehouseScope = (p: Record<string, string>) =>
  `tenants/${p.tenantId}/warehouses/${p.warehouseId}`;

const T = z.object({ tenantId: z.uuid() });
const TW = T.extend({ warehouseId: z.uuid() });
const TWI = TW.extend({ itemId: z.uuid() });
// Số thập phân tối đa 3 chữ số sau dấu phẩy, dạng chuỗi để không mất chính xác
const Decimal = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^-?\d{1,15}(\.\d{1,3})?$/));

export function buildRoutes(c: Cradle): SecureRouter {
  const r = new SecureRouter({
    verifier: c.tokenVerifier,
    authorizer: c.authorizer,
    logger: c.logger,
  });
  const svc = c.warehouseService;

  r.get(
    '/v1/tenants/:tenantId/warehouses',
    policy.permission('warehouse.warehouses.list', tenantScope),
    handle({ params: T }, ({ params }) => svc.listWarehouses(params.tenantId)),
  );

  r.post(
    '/v1/tenants/:tenantId/warehouses',
    policy.permission('warehouse.warehouses.create', tenantScope),
    handle(
      {
        params: T,
        body: z.object({
          code: z.string().regex(/^[A-Z0-9-]{2,20}$/),
          name: z.string().min(1).max(200),
          address: z.string().max(500).nullish(),
        }),
      },
      ({ params, body }) => svc.createWarehouse(params.tenantId, body),
      { status: 201 },
    ),
  );

  r.get(
    '/v1/tenants/:tenantId/warehouses/:warehouseId',
    policy.permission('warehouse.warehouses.get', warehouseScope),
    handle({ params: TW }, ({ params }) => svc.getWarehouse(params.tenantId, params.warehouseId)),
  );

  r.get(
    '/v1/tenants/:tenantId/warehouses/:warehouseId/items',
    policy.permission('warehouse.items.list', warehouseScope),
    handle({ params: TW }, ({ params }) => svc.listItems(params.tenantId, params.warehouseId)),
  );

  r.post(
    '/v1/tenants/:tenantId/warehouses/:warehouseId/items',
    policy.permission('warehouse.items.create', warehouseScope),
    handle(
      {
        params: TW,
        body: z.object({
          sku: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
          name: z.string().min(1).max(200),
          uom: z
            .string()
            .regex(/^[A-Z]{1,10}$/)
            .optional(),
        }),
      },
      ({ params, body }) => svc.createItem(params.tenantId, params.warehouseId, body),
      { status: 201 },
    ),
  );

  r.get(
    '/v1/tenants/:tenantId/warehouses/:warehouseId/items/:itemId/movements',
    policy.permission('warehouse.items.get', warehouseScope),
    handle(
      {
        params: TWI,
        query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
      },
      ({ params, query }) =>
        svc.listMovements(params.tenantId, params.warehouseId, params.itemId, query.limit),
    ),
  );

  r.post(
    '/v1/tenants/:tenantId/warehouses/:warehouseId/items/:itemId/adjustments',
    policy.permission('warehouse.stock.adjust', warehouseScope),
    handle(
      { params: TWI, body: z.object({ delta: Decimal, reason: z.string().min(1).max(200) }) },
      async ({ params, body, principal, req, res }) => {
        const key = req.header('idempotency-key');
        if (!key || !/^[A-Za-z0-9-]{8,64}$/.test(key))
          throw new ValidationError('Thiếu header Idempotency-Key hợp lệ (8–64 ký tự)');
        if (Number(body.delta) === 0) throw new ValidationError('delta phải khác 0');
        const result = await svc.adjustStock(params.tenantId, params.warehouseId, params.itemId, {
          delta: body.delta,
          reason: body.reason,
          idempotencyKey: key,
          actor: principal.id,
        });
        res.status(result.replayed ? 200 : 201).json(result);
        return undefined;
      },
    ),
  );

  return r;
}
