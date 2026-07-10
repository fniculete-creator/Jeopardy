# Daily Jeopardy!

A Jeopardy game you can play with friends every day, using **real clues from past Jeopardy! episodes** (seasons 37–40, aired 2020–2024).

Everyone who plays the "daily" game on the same calendar date gets the **exact same board** — same categories, same Daily Double spots, same Final Jeopardy — so you can compare scores with friends, Wordle-style.

## How to play

1. Open `index.html` in a browser (or host the folder on GitHub Pages — see below).
2. Enter player names (1–6 players) and hit **Play today's game**.
3. One person acts as host: click a dollar value, read the clue aloud, let people answer, then **Show answer** and tap ✓ or ✗ next to each player who rang in.
4. Play through **Jeopardy!**, **Double Jeopardy!** (with Daily Doubles and wagers), and **Final Jeopardy!** with per-player wagers.
5. At the end, use **Copy results to share** to paste your scores into your group chat.

Extras:

- Game state is saved in your browser, so a refresh resumes today's game.
- Tap any score to manually correct it (host override).
- **Play a random game** gives you a fresh board any time, independent of the daily one.

## Hosting on GitHub Pages

To get a URL you can send to friends: repo **Settings → Pages → Source: Deploy from a branch**, pick your branch and `/ (root)`. Your game will be live at `https://<username>.github.io/Jeopardy/`.

## Where the clues come from

Clue data is extracted from [jwolle1/jeopardy_clue_dataset](https://github.com/jwolle1/jeopardy_clue_dataset), a public dataset built from [J! Archive](https://j-archive.com/). The bundled `clues.js` contains:

- 4,931 complete Jeopardy! round categories (5 clues each)
- 4,717 complete Double Jeopardy! round categories
- 920 Final Jeopardy! clues

Categories that depend on video, audio, or images ("seen here…", Clue Crew clues) are filtered out so everything works as text.

The daily board is chosen with a seeded random number generator keyed on the local calendar date, so no server is needed for everyone to see the same game.

> **Note:** Jeopardy! clues are the copyrighted material of Sony Pictures / Jeopardy Productions. This project is for personal, non-commercial play among friends.
