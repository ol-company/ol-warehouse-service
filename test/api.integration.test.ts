// Test API kho: phân quyền (IAM giả), chéo tenant, tồn kho không âm, idempotency.
import { randomUUID } from 'node:crypto';
import { asValue } from 'awilix';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DependencyUnavailableError, type Authorizer, type AuthzInput, type TokenVerifier } from '@ol/node-kit';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { buildContainer } from '../src/container.js';
import { startTestDb, type TestDb } from './helpers/db.js';

const tA = randomUUID();
const tB = randomUUID();
const operator = randomUUID(); // Có quyền ở tenant A
const viewer = randomUUID(); // Chỉ xem ở tenant A

// IAM giả: operator có mọi quyền kho ở tenant A; viewer chỉ có quyền đọc; "iamDown" giả lập IAM sập
let iamDown = false;
const authorizer: Authorizer = {
  async check(i: AuthzInput) {
    if (iamDown) throw new DependencyUnavailableError('iam-authorize');
    const inA = i.resource === `tenants/${tA}` || i.resource.startsWith(`tenants/${tA}/`);
    const readOnly = /\.(list|get)$/.test(i.permission);
    const allow = inA && (i.principal === `users/${operator}` || (i.principal === `users/${viewer}` && readOnly));
    return { allow, reason: allow ? 'binding' : 'no-binding', policyVersion: 1 };
  },
};
const verifier: TokenVerifier = {
  async verify(t) {
    return { type: 'user', id: `users/${t}`, subject: t, token: t, claims: {} };
  },
};

let db: TestDb;
let app: ReturnType<typeof buildApp>['app'];
let warehouseId = '';
let itemId = '';

beforeAll(async () => {
  db = await startTestDb();
  const config = { LOG_LEVEL: 'silent', OIDC_ISSUER: 'https://id.ol.test/realms/ol', OIDC_AUDIENCE: 'ol-api', KEYCLOAK_INTERNAL_URL: 'http://kc', KEYCLOAK_REALM: 'ol', IAM_INTERNAL_URL: 'http://iam', WAREHOUSE_CLIENT_ID: 'x', WAREHOUSE_CLIENT_SECRET: 'x'.repeat(32), AUTHZ_CACHE_TTL_SECONDS: 0 } as AppConfig;
  const c = buildContainer(config, { pool: db.appPool, overrides: { authorizer: asValue(authorizer), tokenVerifier: asValue(verifier) } });
  ({ app } = buildApp(c.cradle));
});

afterAll(async () => {
  await db?.stop();
});

const as = (u: string) => `Bearer ${u}`;

describe('Warehouse API', () => {
  it('operator tạo kho và mặt hàng', async () => {
    const w = await request(app).post(`/v1/tenants/${tA}/warehouses`).set('authorization', as(operator)).send({ code: 'HCM-01', name: 'Kho HCM' }).expect(201);
    warehouseId = w.body.id;
    const i = await request(app).post(`/v1/tenants/${tA}/warehouses/${warehouseId}/items`).set('authorization', as(operator)).send({ sku: 'SKU-1', name: 'Thùng carton' }).expect(201);
    itemId = i.body.id;
    expect(i.body.quantity).toBe('0.000');
  });

  it('viewer chỉ đọc: tạo kho bị 403', async () => {
    await request(app).get(`/v1/tenants/${tA}/warehouses`).set('authorization', as(viewer)).expect(200);
    await request(app).post(`/v1/tenants/${tA}/warehouses`).set('authorization', as(viewer)).send({ code: 'X-01', name: 'X' }).expect(403);
  });

  it('chéo tenant: operator tenant A không đọc được tenant B', async () => {
    await request(app).get(`/v1/tenants/${tB}/warehouses`).set('authorization', as(operator)).expect(403);
  });

  it('kho của tenant A truy cập qua URL tenant B → 403 (IAM) chứ không lộ dữ liệu', async () => {
    await request(app).get(`/v1/tenants/${tB}/warehouses/${warehouseId}`).set('authorization', as(operator)).expect(403);
  });

  it('nhập kho, gửi lại cùng Idempotency-Key không cộng hai lần', async () => {
    const send = () =>
      request(app)
        .post(`/v1/tenants/${tA}/warehouses/${warehouseId}/items/${itemId}/adjustments`)
        .set('authorization', as(operator))
        .set('idempotency-key', 'receipt-0001')
        .send({ delta: '10.5', reason: 'Nhập hàng' });
    expect((await send().expect(201)).body.item.quantity).toBe('10.500');
    const again = await send().expect(200);
    expect(again.body.replayed).toBe(true);
    const items = await request(app).get(`/v1/tenants/${tA}/warehouses/${warehouseId}/items`).set('authorization', as(operator)).expect(200);
    expect(items.body[0].quantity).toBe('10.500');
  });

  it('xuất quá tồn kho → 409 và không ghi lịch sử', async () => {
    await request(app)
      .post(`/v1/tenants/${tA}/warehouses/${warehouseId}/items/${itemId}/adjustments`)
      .set('authorization', as(operator))
      .set('idempotency-key', 'issue-0001')
      .send({ delta: -100, reason: 'Xuất hàng' })
      .expect(409);
    const mv = await request(app).get(`/v1/tenants/${tA}/warehouses/${warehouseId}/items/${itemId}/movements`).set('authorization', as(operator)).expect(200);
    expect(mv.body).toHaveLength(1);
  });

  it('IAM sập → 503 kèm Retry-After (fail closed), không bao giờ cho qua', async () => {
    iamDown = true;
    const res = await request(app).get(`/v1/tenants/${tA}/warehouses`).set('authorization', as(operator)).expect(503);
    expect(res.headers['retry-after']).toBeDefined();
    iamDown = false;
  });
});
