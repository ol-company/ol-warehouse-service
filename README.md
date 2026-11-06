# ol-warehouse-service

Service nghiệp vụ mẫu: kho, mặt hàng, điều chỉnh tồn kho có idempotency. Cô lập tenant bằng PostgreSQL Row-Level Security; phân quyền hỏi IAM (cache 30 giây, fail closed).

## Cấu trúc (Clean Architecture)

```text
src/
├── domain/            # Kiểu dữ liệu và quy tắc thuần — không phụ thuộc framework
├── application/       # Use case + ports (interface) mà use case cần
├── infrastructure/    # Hiện thực port: Drizzle/PostgreSQL, Keycloak Admin API...
├── interfaces/http/   # Route Express (SecureRouter) — chỉ chuyển dữ liệu HTTP ↔ use case
├── container.ts       # Composition root (Awilix)
├── app.ts / main.ts   # Dựng Express, khởi động server
└── migrate.ts         # Chạy migration (role *_migrator)
migrations/            # SQL migration — viết tay, review trong PR, không sửa file đã chạy
```

## Lệnh

| Lệnh | Ý nghĩa |
|---|---|
| `pnpm install` | Cài dependency (cần `$env:NODE_AUTH_TOKEN = gh auth token`) |
| `pnpm test` | Unit + integration test (integration cần Docker cho Testcontainers) |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | Kiểm tra kiểu / lint / định dạng |
| `pnpm build` | Biên dịch ra `dist/` |
| `pnpm db:new <tên>` | Tạo file migration mới |

Chạy cả hệ thống ở local: xem `ol-infra/local` và `ol-handbook/docs/02-source-code-va-local.md`.
