// Test shot for the "UI walkthrough + 3D cursors" style (skill: scene-ui-cursor-walkthrough).
// Original copy and a fictional product; timings follow the measured grammar:
// dead-still holds, 7-frame expo-out moves, pull-out reveals, cursor hops 10–18 frames.
import * as THREE from "three";
import { HUE, TINT, agentCursor, browserWindow, handCursor, label, roundedRect, softShadow, type Background } from "./kit";
import { arc, backOut, clamp01, keys, span } from "./timing";

export const UI_FRAMES = 228;

const PROMPT = "Plan our launch week";

export function buildUiScene(bg: Background) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#c9cdd6", 2.2));
  const key = new THREE.DirectionalLight("#ffffff", 1.6);
  key.position.set(2, 3, 4);
  scene.add(key);

  // ---- window with the ask box
  const W = 1.25, H = 0.78;
  const win = browserWindow(W, H, "New Tab");
  scene.add(win);
  const title = label("Ask Northwind", 0.045, HUE.ink, 600, "center");
  title.position.set(0, 0.09, 0.003);
  win.add(title);
  const box = new THREE.Group();
  box.position.set(0, -0.04, 0.003);
  const inner = roundedRect(0.616, 0.146, 0.029, "#F7F7F9");
  inner.position.z = 0.0005; // three's position is read-only: set it, don't assign it
  box.add(softShadow(0.62, 0.15, 0.03, 0.08), roundedRect(0.62, 0.15, 0.03, "#FFFFFF"), inner);
  win.add(box);
  const typed = label("", 0.03, HUE.ink, 500, "left");
  typed.position.set(-0.28, 0.025, 0.002);
  box.add(typed);
  const plus = label("+", 0.04, "#3A3A3C", 500, "center");
  plus.position.set(-0.27, -0.035, 0.002);
  box.add(plus);
  const send = new THREE.Mesh(new THREE.CircleGeometry(0.022, 32), new THREE.MeshBasicMaterial({ color: HUE.sky }));
  send.position.set(0.27, -0.035, 0.002);
  box.add(send);
  const caret = new THREE.Mesh(new THREE.PlaneGeometry(0.0025, 0.034), new THREE.MeshBasicMaterial({ color: HUE.ink }));
  box.add(caret);

  // ---- task card stack (front card types, agent clicks Send, next card comes forward)
  const stack = new THREE.Group();
  stack.position.set(0.0, -0.02, 0.02);
  scene.add(stack);
  const people = ["Kai Morgan · Partnerships", "Ines Duarte · Press", "Tomás Reyes · Community"];
  const cards = people.map((p, i) => {
    const c = new THREE.Group();
    c.add(softShadow(0.56, 0.36, 0.025), roundedRect(0.56, 0.36, 0.025, "#FFFFFF"));
    const avatar = new THREE.Mesh(new THREE.CircleGeometry(0.035, 32), new THREE.MeshBasicMaterial({ color: ["#E8C5A8", "#C9B4E8", "#B7D8C0"][i] }));
    avatar.position.set(-0.22, 0.12, 0.001);
    const name = label(p, 0.022, HUE.ink, 600, "left");
    name.position.set(-0.17, 0.12, 0.001);
    const field = roundedRect(0.5, 0.14, 0.015, "#F3F3F5");
    field.position.set(0, -0.0, 0.001);
    const msg = label("", 0.018, "#3A3A3C", 500, "left");
    msg.maxWidth = 0.46;
    msg.position.set(-0.23, 0.035, 0.002);
    const btn = roundedRect(0.1, 0.04, 0.02, "#2F6FDB");
    btn.position.set(0.19, -0.13, 0.001);
    const bl = label("Send", 0.017, "#FFFFFF", 600, "center");
    bl.position.set(0.19, -0.13, 0.002);
    c.add(avatar, name, field, msg, btn, bl);
    stack.add(c);
    return { c, msg, btn };
  });

  // ---- calendar result
  const cal = browserWindow(1.3, 0.8, "Calendar");
  cal.position.set(0, 0, -0.01);
  scene.add(cal);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  days.forEach((d, i) => {
    const t = label(d, 0.022, "#6E6E73", 600, "center");
    t.position.set(-0.46 + i * 0.23, 0.27, 0.002);
    cal.add(t);
  });
  const slots: { m: THREE.Mesh; at: number; agent: 0 | 1 }[] = [];
  const plan: [number, number, string, 0 | 1][] = [
    [0, 0.14, "Kickoff", 0], [1, 0.05, "Press call", 1], [2, 0.16, "Demo prep", 0], [3, -0.02, "Partner sync", 1], [4, 0.1, "Launch!", 0], [1, -0.15, "Podcast", 1],
  ];
  plan.forEach(([d, y, txt, agent], i) => {
    const m = roundedRect(0.2, 0.1, 0.012, agent === 0 ? "#CFE0F7" : "#FBD5CA");
    m.position.set(-0.46 + d * 0.23, y, 0.002);
    const t = label(txt, 0.018, agent === 0 ? "#1F4E8C" : "#9A3B22", 600, "left");
    t.position.set(-0.088, 0.02, 0.001);
    m.add(t);
    cal.add(m);
    slots.push({ m, at: 182 + i * 6, agent });
  });

  // ---- cursors
  const hand = handCursor(0.075);
  hand.position.z = 0.05;
  const agentA = agentCursor(HUE.sky, 0.048);
  const agentB = agentCursor(HUE.coral, 0.048);
  agentA.position.z = agentB.position.z = 0.08;
  scene.add(hand, agentA, agentB);

  const cam = new THREE.PerspectiveCamera(20, 16 / 9, 0.01, 50);
  const D = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(10)));
  const setCam = (zoom: number, x: number, y: number) => {
    cam.position.set(x, y, D / zoom);
    cam.lookAt(x, y, 0);
  };

  return {
    scene,
    camera: cam,
    update(f: number) {
      bg.set(f < 80 ? TINT.white : TINT.blue, f < 80 ? TINT.white : "#EAF1F4");

      // U1 window establish (scale 0.94 → 1, 10 f)
      const s = 0.94 + 0.06 * span(f, 0, 10, backOut);
      win.scale.setScalar(s);
      win.visible = f < 80;

      // U2 macro push to the ask box (7 f), type, click, pull out
      const zoom = keys(f, [[24, 1], [31, 2.2], [72, 2.2], [79, 1.0], [168, 1.0], [175, 0.86], [228, 0.86]]);
      const cx = keys(f, [[24, 0], [31, -0.0], [72, 0], [79, 0]]);
      const cy = keys(f, [[24, 0], [31, -0.04], [72, -0.04], [79, 0]]);
      setCam(zoom, cx, cy);

      const chars = Math.floor(clamp01((f - 34) / 26) * PROMPT.length);
      if (typed.text !== PROMPT.slice(0, chars)) {
        typed.text = PROMPT.slice(0, chars);
        typed.sync();
      }
      caret.position.set(-0.28 + chars * 0.0155, 0.025, 0.003);
      caret.visible = f >= 30 && f < 72 && Math.floor(f / 12) % 2 === 0;
      const pressed = f >= 68 && f < 71;
      send.scale.setScalar(pressed ? 0.85 : 1);

      // hand cursor: enters 12 f before the click, rests, clicks at 68, leaves
      const handPath = arc(span(f, 50, 62), [0.5, -0.35], [0.27, -0.075], 0.15);
      const handOut = arc(span(f, 74, 84), [0.27, -0.075], [0.7, -0.5], -0.1);
      const hp = f < 74 ? handPath : handOut;
      hand.position.set(hp[0], hp[1], 0.05);
      hand.scale.setScalar(pressed ? 0.85 : 1);
      hand.visible = f >= 50 && f < 84;

      // U3/U4 card stack: pops in staggered, front card types, agent clicks Send, card leaves
      stack.visible = f >= 80 && f < 172;
      cards.forEach(({ c, msg, btn }, i) => {
        const appear = backOut(clamp01((f - 82 - i * 3) / 7));
        const leaveAt = 128 + i * 26; // each card leaves after its Send click
        const leave = span(f, leaveAt, leaveAt + 8);
        const depth = Math.max(0, i - Math.floor(clamp01((f - 128) / 26) * 3 + 1e-6));
        const behind = Math.min(depth, 2);
        c.position.set(behind * 0.025, -behind * 0.02 - leave * 0.6, -behind * 0.01);
        c.rotation.z = behind * 0.035 * (i % 2 ? -1 : 1);
        c.scale.setScalar(0.92 + 0.08 * appear);
        c.visible = appear > 0.01 && leave < 0.999;
        c.renderOrder = 10 - behind;
        const typeStart = 96 + i * 26;
        const text = `Hi! We launch Friday and would love you there. Want an early look?`;
        const n = Math.floor(clamp01((f - typeStart) / 22) * text.length);
        if (msg.text.length !== n) {
          msg.text = text.slice(0, n);
          msg.sync();
        }
        btn.scale.setScalar(f >= leaveAt - 4 && f < leaveAt - 1 ? 0.85 : 1);
      });

      // agent A: arrives from off-frame (14 f arc), then hops to each card's Send button
      let a: [number, number] = [0.9, 0.4];
      if (f >= 84) a = arc(span(f, 84, 98), [0.9, 0.4], [0.24, -0.12], 0.2);
      for (let i = 0; i < 3; i++) {
        const leaveAt = 128 + i * 26;
        if (f >= leaveAt - 16) a = arc(span(f, leaveAt - 16, leaveAt - 4), [0.24 + (i ? 0.02 : 0), -0.12], [0.2, -0.15], 0.2);
      }
      // calendar: agents A and B tap each new slot as it pops
      cal.visible = f >= 168;
      const calScale = 0.94 + 0.06 * span(f, 168, 176, backOut);
      cal.scale.setScalar(calScale);
      let b: [number, number] = [-0.9, -0.5];
      for (const sl of slots) {
        const pop = backOut(clamp01((f - sl.at) / 7));
        sl.m.scale.setScalar(Math.max(0.0001, pop));
        const target: [number, number] = [sl.m.position.x * calScale + 0.05, sl.m.position.y * calScale - 0.02];
        if (f >= sl.at - 12) {
          const u = span(f, sl.at - 12, sl.at - 1);
          if (sl.agent === 0) a = arc(u, a, target, 0.18);
          else b = arc(u, b, target, -0.18);
        }
      }
      agentA.position.set(a[0], a[1], 0.08);
      agentB.position.set(b[0], b[1], 0.08);
      agentA.visible = f >= 84;
      agentB.visible = f >= 170;
    },
  };
}
