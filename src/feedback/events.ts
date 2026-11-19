// The event contract between gameplay and feedback. Types only, no runtime code, so the sim (and a future game
// server) can import it without pulling in any rendering or audio.
//
// Gameplay emits these with an intensity `i` from 0 (barely counts) to 1 (as good as it gets). The feedback
// system decides what each one looks and sounds like. Ids (`id` actor, `vid` victim or receiver) let each client
// work out for itself whether the event involved the skater it controls.

export type FxName =
  | 'pass_released'   // puck leaves the stick on a pass. tag: 'saucer' | 'dump'
  | 'pass_completed'  // a pass lands on a teammate. n: pass streak (home team), tag: 'tape' (on target)
  | 'one_touch'       // received and passed on in one touch. n: streak
  | 'one_timer'       // shot straight off a pass
  | 'streak_end'      // the pass streak ended. n: streak length, tag: 'cashed' (it ended in a shot) | 'broken'
  | 'shot_released'   // any shot. tag: 'wrist' | 'slap' | 'one_timer'; big: released in the sweet spot
  | 'post_hit'        // off the post or crossbar
  | 'near_miss'       // a shot just wide of the post
  | 'save_made'       // goalie or shot block. tag: save kind, 'block'; big: a stretch save at the edge of reach
  | 'check_landed'    // body contact. tag: 'shove' | 'hit' | 'big' | 'over'; board: pinned on the boards; timed: caught just after receiving
  | 'spin_move'       // spin move started with the puck
  | 'beat_defender'   // a move left a defender behind
  | 'speed_burst'     // the controlled skater kicked into a sprint
  | 'turnover'        // possession changed teams. team: the team that won it. tag: 'pickoff' | 'loose'
  | 'faceoff_won'     // draw won. team: winner
  | 'goal_scored';    // team: scorer. tag list in `text`: 'one_timer', 'ot', 'winner', 'streak'

/** Fields gameplay fills on a feedback event (it travels on the sim's general Ev object). */
export interface FxFields {
  t: FxName;
  i: number;
  x?: number; y?: number;
  team?: number;
  id?: number; vid?: number;
  dx?: number; dy?: number;
  n?: number;
  tag?: string;
  big?: boolean;
  board?: boolean;
  timed?: boolean;
  text?: string;
}

export const FX_NAMES: FxName[] = ['pass_released', 'pass_completed', 'one_touch', 'one_timer', 'streak_end', 'shot_released',
  'post_hit', 'near_miss', 'save_made', 'check_landed', 'spin_move', 'beat_defender', 'speed_burst', 'turnover', 'faceoff_won', 'goal_scored'];
