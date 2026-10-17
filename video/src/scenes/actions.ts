import type { Action } from "../../../shared/types";
import { impulse, smooth, wobble } from "../motion";
import { mulberry32 } from "../rng";
import { SEG, type Pose } from "./rig";

export type ActionCtx = {
  /** Seconds; offset per figure so a crowd doesn't move in lockstep. */
  t: number;
  /** Beats elapsed (see beatPhase): integers land on the song's beats. */
  beat: number;
  /** Seconds per beat around t. */
  beatLen: number;
  /** Smoothed loudness 0..1 at this time. */
  energy: number;
  /** The song's seed; noise is drawn from it for every figure (see wobble). */
  seed: number;
  /** Small integer per figure, so figures pick their own noise streams and dance moves. */
  variant: number;
};

const TAU = Math.PI * 2;
const sin = (x: number) => Math.sin(x);
const frac = (x: number) => x - Math.floor(x);
const STAND: Pose = { x: 0, y: 0, lean: 0, head: 0, armL: [4, 8], armR: [-4, 8], legL: [0, -2], legR: [0, -2], stretch: 1, hair: 0 };
const pose = (p: Partial<Pose>): Pose => ({ ...STAND, ...p });

/** A small nod on each beat, scaled by loudness: figures that aren't dancing still feel the music. */
const nod = (c: ActionCtx, depth: number) => depth * c.energy * impulse(frac(c.beat) * c.beatLen, 0.09);

const breath = (t: number) => 1 + 0.006 * sin((t / 3.4) * TAU);

/** A noise stream of this figure's own. */
const own = (c: ActionCtx, channel: number, rate: number) => wobble(c.seed, c.t, channel + 19 * c.variant, rate);

function idle(c: ActionCtx): Pose {
  const { t } = c;
  const b = sin((t / 3.2) * TAU);
  // Weight shifts and glances wander instead of looping, so a long idle shot never visibly repeats.
  const drift = own(c, 11, 0.18);
  const glance = own(c, 12, 0.12);
  return pose({
    lean: 0.8 + 0.6 * b + 1.4 * drift,
    head: 1.5 * sin((t / 4.5) * TAU) + 5 * glance + nod(c, 4),
    armL: [4 + 1.5 * b, 8 + 3 * drift],
    armR: [-4 - 1.5 * b, 8 - 3 * drift],
    stretch: breath(t),
  });
}

type Gait = {
  period: number;
  /** Half the stride: how far ahead of (and behind) the hip each foot is planted, in figure-heights. */
  reach: number;
  /** Peak height of the swinging foot. */
  lift: number;
  /** Hip-to-ankle distance of the planted leg as a share of the leg's length; under 1 keeps a soft knee. */
  stance: number;
  /** How high the body leaves the ground as the feet change over (running's flight phase). */
  float: number;
  armSwing: number;
  elbow: number;
  lean: number;
};
const WALK: Gait = { period: 1.1, reach: 0.2, lift: 0.05, stance: 0.99, float: 0, armSwing: 22, elbow: 12, lean: 3 };
const RUN: Gait = { period: 0.65, reach: 0.29, lift: 0.13, stance: 0.93, float: 0.025, armSwing: 55, elbow: 80, lean: 13 };

const LEG = SEG.thigh + SEG.shin;
const deg = (r: number) => (r * 180) / Math.PI;

/** Two-bone IK: thigh and knee angles (rig convention) that put the ankle at (dx, dy) from the hip, knee forward. */
function legTo(dx: number, dy: number): [number, number] {
  const T = SEG.thigh;
  const S = SEG.shin;
  const d = Math.min(Math.hypot(dx, dy), LEG * 0.9999);
  const toAnkle = Math.atan2(dx, dy);
  const atHip = Math.acos(Math.min(1, (T * T + d * d - S * S) / (2 * T * d)));
  const atAnkle = Math.acos(Math.min(1, (S * S + d * d - T * T) / (2 * S * d)));
  return [deg(toAnkle + atHip), -deg(atHip + atAnkle)];
}

/**
 * Where a foot is relative to the hip `u` (0..1) of the way through a cycle: planted for the first half (sweeping
 * straight back at a constant speed, so it stays put on ground scrolling at groundSpeed), then swinging forward on
 * an arc for the second half.
 */
function foot(u: number, g: Gait): { x: number; lift: number } {
  if (u < 0.5) return { x: g.reach * (1 - 4 * u), lift: 0 };
  const s = (u - 0.5) * 2;
  return { x: -g.reach * Math.cos(Math.PI * s), lift: g.lift * Math.sin(Math.PI * s) };
}

function gait(t: number, g: Gait): Pose {
  const u = frac(t / g.period);
  const reachLeg = LEG * g.stance;
  // The hip rides over the planted foot at a constant leg length, so it rises and falls like an inverted pendulum.
  const hip = (x: number) => Math.sqrt(Math.max(reachLeg * reachLeg - x * x, 0));
  const r = foot(u, g);
  const l = foot(frac(u + 0.5), g);
  const planted = r.lift === 0 ? r : l;
  const height = hip(planted.x);
  const legR = legTo(r.x, height - r.lift);
  const legL = legTo(l.x, height - l.lift);
  // Each arm swings against the leg on its own side.
  const arm = g.armSwing * Math.cos(TAU * u);
  return pose({
    lean: g.lean,
    // Running leaves the ground around each change of feet.
    y: -g.float * Math.cos(TAU * u) ** 2,
    // The head steadies itself against the bob, as people's do.
    head: -1.5 * Math.abs(Math.sin(TAU * u)),
    legR,
    legL,
    armR: [-arm, g.elbow],
    armL: [arm, g.elbow],
  });
}

/**
 * How fast the ground passes under a figure doing `action`, in figure-heights per second: the planted foot sweeps
 * back the whole stride (twice the reach) every half-cycle, so scrolling the world at this speed keeps it still.
 */
export function groundSpeed(action: Action): number {
  const g = action === "run" ? RUN : action === "walk" ? WALK : null;
  return g ? (4 * g.reach) / g.period : 0;
}

const walk = (c: ActionCtx) => gait(c.t, WALK);
const run = (c: ActionCtx) => gait(c.t, RUN);

function sit(c: ActionCtx): Pose {
  const b = sin((c.t / 3.6) * TAU);
  // Hips end up at seat height (thighs level, shins vertical).
  return pose({ lean: 2 + 0.6 * b, head: 2 + nod(c, 5), legL: [86, -88], legR: [90, -90], armL: [22, 55], armR: [30, 45], stretch: breath(c.t) });
}

function wave(c: ActionCtx): Pose {
  const { t } = c;
  return pose({ lean: 1, head: 3 + nod(c, 3), armR: [158 + 4 * sin(t * TAU * 0.8), 12 * sin(t * TAU * 1.6)], armL: [4, 8], legL: [0, -2], legR: [0, -2], stretch: breath(t) });
}

function lookUp(c: ActionCtx): Pose {
  const b = sin((c.t / 4) * TAU);
  return pose({ lean: -3 + 0.8 * own(c, 13, 0.15), head: -20 + 2 * b, armL: [3, 6], armR: [-3, 6], stretch: breath(c.t) });
}

function reach(c: ActionCtx): Pose {
  const b = sin((c.t / 2.4) * TAU);
  return pose({ lean: 10 + b, head: -6, armR: [112 + 4 * b, 4 + 3 * b], armL: [-22, 14], legR: [24, -10], legL: [-16, -6], stretch: breath(c.t) });
}

// Dance moves, each a function of beats elapsed. Every move sinks on the beat and rises between beats (the groove).
type Move = (beat: number, amp: number) => Partial<Pose>;

const sway: Move = (beat, amp) => {
  const bounce = Math.abs(sin(Math.PI * beat));
  const s = sin(Math.PI * beat);
  return { y: -0.03 * bounce * amp, lean: 6 * sin((Math.PI * beat) / 2) * amp, head: 4 * s, armR: [118 + 38 * s * amp, 30], armL: [118 - 38 * s * amp, 30], legR: [10 * s, -22 * (1 - bounce)], legL: [-10 * s, -22 * bounce] };
};

const pump: Move = (beat, amp) => {
  const bounce = Math.abs(sin(Math.PI * beat));
  const s = sin(Math.PI * beat);
  const up = (x: number) => Math.max(0, x);
  return {
    y: -0.025 * bounce * amp,
    lean: 4 * s * amp,
    head: 5 * (1 - bounce),
    armR: [50 + 85 * up(s) * amp, 100 - 70 * up(s)],
    armL: [50 + 85 * up(-s) * amp, 100 - 70 * up(-s)],
    legR: [14 * s, -30 * (1 - bounce)],
    legL: [-14 * s, -30 * (1 - bounce)],
  };
};

const clap: Move = (beat, amp) => {
  const open = Math.abs(sin(Math.PI * beat));
  return { y: -0.04 * open * amp, lean: -2, head: -6 + 6 * (1 - open), armR: [160 - 28 * open * amp, 18], armL: [160 + 28 * open * amp, 18], legR: [6, -18 * (1 - open)], legL: [-4, -18 * (1 - open)] };
};

const MOVES = [sway, pump, clap];
const BAR = 4;
const BLEND_BEATS = 0.5;

const moveFor = (seed: number, bar: number) => MOVES[Math.floor(mulberry32((seed ^ Math.imul(bar + 1, 0x9e3779b1)) >>> 0)() * MOVES.length)];

/** Angle-wise blend of two poses (0 = a, 1 = b). */
export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * k;
  const limb = (x: [number, number], y: [number, number]): [number, number] => [l(x[0], y[0]), l(x[1], y[1])];
  return {
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    lean: l(a.lean, b.lean),
    head: l(a.head, b.head),
    armL: limb(a.armL, b.armL),
    armR: limb(a.armR, b.armR),
    legL: limb(a.legL, b.legL),
    legR: limb(a.legR, b.legR),
    stretch: l(a.stretch ?? 1, b.stretch ?? 1),
    hair: l(a.hair ?? 0, b.hair ?? 0),
  };
}

function dance(c: ActionCtx): Pose {
  const amp = 0.75 + 0.45 * c.energy;
  const bar = Math.floor(c.beat / BAR);
  const into = (c.beat - bar * BAR) / BLEND_BEATS;
  const moves = c.seed + 7919 * c.variant;
  const now = pose(moveFor(moves, bar)(c.beat, amp));
  // A new move for every bar, eased in from the last one so the change reads as a step, not a jump cut.
  return into >= 1 ? now : lerpPose(pose(moveFor(moves, bar - 1)(c.beat, amp)), now, smooth(into));
}

const JUMP_BEATS = 2;
const GROUND = 0.32;
const SNAP = 0.07;

/**
 * One jump every two beats, touching down on the beat: absorb the landing, hold a crouch (the anticipation), then
 * spring up. Every part is continuous through touchdown and take-off.
 */
function jump(c: ActionCtx): Pose {
  const u = frac(c.beat / JUMP_BEATS);
  if (u < GROUND) {
    // Legs fold quickly on landing, rise a touch, and straighten in a snap at take-off.
    const k = smooth(u / SNAP) * (1 - smooth((u - GROUND + SNAP) / SNAP)) * (1 - 0.2 * Math.sin((Math.PI * u) / GROUND));
    return pose({ lean: 8 * k, head: -4 * k, legR: [55 * k, -105 * k], legL: [45 * k, -95 * k], armR: [25 - 60 * k, 15 + 10 * k], armL: [25 - 53 * k, 15 + 10 * k], stretch: 1 - 0.07 * k });
  }
  const v = (u - GROUND) / (1 - GROUND);
  const air = 4 * v * (1 - v); // 0 on the ground, 1 at the apex
  const fast = Math.abs(1 - 2 * v) * smooth(v / 0.12) * smooth((1 - v) / 0.12);
  return pose({
    y: -(0.18 + 0.08 * c.energy) * air,
    lean: 2 * air,
    armR: [25 + 135 * air, 15],
    armL: [25 + 135 * air, 15],
    legR: [36 * air, -72 * air],
    legL: [20 * air, -50 * air],
    // Stretched while moving fast (after take-off and in the fall), round at the top.
    stretch: 1 + 0.06 * fast,
  });
}

function slump(c: ActionCtx): Pose {
  const b = sin((c.t / 4.2) * TAU);
  return pose({ lean: 15 + b, head: 30 + 2 * b, armL: [10, 10], armR: [2, 8], legL: [4, -10], legR: [-3, -8], stretch: 1 + 0.004 * b });
}

const ACTIONS: Record<Action, (ctx: ActionCtx) => Pose> = { idle, walk, run, sit, wave, look_up: lookUp, reach, dance, jump, slump };

// Follow-through: parts further from the body's core react a little later, so motion rolls down the arm.
const LAG_UPPER = 0.045;
const LAG_LOWER = 0.09;
const LAG_HAIR = 0.16;

const earlier = (c: ActionCtx, dt: number): ActionCtx => ({ ...c, t: c.t - dt, beat: c.beat - dt / Math.max(c.beatLen, 1e-3) });

const HAIR_STREAM: Partial<Record<Action, number>> = { walk: 5, run: 14 };

export function poseFor(action: Action, ctx: ActionCtx): Pose {
  const f = ACTIONS[action];
  const now = f(ctx);
  const upper = f(earlier(ctx, LAG_UPPER));
  const lower = f(earlier(ctx, LAG_LOWER));
  const late = f(earlier(ctx, LAG_HAIR));
  // The head keeps its angle in space a moment longer than the torso does (lean + head is the head's world angle).
  const head = upper.lean + upper.head - now.lean;
  // Hair trails the head's turn, lifts as the body falls, and streams back with speed. Positive swings it back; it
  // may only swing a little forward, or it would cross the face.
  const turn = now.lean + head - (late.lean + late.head);
  const fall = (now.y - late.y) / LAG_HAIR;
  const hair = Math.max(-10, Math.min(30, 1.3 * turn + 40 * fall + (HAIR_STREAM[action] ?? 0) + 2 * own(ctx, 14, 0.4)));
  return {
    ...now,
    head,
    armL: [upper.armL[0], lower.armL[1]],
    armR: [upper.armR[0], lower.armR[1]],
    hair,
  };
}
