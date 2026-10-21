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
| POST | `/auth/google` | `{ code }` (web) or `{ idToken }` (phone) | `{ user, isNewUser, accessToken, refreshToken }`. Sign up **or** log in with Google. |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` |
| POST | `/auth/logout` | `{ refreshToken }` | `204` |
| POST | `/auth/logout-all` 🔒 | – | `204` (every device logged out) |
| POST | `/auth/verify-email` 🔒 | `{ code }` | `{ user, accessToken, refreshToken }`. Save the new tokens. |
| POST | `/auth/resend-verification` 🔒 | – | `{ emailSent }` |
| POST | `/auth/forgot-password` | `{ email }` | `{ message }` (same answer whether or not the email exists) |
| POST | `/auth/reset-password` | `{ email, code, newPassword }` | `{ user, accessToken, refreshToken }`. Other devices are logged out. |

`incomeType` is one of `STUDENT`, `SALARIED`, `FREELANCE`.

Every `user` object also has `hasPassword` and `hasGoogle` (booleans). `passwordHash` and `googleId` are never sent.

### Google sign-in

- **Web** sends `{ code }`: a one-time code from Google's sign-in popup (Google Identity Services code client, `ux_mode: 'popup'`). The server swaps it with Google for an ID token, using `GOOGLE_WEB_CLIENT_SECRET` and the first id in `GOOGLE_CLIENT_IDS` (the web client). This lets the app draw its own button.
- **Phone** sends `{ idToken }` straight from the Google Sign-In SDK.
- Either way, the server checks the ID token with Google: it must be signed by Google, not expired, made for one of `GOOGLE_CLIENT_IDS` (env, comma separated), and the Google email must be verified.
- Who it logs in as:
  - Google account seen before → that user.
  - Email already has a Kust account → Google gets linked to it, and the email counts as verified. If that account had **never verified its email**, its password is removed and its sessions are ended, because whoever set that password never proved they own the inbox.
  - Otherwise → a new user (email verified, no password). `isNewUser: true`.
- Google-only users can't use the password login (they get the normal `BAD_CREDENTIALS`, with a hint to use Google). They can add a password with **forgot password**.
- Errors: `GOOGLE_NOT_CONFIGURED` (503, client ids or web secret missing), `GOOGLE_CODE_INVALID` (401, Google wouldn't swap the code), `GOOGLE_TOKEN_INVALID` (401), `GOOGLE_EMAIL_NOT_VERIFIED` (401), `GOOGLE_ACCOUNT_MISMATCH` (409, that email is linked to a different Google account).

### Email verification (OTP)

- `register` emails a **6-digit code** and returns `emailSent` along with the tokens. The user is logged in but **unverified**.
- Until they verify, `/formulas`, `/budgets` and `/expenses` return `403 EMAIL_NOT_VERIFIED`. `/users/me` still works.
- App flow: after register (or a login where `user.emailVerified` is `false`), show the code screen, then call `POST /auth/verify-email` and **replace the stored tokens** with the ones it returns.
- Codes expire after **10 minutes**, allow **5 wrong tries**, and work only once. Asking for a new code kills the old one.
- `resend-verification` and `forgot-password` have a **60-second cooldown** (`429 OTP_COOLDOWN`, and `details.retryAfter` says how many seconds to wait).

### Forgot password

1. `POST /auth/forgot-password { email }`, then show the code screen
2. `POST /auth/reset-password { email, code, newPassword }`, which logs the user in. Every other session is ended, and the email counts as verified.

## Users 🔒 (no verified email needed)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/users/me` | – | `{ user }` |
| PATCH | `/users/me` | `{ name?, incomeType?, moneySource?, nextMoneyAt?, unavoidablePct?, goal?, onboarded?, remindersOn?, handwritingOn?, shareAmounts? }` | `{ user }` |
| GET | `/users/me/buckets` | – | `{ buckets: [{ colorKey, baseLabel, label, livesIn }] }` |
| PUT | `/users/me/buckets` | `{ buckets: [{ colorKey, baseLabel?, label?, livesIn? }] }` | `{ buckets }`. Also renames/re-places the matching buckets of the **current** budget. |
| POST | `/users/me/password` | `{ currentPassword, newPassword }` | `{ accessToken, refreshToken }`. Other devices are logged out. `400 NO_PASSWORD` for Google-only accounts (use forgot password). |
| DELETE | `/users/me` | `{ password? }` | `204`. Deletes the account and all its data. `password` is required if the account has one. |

### Onboarding and settings (fields on `user`)

| Field | Values | Used for |
|---|---|---|
| `onboardedAt` | date or `null` | `null` = show onboarding. Send `onboarded: true` to finish it. Accounts made before this field existed count as onboarded. |
| `moneySource` | `allowance`, `salary`, `clients`, `business`, `mixed` | "How does money usually reach you?" |
| `nextMoneyAt` | date or `null` | "When is your next money coming?" Powers "₦X a day until…" on Home. |
| `unavoidablePct` | 0–100 | "How much goes to things you can't avoid?" (%) |
| `goal` | `STOP_RUNNING_OUT`, `SAVE_FOR_SOMETHING`, `BUILD_CUSHION` | "What's your main goal?" |
| `remindersOn`, `handwritingOn`, `shareAmounts` | booleans (`true`, `true`, `false` by default) | Profile toggles |

**Bucket names and places** ("Name your buckets"): one row per `colorKey` (`needs`, `wants`, `savings`, `invest`). `label` renames a bucket, but only where the formula calls it `baseLabel` (so renaming "Wants" to "Fun" doesn't rename 70/20/10's "Debt / Giving"). `livesIn` is where that money is kept ("My main bank"). New budgets copy both into their allocations.

## Formulas 🔒 ✉️ (verified email required)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/formulas` | – | `{ formulas }` (built-in ones first, then the user's own) |
| GET | `/formulas/:id` | – | `{ formula }` |
| POST | `/formulas` | `{ name, description?, buckets: [{ label, percent, colorKey }] }` | `201 { formula }` |
| PATCH | `/formulas/:id` | `{ name?, description?, buckets? }` | `{ formula }` |
| DELETE | `/formulas/:id` | – | `204`, or `409 FORMULA_IN_USE` if budgets use it |

Buckets must add up to exactly `10000`. Users can only edit their own formulas. Built-in formulas are admin-only: an admin can create one by sending `system: true`.

Built-in formula ids: `sys-50-30-20`, `sys-50-25-15-10`, `sys-70-20-10`, `sys-80-20`.

## Budgets 🔒 ✉️

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/budgets/preview` | `{ formulaId, incomeKobo }` | `{ preview }` (the split, nothing saved) |
| POST | `/budgets` | `{ formulaId, incomeKobo, periodStart?, source? }` | `201 { budget }`. `source`: `allowance`, `salary`, `client`, `sales`, `gift`, `other`, or `balance` ("What I have"). |
| GET | `/budgets` | `?limit&cursor` | `{ budgets, nextCursor }`. Each budget has `totals`. |
| GET | `/budgets/current` | – | `{ budget }` (most recent budget, or `null`) |
| GET | `/budgets/:id` | – | `{ budget }` |
| DELETE | `/budgets/:id` | – | `204` (its expenses are deleted too) |
| PATCH | `/budgets/:id/allocations/:allocationId` | `{ moved: true \| false }` | `{ budget }`. The "Move the money" checklist tick (`movedAt`). |

Send an `Idempotency-Key: <random uuid>` header on `POST /budgets`. If the phone retries after a network drop, it gets the same budget back (`200`) instead of a duplicate.

A full budget looks like this:

```json
{
  "id": "…", "formulaId": "sys-50-30-20", "incomeKobo": 15000000, "periodStart": "…",
  "formula": { "id": "sys-50-30-20", "name": "50/30/20" },
  "allocations": [
    { "id": "…", "label": "Needs", "colorKey": "needs", "percent": 5000,
      "amountKobo": 7500000, "spentKobo": 2500000, "remainingKobo": 5000000,
      "usedPercent": 33.33, "overspent": false, "position": 0,
      "livesIn": "My main bank", "movedAt": null }
  ],
  "totals": { "incomeKobo": 15000000, "spentKobo": 2500000, "remainingKobo": 12500000 }
}
```

## Expenses 🔒 ✉️

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/budgets/:id/expenses` | `{ allocationId, amountKobo, note?, category?, spentAt? }` | `201 { expense }`. `category`: `food`, `transport`, `data`, `eating_out`, `other`. |
| GET | `/budgets/:id/expenses` | `?allocationId&limit&cursor` | `{ expenses, nextCursor }` (newest first) |
| PATCH | `/expenses/:id` | `{ allocationId?, amountKobo?, note?, category?, spentAt? }` | `{ expense }` |
| DELETE | `/expenses/:id` | – | `204` |

`allocationId` is the bucket the money came out of (Needs, Wants…), taken from `budget.allocations[].id`. Overspending is allowed: that bucket then shows `overspent: true` and a negative `remainingKobo`.

## Reviews 🔒 ✉️

| Method | Path | Returns |
|---|---|---|
| GET | `/reviews?tz=60` | `{ months: ["2026-10", "2026-09"] }`: months that have budgets, newest first |
| GET | `/reviews/:month?tz=60` | `{ review }` for `YYYY-MM` (or `null` if that month has no budgets) |

`tz` is minutes ahead of UTC (Nigeria = 60). A review looks like:

```json
{ "month": "2026-09", "partial": false, "budgets": 1, "incomeKobo": 10000000, "spentKobo": 8600000,
  "drift": 12, "grade": "B", "weeks": { "kept": 4, "total": 5 },
  "buckets": [ { "label": "Needs", "colorKey": "needs", "keep": false, "amountKobo": 5000000, "spentKobo": 5200000, "planPercent": 50, "actualPercent": 52 } ],
  "idea": { "kind": "cap", "label": "Wants", "overByKobo": 400000, "category": "eating_out", "capKobo": 200000 } }
```

- Spending buckets: actual = spent ÷ income. Keep buckets (`savings`, `invest`): actual = the savings plan minus anything spent from it, minus overspending in the other buckets (shared by plan). So overspending anywhere shows up as saving less, and mid-month savings don't look inflated.
- `drift` = percentage points over plan on spending plus short on saving. Grades: ≤2 A, ≤5 A-, ≤8 B+, ≤12 B, ≤16 B-, ≤22 C+, ≤30 C, else D.
- `weeks`: weeks of the month (so far) where spending stayed under the plan's pace.
- `idea.kind`: `cap` (biggest overspent bucket, its top category, a suggested cap of about half the overspend in ₦500 steps), `save-first` (savings came up short), or `steady`.
- `partial: true` = the month isn't over, so numbers are "so far".

## Limits

- All of `/api/v1`: 300 requests per 15 minutes per IP.
- Login, register, Google, verify and reset: 10 failed attempts per 15 minutes per IP in production (100 in development).
- Sending codes (resend-verification, forgot-password): 5 per 15 minutes per IP in production.
- Over a limit, the API returns `429 RATE_LIMITED`.

## Admin

Make a user an admin with `npm run make-admin -- email@example.com`. They then need to log in again.

## Common error codes

`VALIDATION_ERROR`, `BAD_JSON`, `UNAUTHORIZED`, `TOKEN_INVALID`, `BAD_CREDENTIALS`, `NO_PASSWORD`, `GOOGLE_NOT_CONFIGURED`, `GOOGLE_CODE_INVALID`, `GOOGLE_TOKEN_INVALID`, `GOOGLE_EMAIL_NOT_VERIFIED`, `GOOGLE_ACCOUNT_MISMATCH`, `EMAIL_TAKEN`, `REFRESH_INVALID`, `REFRESH_REUSED`, `REFRESH_EXPIRED`, `FORBIDDEN`, `FORMULA_NOT_FOUND`, `BUDGET_NOT_FOUND`, `EXPENSE_NOT_FOUND`, `BAD_SPLIT`, `BAD_ALLOCATION`, `FORMULA_IN_USE`, `EMAIL_NOT_VERIFIED`, `ALREADY_VERIFIED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_TOO_MANY_ATTEMPTS`, `OTP_COOLDOWN`, `RATE_LIMITED`, `ROUTE_NOT_FOUND`, `INTERNAL_ERROR`