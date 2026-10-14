# Review rubric

Adapted from pstack interrogate (MIT, (c) 2026 Lauren Tan).

- Correctness: edge cases (empty, nil, boundary), swallowed errors, off-by-one, stale state, races; idempotency (what if it runs twice, or crashed halfway?); trace the call chain when you claim a nil.
- Root cause vs symptom: guard clauses hiding a broken invariant, retries hiding a broken contract, casts silencing a modelling error. A comment saying "don't do X" where a type, check or runtime assert could make X impossible.
- Structure: validate once at the boundary then trust; mixed abstraction levels; coupling; patched-on rather than integrated; an old path kept beside a new one with no external consumers. Premature abstraction is worse than duplication.
- Verification: tests that would still pass if the code did nothing; no test for a bug fix; trusting self-reports instead of reading the real value.
- Complexity: simpler without losing correctness; one-call-site abstractions; config for cases that do not exist; dead code.
- Security / trust boundary: client input reaching a sink unchecked; a server remote that trusts the client; missing authorization on a new remote; secrets in logs; check-then-use gaps. Trace the input path.
- Platform extras: a client-sent value used without type and range check, per-frame allocations in hot loops, impure calls inside code that must stay pure, storage writes without failure handling.
