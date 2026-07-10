# Daily Sports Jeopardy!

A quick, phone-first sports trivia game built on **real sports clues from past Jeopardy! episodes** (seasons 18–40, aired 2001–2024).

Everyone who plays the daily game on the same calendar date gets the **exact same board** — so you and your friends can each play on your own phones and compare scores, Wordle-style.

## How it works

- **One round, 30 clues** (6 sports categories × 5 clues) — no Double Jeopardy, no Final Jeopardy, no wagering.
- **Every clue is worth 1 point**, and wrong answers cost nothing — so always guess!
- **The host reads each clue aloud** in a deep game-show voice (your device's best English text-to-speech voice — on Apple devices it's literally the one named "Alex"). The 12-second buzz timer starts when the host finishes; buzzing early just cuts the host off.
- **Tap to buzz in**: hit the big red buzzer before the timer runs out.
- **Answer by voice**: after buzzing, speak your answer into the microphone. Speech recognition transcribes it and checks it against the real answer (fuzzy matching handles "what is…" phrasing, articles, close spellings, and accepted alternates). If it mishears you, one tap fixes the verdict.
- **No mic? No problem**: on browsers without speech recognition (or if you decline mic access), you say your answer out loud, reveal the real one, and judge yourself.
- At the end you get a score out of 30 and a shareable emoji grid of your board:

```
Daily Sports Jeopardy! 2026-07-10 — Ana
21/30
🟩🟩🟥🟩🟩🟩
🟩🟥🟩🟩🟩🟥
...
```

Your game saves in the browser, so a refresh resumes where you left off. There's also a **random game** mode for extra rounds.

## Leaderboard

Daily games post to a **shared leaderboard**: finish today's board with a name entered and your score appears in the day's standings, shown right on the results screen (and anytime via the *Today's leaderboard* button on the start screen). Same name + same day = your latest score. Random games don't post.

The backend is a tiny zero-dependency Python/SQLite server in [`leaderboard/`](leaderboard/) — see that folder's README for deploy instructions. If it's unreachable, the game just plays without standings.

## Playing it

Open `index.html` in a browser. For a URL you can send to friends, enable GitHub Pages: repo **Settings → Pages → Source: Deploy from a branch**, pick your branch and `/ (root)` — the game goes live at `https://<username>.github.io/Jeopardy/`.

Note: voice answers need a secure context (HTTPS or localhost) and work best in Chrome on Android and Safari on iOS. GitHub Pages is HTTPS, so it works great there.

## Where the clues come from

Clue data is extracted from [jwolle1/jeopardy_clue_dataset](https://github.com/jwolle1/jeopardy_clue_dataset), a public dataset built from [J! Archive](https://j-archive.com/). Sports categories are detected two ways: by category name (NFL, OLYMPIC, BASEBALL, …) and by content (categories where nearly every clue uses sports terms). The bundled `clues.js` has **694 complete 5-clue sports categories**; the game draws 6 per day from the pool, seeded by the date, so no server is needed for everyone to see the same game.

Categories that depend on video, audio, or images ("seen here…", Clue Crew clues) are filtered out so everything works as text.

> **Note:** Jeopardy! clues are the copyrighted material of Sony Pictures / Jeopardy Productions. This project is for personal, non-commercial play among friends.
