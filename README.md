# Cognitive Ability Games

Five aptitude-style cognitive drills, in the formats placement tests actually use. Every game is a
plain HTML page — no build step, no framework, no server. Open `index.html` and play.

| Game | What it trains | Task | Scoring |
| --- | --- | --- | --- |
| [Deductive Challenge](deductive.html) | Processing speed | Fill the `?` in an n×n matrix so neither its row nor its column repeats a symbol | +1 / −1 |
| [Swith Challenge](swith.html) | Logical thinking | Read the input row against the output row and pick the code that maps one onto the other | +3 / −1 |
| [Grid Challenge](grid.html) | Attention and memory | Memorise a dot, answer a symmetry question, three times over, then recall the dots in order | +3 / −1 |
| [Inductive Challenge](inductive.html) | Recognition | Work out the rule behind one pair of grids, then find the pair among four that follows it | +3 / −1 |
| [Motion Challenge](motion.html) | Planning, decision making | Slide blocks aside to roll the ball into the hole inside a move limit | +4 / −1 |
| [Echo](echo.html) | Working memory | Tap when a streaming symbol repeats the one n steps back, from 2-back up to 4-back | +3 / −1 |
| [Snap](snap.html) | Attention, impulse control | Tap the colour the word is printed in, not the word — with the rule flipping mid-round | +3 / −1 |

Each session runs for four minutes. Levels get harder as you go: bigger matrices, longer codes, more
dots, tighter move limits.

## Files

    index.html        the hub — cards and Play buttons
    common.css        top bar, overlays, buttons: the chrome every game shares
    common.js         the engine — session clock, level clock, scoring, intro/pause/results screens
    deductive.html    \
    swith.html         |
    grid.html          |  one page per game, each supplying only its own board logic
    inductive.html     |
    motion.html        |
    echo.html          |
    snap.html         /

Keep the folder together: the games load `common.css` and `common.js` from beside them.

`common.js` exposes one entry point. A game hands it its rules text and a `buildLevel(api, board)`
function, then calls `api.right()` or `api.wrong()`; the engine owns everything else. Games that
run a stream of trials inside one level (Echo, Snap) score each trial with `api.tally(delta)` and
call `api.nextLevel()` when the round ends.

## Motion Challenge levels

Boards are generated at random and then checked with a breadth-first solver before they are shown,
so every board is solvable, the move limit is always the true optimum plus two, and any board the
ball could reach the hole on without shifting a block is thrown away.

## Leaderboard

`leaderboard.html` shows an overall board plus one per game. A run is posted when the four minutes
are up; each player's BEST run per game is what ranks, and the overall total is the sum of those
bests, so breadth beats grinding a single game.

    api/scores.js     GET  ?game=<slug>|all   top 50
                      POST {player, game, score, level}
    package.json      the one dependency the API needs

Storage is Neon Postgres, provisioned through the Vercel Marketplace, read from `DATABASE_URL`. The
table is created on first use — there is no migration step. A player is a display name kept in that
browser's localStorage; there are no accounts, so treat the board as a friendly ranking rather than
an audited record.

If the API is unreachable the games keep working and the run is queued in localStorage, then posted
on the next finish.

## Feedback

Every game carries a feedback button: a star rating, an open comment and an "anything to add or
change?" box. Answers post to a Google Form in the background. Until the form is wired up they are
kept in the player's own browser and sent on the next load — see `FEEDBACK-SETUP.md` in the parent
folder for the four values to fill into `nfbConfig`.

## Local use

No tooling required. Double-click `index.html`, or serve the folder:

    python -m http.server 8000
