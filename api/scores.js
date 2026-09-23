/* Leaderboard API.

   GET  /api/scores?game=snap   → top 50 for that game
   GET  /api/scores?game=all    → overall: every player's best in each game, summed
   POST /api/scores             → {player, game, score, level} records one run

   A player is just a display name. The board keeps each player's BEST run per
   game, so a bad run can never cost you a place you already earned.          */
const { neon } = require('@neondatabase/serverless');

const GAMES = ['deductive', 'swith', 'grid', 'inductive', 'motion', 'echo', 'snap'];
const TOP = 50;

function db(){
  var url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('no database configured');
  return neon(url);
}

/* One table, created on first use so there is no migration step to forget. */
let ready = null;
async function ensure(sql){
  if (!ready){
    ready = sql`
      CREATE TABLE IF NOT EXISTS scores (
        id         bigserial PRIMARY KEY,
        player     text        NOT NULL,
        game       text        NOT NULL,
        score      integer     NOT NULL,
        level      integer     NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now()
      )`.then(function (){
        return sql`CREATE INDEX IF NOT EXISTS scores_game_score ON scores (game, score DESC)`;
      });
  }
  return ready;
}

function clean(name){
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

module.exports = async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');

  let sql;
  try {
    sql = db();
    await ensure(sql);
  } catch (e){
    res.status(503).json({error:'leaderboard unavailable', detail:String(e.message || e)});
    return;
  }

  try {
    if (req.method === 'GET'){
      const game = String((req.query && req.query.game) || 'all');

      if (game === 'all'){
        /* a player's total is the sum of their best run in each game, so
           breadth counts for as much as a single freak score */
        const rows = await sql`
          SELECT player,
                 SUM(best)::int   AS score,
                 COUNT(*)::int    AS games
          FROM (
            SELECT player, game, MAX(score) AS best
            FROM scores
            GROUP BY player, game
          ) t
          GROUP BY player
          ORDER BY score DESC, games DESC
          LIMIT ${TOP}`;
        res.status(200).json({game:'all', rows:rows});
        return;
      }

      if (GAMES.indexOf(game) < 0){
        res.status(400).json({error:'unknown game'});
        return;
      }

      const rows = await sql`
        SELECT player,
               MAX(score)::int          AS score,
               MAX(level)::int          AS level,
               COUNT(*)::int            AS runs,
               MAX(created_at)          AS last_played
        FROM scores
        WHERE game = ${game}
        GROUP BY player
        ORDER BY score DESC, level DESC
        LIMIT ${TOP}`;
      res.status(200).json({game:game, rows:rows});
      return;
    }

    if (req.method === 'POST'){
      let body = req.body;
      if (typeof body === 'string'){ try { body = JSON.parse(body); } catch (e){ body = {}; } }
      body = body || {};

      const player = clean(body.player);
      const game = String(body.game || '');
      const score = Math.round(Number(body.score));
      const level = Math.max(1, Math.round(Number(body.level) || 1));

      if (!player){ res.status(400).json({error:'name required'}); return; }
      if (GAMES.indexOf(game) < 0){ res.status(400).json({error:'unknown game'}); return; }
      if (!isFinite(score) || score < -999 || score > 9999){
        res.status(400).json({error:'score out of range'});
        return;
      }

      await sql`
        INSERT INTO scores (player, game, score, level)
        VALUES (${player}, ${game}, ${score}, ${level})`;

      /* where this player now stands in that game, and overall */
      const [gameRank] = await sql`
        SELECT COUNT(*)::int + 1 AS rank
        FROM (SELECT player, MAX(score) AS best FROM scores WHERE game = ${game} GROUP BY player) t
        WHERE t.best > (SELECT MAX(score) FROM scores WHERE game = ${game} AND player = ${player})`;

      const [best] = await sql`
        SELECT MAX(score)::int AS best FROM scores WHERE game = ${game} AND player = ${player}`;

      res.status(200).json({
        ok: true,
        player: player,
        best: best ? best.best : score,
        rank: gameRank ? gameRank.rank : null
      });
      return;
    }

    res.status(405).json({error:'method not allowed'});
  } catch (e){
    res.status(500).json({error:'query failed', detail:String(e.message || e)});
  }
};
