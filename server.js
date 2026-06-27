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
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || 'Admin';
    const initialDb = { users: [], adminLogs: [] };
    initialDb.users.push(makeUser(adminUsername, adminPassword, adminDisplayName, true));
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
    console.log(`Đã tạo admin mặc định: ${adminUsername} / ${adminPassword}`);
    return initialDb;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!Array.isArray(parsed.users)) parsed.users = [];
    if (!Array.isArray(parsed.adminLogs)) parsed.adminLogs = [];
    return parsed;
  } catch (err) {
    console.error('Không đọc được data/db.json:', err);
    return { users: [], adminLogs: [] };
  }
}

function saveDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function makeUser(username, password, displayName, isAdmin = false) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: crypto.randomUUID(),
    username: normalizeUsername(username),
    displayName: cleanText(displayName || username, 24),
    salt,
    passwordHash: hashPassword(password, salt),
    isAdmin: !!isAdmin,
    avatar: '',
    background: '',
    recentGames: [],
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
    avatar: user.avatar || '',
    background: user.background || '',
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
    avatar: socket.data.guestAvatar || '',
    background: socket.data.guestBackground || '',
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

function currentProfile(socket) {
  if (socket.data.authType === 'user') return safeUser(getUserById(socket.data.userId));
  if (socket.data.authType === 'guest') return safeGuest(socket);
  return null;
}

function actorForLog(socket) {
  if (!socket) {
    return {
      type: 'system',
      accountId: null,
      username: 'system',
      name: 'Hệ thống',
      guestId: null,
      socketId: null
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
      socketId: socket.id
    };
  }

  if (socket.data.authType === 'guest') {
    return {
      type: 'guest',
      accountId: null,
      username: 'guest',
      name: socket.data.guestName || 'Khách',
      guestId: socket.id,
      socketId: socket.id
    };
  }

  return {
    type: 'anonymous',
    accountId: null,
    username: 'anonymous',
    name: 'Chưa đăng nhập',
    guestId: null,
    socketId: socket.id
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
    background: profile.background || ''
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
    firstSeat: room.firstSeat,
    lastWinnerSeat: room.lastWinnerSeat,
    phase: room.phase,
    players: room.players.map((p, idx) => ({
      seat: idx,
      name: p?.name || null,
      avatar: p?.avatar || '',
      background: p?.background || '',
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

function recordGame(room) {
  if (room.statsRecorded) return;
  room.statsRecorded = true;

  const w0 = room.players[0].wins;
  const w1 = room.players[1].wins;

  room.players.forEach((p, seat) => {
    if (!p?.accountId) return;
    const user = getUserById(p.accountId);
    if (!user) return;

    const opp = room.players[seat === 0 ? 1 : 0];
    let result = 'draw';
    if (seat === 0 && w0 > w1) result = 'win';
    if (seat === 0 && w1 > w0) result = 'loss';
    if (seat === 1 && w1 > w0) result = 'win';
    if (seat === 1 && w0 > w1) result = 'loss';

    user.recentGames = Array.isArray(user.recentGames) ? user.recentGames : [];
    user.recentGames.push({
      at: new Date().toISOString(),
      result,
      opponent: opp?.name || 'Không rõ',
      score: seat === 0 ? `${w0}-${w1}` : `${w1}-${w0}`
    });
    user.recentGames = user.recentGames.slice(-10);
  });

  saveDb();

  room.players.forEach((p) => {
    if (!p?.id) return;
    const playerSocket = io.sockets.sockets.get(p.id);
    if (playerSocket) sendProfile(playerSocket);
  });
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

  room.lastRound = {
    round: room.round,
    winnerSeat,
    resultText: note,
    players: room.players.map((p, seat) => ({
      seat,
      name: p.name,
      avatar: p.avatar || '',
      color: colorOf(room.current.bids[seat]),
      tier: tier(p.remaining),
      remaining: p.remaining
    }))
  };

  room.log.push(note);
  addAdminLog('round_result', null, {
    roomCode: room.code,
    round: room.round,
    result: note,
    bids: room.current.bids,
    winnerSeat,
    score: `${room.players[0].wins}-${room.players[1].wins}`
  });

  if (room.round >= room.maxRounds) {
    room.finished = true;
    room.phase = 'finished';
    const w0 = room.players[0].wins;
    const w1 = room.players[1].wins;
    if (w0 > w1) room.log.push(`${room.players[0].name} thắng chung cuộc ${w0}-${w1}`);
    else if (w1 > w0) room.log.push(`${room.players[1].name} thắng chung cuộc ${w1}-${w0}`);
    else room.log.push(`Chung cuộc hòa ${w0}-${w1}`);
    addAdminLog('game_finished', null, {
      roomCode: room.code,
      players: room.players.map(p => ({ name: p.name, type: p.isGuest ? 'guest' : 'user', username: p.username })),
      finalScore: `${w0}-${w1}`,
      winner: w0 > w1 ? room.players[0].name : w1 > w0 ? room.players[1].name : 'Hòa'
    });
    recordGame(room);
  } else {
    nextRound(room);
  }
}

function resetGame(room, freshLog = false) {
  room.started = true;
  room.finished = false;
  room.statsRecorded = false;
  room.round = 1;
  room.firstSeat = 0;
  room.lastWinnerSeat = null;
  room.phase = 'waiting_first';
  room.players.forEach(p => {
    p.remaining = 99;
    p.wins = 0;
  });
  room.current = resetCurrent();
  room.lastRound = null;
  const msg = 'Ván đấu bắt đầu. Vòng 1 chủ phòng đi trước. Từ vòng 2, người thắng gần nhất đi trước.';
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
      socket.data.authType = 'user';
      socket.data.userId = user.id;
      addAdminLog('login_user', socket, { action: 'Đăng nhập tài khoản' });
      cb?.({ ok: true, profile: safeUser(user) });
      sendProfile(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không đăng nhập được.' });
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
  });

  socket.on('getAdminLogs', ({ limit } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới xem được log.' });
      const n = Math.max(20, Math.min(Number(limit) || 100, 300));
      const logs = Array.isArray(db.adminLogs) ? db.adminLogs.slice(-n).reverse() : [];
      cb?.({ ok: true, logs });
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được log.' });
    }
  });

  socket.on('createAccount', ({ username, password, displayName, isAdmin }, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới được tạo tài khoản.' });

      const cleanUsername = normalizeUsername(username);
      const cleanDisplayName = cleanText(displayName || username, 24);
      if (cleanUsername.length < 3) return cb?.({ ok: false, error: 'Username cần ít nhất 3 ký tự: a-z, 0-9, dấu gạch, dấu chấm.' });
      if (String(password || '').length < 4) return cb?.({ ok: false, error: 'Mật khẩu cần ít nhất 4 ký tự.' });
      if (getUserByUsername(cleanUsername)) return cb?.({ ok: false, error: 'Username này đã tồn tại.' });

      const user = makeUser(cleanUsername, password, cleanDisplayName, !!isAdmin);
      db.users.push(user);
      saveDb();
      addAdminLog('create_account', socket, { createdUsername: cleanUsername, createdDisplayName: cleanDisplayName, createdIsAdmin: !!isAdmin });
      cb?.({ ok: true, user: safeUser(user), message: `Đã tạo tài khoản ${cleanUsername}.` });
    } catch (err) {
      cb?.({ ok: false, error: 'Không tạo được tài khoản.' });
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

      const newName = cleanText(displayName, 24);
      if (profile.type === 'user') {
        const user = getUserById(socket.data.userId);
        if (!user) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
        if (newName) user.displayName = newName;
        if (clearAvatar) user.avatar = '';
        else if (avatar !== undefined) user.avatar = cleanImage(avatar, 2 * 1024 * 1024);
        if (clearBackground) user.background = '';
        else if (background !== undefined) user.background = cleanImage(background, 4 * 1024 * 1024);
        saveDb();
        cb?.({ ok: true, profile: safeUser(user) });
      } else {
        if (newName) socket.data.guestName = newName;
        if (clearAvatar) socket.data.guestAvatar = '';
        else if (avatar !== undefined) socket.data.guestAvatar = cleanImage(avatar, 2 * 1024 * 1024);
        if (clearBackground) socket.data.guestBackground = '';
        else if (background !== undefined) socket.data.guestBackground = cleanImage(background, 4 * 1024 * 1024);
        cb?.({ ok: true, profile: safeGuest(socket) });
      }

      addAdminLog('update_profile', socket, {
        displayName: newName || profile.displayName,
        changedAvatar: !!clearAvatar || avatar !== undefined,
        changedBackground: !!clearBackground || background !== undefined
      });
      sendProfile(socket);

      const code = socket.data.roomCode;
      const seat = socket.data.seat;
      const room = rooms.get(code);
      if (room && seat !== undefined && room.players[seat]) {
        const updated = profileForPlayer(socket);
        room.players[seat].name = updated.name;
        room.players[seat].avatar = updated.avatar;
        room.players[seat].background = updated.background;
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
        log: [`${p.name} đã tạo phòng ${code}`]
      };

      addAdminLog('create_room', socket, { roomCode: code, player: p.name, isGuest: p.isGuest });

      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.seat = 0;
      cb?.({ ok: true, code, seat: 0 });
      emitRoom(room);
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
    } catch (err) {
      cb?.({ ok: false, error: 'Không vào được phòng.' });
    }
  });

  socket.on('startGame', (cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb?.({ ok: false, error: 'Bạn chưa ở trong phòng.' });
    if (socket.data.seat !== 0) return cb?.({ ok: false, error: 'Chỉ chủ phòng được bắt đầu.' });
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
    const room = rooms.get(socket.data.roomCode);
    const seat = socket.data.seat;
    if (!room || seat === undefined) return cb?.({ ok: false, error: 'Bạn chưa ở trong phòng.' });
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

    if (room.phase === 'waiting_first') {
      room.phase = 'waiting_second';
    } else if (room.phase === 'waiting_second') {
      finishRound(room);
    }

    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on('restartGame', (cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb?.({ ok: false, error: 'Bạn chưa ở trong phòng.' });
    if (socket.data.seat !== 0) return cb?.({ ok: false, error: 'Chỉ chủ phòng được chơi lại.' });
    if (!room.players[0] || !room.players[1]) return cb?.({ ok: false, error: 'Cần đủ 2 người.' });

    resetGame(room, true);
    addAdminLog('restart_game', socket, { roomCode: room.code });
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const seat = socket.data.seat;
    const room = rooms.get(code);
    if (!room || seat === undefined || !room.players[seat]) return;
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
  });
});

server.listen(PORT, () => {
  console.log(`Đen Trắng II đang chạy tại http://localhost:${PORT}`);
});
