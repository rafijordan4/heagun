require("dotenv").config();
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET to a random secret at least 32 characters long.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to your PostgreSQL connection string.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/style.css", (req, res) => res.sendFile(path.join(__dirname, "style.css")));
app.get("/script.js", (req, res) => res.sendFile(path.join(__dirname, "script.js")));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cleanName = name => String(name || "").trim();
const usernameKey = name => cleanName(name).toLocaleLowerCase("en-US");
function signToken(player) {
  return jwt.sign({ sub: String(player.id), username: player.username }, JWT_SECRET, { expiresIn: "14d" });
}
async function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Silakan login dulu." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await pool.query("SELECT id, username FROM players WHERE id=$1", [payload.sub]);
    if (!result.rowCount) return res.status(401).json({ error: "Sesi tidak valid. Login kembali." });
    req.player = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ error: "Sesi habis atau tidak valid. Login kembali." });
  }
}

app.get("/api/health", (req, res) => res.json({ ok: true, app: "Heagun" }));

app.post("/api/signup", asyncRoute(async (req, res) => {
  const username = cleanName(req.body.username);
  const password = String(req.body.password || "");
  const key = usernameKey(username);
  if (!/^[\p{L}\p{N}_-]{3,20}$/u.test(username)) {
    return res.status(400).json({ error: "Nama harus 3–20 karakter: huruf, angka, _ atau -." });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: "Password harus 8–72 karakter." });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      "INSERT INTO players (username, username_key, password_hash) VALUES ($1,$2,$3) RETURNING id, username",
      [username, key, passwordHash]
    );
    const player = result.rows[0];
    return res.status(201).json({ token: signToken(player), player });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Nama itu sudah dipakai. Pilih nama lain." });
    throw e;
  }
}));

app.post("/api/signin", asyncRoute(async (req, res) => {
  const username = cleanName(req.body.username);
  const password = String(req.body.password || "");
  const result = await pool.query(
    "SELECT id, username, password_hash FROM players WHERE username_key=$1",
    [usernameKey(username)]
  );
  if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) {
    return res.status(401).json({ error: "Nama atau password salah." });
  }
  const player = { id: result.rows[0].id, username: result.rows[0].username };
  return res.json({ token: signToken(player), player });
}));

app.get("/api/me", auth, (req, res) => res.json({ player: req.player }));

app.post("/api/results", auth, asyncRoute(async (req, res) => {
  const mode = req.body.mode;
  const score = Number(req.body.score);
  const duration = Number(req.body.duration || (mode === "online" ? 60 : 30));
  if (!["offline", "online"].includes(mode)) return res.status(400).json({ error: "Mode tidak valid." });
  if (!Number.isInteger(score) || score < 0 || score > 100000) return res.status(400).json({ error: "Skor tidak valid." });
  if (mode === "online") {
    return res.status(400).json({ error: "Skor online hanya disimpan oleh server setelah pertandingan selesai." });
  }
  await pool.query(
    "INSERT INTO game_results (player_id, mode, score, duration_seconds) VALUES ($1,$2,$3,$4)",
    [req.player.id, score, 30]
  );
  res.json({ ok: true });
}));

app.get("/api/leaderboard/:mode", asyncRoute(async (req, res) => {
  const mode = req.params.mode;
  if (!["offline", "online"].includes(mode)) return res.status(400).json({ error: "Mode tidak valid." });
  const result = await pool.query(`
    SELECT p.username, MAX(g.score)::int AS score, MIN(g.created_at) AS achieved_at
    FROM game_results g JOIN players p ON p.id=g.player_id
    WHERE g.mode=$1
    GROUP BY p.id, p.username
    ORDER BY score DESC, achieved_at ASC
    LIMIT 50
  `, [mode]);
  res.json({ mode, entries: result.rows });
}));

// Lightweight server-authoritative matchmaking. Match timer and scores live on the server.
const waiting = [];
const activeMatches = new Map();
const socketPlayers = new Map();
const onlineByPlayer = new Map();
function verifySocketToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function publicMatchState(match, playerId) {
  const opponentId = match.players.find(id => id !== playerId);
  return {
    matchId: match.id,
    username: match.names[playerId],
    opponent: match.names[opponentId],
    score: match.scores[playerId] || 0,
    opponentScore: match.scores[opponentId] || 0,
    remaining: Math.max(0, Math.ceil((match.endsAt - Date.now()) / 1000))
  };
}
function sendMatchState(match) {
  for (const pid of match.players) {
    const sid = onlineByPlayer.get(pid);
    if (sid) io.to(sid).emit("match:state", publicMatchState(match, pid));
  }
}
async function finishMatch(match, reason = "time") {
  if (!match || match.finished) return;
  match.finished = true;
  clearInterval(match.interval);
  activeMatches.delete(match.id);
  const [a, b] = match.players;
  const winnerId = (match.scores[a] || 0) === (match.scores[b] || 0) ? null :
    ((match.scores[a] || 0) > (match.scores[b] || 0) ? a : b);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO game_results (player_id, mode, score, duration_seconds, opponent_id, match_id) VALUES ($1,'online',$2,60,$3,$4),($3,'online',$5,60,$1,$4)",
      [a, match.scores[a] || 0, b, match.id, match.scores[b] || 0]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(()=>{});
    console.error("Unable to save online match:", e.message);
  } finally { client.release(); }
  for (const pid of match.players) {
    const sid = onlineByPlayer.get(pid);
    if (sid) io.to(sid).emit("match:over", {
      ...publicMatchState(match, pid),
      winner: winnerId ? match.names[winnerId] : null,
      draw: !winnerId,
      reason
    });
  }
}
function pairPlayers() {
  while (waiting.length >= 2) {
    const p1 = waiting.shift(), p2 = waiting.shift();
    if (!onlineByPlayer.has(p1) || !onlineByPlayer.has(p2) || p1 === p2) continue;
    const id = crypto.randomUUID();
    const match = {
      id, players: [p1,p2],
      names: { [p1]: socketPlayers.get(p1).username, [p2]: socketPlayers.get(p2).username },
      scores: { [p1]: 0, [p2]: 0 },
      endsAt: Date.now() + 60000, finished: false, targets: {}
    };
    activeMatches.set(id, match);
    for (const pid of match.players) {
      const sid = onlineByPlayer.get(pid);
      if (sid) io.to(sid).emit("match:found", { matchId: id, opponent: match.names[match.players.find(x=>x!==pid)], duration: 60 });
      match.targets[pid] = Math.floor(Math.random()*9);
    }
    sendMatchState(match);
    match.interval = setInterval(() => {
      if (Date.now() >= match.endsAt) return finishMatch(match);
      for (const pid of match.players) {
        const sid = onlineByPlayer.get(pid);
        if (sid) io.to(sid).emit("match:tick", {
          remaining: Math.max(0, Math.ceil((match.endsAt-Date.now())/1000)),
          target: match.targets[pid],
          score: match.scores[pid],
          opponentScore: match.scores[match.players.find(x=>x!==pid)]
        });
      }
    }, 250);
  }
}
io.on("connection", socket => {
  socket.on("auth", token => {
    const payload = verifySocketToken(token);
    if (!payload) return socket.emit("auth:error", { error: "Sesi tidak valid. Login ulang." });
    const pid = String(payload.sub);
    socketPlayers.set(pid, { username: payload.username, socketId: socket.id });
    onlineByPlayer.set(pid, socket.id);
    socket.data.playerId = pid;
    socket.emit("auth:ok", { username: payload.username });
  });
  socket.on("queue:join", () => {
    const pid = socket.data.playerId;
    if (!pid || !onlineByPlayer.has(pid)) return socket.emit("queue:error", { error: "Login dulu untuk tanding online." });
    if ([...activeMatches.values()].some(m => m.players.includes(pid))) return socket.emit("queue:error", { error: "Kamu sedang bertanding." });
    if (!waiting.includes(pid)) waiting.push(pid);
    socket.emit("queue:waiting", { position: waiting.length });
    pairPlayers();
  });
  socket.on("queue:leave", () => {
    const pid = socket.data.playerId;
    const idx = waiting.indexOf(pid);
    if (idx >= 0) waiting.splice(idx,1);
    socket.emit("queue:left");
  });
  socket.on("match:hit", data => {
    const pid = socket.data.playerId;
    const match = [...activeMatches.values()].find(m => m.players.includes(pid));
    if (!match || match.finished || Date.now() >= match.endsAt) return;
    const hole = Number(data && data.hole);
    if (!Number.isInteger(hole) || hole < 0 || hole > 8 || hole !== match.targets[pid]) return;
    match.scores[pid] = (match.scores[pid] || 0) + 10;
    let next = Math.floor(Math.random()*9);
    if (next === hole) next = (next+1)%9;
    match.targets[pid] = next;
    sendMatchState(match);
  });
  socket.on("disconnect", () => {
    const pid = socket.data.playerId;
    if (!pid) return;
    if (onlineByPlayer.get(pid) === socket.id) {
      onlineByPlayer.delete(pid);
      const idx = waiting.indexOf(pid);
      if (idx >= 0) waiting.splice(idx,1);
      const match = [...activeMatches.values()].find(m => m.players.includes(pid));
      if (match) finishMatch(match, "disconnect");
    }
    socketPlayers.delete(pid);
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Terjadi kesalahan server. Coba lagi nanti." });
});
server.listen(PORT, () => console.log(`Heagun berjalan di port ${PORT}`));
