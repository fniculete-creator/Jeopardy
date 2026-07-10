/* Daily Jeopardy! — plays real clues from past Jeopardy! episodes.
   Data comes from clues.js (window.JEOPARDY_DATA), generated from the
   J! Archive-based dataset. Board selection is seeded by the calendar
   date so everyone gets the same board on the same day. */

(function () {
  "use strict";

  const DATA = window.JEOPARDY_DATA;
  const STORAGE_GAME = "daily-jeopardy-game";
  const STORAGE_PLAYERS = "daily-jeopardy-players";
  const COLS = 6, ROWS = 5;
  const J_VALUES = [200, 400, 600, 800, 1000];
  const DJ_VALUES = [400, 800, 1200, 1600, 2000];

  let state = null; // current game state
  let activeClue = null; // {row, col, value, clue, answer, isDD, wager, ddPlayer}

  /* ---------- seeded RNG ---------- */
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seedStr) {
    return mulberry32(xmur3(seedStr)());
  }

  function pickDistinct(rng, count, max) {
    const picked = new Set();
    while (picked.size < count) picked.add(Math.floor(rng() * max));
    return [...picked];
  }

  /* ---------- game creation ---------- */
  function todaySeed() {
    // local calendar date, e.g. "2026-07-10"
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function buildGame(seed, mode, playerNames) {
    const rng = makeRng("jeopardy:" + seed);
    const jCats = pickDistinct(rng, COLS, DATA.j.length);
    const djCats = pickDistinct(rng, COLS, DATA.dj.length);
    const fj = Math.floor(rng() * DATA.fj.length);

    // Daily doubles: never in the top row, like the real show.
    const dd1 = [[Math.floor(rng() * COLS), 1 + Math.floor(rng() * (ROWS - 1))]];
    const colA = Math.floor(rng() * COLS);
    let colB = Math.floor(rng() * (COLS - 1));
    if (colB >= colA) colB++;
    const dd2 = [
      [colA, 1 + Math.floor(rng() * (ROWS - 1))],
      [colB, 1 + Math.floor(rng() * (ROWS - 1))],
    ];

    return {
      seed, mode,
      players: playerNames.map((n) => ({ name: n, score: 0 })),
      round: 1,
      jCats, djCats, fj, dd1, dd2,
      used: { 1: Array(COLS * ROWS).fill(false), 2: Array(COLS * ROWS).fill(false) },
      finalDone: false,
    };
  }

  /* ---------- persistence ---------- */
  function save() {
    try { localStorage.setItem(STORAGE_GAME, JSON.stringify(state)); } catch (e) {}
  }
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_GAME)); } catch (e) { return null; }
  }
  function clearSaved() {
    try { localStorage.removeItem(STORAGE_GAME); } catch (e) {}
  }

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  function money(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US");
  }
  function roundCats() { return state.round === 1 ? state.jCats : state.djCats; }
  function roundData() { return state.round === 1 ? DATA.j : DATA.dj; }
  function roundValues() { return state.round === 1 ? J_VALUES : DJ_VALUES; }
  function roundDDs() { return state.round === 1 ? state.dd1 : state.dd2; }

  /* ---------- setup screen ---------- */
  function initSetup() {
    const wrap = $("player-inputs");
    wrap.innerHTML = "";
    let names = ["Player 1", "Player 2"];
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_PLAYERS));
      if (Array.isArray(saved) && saved.length) names = saved;
    } catch (e) {}
    names.forEach((n) => addPlayerInput(n));

    const saved = loadSaved();
    if (saved && !(saved.round > 3)) {
      $("resume-note").classList.remove("hidden");
    }
  }

  function addPlayerInput(value) {
    const wrap = $("player-inputs");
    if (wrap.children.length >= 6) return;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 20;
    input.placeholder = "Player name";
    input.value = value || "";
    wrap.appendChild(input);
  }

  function readPlayerNames() {
    const names = [...$("player-inputs").querySelectorAll("input")]
      .map((i) => i.value.trim())
      .filter(Boolean);
    return names.length ? names : ["Player 1"];
  }

  function startGame(mode) {
    const names = readPlayerNames();
    try { localStorage.setItem(STORAGE_PLAYERS, JSON.stringify(names)); } catch (e) {}

    const seed = mode === "daily"
      ? todaySeed()
      : "random-" + Math.random().toString(36).slice(2, 10);

    const saved = loadSaved();
    if (saved && saved.mode === "daily" && mode === "daily" && saved.seed === seed && !(saved.round > 3)) {
      state = saved; // resume today's game in progress
    } else {
      state = buildGame(seed, mode, names);
      save();
    }
    $("setup-screen").classList.add("hidden");
    $("game-screen").classList.remove("hidden");
    if (state.round === 3) startFinal();
    else renderAll();
  }

  /* ---------- board rendering ---------- */
  function renderAll() {
    $("round-title").textContent = state.round === 1 ? "JEOPARDY!" : "DOUBLE JEOPARDY!";
    $("game-date").textContent = state.mode === "daily"
      ? "Daily game · " + state.seed
      : "Random game";
    renderBoard();
    renderScores();
  }

  function renderBoard() {
    const board = $("board");
    board.innerHTML = "";
    const cats = roundCats();
    const data = roundData();
    const values = roundValues();

    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "cell category";
      cell.textContent = data[cats[c]].c;
      board.appendChild(cell);
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("div");
        const idx = r * COLS + c;
        if (state.used[state.round][idx]) {
          cell.className = "cell done";
        } else {
          cell.className = "cell value";
          cell.textContent = "$" + values[r];
          cell.addEventListener("click", () => openClue(r, c));
        }
        board.appendChild(cell);
      }
    }
  }

  function renderScores() {
    const sb = $("scoreboard");
    sb.innerHTML = "";
    state.players.forEach((p, i) => {
      const pod = document.createElement("div");
      pod.className = "podium";
      const name = document.createElement("div");
      name.className = "pname";
      name.textContent = p.name;
      const score = document.createElement("div");
      score.className = "pscore" + (p.score < 0 ? " negative" : "");
      score.textContent = money(p.score);
      score.title = "Click to edit score";
      score.addEventListener("click", () => {
        const val = prompt(`Set score for ${p.name}:`, p.score);
        if (val === null) return;
        const n = parseInt(val.replace(/[^\-0-9]/g, ""), 10);
        if (!isNaN(n)) { p.score = n; save(); renderScores(); }
      });
      const hint = document.createElement("div");
      hint.className = "edit-hint";
      hint.textContent = "tap to edit";
      pod.appendChild(name); pod.appendChild(score); pod.appendChild(hint);
      sb.appendChild(pod);
    });
  }

  /* ---------- clue flow ---------- */
  function openClue(row, col) {
    const cats = roundCats();
    const data = roundData();
    const cat = data[cats[col]];
    const [clueText, answerText] = cat.cl[row];
    const value = roundValues()[row];
    const isDD = roundDDs().some(([c, r]) => c === col && r === row);

    activeClue = { row, col, value, clue: clueText, answer: answerText, isDD, wager: 0, ddPlayer: 0 };

    $("clue-category").textContent = cat.c + " — $" + value.toLocaleString("en-US");
    $("clue-source").textContent = "Real Jeopardy! clue · originally aired " + cat.d;
    $("answer-area").classList.add("hidden");
    $("reveal-answer").classList.remove("hidden");

    if (isDD) {
      $("clue-body").classList.add("hidden");
      $("dd-banner").classList.remove("hidden");
      const sel = $("dd-player");
      sel.innerHTML = "";
      state.players.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
      const maxDefault = state.round === 1 ? 1000 : 2000;
      $("dd-wager").value = Math.max(state.players[0].score, maxDefault);
      sel.onchange = () => {
        const p = state.players[+sel.value];
        $("dd-wager").value = Math.max(p.score, maxDefault);
      };
    } else {
      $("dd-banner").classList.add("hidden");
      showClueBody();
    }
    $("clue-modal").classList.remove("hidden");
  }

  function showClueBody() {
    $("clue-text").textContent = activeClue.clue;
    $("clue-body").classList.remove("hidden");
  }

  function ddStart() {
    const playerIdx = +$("dd-player").value;
    const player = state.players[playerIdx];
    const maxWager = Math.max(player.score, state.round === 1 ? 1000 : 2000);
    let wager = parseInt($("dd-wager").value, 10);
    if (isNaN(wager) || wager < 5) wager = 5;
    if (wager > maxWager) wager = maxWager;
    activeClue.wager = wager;
    activeClue.ddPlayer = playerIdx;
    $("dd-banner").classList.add("hidden");
    $("clue-category").textContent =
      roundData()[roundCats()[activeClue.col]].c + " — DAILY DOUBLE, " + money(wager);
    showClueBody();
  }

  function revealAnswer() {
    $("answer-text").textContent = activeClue.answer;
    $("reveal-answer").classList.add("hidden");
    $("answer-area").classList.remove("hidden");
    buildJudgeButtons();
  }

  function buildJudgeButtons() {
    const wrap = $("judge-buttons");
    wrap.innerHTML = "";
    const judgeable = activeClue.isDD
      ? [activeClue.ddPlayer]
      : state.players.map((_, i) => i);
    const amount = activeClue.isDD ? activeClue.wager : activeClue.value;

    judgeable.forEach((i) => {
      const p = state.players[i];
      const pair = document.createElement("div");
      pair.className = "judge-pair";
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = p.name;
      const row = document.createElement("div");
      row.className = "row";
      const right = document.createElement("button");
      right.className = "btn right";
      right.textContent = "✓ +" + money(amount).replace("$", "$");
      const wrong = document.createElement("button");
      wrong.className = "btn wrong";
      wrong.textContent = "✗ -" + money(amount).replace("$", "$");
      right.addEventListener("click", () => {
        p.score += amount;
        right.classList.add("used"); wrong.classList.add("used");
        save(); renderScores();
      });
      wrong.addEventListener("click", () => {
        p.score -= amount;
        right.classList.add("used"); wrong.classList.add("used");
        save(); renderScores();
      });
      row.appendChild(right); row.appendChild(wrong);
      pair.appendChild(who); pair.appendChild(row);
      wrap.appendChild(pair);
    });
  }

  function closeClue() {
    state.used[state.round][activeClue.row * COLS + activeClue.col] = true;
    activeClue = null;
    $("clue-modal").classList.add("hidden");
    save();
    if (state.used[state.round].every(Boolean)) nextRound();
    else renderBoard();
  }

  function nextRound() {
    if (state.round === 1) {
      state.round = 2;
      save();
      renderAll();
    } else if (state.round === 2) {
      state.round = 3;
      save();
      startFinal();
    }
  }

  /* ---------- final jeopardy ---------- */
  function startFinal() {
    $("round-title").textContent = "FINAL JEOPARDY!";
    $("board").innerHTML = "";
    renderScores();
    const fj = DATA.fj[state.fj];
    $("final-category").textContent = fj.c;
    $("final-source").textContent = "Real Final Jeopardy! clue · originally aired " + fj.d;
    $("final-clue-area").classList.add("hidden");
    $("final-answer-area").classList.add("hidden");
    $("final-show-clue").classList.remove("hidden");

    const wagers = $("final-wagers");
    wagers.innerHTML = "";
    state.players.forEach((p, i) => {
      const label = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = `${p.name} (${money(p.score)}) wagers $`;
      const input = document.createElement("input");
      input.type = "number";
      input.min = 0;
      input.step = 100;
      input.dataset.player = i;
      input.value = Math.max(p.score, 0);
      label.appendChild(span); label.appendChild(input);
      wagers.appendChild(label);
    });
    $("final-modal").classList.remove("hidden");
  }

  function finalShowClue() {
    const fj = DATA.fj[state.fj];
    state.finalWagers = [...$("final-wagers").querySelectorAll("input")].map((input, i) => {
      const p = state.players[i];
      const maxWager = Math.max(p.score, 1000);
      let w = parseInt(input.value, 10);
      if (isNaN(w) || w < 0) w = 0;
      if (w > maxWager) w = maxWager;
      input.value = w;
      input.disabled = true;
      return w;
    });
    save();
    $("final-show-clue").classList.add("hidden");
    $("final-clue-text").textContent = fj.q;
    $("final-clue-area").classList.remove("hidden");
  }

  function finalReveal() {
    const fj = DATA.fj[state.fj];
    $("final-answer-text").textContent = fj.a;
    $("final-reveal").classList.add("hidden");
    $("final-answer-area").classList.remove("hidden");

    const wrap = $("final-judge");
    wrap.innerHTML = "";
    state.players.forEach((p, i) => {
      const pair = document.createElement("div");
      pair.className = "judge-pair";
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = `${p.name} (wagered ${money(state.finalWagers[i])})`;
      const row = document.createElement("div");
      row.className = "row";
      const right = document.createElement("button");
      right.className = "btn right";
      right.textContent = "✓ Right";
      const wrong = document.createElement("button");
      wrong.className = "btn wrong";
      wrong.textContent = "✗ Wrong";
      right.addEventListener("click", () => {
        p.score += state.finalWagers[i];
        right.classList.add("used"); wrong.classList.add("used");
        save(); renderScores();
      });
      wrong.addEventListener("click", () => {
        p.score -= state.finalWagers[i];
        right.classList.add("used"); wrong.classList.add("used");
        save(); renderScores();
      });
      row.appendChild(right); row.appendChild(wrong);
      pair.appendChild(who); pair.appendChild(row);
      wrap.appendChild(pair);
    });
  }

  function showResults() {
    $("final-modal").classList.add("hidden");
    state.round = 4;
    save();
    const list = $("results-list");
    list.innerHTML = "";
    const ranked = state.players
      .map((p) => ({ ...p }))
      .sort((a, b) => b.score - a.score);
    const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
    ranked.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "result-row";
      const medal = document.createElement("span");
      medal.className = "medal";
      medal.textContent = medals[i] || "•";
      row.appendChild(medal);
      row.appendChild(document.createTextNode(`${p.name} — ${money(p.score)}`));
      list.appendChild(row);
    });
    $("results-modal").classList.remove("hidden");
  }

  function copyResults() {
    const ranked = [...state.players].sort((a, b) => b.score - a.score);
    const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
    const title = state.mode === "daily"
      ? `Daily Jeopardy! ${state.seed}`
      : "Jeopardy! game night";
    const lines = [title, ...ranked.map((p, i) => `${medals[i] || "•"} ${p.name} — ${money(p.score)}`)];
    const text = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        $("copy-results").textContent = "Copied!";
        setTimeout(() => { $("copy-results").textContent = "Copy results to share"; }, 1500);
      });
    } else {
      prompt("Copy your results:", text);
    }
  }

  function backToMenu() {
    clearSaved();
    state = null;
    $("results-modal").classList.add("hidden");
    $("game-screen").classList.add("hidden");
    $("setup-screen").classList.remove("hidden");
    initSetup();
  }

  /* ---------- wire up ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    initSetup();
    $("add-player").addEventListener("click", () => addPlayerInput(""));
    $("start-daily").addEventListener("click", () => startGame("daily"));
    $("start-random").addEventListener("click", () => startGame("random"));
    $("dd-go").addEventListener("click", ddStart);
    $("reveal-answer").addEventListener("click", revealAnswer);
    $("nobody-btn").addEventListener("click", closeClue);
    $("skip-round").addEventListener("click", () => {
      if (state.round < 3 && confirm("Skip to the next round?")) nextRound();
    });
    $("quit-game").addEventListener("click", () => {
      if (confirm("End this game and go to final scores?")) {
        if (state.round === 3) $("final-modal").classList.add("hidden");
        showResults();
      }
    });
    $("final-show-clue").addEventListener("click", finalShowClue);
    $("final-reveal").addEventListener("click", finalReveal);
    $("final-done").addEventListener("click", showResults);
    $("copy-results").addEventListener("click", copyResults);
    $("back-to-menu").addEventListener("click", backToMenu);
  });
})();
