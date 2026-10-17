// A flat 2D figure rig. All lengths are in units of figure height; ground is y=0, up is negative y.

/** [upper, lower] segment angles in degrees. Upper is measured from "hanging straight down", positive = forward
 *  (toward the way the figure faces); lower is relative to upper (elbow: + bends forward; knee: - bends backward). */
export type Limb = [number, number];

export type Pose = {
  x: number;
  /** Vertical offset from standing on the ground (negative = up, e.g. a jump). */
  y: number;
  /** Torso rotation from vertical, + = forward. */
  lean: number;
  /** Head tilt relative to the torso, + = forward/down. */
  head: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  /** Squash and stretch about the feet: > 1 taller and thinner, < 1 squashed (volume is kept). Default 1. */
  stretch?: number;
  /** Swing of long hair relative to the head, degrees; + = back. Default 0. */
  hair?: number;
};

export type Pt = { x: number; y: number };

export const SEG = { torso: 0.3, neck: 0.035, headR: 0.062, upperArm: 0.165, foreArm: 0.155, thigh: 0.245, shin: 0.235 } as const;

export type Joints = {
  hip: Pt;
  shoulder: Pt;
  head: Pt;
  headAngle: number;
  elbowL: Pt;
  handL: Pt;
  elbowR: Pt;
  handR: Pt;
  kneeL: Pt;
  ankleL: Pt;
  kneeR: Pt;
  ankleR: Pt;
};

const rad = (d: number) => (d * Math.PI) / 180;
const down = (deg: number): Pt => ({ x: Math.sin(rad(deg)), y: Math.cos(rad(deg)) });
const up = (deg: number): Pt => ({ x: Math.sin(rad(deg)), y: -Math.cos(rad(deg)) });
const add = (a: Pt, dir: Pt, len: number): Pt => ({ x: a.x + dir.x * len, y: a.y + dir.y * len });

function chain(root: Pt, limb: Limb, upper: number, lower: number): [Pt, Pt] {
  const mid = add(root, down(limb[0]), upper);
  return [mid, add(mid, down(limb[0] + limb[1]), lower)];
}

/** Forward kinematics. The hip is placed so the lowest foot rests on the ground, then `pose.y` is applied. */
export function layout(pose: Pose): Joints {
  const origin: Pt = { x: 0, y: 0 };
  const [kneeL0, ankleL0] = chain(origin, pose.legL, SEG.thigh, SEG.shin);
  const [kneeR0, ankleR0] = chain(origin, pose.legR, SEG.thigh, SEG.shin);
  const hip: Pt = { x: pose.x, y: -Math.max(ankleL0.y, ankleR0.y) + pose.y };
  const shift = (p: Pt): Pt => ({ x: p.x + hip.x, y: p.y + hip.y });

  const shoulder = add(hip, up(pose.lean), SEG.torso);
  const headAngle = pose.lean + pose.head;
  const head = add(add(shoulder, up(headAngle), SEG.neck), up(headAngle), SEG.headR);
  const [elbowL, handL] = chain(shoulder, pose.armL, SEG.upperArm, SEG.foreArm);
  const [elbowR, handR] = chain(shoulder, pose.armR, SEG.upperArm, SEG.foreArm);

  return { hip, shoulder, head, headAngle, elbowL, handL, elbowR, handR, kneeL: shift(kneeL0), ankleL: shift(ankleL0), kneeR: shift(kneeR0), ankleR: shift(ankleR0) };
}
