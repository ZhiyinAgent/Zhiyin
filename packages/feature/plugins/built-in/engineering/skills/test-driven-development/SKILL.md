---
name: test-driven-development
description: >-
  Use when changing behavior in code that has or should have tests: write the failing test first, choose unit or integration scope, use test doubles carefully, and prevent regressions.
---

Approach the work as someone who has to trust the test suite when nobody is watching. A test is valuable when it fails for a real defect and passes for any correct implementation.

**Find how the project tests first:** its test runner, where tests live, how one file or one test is run, and the command the project treats as green, from its README, its package or build files and its CI configuration. Run tests with bash, which the person approves; a run still going after 30 seconds carries on as a job, and job_output shows more of it or waits for it.

**Work in the cycle:**
1. Write one test that describes the next piece of behavior through a public interface, and run it to see it fail for the expected reason. A test that fails on an import error or a typo has not yet tested anything.
2. Write the smallest change that makes it pass.
3. Refactor with the test green, then run the wider suite.

For example, in Python with pytest, the behavior first, then the code:

    def test_a_refund_larger_than_the_payment_is_refused():
        payment = Payment(amount=Decimal("20.00"))
        with pytest.raises(RefundTooLarge):
            payment.refund(Decimal("20.01"))
        assert payment.refunded == Decimal("0.00")

**For a reported defect, reproduce it in a test before changing the code,** so the fix is proven and cannot quietly return. The engineering/interactive-debugger specialist can find the cause of a failure that does not yield to a first look.

**Test behavior, not implementation.** Assert on outputs and observable effects. A test that breaks when internals change but behavior does not is wrong; fix the test design, never the working behavior to suit it.

**Choose the boundary:**
- Unit tests for logic that can run alone.
- Integration tests where the risk lives at a boundary: the filesystem, a database, a process, a network protocol. Use the real thing, such as a temporary directory or a local server, whenever it is cheap enough.
- Test doubles only for what is slow, nondeterministic, or outside your control. Prefer simple fakes that behave like the real dependency over mocks that script call sequences. Do not assert on how often a collaborator was called unless the call order is the contract.

**Keep tests deterministic and independent.** Pass the clock, random seeds and ids in rather than reading them inside the code under test; wait for a condition, never for a fixed sleep; give each test its own data, so it passes alone and in any order. A test that fails one run in fifty is a defect to fix, not to rerun.

**Cover the edges that matter:** empty and maximum input, invalid input at system boundaries, concurrency and interruption, and the failure of each dependency. Where the inputs are too many to list, a property-based test checks a rule over generated inputs, such as "parsing what was formatted gives the original back".

**Write expectations a reader can check** without the implementation open, and name each test after the behavior it guarantees. Coverage shows what no test runs; it does not show what is tested well. Break the code on purpose, flip a comparison or drop a line, and a good test fails.

**Never weaken or delete a working test to make new code pass.** A passing type check or build is a gate, not a test. Report which tests were added, which suites ran with their result lines, and what remains untested.
