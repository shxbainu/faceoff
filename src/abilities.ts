// Active abilities: data only. The sim (Game.useAbility, Game.tickAbility, Game.aiAbility) runs them, for you and
// for bots alike; every use emits the `ability_used` feedback event (tag = id), so juice is tuned in
// feedback/config.ts like any other event. Add one: an id here, a def in ABILITIES, its effect in useAbility /
// tickAbility, a bot rule in aiAbility, a feedback variant if it needs its own feel.

export type AbilityId = 'burst' | 'charge' | 'bender' | 'reach';

export interface AbilityDef {
  id: AbilityId; name: string; desc: string;
  /** seconds before it can be used again (from the moment it is used) */
  cd: number;
  /** share of the sprint bar it costs; it can't be used with less (a winded skater can't) */
  cost: number;
  /** how long it is active (s) */
  dur: number;
}

export const ABILITIES = {
  /** Burst skates: an explosive two-step in the held direction (or straight on). Beats a defender's gap or wins a
   *  race to a loose puck. Counterplay: it commits you to a line, costs sprint, and a hard turn right after it bleeds
   *  the speed (normal carve cost); a defender who holds his gap instead of biting just angles you off. */
  burst: { id: 'burst', name: 'Burst skates', desc: 'Explosive push the way you hold', cd: 3.5, cost: 0.18, dur: 0.25,
    push: 7.5, over: 1.35 } ,
  /** Shoulder charge: a short crouch (the tell), then a driving lunge that lands as a full-speed check on the first
   *  opponent it meets (a ragdoll at real closing speed). Whiffing leaves you stumbling. Counterplay: read the
   *  crouch and step aside, or chip the puck past before it lands. */
  charge: { id: 'charge', name: 'Shoulder charge', desc: 'Crouch, then drive through the next skater', cd: 6, cost: 0.3, dur: 0.55,
    wind: 0.18, speed: 16, reach: 7, whiff: 0.6 },
  /** Bender: arms your next shot (for `dur` s): it leaves wide and curls back to the corner you aimed at, around a
   *  blocker's stick and the goalie's first read. Counterplay: a blade in its path still meets it (the swept stick
   *  collision), a goalie who stays square still saves it, and arming it gives the defender time to close. */
  bender: { id: 'bender', name: 'Bender', desc: 'Your next shot curls around the block', cd: 5, cost: 0.1, dur: 1.6,
    bend: 9, quality: 0.1 },
  /** Long stick: for `dur` s your blade reaches further and traps harder passes: a lane stick that covers two
   *  lanes, pokes from outside the carrier's reach. Counterplay: saucer passes go over it, and a defender who
   *  reaches is out of position for a body check or a quick cut. */
  reach: { id: 'reach', name: 'Long stick', desc: 'Your stick reaches further and traps more', cd: 7, cost: 0.12, dur: 2.5,
    mult: 1.5, trap: 1.35 },
} satisfies Record<AbilityId, AbilityDef & Record<string, unknown>>;

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];

/** default loadout by slot (sim slots: 0 centre, 1 and 3 wings, 2 and 4 defenders; 3v3 uses the first three) */
export const LOADOUT: AbilityId[] = ['burst', 'bender', 'reach', 'charge', 'reach'];

/** Bots: how often (per second, once the moment is right) a bot uses it, from an easy bot to a sharp one, so
 *  abilities are a timing play for them too rather than spam the moment the cooldown ends. */
export const ABILITY_AI = { rate: [0.6, 2.2] };
