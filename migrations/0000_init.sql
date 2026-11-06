-- =============================================================================
-- 0000_init — Kho, mặt hàng, lịch sử nhập/xuất. Cô lập tenant bằng Row-Level Security (RLS).
-- Chạy bởi warehouse_migrator; ứng dụng dùng warehouse_app (không phải chủ bảng → bị RLS ràng buộc).
-- =============================================================================

CREATE TABLE warehouse.warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id) -- Cho khóa ngoại kép từ items → mặt hàng không thể thuộc kho của tenant khác
);

CREATE TABLE warehouse.items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  warehouse_id  uuid NOT NULL,
  sku           text NOT NULL CHECK (sku ~ '^[A-Za-z0-9._-]{1,64}$'),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  uom           text NOT NULL DEFAULT 'EA' CHECK (uom ~ '^[A-Z]{1,10}$'), -- Đơn vị tính
  quantity      numeric(18, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0), -- Tồn kho không âm
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, warehouse_id, sku),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouse.warehouses (tenant_id, id) ON DELETE RESTRICT
);

-- Lịch sử điều chỉnh tồn kho: chỉ thêm. idempotency_key chống ghi trùng khi client/thiết bị gửi lại
CREATE TABLE warehouse.stock_movements (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  item_id          uuid NOT NULL,
  delta            numeric(18, 3) NOT NULL CHECK (delta <> 0),
  reason           text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  idempotency_key  text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9-]{8,64}$'),
  actor            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, item_id) REFERENCES warehouse.items (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_movements_item_idx ON warehouse.stock_movements (tenant_id, item_id, id DESC);

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY: mỗi truy vấn chỉ thấy dòng của tenant đặt trong app.tenant_id.
-- Chưa đặt tenant → current_setting trả NULL → không thấy dòng nào (an toàn mặc định).
-- FORCE: áp dụng cả với chủ bảng, phòng khi lỡ chạy ứng dụng bằng role migrator.
-- ---------------------------------------------------------------------------
ALTER TABLE warehouse.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.items FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.stock_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON warehouse.warehouses
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON warehouse.items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON warehouse.stock_movements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Lịch sử tồn kho chỉ được thêm
REVOKE UPDATE, DELETE, TRUNCATE ON warehouse.stock_movements FROM warehouse_app;
