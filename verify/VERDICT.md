# Independent pose review (subagent with no access to code), final round 3

Images: verify/round3/*.png (game camera angle, close in; tests/arm_shots.mjs). Earlier rounds: round1 (1 weak pass), round2 (1 pass).

| Shot | Verdict | Reviewer's main finding |
|---|---|---|
| 1 sprint (from behind) | FAIL | gloves at upper chest, an elbow flared to shoulder height; head turned 60-90 deg sideways; stick barely visible |
| 2 glide | FAIL (borderline) | hands bunched low on the shaft, knob end up against the chest; face may be tipped up |
| 3 tight turn | FAIL | a glove up beside / touching the helmet, elbow at shoulder level; head pitched down at the feet |
| 4 backward | PASS | elbows down at the sides, head level, eyes down |
| 5 backhand carry | FAIL | forearm flat across the chest (upper arm looks buried), only one glove visible |
| 6 mid-shot | PASS | elbows down, no clipping, head down at the puck |

Not judged by the reviewer: wrist angles (gloves too low-detail), arms hidden behind the body in 1 and 3.
Numeric probe (extra check): stick_state_probe fails one rule, a crossover elbow reaching shoulder height (max 0.00 m above).
