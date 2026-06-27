const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024
});
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();
let db = loadDb();

function loadDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DB_FILE)) {
    const adminUsername = process.env.ADMIN_USERNAME || 'xhuyvu';
    const adminPassword = process.env.ADMIN_PASSWORD || 'xhuyvu123';
    const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || 'Admin';
    const initialDb = { users: [], adminLogs: [], sessions: [], battleLogs: [] };
    initialDb.users.push(makeUser(adminUsername, adminPassword, adminDisplayName, true));
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
    console.log(`Đã tạo admin mặc định: ${adminUsername} / ${adminPassword}`);
    return initialDb;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    migrateDb(parsed);
    saveDbObject(parsed);
    return parsed;
  } catch (err) {
    console.error('Không đọc được data/db.json:', err);
    return { users: [], adminLogs: [], sessions: [], battleLogs: [] };
  }
}

function saveDb() {
  saveDbObject(db);
}

function saveDbObject(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function migrateDb(data) {
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.adminLogs)) data.adminLogs = [];
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.battleLogs)) data.battleLogs = [];
  for (const user of data.users) ensureUserFields(user);
}

function ensureUserFields(user) {
  if (!user) return user;
  if (!Array.isArray(user.recentGames)) user.recentGames = [];
  if (!Array.isArray(user.matchHistory)) user.matchHistory = [];
  if (!Array.isArray(user.friends)) user.friends = [];
  if (!Array.isArray(user.incomingFriendRequests)) user.incomingFriendRequests = [];
  if (!Array.isArray(user.outgoingFriendRequests)) user.outgoingFriendRequests = [];
  if (!Number.isInteger(user.currentWinStreak)) user.currentWinStreak = 0;
  if (!Number.isInteger(user.bestWinStreak)) user.bestWinStreak = Math.max(0, user.currentWinStreak || 0);
  if (!Array.isArray(user.ipHistory)) user.ipHistory = [];
  if (typeof user.lastIp !== 'string') user.lastIp = '';
  if (typeof user.isVip !== 'boolean') user.isVip = false;
  return user;
}

function makeUser(username, password, displayName, isAdmin = false, isVip = false) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: crypto.randomUUID(),
    username: normalizeUsername(username),
    displayName: cleanText(displayName || username, 24),
    salt,
    passwordHash: hashPassword(password, salt),
    isAdmin: !!isAdmin,
    isVip: !!isVip,
    avatar: '',
    background: '',
    recentGames: [],
    matchHistory: [],
    friends: [],
    incomingFriendRequests: [],
    outgoingFriendRequests: [],
    currentWinStreak: 0,
    bestWinStreak: 0,
    lastIp: '',
    ipHistory: [],
    createdAt: new Date().toISOString()
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function verifyPassword(user, password) {
  const given = hashPassword(password, user.salt);
  const a = Buffer.from(given, 'hex');
  const b = Buffer.from(user.passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createSession(userId) {
  if (!Array.isArray(db.sessions)) db.sessions = [];
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(token),
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString()
  });

  // Giữ file db gọn: mỗi tài khoản tối đa 10 phiên đăng nhập gần nhất.
  const userSessions = db.sessions.filter(s => s.userId === userId);
  if (userSessions.length > 10) {
    const keep = new Set(userSessions.slice(-10).map(s => s.id));
    db.sessions = db.sessions.filter(s => s.userId !== userId || keep.has(s.id));
  }

  saveDb();
  return token;
}

function getUserBySessionToken(token) {
  if (!token || !Array.isArray(db.sessions)) return null;
  const tokenHash = hashToken(token);
  const session = db.sessions.find(s => s.tokenHash === tokenHash);
  if (!session) return null;
  const user = getUserById(session.userId);
  if (!user) {
    db.sessions = db.sessions.filter(s => s.tokenHash !== tokenHash);
    saveDb();
    return null;
  }
  session.lastUsedAt = new Date().toISOString();
  saveDb();
  return user;
}

function attachUserToSocket(socket, user) {
  socket.data.authType = 'user';
  socket.data.userId = user.id;
}

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 24);
}

function cleanText(value, max = 40) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
}

function getClientIp(socket) {
  const headers = socket?.handshake?.headers || {};
  const forwarded = headers['x-forwarded-for'] || headers['x-real-ip'] || headers['cf-connecting-ip'];
  let ip = '';
  if (Array.isArray(forwarded)) ip = forwarded[0] || '';
  else if (typeof forwarded === 'string') ip = forwarded.split(',')[0].trim();
  if (!ip) ip = socket?.handshake?.address || socket?.conn?.remoteAddress || '';
  return cleanText(ip.replace(/^::ffff:/, ''), 80) || 'unknown';
}

function recordIpForUser(user, socket) {
  if (!user) return;
  ensureUserFields(user);
  const ip = getClientIp(socket);
  user.lastIp = ip;
  const now = new Date().toISOString();
  user.ipHistory = (user.ipHistory || []).filter(item => item && item.ip !== ip);
  user.ipHistory.push({ ip, at: now });
  user.ipHistory = user.ipHistory.slice(-10);
}

function cleanImage(value, maxBytes) {
  const img = String(value || '').trim();
  if (!img) return '';
  if (!img.startsWith('data:image/')) throw new Error('Ảnh phải là file ảnh hợp lệ.');
  const bytes = Buffer.byteLength(img, 'utf8');
  if (bytes > maxBytes) throw new Error(`Ảnh quá nặng. Tối đa ${Math.round(maxBytes / 1024 / 1024)}MB.`);
  return img;
}

function getUserById(id) {
  return db.users.find(u => u.id === id) || null;
}

function getUserByUsername(username) {
  const normalized = normalizeUsername(username);
  return db.users.find(u => u.username === normalized) || null;
}

function recentStats(user) {
  const recent = Array.isArray(user.recentGames) ? user.recentGames.slice(-10).reverse() : [];
  const total = recent.length;
  const wins = recent.filter(g => g.result === 'win').length;
  const losses = recent.filter(g => g.result === 'loss').length;
  const draws = recent.filter(g => g.result === 'draw').length;
  return {
    total,
    wins,
    losses,
    draws,
    winRate: total ? Math.round((wins / total) * 100) : 0,
    recent
  };
}

function safeUser(user) {
  if (!user) return null;
  return {
    type: 'user',
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: !!user.isAdmin,
    isVip: !!user.isVip,
    roleBadges: roleBadgesForUser(user),
    avatar: user.avatar || '',
    background: user.background || '',
    currentWinStreak: user.currentWinStreak || 0,
    bestWinStreak: user.bestWinStreak || 0,
    stats: recentStats(user)
  };
}

function safeGuest(socket) {
  return {
    type: 'guest',
    id: null,
    username: 'guest',
    displayName: socket.data.guestName || 'Khách',
    isAdmin: false,
    isVip: false,
    roleBadges: [],
    avatar: '',
    background: '',
    stats: {
      total: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
      recent: []
    }
  };
}


function roleBadgesForUser(user) {
  const badges = [];
  if (user?.isAdmin) badges.push({ type: 'admin', icon: '🛡️', label: 'ADMIN' });
  if (user?.isVip) badges.push({ type: 'vip', icon: '💎', label: 'VIP' });
  return badges;
}

function roleEffectType(playerOrUser) {
  if (playerOrUser?.isAdmin) return 'admin';
  if (playerOrUser?.isVip) return 'vip';
  return '';
}

function roomEffectForPlayer(player, action = 'vào phòng') {
  const type = roleEffectType(player);
  if (!type) return null;
  const badges = player.roleBadges || [];
  const icons = badges.map(b => b.icon).join(' ') || (type === 'admin' ? '🛡️' : '💎');
  const labels = badges.map(b => b.label).join(' + ') || (type === 'admin' ? 'ADMIN' : 'VIP');
  return {
    id: crypto.randomUUID(),
    type,
    icons,
    labels,
    name: player.name || player.displayName || 'Người chơi',
    message: `${icons} ${labels} ${player.name || player.displayName || 'Người chơi'} đã ${action}!`,
    at: new Date().toISOString()
  };
}

function emitRoomEffect(room, player, action = 'vào phòng') {
  const effect = roomEffectForPlayer(player, action);
  if (!effect || !room?.code) return;
  io.to(room.code).emit('roomEffect', effect);
}

function currentProfile(socket) {
  if (socket.data.authType === 'user') return safeUser(getUserById(socket.data.userId));
  if (socket.data.authType === 'guest') return safeGuest(socket);
  return null;
}

function socketsForUser(userId) {
  const sockets = [];
  io.sockets.sockets.forEach((s) => {
    if (s.data.authType === 'user' && s.data.userId === userId) sockets.push(s);
  });
  return sockets;
}

function isUserOnline(userId) {
  return socketsForUser(userId).length > 0;
}

function miniUser(user) {
  ensureUserFields(user);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar || '',
    isAdmin: !!user.isAdmin,
    isVip: !!user.isVip,
    roleBadges: roleBadgesForUser(user),
    online: isUserOnline(user.id),
    currentWinStreak: user.currentWinStreak || 0,
    bestWinStreak: user.bestWinStreak || 0
  };
}

function medalForRank(rank) {
  if (rank === 1) return { rank, icon: '🥇', label: 'Top 1 chuỗi thắng' };
  if (rank === 2) return { rank, icon: '🥈', label: 'Top 2 chuỗi thắng' };
  if (rank === 3) return { rank, icon: '🥉', label: 'Top 3 chuỗi thắng' };
  return null;
}

function getLeaderboard(limit = 20) {
  return db.users
    .map((u) => {
      ensureUserFields(u);
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar || '',
        isAdmin: !!u.isAdmin,
        isVip: !!u.isVip,
        roleBadges: roleBadgesForUser(u),
        currentWinStreak: u.currentWinStreak || 0,
        bestWinStreak: u.bestWinStreak || 0,
        recentTotal: Array.isArray(u.recentGames) ? u.recentGames.length : 0
      };
    })
    .filter(u => Number(u.currentWinStreak || 0) >= 3)
    .sort((a, b) =>
      (b.currentWinStreak - a.currentWinStreak) ||
      (b.bestWinStreak - a.bestWinStreak) ||
      a.displayName.localeCompare(b.displayName, 'vi')
    )
    .slice(0, limit)
    .map((u, idx) => ({ ...u, rank: idx + 1, badge: medalForRank(idx + 1) }));
}

function badgeForAccount(accountId) {
  if (!accountId) return null;
  const top3 = getLeaderboard(3);
  const item = top3.find(u => u.id === accountId);
  return item ? item.badge : null;
}


function adminUserSummary(user) {
  ensureUserFields(user);
  const stats = recentStats(user);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: !!user.isAdmin,
    isVip: !!user.isVip,
    roleBadges: roleBadgesForUser(user),
    avatar: user.avatar || '',
    online: isUserOnline(user.id),
    lastIp: user.lastIp || '',
    ipHistory: user.ipHistory || [],
    currentWinStreak: user.currentWinStreak || 0,
    bestWinStreak: user.bestWinStreak || 0,
    totalSavedGames: Array.isArray(user.matchHistory) ? user.matchHistory.length : (Array.isArray(user.recentGames) ? user.recentGames.length : 0),
    stats,
    createdAt: user.createdAt || ''
  };
}

function getAdminUsers() {
  return db.users
    .map(adminUserSummary)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
}

function getUserHistoryForAdmin(userId, limit = 100) {
  const user = getUserById(userId);
  if (!user) return null;
  ensureUserFields(user);
  const history = (Array.isArray(user.matchHistory) && user.matchHistory.length ? user.matchHistory : user.recentGames || [])
    .slice(-limit)
    .reverse();
  return { user: adminUserSummary(user), history };
}

function getBattleLogs(limit = 100) {
  if (!Array.isArray(db.battleLogs)) db.battleLogs = [];
  return db.battleLogs.slice(-limit).reverse();
}

function emitAdminUsersToSocket(socket) {
  const p = currentProfile(socket);
  if (p?.isAdmin) socket.emit('adminUsersState', { users: getAdminUsers() });
}

function broadcastAdminUsers() {
  io.sockets.sockets.forEach((s) => emitAdminUsersToSocket(s));
}

function broadcastAdminBattleLogs() {
  io.sockets.sockets.forEach((s) => {
    const p = currentProfile(s);
    if (p?.isAdmin) s.emit('adminBattleLogsState', { logs: getBattleLogs(100) });
  });
}

function getSocialState(userId) {
  const user = getUserById(userId);
  if (!user) return null;
  ensureUserFields(user);

  const friends = user.friends
    .map(id => getUserById(id))
    .filter(Boolean)
    .map(miniUser)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName, 'vi'));

  const incoming = user.incomingFriendRequests
    .map(id => getUserById(id))
    .filter(Boolean)
    .map(miniUser);

  const outgoing = user.outgoingFriendRequests
    .map(id => getUserById(id))
    .filter(Boolean)
    .map(miniUser);

  return { friends, incoming, outgoing };
}

function emitSocialStateToSocket(socket) {
  if (socket.data.authType !== 'user') return;
  const social = getSocialState(socket.data.userId);
  if (social) socket.emit('socialState', social);
}

function emitSocialStateToUser(userId) {
  socketsForUser(userId).forEach(emitSocialStateToSocket);
}

function broadcastSocialForUserAndFriends(userId) {
  const user = getUserById(userId);
  if (!user) return;
  ensureUserFields(user);
  const ids = new Set([user.id, ...user.friends, ...user.incomingFriendRequests, ...user.outgoingFriendRequests]);
  ids.forEach(emitSocialStateToUser);
}

function emitLeaderboardToSocket(socket) {
  socket.emit('leaderboardState', { leaderboard: getLeaderboard(20) });
}

function broadcastLeaderboard() {
  io.emit('leaderboardState', { leaderboard: getLeaderboard(20) });
}

function relationStatus(me, other) {
  ensureUserFields(me);
  if (me.id === other.id) return 'self';
  if (me.friends.includes(other.id)) return 'friend';
  if (me.incomingFriendRequests.includes(other.id)) return 'incoming';
  if (me.outgoingFriendRequests.includes(other.id)) return 'outgoing';
  return 'none';
}

function searchUsersFor(me, query) {
  const q = cleanText(query, 40).toLowerCase();
  if (!q) return [];
  return db.users
    .filter(u => u.id !== me.id)
    .filter(u => u.username.includes(q) || String(u.displayName || '').toLowerCase().includes(q))
    .slice(0, 10)
    .map(u => ({ ...miniUser(u), relation: relationStatus(me, u) }));
}

function actorForLog(socket) {
  if (!socket) {
    return {
      type: 'system',
      accountId: null,
      username: 'system',
      name: 'Hệ thống',
      guestId: null,
      socketId: null,
      ip: ''
    };
  }

  if (socket.data.authType === 'user') {
    const user = getUserById(socket.data.userId);
    return {
      type: 'user',
      accountId: user?.id || socket.data.userId || null,
      username: user?.username || 'unknown',
      name: user?.displayName || user?.username || 'Không rõ',
      guestId: null,
      socketId: socket.id,
      ip: getClientIp(socket)
    };
  }

  if (socket.data.authType === 'guest') {
    return {
      type: 'guest',
      accountId: null,
      username: 'guest',
      name: socket.data.guestName || 'Khách',
      guestId: socket.id,
      socketId: socket.id,
      ip: getClientIp(socket)
    };
  }

  return {
    type: 'anonymous',
    accountId: null,
    username: 'anonymous',
    name: 'Chưa đăng nhập',
    guestId: null,
    socketId: socket.id,
    ip: getClientIp(socket)
  };
}

function sanitizeLogDetails(value, depth = 0) {
  if (depth > 3) return '[too-deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return cleanText(value, 240);
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitizeLogDetails(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (lower.includes('password') || lower.includes('hash') || lower.includes('salt')) continue;
      if (lower.includes('avatar') || lower.includes('background')) {
        out[key] = val ? '[image]' : '';
        continue;
      }
      out[key] = sanitizeLogDetails(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

function addAdminLog(event, socket = null, details = {}) {
  if (!Array.isArray(db.adminLogs)) db.adminLogs = [];
  const actor = actorForLog(socket);
  const entry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    event: cleanText(event, 40),
    actor,
    roomCode: cleanText(details.roomCode || socket?.data?.roomCode || '', 12),
    details: sanitizeLogDetails(details)
  };
  db.adminLogs.push(entry);
  db.adminLogs = db.adminLogs.slice(-1000);
  saveDb();

  io.sockets.sockets.forEach((s) => {
    const p = currentProfile(s);
    if (p?.isAdmin) s.emit('adminLogAdded', entry);
  });

  return entry;
}

function actorLabel(actor) {
  if (!actor) return 'Không rõ';
  if (actor.type === 'user') return `${actor.name} (@${actor.username})`;
  if (actor.type === 'guest') return `${actor.name} (Khách)`;
  if (actor.type === 'system') return 'Hệ thống';
  return actor.name || 'Không rõ';
}

function requireAuth(socket, cb) {
  const profile = currentProfile(socket);
  if (!profile) {
    cb?.({ ok: false, error: 'Bạn cần đăng nhập hoặc vào với tư cách khách.' });
    return null;
  }
  return profile;
}

function sendProfile(socket) {
  const profile = currentProfile(socket);
  if (profile) socket.emit('profileState', profile);
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function tier(points) {
  if (points >= 80) return 'A';
  if (points >= 60) return 'B';
  if (points >= 40) return 'C';
  if (points >= 20) return 'D';
  return 'E';
}

function colorOf(bid) {
  return bid <= 9 ? 'ĐEN' : 'TRẮNG';
}

function profileForPlayer(socket) {
  const profile = currentProfile(socket);
  return {
    accountId: profile.type === 'user' ? profile.id : null,
    isGuest: profile.type === 'guest',
    username: profile.type === 'user' ? profile.username : 'guest',
    name: profile.displayName,
    avatar: profile.avatar || '',
    background: profile.background || '',
    isAdmin: !!profile.isAdmin,
    isVip: !!profile.isVip,
    roleBadges: profile.roleBadges || [],
    ip: getClientIp(socket)
  };
}

function maskLastRound(lastRound, viewerSeat) {
  if (!lastRound) return null;
  return {
    ...lastRound,
    players: lastRound.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      avatar: p.avatar || '',
      color: p.color,
      tier: p.tier,
      remaining: p.seat === viewerSeat ? p.remaining : null
    }))
  };
}

function publicRoom(room, viewerSeat = null) {
  return {
    code: room.code,
    started: room.started,
    finished: room.finished,
    round: room.round,
    maxRounds: room.maxRounds,
    targetWins: room.targetWins || 5,
    firstSeat: room.firstSeat,
    lastWinnerSeat: room.lastWinnerSeat,
    phase: room.phase,
    players: room.players.map((p, idx) => ({
      seat: idx,
      name: p?.name || null,
      avatar: p?.avatar || '',
      background: p?.background || '',
      badge: p?.accountId ? badgeForAccount(p.accountId) : null,
      isAdmin: !!p?.isAdmin,
      isVip: !!p?.isVip,
      roleBadges: p?.roleBadges || [],
      effectType: roleEffectType(p),
      isGuest: !!p?.isGuest,
      connected: !!p?.connected,
      remaining: p && idx === viewerSeat ? p.remaining : null,
      tier: p ? tier(p.remaining) : null,
      wins: p?.wins ?? 0,
      submittedThisRound: room.current.bids[idx] !== null
    })),
    lastRound: maskLastRound(room.lastRound, viewerSeat),
    log: room.log.slice(-12)
  };
}

function privateState(room, seat) {
  const opponentSeat = seat === 0 ? 1 : 0;
  const opponentPublicInfo = room.current.publicInfo[opponentSeat];
  return {
    yourSeat: seat,
    yourRemaining: room.players[seat]?.remaining ?? 99,
    yourTier: room.players[seat] ? tier(room.players[seat].remaining) : null,
    yourBidSubmitted: room.current.bids[seat] !== null,
    yourBidThisRound: room.current.bids[seat],
    canSubmit: canSubmit(room, seat),
    opponentPublicInfo: opponentPublicInfo || null
  };
}

function emitRoom(room) {
  room.players.forEach((p, seat) => {
    if (p?.id) {
      io.to(p.id).emit('roomState', publicRoom(room, seat));
      io.to(p.id).emit('privateState', privateState(room, seat));
    }
  });
}

function ownedRoomAndSeat(socket, cb) {
  const room = rooms.get(socket.data.roomCode);
  const seat = socket.data.seat;
  if (!room || seat === undefined || !room.players[seat]) {
    cb?.({ ok: false, error: 'Bạn chưa ở trong phòng.' });
    return null;
  }
  if (room.players[seat].id !== socket.id) {
    cb?.({ ok: false, error: 'Phiên đăng nhập này không còn điều khiển người chơi trong phòng. Hãy reload hoặc đăng nhập lại.' });
    return null;
  }
  return { room, seat };
}

function replaceSeatSocket(room, seat, socket, reasonText = 'đăng nhập lại vào ván') {
  const p = room.players[seat];
  if (!p) return null;

  const oldSocket = io.sockets.sockets.get(p.id);
  if (oldSocket && oldSocket.id !== socket.id) {
    oldSocket.leave(room.code);
    oldSocket.data.roomCode = undefined;
    oldSocket.data.seat = undefined;
    oldSocket.emit('kickedByReconnect', { message: 'Tài khoản này đã đăng nhập ở thiết bị khác và tiếp tục ván hiện tại.' });
  }

  if (p.accountId) {
    const user = getUserById(p.accountId);
    if (user) {
      p.username = user.username;
      p.name = user.displayName;
      p.avatar = user.avatar || '';
      p.background = user.background || '';
      p.isAdmin = !!user.isAdmin;
      p.isVip = !!user.isVip;
      p.roleBadges = roleBadgesForUser(user);
    }
  }

  p.id = socket.id;
  p.connected = true;
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.seat = seat;

  room.log.push(`${p.name} đã ${reasonText}`);
  addAdminLog('reconnect_room', socket, { roomCode: room.code, seat, player: p.name });
  emitRoomEffect(room, p, reasonText);
  return { code: room.code, seat };
}

function reconnectActiveRoom(socket, userId) {
  for (const room of rooms.values()) {
    for (let seat = 0; seat < room.players.length; seat++) {
      const p = room.players[seat];
      if (p?.accountId === userId) {
        return replaceSeatSocket(room, seat, socket);
      }
    }
  }
  return null;
}

function resetCurrent() {
  return {
    bids: [null, null],
    publicInfo: [null, null]
  };
}

function canSubmit(room, seat) {
  if (!room.started || room.finished) return false;
  if (!room.players[0] || !room.players[1]) return false;
  if (room.current.bids[seat] !== null) return false;

  const first = room.firstSeat;
  const second = first === 0 ? 1 : 0;

  if (room.phase === 'waiting_first') return seat === first;
  if (room.phase === 'waiting_second') return seat === second;
  return false;
}

function nextRound(room) {
  room.round += 1;
  room.current = resetCurrent();

  if (room.lastWinnerSeat !== null && room.lastWinnerSeat !== undefined) {
    room.firstSeat = room.lastWinnerSeat;
  }

  room.phase = 'waiting_first';
}

function finalWinnerSeat(room) {
  const w0 = room.players[0].wins;
  const w1 = room.players[1].wins;
  if (w0 > w1) return 0;
  if (w1 > w0) return 1;
  return null;
}

function finalSummary(room, reason = '') {
  const winnerSeat = finalWinnerSeat(room);
  const w0 = room.players[0].wins;
  const w1 = room.players[1].wins;
  return {
    roomCode: room.code,
    at: new Date().toISOString(),
    reason,
    finalScore: `${w0}-${w1}`,
    winnerSeat,
    winnerName: winnerSeat === null ? 'Hòa' : room.players[winnerSeat].name,
    players: room.players.map((p, seat) => ({
      seat,
      name: p?.name || 'Không rõ',
      username: p?.username || (p?.isGuest ? 'guest' : ''),
      type: p?.isGuest ? 'guest' : 'user',
      avatar: p?.avatar || '',
      wins: p?.wins || 0
    })),
    rounds: Array.isArray(room.rounds) ? room.rounds : []
  };
}

function recordGame(room) {
  if (room.statsRecorded) return;
  room.statsRecorded = true;

  const w0 = room.players[0].wins;
  const w1 = room.players[1].wins;
  const at = new Date().toISOString();
  const winnerSeat = finalWinnerSeat(room);

  if (!Array.isArray(db.battleLogs)) db.battleLogs = [];
  const battleLog = {
    id: crypto.randomUUID(),
    at,
    roomCode: room.code,
    finalScore: `${w0}-${w1}`,
    winnerSeat,
    winnerName: winnerSeat === null ? 'Hòa' : room.players[winnerSeat].name,
    rounds: Array.isArray(room.rounds) ? room.rounds : [],
    players: room.players.map((p, seat) => ({
      seat,
      accountId: p?.accountId || null,
      username: p?.username || (p?.isGuest ? 'guest' : 'unknown'),
      name: p?.name || 'Không rõ',
      type: p?.isGuest ? 'guest' : 'user',
      isAdmin: !!p?.isAdmin,
      isVip: !!p?.isVip,
      ip: p?.ip || '',
      wins: p?.wins || 0,
      result: winnerSeat === null ? 'draw' : winnerSeat === seat ? 'win' : 'loss'
    }))
  };
  db.battleLogs.push(battleLog);
  db.battleLogs = db.battleLogs.slice(-1000);

  room.players.forEach((p, seat) => {
    if (!p?.accountId) return;
    const user = getUserById(p.accountId);
    if (!user) return;
    ensureUserFields(user);

    const opp = room.players[seat === 0 ? 1 : 0];
    let result = 'draw';
    if (winnerSeat === seat) result = 'win';
    else if (winnerSeat !== null) result = 'loss';

    const gameEntry = {
      id: battleLog.id,
      at,
      result,
      opponent: opp?.name || 'Không rõ',
      opponentUsername: opp?.username || (opp?.isGuest ? 'guest' : ''),
      opponentType: opp?.isGuest ? 'guest' : 'user',
      roomCode: room.code,
      score: seat === 0 ? `${w0}-${w1}` : `${w1}-${w0}`,
      finalScore: `${w0}-${w1}`,
      rounds: battleLog.rounds
    };

    user.recentGames = Array.isArray(user.recentGames) ? user.recentGames : [];
    user.matchHistory = Array.isArray(user.matchHistory) ? user.matchHistory : [];
    user.recentGames.push(gameEntry);
    user.recentGames = user.recentGames.slice(-10);
    user.matchHistory.push(gameEntry);
    user.matchHistory = user.matchHistory.slice(-100);

    if (result === 'win') {
      user.currentWinStreak = (user.currentWinStreak || 0) + 1;
      user.bestWinStreak = Math.max(user.bestWinStreak || 0, user.currentWinStreak);
    } else {
      user.currentWinStreak = 0;
      user.bestWinStreak = Math.max(user.bestWinStreak || 0, 0);
    }
  });

  saveDb();
  broadcastLeaderboard();
  broadcastAdminBattleLogs();
  broadcastAdminUsers();

  room.players.forEach((p) => {
    if (!p?.id) return;
    const playerSocket = io.sockets.sockets.get(p.id);
    if (playerSocket) sendProfile(playerSocket);
  });
}

function finishGame(room, reason = '') {
  if (room.finished) return finalSummary(room, reason);
  room.finished = true;
  room.phase = 'finished';
  const w0 = room.players[0].wins;
  const w1 = room.players[1].wins;
  const winnerSeat = finalWinnerSeat(room);

  if (winnerSeat === null) room.log.push(`Chung cuộc hòa ${w0}-${w1}`);
  else room.log.push(`${room.players[winnerSeat].name} thắng chung cuộc ${w0}-${w1}`);

  addAdminLog('game_finished', null, {
    roomCode: room.code,
    players: room.players.map(p => ({ name: p.name, type: p.isGuest ? 'guest' : 'user', username: p.username })),
    finalScore: `${w0}-${w1}`,
    winner: winnerSeat === null ? 'Hòa' : room.players[winnerSeat].name,
    reason,
    rounds: room.rounds
  });

  recordGame(room);
  const summary = finalSummary(room, reason);

  room.players.forEach((p, seat) => {
    if (!p?.id) return;
    const playerSocket = io.sockets.sockets.get(p.id);
    if (!playerSocket) return;
    playerSocket.emit('gameEnded', { summary });
    playerSocket.leave(room.code);
    playerSocket.data.roomCode = undefined;
    playerSocket.data.seat = undefined;
  });

  rooms.delete(room.code);
  return summary;
}

function finishRound(room) {
  const [a, b] = room.current.bids;
  let winnerSeat = null;
  let note = '';

  if (a > b) {
    winnerSeat = 0;
    room.players[0].wins += 1;
    room.lastWinnerSeat = 0;
    note = `${room.players[0].name} thắng vòng ${room.round}`;
  } else if (b > a) {
    winnerSeat = 1;
    room.players[1].wins += 1;
    room.lastWinnerSeat = 1;
    note = `${room.players[1].name} thắng vòng ${room.round}`;
  } else {
    note = `Vòng ${room.round} hòa, người thắng gần nhất vẫn đi trước vòng sau`;
  }

  const roundEntry = {
    round: room.round,
    winnerSeat,
    resultText: note,
    scoreAfterRound: `${room.players[0].wins}-${room.players[1].wins}`,
    players: room.players.map((p, seat) => ({
      seat,
      name: p.name,
      username: p.username || (p.isGuest ? 'guest' : ''),
      type: p.isGuest ? 'guest' : 'user',
      avatar: p.avatar || '',
      isAdmin: !!p.isAdmin,
      isVip: !!p.isVip,
      roleBadges: p.roleBadges || [],
      bid: room.current.bids[seat],
      color: colorOf(room.current.bids[seat]),
      tier: tier(p.remaining),
      remaining: p.remaining
    }))
  };

  room.lastRound = roundEntry;
  room.rounds = Array.isArray(room.rounds) ? room.rounds : [];
  room.rounds.push(roundEntry);

  room.log.push(note);
  addAdminLog('round_result', null, {
    roomCode: room.code,
    round: room.round,
    result: note,
    bids: room.current.bids,
    winnerSeat,
    score: `${room.players[0].wins}-${room.players[1].wins}`
  });

  const targetWins = room.targetWins || 5;
  if (room.players[0].wins >= targetWins || room.players[1].wins >= targetWins) {
    finishGame(room, `Có người đạt ${targetWins} điểm thắng vòng.`);
    return true;
  }

  if (room.round >= room.maxRounds) {
    finishGame(room, `Đã hết ${room.maxRounds} vòng.`);
    return true;
  }

  nextRound(room);
  return false;
}

function closeRoom(room, message = 'Phòng đã đóng.') {
  if (!room) return;
  room.players.forEach((p) => {
    if (!p?.id) return;
    const playerSocket = io.sockets.sockets.get(p.id);
    if (!playerSocket) return;
    playerSocket.emit('roomClosed', { message, roomCode: room.code });
    playerSocket.leave(room.code);
    playerSocket.data.roomCode = undefined;
    playerSocket.data.seat = undefined;
  });
  rooms.delete(room.code);
}

function resetGame(room, freshLog = false) {
  room.started = true;
  room.finished = false;
  room.statsRecorded = false;
  room.round = 1;
  room.targetWins = room.targetWins || 5;
  room.rounds = [];
  room.firstSeat = Math.random() < 0.5 ? 0 : 1;
  room.lastWinnerSeat = null;
  room.phase = 'waiting_first';
  room.players.forEach(p => {
    p.remaining = 99;
    p.wins = 0;
  });
  room.current = resetCurrent();
  room.lastRound = null;
  const firstPlayerName = room.players[room.firstSeat]?.name || 'Người chơi được chọn';
  const msg = `Ván đấu bắt đầu. Vòng 1 random người đi trước: ${firstPlayerName}. Ai đạt 5 điểm thắng vòng trước sẽ thắng chung cuộc.`;
  if (freshLog) room.log = [msg];
  else room.log.push(msg);
}

io.on('connection', (socket) => {
  socket.on('login', ({ username, password }, cb) => {
    try {
      const user = getUserByUsername(username);
      if (!user || !verifyPassword(user, password || '')) {
        return cb?.({ ok: false, error: 'Sai tài khoản hoặc mật khẩu.' });
      }
      attachUserToSocket(socket, user);
      recordIpForUser(user, socket);
      const sessionToken = createSession(user.id);
      const rejoined = reconnectActiveRoom(socket, user.id);
      addAdminLog('login_user', socket, { action: 'Đăng nhập tài khoản', rejoinedRoom: rejoined?.code || '' });
      cb?.({ ok: true, profile: safeUser(user), sessionToken, rejoined });
      sendProfile(socket);
      emitSocialStateToSocket(socket);
      broadcastSocialForUserAndFriends(user.id);
      broadcastAdminUsers();
      emitLeaderboardToSocket(socket);
      if (safeUser(user).isAdmin) emitAdminUsersToSocket(socket);
      if (rejoined) {
        const room = rooms.get(rejoined.code);
        if (room) emitRoom(room);
      }
    } catch (err) {
      cb?.({ ok: false, error: 'Không đăng nhập được.' });
    }
  });

  socket.on('resumeSession', ({ token }, cb) => {
    try {
      const user = getUserBySessionToken(token);
      if (!user) return cb?.({ ok: false, error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
      attachUserToSocket(socket, user);
      recordIpForUser(user, socket);
      const rejoined = reconnectActiveRoom(socket, user.id);
      addAdminLog('resume_session', socket, { action: 'Tự đăng nhập lại bằng phiên đã lưu', rejoinedRoom: rejoined?.code || '' });
      cb?.({ ok: true, profile: safeUser(user), rejoined });
      sendProfile(socket);
      emitSocialStateToSocket(socket);
      broadcastSocialForUserAndFriends(user.id);
      broadcastAdminUsers();
      emitLeaderboardToSocket(socket);
      if (safeUser(user).isAdmin) emitAdminUsersToSocket(socket);
      if (rejoined) {
        const room = rooms.get(rejoined.code);
        if (room) emitRoom(room);
      }
    } catch (err) {
      cb?.({ ok: false, error: 'Không khôi phục được phiên đăng nhập.' });
    }
  });

  socket.on('guestLogin', ({ name }, cb) => {
    const cleanName = cleanText(name, 24);
    if (!cleanName) return cb?.({ ok: false, error: 'Nhập tên khách trước đã.' });
    socket.data.authType = 'guest';
    socket.data.guestName = cleanName;
    socket.data.guestAvatar = '';
    socket.data.guestBackground = '';
    addAdminLog('login_guest', socket, { action: 'Đăng nhập khách' });
    const profile = safeGuest(socket);
    cb?.({ ok: true, profile });
    sendProfile(socket);
    emitLeaderboardToSocket(socket);
  });

  socket.on('registerAccount', ({ username, password, confirmPassword, displayName }, cb) => {
    try {
      const cleanUsername = normalizeUsername(username);
      const cleanDisplayName = cleanText(displayName || username, 24);
      if (cleanUsername.length < 3) return cb?.({ ok: false, error: 'Username cần ít nhất 3 ký tự: a-z, 0-9, dấu gạch, dấu chấm.' });
      if (String(password || '').length < 4) return cb?.({ ok: false, error: 'Mật khẩu cần ít nhất 4 ký tự.' });
      if (password !== confirmPassword) return cb?.({ ok: false, error: 'Nhập lại mật khẩu chưa khớp.' });
      if (getUserByUsername(cleanUsername)) return cb?.({ ok: false, error: 'Username này đã tồn tại.' });

      const user = makeUser(cleanUsername, password, cleanDisplayName, false);
      db.users.push(user);
      recordIpForUser(user, socket);
      saveDb();
      attachUserToSocket(socket, user);
      recordIpForUser(user, socket);
      const sessionToken = createSession(user.id);
      addAdminLog('register_account', socket, { username: cleanUsername, displayName: cleanDisplayName });
      cb?.({ ok: true, profile: safeUser(user), sessionToken, message: 'Đã tạo tài khoản và đăng nhập.' });
      sendProfile(socket);
      emitSocialStateToSocket(socket);
      broadcastLeaderboard();
      broadcastAdminUsers();
    } catch (err) {
      cb?.({ ok: false, error: 'Không tạo được tài khoản.' });
    }
  });

  socket.on('getAdminLogs', ({ limit } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới xem được lịch sử đấu.' });
      const n = Math.max(20, Math.min(Number(limit) || 100, 300));
      cb?.({ ok: true, logs: getBattleLogs(n) });
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được lịch sử đấu.' });
    }
  });

  socket.on('getAdminUsers', (_payload, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới xem được danh sách tài khoản.' });
      cb?.({ ok: true, users: getAdminUsers() });
      emitAdminUsersToSocket(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được danh sách tài khoản.' });
    }
  });

  socket.on('getPlayerHistory', ({ userId, limit } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới xem được lịch sử đấu tài khoản.' });
      const data = getUserHistoryForAdmin(userId, Math.max(10, Math.min(Number(limit) || 100, 100)));
      if (!data) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      cb?.({ ok: true, ...data });
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được lịch sử đấu tài khoản.' });
    }
  });

  socket.on('deleteAccount', ({ userId } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới xóa được tài khoản.' });
      if (!userId) return cb?.({ ok: false, error: 'Thiếu tài khoản cần xóa.' });
      if (userId === profile.id) return cb?.({ ok: false, error: 'Bạn không thể xóa chính tài khoản đang đăng nhập.' });
      const target = getUserById(userId);
      if (!target) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      const adminCount = db.users.filter(u => u.isAdmin).length;
      if (target.isAdmin && adminCount <= 1) return cb?.({ ok: false, error: 'Không thể xóa admin cuối cùng.' });

      const deletedSummary = { username: target.username, displayName: target.displayName, isAdmin: !!target.isAdmin, lastIp: target.lastIp || '' };
      db.users = db.users.filter(u => u.id !== target.id);
      db.sessions = (db.sessions || []).filter(s => s.userId !== target.id);
      db.users.forEach((u) => {
        ensureUserFields(u);
        u.friends = u.friends.filter(id => id !== target.id);
        u.incomingFriendRequests = u.incomingFriendRequests.filter(id => id !== target.id);
        u.outgoingFriendRequests = u.outgoingFriendRequests.filter(id => id !== target.id);
      });

      socketsForUser(target.id).forEach((s) => {
        s.emit('accountDeleted', { message: 'Tài khoản của bạn đã bị admin xóa.' });
        s.disconnect(true);
      });

      for (const room of rooms.values()) {
        let changed = false;
        room.players.forEach((p, seat) => {
          if (p?.accountId === target.id) {
            p.accountId = null;
            p.username = 'deleted';
            p.name = `${p.name} (đã xóa tài khoản)`;
            p.connected = false;
            changed = true;
          }
        });
        if (changed) emitRoom(room);
      }

      saveDb();
      addAdminLog('delete_account', socket, { deleted: deletedSummary });
      broadcastLeaderboard();
      broadcastAdminUsers();
      cb?.({ ok: true, message: `Đã xóa tài khoản @${deletedSummary.username}.` });
    } catch (err) {
      cb?.({ ok: false, error: 'Không xóa được tài khoản.' });
    }
  });

  socket.on('createAccount', ({ username, password, displayName, isAdmin, isVip }, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới được tạo tài khoản.' });

      const cleanUsername = normalizeUsername(username);
      const cleanDisplayName = cleanText(displayName || username, 24);
      if (cleanUsername.length < 3) return cb?.({ ok: false, error: 'Username cần ít nhất 3 ký tự: a-z, 0-9, dấu gạch, dấu chấm.' });
      if (String(password || '').length < 4) return cb?.({ ok: false, error: 'Mật khẩu cần ít nhất 4 ký tự.' });
      if (getUserByUsername(cleanUsername)) return cb?.({ ok: false, error: 'Username này đã tồn tại.' });

      const user = makeUser(cleanUsername, password, cleanDisplayName, !!isAdmin, !!isVip);
      db.users.push(user);
      saveDb();
      addAdminLog('create_account', socket, { createdUsername: cleanUsername, createdDisplayName: cleanDisplayName, createdIsAdmin: !!isAdmin, createdIsVip: !!isVip });
      cb?.({ ok: true, user: safeUser(user), message: `Đã tạo tài khoản ${cleanUsername}.` });
      broadcastLeaderboard();
      broadcastAdminUsers();
    } catch (err) {
      cb?.({ ok: false, error: 'Không tạo được tài khoản.' });
    }
  });


  socket.on('toggleVip', ({ userId, isVip } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới chỉnh VIP.' });
      const target = getUserById(userId);
      if (!target) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      target.isVip = !!isVip;
      ensureUserFields(target);
      saveDb();

      // Cập nhật ngay nếu tài khoản đang ngồi trong phòng.
      for (const room of rooms.values()) {
        let changed = false;
        room.players.forEach((p) => {
          if (p?.accountId === target.id) {
            p.isVip = !!target.isVip;
            p.roleBadges = roleBadgesForUser(target);
            changed = true;
          }
        });
        if (changed) emitRoom(room);
      }

      socketsForUser(target.id).forEach((s) => sendProfile(s));
      addAdminLog('toggle_vip', socket, { username: target.username, isVip: !!target.isVip });
      broadcastAdminUsers();
      broadcastLeaderboard();
      cb?.({ ok: true, message: `${target.displayName} ${target.isVip ? 'đã được cấp VIP' : 'đã bị gỡ VIP'}.` });
    } catch (err) {
      cb?.({ ok: false, error: 'Không chỉnh được VIP.' });
    }
  });

  socket.on('changePassword', ({ oldPassword, newPassword, confirmPassword }, cb) => {
    try {
      const profile = requireAuth(socket, cb);
      if (!profile) return;
      if (profile.type !== 'user') return cb?.({ ok: false, error: 'Khách không có mật khẩu để đổi.' });

      const user = getUserById(socket.data.userId);
      if (!user) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      if (!verifyPassword(user, oldPassword || '')) return cb?.({ ok: false, error: 'Mật khẩu cũ không đúng.' });
      if (String(newPassword || '').length < 4) return cb?.({ ok: false, error: 'Mật khẩu mới cần ít nhất 4 ký tự.' });
      if (newPassword !== confirmPassword) return cb?.({ ok: false, error: 'Nhập lại mật khẩu mới chưa khớp.' });
      if (oldPassword === newPassword) return cb?.({ ok: false, error: 'Mật khẩu mới không được trùng mật khẩu cũ.' });

      const salt = crypto.randomBytes(16).toString('hex');
      user.salt = salt;
      user.passwordHash = hashPassword(newPassword, salt);
      saveDb();
      addAdminLog('change_password', socket, { action: 'Đổi mật khẩu' });
      cb?.({ ok: true, message: 'Đã đổi mật khẩu. Lần sau hãy đăng nhập bằng mật khẩu mới.' });
    } catch (err) {
      cb?.({ ok: false, error: 'Không đổi được mật khẩu.' });
    }
  });

  socket.on('updateProfile', ({ displayName, avatar, background, clearAvatar, clearBackground }, cb) => {
    try {
      const profile = requireAuth(socket, cb);
      if (!profile) return;

      if (profile.type !== 'user') {
        return cb?.({ ok: false, error: 'Khách không thể sửa hồ sơ. Hãy đăng nhập bằng tài khoản.' });
      }

      const newName = cleanText(displayName, 24);
      const user = getUserById(socket.data.userId);
      if (!user) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      if (newName) user.displayName = newName;
      if (clearAvatar) user.avatar = '';
      else if (avatar !== undefined) user.avatar = cleanImage(avatar, 2 * 1024 * 1024);
      if (clearBackground) user.background = '';
      else if (background !== undefined) user.background = cleanImage(background, 4 * 1024 * 1024);
      saveDb();
      cb?.({ ok: true, profile: safeUser(user) });

      addAdminLog('update_profile', socket, {
        displayName: newName || profile.displayName,
        changedAvatar: !!clearAvatar || avatar !== undefined,
        changedBackground: !!clearBackground || background !== undefined
      });
      sendProfile(socket);
      broadcastSocialForUserAndFriends(user.id);
      broadcastLeaderboard();

      const code = socket.data.roomCode;
      const seat = socket.data.seat;
      const room = rooms.get(code);
      if (room && seat !== undefined && room.players[seat] && room.players[seat].id === socket.id) {
        const updated = profileForPlayer(socket);
        room.players[seat].name = updated.name;
        room.players[seat].avatar = updated.avatar;
        room.players[seat].background = updated.background;
        room.players[seat].isAdmin = !!updated.isAdmin;
        room.players[seat].isVip = !!updated.isVip;
        room.players[seat].roleBadges = updated.roleBadges || [];
        emitRoom(room);
      }
    } catch (err) {
      cb?.({ ok: false, error: err.message || 'Không cập nhật được hồ sơ.' });
    }
  });

  socket.on('getProfile', (cb) => {
    const profile = currentProfile(socket);
    if (!profile) return cb?.({ ok: false, error: 'Chưa đăng nhập.' });
    cb?.({ ok: true, profile });
    sendProfile(socket);
    emitLeaderboardToSocket(socket);
  });

  socket.on('getLeaderboard', (_payload, cb) => {
    try {
      const leaderboard = getLeaderboard(20);
      cb?.({ ok: true, leaderboard });
      emitLeaderboardToSocket(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được bảng xếp hạng.' });
    }
  });

  socket.on('getSocialState', (_payload, cb) => {
    return cb?.({ ok: true, social: { friends: [], incoming: [], outgoing: [] } });
    try {
      const profile = currentProfile(socket);
      if (!profile || profile.type !== 'user') return cb?.({ ok: false, error: 'Chỉ tài khoản đăng nhập mới có bạn bè.' });
      const social = getSocialState(profile.id);
      cb?.({ ok: true, social });
      emitSocialStateToSocket(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được danh sách bạn bè.' });
    }
  });

  socket.on('searchUsers', ({ query } = {}, cb) => {
    return cb?.({ ok: false, error: 'Tính năng bạn bè đã được tắt.' });
    try {
      const profile = currentProfile(socket);
      if (!profile || profile.type !== 'user') return cb?.({ ok: false, error: 'Chỉ tài khoản đăng nhập mới tìm bạn bè.' });
      const me = getUserById(profile.id);
      const results = searchUsersFor(me, query);
      cb?.({ ok: true, results });
    } catch (err) {
      cb?.({ ok: false, error: 'Không tìm được người chơi.' });
    }
  });

  socket.on('sendFriendRequest', ({ userId, username } = {}, cb) => {
    return cb?.({ ok: false, error: 'Tính năng bạn bè đã được tắt.' });
    try {
      const profile = currentProfile(socket);
      if (!profile || profile.type !== 'user') return cb?.({ ok: false, error: 'Chỉ tài khoản đăng nhập mới kết bạn.' });
      const me = getUserById(profile.id);
      ensureUserFields(me);
      const target = userId ? getUserById(userId) : getUserByUsername(username);
      if (!target) return cb?.({ ok: false, error: 'Không tìm thấy người chơi.' });
      ensureUserFields(target);
      if (target.id === me.id) return cb?.({ ok: false, error: 'Không thể tự kết bạn với chính mình.' });
      if (me.friends.includes(target.id)) return cb?.({ ok: false, error: 'Hai người đã là bạn bè.' });

      // Nếu người kia đã gửi lời mời cho mình thì tự động chấp nhận.
      if (me.incomingFriendRequests.includes(target.id)) {
        me.incomingFriendRequests = me.incomingFriendRequests.filter(id => id !== target.id);
        target.outgoingFriendRequests = target.outgoingFriendRequests.filter(id => id !== me.id);
        if (!me.friends.includes(target.id)) me.friends.push(target.id);
        if (!target.friends.includes(me.id)) target.friends.push(me.id);
        saveDb();
        addAdminLog('friend_accept', socket, { friend: target.username });
        broadcastSocialForUserAndFriends(me.id);
        broadcastSocialForUserAndFriends(target.id);
        return cb?.({ ok: true, message: `Đã trở thành bạn bè với ${target.displayName}.` });
      }

      if (!me.outgoingFriendRequests.includes(target.id)) me.outgoingFriendRequests.push(target.id);
      if (!target.incomingFriendRequests.includes(me.id)) target.incomingFriendRequests.push(me.id);
      saveDb();
      addAdminLog('friend_request', socket, { to: target.username });
      broadcastSocialForUserAndFriends(me.id);
      broadcastSocialForUserAndFriends(target.id);
      cb?.({ ok: true, message: `Đã gửi lời mời kết bạn tới ${target.displayName}.` });
    } catch (err) {
      cb?.({ ok: false, error: 'Không gửi được lời mời kết bạn.' });
    }
  });

  socket.on('respondFriendRequest', ({ fromUserId, accept } = {}, cb) => {
    return cb?.({ ok: false, error: 'Tính năng bạn bè đã được tắt.' });
    try {
      const profile = currentProfile(socket);
      if (!profile || profile.type !== 'user') return cb?.({ ok: false, error: 'Chỉ tài khoản đăng nhập mới dùng bạn bè.' });
      const me = getUserById(profile.id);
      const other = getUserById(fromUserId);
      if (!other) return cb?.({ ok: false, error: 'Không tìm thấy người gửi lời mời.' });
      ensureUserFields(me);
      ensureUserFields(other);
      if (!me.incomingFriendRequests.includes(other.id)) return cb?.({ ok: false, error: 'Không có lời mời này.' });

      me.incomingFriendRequests = me.incomingFriendRequests.filter(id => id !== other.id);
      other.outgoingFriendRequests = other.outgoingFriendRequests.filter(id => id !== me.id);
      if (accept) {
        if (!me.friends.includes(other.id)) me.friends.push(other.id);
        if (!other.friends.includes(me.id)) other.friends.push(me.id);
      }
      saveDb();
      addAdminLog(accept ? 'friend_accept' : 'friend_reject', socket, { friend: other.username });
      broadcastSocialForUserAndFriends(me.id);
      broadcastSocialForUserAndFriends(other.id);
      cb?.({ ok: true, message: accept ? `Đã kết bạn với ${other.displayName}.` : 'Đã từ chối lời mời.' });
    } catch (err) {
      cb?.({ ok: false, error: 'Không xử lý được lời mời.' });
    }
  });

  socket.on('removeFriend', ({ friendId } = {}, cb) => {
    return cb?.({ ok: false, error: 'Tính năng bạn bè đã được tắt.' });
    try {
      const profile = currentProfile(socket);
      if (!profile || profile.type !== 'user') return cb?.({ ok: false, error: 'Chỉ tài khoản đăng nhập mới dùng bạn bè.' });
      const me = getUserById(profile.id);
      const other = getUserById(friendId);
      if (!other) return cb?.({ ok: false, error: 'Không tìm thấy bạn bè.' });
      ensureUserFields(me);
      ensureUserFields(other);
      me.friends = me.friends.filter(id => id !== other.id);
      other.friends = other.friends.filter(id => id !== me.id);
      me.incomingFriendRequests = me.incomingFriendRequests.filter(id => id !== other.id);
      me.outgoingFriendRequests = me.outgoingFriendRequests.filter(id => id !== other.id);
      other.incomingFriendRequests = other.incomingFriendRequests.filter(id => id !== me.id);
      other.outgoingFriendRequests = other.outgoingFriendRequests.filter(id => id !== me.id);
      saveDb();
      addAdminLog('friend_remove', socket, { friend: other.username });
      broadcastSocialForUserAndFriends(me.id);
      broadcastSocialForUserAndFriends(other.id);
      cb?.({ ok: true, message: 'Đã xóa bạn bè.' });
    } catch (err) {
      cb?.({ ok: false, error: 'Không xóa được bạn bè.' });
    }
  });

  socket.on('inviteFriend', ({ friendId } = {}, cb) => {
    return cb?.({ ok: false, error: 'Tính năng bạn bè đã được tắt.' });
    try {
      const profile = currentProfile(socket);
      if (!profile || profile.type !== 'user') return cb?.({ ok: false, error: 'Chỉ tài khoản đăng nhập mới mời bạn bè.' });
      const me = getUserById(profile.id);
      ensureUserFields(me);
      if (!me.friends.includes(friendId)) return cb?.({ ok: false, error: 'Người này chưa phải bạn bè của bạn.' });
      const friend = getUserById(friendId);
      if (!friend) return cb?.({ ok: false, error: 'Không tìm thấy bạn bè.' });
      const room = rooms.get(socket.data.roomCode);
      if (!room) return cb?.({ ok: false, error: 'Bạn cần tạo hoặc vào một phòng trước.' });
      if (room.started) return cb?.({ ok: false, error: 'Ván đã bắt đầu, không thể mời thêm.' });
      if (room.players[0] && room.players[1] && room.players[0].connected && room.players[1].connected) return cb?.({ ok: false, error: 'Phòng đã đủ 2 người.' });
      const targetSockets = socketsForUser(friend.id);
      if (!targetSockets.length) return cb?.({ ok: false, error: 'Bạn bè này đang offline.' });
      const invite = {
        fromUserId: me.id,
        fromName: me.displayName,
        fromUsername: me.username,
        roomCode: room.code,
        at: new Date().toISOString()
      };
      targetSockets.forEach(s => s.emit('roomInvite', invite));
      addAdminLog('invite_friend', socket, { roomCode: room.code, to: friend.username });
      cb?.({ ok: true, message: `Đã gửi lời mời vào phòng ${room.code} tới ${friend.displayName}.` });
    } catch (err) {
      cb?.({ ok: false, error: 'Không gửi được lời mời.' });
    }
  });

  socket.on('createRoom', (cb) => {
    try {
      const profile = requireAuth(socket, cb);
      if (!profile) return;

      let code = makeCode();
      while (rooms.has(code)) code = makeCode();

      const p = profileForPlayer(socket);
      const room = {
        code,
        started: false,
        finished: false,
        statsRecorded: false,
        maxRounds: 9,
        targetWins: 5,
        round: 1,
        firstSeat: 0,
        lastWinnerSeat: null,
        phase: 'lobby',
        players: [
          { id: socket.id, ...p, remaining: 99, wins: 0, connected: true },
          null
        ],
        current: resetCurrent(),
        lastRound: null,
        rounds: [],
        log: [`${p.name} đã tạo phòng ${code}`]
      };

      addAdminLog('create_room', socket, { roomCode: code, player: p.name, isGuest: p.isGuest });

      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.seat = 0;
      cb?.({ ok: true, code, seat: 0 });
      emitRoom(room);
      emitRoomEffect(room, room.players[0], 'tạo phòng');
      emitSocialStateToSocket(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không tạo được phòng.' });
    }
  });

  socket.on('joinRoom', ({ code }, cb) => {
    try {
      const profile = requireAuth(socket, cb);
      if (!profile) return;

      code = String(code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return cb?.({ ok: false, error: 'Không tìm thấy phòng.' });

      if (profile.type === 'user') {
        const existingSeat = room.players.findIndex(p => p?.accountId === profile.id);
        if (existingSeat !== -1) {
          const rejoined = replaceSeatSocket(room, existingSeat, socket);
          cb?.({ ok: true, code, seat: existingSeat, rejoined });
          emitRoom(room);
          return;
        }
      }

      if (room.players[1] && room.players[1].connected) return cb?.({ ok: false, error: 'Phòng đã đủ 2 người.' });
      if (room.started) return cb?.({ ok: false, error: 'Ván đã bắt đầu.' });

      const p = profileForPlayer(socket);
      room.players[1] = { id: socket.id, ...p, remaining: 99, wins: 0, connected: true };
      room.log.push(`${p.name} đã vào phòng`);
      addAdminLog('join_room', socket, { roomCode: code, player: p.name, isGuest: p.isGuest });
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.seat = 1;
      cb?.({ ok: true, code, seat: 1 });
      emitRoom(room);
      emitRoomEffect(room, room.players[1], 'vào phòng');
      emitSocialStateToSocket(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không vào được phòng.' });
    }
  });

  socket.on('leaveRoom', (cb) => {
    const owned = ownedRoomAndSeat(socket, cb);
    if (!owned) return;
    const { room, seat } = owned;
    const name = room.players[seat]?.name || 'Một người chơi';
    addAdminLog('leave_room', socket, { roomCode: room.code, seat, player: name });
    cb?.({ ok: true });
    closeRoom(room, `${name} đã rời phòng. Phòng đã được đóng, hãy tạo phòng mới nếu muốn chơi.`);
  });

  socket.on('startGame', (cb) => {
    const owned = ownedRoomAndSeat(socket, cb);
    if (!owned) return;
    const { room, seat } = owned;
    if (seat !== 0) return cb?.({ ok: false, error: 'Chỉ chủ phòng được bắt đầu.' });
    if (!room.players[0] || !room.players[1]) return cb?.({ ok: false, error: 'Cần đủ 2 người.' });

    resetGame(room, false);
    addAdminLog('start_game', socket, {
      roomCode: room.code,
      players: room.players.map(p => ({ name: p.name, type: p.isGuest ? 'guest' : 'user', username: p.username }))
    });
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on('submitBid', ({ bid }, cb) => {
    const owned = ownedRoomAndSeat(socket, cb);
    if (!owned) return;
    const { room, seat } = owned;
    if (!canSubmit(room, seat)) return cb?.({ ok: false, error: 'Chưa tới lượt bạn hoặc bạn đã gửi điểm.' });

    bid = Number(bid);
    if (!Number.isInteger(bid)) return cb?.({ ok: false, error: 'Điểm phải là số nguyên.' });
    if (bid < 0) return cb?.({ ok: false, error: 'Không được nhập số âm.' });
    if (bid > room.players[seat].remaining) return cb?.({ ok: false, error: 'Không đủ điểm còn lại.' });
    if (bid > 99) return cb?.({ ok: false, error: 'Tối đa 99 điểm.' });

    room.current.bids[seat] = bid;
    room.players[seat].remaining -= bid;
    room.current.publicInfo[seat] = {
      color: colorOf(bid),
      tier: tier(room.players[seat].remaining)
    };

    const p = room.players[seat];
    room.log.push(`${p.name} đã gửi điểm: ${colorOf(bid)}, mốc ${tier(p.remaining)}`);
    addAdminLog('submit_bid', socket, {
      roomCode: room.code,
      round: room.round,
      seat,
      player: p.name,
      bid,
      color: colorOf(bid),
      remaining: p.remaining,
      tier: tier(p.remaining)
    });

    let ended = false;
    if (room.phase === 'waiting_first') {
      room.phase = 'waiting_second';
    } else if (room.phase === 'waiting_second') {
      ended = finishRound(room);
    }

    cb?.({ ok: true });
    if (!ended && rooms.has(room.code)) emitRoom(room);
  });

  socket.on('restartGame', (cb) => {
    cb?.({ ok: false, error: 'Ván kết thúc sẽ tự đưa 2 người chơi ra khỏi phòng. Hãy tạo phòng mới để chơi tiếp.' });
  });

  socket.on('disconnect', () => {
    const disconnectedUserId = socket.data.authType === 'user' ? socket.data.userId : null;
    const code = socket.data.roomCode;
    const seat = socket.data.seat;
    const room = rooms.get(code);

    if (room && seat !== undefined && room.players[seat] && room.players[seat].id === socket.id) {
      room.players[seat].connected = false;
      room.log.push(`${room.players[seat].name} đã thoát`);
      addAdminLog('disconnect', socket, { roomCode: code, seat, player: room.players[seat].name });
      emitRoom(room);

      setTimeout(() => {
        const r = rooms.get(code);
        if (!r) return;
        const anyConnected = r.players.some(p => p?.connected);
        if (!anyConnected) rooms.delete(code);
      }, 10 * 60 * 1000);
    }

    if (disconnectedUserId) {
      setTimeout(() => {
        broadcastSocialForUserAndFriends(disconnectedUserId);
        broadcastAdminUsers();
      }, 150);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Đen Trắng II đang chạy tại http://localhost:${PORT}`);
});
