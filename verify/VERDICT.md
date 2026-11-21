# Grip rig review (2026-11-20), blind subagent, images and rules only

Hard check `node tests/grip_check.mjs 60` (every frame of a 60 s bot match, every skater): 0 frames over 1 cm,
worst 0.003 cm (35,657 skater-frames). Images verify/grip_r1..r3 (r3 adds a side view of the same frozen moment).

| Round | Pass | Failures |
|---|---|---|
| r1 | 3/6 | tight turn: top glove past the shaft end; backhand: knob into the chest, top hand hidden; mid-shot: shaft through the torso, top hand hidden |
| r2 | 3/6 | backward: top forearm flat across the belly (borderline); sprint, mid-shot: hands hidden from behind, can't judge |
| r3 | 3/6 | sprint: game view shows no stick (side view: both gloves on the shaft); glide: side view shows no stick and a fist at shoulder height (game view: both gloves on it); backhand: one glove visible, shaft top at the belly |

# Limb stiffness and clipping review (2026-11-20), blind subagent, images and rules only

Baseline verify/limbs_before; rounds verify/limbs_r1..r3 (low/ = 640 px copies the reviewer saw). Each round is a
different moment, so passes are not strictly comparable. r3 mid-shot reuses r2's (r3's run missed one; shots keep the clip's arms).

| Round | Pass | Failures |
|---|---|---|
| r1 | 3/6 | sprint: free fist up at the neck; tight turn: free fist flush on the sternum; backward: elbow folded back at shoulder level |
| r2 | 5/6 | tight turn: free fist raised to helmet height ("flex") |
| r3 | 3/6 | tight turn: shaft top past the bottom glove into the forearm (borderline); backward: shaft across the belly, top hand off the knob (borderline); backhand: can't judge (hidden) |

# Arm motion review (2026-11-19, after easing the stick IK targets)

Strips in verify/arm_motion (A = new, B = old; 15 frames at 10 fps, side camera). Blind reviewer, images only:
A mostly natural (top arm in front of the belly, elbow down, smooth; A2 row 3 the cleanest strip), B some problems
(top arm reaching straight out, B1 row 1 col 4 to row 2 col 1). Prefers A at about 60%: the strips are small and half
the frames are blocked by other players. No pops, backward elbows or hands off the stick seen in either.

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

## Powered-ragdoll spike (`?phys`), verify/phys_spike/low, fresh-context reviewer (2026-11-20)
- 1_sprint FAIL: no stick visible, empty fist at the hip.
- 2_reach PASS (a pale wedge by the top glove: likely an ice chip).
- 3_tight_turn PASS.
- 4_backward PASS, low confidence: the blade looks stood up off the heel; small notch at the left armpit.
- 5_backhand_carry FAIL: shaft top into the chest, no glove visible, an arm folded up at head height.
- 6_mid_shot CAN'T JUDGE (hands bunched, elbows hidden).
- 7_screenshot CAN'T JUDGE (arms hidden); specks at the yellow player's collar.
- 3 of 7 (strict 2). Spike numbers: verify/phys_spike_60s.txt.
