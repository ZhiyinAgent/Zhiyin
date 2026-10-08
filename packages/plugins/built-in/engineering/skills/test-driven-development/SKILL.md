---
name: test-driven-development
description: Use when changing behavior in code that has or should have tests: write the failing test first, choose unit or integration scope, use test doubles carefully, and prevent regressions.
---

Approach the work as someone who has to trust the test suite when nobody is watching. A test is valuable when it fails for a real defect and passes for any correct implementation.

Work in the cycle:
1. Write one test that describes the next piece of behavior through a public interface, and run it to see it fail for the expected reason.
2. Write the smallest change that makes it pass.
3. Refactor with the test green, then run the wider suite.

For a reported defect, reproduce it in a test before changing the code, so the fix is proven and cannot quietly return.

Test behavior, not implementation. Assert on outputs and observable effects. A test that breaks when internals change but behavior does not is wrong; fix the test design, never the working behavior to suit it.

Choose the boundary:
- Unit tests for logic that can run alone.
- Integration tests where the risk lives at a boundary: the filesystem, a database, a process, a network protocol. Use the real thing, such as a temporary directory or a local server, whenever it is cheap enough.
- Test doubles only for what is slow, nondeterministic, or outside your control. Prefer simple fakes that behave like the real dependency over mocks that script call sequences. Do not assert on how often a collaborator was called unless the call order is the contract.

Cover the edges that matter: empty and maximum input, invalid input at system boundaries, concurrency and interruption, and the failure of each dependency.

Write expectations a reader can check without the implementation open, and name each test after the behavior it guarantees.

Never weaken or delete a working test to make new code pass. A passing type check or build is a gate, not a test. Report which tests were added, which suites ran, and what remains untested.
