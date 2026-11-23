import { LOGO_PARTS } from "./logo-paths.js";

const SCARVES = {
  upright: { lead: [39, 82], tail: [37, 25], from: [-0.1, -1], startsAt: 0 },
  diagonal: { lead: [41, 65], tail: [72, 28], from: [0.78, -0.62], startsAt: 0.1 },
  lower: { lead: [50, 52], tail: [72, 82], from: [0.68, 0.73], startsAt: 0.2 },
};
const ARRIVED = 0.7;
const SPAN = ARRIVED - 0.2;
const TOTAL_MS = 2350;
const FADE_FROM = 0.87;

const parsed = LOGO_PARTS.map((part) => ({
  ...part,
  commands: [...part.d.matchAll(/([MLQZ])([^MLQZ]*)/g)].map(([, command, values]) => [
    command,
    (values.match(/-?\d+(?:\.\d+)?/g) || []).map(Number),
  ]),
}));

const smooth = (from, to, value) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Every point lands exactly on the logo once its scarf has arrived. */
function move(scarf, x, y, time, travel) {
  const raw = Math.min(1, Math.max(0, (time - scarf.startsAt) / SPAN));
  if (raw >= 1) return [x, y];
  const ax = scarf.tail[0] - scarf.lead[0];
  const ay = scarf.tail[1] - scarf.lead[1];
  const length = Math.hypot(ax, ay);
  const along = Math.min(1, Math.max(0, ((x - scarf.lead[0]) * ax + (y - scarf.lead[1]) * ay) / (length * length)));
  const pulled = 1 - (1 - Math.min(1, Math.max(0, (raw - along * 0.16) / 0.84))) ** 3;
  const away = (1 - pulled) * travel;
  const flutter = (1 - smooth(0.62, 1, raw)) * (0.18 + 0.82 * along) * 3.4 * Math.sin(2 * Math.PI * (1.25 * along - 2.4 * raw));
  return [x + scarf.from[0] * away - (ay / length) * flutter, y + scarf.from[1] * away + (ax / length) * flutter];
}

function draw(context, width, height, time) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  const unit = Math.min(width, height, 300 * devicePixelRatio) * 0.72 / 108;
  const travel = Math.max(width, height) / unit;
  context.translate(width / 2, height / 2);
  context.scale(unit * 0.82, unit * 0.82);
  context.translate(-54, -54);
  for (const part of parsed) {
    const scarf = SCARVES[part.scarf];
    const path = new Path2D();
    for (const [command, values] of part.commands) {
      if (command === "M") path.moveTo(...move(scarf, values[0], values[1], time, travel));
      if (command === "L") for (let i = 0; i < values.length; i += 2) path.lineTo(...move(scarf, values[i], values[i + 1], time, travel));
      if (command === "Q") {
        for (let i = 0; i < values.length; i += 4) {
          path.quadraticCurveTo(...move(scarf, values[i], values[i + 1], time, travel), ...move(scarf, values[i + 2], values[i + 3], time, travel));
        }
      }
      if (command === "Z") path.closePath();
    }
    if (part.fill) {
      context.fillStyle = part.fill;
      context.fill(path);
    }
    if (part.stroke) {
      context.strokeStyle = part.stroke;
      context.lineWidth = part.width;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke(path);
    }
  }
}

/** Plays once per visit. A tap skips it, and reduced-motion settings turn it off. */
export function playIntro() {
  const overlay = document.getElementById("intro");
  if (!overlay) return;
  if (sessionStorage.getItem("kerkida-intro") || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    overlay.remove();
    return;
  }
  sessionStorage.setItem("kerkida-intro", "1");
  const canvas = overlay.querySelector("canvas");
  const context = canvas.getContext("2d");
  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
  };
  resize();
  addEventListener("resize", resize);
  let clock = 0;
  let last = performance.now();
  let finished = false;
  // A background tab gets no animation frames, so the opening can never hold the app back.
  const safety = setTimeout(() => finish(), TOTAL_MS + 2500);
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safety);
    removeEventListener("resize", resize);
    overlay.remove();
  };
  overlay.addEventListener("pointerdown", () => { clock = Math.max(clock, FADE_FROM); });
  const frame = (now) => {
    if (finished) return;
    clock = Math.min(1, clock + Math.min(now - last, 34) / TOTAL_MS);
    last = now;
    draw(context, canvas.width, canvas.height, clock);
    const leaving = Math.max(0, (clock - FADE_FROM) / (1 - FADE_FROM));
    overlay.style.opacity = String(1 - leaving * leaving);
    canvas.style.transform = `scale(${1 + 0.05 * leaving})`;
    if (clock >= 1) finish();
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
