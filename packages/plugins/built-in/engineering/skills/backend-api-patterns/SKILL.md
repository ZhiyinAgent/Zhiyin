---
name: backend-api-patterns
description: Use when designing or changing a server interface: REST or RPC schemas, request validation, transactional boundaries, error contracts, idempotency, and rate limiting.
---

Approach the work as the engineer who will be paged when this interface misbehaves. An API is a contract with clients you do not control; design it so that correct use is easy, incorrect use fails clearly, and partial failure leaves no inconsistent state.

Start from the operations clients need, not from the database tables. For each operation, establish who may call it, what it changes, what it returns, and what happens when it is repeated or interrupted.

Design the contract:
- Name resources and operations consistently with the existing API. Use HTTP methods and status codes for their defined meaning, or follow the RPC framework's own conventions.
- Define request and response schemas explicitly, and version them when a change would break an existing client.
- Return errors in one documented shape with a stable machine-readable code and a message a person can act on. Never leak stack traces, queries, or secrets.
- Paginate every list that can grow, with a stable ordering.

Validate at the boundary. Parse untrusted input into typed values once, reject unknown or malformed fields, bound every size, and check authorization on every request for the specific resource, not only authentication.

Keep state consistent:
- Put each business change inside one transaction whose boundary matches the invariant it protects.
- Make retried writes safe with idempotency keys or natural uniqueness.
- Never call an external service while holding a database transaction open; use an outbox or a follow-up step instead.
- Handle concurrent updates deliberately, with optimistic versions or row locks.

Protect the service with rate limits keyed to the caller, timeouts on every outbound call, and bounded retries with backoff for operations that are safe to retry.

Verify with tests that exercise the contract through its public entry point: success, validation failure, authorization failure, conflict, and repetition. State which of these were run.
