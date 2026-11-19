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

## Tape to Tape's own skills, talents and artefacts (from the community wiki, 2026-11-18)

Source: the fan wiki ([Skills](https://tapetotape.miraheze.org/wiki/Skills), [Talents](https://tapetotape.miraheze.org/wiki/Talents),
[Artefacts](https://tapetotape.miraheze.org/wiki/Artefacts), [Superstars](https://tapetotape.miraheze.org/wiki/Superstars),
[Power-up combinations](https://tapetotape.miraheze.org/wiki/Power-Up_Combinations)). The wiki gives names and
one-line effects, no cooldowns or numbers for skills; the numbers below are the wiki's. Their content is studied
here to learn what works; Faceoff keeps its own names, effects and art.

### The three layers
- **Skills (active, 17, one per player, one button).** Dash, Jump (charge by holding; a jump shot in the offensive
  zone), Spin-O-Rama (blocks checks and steals briefly), Magnet, Yo-Yo (shoot the puck out, call it back), Mega-Sauce
  (huge clear), Slowmo, and a lot of slapstick area effects: Dragon Shout and Gas (knock back everyone near),
  Kazoo (nearby opponents lose the puck), Yeet (launch players), Tomahawk and Mjolnir (throw the stick), Grappling
  Hook, Head Smasher, Headshot Redirect, Disco Dance.
- **Talents (passive, 67, up to three per skater; in a run earned from challenges and elite teams and assigned to
  any skater).** They fall into clear families:
  - *Stat trades with a cost:* Heavy Helmet (+100 checking, -30 speed), Iron Helmet, Propeller Helmet (+40 speed,
    -40 accuracy), Glass Cannon (+50 shot power, half the shots break the stick), Rocket Skates (speed for agility).
  - *Situational triggers:* Blue Line Boost (burst crossing a blue line), Breakaway Boost (+50 overall on a
    breakaway), Retro Rocket (+50 speed skating backward), Enraged (+50 overall for a while after being knocked
    down), Pressure Cooker (+40 until you score), Point Sniper (accuracy from the blue line).
  - *Chain triggers off another play:* Power Transfer (a pass gives the receiver shot power), Speed Transfer,
    Slapshart (shooting propels you), Pass Puncher and Puck Puncher (when knocked out, the puck still goes somewhere
    useful).
  - *Puck rule-benders:* Curve Ball, Changeup, Trickshot, X-Ray Shot, Express Delivery, Flawless Feeder (passes
    can't be intercepted), Mega Deflect, Bouncy McBounce, Mega Rebound, Rebound Magnet.
  - *Behaviour (AI role) talents:* Ball Chaser, Cherry Picker, Homewrecker and Marauder (hunt puckless opponents in
    one zone), Human Shield, Safety First, Redirector (stands in front to tip shots).
  - *Run growth:* Cannon Arm, Growing Anger, Momentum, Target Practice: +5 to a stat for every game won.
  - *Area knock effects:* Chexsplosion, Sonic Slap, The Howitzer, Wind Up, Spiked Armor.
- **Artefacts (team relics, one at the start of a run plus up to five from elite and boss wins).** Mostly
  conditional and score-state rules: +overall in a given period, Tribal Mask (+25 while losing), Last Minute,
  Buzzer Beater (goals in the final minute count double), Rare Berry (+20 for 15 s after a faceoff win), Lucky Molar
  (speed after a successful check), Lifeless Branch (get up twice as fast), plus bench buffs.
- **Superstars** read through stat extremes plus one skill and a couple of talents: Kelly Jelly 81 speed and 0
  checking with Spin-O-Rama and Puckless Rocket; Sergei Lancelov 120 checking with Iron Helmet; Frank Furter 80
  power and 5 accuracy.

### What makes them effective
1. **Identity through a trade-off.** The memorable talents cost something (Heavy Helmet, Glass Cannon, Propeller
   Helmet). A skater becomes a character, and the player plans around his weakness.
2. **Power tied to a hockey situation.** Blue Line Boost, Breakaway Boost, Retro Rocket and Point Sniper don't
   give power, they give a reason to make a certain play: attack the blue line with speed, defend skating backward,
   shoot from the point. The player learns to create the situation.
3. **Chains reward team play.** Power Transfer and Speed Transfer pay off a pass, not a solo run.
4. **Teammate roles fix the AI.** Behaviour talents (Redirector, Human Shield, Cherry Picker) turn bots into
   teammates with a job you can play with. Reviews name weak AI teammates as the game's main fault, and this is the
   game's own patch for it.
5. **Run growth.** Per-win +5 talents make early picks an investment.
6. **Spectacle.** Many skills are slapstick (Gas, Yeet, Dragon Shout). They read instantly and make clips, but
   they are also the least hockey.

### Where they fall short (what to improve)
- **No counterplay on several.** Flawless Feeder (passes can't be intercepted), X-Ray Shot (through players),
  Unhittable and Spiked Armor remove the other side's answer. Several were removed or restricted later
  (Unhittable, Intimidator, Speed Transfer, Puck Repellent...), which suggests balance trouble.
- **Randomness over skill.** Wild Shot, Random Skill, Glass Cannon's 50% stick break: outcomes the player doesn't
  control.
- **Area effects skip hockey.** Kazoo, Dragon Shout and Gas win the puck without positioning, timing or a stick.
- **Stats as flat numbers.** "+50 overall" is invisible in play; the player can't feel which part changed.

### How Faceoff should copy and improve them
- **Skills:** keep one active per skater on one key, but make each a hockey verb with a tell or a commitment and a
  physical result through our systems (stick colliders, momentum checks, gait). Prefer Dash, Jump-style charged
  moves, Spin-O-Rama, Magnet and Yo-Yo-style puck control over area knockbacks. Where we keep a big slapstick one,
  give it a clear tell and a cost.
- **Talents (our passives):** build three families first: (a) trade-offs that show on the ice (a heavier skater
  hits harder and visibly turns wider), (b) situational triggers that teach a play (blue-line burst, backward-skating
  speed, point shot), (c) chains that pay off passing (receiver's next shot or stride gets a boost). Add behaviour
  talents for bot teammates; they are the cheapest fix for weak AI. Every rule-bender keeps counterplay (a
  "can't be intercepted" pass becomes "clears the first stick it meets").
- **Artefacts:** our power cards already fill this role. Add score-state and timing relics (comeback when trailing,
  last-minute, after a faceoff win) that make the match's moments matter.
- **Numbers you can see:** every bonus has a visible tell on the skater (stride, lean, puck trail, ring), not just
  a stat.

## What makes players invent their own plays (the common thread)
1. **Consistent physics with a few verbs.** Players can't invent plays in a system they can't predict.
2. **Visible, learnable counterplay.** A telegraph, a cooldown, a cost: both players can read the moment.
3. **Verbs that combine.** The interesting plays are the sequences (burst, then charge; reach, then poke).
4. **A score that values variety and risk**, not a rule that forbids repetition.
5. **Small upgrades on a fun base.** The hockey has to be good without any ability.

## What this changed in Faceoff (this pass)
- Physical sticks (tips, deflections, lifts, lane blocks) for Rocket League-style emergent plays.
- An ability system built on these rules: one key, a cooldown and a sprint-bar cost, a tell or a commitment for
  counterplay, the same rules for bots, feedback through the existing juice layer. Four abilities were prototyped
  (Burst skates, Shoulder charge, Bender, Long stick). At the user's request they are **switched off** (`?abilities`
  turns them on) while the skill and passive design is reworked from the Tape to Tape study above (DESIGN.md).
