// "Signaling neighborhood" background, used on every page. It animates on the
// home page only; other pages show the same cells as a still picture.
// Cells of six types, each with its own shape, drift slowly. Now and then a cell sends a signal to a
// neighbor; the pulse is colored by the pair of cell types involved, and the
// receiving cell glows and may pass the signal on. Moving the cursor releases
// a signal too: the faster it moves, the farther and brighter the signal.
// Elements named in the canvas's data-quiet attribute (the text on the page)
// are a quiet zone: the cursor sends no signals into or from them.
// Plain JavaScript with no outside libraries. It pauses when the tab is hidden
// and draws a single still frame for visitors who prefer reduced motion.
// Cells are drawn at reduced opacity so they read as a soft texture.
(function () {
  const canvas = document.getElementById("cell-bg");
  if (!canvas) return;
  // Quarto places the canvas inside the page content; move it to the start of
  // <body> so it sits behind the content instead of in front of it.
  if (canvas.parentElement !== document.body) document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const still = reduceMotion || !document.body.classList.contains("home");
  const OPACITY = 0.6;

  // Shades of blue, so every pairing still reads as one palette.
  // Each type also has its own outline: small round lymphocytes, cobblestone
  // epithelial cells, long spindle-shaped fibroblasts, ruffled macrophages,
  // star-shaped dendritic cells, and large fat cells filled by a lipid droplet.
  const TYPES = [
    { name: "T cell", rgb: [37, 99, 160], shape: "round", size: [5, 8] },
    { name: "Epithelial", rgb: [86, 168, 228], shape: "polygon", size: [8, 12] },
    { name: "Fibroblast", rgb: [104, 112, 214], shape: "spindle", size: [8, 13] },
    { name: "Macrophage", rgb: [40, 160, 170], shape: "ruffled", size: [10, 15] },
    { name: "Dendritic cell", rgb: [128, 104, 210], shape: "star", size: [10, 14] },
    { name: "Adipocyte", rgb: [62, 86, 150], shape: "adipocyte", size: [13, 18] },
  ];

  const NEIGHBOR_DIST = 150;
  const LINK_DIST = 95;

  let width = 0, height = 0, dpr = 1;
  let cells = [];
  let pulses = [];
  let running = false;
  let lastTime = 0;

  const quietSelector = canvas.dataset.quiet || "";
  let quiet = [];

  function updateQuietZones() {
    quiet = [];
    if (!quietSelector) return;
    for (const el of document.querySelectorAll(quietSelector)) {
      const r = el.getBoundingClientRect();
      quiet.push({ left: r.left - 12, top: r.top - 12, right: r.right + 12, bottom: r.bottom + 12 });
    }
  }

  function isQuiet(x, y) {
    for (const q of quiet) {
      if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return true;
    }
    return false;
  }

  const pointer = { x: -1e4, y: -1e4, lastX: 0, lastY: 0, lastT: 0, speed: 0, budget: 0, active: false };

  function rgba(rgb, a) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a.toFixed(3) + ")";
  }

  function mix(a, b) {
    return [(a[0] + b[0]) >> 1, (a[1] + b[1]) >> 1, (a[2] + b[2]) >> 1];
  }

  function makeCell() {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.04 + Math.random() * 0.08;
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    // Fixed per-cell irregularity, so no two outlines look the same.
    const jitter = [];
    for (let i = 0; i < 7; i++) jitter.push(0.85 + Math.random() * 0.3);
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: type.size[0] + Math.random() * (type.size[1] - type.size[0]),
      type: type,
      angle: angle,
      spin: (Math.random() - 0.5) * 0.0002,
      jitter: jitter,
      glow: 0,
      cooldown: Math.random() * 12000,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function resize() {
    const oldW = width || window.innerWidth;
    const oldH = height || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const target = Math.max(90, Math.min(320, Math.round((width * height) / 4000)));
    for (const c of cells) {
      c.x *= width / oldW;
      c.y *= height / oldH;
    }
    while (cells.length < target) cells.push(makeCell());
    cells.length = target;
    if (!running) draw();
  }

  function nearestNeighbor(cell, exclude) {
    let best = null, bestD = NEIGHBOR_DIST * NEIGHBOR_DIST;
    for (const other of cells) {
      if (other === cell || other === exclude) continue;
      const dx = other.x - cell.x, dy = other.y - cell.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = other; }
    }
    return best;
  }

  function sendSignal(from, to, strength, color, fromCursor) {
    pulses.push({
      fromCursor: !!fromCursor,
      from: from,
      to: to,
      t: 0,
      strength: strength,
      color: color || mix(from.type.rgb, to.type.rgb),
      // From a cursor point the pulse moves faster, so it feels responsive.
      speed: from.type ? 0.0006 : 0.0014,
    });
  }

  function emitFromPointer(strength) {
    const radius = 90 + strength * 260;
    const source = { x: pointer.x, y: pointer.y, type: null };
    const r2 = radius * radius;
    let hits = 0;
    for (const c of cells) {
      const dx = c.x - pointer.x, dy = c.y - pointer.y;
      if (dx * dx + dy * dy < r2 && Math.random() < 0.5 && !isQuiet(c.x, c.y)) {
        sendSignal(source, c, strength, c.type.rgb, true);
        if (++hits >= 2 + Math.round(strength * 4)) break;
      }
    }
  }

  function update(dt) {
    // Cells drift, wobble a little, and wrap around the edges.
    for (const c of cells) {
      c.phase += dt * 0.0003;
      c.x += (c.vx + Math.cos(c.phase) * 0.02) * dt * 0.03;
      c.y += (c.vy + Math.sin(c.phase * 1.3) * 0.02) * dt * 0.03;
      if (c.type.shape === "spindle") {
        // Fibroblasts slowly turn to point along their direction of travel.
        const heading = Math.atan2(c.vy, c.vx);
        let diff = heading - c.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        c.angle += diff * Math.min(1, dt * 0.002);
      } else {
        c.angle += c.spin * dt;
      }
      const m = 20;
      if (c.x < -m) c.x = width + m; else if (c.x > width + m) c.x = -m;
      if (c.y < -m) c.y = height + m; else if (c.y > height + m) c.y = -m;

      c.glow = Math.max(0, c.glow - dt * 0.0006);
      c.cooldown -= dt;
      if (c.cooldown <= 0) {
        c.cooldown = 8000 + Math.random() * 16000;
        const n = nearestNeighbor(c);
        if (n) sendSignal(c, n, 0.45 + Math.random() * 0.25);
      }

      // Cells drift gently away from a fast-moving cursor.
      if (pointer.active && !pointer.quiet && pointer.speed > 0.3) {
        const dx = c.x - pointer.x, dy = c.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120 && d2 > 1) {
          const push = (pointer.speed * 0.4) / Math.sqrt(d2);
          c.x += dx * push * dt * 0.01;
          c.y += dy * push * dt * 0.01;
        }
      }
    }

    // Cursor signal: strength grows with cursor speed (pixels per millisecond).
    pointer.speed *= Math.pow(0.9, dt / 16);
    if (pointer.active) {
      updateQuietZones();
      pointer.quiet = isQuiet(pointer.x, pointer.y);
    }
    if (pointer.active && !pointer.quiet && pointer.speed > 0.15) {
      const strength = Math.min(1, pointer.speed / 2.5);
      pointer.budget += dt * strength * 0.024;
      while (pointer.budget >= 1) {
        pointer.budget -= 1;
        emitFromPointer(strength);
      }
    }

    // Pulses travel along their path; on arrival the receiver lights up and
    // may relay the signal to its own nearest neighbor.
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt * p.speed;
      if (p.t >= 1) {
        p.to.glow = Math.min(1, p.to.glow + p.strength);
        if (p.strength > 0.25 && Math.random() < 0.45 * p.strength) {
          const next = nearestNeighbor(p.to, p.from.type ? p.from : null);
          // Signals started by the cursor never spread into the quiet zone.
          if (next && !(p.fromCursor && isQuiet(next.x, next.y))) {
            sendSignal(p.to, next, p.strength * 0.7, null, p.fromCursor);
          }
        }
        pulses.splice(i, 1);
      }
    }
    if (pulses.length > 160) pulses.splice(0, pulses.length - 160);
  }

  // Builds the outline of a cell around (0, 0); the caller sets position and rotation.
  function traceCell(c) {
    const r = c.r, j = c.jitter;
    ctx.beginPath();
    if (c.type.shape === "spindle") {
      // Long, tapered body with pointed ends.
      const len = r * 1.9, w = r * 0.55 * j[0];
      ctx.moveTo(-len, 0);
      ctx.bezierCurveTo(-len * 0.4, -w * 1.4, len * 0.4, -w * 1.2 * j[1], len, 0);
      ctx.bezierCurveTo(len * 0.4, w * 1.2 * j[2], -len * 0.4, w * 1.4, -len, 0);
    } else if (c.type.shape === "polygon" || c.type.shape === "adipocyte") {
      // Cobblestone with softened corners; fat cells are larger and five-sided.
      const sides = c.type.shape === "polygon" ? 6 : 5;
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        pts.push([Math.cos(a) * r * j[i], Math.sin(a) * r * j[i]]);
      }
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const start = mid(pts[sides - 1], pts[0]);
      ctx.moveTo(start[0], start[1]);
      for (let i = 0; i < sides; i++) {
        const m = mid(pts[i], pts[(i + 1) % sides]);
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
      }
    } else if (c.type.shape === "star") {
      // A small body with five long, slowly flexing arms.
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const arm = j[Math.floor(((a / (Math.PI * 2)) * 5 + 0.5)) % 5];
        const spike = Math.pow(Math.max(0, Math.cos(5 * a)), 5);
        const k = 0.5 + 0.85 * arm * spike * (1 + 0.12 * Math.sin(c.phase * 2 + a));
        const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else {
      // Round cells get a slight wobble; macrophages get slowly moving ruffles.
      const ruffled = c.type.shape === "ruffled";
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const k = ruffled
          ? 1 + 0.16 * Math.sin(3 * a + c.phase * 2 + j[0] * 6) + 0.09 * Math.sin(5 * a - c.phase * 3 + j[1] * 6)
          : 1 + 0.05 * Math.sin(4 * a + j[0] * 6);
        const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = OPACITY;

    // Faint links between close neighbors give the sense of a tissue.
    ctx.lineWidth = 1;
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK_DIST * LINK_DIST) {
          const alpha = 0.16 * (1 - Math.sqrt(d2) / LINK_DIST);
          ctx.strokeStyle = rgba(mix(a.type.rgb, b.type.rgb), alpha);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // Signals in flight: a trail from sender to receiver and a bright head.
    for (const p of pulses) {
      const x = p.from.x + (p.to.x - p.from.x) * p.t;
      const y = p.from.y + (p.to.y - p.from.y) * p.t;
      ctx.strokeStyle = rgba(p.color, 0.35 * p.strength);
      ctx.lineWidth = 1 + p.strength * 1.5;
      ctx.beginPath();
      ctx.moveTo(p.from.x, p.from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = rgba(p.color, 0.5 + 0.4 * p.strength);
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + p.strength * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cells: a soft membrane, a nucleus, and a halo when recently signaled.
    for (const c of cells) {
      const rgb = c.type.rgb;
      if (c.glow > 0.02) {
        ctx.fillStyle = rgba(rgb, 0.18 * c.glow);
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r + 4 + 10 * c.glow, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.fillStyle = rgba(rgb, 0.22 + 0.3 * c.glow);
      ctx.strokeStyle = rgba(rgb, 0.5 + 0.4 * c.glow);
      ctx.lineWidth = 1.2;
      traceCell(c);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = rgba(rgb, 0.45 + 0.4 * c.glow);
      ctx.beginPath();
      if (c.type.shape === "spindle") {
        ctx.ellipse(0, 0, c.r * 0.5, c.r * 0.22, 0, 0, Math.PI * 2);
      } else if (c.type.shape === "adipocyte") {
        // The nucleus is pushed to the edge by the lipid droplet drawn below.
        ctx.ellipse(c.r * 0.68, 0, c.r * 0.12, c.r * 0.26, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(c.r * 0.15, -c.r * 0.1, c.r * (c.type.shape === "round" ? 0.5 : 0.36), 0, Math.PI * 2);
      }
      ctx.fill();
      if (c.type.shape === "adipocyte") {
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.strokeStyle = rgba(rgb, 0.25 + 0.3 * c.glow);
        ctx.beginPath();
        ctx.arc(-c.r * 0.08, 0, c.r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(50, now - (lastTime || now));
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || still) return;
    running = true;
    lastTime = 0;
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
  }

  window.addEventListener("pointermove", function (e) {
    const now = performance.now();
    if (pointer.active) {
      const dt = Math.max(1, now - pointer.lastT);
      const dist = Math.hypot(e.clientX - pointer.lastX, e.clientY - pointer.lastY);
      pointer.speed = pointer.speed * 0.7 + (dist / dt) * 0.3;
    }
    pointer.x = pointer.lastX = e.clientX;
    pointer.y = pointer.lastY = e.clientY;
    pointer.lastT = now;
    pointer.active = true;
  }, { passive: true });

  document.addEventListener("pointerleave", function () { pointer.active = false; });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  let resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  resize();
  if (still) {
    // One still frame with a few signals frozen mid-flight.
    for (let i = 0; i < 8; i++) {
      const c = cells[Math.floor(Math.random() * cells.length)];
      const n = nearestNeighbor(c);
      if (n) { sendSignal(c, n, 0.6); pulses[pulses.length - 1].t = Math.random(); n.glow = 0.6; }
    }
    draw();
  } else {
    start();
  }
})();
