// Deterministic animation: one paused GSAP timeline + frame-exact effects, driven by window.__seek(t).
// window.CUES (video/cues.json) and window.LEVELS (soundtrack analysis) are injected by the renderer.
window.__ready = (async () => {
  const fontsToLoad = ['700 100px "Cabinet Grotesk"', '400 40px "DM Sans"', '500 40px "DM Sans"', '600 40px "DM Sans"', '700 40px "DM Sans"',
    '900 20px "DM Sans"', 'italic 400 40px "DM Sans"', '600 50px Inter', '400 26px "Fragment Mono"'];
  await Promise.all(fontsToLoad.map((f) => document.fonts.load(f)));
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
  const C = window.CUES;
  const LV = window.LEVELS || { fps: 60, bands: [], kicks: [], claps: [] };
  gsap.registerPlugin(SplitText, CustomEase);
  gsap.config({ force3D: false });

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const tl = gsap.timeline({ paused: true });
  const POP = "back.out(2.2)";
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  const pop = (el, t, { from = 0, dur = 0.5, ease = POP, ...rest } = {}) =>
    tl.fromTo(el, { scale: from, autoAlpha: 0, ...rest.fromVars }, { scale: 1, autoAlpha: 1, duration: dur, ease, ...rest.toVars }, t);
  const out = (el, t, dur = 0.15) => tl.to(el, { scale: 0.85, autoAlpha: 0, duration: dur, ease: "power2.in" }, t);
  const rise = (targets, t, { stagger = 0.04, dur = 0.55, ease = "power4.out" } = {}) =>
    tl.fromTo(targets, { yPercent: 115 }, { yPercent: 0, duration: dur, ease, stagger }, t);
  const words = (el) => new SplitText(el, { type: "words", mask: "words" }).words;
  const chars = (el) => new SplitText(el, { type: "chars,words", mask: "words" }).chars;
  const showScene = (sel, t) => tl.set(sel, { visibility: "visible" }, t);
  const hideScene = (sel, t) => tl.set(sel, { visibility: "hidden" }, t);
  const impacts = [];
  const slam = (el, t, { fromScale = 2.3, rot0 = -16, rot1 = -5, shake = 7 } = {}) => {
    tl.fromTo(el, { scale: fromScale, rotate: rot0, autoAlpha: 0 }, { scale: 1, rotate: rot1, autoAlpha: 1, duration: 0.28, ease: "power4.in" }, t - 0.28);
    tl.fromTo(el, { scaleX: 1.07, scaleY: 0.9 }, { scaleX: 1, scaleY: 1, duration: 0.6, ease: "elastic.out(1, 0.35)", immediateRender: false }, t);
    impacts.push([t, shake]);
  };
  const burst = (container, t, n = 10, dist = 320, ys = 0.7) => {
    const srcs = ["sparkle-single.svg", "sparkle-burst-pink.svg", "sparkle-single-small.svg"];
    for (let i = 0; i < n; i++) {
      const img = document.createElement("img");
      img.src = `../assets/doodles/${srcs[i % 3]}`;
      container.appendChild(img);
      const a = (i / n) * Math.PI * 2 + 0.3;
      const d = dist * (0.8 + 0.4 * ((i * 7) % 5) / 4);
      tl.fromTo(img, { x: 0, y: 0, scale: 0, rotate: 0, autoAlpha: 1 },
        { x: Math.cos(a) * d, y: Math.sin(a) * d * ys, scale: 1.1, rotate: 140, duration: 0.75, ease: "expo.out" }, t);
      tl.to(img, { scale: 0, autoAlpha: 0, duration: 0.35, ease: "power2.in" }, t + 0.55);
    }
  };

  // ------------------------------------------------------------------ build the toolkit cards from the real stack
  const GROUPS = [
    { title: "Languages", icon: "service-fullstack-browser", bg: "--sky",
      items: [["python", "Python"], ["javascript", "JavaScript"], ["go", "Go"], ["java", "Java"], ["c", "C"], ["cplusplus", "C++"], ["csharp", "C#"], ["html5", "HTML"], ["powershell", "PowerShell"]] },
    { title: "AI & Data", icon: "service-ai-puzzle", bg: "--pink",
      items: [["pytorch", "PyTorch"], ["numpy", "NumPy"], ["pandas", "Pandas"], ["milvus", "Milvus"]] },
    { title: "Backend", icon: "service-reverse-engineering-monitor", bg: "--mint",
      items: [["spring", "Spring"], ["dotnet", ".NET"], ["firebase", "Firebase"], ["mongodb", "MongoDB"], ["mysql", "MySQL"], ["docker", "Docker"], ["postman", "Postman"], ["yarn", "Yarn"]] },
    { title: "Design", icon: "process-palette", bg: "--peach",
      items: [["figma", "Figma"], ["framer", "Framer"], ["photoshop", "Photoshop"], ["illustrator", "Illustrator"], ["canva", "Canva"]] },
  ];
  GROUPS.forEach((g, i) => { if (g.items.length !== C.groupSizes[i]) throw new Error(`cues.groupSizes[${i}] must be ${g.items.length}`); });
  const groupsEl = $("#s7 .groups");
  for (const g of GROUPS) {
    const card = document.createElement("div");
    card.className = "group stacked";
    card.style.background = `var(${g.bg})`;
    card.innerHTML = `<div class="group-head"><div class="icon"><img src="../assets/icons/${g.icon}.svg"></div><h3>${g.title.replace("&", "&amp;")}</h3><div class="count">${g.items.length}</div></div>
      <div class="logos">${g.items.map(([slug, name]) => `<div class="logo"><div class="tile stacked"><img src="../assets/tech-logos/mono/${slug}.svg"></div><span>${name}</span></div>`).join("")}</div>`;
    groupsEl.appendChild(card);
  }
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));

  // ------------------------------------------------------------------ slow cinematic push-in: each scene's content sits in a .push layer
  for (const s of $$(".scene")) {
    if (s.id === "s1") continue; // the intro has its own zoom
    const p = document.createElement("div");
    p.className = "push";
    while (s.firstChild) p.appendChild(s.firstChild);
    s.appendChild(p);
  }
  const PUSH = { s2: [C.zoom, C.toS3 + 0.46], s3: [C.toS3, C.s4], s4: [C.toS4, C.toS5 + 0.37], s5: [C.toS5, C.climax],
    s6: [C.toS6, C.toS7 + 0.46], s7: [C.toS7, C.toS8 + 0.46], s8: [C.toS8, C.duration] };
  const PUSH_AMT = 0.03;

  // measure layout first, before any tween applies offsets
  const meRect = $("#s5 .me").getBoundingClientRect();
  const nm8 = $("#s8 .end .nm").getBoundingClientRect();
  const nm2 = $("#s2 .nm").getBoundingClientRect();

  // ------------------------------------------------------------------ 1 · intro (0 – 5)
  const catWrap1 = $("#s1 .cat-wrap"), cat1 = $("#s1 .cat");
  tl.fromTo("#s1 .d-pop", { scale: 0.55, rotate: -22 }, { scale: 1, rotate: 0, duration: 0.8, ease: "elastic.out(1, 0.5)", stagger: 0.06 }, 0);
  tl.fromTo("#s1 .cat-circle", { scale: 0 }, { scale: 1, duration: 0.9, ease: "elastic.out(1, 0.55)" }, C.catPop - 0.04);
  tl.fromTo(catWrap1, { y: 90, scale: 0.35, rotate: -14, autoAlpha: 0 }, { y: 0, scale: 1, rotate: 0, autoAlpha: 1, duration: 0.62, ease: "back.out(1.7)" }, C.catPop);
  tl.to(cat1, { scaleY: 1.12, scaleX: 0.93, duration: 0.11, ease: "power2.out" }, C.meow1);
  tl.to(cat1, { scaleY: 1, scaleX: 1, duration: 0.6, ease: "elastic.out(1, 0.35)" }, C.meow1 + 0.11);
  pop("#s1 .meow-label", C.meow1 + 0.04, { dur: 0.45, fromVars: { rotate: -40 }, toVars: { rotate: -12 } });
  out("#s1 .meow-label", C.bubble1 + 0.6, 0.2);
  tl.fromTo("#s1 .glint", { scale: 0, rotate: -60, autoAlpha: 1 }, { scale: 1.25, rotate: 20, duration: 0.16, ease: "power2.out" }, C.glint - 0.04);
  tl.to("#s1 .glint", { scale: 0, rotate: 90, duration: 0.3, ease: "power2.in" }, C.glint + 0.14);
  pop("#s1 .pill", C.bubble1 - 0.1, { dur: 0.45 });
  pop("#s1 .b1", C.bubble1 - 0.06, { from: 0.3, dur: 0.5, fromVars: { rotate: -6 }, toVars: { rotate: 0 } });
  out("#s1 .b1", C.bubble2 - 0.1, 0.1);
  pop("#s1 .b2", C.bubble2 - 0.04, { from: 0.3, dur: 0.5, fromVars: { rotate: -6 }, toVars: { rotate: 0 } });
  tl.to(cat1, { rotate: -7, duration: 0.25, ease: "power2.inOut" }, C.bubble2 + 0.1);
  tl.to(cat1, { rotate: 0, duration: 0.5, ease: "elastic.out(1, 0.4)" }, C.bubble2 + 0.4);
  out("#s1 .b2", C.zoom - 0.25, 0.15);
  out("#s1 .pill", C.zoom - 0.25, 0.15);
  tl.to("#s1 .cat-circle", { scale: 0, duration: 0.28, ease: "back.in(1.6)" }, C.zoom - 0.25);
  tl.to("#s1 .d-pop", { scale: 0, duration: 0.22, ease: "power2.in", stagger: 0.03 }, C.zoom - 0.3);
  // anticipation, then fly into the cat: its silhouette opens onto Jeet's face in the hero photo
  const zoomStart = C.zoom + 0.08, zoomEnd = C.drop + 0.02;
  const FACE = { x: 1460, y: 345 };
  tl.to(catWrap1, { scale: 0.88, duration: zoomStart - C.zoom, ease: "power2.out" }, C.zoom);
  tl.to(catWrap1, { x: FACE.x - 771, y: FACE.y - 548, duration: 0.3, ease: "power2.inOut" }, zoomStart);
  tl.to(catWrap1, { scale: 24, duration: zoomEnd - zoomStart, ease: "expo.in" }, zoomStart);
  tl.fromTo("#s2o", { opacity: 0 }, { opacity: 1, duration: 0.14, ease: "none" }, zoomStart + 0.1);
  showScene("#s2", zoomStart);
  hideScene("#s1", zoomEnd);

  // ------------------------------------------------------------------ 2 · hero (5 – 11)
  gsap.set("#s2 .arch img", { xPercent: -50 });
  gsap.set("#s2 .underline", { left: nm2.left - 6, top: nm2.bottom - 10, width: nm2.width + 16 });
  const hb = zoomStart + 0.2;
  tl.fromTo("#s2 .arch img", { y: 60, scale: 0.96 }, { y: 0, scale: 1, duration: 0.7, ease: "back.out(2)", transformOrigin: "50% 100%" }, C.drop - 0.02);
  pop("#s2 .badge", C.drop + 0.1, { dur: 0.7, ease: "back.out(1.6)", fromVars: { rotate: -140 }, toVars: { rotate: 0 } });
  pop("#s2 .pop-late", C.drop + 0.25, { dur: 0.5 });
  tl.fromTo("#s2 .waves", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.55, ease: "power2.inOut" }, C.drop + 0.45);
  pop("#s2 .pill", hb + 0.1, { dur: 0.45 });
  rise(chars($("#s2 .title")), hb + 0.16, { stagger: 0.02, dur: 0.6 });
  impacts.push([C.drop, 9]);
  tl.fromTo("#s2 .underline", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.45, ease: "power2.inOut" }, C.underline);
  [["tag1", C.tag1], ["tag2", C.tag2], ["tag3", C.tag3]].forEach(([k, t]) => {
    rise(words($(`#s2 .${k}`)), t - 0.08, { stagger: 0.06, dur: 0.5 });
    tl.fromTo(`#s2 .${k} .hl`, { "--hx": 0 }, { "--hx": 1, duration: 0.32, ease: "power2.inOut" }, t + 0.16);
  });
  tl.fromTo("#s2 .subtitle > span", { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.07, ease: "power3.out" }, C.subtitle - 0.06);
  showScene("#s3", C.toS3);
  tl.to("#s2", { y: -1080, duration: 0.45, ease: "power3.inOut" }, C.toS3);
  tl.fromTo("#s3", { y: 1080 }, { y: 0, duration: 0.45, ease: "power3.inOut" }, C.toS3);
  hideScene("#s2", C.toS3 + 0.46);

  // ------------------------------------------------------------------ 3 · what I do (11 – 17)
  gsap.set("#s3 .pill", { xPercent: -50 });
  pop("#s3 .pill", C.toS3 + 0.3, { dur: 0.45 });
  rise(words($("#s3 .heading")), C.toS3 + 0.36, { stagger: 0.05 });
  tl.fromTo("#s3 .slot", { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.45, stagger: 0.08, ease: "back.out(1.6)" }, C.s3 + 0.1);
  [["c1", C.card1, -9], ["c2", C.card2, 8], ["c3", C.card3, -7]].forEach(([k, t, r]) => {
    const card = $(`#s3 .${k}`);
    gsap.set(card, { transformOrigin: "50% 100%" });
    tl.fromTo(card, { y: -1000, rotate: r }, { y: 0, rotate: 0, duration: 0.34, ease: "power3.in" }, t - 0.34);
    tl.fromTo(card, { scaleX: 1.05, scaleY: 0.9 }, { scaleX: 1, scaleY: 1, duration: 0.7, ease: "elastic.out(1, 0.32)", immediateRender: false }, t);
    impacts.push([t, 7]);
    pop(card.querySelector(".icon"), t + 0.04, { dur: 0.5 });
    rise(words(card.querySelector("h3")), t + 0.08, { stagger: 0.05, dur: 0.5 });
    rise(words(card.querySelector("p")), t + 0.2, { stagger: 0.04, dur: 0.5 });
    tl.fromTo(card.querySelector(".num"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, t + 0.1);
  });
  tl.fromTo("#s3 .peek-cat", { y: 210, rotate: 0, autoAlpha: 0 }, { y: 0, rotate: -9, autoAlpha: 1, duration: 0.38, ease: "back.out(2)" }, C.catPeek);
  tl.to("#s3 .peek-cat", { rotate: 7, duration: 0.25, ease: "power2.inOut" }, C.catPeek + 0.4);
  tl.to("#s3 .peek-cat", { y: 210, duration: 0.18, ease: "power2.in" }, C.toS4 - 0.1);
  const zp = $("#s3 .zoom-panel");
  tl.set(zp, { left: 1270, top: 340, width: 500, height: 540, borderRadius: 28, visibility: "visible", opacity: 0 }, C.toS4);
  tl.to(zp, { opacity: 1, duration: 0.08, ease: "none" }, C.toS4);
  tl.to(zp, { left: -40, top: -40, width: 2000, height: 1160, borderRadius: 0, duration: 0.42, ease: "expo.inOut" }, C.toS4 + 0.03);
  tl.to(["#s3 .c1", "#s3 .c2", "#s3 .heading", "#s3 .pill"], { autoAlpha: 0, y: 30, duration: 0.25, ease: "power2.in" }, C.toS4);
  showScene("#s4", C.s4 - 0.01);
  hideScene("#s3", C.s4);

  // ------------------------------------------------------------------ 4 · perfectionist: centring the cat (17 – 23)
  const obj = $("#s4 .obj"), sel = $("#s4 .sel"), cur = $("#s4 .cursor");
  const GL = 560, GR = 1360, OBJ_L = 780, OBJ_R = 1140, PX = 2; // guides' inner edges and the cat card's edges; 1px is drawn as 2px
  const deltas = [-1, -1, 1, 1, -1, -1, 1];
  gsap.set(["#s4 .stamp", "#s4 .aside"], { xPercent: -50, yPercent: -50 });
  gsap.set(["#s4 .measure .val", "#s4 .sel .dim"], { xPercent: -50 });
  tl.fromTo("#s4 .grid", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, C.s4);
  pop("#s4 .pill", C.s4 + 0.02, { dur: 0.45 });
  rise(words($("#s4 .heading")), C.s4 + 0.06, { stagger: 0.05 });
  pop("#s4 .rev", C.s4 + 0.35, { dur: 0.45 });
  tl.fromTo("#s4 .guide", { scaleY: 0, transformOrigin: "50% 0%" }, { scaleY: 1, duration: 0.5, ease: "power3.inOut", stagger: 0.08 }, C.s4 + 0.25);
  pop(obj, C.s4 + 0.3, { from: 0.5, dur: 0.6, ease: "back.out(1.8)" });
  tl.fromTo(cur, { x: 1580, y: 1100, autoAlpha: 1 }, { x: 990, y: 600, duration: 0.6, ease: "power3.inOut" }, C.cursorClick - 0.6);
  tl.to(cur, { scale: 0.82, duration: 0.06, ease: "power2.out", transformOrigin: "10% 10%" }, C.cursorClick);
  tl.to(cur, { scale: 1, duration: 0.2, ease: "back.out(3)" }, C.cursorClick + 0.06);
  tl.fromTo(sel, { autoAlpha: 0, scale: 1.08 }, { autoAlpha: 1, scale: 1, duration: 0.22, ease: "power3.out" }, C.cursorClick);
  tl.fromTo("#s4 .sel i", { scale: 0 }, { scale: 1, duration: 0.3, stagger: 0.03, ease: POP }, C.cursorClick + 0.04);
  tl.fromTo("#s4 .sel .dim", { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.25 }, C.cursorClick + 0.12);
  tl.fromTo("#s4 .ml", { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.35, ease: "power3.out" }, C.cursorClick + 0.12);
  tl.fromTo("#s4 .mr", { scaleX: 0, transformOrigin: "100% 50%" }, { scaleX: 1, duration: 0.35, ease: "power3.out" }, C.cursorClick + 0.12);
  pop("#s4 .measure .val", C.cursorClick + 0.28, { dur: 0.35 });
  tl.to(cur, { x: 1620, y: 900, duration: 0.45, ease: "power3.inOut" }, C.nudges[0] - 0.4);
  tl.fromTo("#s4 .keys .key", { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.06, ease: "back.out(1.8)" }, C.nudges[0] - 0.45);
  C.nudges.forEach((t, i) => {
    const key = deltas[i] > 0 ? "#s4 .k-right" : "#s4 .k-left";
    tl.to(key, { y: 7, duration: 0.05, ease: "power2.out" }, t - 0.02);
    tl.to(key, { y: 0, duration: 0.16, ease: "power2.out" }, t + 0.06);
  });
  rise(words($("#s4 .caption")), C.nudges[0] + 0.1, { stagger: 0.05 });
  tl.to(["#s4 .obj-wrap", "#s4 .measure", "#s4 .guide", "#s4 .keys", cur, "#s4 .caption"], { autoAlpha: 0.16, duration: 0.25 }, C.perfect - 0.12);
  slam("#s4 .stamp", C.perfect, { fromScale: 2.4, rot0: -14, rot1: -4 });
  burst($("#s4 .burst"), C.perfect, 11, 380);
  tl.fromTo("#s4 .aside", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.4 }, C.perfect + 0.35);
  showScene("#s5", C.toS5);
  tl.to("#s4", { x: -520, duration: 0.36, ease: "expo.inOut" }, C.toS5);
  tl.fromTo("#s5", { x: 1930 }, { x: 0, duration: 0.36, ease: "expo.inOut" }, C.toS5);
  hideScene("#s4", C.toS5 + 0.37);

  // ------------------------------------------------------------------ 5 · friends (23 – 29)
  pop("#s5 .pill", C.s5 - 0.05, { dur: 0.45 });
  rise(new SplitText("#s5 .heading", { type: "lines", mask: "lines" }).lines, C.s5 - 0.02, { stagger: 0.09, dur: 0.6 });
  tl.fromTo("#s5 .chat", { y: 140, rotate: 3, autoAlpha: 0 }, { y: 0, rotate: 0, autoAlpha: 1, duration: 0.55, ease: "back.out(1.4)" }, C.s5 - 0.08);
  pop("#s5 .doodle", C.s5 + 0.2, { dur: 0.5 });
  [["m1", C.bub1], ["m2", C.bub2], ["m3", C.bub3]].forEach(([k, t]) => {
    tl.fromTo(`#s5 .${k} .who`, { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.25 }, t - 0.06);
    pop(`#s5 .${k} .b`, t - 0.07, { from: 0.3, dur: 0.45, ease: "back.out(2.4)" });
  });
  pop("#s5 .typing", C.reply - 0.6, { from: 0.3, dur: 0.3 });
  out("#s5 .typing", C.reply - 0.12, 0.08);
  tl.fromTo("#s5 .reply .who", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, C.reply - 0.04);
  pop("#s5 .reply .b", C.reply - 0.07, { from: 0.3, dur: 0.5, ease: "back.out(2.6)", fromVars: { rotate: 6 }, toVars: { rotate: 0 } });
  pop("#s5 .me", C.reply - 0.02, { dur: 0.45 });
  slam("#s5 .sticker", C.sticker, { fromScale: 2.5, rot0: -18, rot1: -5 });
  // circle wipe out of Jeet's avatar into the next scene (the avatar sits inside the pushed-in layer)
  const s5push = 1 + PUSH_AMT * clamp((C.toS6 - PUSH.s5[0]) / (PUSH.s5[1] - PUSH.s5[0]));
  const mcx = 960 + (meRect.left + meRect.width / 2 - 960) * s5push, mcy = 540 + (meRect.top + meRect.height / 2 - 540) * s5push;
  showScene("#s6", C.toS6);
  tl.fromTo("#s6", { clipPath: `circle(0px at ${mcx}px ${mcy}px)` }, { clipPath: `circle(2300px at ${mcx}px ${mcy}px)`, duration: C.climax - C.toS6, ease: "expo.in" }, C.toS6);
  tl.set("#s6", { clipPath: "none" }, C.climax + 0.01);
  hideScene("#s5", C.climax + 0.01);

  // ------------------------------------------------------------------ 6 · qawwali + classical (29 – 33)
  gsap.set("#s6 .disc img", { xPercent: -50 });
  tl.fromTo("#s6 .disc", { scale: 0.45, rotate: -30 }, { scale: 1, rotate: 0, duration: 0.9, ease: "elastic.out(1, 0.6)" }, C.climax - 0.12);
  tl.fromTo("#s6 .disc img", { y: 360 }, { y: 0, duration: 0.75, ease: "back.out(1.3)" }, C.climax - 0.05);
  pop("#s6 .badge", C.climax + 0.18, { dur: 0.7, ease: "back.out(1.6)", fromVars: { rotate: -160 }, toVars: { rotate: 0 } });
  impacts.push([C.climax, 10]);
  pop("#s6 .pill", C.climax + 0.12, { dur: 0.45 });
  rise(words($("#s6 .heading .l1")), C.s6l1 - 0.06, { stagger: 0.07 });
  rise(words($("#s6 .heading .l2")), C.s6l2 - 0.06, { stagger: 0.07 });
  rise(words($("#s6 .fact span")), C.fact - 0.05, { stagger: 0.05 });
  pop("#s6 .fact img", C.fact + 0.3, { dur: 0.5, fromVars: { rotate: -30 }, toVars: { rotate: 8 } });
  tl.fromTo("#s6 .doodle", { scale: 0 }, { scale: 1, duration: 0.5, ease: POP, stagger: 0.1 }, C.climax + 0.4);
  const eq = $("#s6 .eq");
  const EQC = ["--mint", "--pink", "--sky", "--peach", "--butter", "--purple"];
  for (let i = 0; i < 16; i++) {
    const b = document.createElement("i");
    b.style.background = `var(${EQC[i % EQC.length]})`;
    eq.appendChild(b);
  }
  const notes = $("#s6 .notes");
  const noteHits = LV.claps.filter((t) => t >= C.climax && t < C.toS7 - 0.3).filter((_, i) => i % 2 === 0);
  const noteEls = noteHits.map((t, i) => {
    const d = document.createElement("div");
    d.className = "doodle";
    d.innerHTML = '<svg viewBox="0 0 60 80"><use href="#note"/></svg>';
    d.style.left = `${i % 2 ? 810 + ((i * 37) % 60) : 160 + ((i * 53) % 60)}px`;
    d.style.top = `${520 + ((i * 71) % 120)}px`;
    d.style.visibility = "hidden";
    notes.appendChild(d);
    return { el: d, t, dir: i % 2 ? 1 : -1, k: i };
  });
  showScene("#s7", C.toS7);
  tl.to("#s6", { y: -1080, duration: 0.45, ease: "power3.inOut" }, C.toS7);
  tl.fromTo("#s7", { y: 1080 }, { y: 0, duration: 0.45, ease: "power3.inOut" }, C.toS7);
  hideScene("#s6", C.toS7 + 0.46);

  // ------------------------------------------------------------------ 7 · toolkit (33 – 39)
  gsap.set("#s7 .pill", { xPercent: -50 });
  pop("#s7 .pill", C.toS7 + 0.3, { dur: 0.45 });
  rise(words($("#s7 .heading")), C.toS7 + 0.36, { stagger: 0.05 });
  const logoTimes = [];
  $$("#s7 .group").forEach((g, gi) => {
    const t = C.groups[gi];
    tl.fromTo(g, { y: 160, rotate: gi % 2 ? 3 : -3, autoAlpha: 0 }, { y: 0, rotate: 0, autoAlpha: 1, duration: 0.6, ease: "back.out(1.5)" }, t - 0.12);
    pop(g.querySelector(".group-head .icon"), t + 0.05, { dur: 0.45 });
    rise(words(g.querySelector("h3")), t + 0.08, { stagger: 0.05, dur: 0.45 });
    pop(g.querySelector(".count"), t + 0.2, { dur: 0.4 });
    $$(".logo", g).forEach((lg, li) => {
      const lt = t + C.logoDelay + li * C.logoStep;
      logoTimes.push(lt);
      pop(lg.querySelector(".tile"), lt - 0.04, { dur: 0.45, ease: "back.out(2.6)" });
      tl.fromTo(lg.querySelector("span"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "power3.out" }, lt + 0.04);
    });
  });
  tl.fromTo("#s7 .doodle", { scale: 0 }, { scale: 1, duration: 0.5, ease: POP, stagger: 0.1 }, C.s7 + 0.2);
  showScene("#s8", C.toS8);
  tl.to("#s7", { y: -1080, duration: 0.42, ease: "power3.inOut" }, C.toS8);
  tl.fromTo("#s8", { y: 1080 }, { y: 0, duration: 0.42, ease: "power3.inOut" }, C.toS8);
  hideScene("#s7", C.toS8 + 0.43);

  // ------------------------------------------------------------------ 8 · outro (39 – 46)
  const catWrap8 = $("#s8 .cat-wrap"), cat8 = $("#s8 .cat");
  tl.fromTo("#s8 .d8", { scale: 0, rotate: -25 }, { scale: 1, rotate: 0, duration: 0.6, ease: POP, stagger: 0.06 }, C.toS8 + 0.25);
  tl.fromTo("#s8 .cat-circle", { scale: 0 }, { scale: 1, duration: 0.85, ease: "elastic.out(1, 0.5)" }, C.outro - 0.08);
  tl.fromTo(catWrap8, { y: -900 }, { y: 0, duration: 0.3, ease: "power3.in" }, C.outro - 0.3);
  tl.fromTo(cat8, { scaleX: 1.12, scaleY: 0.86 }, { scaleX: 1, scaleY: 1, duration: 0.7, ease: "elastic.out(1, 0.3)", immediateRender: false }, C.outro);
  impacts.push([C.outro, 8]);
  pop("#s8 .b1", C.cat1 - 0.06, { from: 0.3, dur: 0.5, fromVars: { rotate: -6 }, toVars: { rotate: 0 } });
  out("#s8 .b1", C.cat2 - 0.12, 0.1);
  pop("#s8 .b2", C.cat2 - 0.05, { from: 0.3, dur: 0.5, fromVars: { rotate: -6 }, toVars: { rotate: 0 } });
  [0, 4, 8].forEach((s) => { // the cat nods to the tihai
    const t = C.tihai + s * 0.125;
    tl.to(cat8, { rotate: 8, duration: 0.07, ease: "power2.out" }, t);
    tl.to(cat8, { rotate: 0, duration: 0.3, ease: "elastic.out(1, 0.45)" }, t + 0.07);
  });
  out("#s8 .b2", C.sam - 0.32, 0.12);
  tl.to(catWrap8, { x: 960 - 560, y: 215 - 520, scale: 0.375, duration: 0.3, ease: "power3.inOut" }, C.sam - 0.38);
  tl.to("#s8 .cat-circle", { x: 960 - 560, y: 215 - 530, scale: 0.37, duration: 0.3, ease: "power3.inOut" }, C.sam - 0.38);
  tl.set("#s8 .phase-a", { autoAlpha: 0 }, C.sam + 0.03);
  gsap.set(["#s8 .end .mini-cat", "#s8 .end .cta", "#s8 .end .handles"], { xPercent: -50 });
  tl.fromTo("#s8 .end .mini-cat", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01 }, C.sam + 0.02);
  impacts.push([C.sam, 12]);
  rise(chars($("#s8 .end .name")), C.sam - 0.24, { stagger: 0.016, dur: 0.42 });
  tl.fromTo("#s8 .end .name", { scale: 1.09 }, { scale: 1, duration: 0.7, ease: "elastic.out(1, 0.4)", immediateRender: false }, C.sam);
  gsap.set("#s8 .end .underline", { left: nm8.left + nm8.width * 0.05, width: nm8.width * 0.86 });
  tl.fromTo("#s8 .end .underline", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.45, ease: "power2.inOut" }, C.sam + 0.3);
  tl.fromTo("#s8 .end .roles", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power3.out" }, C.sam + 0.4);
  pop("#s8 .end .approved", C.sam + 0.65, { dur: 0.7, ease: "back.out(1.8)", fromVars: { rotate: -180 }, toVars: { rotate: -8 } });
  pop("#s8 .end .cta", C.sam + 0.55, { from: 0.6, dur: 0.55 });
  tl.fromTo("#s8 .end .chip", { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.45, ease: POP, stagger: 0.08 }, C.sam + 0.8);
  const miniImg = $("#s8 .end .mini-cat img");
  tl.to(miniImg, { scaleY: 1.14, scaleX: 0.92, duration: 0.11, ease: "power2.out", transformOrigin: "50% 85%" }, C.meow2);
  tl.to(miniImg, { scaleY: 1, scaleX: 1, duration: 0.6, ease: "elastic.out(1, 0.35)" }, C.meow2 + 0.11);
  pop("#s8 .end .meow-label", C.meow2 + 0.04, { dur: 0.45, fromVars: { rotate: -40 }, toVars: { rotate: 10 } });
  out("#s8 .end .meow-label", C.meow2 + 1.3, 0.25);
  const sp = document.createElement("div");
  sp.className = "burst";
  Object.assign(sp.style, { position: "absolute", left: "960px", top: "390px" });
  $("#s8 .end").prepend(sp);
  burst(sp, C.sam, 12, 640, 0.2);

  // cinematic push-in per scene
  for (const [id, [a, b]] of Object.entries(PUSH)) {
    tl.fromTo(`#${id} > .push`, { scale: 1 }, { scale: 1 + PUSH_AMT, duration: b - a, ease: "none" }, a);
  }

  // ------------------------------------------------------------------ frame-exact effects
  const bobs = $$("[data-bob]").map((el) => { const [a, f, p] = el.dataset.bob.split(",").map(Number); return { el, a, f, p }; });
  const rings = $$(".circle-badge .ring");
  const beatPulse = (t, times, tau = 0.12) => {
    let v = 0;
    for (let i = times.length - 1; i >= 0; i--) { const d = t - times[i]; if (d < 0) continue; if (d > 0.6) break; v = Math.max(v, Math.exp(-d / tau)); }
    return v;
  };
  const claps = [...LV.claps].sort((a, b) => a - b);
  const eqBars = $$("#s6 .eq i");
  const tiles = $$("#s7 .tile");
  const camera = $("#camera");
  const s2 = $("#s2"), s2o = $("#s2o");
  const revN = $("#s4 .rev-n"), gapL = $("#s4 .gap-l"), gapR = $("#s4 .gap-r"), revPill = $("#s4 .rev");
  const ml = $("#s4 .ml"), mr = $("#s4 .mr"), objWrap = $("#s4 .obj-wrap");
  const archImg = $("#s2 .arch img");
  const dots = $$("#s5 .typing i");
  const noteBadge = $("#s6 .badge .note");
  const zoomFocus = { x: 771, y: 548 };
  const catSize = 360;
  const outline = "drop-shadow(3px 0 0 #1d1d1d) drop-shadow(-3px 0 0 #1d1d1d) drop-shadow(0 3px 0 #1d1d1d) drop-shadow(0 -3px 0 #1d1d1d)";

  function dynamic(t) {
    for (const b of bobs) b.el.style.translate = `0 ${(b.a * Math.sin(2 * Math.PI * b.f * t + b.p)).toFixed(2)}px`;
    rings.forEach((r, i) => (r.style.rotate = `${(t * 28 + i * 40) % 360}deg`));

    // camera shake on impacts
    let sx = 0, sy = 0;
    for (const [ti, a] of impacts) {
      const d = t - ti;
      if (d < 0 || d > 0.5) continue;
      const e = a * Math.exp(-d / 0.075);
      sx += e * Math.sin(2 * Math.PI * 26 * d);
      sy += 0.6 * e * Math.sin(2 * Math.PI * 31 * d + 1);
    }
    camera.style.translate = `${sx.toFixed(2)}px ${sy.toFixed(2)}px`;

    // cat-shaped window into the hero
    if (t >= zoomStart && t < zoomEnd) {
      const s = gsap.getProperty(catWrap1, "scale");
      const x = gsap.getProperty(catWrap1, "x"), y = gsap.getProperty(catWrap1, "y");
      const size = catSize * s;
      const left = zoomFocus.x + x - 0.531 * size, top = zoomFocus.y + y - 0.55 * size;
      s2.style.webkitMaskImage = s2.style.maskImage = "url(../assets/images/logo-cat-sunglasses.png)";
      s2.style.webkitMaskSize = s2.style.maskSize = `${size}px ${size}px`;
      s2.style.webkitMaskPosition = s2.style.maskPosition = `${left}px ${top}px`;
      s2.style.webkitMaskRepeat = s2.style.maskRepeat = "no-repeat";
      s2o.style.filter = outline;
    } else {
      s2.style.webkitMaskImage = s2.style.maskImage = "none";
      s2o.style.filter = "none";
    }

    // the hero photo vibes to the beat
    const beat = t >= C.drop ? Math.exp(-(((t - C.drop) % 0.5) / 0.11)) : 0;
    archImg.style.translate = `0 ${(-7 * beat).toFixed(2)}px`;

    // perfectionist: offset of the cat card, the two gaps and the revision counter
    let n = 0, off = 1;
    C.nudges.forEach((tn, i) => { if (t >= tn) { n++; off += deltas[i]; } });
    revN.textContent = 40 + n;
    gapL.textContent = 220 + off;
    gapR.textContent = 220 - off;
    objWrap.style.translate = `${off * PX}px 0`;
    ml.style.left = `${GL}px`; ml.style.width = `${OBJ_L - GL + off * PX}px`;
    mr.style.left = `${OBJ_R + off * PX}px`; mr.style.width = `${GR - OBJ_R - off * PX}px`;
    const even = off === 0 && n > 0;
    ml.classList.toggle("ok", even);
    mr.classList.toggle("ok", even);
    revPill.style.scale = `${1 + 0.14 * beatPulse(t, C.nudges, 0.08)}`;

    // typing dots
    dots.forEach((d, i) => (d.style.translate = `0 ${(-9 * Math.max(0, Math.sin(2 * Math.PI * 2.6 * t - i * 0.9))).toFixed(2)}px`));

    // audio-reactive EQ, music notes
    if (t >= C.toS6 && t < C.toS7 + 0.5) {
      const f = Math.min(LV.bands.length - 1, Math.max(0, Math.round(t * LV.fps)));
      const bands = LV.bands[f] || [];
      eqBars.forEach((b, i) => {
        const e = easeOut(clamp((t - (C.climax + 0.05) - i * 0.025) / 0.35));
        b.style.scale = `1 ${(e * (0.1 + 0.9 * (bands[i] || 0))).toFixed(3)}`;
      });
      for (const nt of noteEls) {
        const d = t - nt.t;
        if (d < 0 || d > 1.4) { nt.el.style.visibility = "hidden"; continue; }
        const p = d / 1.4;
        nt.el.style.visibility = "visible";
        nt.el.style.translate = `${(nt.dir * (60 + 140 * p) + 30 * Math.sin(p * 6 + nt.k)).toFixed(1)}px ${(-300 * easeOut(p)).toFixed(1)}px`;
        nt.el.style.rotate = `${(nt.dir * 25 * Math.sin(p * 5)).toFixed(1)}deg`;
        nt.el.style.scale = `${(Math.min(1, d / 0.15) * (1 - 0.3 * p)).toFixed(3)}`;
        nt.el.style.opacity = `${(1 - Math.pow(p, 3)).toFixed(3)}`;
      }
      noteBadge.style.scale = `${1 + 0.18 * beatPulse(t, claps, 0.1)}`;
    }
    // toolkit tiles bounce on the claps
    if (t >= C.toS7 && t < C.toS8 + 0.5) {
      const cp = beatPulse(t, claps, 0.1);
      tiles.forEach((tile) => (tile.style.scale = `${1 + 0.05 * cp}`));
    }
  }

  window.__seek = (t) => { tl.seek(t, true); dynamic(t); };
  window.__duration = C.duration;
  window.__logoTimes = logoTimes;
  // Motion probe for adaptive motion blur: the largest on-screen displacement (px) of any visible element between two times.
  // Mask / clip-path wipes move edges that element rects can't see, so their windows are flagged explicitly.
  const probeEls = $$("#camera *");
  const wipes = [[zoomStart, zoomEnd], [C.toS6, C.climax]];
  const onScreen = (r) => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < 1920 && r.top < 1080;
  window.__motion = (a, b) => {
    window.__seek(a);
    const ra = probeEls.map((e) => e.getBoundingClientRect());
    window.__seek(b);
    let m = 0;
    probeEls.forEach((e, i) => {
      const A = ra[i], B = e.getBoundingClientRect();
      if (!onScreen(A) && !onScreen(B)) return;
      if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return;
      m = Math.max(m, Math.abs(A.left - B.left), Math.abs(A.top - B.top), Math.abs(A.right - B.right), Math.abs(A.bottom - B.bottom));
    });
    if (wipes.some(([s0, s1]) => b > s0 && a < s1)) m = Math.max(m, 60);
    return m;
  };
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
  return true;
})();
