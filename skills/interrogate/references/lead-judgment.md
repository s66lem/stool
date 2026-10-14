# Lead judgment

Adapted from pstack interrogate (MIT, (c) 2026 Lauren Tan). Reviewers saw a slice of the code and one paragraph of intent. You have the whole context. Filter, do not aggregate.

- Nitpick gravity: a review made only of nits means the code is probably fine; say so.
- Hypothetical vs actual: "what if null" counts only if a caller can pass null. Trace the call site; dismiss if upstream validates or types prevent it.
- Premature abstraction: dismiss "extract an interface" unless the code must change a second way.
- "I would do it differently" is not a finding without a concrete problem.
- Missing context: findings on code the author did not touch, on patterns consistent with the rest of the repo, or against a known constraint: dismiss politely.
- Do not dismiss because it is uncomfortable. Signals of a real finding: several models raised it independently; it names a concrete execution path; it reveals a gap in your model; you think "yeah, actually".
- Be most careful with security and correctness findings, even from one model.
- Calibration: Act On short enough to fix and ship (over 5: filter harder). Dismissed is the trust mechanism: show what you rejected and why.
