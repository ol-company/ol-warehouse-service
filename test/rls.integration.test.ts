// Kiểm chứng lớp phòng thủ thứ hai: kể cả khi truy vấn KHÔNG có điều kiện tenant,
// PostgreSQL Row-Level Security vẫn không trả dữ liệu của tenant khác.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@ol/node-kit';
import { startTestDb, type TestDb } from './helpers/db.js';

let db: TestDb;
const tA = randomUUID();
const tB = randomUUID();

beforeAll(async () => {
  db = await startTestDb();
  await withTenant(db.appPool, tA, (c) => c.query("INSERT INTO warehouse.warehouses (tenant_id, code, name) VALUES ($1, 'HCM-01', 'Kho A')", [tA]));
  await withTenant(db.appPool, tB, (c) => c.query("INSERT INTO warehouse.warehouses (tenant_id, code, name) VALUES ($1, 'HN-01', 'Kho B')", [tB]));
});

afterAll(async () => {
  await db?.stop();
});

describe('Row-Level Security', () => {
  it('SELECT * không điều kiện chỉ thấy dữ liệu của tenant hiện tại', async () => {
    const rows = await withTenant(db.appPool, tA, async (c) => (await c.query('SELECT code FROM warehouse.warehouses')) as { rows: Array<{ code: string }> });
    expect(rows.rows.map((r) => r.code)).toEqual(['HCM-01']);
  });

  it('không đặt tenant → không thấy dòng nào', async () => {
    const res = await db.appPool.query('SELECT count(*)::int AS n FROM warehouse.warehouses');
    expect(res.rows[0].n).toBe(0);
  });

  it('không ghi được dữ liệu mang tenant_id khác (WITH CHECK)', async () => {
    await expect(
      withTenant(db.appPool, tA, (c) => c.query("INSERT INTO warehouse.warehouses (tenant_id, code, name) VALUES ($1, 'X-01', 'Lậu')", [tB])),
    ).rejects.toThrow(/row-level security/);
  });

  it('role ứng dụng không sửa/xóa được lịch sử tồn kho', async () => {
    await expect(withTenant(db.appPool, tA, (c) => c.query('DELETE FROM warehouse.stock_movements'))).rejects.toThrow(/permission denied/);
  });
});
