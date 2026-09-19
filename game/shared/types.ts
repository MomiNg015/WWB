export type Element =
  "" | "fire" | "water" | "wood" | "stone" | "light" | "darkness";
export interface Item {
  imageName: string;
  category: string;
  name: string;
  element?: Element;
  atk?: number;
  def?: number;
  cost?: number;
  price?: number;
  giftRate?: number;
  appearanceRate?: number;
  guardianAttackRate?: number;
  ability?: string;
  abilityValue?: number;
  curse?: string;
  guardian?: string;
  isPlusAtk?: boolean;
  hitRate?: number;
}
export interface Card {
  uid: string;
  id: string;
  apparentId?: string;
}
export interface Player {
  id: string;
  name: string;
  team: number;
  bot: boolean;
  hp: number;
  mp: number;
  cp: number;
  hand: Card[];
  miracles: Card[];
  curses: string[];
  guardian: string | null;
  redraw: number;
  confused?: number;
}
export interface Rules {
  id: string;
  initialHP: number;
  initialMP: number;
  initialCP: number;
  handSize: number;
  maxHandSize: number;
  maxStat: number;
  tiebreak: number;
  diseaseChance: number;
  guardianChance: number;
  guardianLeaveChance: number;
  devilChance: number;
}
export interface Action {
  source: number;
  target: number;
  cards: Item[];
  atk: number;
  element: Element;
  miracle: boolean;
  kind: "attack" | "effect" | "sell" | "buy" | "purchase" | "miss";
  bounces: number;
  tradeCard?: Card;
  tradeOwner?: number;
  announced?: boolean;
}
export interface Event {
  seq: number;
  round: number;
  text: string;
}
export interface Game {
  cues: BattleCue[];
  resumeAction?: boolean;
  id: string;
  rules: Rules;
  players: Player[];
  turn: number;
  round: number;
  seed: number;
  serial: number;
  revision: number;
  queue: Action[];
  history: Event[];
  phase: "action" | "defense" | "ended";
  winners: string[];
}
export type Command =
  | {
      type: "play";
      cards: string[];
      target: number;
      exchange?: { hp: number; mp: number; cp: number };
      tradeCard?: string;
    }
  | { type: "defend"; cards: string[]; buy?: boolean }
  | { type: "purchase"; accept: boolean }
  | { type: "confused" }
  | { type: "pray" }
  | { type: "discard"; cards: string[] }
  | { type: "surrender" };
export type PublicPlayer = Omit<Player, "hand" | "miracles" | "redraw"> & {
  hand?: Card[];
  miracles?: Card[];
  handCount: number;
  miracleCount: number;
};
export interface GameView {
  cues: BattleCue[];
  id: string;
  rules: Rules;
  players: PublicPlayer[];
  turn: number;
  round: number;
  revision: number;
  pending: Action | null;
  history: Event[];
  phase: Game["phase"];
  winners: string[];
  self: number;
}

/** Public presentation events: never include drawn identities or private hands. */
export interface BattleCue {
  kind:
    | "start"
    | "launch"
    | "resolve"
    | "draw"
    | "damage"
    | "heal"
    | "reflect"
    | "bounce"
    | "block"
    | "safe"
    | "miss"
    | "curse"
    | "death"
    | "revive"
    | "guardian"
    | "guardianAttack"
    | "guardianLeave"
    | "confusion"
    | "redraw"
    | "removeCurse"
    | "trade"
    | "purchase"
    | "hit"
    | "exchange"
    | "phenomenon"
    | "devil"
    | "disease"
    | "upgradeDisease"
    | "upgradeHeaven"
    | "pray"
    | "discard"
    | "resource";
  source?: number;
  target: number;
  cards?: Item[];
  defense?: Item[];
  amount?: number;
  label?: string;
  nextTarget?: number;
  hpAfter?: number;
  previousLabel?: string;
  before?: { hp: number; mp: number; cp: number };
  after?: { hp: number; mp: number; cp: number };
}
