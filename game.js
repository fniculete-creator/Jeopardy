/* Daily Sports Jeopardy! — a short, phone-first solo game built on real
   sports clues from past Jeopardy! episodes (data in clues.js).

   One round, no wagering: every clue is worth 1 point and wrong guesses
   cost nothing. Tap the screen to buzz in, then answer by voice — the
   Web Speech API transcribes and the answer is auto-checked, with a
   self-judged fallback for browsers without speech recognition.

   The board is seeded by the calendar date, so everyone who plays the
   daily game gets the same clues and can compare scores. */

(function () {
  "use strict";

  const DATA = window.JEOPARDY_DATA;
  const STORAGE_GAME = "daily-jeopardy-game";
  const STORAGE_NAME = "daily-jeopardy-name";
  const STORAGE_MIC = "daily-jeopardy-mic";
  const COLS = 6, ROWS = 5;
  const VALUES = [200, 400, 600, 800, 1000]; // display only; every clue = 1 pt
  const BUZZ_SECONDS = 12;   // time to buzz in after the clue appears
  const LISTEN_SECONDS = 8;  // time to speak an answer after buzzing

  // One big deck of sports categories; each category's five clues stay
  // in easy-to-hard order.
  const POOL = DATA.cats;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const SYNTH = window.speechSynthesis || null;
  const STORAGE_VOICE = "daily-jeopardy-voice";

  // Shared daily leaderboard backend (leaderboard/server.py). Local dev
  // hits a locally-run server; anywhere else, the kalshi-bots box.
  const LB_API = /^(localhost|127\.|192\.168\.)/.test(location.hostname)
    ? `http://${location.hostname}:8124/jeopardy`
    : "https://32.194.248.231.nip.io/jeopardy";

  let state = null;       // persistent game state
  let active = null;      // {row, col, answer, judged}
  let buzzTimer = null;   // interval for the buzz countdown
  let listenTimer = null; // timeout for the listening window
  let readTimer = null;   // fallback in case TTS never fires onend
  let recognizer = null;
  let hostVoice; // cached SpeechSynthesisVoice (undefined = not picked yet)

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
  function makeRng(seedStr) { return mulberry32(xmur3(seedStr)()); }

  function pickDistinct(rng, count, max) {
    const picked = new Set();
    while (picked.size < count) picked.add(Math.floor(rng() * max));
    return [...picked];
  }

  /* ---------- game state ---------- */
  function todaySeed() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function buildGame(seed, mode) {
    const rng = makeRng("jeopardy:" + seed);
    return {
      seed, mode,
      cats: pickDistinct(rng, COLS, POOL.length),
      // per-cell result: null = unplayed, 1 = right, 0 = wrong/passed
      results: Array(COLS * ROWS).fill(null),
      done: false,
    };
  }

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
  function score() { return state.results.filter((r) => r === 1).length; }
  function played() { return state.results.filter((r) => r !== null).length; }
  function micEnabled() { return !!SR && $("mic-toggle").checked; }
  function voiceEnabled() { return !!SYNTH && $("voice-toggle").checked; }

  /* ---------- host voice (text-to-speech) ---------- */
  // The deepest, most game-show-host-like English voice the device offers.
  function pickHostVoice() {
    if (hostVoice !== undefined) return hostVoice;
    const voices = SYNTH.getVoices().filter((v) => /^en\b/i.test(v.lang || ""));
    if (!voices.length) return null; // list may load async — retry next clue
    const prefer = ["Alex", "Daniel", "Aaron", "Matthew", "Fred",
                    "Google US English", "Microsoft Guy", "Microsoft David"];
    hostVoice = prefer.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean)
      || voices.find((v) => v.lang === "en-US") || voices[0] || null;
    return hostVoice;
  }

  function stopSpeaking() {
    if (readTimer) { clearTimeout(readTimer); readTimer = null; }
    if (SYNTH) { try { SYNTH.cancel(); } catch (e) {} }
    $("reading-note").classList.add("hidden");
  }

  // Read the clue aloud, then start the buzz countdown when done
  // (buzzing early is allowed and simply cuts the host off).
  function beginClue(clueText) {
    const me = active;
    let started = false;
    const startTimer = () => {
      if (started || active !== me) return; // stale event from a previous clue
      started = true;
      $("reading-note").classList.add("hidden");
      startBuzzCountdown();
    };
    if (!voiceEnabled()) { startTimer(); return; }
    try {
      stopSpeaking();
      const u = new SpeechSynthesisUtterance(clueText);
      const v = pickHostVoice();
      if (v) u.voice = v;
      u.rate = 0.95;
      u.pitch = 0.8;
      u.onend = startTimer;
      u.onerror = startTimer;
      $("reading-note").classList.remove("hidden");
      SYNTH.speak(u);
      // some browsers never fire onend — estimate the reading time instead
      readTimer = setTimeout(startTimer, Math.min(16000, 2500 + clueText.length * 75));
    } catch (e) {
      startTimer();
    }
  }

  /* ---------- answer matching ---------- */
  function normalize(s) {
    s = s.toLowerCase();
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/&/g, " and ");
    s = s.replace(/[^a-z0-9\s]/g, " ");
    // strip a "what is / who are ..." style prefix if the player phrased it
    s = s.replace(/^\s*(what|who|where|when)\s+(is|are|was|were)\s+/, "");
    s = s.replace(/\s+/g, " ").trim();
    s = s.replace(/^(the|a|an) /, "");
    return s;
  }

  // Acceptable variants of the official answer, e.g.
  // "(Queen) Victoria" -> ["queen victoria", "victoria"]
  // "a llama or an alpaca" -> both animals accepted
  function answerVariants(answer) {
    const raw = new Set();
    raw.add(answer);
    raw.add(answer.replace(/\(.*?\)/g, " "));            // parens optional
    raw.add(answer.replace(/[()]/g, " "));               // parens included
    for (const part of answer.replace(/\(.*?\)/g, " ").split(/\bor\b|\//i)) raw.add(part);
    const m = answer.match(/\(accept:?\s*([^)]+)\)/i);   // "(accept ...)" notes
    if (m) raw.add(m[1]);
    const out = new Set();
    for (const v of raw) {
      const n = normalize(v);
      if (n) out.add(n);
    }
    return [...out];
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[n];
  }

  function similar(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const dist = levenshtein(a, b);
    const ratio = 1 - dist / Math.max(a.length, b.length);
    if (ratio >= 0.8) return true;
    // guess contains the full answer (or vice versa) as a word boundary match
    if (a.length >= 4 && b.includes(a)) return true;
    if (b.length >= 4 && a.includes(b)) return true;
    return false;
  }

  function isCorrect(saidAlternatives, answer) {
    const variants = answerVariants(answer);
    for (const said of saidAlternatives) {
      const guess = normalize(said);
      for (const v of variants) if (similar(guess, v)) return true;
    }
    return false;
  }

  /* ---------- setup screen ---------- */
  function initSetup() {
    try { $("player-name").value = localStorage.getItem(STORAGE_NAME) || ""; } catch (e) {}
    if (!SR) {
      $("mic-row").classList.add("hidden");
      $("mic-unsupported").classList.remove("hidden");
    } else {
      try { $("mic-toggle").checked = localStorage.getItem(STORAGE_MIC) !== "off"; } catch (e) {}
    }
    if (!SYNTH) {
      $("voice-row").classList.add("hidden");
    } else {
      try { $("voice-toggle").checked = localStorage.getItem(STORAGE_VOICE) !== "off"; } catch (e) {}
      SYNTH.getVoices(); // warm up the async voice list
    }
    const saved = loadSaved();
    $("resume-note").classList.toggle("hidden", !(saved && !saved.done));
  }

  function startGame(mode) {
    try {
      localStorage.setItem(STORAGE_NAME, $("player-name").value.trim());
      localStorage.setItem(STORAGE_MIC, $("mic-toggle").checked ? "on" : "off");
      localStorage.setItem(STORAGE_VOICE, $("voice-toggle").checked ? "on" : "off");
    } catch (e) {}

    const seed = mode === "daily"
      ? todaySeed()
      : "random-" + Math.random().toString(36).slice(2, 10);

    const saved = loadSaved();
    if (saved && !saved.done && saved.mode === mode &&
        (mode !== "daily" || saved.seed === seed)) {
      state = saved; // resume in-progress game (today's daily, or last random)
    } else {
      state = buildGame(seed, mode);
      save();
    }
    $("setup-screen").classList.add("hidden");
    $("game-screen").classList.remove("hidden");
    renderAll();
  }

  /* ---------- board ---------- */
  function renderAll() {
    $("game-date").textContent = state.mode === "daily"
      ? "Daily game · " + state.seed
      : "Random game";
    renderBoard();
    renderScore();
  }

  function renderScore() {
    $("score-chip").textContent = `${score()} / ${played()} pts`;
  }

  function renderBoard() {
    const board = $("board");
    board.innerHTML = "";
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "cell category";
      cell.textContent = POOL[state.cats[c]].c;
      board.appendChild(cell);
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("div");
        const res = state.results[r * COLS + c];
        if (res === null) {
          cell.className = "cell value";
          cell.textContent = "$" + VALUES[r];
          cell.addEventListener("click", () => openClue(r, c));
        } else {
          cell.className = "cell done " + (res === 1 ? "won" : "lost");
          cell.textContent = res === 1 ? "✓" : "✗";
        }
        board.appendChild(cell);
      }
    }
  }

  /* ---------- clue flow ---------- */
  function showState(name) {
    for (const s of ["state-buzz", "state-listen", "state-say", "state-verdict"]) {
      $(s).classList.toggle("hidden", s !== name);
    }
  }

  function openClue(row, col) {
    const cat = POOL[state.cats[col]];
    const [clueText, answerText] = cat.cl[row];
    active = { row, col, answer: answerText, judged: null };

    $("clue-category").textContent = cat.c;
    $("clue-text").textContent = clueText;
    $("clue-source").textContent = "Real Jeopardy! clue · originally aired " + cat.d;
    $("heard-line").classList.add("hidden");
    $("override-row").classList.add("hidden");
    $("self-judge").classList.add("hidden");
    $("next-btn").classList.add("hidden");
    showState("state-buzz");
    $("clue-modal").classList.remove("hidden");
    beginClue(clueText);
  }

  function startBuzzCountdown() {
    const fill = $("buzz-timer");
    const start = performance.now();
    fill.style.width = "100%";
    stopBuzzCountdown();
    buzzTimer = setInterval(() => {
      const left = 1 - (performance.now() - start) / (BUZZ_SECONDS * 1000);
      fill.style.width = Math.max(0, left * 100) + "%";
      if (left <= 0) {
        stopBuzzCountdown();
        settle(0, null, "⏰ Time! No buzz.");
      }
    }, 100);
  }

  function stopBuzzCountdown() {
    if (buzzTimer) { clearInterval(buzzTimer); buzzTimer = null; }
  }

  function buzz() {
    stopBuzzCountdown();
    stopSpeaking(); // cut the host off — and never let the mic hear the TTS
    if (micEnabled()) startListening();
    else showState("state-say");
  }

  function startListening() {
    showState("state-listen");
    $("live-transcript").textContent = " ";

    let finalAlternatives = [];
    let interim = "";
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
      try { recognizer && recognizer.abort(); } catch (e) {}
      recognizer = null;
      const said = finalAlternatives.length ? finalAlternatives : (interim ? [interim] : []);
      if (!said.length) {
        // heard nothing — let the player judge themselves
        showState("state-say");
        return;
      }
      const right = isCorrect(said, active.answer) ? 1 : 0;
      settle(right, said[0], null);
    };

    try {
      recognizer = new SR();
      recognizer.lang = "en-US";
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 5;
      recognizer.onresult = (ev) => {
        interim = "";
        for (let i = 0; i < ev.results.length; i++) {
          const result = ev.results[i];
          if (result.isFinal) {
            for (let k = 0; k < result.length; k++) finalAlternatives.push(result[k].transcript);
          } else {
            interim += result[0].transcript;
          }
        }
        $("live-transcript").textContent = (finalAlternatives[0] || interim || " ");
        if (finalAlternatives.length) finish();
      };
      recognizer.onerror = () => finish();
      recognizer.onend = () => finish();
      recognizer.start();
      listenTimer = setTimeout(finish, LISTEN_SECONDS * 1000);
    } catch (e) {
      showState("state-say"); // mic failed — fall back to self-judging
    }
  }

  // Record a result and show the verdict screen.
  // heard: transcript (voice mode) or null; note: replaces the verdict text.
  function settle(right, heard, note) {
    active.judged = right;
    state.results[active.row * COLS + active.col] = right;
    save();
    renderScore();

    showState("state-verdict");
    const banner = $("verdict-banner");
    banner.textContent = note || (right ? "✅ Correct! +1 point" : "❌ Not quite.");
    banner.className = "verdict " + (right ? "good" : "bad");
    if (heard) {
      $("heard-line").textContent = `You said: “${heard}”`;
      $("heard-line").classList.remove("hidden");
      const ov = $("override-btn");
      ov.textContent = right ? "It got it wrong — I was incorrect" : "It misheard me — I was right";
      $("override-row").classList.remove("hidden");
    }
    $("answer-text").textContent = active.answer;
    $("next-btn").classList.remove("hidden");
  }

  // Self-judged reveal (no mic, mic failure, pass, or silence).
  function revealSelfJudge() {
    showState("state-verdict");
    $("verdict-banner").textContent = "Were you right?";
    $("verdict-banner").className = "verdict";
    $("answer-text").textContent = active.answer;
    $("self-judge").classList.remove("hidden");
  }

  function selfJudge(right) {
    $("self-judge").classList.add("hidden");
    settle(right, null, right ? "✅ Correct! +1 point" : "❌ Not quite.");
  }

  function overrideVerdict() {
    const flipped = active.judged === 1 ? 0 : 1;
    active.judged = flipped;
    state.results[active.row * COLS + active.col] = flipped;
    save();
    renderScore();
    const banner = $("verdict-banner");
    banner.textContent = flipped ? "✅ Fixed — +1 point" : "Okay — no point";
    banner.className = "verdict " + (flipped ? "good" : "bad");
    $("override-row").classList.add("hidden");
  }

  function pass() {
    stopBuzzCountdown();
    stopSpeaking();
    settle(0, null, "Passed — here's the answer:");
  }

  function nextClue() {
    stopSpeaking();
    active = null;
    $("clue-modal").classList.add("hidden");
    if (state.results.every((r) => r !== null)) showResults();
    else renderBoard();
  }

  /* ---------- leaderboard ---------- */
  function playerName() { return ($("player-name").value || "").trim(); }

  async function submitScore() {
    const res = await fetch(LB_API + "/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seed: state.seed, name: playerName(),
        score: score(), total: COLS * ROWS, grid: emojiGrid(),
      }),
    });
    if (!res.ok) throw new Error("submit failed: " + res.status);
    return res.json();
  }

  async function fetchScores(seed) {
    const res = await fetch(`${LB_API}/scores?seed=${encodeURIComponent(seed)}`);
    if (!res.ok) throw new Error("fetch failed: " + res.status);
    return res.json();
  }

  function renderLbList(el, entries, highlight) {
    el.innerHTML = "";
    if (!entries.length) {
      el.innerHTML = "<div class='lb-empty'>No scores yet today — be the first!</div>";
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    let rank = 0, prevScore = null;
    entries.forEach((e, i) => {
      if (e.score !== prevScore) { rank = i + 1; prevScore = e.score; }
      const row = document.createElement("div");
      row.className = "lb-row" +
        (highlight && e.name.toLowerCase() === highlight.toLowerCase() ? " me" : "");
      const badge = rank <= 3 ? medals[rank - 1] : rank + ".";
      row.innerHTML =
        `<span class="lb-rank">${badge}</span>` +
        `<span class="lb-name"></span>` +
        `<span class="lb-score">${e.score}/${e.total}</span>`;
      row.querySelector(".lb-name").textContent = e.name;
      el.appendChild(row);
    });
  }

  // Submit the finished daily game (if named), then show today's standings.
  function updateResultsLeaderboard() {
    const section = $("results-lb");
    const list = $("results-lb-list");
    if (state.mode !== "daily") { section.classList.add("hidden"); return; }
    section.classList.remove("hidden");
    list.innerHTML = "<div class='lb-empty'>Loading…</div>";
    const seed = state.seed;
    const post = playerName()
      ? submitScore()
      : fetchScores(seed).then((b) => {
          $("lb-no-name").classList.remove("hidden");
          return b;
        });
    post
      .then((b) => renderLbList(list, b.entries, playerName()))
      .catch(() => {
        list.innerHTML = "<div class='lb-empty'>Leaderboard unavailable right now.</div>";
      });
  }

  function openLeaderboard() {
    const seed = todaySeed();
    $("lb-date").textContent = "Daily game · " + seed;
    const list = $("lb-list");
    list.innerHTML = "<div class='lb-empty'>Loading…</div>";
    $("lb-modal").classList.remove("hidden");
    fetchScores(seed)
      .then((b) => renderLbList(list, b.entries, playerName()))
      .catch(() => {
        list.innerHTML = "<div class='lb-empty'>Leaderboard unavailable right now.</div>";
      });
  }

  /* ---------- results ---------- */
  function emojiGrid() {
    let grid = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const res = state.results[r * COLS + c];
        grid += res === 1 ? "🟩" : res === 0 ? "🟥" : "⬜";
      }
      grid += "\n";
    }
    return grid.trimEnd();
  }

  function showResults() {
    state.done = true;
    save();
    $("game-screen").classList.add("hidden");
    $("clue-modal").classList.add("hidden");
    $("results-score").textContent = `${score()} / ${COLS * ROWS}`;
    $("results-grid").textContent = emojiGrid();
    $("lb-no-name").classList.add("hidden");
    $("results-modal").classList.remove("hidden");
    updateResultsLeaderboard();
  }

  function copyResults() {
    const name = ($("player-name").value || "").trim();
    const title = state.mode === "daily"
      ? `Daily Sports Jeopardy! ${state.seed}`
      : "Sports Jeopardy! (random game)";
    const who = name ? ` — ${name}` : "";
    const text = `${title}${who}\n${score()}/${COLS * ROWS}\n${emojiGrid()}`;
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
    $("start-daily").addEventListener("click", () => startGame("daily"));
    $("start-random").addEventListener("click", () => startGame("random"));
    $("buzz-btn").addEventListener("click", buzz);
    $("pass-btn").addEventListener("click", pass);
    $("reveal-btn").addEventListener("click", revealSelfJudge);
    $("self-right").addEventListener("click", () => selfJudge(1));
    $("self-wrong").addEventListener("click", () => selfJudge(0));
    $("override-btn").addEventListener("click", overrideVerdict);
    $("next-btn").addEventListener("click", nextClue);
    $("quit-game").addEventListener("click", () => {
      if (confirm("End this game and see your results?")) showResults();
    });
    $("copy-results").addEventListener("click", copyResults);
    $("back-to-menu").addEventListener("click", backToMenu);
    $("show-lb").addEventListener("click", openLeaderboard);
    $("lb-close").addEventListener("click", () => $("lb-modal").classList.add("hidden"));
  });
})();
