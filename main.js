// Abhinav Namboori — portfolio
// One animation loop drives everything: the hero arm, the teleoperation rig,
// the server fleet, the spiral, and the marker line down the margin.
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MARK = '#E4FF3C';

  const svgEl = (parent, name, attrs = {}) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const deg = r => r * 180 / Math.PI;

  // ------------------------------------------------------------------
  // A two-joint arm. solve() is inverse kinematics: given a point, find
  // the shoulder and elbow angles that put the pen there.
  // ------------------------------------------------------------------
  class Arm {
    constructor(parent, { labels = false, cls = '' } = {}) {
      this.g = svgEl(parent, 'g', cls ? { class: cls } : {});
      this.l1 = svgEl(this.g, 'rect', { class: 'a-link', height: 14, rx: 7 });
      this.l2 = svgEl(this.g, 'rect', { class: 'a-link', height: 9, rx: 4.5 });
      this.foot = svgEl(this.g, 'path', { class: 'a-foot' });
      this.j0 = svgEl(this.g, 'circle', { class: 'a-joint', r: 12 });
      this.p0 = svgEl(this.g, 'circle', { class: 'a-pin', r: 2.5 });
      this.j1 = svgEl(this.g, 'circle', { class: 'a-joint', r: 8 });
      this.p1 = svgEl(this.g, 'circle', { class: 'a-pin', r: 2 });
      this.pen = svgEl(this.g, 'circle', { class: 'a-pen', r: 3.5 });
      if (labels) { this.t1 = svgEl(this.g, 'text', { class: 'a-ang' }); this.t2 = svgEl(this.g, 'text', { class: 'a-ang' }); }
      this.base = { x: 0, y: 0 }; this.L1 = 1; this.L2 = 1;
      this.th = -2.2; this.el = 1.6;        // shoulder angle, elbow angle (relative)
      this.tip = { x: 0, y: 0 };
    }
    place(x, y, L1, L2) {
      this.base.x = x; this.base.y = y; this.L1 = L1; this.L2 = L2;
      this.l1.setAttribute('width', L1); this.l2.setAttribute('width', L2);
      this.foot.setAttribute('d', `M${x - 30} ${y + 13} L${x - 15} ${y - 3} L${x + 15} ${y - 3} L${x + 30} ${y + 13} Z`);
    }
    // The elbow stays on one side for every target, and the arm never fully straightens or folds
    // onto its shoulder. Those are the places where a small move of the pen swings the whole arm.
    solve(tx, ty) {
      const { base, L1, L2 } = this, R = L1 + L2;
      ty = Math.min(ty, base.y - 8);
      const dx = tx - base.x, dy = ty - base.y;
      const d = clamp(Math.hypot(dx, dy), R * 0.22, R * 0.965);
      const e0 = Math.acos(clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
      let th = Math.atan2(dy, dx) + Math.atan2(L2 * Math.sin(e0), L1 + L2 * Math.cos(e0)), e = -e0;
      if (th > -0.1) {
        // the upper arm would dip under the table: rest it just above the table and aim the forearm at the target
        th = -0.1;
        e = wrap(Math.atan2(ty - (base.y + L1 * Math.sin(th)), tx - (base.x + L1 * Math.cos(th))) - th);
      }
      return { th, e };
    }
    // close a share k of the gap to the target pose, by the shorter way round, never faster than cap radians a frame
    follow(s, k, cap = Infinity) { this.th += clamp(wrap(s.th - this.th) * k, -cap, cap); this.el += clamp(wrap(s.e - this.el) * k, -cap, cap); }
    pose() {
      const { base, L1, L2, th, el } = this;
      const ex = base.x + L1 * Math.cos(th), ey = base.y + L1 * Math.sin(th);
      this.tip.x = ex + L2 * Math.cos(th + el); this.tip.y = ey + L2 * Math.sin(th + el);
      this.l1.setAttribute('transform', `translate(${base.x} ${base.y}) rotate(${deg(th)}) translate(0 -7)`);
      this.l2.setAttribute('transform', `translate(${ex} ${ey}) rotate(${deg(th + el)}) translate(0 -4.5)`);
      for (const [c, x, y] of [[this.j0, base.x, base.y], [this.p0, base.x, base.y], [this.j1, ex, ey], [this.p1, ex, ey], [this.pen, this.tip.x, this.tip.y]]) {
        c.setAttribute('cx', x); c.setAttribute('cy', y);
      }
      if (this.t1) {
        this.t1.setAttribute('x', base.x + 22); this.t1.setAttribute('y', base.y - 14);
        this.t1.textContent = `θ₁ ${Math.round(-deg(wrap(th)))}°`;
        this.t2.setAttribute('x', ex + 16); this.t2.setAttribute('y', ey - 12);
        this.t2.textContent = `θ₂ ${Math.round(deg(wrap(el)))}°`;
      }
    }
  }

  // ------------------------------------------------------------------
  // Hero: the arm underlines the name, then follows the cursor.
  // ------------------------------------------------------------------
  const hero = (() => {
    const box = $('.hero'), svg = $('.hero .arm'), cv = $('.hero .trail'), ctx = cv.getContext('2d');
    const table = svgEl(svg, 'line', { class: 'a-table' });
    const under = svgEl(svg, 'path', { class: 'under' });
    const arm = new Arm(svg, { labels: true });
    const mouse = { x: 0, y: 0, at: -1e9 };
    const hand = { x: 0, y: 0, vx: 0, vy: 0, live: false };   // where the pen is heading, eased
    let W = 0, H = 0, underLen = 0, trail = [], t0 = 0, narrow = false, prevT = 0;

    addEventListener('pointermove', e => {
      const r = box.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.at = performance.now();
    }, { passive: true });

    function layout() {
      const r = box.getBoundingClientRect();
      W = r.width; H = r.height;
      const gut = Math.max(26, innerWidth * 0.034);
      narrow = W < 820;
      const bx = W * (narrow ? 0.74 : 0.62), by = H - 30;
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      table.setAttribute('x1', gut); table.setAttribute('x2', W); table.setAttribute('y1', by + 13); table.setAttribute('y2', by + 13);
      // the stroke the arm draws beneath the surname
      const u = $('.u').getBoundingClientRect();
      const x0 = u.left - r.left + 4, x1 = u.right - r.left + 6, y = u.bottom - r.top - u.height * 0.02, w = x1 - x0;
      under.setAttribute('d', `M${x0} ${y + 3} C${x0 + w * 0.3} ${y - 5}, ${x0 + w * 0.7} ${y + 9}, ${x1} ${y - 1} c${w * 0.05} -3, ${w * 0.04} 13, ${-w * 0.06} 15 c${-w * 0.1} 3, ${-w * 0.22} 2, ${-w * 0.3} -1`);
      underLen = under.getTotalLength();
      under.style.strokeDasharray = underLen;
      // the arm is just long enough to reach the far end of that stroke. On a phone that would put it
      // across the text, so there it is small and keeps to the strip underneath.
      const reach = narrow ? Math.min(W * 0.6, H * 0.24) : Math.hypot(bx - x0, by - y) * 1.08;
      arm.place(bx, by, reach * 0.52, reach * 0.48);
      return { gut, tableY: by + 13 };
    }

    function update(now) {
      if (box.getBoundingClientRect().bottom <= 0) { prevT = 0; return; }
      if (!t0) t0 = now;
      const dt = prevT ? clamp((now - prevT) / 1000, 0, 1 / 30) : 1 / 60;   // real time, so it moves the same on any screen
      prevT = now;
      const t = now - t0, WAIT = 500, TRAVEL = 1100, DRAW = 1500;
      if (!narrow && t < WAIT + TRAVEL + DRAW && !reduce) {
        const start = under.getPointAtLength(0);
        if (t < WAIT + TRAVEL) {
          const k = ease(Math.max(0, (t - WAIT) / TRAVEL));
          const rx = arm.base.x - 150, ry = arm.base.y - 300;
          const s = arm.solve(rx + (start.x - rx) * k, ry + (start.y - ry) * k);
          arm.th = s.th; arm.el = s.e;
          under.style.strokeDashoffset = underLen;
        } else {
          const k = ease((t - WAIT - TRAVEL) / DRAW);
          const p = under.getPointAtLength(underLen * k);
          const s = arm.solve(p.x, p.y);
          arm.th = s.th; arm.el = s.e;
          under.style.strokeDashoffset = underLen * (1 - k);
        }
      } else {
        // on a phone the stroke draws itself
        under.style.strokeDashoffset = narrow && !reduce ? underLen * (1 - ease(clamp((t - WAIT) / DRAW, 0, 1))) : 0;
        let tx, ty;
        if (now - mouse.at < 5000 && !reduce) { tx = mouse.x; ty = mouse.y; }
        else {                                         // nobody is steering, so wander
          const s = reduce ? 0 : now / 1000;
          if (narrow) { const R = arm.L1 + arm.L2; tx = arm.base.x - R * 0.5 + Math.sin(s * 0.5) * R * 0.3; ty = arm.base.y - R * 0.45 + Math.sin(s + 1) * R * 0.2; }
          else { tx = W * 0.5 + Math.sin(s * 0.45) * W * 0.1; ty = H * 0.3 + Math.sin(s * 0.9 + 1) * H * 0.08; }
        }
        // a damped spring on the target, then the joints close on it: no sudden starts
        if (!hand.live) { hand.x = arm.tip.x; hand.y = arm.tip.y; hand.vx = hand.vy = 0; hand.live = true; }
        hand.vx += (100 * (tx - hand.x) - 20 * hand.vx) * dt; hand.vy += (100 * (ty - hand.y) - 20 * hand.vy) * dt;
        hand.x += hand.vx * dt; hand.y += hand.vy * dt;
        arm.follow(arm.solve(hand.x, hand.y), 1 - Math.exp(-dt / 0.06), 6 * dt);
      }
      arm.pose();

      if (!reduce && t > WAIT + TRAVEL + DRAW) {
        const last = trail[trail.length - 1];
        if (!last || Math.hypot(last.x - arm.tip.x, last.y - arm.tip.y) > 1.5) trail.push({ x: arm.tip.x, y: arm.tip.y, t: now });
      }
      while (trail.length && now - trail[0].t > 2600) trail.shift();
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = MARK;
      for (let i = 1; i < trail.length; i++) {
        ctx.globalAlpha = Math.max(0, 1 - (now - trail[i].t) / 2600) * 0.9;
        ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
      }
    }
    return { layout, update, pose: () => arm.pose(), get height() { return H; } };
  })();

  // ------------------------------------------------------------------
  // Robots: teleoperating a humanoid. The figure on the left is you, as
  // the tracker sees you. The robot copies your joints a quarter second
  // later and records the path your hands trace. "Let it try alone" turns
  // that path into one smooth lap and the robot runs it.
  // ------------------------------------------------------------------
  const rig = (() => {
    const box = $('.rig'), svg = $('.rig svg'), btn = $('#rig-toggle'), status = $('#rig-status');
    const VW = 1000, VH = 400, GROUND = 371, DELAY = 260;
    const U = 62, F = 58;                                    // upper arm, forearm
    const SH = { dx: 42, y: 142 }, REST = { dx: 30, dy: 108 };
    const tight = matchMedia('(max-width: 820px)').matches;  // on a phone the two stand closer, so they can be drawn bigger
    const YOU = tight ? 335 : 290, BOT = tight ? 665 : 710, SIDE = [-1, 1];   // arm 0 is the one on the left of the screen
    svg.setAttribute('viewBox', tight ? '165 46 670 334' : '60 30 880 372');   // crop the empty margins so the figures are drawn bigger

    const trails = SIDE.map(() => svgEl(svg, 'polyline', { class: 'data' }));
    const vb = svg.viewBox.baseVal;
    svgEl(svg, 'line', { class: 'a-table', x1: vb.x, x2: vb.x + vb.width, y1: GROUND, y2: GROUND });
    svgEl(svg, 'line', { class: 'mid', x1: VW / 2, x2: VW / 2, y1: vb.y + 8, y2: GROUND });

    // Inverse kinematics for one arm, worked out as if it were the right arm and mirrored for the
    // left. The elbow stays on the outside and the arm never quite straightens, so nothing flips.
    function reach(cx, side, tx, ty) {
      const dx = Math.max((tx - cx - side * SH.dx) * side, -24), dy = ty - SH.y;
      const d = clamp(Math.hypot(dx, dy), 34, (U + F) * 0.95);
      const e0 = Math.acos(clamp((d * d - U * U - F * F) / (2 * U * F), -1, 1));
      return { th: Math.atan2(dy, dx) + Math.atan2(F * Math.sin(e0), U + F * Math.cos(e0)), e: -e0 };
    }
    const rest = (cx, i) => [cx + SIDE[i] * (SH.dx + REST.dx), SH.y + REST.dy];
    const follow = (j, s, k) => { j.th += wrap(s.th - j.th) * k; j.el += (s.e - j.el) * k; };

    function figure(cx, robot) {
      const g = svgEl(svg, 'g', { class: robot ? 'bot' : 'human leader' });
      const f = { lean: 0, hand: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };
      f.j = SIDE.map((s, i) => { const r = reach(cx, s, ...rest(cx, i)); return { th: r.th, el: r.e }; });
      const points = i => {
        const s = SIDE[i], j = f.j[i], sx = cx + s * SH.dx, ex = sx + s * U * Math.cos(j.th), ey = SH.y + U * Math.sin(j.th);
        f.hand[i].x = ex + s * F * Math.cos(j.th + j.el); f.hand[i].y = ey + F * Math.sin(j.th + j.el);
        return [sx, SH.y, ex, ey, f.hand[i].x, f.hand[i].y];
      };
      const at = (c, x, y) => { c.setAttribute('cx', x); c.setAttribute('cy', y); };

      if (!robot) {
        // you: a line figure with a tracking marker on each joint
        const ln = (x1, y1, x2, y2) => svgEl(g, 'line', { x1, y1, x2, y2 });
        ln(cx - 14, 252, cx - 20, GROUND); ln(cx + 14, 252, cx + 20, GROUND); ln(cx - 14, 252, cx + 14, 252);
        ln(cx, 252, cx, SH.y); ln(cx - SH.dx, SH.y, cx + SH.dx, SH.y);
        const neck = ln(cx, SH.y, cx, 121), head = svgEl(g, 'circle', { class: 'head', cx, cy: 100, r: 21 });
        const arms = SIDE.map(() => svgEl(g, 'polyline', {}));
        for (const [x, y] of [[cx - 14, 252], [cx + 14, 252], [cx - 17, 312], [cx + 17, 312]]) svgEl(g, 'circle', { class: 'mk', cx: x, cy: y, r: 3.6 });
        const mk = SIDE.map(() => [0, 1, 2].map(() => svgEl(g, 'circle', { class: 'mk', r: 3.6 })));
        f.draw = () => {
          SIDE.forEach((_, i) => {
            const p = points(i);
            arms[i].setAttribute('points', `${p[0]},${p[1]} ${p[2].toFixed(1)},${p[3].toFixed(1)} ${p[4].toFixed(1)},${p[5].toFixed(1)}`);
            at(mk[i][0], p[0], p[1]); at(mk[i][1], p[2], p[3]); at(mk[i][2], p[4], p[5]);
          });
          head.setAttribute('cx', cx + f.lean * 7); neck.setAttribute('x2', cx + f.lean * 4);
        };
      } else {
        // the robot: the same skeleton, built out of the hero arm's parts
        const link = h => svgEl(g, 'rect', { class: 'a-link', height: h, rx: h / 2 });
        const put = (r, h, x1, y1, x2, y2) => {
          r.setAttribute('width', Math.hypot(x2 - x1, y2 - y1));
          r.setAttribute('transform', `translate(${x1} ${y1}) rotate(${deg(Math.atan2(y2 - y1, x2 - x1))}) translate(0 ${-h / 2})`);
        };
        for (const s of SIDE) {
          put(link(15), 15, cx + s * 15, 250, cx + s * 18, 310); put(link(12), 12, cx + s * 18, 310, cx + s * 20, 362);
          svgEl(g, 'circle', { class: 'a-joint', cx: cx + s * 18, cy: 310, r: 7 });
          const fx = cx + s * 20;
          svgEl(g, 'path', { class: 'a-foot', d: `M${fx - 17} ${GROUND} L${fx - 9} ${GROUND - 11} L${fx + 9} ${GROUND - 11} L${fx + 17} ${GROUND} Z` });
        }
        svgEl(g, 'rect', { class: 'a-joint', x: cx - 10, y: 208, width: 20, height: 22 });
        svgEl(g, 'rect', { class: 'a-joint', x: cx - 24, y: 224, width: 48, height: 34, rx: 9 });
        svgEl(g, 'rect', { class: 'a-joint', x: cx - 7, y: 112, width: 14, height: 22 });
        svgEl(g, 'rect', { class: 'a-joint', x: cx - 37, y: 126, width: 74, height: 88, rx: 13 });
        svgEl(g, 'circle', { class: 'core', cx, cy: 162, r: 8 });
        const head = svgEl(g, 'g', {});
        svgEl(head, 'rect', { class: 'a-joint', x: -20, y: -21, width: 40, height: 42, rx: 12 });
        svgEl(head, 'rect', { class: 'visor', x: -13, y: -9, width: 26, height: 9, rx: 4.5 });
        const arms = SIDE.map(() => ({
          up: link(13), fore: link(10),
          sh: svgEl(g, 'circle', { class: 'a-joint', r: 9 }), p0: svgEl(g, 'circle', { class: 'a-pin', r: 2.2 }),
          el: svgEl(g, 'circle', { class: 'a-joint', r: 6.5 }), p1: svgEl(g, 'circle', { class: 'a-pin', r: 1.8 }),
          hand: svgEl(g, 'circle', { class: 'a-pen', r: 5 }),
        }));
        f.draw = () => {
          SIDE.forEach((_, i) => {
            const p = points(i), a = arms[i];
            put(a.up, 13, p[0], p[1], p[2], p[3]); put(a.fore, 10, p[2], p[3], p[4], p[5]);
            at(a.sh, p[0], p[1]); at(a.p0, p[0], p[1]); at(a.el, p[2], p[3]); at(a.p1, p[2], p[3]); at(a.hand, p[4], p[5]);
          });
          head.setAttribute('transform', `translate(${(cx + f.lean * 5).toFixed(1)} 92) rotate(${(f.lean * 6).toFixed(1)})`);
        };
      }
      f.draw();
      return f;
    }
    const you = figure(YOU, false), bot = figure(BOT, true);
    const who = (x, text) => { const t = svgEl(svg, 'text', { class: 'who', x, y: VH - 4, 'text-anchor': 'middle' }); t.textContent = text; return t; };
    who(YOU, 'you');
    const botLabel = who(BOT, 'the robot, a quarter second behind');

    const ptr = { x: YOU, y: 150, at: -1e9 };
    const mkHands = cx => SIDE.map((_, i) => { const [x, y] = rest(cx, i); return { x, y, vx: 0, vy: 0 }; });
    const hands = mkHands(YOU), rhands = mkHands(BOT);       // your hands, eased; where the robot reaches when alone
    let visible = false, alone = false, active = 1, history = [], samples = 0, lastText = 0, prev = 0;
    let shown = [], driven = false, lap = null, dist = 0;
    const pts = [[], []];
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(box);

    // A critically damped spring: starts from rest, speeds up, slows into the target, never overshoots.
    const spring = (s, tx, ty, dt, w) => {
      s.vx += (w * w * (tx - s.x) - 2 * w * s.vx) * dt; s.vy += (w * w * (ty - s.y) - 2 * w * s.vy) * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
    };
    // One closed, smooth lap (a Catmull-Rom spline) through the hand positions the robot was shown.
    // Each point holds both hands: [left x, left y, right x, right y].
    function lapThrough(w) {
      const n = w.length, out = [], cum = [0];
      const gap = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(b[2] - a[2], b[3] - a[3]);
      for (let i = 0; i < n; i++) {
        const p0 = w[(i - 1 + n) % n], p1 = w[i], p2 = w[(i + 1) % n], p3 = w[(i + 2) % n];
        for (let k = 0; k < 12; k++) {
          const t = k / 12, t2 = t * t, t3 = t2 * t;
          out.push(p1.map((_, c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - 3 * p2[c] + p3[c] - p0[c]) * t3)));
        }
      }
      for (let i = 1; i <= out.length; i++) cum.push(cum[i - 1] + gap(out[i - 1], out[i % out.length]));
      return { out, cum, total: Math.max(1, cum[cum.length - 1]) };
    }
    function along(l, s) {
      s %= l.total;
      let i = 0; while (i < l.out.length - 1 && l.cum[i + 1] < s) i++;
      const a = l.out[i], b = l.out[(i + 1) % l.out.length], u = clamp((s - l.cum[i]) / Math.max(1e-6, l.cum[i + 1] - l.cum[i]), 0, 1);
      return a.map((v, c) => v + (b[c] - v) * u);
    }
    // how far a raised hand pulls the head over
    const leanOf = (h, cx) => SIDE.reduce((sum, s, i) => sum + s * clamp((SH.y + 50 - h[i].y) / 130, 0, 1), 0);

    svg.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect();
      ptr.x = vb.x + (e.clientX - r.left) / r.width * vb.width; ptr.y = vb.y + (e.clientY - r.top) / r.height * vb.height; ptr.at = performance.now();
      if (ptr.x > VW / 2) ptr.x -= BOT - YOU;                // pointing at the robot works too
    });
    btn.addEventListener('click', () => {
      alone = !alone;
      if (alone) {
        // too little to go on yet: fall back to a wave
        const [lx, ly] = rest(BOT, 0);
        const w = shown.length >= 4 ? shown : Array.from({ length: 12 }, (_, k) => { const a = k / 12 * 2 * Math.PI; return [lx, ly, BOT + 96 + 28 * Math.sin(a), 112 + 30 * Math.sin(2 * a)]; });
        lap = lapThrough(w); dist = 0;
        bot.hand.forEach((h, i) => { rhands[i].x = h.x; rhands[i].y = h.y; rhands[i].vx = rhands[i].vy = 0; });
      } else history = [];
      box.classList.toggle('alone', alone);
      btn.setAttribute('aria-pressed', alone);
      btn.textContent = alone ? 'Take the controls back' : 'Let it try alone';
      botLabel.textContent = alone ? 'the robot, on its own' : 'the robot, a quarter second behind';
      status.textContent = alone ? '' : 'Move inside the drawing. The figure on the left is you.';
    });

    function update(now) {
      if (!visible) { prev = 0; return; }
      const dt = prev ? clamp((now - prev) / 1000, 0, 1 / 30) : 1 / 60;    // real time, so it moves the same on any screen
      prev = now;
      const joint = 1 - Math.exp(-dt / 0.05);                              // how fast the joints close on their target

      // where your hands are
      const driving = !alone && now - ptr.at < 4000;
      if (driving) { if (ptr.x > YOU + 14) active = 1; else if (ptr.x < YOU - 14) active = 0; }
      const before = you.j[active].th + you.j[active].el;
      SIDE.forEach((s, i) => {
        let [tx, ty] = rest(YOU, i);
        if (driving && i === active) { tx = ptr.x; ty = clamp(ptr.y, 16, 330); }
        else if (!alone && !driving && i === 1) { const t = reduce ? 0 : now / 1000; tx = YOU + 96 + Math.sin(t * 0.8) * 28; ty = 112 + Math.sin(t * 1.6 + 0.6) * 30; }   // nobody driving: a slow wave
        spring(hands[i], tx, ty, dt, alone ? 5 : 12);
        follow(you.j[i], reach(YOU, s, hands[i].x, hands[i].y), joint);
      });
      you.lean += (leanOf(hands) - you.lean) * joint;
      you.draw();

      if (alone) {
        dist += 200 * dt;                                                  // a steady pace round the lap
        const g = along(lap, dist);
        SIDE.forEach((s, i) => { spring(rhands[i], g[i * 2], g[i * 2 + 1], dt, 6); follow(bot.j[i], reach(BOT, s, rhands[i].x, rhands[i].y), joint); });
        bot.lean += (leanOf(rhands) - bot.lean) * joint;
      } else {
        // copy your joints from a quarter second ago, blended between the two nearest samples
        history.push({ t: now, lean: you.lean, j: you.j.map(j => ({ th: j.th, el: j.el })) });
        while (history.length > 2 && history[1].t <= now - DELAY) history.shift();
        const a = history[0], b = history[1] || a, u = b.t > a.t ? clamp((now - DELAY - a.t) / (b.t - a.t), 0, 1) : 0;
        const k = 1 - Math.exp(-dt / 0.03);
        SIDE.forEach((_, i) => follow(bot.j[i], { th: a.j[i].th + wrap(b.j[i].th - a.j[i].th) * u, e: a.j[i].el + (b.j[i].el - a.j[i].el) * u }, k));
        bot.lean += (a.lean + (b.lean - a.lean) * u - bot.lean) * k;
        if (driving && Math.abs(you.j[active].th + you.j[active].el - before) > 0.002) samples++;
        if (now - lastText > 300 && samples) { status.textContent = `${samples.toLocaleString()} movements recorded.`; lastText = now; }
      }
      bot.draw();

      if (!alone) {
        // what the robot is shown: the path of its own hands. Your movements replace the idle wave.
        if (driving && !driven) { driven = true; shown = []; }
        if (driving || !driven) {
          const p = [bot.hand[0].x, bot.hand[0].y, bot.hand[1].x, bot.hand[1].y], l = shown[shown.length - 1];
          if (!l || Math.max(Math.hypot(l[0] - p[0], l[1] - p[1]), Math.hypot(l[2] - p[2], l[3] - p[3])) > 30) shown.push(p);
          if (shown.length > 26) shown.shift();
        }
      }

      // a fading highlighter trail behind each of the robot's hands
      SIDE.forEach((_, i) => {
        const h = bot.hand[i], q = pts[i], l = q[q.length - 1];
        if (!l || Math.hypot(l[0] - h.x, l[1] - h.y) > 3) q.push([h.x, h.y, now]);
        while (q.length && now - q[0][2] > 1500) q.shift();
        trails[i].setAttribute('points', q.length > 1 ? q.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') : '');
      });
    }
    return { update };
  })();

  // ------------------------------------------------------------------
  // Servers: 200 dots. A check sweeps across them. Take one down and the
  // next pass finds it.
  // ------------------------------------------------------------------
  const fleet = (() => {
    const box = $('.fleet'), status = $('#fleet-status'), COLS = 25, N = 200;
    const cells = [], down = new Set(), flagged = new Set();
    for (let i = 0; i < N; i++) { const d = document.createElement('i'); cells.push(d); box.appendChild(d); d.addEventListener('click', () => take(i)); }
    $('#fleet-break').addEventListener('click', () => {
      const up = cells.map((_, i) => i).filter(i => !down.has(i));
      if (up.length) take(up[Math.floor(Math.random() * up.length)]);
    });
    let visible = false, col = -1, nextAt = 0;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(box);

    const say = msg => { status.textContent = msg || `${N - down.size} of ${N} answering.`; };
    function take(i) {
      if (down.has(i)) return;
      down.add(i); cells[i].classList.add('down'); say();
      if (reduce) flag(i);
    }
    function flag(i) {
      flagged.add(i); cells[i].classList.add('flag');
      say(`Server ${i + 1} stopped answering. The check caught it.`);
      setTimeout(() => {
        down.delete(i); flagged.delete(i); cells[i].classList.remove('down', 'flag');
        say(`Server ${i + 1} is back. ${N - down.size} of ${N} answering.`);
      }, 1700);
    }
    const paint = (c, on) => { if (c >= 0 && c < COLS) for (let r = 0; r < N / COLS; r++) cells[r * COLS + c].classList.toggle('scan', on); };

    function update(now) {
      if (!visible || reduce || now < nextAt) return;
      paint(col, false);
      col++;
      if (col >= COLS) { col = -1; nextAt = now + 1300; return; }
      paint(col, true);
      for (let r = 0; r < N / COLS; r++) { const i = r * COLS + col; if (down.has(i) && !flagged.has(i)) flag(i); }
      nextAt = now + 62;
    }
    return { update };
  })();

  // ------------------------------------------------------------------
  // Hêrte: a spiral that draws itself as you read, from the centre out.
  // ------------------------------------------------------------------
  const spiral = (() => {
    const grid = $('.herte-grid'), path = $('.spiral .turn'), glow = $('.spiral .glow'), tip = $('.spiral .tip'), title = $('.herte-title');
    const TURNS = 5.5, max = TURNS * Math.PI * 2;
    let d = '';
    for (let a = 0; a <= max; a += 0.05) {
      const r = 6 + 284 * (a / max);
      d += (a === 0 ? 'M' : 'L') + (300 + r * Math.cos(a - Math.PI / 2)).toFixed(1) + ' ' + (300 + r * Math.sin(a - Math.PI / 2)).toFixed(1);
    }
    path.setAttribute('d', d);
    const len = path.getTotalLength();
    path.style.strokeDasharray = len;
    let p = 0;
    new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { title.classList.add('on'); io.disconnect(); } }, { threshold: 0.6 }).observe(title);

    function update() {
      const r = grid.getBoundingClientRect(), vh = innerHeight;
      if (r.bottom < -100 || r.top > vh + 100) return;
      const target = clamp((vh * 0.8 - r.top) / (r.height + vh * 0.1), 0, 1);
      p = reduce ? target : p + (target - p) * 0.1;
      path.style.strokeDashoffset = len * (1 - p);
      const pt = path.getPointAtLength(len * p);
      for (const c of [glow, tip]) { c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); }
    }
    return { update };
  })();

  // ------------------------------------------------------------------
  // The marker line down the margin. It starts at the hero's table edge
  // and ends by underlining the email address.
  // ------------------------------------------------------------------
  const spine = (() => {
    const main = $('main'), path = $('.spine path');
    let cum = [], ymax = [], total = 0, drawn = 0;
    function build(gut, startY) {
      const mr = main.getBoundingClientRect();
      const m = $('.mail').getBoundingClientRect();
      const endY = m.bottom - mr.top + 10, endX = m.right - mr.left + 12;
      const wob = y => gut + Math.sin(y * 0.011) * 2.4 + Math.sin(y * 0.031) * 1.1;
      const pts = [[gut, startY]];
      for (let y = startY + 6; y < endY - 24; y += 6) pts.push([wob(y), y]);
      const lx = pts[pts.length - 1][0];
      for (let k = 1; k <= 10; k++) { const a = Math.PI - k / 10 * Math.PI / 2; pts.push([lx + 24 + 24 * Math.cos(a), endY - 24 + 24 * Math.sin(a)]); }
      for (let x = lx + 32; x < endX; x += 8) pts.push([x, endY + Math.sin(x * 0.02) * 1.6]);
      pts.push([endX, endY]);
      cum = [0]; ymax = [pts[0][1]];
      for (let i = 1; i < pts.length; i++) {
        cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        ymax[i] = Math.max(ymax[i - 1], pts[i][1]);
      }
      total = cum[cum.length - 1];
      path.setAttribute('d', 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'));
      path.style.strokeDasharray = total;
    }
    function update() {
      let target;
      if (scrollY >= document.documentElement.scrollHeight - innerHeight - 3) target = total;
      else {
        const y = scrollY + innerHeight * 0.74;
        let lo = 0, hi = ymax.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ymax[mid] <= y) lo = mid; else hi = mid - 1; }
        target = ymax[0] > y ? 0 : cum[lo];
      }
      drawn = reduce ? target : drawn + (target - drawn) * 0.12;
      path.style.strokeDashoffset = Math.max(0, total - drawn);
    }
    return { build, update };
  })();

  // ------------------------------------------------------------------
  // Hêrte, the rest: each answer's line is highlighted as it comes into
  // view, one paragraph inks in word by word, and fifteen empty spines
  // stand up on a shelf.
  // ------------------------------------------------------------------
  const herte = (() => {
    const once = (el, opts, fn) => new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { fn(); io.disconnect(); } }, opts).observe(el);
    for (const li of document.querySelectorAll('.answers li')) once(li, { threshold: 0.7 }, () => li.classList.add('on'));

    const shelf = $('.shelf');
    if (shelf) {
      const H = [118, 132, 104, 140, 124, 112, 136, 98, 128, 142, 108, 122, 134, 116, 126], W = [24, 30, 20, 27, 22, 29, 21, 26, 31, 19, 25, 28, 21, 30, 23];
      H.forEach((h, i) => {
        const b = document.createElement('i');
        b.style.cssText = `--h:${h}px;--w:${W[i]}px;--i:${i}` + (i === 14 ? ';--tilt:-9deg;margin-left:16px;transform-origin:100% 100%' : '');
        shelf.appendChild(b);
      });
      once(shelf, { threshold: 0.5 }, () => shelf.classList.add('on'));
    }

    // "reality is a sentence that is still being spoken"
    const para = $('.spoken');
    let words = [], said = -1;
    if (para && !reduce) {
      const text = para.textContent.trim().split(/\s+/);
      para.textContent = '';
      text.forEach((w, i) => { const s = document.createElement('span'); s.textContent = w; para.append(s, i < text.length - 1 ? ' ' : ''); words.push(s); });
      para.classList.add('live');
    }
    function update() {
      if (!words.length) return;
      const r = para.getBoundingClientRect(), vh = innerHeight;
      if (r.bottom < -200 || r.top > vh + 200) return;
      const n = Math.round(clamp((vh * 0.86 - r.top) / (r.height + vh * 0.3), 0, 1) * words.length);
      if (n === said) return;
      words.forEach((s, i) => { s.classList.toggle('said', i < n); s.classList.toggle('tip', i === n - 1 && n < words.length); });
      said = n;
    }
    return { update };
  })();

  // ------------------------------------------------------------------
  // Listening: a row of sleeves per genre, dealt onto the page as the row
  // scrolls into view. Hover one to read it, click or tab to pick it up.
  // ------------------------------------------------------------------
  const decks = (() => {
    const narrow = matchMedia('(max-width: 820px)');
    const all = [...document.querySelectorAll('.deck')].map(list => {
      const items = [...list.children], now = list.parentElement.querySelector('.now'), title = now.querySelector('.now-t'), artist = now.querySelector('.now-a');
      let sel = items.find(li => li.classList.contains('sel')) || items[0], shown = sel, P = 1;

      function show(li) {
        if (li === shown) return;
        shown = li;
        const d = li.firstElementChild.dataset;
        title.textContent = d.title;
        if (d.lang) title.lang = d.lang; else title.removeAttribute('lang');
        artist.textContent = d.artist;
        if (d.artistJa) { const s = document.createElement('span'); s.lang = 'ja'; s.textContent = ' ' + d.artistJa; artist.append(s); }
        now.classList.remove('swap'); void now.offsetWidth; now.classList.add('swap');   // restart the caption's entrance
      }
      function select(li) {
        if (li !== sel) {
          sel.classList.remove('sel'); sel.firstElementChild.setAttribute('aria-pressed', 'false');
          sel = li;
          sel.classList.add('sel'); sel.firstElementChild.setAttribute('aria-pressed', 'true');
        }
        show(li);
      }
      for (const li of items) {
        const b = li.firstElementChild;
        b.addEventListener('click', () => select(li));
        b.addEventListener('focus', () => show(li));
        li.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(li); });
      }
      list.addEventListener('pointerleave', () => show(sel));
      list.addEventListener('focusout', () => show(sel));
      // on a phone each row is a strip you swipe; the sleeve in the middle is the one picked up
      const io = new IntersectionObserver(es => {
        if (!narrow.matches) return;
        for (const e of es) if (e.isIntersecting) select(e.target);
      }, { root: list, threshold: 0.8 });
      items.forEach(li => io.observe(li));

      const deal = p => items.forEach((li, i) => {
        const q = clamp((p - i * 0.5 / Math.max(1, items.length - 1)) / 0.5, 0, 1);   // each sleeve starts a little after the last
        li.style.setProperty('--p', (1 - Math.pow(1 - q, 3)).toFixed(4));
      });
      if (!reduce && !narrow.matches) { P = 0; deal(0); }

      return dt => {
        const r = list.getBoundingClientRect(), vh = innerHeight;
        const target = reduce || narrow.matches ? 1 : clamp((vh * 0.98 - r.top) / (vh * 0.38), 0, 1);
        if (P === target) return;
        P = Math.abs(target - P) < 0.001 ? target : P + (target - P) * (1 - Math.exp(-dt / 0.16));
        deal(P);
      };
    });
    let last = 0;
    function update(t) {
      const dt = last ? clamp((t - last) / 1000, 0, 0.1) : 1 / 60;
      last = t;
      for (const step of all) step(dt);
    }
    return { update };
  })();

  // ------------------------------------------------------------------
  function layout() { const { gut, tableY } = hero.layout(); spine.build(gut, tableY - 4); hero.pose(); }
  function frame(now) {
    hero.update(now); rig.update(now); fleet.update(now); spiral.update(); herte.update(); decks.update(now); spine.update();
    requestAnimationFrame(frame);
  }
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 120); });
  addEventListener('load', layout);                      // images change the page height
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { layout(); requestAnimationFrame(frame); });
})();
