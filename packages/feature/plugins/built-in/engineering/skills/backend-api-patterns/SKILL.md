---
name: backend-api-patterns
description: >-
  Use when designing or changing a server interface: REST or RPC schemas, request validation, transactional boundaries, error contracts, idempotency, and rate limiting.
---

Approach the work as the engineer who will be paged when this interface misbehaves. An API is a contract with clients you do not control; design it so that correct use is easy, incorrect use fails clearly, and partial failure leaves no inconsistent state.

**Start from the operations clients need,** not from the database tables. For each operation, establish who may call it, what it changes, what it returns, and what happens when it is repeated or interrupted. Read the existing API and its tests first (search_files, read_file), and follow its conventions.

**Design the contract:**
- Name resources and operations consistently with the existing API. Use HTTP methods and status codes for their defined meaning: GET, PUT and DELETE are idempotent and POST is not; 400 for a malformed request, 401 when the caller is unknown, 403 when it may not, 404, 409 for a conflict with the current state, 422 for a well-formed request that breaks a rule, 429 when rate limited. Or follow the RPC framework's own conventions.
- Define request and response schemas explicitly. Changes that add an optional field or a new endpoint keep old clients working; removing or renaming a field, tightening validation or changing a meaning breaks them, and needs a new version and a deprecation period.
- Return errors in one documented shape with a stable machine-readable code and a message a person can act on, such as RFC 9457's problem details. Never leak stack traces, queries, or secrets.
- Paginate every list that can grow, with a stable ordering; a cursor from the last item seen holds up under inserts where a page number does not.

**Validate at the boundary.** Parse untrusted input into typed values once, reject unknown or malformed fields, bound every size, and check authorization on every request for the specific resource, not only authentication: a caller who may read order 41 must not read order 42 by changing the number. Never bind a request body straight onto a stored record, or a client can set fields it should not, such as its own role.

**Keep state consistent:**
- Put each business change inside one transaction whose boundary matches the invariant it protects.
- Make retried writes safe with idempotency keys or natural uniqueness. For example, a POST /payments with an Idempotency-Key header stores the key with the request's hash and the response in the same transaction as the payment; a repeat with the same key and body returns the stored response, and the same key with a different body is refused with 422.
- Never call an external service while holding a database transaction open; use an outbox or a follow-up step instead.
- Handle concurrent updates deliberately, with optimistic versions (an ETag with If-Match, answered 412 when stale) or row locks.

**Protect the service** with rate limits keyed to the caller, timeouts on every outbound call, and bounded retries with exponential backoff and jitter for operations that are safe to retry. Give every request an id that appears in its logs and its error response, so a report from a client can be traced.

**Verify with tests that exercise the contract through its public entry point:** success, validation failure, authorization failure, conflict, and repetition. Run them with bash, which the person approves, and state which of these were run. Before handing over, the engineering/code-reviewer specialist can review the diff, and the engineering/interactive-debugger specialist can find the cause of a failure that does not yield to a first look.
