# PayNova API contract (PROPOSED)

> **Status: PROPOSED. Nothing in this document is implemented or working yet.**
>
> - Every endpoint, field name, example and status value below is a plan.
> - No endpoint may be treated as live until it is built (Phase 3), tested (Phase 6) and checked against Razorpay's official documentation at https://razorpay.com/docs.
> - Razorpay request and webhook details must be confirmed against the official docs before implementation. Where this file describes Razorpay behaviour, it is a summary to be verified, not a source of truth.
> - All examples use fake values. Real keys, secrets and customer data must never appear in this file or in the repository.

---

## 1. Purpose

This document describes the planned contract between:

1. **The PayNova frontend** (plain HTML, CSS and JavaScript in `public/`), which runs in the customer's or merchant's browser.
2. **The PayNova backend** (Node.js server, Phase 3), which holds all secrets and talks to the payment provider.
3. **The payment provider** (Razorpay, test mode first), which runs the hosted checkout and sends signed webhooks.

The frontend never talks to Razorpay's secret-key APIs. It only receives a public key ID and a provider order ID from the backend.

---

## 2. Core rules (apply to every endpoint)

| Rule | Detail |
|---|---|
| Money units | All amounts are integers in **paise** (₹1 = 100 paise). ₹1,499.00 = `149900`. Never send decimals. |
| Currency | `INR` only at this stage. |
| JSON | Requests and responses use `application/json`. |
| Errors | `{ "error": "short, safe message" }` with the correct HTTP status. Stack traces are never returned. |
| Secrets | Never returned, logged or sent to the browser: key secret, webhook secret, session secrets. |
| Personal data | Responses never include card numbers, CVVs, UPI PINs, bank passwords or full customer contact details. |
| Demo mode | Pages with `?demo=1` never call these endpoints. Demo results are simulated in the browser and are never proof of payment. |
| Trust boundary | Only the server can mark an order `PAID`. Browser messages, URL parameters and redirects are never proof of payment. |

---

## 3. Order status values

| Status | Meaning | Who may set it | Is it final? |
|---|---|---|---|
| `CREATED` | Order exists, no payment attempted or completed yet. | Server, on order creation. | No |
| `PENDING` | A payment attempt has started but its outcome is not yet known. | Server, from a verified provider state. | No |
| `PAID` | The server has verified the payment with the signature and by fetching it from the provider. | **Server only**, after verification. | Yes |
| `FAILED` | The provider reports the payment attempt failed. | Server, from a verified provider state. | No (a new attempt may be made) |
| `CANCELLED` | The customer closed the payment window without paying. | Server, from a verified provider state or the checkout dismissal event. | No |

### State transitions (proposed)

```
            create order
                 │
                 ▼
            ┌─────────┐   payment attempt started   ┌─────────┐
            │ CREATED │ ──────────────────────────▶ │ PENDING │
            └─────────┘                             └─────────┘
                 │                                    │     │
      window closed│                       verified   │     │ verified
       by customer │                       success    ▼     ▼ failure
                 ▼                                 ┌──────┐ ┌────────┐
            ┌───────────┐                          │ PAID │ │ FAILED │
            │ CANCELLED │                          └──────┘ └────────┘
            └───────────┘

  Rules:
  - PAID is final. No later event may move an order out of PAID.
  - A FAILED or CANCELLED order may be retried by a new payment attempt.
  - Any transition not shown above is rejected and logged.
```

---

## 4. Endpoints

All paths are prefixed with `/api`. Each endpoint below is labelled **Proposed**.

### 4.1 Create an order (merchant server to PayNova)

**Status: Proposed (not implemented).**

- **Method and path:** `POST /api/merchant/orders`
- **Who calls it:** the merchant's own server, using a secret API key stored only on that server. The browser never calls this endpoint.
- **Authentication (proposed):** `Authorization: Bearer <merchant_api_key>`. The server stores only a hash of each key.

**Request (example, fake values):**

```json
{
  "amount_paise": 149900,
  "currency": "INR",
  "description": "Premium plan (monthly)",
  "merchant_reference": "invoice-2026-0042",
  "return_url": "https://merchant.example/thanks"
}
```

**Response, 201 Created (example, fake values):**

```json
{
  "id": "ORD-1042",
  "amount_paise": 149900,
  "currency": "INR",
  "description": "Premium plan (monthly)",
  "status": "CREATED",
  "checkout_url": "https://paynova.example/checkout.html?order=ORD-1042",
  "created_at": "2026-10-25T08:42:00+05:30"
}
```

**Rules (proposed):**
- `amount_paise` must be a positive integer within a configured maximum.
- `return_url` must be `https://`, have no credentials, and match a domain the merchant has registered. Otherwise it is rejected.
- The server creates the provider order (Razorpay Orders API) **after** saving the local order, and stores the provider order ID. The provider order ID is not returned to the merchant's server in this response.

**Errors:**
- `400` invalid body or amount
- `401` missing or invalid API key
- `403` return URL not allowed for this merchant
- `429` too many requests

---

### 4.2 Get public order details (checkout and status pages)

**Status: Proposed (not implemented).**

- **Method and path:** `GET /api/public/orders/:id`
- **Who calls it:** `checkout.html` and `status.html`, in live mode only.
- **Authentication:** none. The order ID is not secret, so this endpoint returns only what a customer needs and nothing private.

**Response, 200 OK (example, fake values):**

```json
{
  "id": "ORD-1042",
  "amount_paise": 149900,
  "currency": "INR",
  "description": "Premium plan (monthly)",
  "merchant_name": "Demo Store",
  "status": "CREATED",
  "provider_order_id": "order_EXAMPLE0001",
  "key_id": "rzp_test_EXAMPLE_PUBLIC_KEY_ID",
  "return_url": "https://merchant.example/thanks"
}
```

**Rules (proposed):**
- `key_id` is the **public** key ID only. The key secret is never included.
- `provider_order_id` is needed only to open the checkout. It is not a payment proof.
- `return_url` is shown only after the order is `PAID`, as stated in `status.js`.
- `status` is returned as stored. The browser must never treat any status as a verified payment unless the server says `PAID`.

**Errors:**
- `404` order not found
- `429` too many requests
- `500` server error (generic message only)

---

### 4.3 Verify a checkout result (browser to server)

**Status: Proposed (not implemented).**

- **Method and path:** `POST /api/public/payments/verify`
- **Who calls it:** the checkout page, after the provider's checkout reports success to the browser.
- **Purpose:** to ask the server to verify the payment. The browser's report is only a **hint**. The server decides.

**Request (example, fake values):**

```json
{
  "order_id": "ORD-1042",
  "razorpay_order_id": "order_EXAMPLE0001",
  "razorpay_payment_id": "pay_EXAMPLE0001",
  "razorpay_signature": "EXAMPLE_SIGNATURE_HEX_STRING"
}
```

**Server verification steps (proposed, to be confirmed against Razorpay's official docs):**

1. Check that `order_id` exists and that `razorpay_order_id` matches the provider order ID stored for it. If not, reject.
2. Compute the expected signature: **HMAC-SHA256** over `razorpay_order_id + "|" + razorpay_payment_id`, using the **key secret** held only on the server. Compare it with `razorpay_signature` using a **constant-time comparison**. If it does not match, reject and log.
3. Fetch the payment from the provider's API using the server-side secret. Check that:
   - the provider's order ID matches the stored one,
   - the amount equals `amount_paise` on the order,
   - the currency is `INR`,
   - the provider reports the payment as captured or successful.
4. Only if all checks pass, set the order to `PAID` in the database, in one transaction, and store the payment ID.
5. Reply with the status. The status page then reads the order again from §4.2.

**Response, 200 OK (example):**

```json
{
  "status": "PAID"
}
```

Possible `status` values in this reply: `PAID`, `PENDING`, `FAILED`.

**Errors:**
- `400` missing or malformed fields
- `404` order not found
- `409` order already in a final state (idempotent: returns the stored status)
- `422` signature or provider check failed. The order is not marked paid and the failure is logged.
- `429` too many requests

**Important:** if this endpoint fails or is never called, the order stays `PENDING` or `CREATED` until the webhook (§4.4) confirms it. Missing the browser step must never mark a payment as paid.

---

### 4.4 Payment webhook (provider to server)

**Status: Proposed (not implemented).**

- **Method and path:** `POST /api/webhooks/razorpay`
- **Who calls it:** Razorpay's servers, not the browser.
- **Purpose:** the **source of truth** for payment outcomes, including payments that finish after the customer closes the browser.

**Signature validation (proposed, to be confirmed against Razorpay's official webhook docs):**

1. Read the **raw request body exactly as received**, before any JSON parsing or middleware changes it. Parsing first breaks the signature.
2. Read the signature from the request header that Razorpay documents for webhooks (proposed name: `X-Razorpay-Signature`).
3. Compute **HMAC-SHA256** of the raw body using the **webhook secret** (a separate secret from the key secret, set in the Razorpay dashboard and stored only on the server).
4. Compare with the header using a **constant-time comparison**. If it does not match, return `400` and do not process the event.
5. Only after the signature passes, parse the JSON and process the event.

**Event processing (proposed):**
- Store each event ID. If an event ID was already processed, return `200` and do nothing (**idempotent**). Razorpay may send the same event more than once.
- Apply the status transitions from §3 only. Ignore events that would break a final state (for example, a late failure event for a `PAID` order).
- Always check the amount and provider order ID against the stored order before changing status.

**Example body (fake values, shape to be confirmed against official docs):**

```json
{
  "entity": "event",
  "event": "payment.captured",
  "id": "evt_EXAMPLE0001",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_EXAMPLE0001",
        "order_id": "order_EXAMPLE0001",
        "amount": 149900,
        "currency": "INR",
        "status": "captured"
      }
    }
  }
}
```

**Responses (proposed):**
- `200` event accepted or already processed
- `400` signature missing or invalid. Nothing is processed.
- `500` temporary processing error. The provider should retry. Do not return `200` for failures.

**Event-to-status mapping (proposed, to be confirmed against Razorpay's documented events):**

| Provider event (to verify) | PayNova status |
|---|---|
| `payment.captured` | `PAID` (after the checks in §4.3 step 3 also pass) |
| `payment.failed` | `FAILED` |
| Payment created, authorised or still processing | `PENDING` |
| Checkout closed by the customer | `CANCELLED` (only if the provider reports no payment was made) |

---

### 4.5 Merchant login, session and dashboard data (dashboard)

**Status: Proposed (not implemented). The current dashboard uses mock data and does not call these endpoints.**

| Method | Path | Purpose | Success response |
|---|---|---|---|
| `POST` | `/api/merchant/login` | Email and password sign-in | `200 { "ok": true }` (sets an `HttpOnly`, `Secure`, `SameSite=Strict` session cookie) |
| `POST` | `/api/merchant/logout` | Ends the session | `200 { "ok": true }` |
| `GET` | `/api/merchant/session` | Checks the session | `200 { "business_name": "Demo Store" }` or `401` |
| `GET` | `/api/merchant/orders` | Summary and order list | See example below |

**Rules (proposed):**
- Passwords are stored only as salted hashes (for example bcrypt or argon2). Never in plain text, in logs or in the frontend.
- Login attempts are rate-limited. Failed logins return the same message whether the email exists or not.
- The session cookie is never readable by JavaScript.
- Merchant data is limited to that merchant's own orders.

**Example `GET /api/merchant/orders` response (fake values):**

```json
{
  "stats": {
    "total_collected_paise": 149900,
    "paid_count": 1,
    "pending_count": 0,
    "failed_count": 0
  },
  "orders": [
    {
      "id": "ORD-1042",
      "description": "Premium plan (monthly)",
      "amount_paise": 149900,
      "status": "PAID",
      "created_at": "2026-10-25T08:42:00+05:30"
    }
  ]
}
```

---

## 5. Payment outcomes shown to customers

| Status | Page shown | Wording rule |
|---|---|---|
| `PAID` | Success | Shown only after the server returns `PAID`. |
| `PENDING` | Pending, polling | "Your bank is still processing this payment." Never shown as success. |
| `FAILED` | Failed, retry button | "The payment did not go through." |
| `CANCELLED` | Cancelled, return to checkout | "You closed the payment window. Your order is still open." |
| `CREATED` | Awaiting payment | "This order has not been paid yet." |
| Any error or unknown value | "Status unavailable" | Never shown as success. |

Demo pages use the same layouts but are labelled **simulation**, as implemented in `status.js`.

---

## 6. Security summary

| Concern | Planned control |
|---|---|
| Key secret exposure | Stored only in server environment variables. Never in frontend files or Git. |
| Webhook spoofing | HMAC-SHA256 over the raw body with the webhook secret; constant-time comparison. |
| Browser forging a payment | Browser result is a hint only; server verifies signature and fetches the payment. |
| Amount tampering | Server compares provider amount with stored `amount_paise`. |
| Duplicate events | Event IDs stored; repeat events are ignored. |
| Replay of old events | Signature check plus idempotent processing. Timestamp checks to be considered after reading official docs. |
| Open redirects | `return_url` must be `https://` and registered by the merchant. |
| Card and UPI data | Never sent to or stored by PayNova. Entered only on the provider's hosted page. |
| Logs | Never log secrets, full signatures, card data, UPI PINs or passwords. |
| Errors | Generic messages to clients; detail only in server logs. |

---

## 7. Items to verify before Phase 3 (open questions)

1. Razorpay's current order creation request and response fields (official Orders API page).
2. Exact checkout signature rule and header names (official Checkout and Webhooks pages).
3. Exact webhook event names and payload shape for captured, failed and authorised payments.
4. Whether Razorpay sends a timestamp header for replay protection, and how to use it.
5. Refund and dispute events (out of scope for now, noted for later).
6. Rate limits and retry behaviour for webhooks.

Each item must be checked on razorpay.com/docs and the result recorded in `docs/phase-log.md` before the matching code is written.

---

## 8. Change log

| Date | Change |
|---|---|
| 2026-10-25 | Proposed contract written. No endpoints implemented. |
