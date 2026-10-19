# Kust API (v1)

Base URL (local): `http://localhost:3000/api/v1`

## Conventions

- **Money is in kobo, as whole numbers.** ₦1,500.50 = `150050`. Divide by 100 to display.
- **Percentages are basis points.** `5000` = 50%, `1250` = 12.5%.
- **Auth:** send `Authorization: Bearer <accessToken>` on every route marked 🔒.
- **Access tokens last 15 minutes.** When a request returns `401 TOKEN_INVALID`, call `POST /auth/refresh` with the stored refresh token, save the new pair, and retry the request once.
- **Refresh tokens last 30 days and rotate.** Every refresh returns a new refresh token and the old one stops working. Always save the new one.
- **Errors always look like this:**
  ```json
  { "error": { "code": "EMAIL_TAKEN", "message": "An account with that email already exists", "details": [] } }
  ```
  The app should check `code` and show `message`. `details` only appears on `VALIDATION_ERROR` (one entry per bad field).
- **Lists use cursor pagination:** `?limit=20&cursor=<nextCursor from the last page>`. `nextCursor: null` means there are no more pages.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password (8+), name?, incomeType? }` | `201 { user, accessToken, refreshToken }` |
| POST | `/auth/login` | `{ email, password }` | `{ user, accessToken, refreshToken }` |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` |
| POST | `/auth/logout` | `{ refreshToken }` | `204` |
| POST | `/auth/logout-all` 🔒 | – | `204` (every device logged out) |

`incomeType` is one of `STUDENT`, `SALARIED`, `FREELANCE`.

## Users 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/users/me` | – | `{ user }` |
| PATCH | `/users/me` | `{ name?, incomeType? }` | `{ user }` |
| POST | `/users/me/password` | `{ currentPassword, newPassword }` | `{ accessToken, refreshToken }`. Other devices are logged out. |
| DELETE | `/users/me` | `{ password }` | `204`. Deletes the account and all its data. |

## Formulas 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/formulas` | – | `{ formulas }` (built-in ones first, then the user's own) |
| GET | `/formulas/:id` | – | `{ formula }` |
| POST | `/formulas` | `{ name, description?, buckets: [{ label, percent, colorKey }] }` | `201 { formula }` |
| PATCH | `/formulas/:id` | `{ name?, description?, buckets? }` | `{ formula }` |
| DELETE | `/formulas/:id` | – | `204`, or `409 FORMULA_IN_USE` if budgets use it |

Buckets must add up to exactly `10000`. Users can only edit their own formulas. Built-in formulas are admin-only: an admin can create one by sending `system: true`.

Built-in formula ids: `sys-50-30-20`, `sys-50-25-15-10`, `sys-70-20-10`, `sys-80-20`.

## Budgets 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/budgets/preview` | `{ formulaId, incomeKobo }` | `{ preview }` (the split, nothing saved) |
| POST | `/budgets` | `{ formulaId, incomeKobo, periodStart? }` | `201 { budget }` |
| GET | `/budgets` | `?limit&cursor` | `{ budgets, nextCursor }`. Each budget has `totals`. |
| GET | `/budgets/current` | – | `{ budget }` (most recent budget, or `null`) |
| GET | `/budgets/:id` | – | `{ budget }` |
| DELETE | `/budgets/:id` | – | `204` (its expenses are deleted too) |

Send an `Idempotency-Key: <random uuid>` header on `POST /budgets`. If the phone retries after a network drop, it gets the same budget back (`200`) instead of a duplicate.

A full budget looks like this:

```json
{
  "id": "…", "formulaId": "sys-50-30-20", "incomeKobo": 15000000, "periodStart": "…",
  "formula": { "id": "sys-50-30-20", "name": "50/30/20" },
  "allocations": [
    { "id": "…", "label": "Needs", "colorKey": "needs", "percent": 5000,
      "amountKobo": 7500000, "spentKobo": 2500000, "remainingKobo": 5000000,
      "usedPercent": 33.33, "overspent": false, "position": 0 }
  ],
  "totals": { "incomeKobo": 15000000, "spentKobo": 2500000, "remainingKobo": 12500000 }
}
```

## Expenses 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/budgets/:id/expenses` | `{ allocationId, amountKobo, note?, spentAt? }` | `201 { expense }` |
| GET | `/budgets/:id/expenses` | `?allocationId&limit&cursor` | `{ expenses, nextCursor }` (newest first) |
| PATCH | `/expenses/:id` | `{ allocationId?, amountKobo?, note?, spentAt? }` | `{ expense }` |
| DELETE | `/expenses/:id` | – | `204` |

`allocationId` is the bucket the money came out of (Needs, Wants…), taken from `budget.allocations[].id`. Overspending is allowed: that bucket then shows `overspent: true` and a negative `remainingKobo`.

## Limits

- All of `/api/v1`: 300 requests per 15 minutes per IP.
- Login and register: 10 failed attempts per 15 minutes per IP in production (100 in development). Over the limit, the API returns `429 RATE_LIMITED`.

## Admin

Make a user an admin with `npm run make-admin -- email@example.com`. They then need to log in again.

## Common error codes

`VALIDATION_ERROR`, `BAD_JSON`, `UNAUTHORIZED`, `TOKEN_INVALID`, `BAD_CREDENTIALS`, `EMAIL_TAKEN`, `REFRESH_INVALID`, `REFRESH_REUSED`, `REFRESH_EXPIRED`, `FORBIDDEN`, `FORMULA_NOT_FOUND`, `BUDGET_NOT_FOUND`, `EXPENSE_NOT_FOUND`, `BAD_SPLIT`, `BAD_ALLOCATION`, `FORMULA_IN_USE`, `RATE_LIMITED`, `ROUTE_NOT_FOUND`, `INTERNAL_ERROR`
