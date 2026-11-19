# Research: what makes sports and action games creative and expressive

Written 2026-11-18 for the ability pass. Goal: find what makes players invent their own plays, and turn it into
abilities and small features for Faceoff that reward skill and timing without replacing hockey fundamentals.
Where a claim rests on press or community sources rather than the developers, it says so.

## The games

### Tape to Tape (arcade hockey roguelite, our closest reference)
- **What it does:** arcade hockey with a run structure: pick-1-of-3 coaches and abilities between games, relics,
  a drafted superstar, an overworld of games, elite and boss teams with gimmicks (studied in DESIGN.md from the
  user's video). Reviews praise the hockey itself (responsive, classic-NHL feel) more than the roguelite layer, and
  name weak AI teammates, no native online play and late repetition as the weak points
  ([Vaporlens summary](https://vaporlens.app/app/1566200/tape_to_tape),
  [early-access review](https://ema.bearblog.dev/tape-to-tape-review-brilliant-rectangle-2023-steam-early-access/),
  [Nintendo Life](https://www.nintendolife.com/reviews/switch-eshop/tape-to-tape)).
- **Why it works:** the base game is fun on its own; upgrades bend it rather than replace it.
- **For Faceoff:** keep hockey first. Abilities should create new versions of real hockey plays (a curl-and-drag
  shot, a stick that covers two lanes, a big open-ice hit) rather than magic that skips them. Beat its known weak
  spots: teammates that use their abilities sensibly, and a run that keeps changing how you play.

### Rocket League (mechanical skill expression)
- **What it does:** a tiny verb set (drive, jump, boost, flip) on a fully physical ball. Everything advanced (aerials,
  flip resets, air dribbles) is emergent from the physics, not a designed move.
- **Why it works:** consistent, readable physics means a player can discover a trick, practise it and rely on it.
  The skill ceiling comes from combining simple verbs in time and space, and the result is visible to everyone.
- **For Faceoff:** this is why the stick colliders matter. Once the blade is physical, tips, deflections, stick
  lifts and passes knocked down in the lane are emergent plays, not scripted outcomes. Abilities should be
  verbs that combine (burst into a charge, reach then poke, bender off a one-timer), not finishers.

### ULTRAKILL (style and combo freedom)
- **What it does:** a decaying style meter that rewards variety and penalises repeating the same weapon; the parry
  and projectile boost turn the enemy's attack into your tool. The shotgun parry began as something players found
  and the developer kept ([Style index wiki](https://ultrakill.fandom.com/wiki/Style_Index),
  [Gfinity on the parry](https://www.gfinityesports.com/article/ultrakills-bullet-parrying-glitch-is-still-one-of-the-best-accidental-features);
  the "rewards creativity" framing is from press and fans, not developer docs).
- **Why it works:** the score tells you what the game values (variety, risk, speed) without forbidding anything.
- **For Faceoff:** Heat and the flow rank already do this. Abilities feed the same layer (`ability_used` is a
  feedback event with flow points); a combo that chains two abilities into a goal should score more than either.
  A "parry" for hockey is the deflection: redirecting the opponent's pass or shot with your blade.

### Karlson (speed and physics comedy)
- **What it does:** fast movement, slide-hops and physical objects that react loudly to everything.
- **Why it works:** momentum is the reward and the physics makes every action look bigger.
- **For Faceoff:** ragdolls and the stride layer make speed and contact read. Burst skates belongs here: a quick
  hit of speed whose payoff is what you do with it.

### NHL series (skill moves)
- **What it does:** dekes on a stick or on buttons: toe drag, between the legs, the lacrosse "Michigan" goal. NHL 24
  added "Total Control", which maps dekes to single buttons, and guides note mistimed ones lead to turnovers and that
  the skater's deking rating matters ([RealSport101](https://realsport101.com/nhl/total-control-vs-skill-stick-in-nhl-24),
  [deke guide](https://realsport101.com/nhl/how-to-deke-in-nhl-24)).
- **Why it works:** one button for the move, timing and position for the outcome. That suits a laptop keyboard.
- **For Faceoff:** every ability is one key (O), and the outcome depends on when and where you use it. The spin move
  already works this way.

### Sifu (mastery through repetition)
- **What it does:** a short game you replay many times; the age system makes a mistake cost something you can see,
  and each attempt teaches the fight.
- **Why it works:** the player's own skill is the progression; upgrades are smaller than learning.
- **For Faceoff:** cooldowns and clear counterplay make every ability learnable from both sides. A whiffed charge
  stumbles you: a visible, fair cost.

### Hades (build variety)
- **What it does:** boons from different gods attach to the same few verbs (attack, special, cast, dash), and
  "duo" boons reward combining two gods.
- **Why it works:** a small set of verbs times many modifiers gives builds that feel different run to run, and
  synergies make players plan.
- **For Faceoff:** abilities are the verb (on O); the existing power cards (Curve, Split, Shock...) are the boons.
  Duo-style synergies are the natural next layer: for example Bender + Curve power, Long stick + Magnet stick.

### Others worth borrowing from
- **Hockey sim cancel windows (NHL, EA's skill stick):** a pass during a deke, a shot off a spin. Our input buffer
  already gives a forgiving window; abilities should be cancellable into a pass or shot.
- **Mario Strikers:** super-strike style charged shots with a short telegraph the defence can react to. Our charge
  copies the telegraph idea.
- **Lethal League:** the ball gets faster with every hit, so rallies escalate. A candidate for a later gimmick team.

## What makes players invent their own plays (the common thread)
1. **Consistent physics with a few verbs.** Players can't invent plays in a system they can't predict.
2. **Visible, learnable counterplay.** A telegraph, a cooldown, a cost: both players can read the moment.
3. **Verbs that combine.** The interesting plays are the sequences (burst, then charge; reach, then poke).
4. **A score that values variety and risk**, not a rule that forbids repetition.
5. **Small upgrades on a fun base.** The hockey has to be good without any ability.

## What this changed in Faceoff (this pass)
- Physical sticks (tips, deflections, lifts, lane blocks) for Rocket League-style emergent plays.
- An ability system built on these rules: one key, a cooldown and a sprint-bar cost, a tell or a commitment for
  counterplay, the same rules for bots, feedback through the existing juice layer.
- Four abilities built (Burst skates, Shoulder charge, Bender, Long stick); the rest are a backlog in DESIGN.md.
