# Independent pose review (fresh subagent, images and anatomy rules only)

Latest: verify/round10 (after the proportions fix: stick 2.04 -> 1.84, arms +12%, resting blade 1.7 ahead).

| Shot | Verdict | Reviewer's main finding |
|---|---|---|
| 1 sprint | PASS | left elbow back and low; right arm and blade hidden from behind |
| 2 glide | FAIL | bottom forearm flush across the hip (probable clip); read the grip as crossed (measured: it is not, bottom hand is on the shot side) |
| 3 tight turn | FAIL | a glove sticking out of the lower back (hand through the torso); head over-tucked |
| 4 backward | PASS | elbow out and back, below the shoulder; left arm hidden |
| 5 backhand carry | FAIL | hands bunched at the knob; bottom arm crossing the chest flush against it; arm looks long |
| 6 mid-shot | PASS | elbows down, wrists in range; shaft possibly over the shin |

History (passes of 6): round1 1, round2 1, round3 2, round4 0, round5 3, round6 2, round7 0, round8 1, round9 2, round10 3.

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
