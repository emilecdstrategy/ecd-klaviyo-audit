# AI Golden Set and Rollout (v1)

This document defines how to validate and roll out production AI analysis.

## 1) Golden set composition

Create 10 representative audits:

- 4 ecommerce brands with healthy data
- 3 ecommerce brands with sparse/incomplete data
- 2 B2B accounts
- 1 intentionally noisy input case

For each test case, capture:

- wizard input payload
- expected quality rubric scores
- target section-level sanity ranges (revenue opportunity, confidence)

## 2) Rubric (score each 1-5)

- Accuracy to provided inputs
- Specificity/actionability
- Executive summary clarity
- Section completeness/consistency
- Commercial usefulness (client-ready quality)

Pass threshold:

- Average >= 4.0
- No single section below 3.0

## 3) Operational checks

- Schema-valid outputs >= 95%
- Hard failures <= 2%
- Mean latency:
  - primary model (`gpt-5.4`) under 25s
  - escalation (`gpt-5.4-pro`) under 45s for failed-section repair

## 4) Rollout phases

1. Internal only:
   - Enable for team accounts
   - Monitor `ai_runs` for validation/provider errors
2. Limited production:
   - 20-30% of new audits
   - Compare edit-rate and publish-rate vs internal baseline
3. Full production:
   - 100% traffic
   - Keep escalation enabled only when validation fails

## 5) Incident runbook

- If validation failures spike:
  - inspect `ai_runs.error_message`
  - temporarily force fallback to `gpt-5.4-pro`
  - tighten prompt constraints
- If provider timeout spikes:
  - reduce reasoning effort or split generation into section batches
  - increase retry backoff slightly

