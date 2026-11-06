// Ánh xạ bảng cho Drizzle — phải khớp migrations/*.sql
import { bigint, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const wh = pgSchema('warehouse');

export const warehouses = wh.table('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const items = wh.table('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  uom: text('uom').notNull().default('EA'),
  quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stockMovements = wh.table('stock_movements', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid('tenant_id').notNull(),
  itemId: uuid('item_id').notNull(),
  delta: numeric('delta', { precision: 18, scale: 3 }).notNull(),
  reason: text('reason').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  actor: text('actor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { warehouses, items, stockMovements };
