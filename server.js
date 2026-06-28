const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 3 * 1024 * 1024
});
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ACCOUNTS_BACKUP_FILE = path.join(DATA_DIR, 'accounts.autobak.json');
const MAX_AVATAR_BYTES = 256 * 1024;
const MAX_ADMIN_LOGS = 300;
const MAX_BATTLE_LOGS = 300;
const MAX_MATCH_HISTORY = 50;
const PASSWORD_MIN_LENGTH = 4;
const PASSWORD_MAX_LENGTH = 12;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();
let db = loadDb();

function defaultSettings() {
  return {
    leaderboardPublic: true,
    matchLogPublic: true
  };
}

function normalizeSettings(settings) {
  const defaults = defaultSettings();
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    leaderboardPublic: typeof source.leaderboardPublic === 'boolean' ? source.leaderboardPublic : defaults.leaderboardPublic,
    matchLogPublic: typeof source.matchLogPublic === 'boolean' ? source.matchLogPublic : defaults.matchLogPublic
  };
}

function appSettings() {
  db.settings = normalizeSettings(db.settings);
  return db.settings;
}

function loadDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const legacyDb = readJsonFile(DB_FILE, null);
  const appData = {
    adminLogs: Array.isArray(legacyDb?.adminLogs) ? legacyDb.adminLogs : [],
    battleLogs: Array.isArray(legacyDb?.battleLogs) ? legacyDb.battleLogs : [],
    fraudAlerts: Array.isArray(legacyDb?.fraudAlerts) ? legacyDb.fraudAlerts : [],
    settings: normalizeSettings(legacyDb?.settings)
  };

  // Tài khoản + điểm người chơi được tách riêng trong data/accounts.json.
  // Khi nâng cấp code, chỉ cần giữ file này là hồ sơ, avatar, chuỗi thắng,
  // lịch sử 10 ván gần nhất và session đăng nhập sẽ được giữ lại.
  let accountData = loadAccountsData(legacyDb);

  if (!Array.isArray(accountData.users)) accountData.users = [];
  if (!Array.isArray(accountData.sessions)) accountData.sessions = [];

  if (!accountData.users.some(u => u && u.isAdmin)) {
    const adminUsername = process.env.ADMIN_USERNAME || 'xhuyvu';
    const adminPassword = process.env.ADMIN_PASSWORD || 'xhuyvu123';
    const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || 'Admin';
    accountData.users.push(makeUser(adminUsername, adminPassword, adminDisplayName, true));
    console.log(`Đã tạo admin mặc định: ${adminUsername} / ${adminPassword}`);
  }

  const merged = {
    ...appData,
    users: accountData.users,
    sessions: accountData.sessions
  };

  migrateDb(merged);
  saveDbObject(merged);
  return merged;
}

function loadAccountsData(legacyDb) {
  const main = readJsonFile(ACCOUNTS_FILE, null);
  if (main && typeof main === 'object' && Array.isArray(main.users)) return main;

  const backup = readJsonFile(ACCOUNTS_BACKUP_FILE, null);
  if (backup && typeof backup === 'object' && Array.isArray(backup.users)) {
    console.warn('accounts.json lỗi hoặc trống, đã dùng accounts.autobak.json để khôi phục tạm thời.');
    return backup;
  }

  return {
    users: Array.isArray(legacyDb?.users) ? legacyDb.users : [],
    sessions: Array.isArray(legacyDb?.sessions) ? legacyDb.sessions : []
  };
}

function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Không đọc được ${path.relative(__dirname, file)}:`, err);
    return fallback;
  }
}

function saveDb() {
  saveDbObject(db);
}

function saveDbObject(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const now = new Date().toISOString();

  const users = Array.isArray(data.users) ? data.users : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const accountData = {
    version: 1,
    updatedAt: now,
    users,
    sessions
  };

  const appData = {
    version: 1,
    updatedAt: now,
    adminLogs: Array.isArray(data.adminLogs) ? data.adminLogs.slice(-MAX_ADMIN_LOGS) : [],
    battleLogs: Array.isArray(data.battleLogs) ? data.battleLogs.slice(-MAX_BATTLE_LOGS) : [],
    fraudAlerts: Array.isArray(data.fraudAlerts) ? data.fraudAlerts.slice(-100) : [],
    settings: normalizeSettings(data.settings)
  };

  // Chặn lỗi nguy hiểm: nếu dữ liệu tài khoản bất thường thì không ghi đè file cũ.
  if (!users.length || !users.some(u => u && u.isAdmin)) {
    console.error('Từ chối ghi accounts.json vì dữ liệu tài khoản không hợp lệ hoặc thiếu admin.');
    writeJsonAtomic(DB_FILE, appData);
    return;
  }

  writeJsonAtomic(ACCOUNTS_FILE, accountData, ACCOUNTS_BACKUP_FILE);
  writeJsonAtomic(DB_FILE, appData);
}

function writeJsonAtomic(file, data, backupFile = '') {
  const tmp = `${file}.tmp`;
  if (backupFile && fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, backupFile);
    } catch (err) {
      console.error(`Không tạo được autobackup cho ${path.relative(__dirname, file)}:`, err);
    }
  }
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}


function buildAccountsBackup() {
  const accountData = readJsonFile(ACCOUNTS_FILE, null) || {
    version: 1,
    updatedAt: new Date().toISOString(),
    users: Array.isArray(db.users) ? db.users : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : []
  };
  return {
    app: 'den-trang-ii-online',
    backupType: 'accounts',
    version: 2,
    exportedAt: new Date().toISOString(),
    accounts: {
      version: accountData.version || 1,
      updatedAt: accountData.updatedAt || new Date().toISOString(),
      users: Array.isArray(accountData.users) ? accountData.users.map((u) => { const clean = { ...u }; delete clean.background; return clean; }) : [],
      sessions: Array.isArray(accountData.sessions) ? accountData.sessions : []
    }
  };
}

function normalizeImportedAccounts(raw) {
  const source = raw?.accounts && typeof raw.accounts === 'object'
    ? raw.accounts
    : raw?.data && typeof raw.data === 'object'
      ? raw.data
      : raw;

  if (!source || typeof source !== 'object' || !Array.isArray(source.users)) {
    throw new Error('File backup không hợp lệ. File cần có danh sách users.');
  }

  const users = source.users.map((u) => ({ ...u }));
  const sessions = Array.isArray(source.sessions) ? source.sessions.map((s) => ({ ...s })) : [];
  const ids = new Set();
  const usernames = new Set();

  for (const user of users) {
    if (!user || typeof user !== 'object') throw new Error('File backup có dữ liệu tài khoản bị lỗi.');
    if (!user.id) user.id = crypto.randomUUID();
    if (ids.has(user.id)) throw new Error('File backup có tài khoản bị trùng ID.');
    ids.add(user.id);

    user.username = normalizeUsername(user.username);
    if (user.username.length < 3) throw new Error('File backup có username không hợp lệ.');
    if (usernames.has(user.username)) throw new Error(`File backup có username bị trùng: ${user.username}`);
    usernames.add(user.username);

    if (!user.salt || !user.passwordHash) throw new Error(`Tài khoản @${user.username} thiếu dữ liệu mật khẩu đã mã hóa.`);
    ensureUserFields(user);
  }

  if (!users.some(u => u.isAdmin)) {
    throw new Error('File backup không có tài khoản admin. Từ chối khôi phục để tránh khóa bạn khỏi trang quản trị.');
  }

  const validUserIds = new Set(users.map(u => u.id));
  const cleanedSessions = sessions
    .filter(s => s && typeof s === 'object' && validUserIds.has(s.userId) && s.tokenHash)
    .slice(-500)
    .map(s => ({
      id: s.id || crypto.randomUUID(),
      userId: s.userId,
      tokenHash: cleanText(s.tokenHash, 128),
      createdAt: s.createdAt || new Date().toISOString(),
      lastUsedAt: s.lastUsedAt || new Date().toISOString()
    }));

  return { users, sessions: cleanedSessions };
}

function closeAllRoomsForRestore(message) {
  Array.from(rooms.values()).forEach((room) => closeRoom(room, message));
}

function migrateDb(data) {
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.adminLogs)) data.adminLogs = [];
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.battleLogs)) data.battleLogs = [];
  if (!Array.isArray(data.fraudAlerts)) data.fraudAlerts = [];
  data.settings = normalizeSettings(data.settings);
  for (const user of data.users) ensureUserFields(user);
}
function ensureUserFields(user) {
  if (!user) return user;
  if (!Array.isArray(user.recentGames)) user.recentGames = [];
  if (!Array.isArray(user.matchHistory)) user.matchHistory = [];
  if (!Number.isInteger(user.currentWinStreak)) user.currentWinStreak = 0;
  if (!Number.isInteger(user.bestWinStreak)) user.bestWinStreak = Math.max(0, user.currentWinStreak || 0);
  if (!Array.isArray(user.ipHistory)) user.ipHistory = [];
  if (typeof user.lastIp !== 'string') user.lastIp = '';
  if (typeof user.isVip !== 'boolean') user.isVip = false;
  if (typeof user.isLocked !== 'boolean') user.isLocked = false;
  if (typeof user.lockReason !== 'string') user.lockReason = '';
  if (typeof user.lockedAt !== 'string') user.lockedAt = '';
  if (typeof user.lockedBy !== 'string') user.lockedBy = '';
  if (typeof user.lockedIp !== 'string') user.lockedIp = '';
  user.avatar = clampStoredImage(user.avatar, MAX_AVATAR_BYTES);
  delete user.background;
  user.recentGames = pruneGameEntries(user.recentGames, 10);
  user.matchHistory = pruneGameEntries(user.matchHistory, MAX_MATCH_HISTORY);
  return user;
}

function clampStoredImage(value, maxBytes) {
  const img = String(value || '');
  if (!img) return '';
  if (!img.startsWith('data:image/')) return '';
  return Buffer.byteLength(img, 'utf8') <= maxBytes ? img : '';
}

function pruneGameEntries(entries, limit) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-limit).map((g) => {
    if (!g || typeof g !== 'object') return g;
    return {
      id: g.id || '',
      at: g.at || '',
      result: g.result || '',
      opponent: cleanText(g.opponent || '', 40),
      opponentUsername: cleanText(g.opponentUsername || '', 32),
      opponentType: 'user',
      roomCode: cleanText(g.roomCode || '', 12),
      score: cleanText(g.score || '', 12),
      finalScore: cleanText(g.finalScore || '', 12),
      rounds: Array.isArray(g.rounds) ? g.rounds.slice(0, 9).map(slimRoundForStorage) : []
    };
  });
}

function slimRoundForStorage(round) {
  if (!round || typeof round !== 'object') return round;
  return {
    round: Number(round.round || 0),
    firstSeat: Number.isInteger(round.firstSeat) ? round.firstSeat : null,
    winnerSeat: Number.isInteger(round.winnerSeat) ? round.winnerSeat : null,
    players: Array.isArray(round.players) ? round.players.map((p) => ({
      seat: Number.isInteger(p?.seat) ? p.seat : null,
      name: cleanText(p?.name || '', 40),
      bid: Number.isFinite(Number(p?.bid)) ? Number(p.bid) : null,
      color: cleanText(p?.color || '', 10),
      remaining: Number.isFinite(Number(p?.remaining)) ? Number(p.remaining) : null,
      tier: cleanText(p?.tier || '', 2),
      wins: Number.isFinite(Number(p?.wins)) ? Number(p.wins) : 0
    })) : []
  };
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
    isLocked: false,
    lockReason: '',
    lockedAt: '',
    lockedBy: '',
    lockedIp: '',
    avatar: '',
    recentGames: [],
    matchHistory: [],
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

function passwordValidationError(password, label = 'Mật khẩu') {
  const length = String(password || '').length;
  if (length < PASSWORD_MIN_LENGTH) return `${label} cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`;
  if (length > PASSWORD_MAX_LENGTH) return `${label} tối đa ${PASSWORD_MAX_LENGTH} ký tự.`;
  return '';
}

function setUserPassword(user, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  user.salt = salt;
  user.passwordHash = hashPassword(password, salt);
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

function isLocalOrUnknownIp(ip) {
  const value = String(ip || '').trim();
  return !value || value === 'unknown' || value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

function lockedMessage(user) {
  ensureUserFields(user);
  return `Tài khoản của bạn đang bị khóa tạm thời. Lý do: ${user.lockReason || 'Nghi ngờ gian lận'}. Chỉ admin mới có thể mở khóa.`;
}

function isUserLocked(user) {
  if (!user) return false;
  ensureUserFields(user);
  return !!user.isLocked;
}

function removeSessionsForUser(userId) {
  if (!Array.isArray(db.sessions)) db.sessions = [];
  db.sessions = db.sessions.filter(s => s.userId !== userId);
}

function lockUserAccount(user, reason, ip = '', lockedBy = 'system', skipSocketId = '') {
  if (!user || user.isAdmin) return false;
  ensureUserFields(user);
  if (lockedBy === 'auto_ip_duplicate' && user.isVip) return false;
  const changed = !user.isLocked || user.lockReason !== reason || user.lockedIp !== ip;
  user.isLocked = true;
  user.lockReason = cleanText(reason || 'Nghi ngờ gian lận', 120);
  user.lockedAt = new Date().toISOString();
  user.lockedBy = lockedBy;
  user.lockedIp = cleanText(ip || user.lastIp || '', 80);
  removeSessionsForUser(user.id);

  socketsForUser(user.id).forEach((s) => {
    if (skipSocketId && s.id === skipSocketId) return;
    s.emit('accountLocked', { message: lockedMessage(user) });
    const code = s.data.roomCode;
    const room = rooms.get(code);
    if (room) closeRoom(room, `${user.displayName} bị khóa tạm thời vì nghi ngờ gian lận IP. Phòng đã đóng.`);
    s.disconnect(true);
  });

  return changed;
}

function getFraudAlerts(limit = 50) {
  if (!Array.isArray(db.fraudAlerts)) db.fraudAlerts = [];
  return db.fraudAlerts.slice(-limit).reverse();
}

function emitAdminAlertsToSocket(socket) {
  const p = currentProfile(socket);
  if (p?.isAdmin) socket.emit('adminFraudAlertsState', { alerts: getFraudAlerts(50) });
}

function broadcastAdminAlerts() {
  io.sockets.sockets.forEach((s) => emitAdminAlertsToSocket(s));
}

function updateFraudAlertResolution(ip, adminUser = null) {
  if (!Array.isArray(db.fraudAlerts)) db.fraudAlerts = [];
  const stillLocked = db.users.some((u) => {
    ensureUserFields(u);
    return u.lastIp === ip && u.isLocked;
  });
  if (stillLocked) return;
  const now = new Date().toISOString();
  db.fraudAlerts.forEach((a) => {
    if (a.ip === ip && !a.resolvedAt) {
      a.resolvedAt = now;
      a.resolvedBy = adminUser ? `${adminUser.displayName} (@${adminUser.username})` : 'admin';
    }
  });
}

function checkDuplicateIpAndLock(ip, socket = null, reasonSource = '') {
  ip = cleanText(ip || '', 80);
  if (isLocalOrUnknownIp(ip)) return { locked: false, totalAccounts: 0, lockedAccounts: [] };
  if (!Array.isArray(db.fraudAlerts)) db.fraudAlerts = [];

  const accounts = db.users.filter((u) => {
    ensureUserFields(u);
    return u.lastIp === ip;
  });

  if (accounts.length <= 2) return { locked: false, totalAccounts: accounts.length, lockedAccounts: [] };

  const targets = accounts.filter(u => !u.isAdmin && !u.isVip);
  const reason = `Nghi ngờ gian lận: có ${accounts.length} tài khoản dùng cùng IP ${ip}.`;
  const lockedAccounts = [];
  let newlyLocked = 0;

  targets.forEach((u) => {
    const wasLocked = !!u.isLocked;
    const changed = lockUserAccount(u, reason, ip, 'auto_ip_duplicate', socket?.id || '');
    if (!wasLocked || changed) newlyLocked += 1;
    lockedAccounts.push({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      isAdmin: !!u.isAdmin,
      isVip: !!u.isVip,
      alreadyLocked: wasLocked
    });
  });

  const now = new Date().toISOString();
  const openAlert = db.fraudAlerts.find(a => a.ip === ip && !a.resolvedAt);
  const alertPayload = {
    ip,
    totalAccounts: accounts.length,
    lockedCount: targets.length,
    source: cleanText(reasonSource || 'ip_duplicate', 40),
    users: accounts.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      isAdmin: !!u.isAdmin,
      isVip: !!u.isVip,
      isLocked: !!u.isLocked
    })),
    message: `Cảnh báo: ${accounts.length} tài khoản đang dùng cùng IP ${ip}. Chỉ các tài khoản thường bị khóa tạm thời; VIP và admin không bị khóa.`
  };

  let alertEntry;
  if (openAlert) {
    Object.assign(openAlert, alertPayload, { updatedAt: now });
    alertEntry = openAlert;
  } else {
    alertEntry = { id: crypto.randomUUID(), at: now, ...alertPayload };
    db.fraudAlerts.push(alertEntry);
    db.fraudAlerts = db.fraudAlerts.slice(-200);
  }

  saveDb();
  addAdminLog('ip_duplicate_lock', socket, { ip, totalAccounts: accounts.length, lockedAccounts, source: reasonSource });
  broadcastAdminUsers();
  broadcastAdminAlerts();
  io.sockets.sockets.forEach((s) => {
    const p = currentProfile(s);
    if (p?.isAdmin) s.emit('adminFraudAlert', alertEntry);
  });
  return { locked: newlyLocked > 0, totalAccounts: accounts.length, lockedAccounts };
}

function cleanImage(value, maxBytes) {
  const img = String(value || '').trim();
  if (!img) return '';
  if (!img.startsWith('data:image/')) throw new Error('Ảnh phải là file ảnh hợp lệ.');
  const bytes = Buffer.byteLength(img, 'utf8');
  if (bytes > maxBytes) throw new Error(`Ảnh quá nặng. Tối đa ${Math.round(maxBytes / 1024)}KB.`);
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
    isLocked: !!user.isLocked,
    lockReason: user.lockReason || '',
    lockedAt: user.lockedAt || '',
    lockedIp: user.lockedIp || '',
    lockedBy: user.lockedBy || '',
    roleBadges: roleBadgesForUser(user),
    avatar: user.avatar || '',
    currentWinStreak: user.currentWinStreak || 0,
    bestWinStreak: user.bestWinStreak || 0,
    stats: recentStats(user)
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
    isLocked: !!user.isLocked,
    lockReason: user.lockReason || '',
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
        isLocked: !!u.isLocked,
        roleBadges: roleBadgesForUser(u),
        currentWinStreak: u.currentWinStreak || 0,
        bestWinStreak: u.bestWinStreak || 0,
        recentTotal: Array.isArray(u.recentGames) ? u.recentGames.length : 0
      };
    })
    .filter(u => !u.isLocked && Number(u.currentWinStreak || 0) >= 3)
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
    isLocked: !!user.isLocked,
    lockReason: user.lockReason || '',
    lockedAt: user.lockedAt || '',
    lockedIp: user.lockedIp || '',
    lockedBy: user.lockedBy || '',
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
  if (p?.isAdmin) socket.emit('adminUsersState', { users: getAdminUsers(), alerts: getFraudAlerts(50) });
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

function isPrivilegedSocket(socket) {
  const p = currentProfile(socket);
  return !!(p && (p.isAdmin || p.isVip));
}

function leaderboardPayloadForSocket(socket) {
  const settings = appSettings();
  const privileged = isPrivilegedSocket(socket);
  const visible = !!settings.leaderboardPublic || privileged;
  return {
    visible,
    publicEnabled: !!settings.leaderboardPublic,
    privileged,
    message: visible ? '' : 'Bảng xếp hạng đang được admin tắt. Chỉ VIP/Admin mới xem được.',
    leaderboard: visible ? getLeaderboard(20) : []
  };
}

function emitLeaderboardToSocket(socket) {
  socket.emit('leaderboardState', leaderboardPayloadForSocket(socket));
}

function broadcastLeaderboard() {
  io.sockets.sockets.forEach((s) => emitLeaderboardToSocket(s));
}

function adminSettingsPayload() {
  return { settings: appSettings() };
}

function emitAdminSettingsToSocket(socket) {
  const p = currentProfile(socket);
  if (p?.isAdmin) socket.emit('adminSettingsState', adminSettingsPayload());
}

function broadcastAdminSettings() {
  io.sockets.sockets.forEach((s) => emitAdminSettingsToSocket(s));
}

function summaryForSocket(summary, socket) {
  const settings = appSettings();
  const privileged = isPrivilegedSocket(socket);
  const canViewMatchLog = !!settings.matchLogPublic || privileged;
  const copy = JSON.parse(JSON.stringify(summary || {}));
  copy.matchLogVisible = canViewMatchLog;
  copy.matchLogPublic = !!settings.matchLogPublic;
  if (!canViewMatchLog) {
    copy.rounds = [];
    copy.matchLogMessage = 'Log sau trận đấu đang được admin tắt. Chỉ VIP/Admin mới xem được chi tiết từng vòng.';
  } else {
    copy.matchLogMessage = '';
  }
  return copy;
}

function emitAllRooms() {
  rooms.forEach((room) => emitRoom(room));
}

function actorForLog(socket) {
  if (!socket) {
    return {
      type: 'system',
      accountId: null,
      username: 'system',
      name: 'Hệ thống',
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
      socketId: socket.id,
      ip: getClientIp(socket)
    };
  }



  return {
    type: 'anonymous',
    accountId: null,
    username: 'anonymous',
    name: 'Chưa đăng nhập',
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
      if (lower.includes('avatar')) {
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
  db.adminLogs = db.adminLogs.slice(-MAX_ADMIN_LOGS);
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
  if (actor.type === 'system') return 'Hệ thống';
  return actor.name || 'Không rõ';
}

function requireAuth(socket, cb) {
  const profile = currentProfile(socket);
  if (!profile) {
    cb?.({ ok: false, error: 'Bạn cần đăng nhập bằng tài khoản.' });
    return null;
  }
  if (profile.type === 'user') {
    const user = getUserById(profile.id);
    if (isUserLocked(user)) {
      cb?.({ ok: false, error: lockedMessage(user) });
      return null;
    }
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
  if (!profile || profile.type !== 'user') throw new Error('Bạn cần đăng nhập bằng tài khoản.');
  return {
    accountId: profile.id,
    username: profile.username,
    name: profile.displayName,
    avatar: profile.avatar || '',
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
      badge: p?.accountId ? badgeForAccount(p.accountId) : null,
      isAdmin: !!p?.isAdmin,
      isVip: !!p?.isVip,
      roleBadges: p?.roleBadges || [],
      effectType: roleEffectType(p),
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
      username: p?.username || '',
      type: 'user',
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
      username: p?.username || 'unknown',
      name: p?.name || 'Không rõ',
      type: 'user',
      isAdmin: !!p?.isAdmin,
      isVip: !!p?.isVip,
      ip: p?.ip || '',
      wins: p?.wins || 0,
      result: winnerSeat === null ? 'draw' : winnerSeat === seat ? 'win' : 'loss'
    }))
  };
  db.battleLogs.push(battleLog);
  db.battleLogs = db.battleLogs.slice(-MAX_BATTLE_LOGS);

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
      opponentUsername: opp?.username || '',
      opponentType: 'user',
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
    user.matchHistory = user.matchHistory.slice(-MAX_MATCH_HISTORY);

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
    players: room.players.map(p => ({ name: p.name, type: 'user', username: p.username })),
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
    playerSocket.emit('gameEnded', { summary: summaryForSocket(summary, playerSocket) });
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
      username: p.username || '',
      type: 'user',
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
  room.firstSeat = crypto.randomInt(0, 2);
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
      if (isUserLocked(user)) {
        return cb?.({ ok: false, error: lockedMessage(user) });
      }
      attachUserToSocket(socket, user);
      recordIpForUser(user, socket);
      checkDuplicateIpAndLock(user.lastIp, socket, 'login');
      if (isUserLocked(user)) {
        socket.data.authType = undefined;
        socket.data.userId = undefined;
        return cb?.({ ok: false, error: lockedMessage(user) });
      }
      const sessionToken = createSession(user.id);
      const rejoined = reconnectActiveRoom(socket, user.id);
      addAdminLog('login_user', socket, { action: 'Đăng nhập tài khoản', rejoinedRoom: rejoined?.code || '' });
      cb?.({ ok: true, profile: safeUser(user), sessionToken, rejoined });
      sendProfile(socket);
      broadcastAdminUsers();
      emitLeaderboardToSocket(socket);
      if (safeUser(user).isAdmin) { emitAdminUsersToSocket(socket); emitAdminSettingsToSocket(socket); emitAdminAlertsToSocket(socket); }
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
      if (isUserLocked(user)) {
        removeSessionsForUser(user.id);
        saveDb();
        return cb?.({ ok: false, error: lockedMessage(user) });
      }
      attachUserToSocket(socket, user);
      recordIpForUser(user, socket);
      checkDuplicateIpAndLock(user.lastIp, socket, 'resume_session');
      if (isUserLocked(user)) {
        socket.data.authType = undefined;
        socket.data.userId = undefined;
        return cb?.({ ok: false, error: lockedMessage(user) });
      }
      const rejoined = reconnectActiveRoom(socket, user.id);
      addAdminLog('resume_session', socket, { action: 'Tự đăng nhập lại bằng phiên đã lưu', rejoinedRoom: rejoined?.code || '' });
      cb?.({ ok: true, profile: safeUser(user), rejoined });
      sendProfile(socket);
      broadcastAdminUsers();
      emitLeaderboardToSocket(socket);
      if (safeUser(user).isAdmin) { emitAdminUsersToSocket(socket); emitAdminSettingsToSocket(socket); emitAdminAlertsToSocket(socket); }
      if (rejoined) {
        const room = rooms.get(rejoined.code);
        if (room) emitRoom(room);
      }
    } catch (err) {
      cb?.({ ok: false, error: 'Không khôi phục được phiên đăng nhập.' });
    }
  });

  socket.on('registerAccount', ({ username, password, confirmPassword, displayName }, cb) => {
    try {
      const cleanUsername = normalizeUsername(username);
      const cleanDisplayName = cleanText(displayName || username, 24);
      if (cleanUsername.length < 3) return cb?.({ ok: false, error: 'Username cần ít nhất 3 ký tự: a-z, 0-9, dấu gạch, dấu chấm.' });
      const passwordErrorText = passwordValidationError(password);
      if (passwordErrorText) return cb?.({ ok: false, error: passwordErrorText });
      if (password !== confirmPassword) return cb?.({ ok: false, error: 'Nhập lại mật khẩu chưa khớp.' });
      if (getUserByUsername(cleanUsername)) return cb?.({ ok: false, error: 'Username này đã tồn tại.' });

      const user = makeUser(cleanUsername, password, cleanDisplayName, false);
      db.users.push(user);
      recordIpForUser(user, socket);
      checkDuplicateIpAndLock(user.lastIp, socket, 'register_account');
      saveDb();
      if (isUserLocked(user)) {
        addAdminLog('register_account_locked', socket, { username: cleanUsername, displayName: cleanDisplayName, reason: user.lockReason });
        broadcastAdminUsers();
        return cb?.({ ok: false, error: lockedMessage(user) });
      }
      attachUserToSocket(socket, user);
      const sessionToken = createSession(user.id);
      addAdminLog('register_account', socket, { username: cleanUsername, displayName: cleanDisplayName });
      cb?.({ ok: true, profile: safeUser(user), sessionToken, message: 'Đã tạo tài khoản và đăng nhập.' });
      sendProfile(socket);
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
      cb?.({ ok: true, users: getAdminUsers(), alerts: getFraudAlerts(50) });
      emitAdminUsersToSocket(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được danh sách tài khoản.' });
    }
  });


  socket.on('downloadAccountsBackup', (_payload = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới tải được file backup tài khoản.' });
      const backup = buildAccountsBackup();
      const date = new Date().toISOString().slice(0, 10);
      addAdminLog('download_accounts_backup', socket, { users: backup.accounts.users.length });
      cb?.({ ok: true, filename: `accounts-backup-${date}.json`, backup });
    } catch (err) {
      cb?.({ ok: false, error: 'Không tạo được file backup.' });
    }
  });

  socket.on('restoreAccountsBackup', ({ backupText } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới khôi phục được file backup tài khoản.' });
      const text = String(backupText || '');
      if (!text.trim()) return cb?.({ ok: false, error: 'Chưa chọn file backup.' });
      if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) return cb?.({ ok: false, error: 'File backup quá nặng. Tối đa 2MB.' });

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        return cb?.({ ok: false, error: 'File backup không phải JSON hợp lệ.' });
      }

      const currentAdminUsername = profile.username;
      const imported = normalizeImportedAccounts(parsed);
      const previousUserCount = Array.isArray(db.users) ? db.users.length : 0;

      closeAllRoomsForRestore('Admin vừa khôi phục dữ liệu tài khoản. Phòng đã đóng, hãy tạo phòng mới.');
      db.users = imported.users;
      db.sessions = imported.sessions;
      migrateDb(db);
      saveDb();

      const restoredAdmin = getUserByUsername(currentAdminUsername);
      let sessionToken = '';
      let restoredProfile = null;
      if (restoredAdmin?.isAdmin && !isUserLocked(restoredAdmin)) {
        attachUserToSocket(socket, restoredAdmin);
        sessionToken = createSession(restoredAdmin.id);
        restoredProfile = safeUser(restoredAdmin);
      }

      addAdminLog('restore_accounts_backup', socket, {
        previousUserCount,
        restoredUserCount: db.users.length,
        restoredSessionCount: db.sessions.length
      });
      broadcastLeaderboard();
      broadcastAdminUsers();
      broadcastAdminAlerts();
      broadcastAdminBattleLogs();
      io.sockets.sockets.forEach((s) => {
        if (s.id !== socket.id) s.emit('accountsRestored', { message: 'Admin vừa khôi phục dữ liệu tài khoản. Trang sẽ tải lại.' });
      });
      if (restoredProfile) sendProfile(socket);
      cb?.({
        ok: true,
        message: `Đã khôi phục ${db.users.length} tài khoản từ file backup. Các phòng đang mở đã được đóng.`,
        profile: restoredProfile,
        sessionToken
      });
    } catch (err) {
      cb?.({ ok: false, error: err.message || 'Không khôi phục được file backup.' });
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

  socket.on('unlockAccount', ({ userId } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới mở khóa tài khoản.' });
      const target = getUserById(userId);
      if (!target) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      ensureUserFields(target);
      if (!target.isLocked) return cb?.({ ok: true, message: 'Tài khoản này hiện không bị khóa.' });

      const old = {
        username: target.username,
        displayName: target.displayName,
        reason: target.lockReason,
        lockedIp: target.lockedIp || target.lastIp || ''
      };
      target.isLocked = false;
      target.lockReason = '';
      target.lockedAt = '';
      target.lockedBy = '';
      const ip = target.lockedIp || target.lastIp || '';
      target.lockedIp = '';
      updateFraudAlertResolution(ip, getUserById(profile.id));
      saveDb();
      addAdminLog('unlock_account', socket, { unlocked: old });
      broadcastAdminUsers();
      broadcastAdminAlerts();
      cb?.({ ok: true, message: `Đã mở khóa tài khoản @${target.username}.` });
    } catch (err) {
      cb?.({ ok: false, error: 'Không mở khóa được tài khoản.' });
    }
  });

  socket.on('createAccount', ({ username, password, displayName, isAdmin, isVip }, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới được tạo tài khoản.' });

      const cleanUsername = normalizeUsername(username);
      const cleanDisplayName = cleanText(displayName || username, 24);
      if (cleanUsername.length < 3) return cb?.({ ok: false, error: 'Username cần ít nhất 3 ký tự: a-z, 0-9, dấu gạch, dấu chấm.' });
      const passwordErrorText = passwordValidationError(password);
      if (passwordErrorText) return cb?.({ ok: false, error: passwordErrorText });
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


  socket.on('adminSetUserPassword', ({ userId, newPassword } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới đặt lại mật khẩu tài khoản.' });
      const target = getUserById(userId);
      if (!target) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });

      const passwordErrorText = passwordValidationError(newPassword, 'Mật khẩu mới');
      if (passwordErrorText) return cb?.({ ok: false, error: passwordErrorText });

      setUserPassword(target, newPassword);
      // Khi admin reset mật khẩu, xóa phiên đăng nhập cũ để tài khoản phải đăng nhập lại bằng mật khẩu mới.
      db.sessions = (db.sessions || []).filter(s => s.userId !== target.id);
      saveDb();

      socketsForUser(target.id).forEach((s) => {
        if (s.id !== socket.id) {
          s.emit('passwordResetByAdmin', { message: 'Mật khẩu tài khoản của bạn đã được admin đặt lại. Hãy đăng nhập lại.' });
          s.disconnect(true);
        }
      });

      addAdminLog('admin_set_user_password', socket, { targetUsername: target.username, targetDisplayName: target.displayName });
      broadcastAdminUsers();
      cb?.({ ok: true, message: `Đã đặt lại mật khẩu cho @${target.username}.` });
    } catch (err) {
      cb?.({ ok: false, error: 'Không đặt lại được mật khẩu.' });
    }
  });

  socket.on('changePassword', ({ oldPassword, newPassword, confirmPassword }, cb) => {
    try {
      const profile = requireAuth(socket, cb);
      if (!profile) return;
      const user = getUserById(socket.data.userId);
      if (!user) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      if (!verifyPassword(user, oldPassword || '')) return cb?.({ ok: false, error: 'Mật khẩu cũ không đúng.' });
      const passwordErrorText = passwordValidationError(newPassword, 'Mật khẩu mới');
      if (passwordErrorText) return cb?.({ ok: false, error: passwordErrorText });
      if (newPassword !== confirmPassword) return cb?.({ ok: false, error: 'Nhập lại mật khẩu mới chưa khớp.' });
      if (oldPassword === newPassword) return cb?.({ ok: false, error: 'Mật khẩu mới không được trùng mật khẩu cũ.' });

      setUserPassword(user, newPassword);
      saveDb();
      addAdminLog('change_password', socket, { action: 'Đổi mật khẩu' });
      cb?.({ ok: true, message: 'Đã đổi mật khẩu. Lần sau hãy đăng nhập bằng mật khẩu mới.' });
    } catch (err) {
      cb?.({ ok: false, error: 'Không đổi được mật khẩu.' });
    }
  });

  socket.on('updateProfile', ({ displayName, avatar, clearAvatar }, cb) => {
    try {
      const profile = requireAuth(socket, cb);
      if (!profile) return;

      const newName = cleanText(displayName, 24);
      const user = getUserById(socket.data.userId);
      if (!user) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      const wantsAvatarChange = !!clearAvatar || avatar !== undefined;
      const canChangeMedia = !!user.isAdmin || !!user.isVip;
      if (wantsAvatarChange && !canChangeMedia) {
        return cb?.({ ok: false, error: 'Chỉ có tài khoản VIP mới có quyền thay đổi avatar' });
      }

      if (newName) user.displayName = newName;
      if (wantsAvatarChange) {
        if (clearAvatar) user.avatar = '';
        else if (avatar !== undefined) user.avatar = cleanImage(avatar, MAX_AVATAR_BYTES);
      }
      saveDb();
      cb?.({ ok: true, profile: safeUser(user) });

      addAdminLog('update_profile', socket, {
        displayName: newName || profile.displayName,
        changedAvatar: !!clearAvatar || avatar !== undefined
      });
      sendProfile(socket);
      broadcastLeaderboard();

      const code = socket.data.roomCode;
      const seat = socket.data.seat;
      const room = rooms.get(code);
      if (room && seat !== undefined && room.players[seat] && room.players[seat].id === socket.id) {
        const updated = profileForPlayer(socket);
        room.players[seat].name = updated.name;
        room.players[seat].avatar = updated.avatar;
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
      const payload = leaderboardPayloadForSocket(socket);
      cb?.({ ok: true, ...payload });
      emitLeaderboardToSocket(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được bảng xếp hạng.' });
    }
  });

  socket.on('getAdminSettings', (_payload, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới xem được cài đặt hiển thị.' });
      const payload = adminSettingsPayload();
      cb?.({ ok: true, ...payload });
      emitAdminSettingsToSocket(socket);
    } catch (err) {
      cb?.({ ok: false, error: 'Không tải được cài đặt.' });
    }
  });

  socket.on('adminAnnouncement', ({ message } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới gửi thông báo toàn server.' });
      const cleanMessage = cleanText(message, 240);
      if (!cleanMessage) return cb?.({ ok: false, error: 'Nhập nội dung thông báo trước đã.' });
      const payload = {
        senderName: profile.displayName || profile.username || 'Admin',
        senderUsername: profile.username || '',
        message: cleanMessage,
        at: new Date().toISOString()
      };
      addAdminLog('admin_announcement', socket, { message: cleanMessage });
      io.emit('adminAnnouncement', payload);
      cb?.({ ok: true, message: 'Đã gửi thông báo tới toàn bộ người chơi.' });
    } catch (err) {
      cb?.({ ok: false, error: 'Không gửi được thông báo.' });
    }
  });

  socket.on('updateAdminSettings', ({ leaderboardPublic, matchLogPublic } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới chỉnh được cài đặt hiển thị.' });
      const settings = appSettings();
      if (typeof leaderboardPublic === 'boolean') settings.leaderboardPublic = leaderboardPublic;
      if (typeof matchLogPublic === 'boolean') settings.matchLogPublic = matchLogPublic;
      db.settings = settings;
      saveDb();
      addAdminLog('update_admin_settings', socket, { leaderboardPublic: settings.leaderboardPublic, matchLogPublic: settings.matchLogPublic });
      broadcastLeaderboard();
      broadcastAdminSettings();
      cb?.({ ok: true, settings, message: 'Đã lưu cài đặt hiển thị.' });
    } catch (err) {
      cb?.({ ok: false, error: 'Không lưu được cài đặt.' });
    }
  });

  socket.on('adminSetWinStreak', ({ userId, currentWinStreak } = {}, cb) => {
    try {
      const profile = currentProfile(socket);
      if (!profile?.isAdmin) return cb?.({ ok: false, error: 'Chỉ admin mới chỉnh được điểm bảng xếp hạng.' });
      const target = getUserById(userId);
      if (!target) return cb?.({ ok: false, error: 'Không tìm thấy tài khoản.' });
      const value = Number(currentWinStreak);
      if (!Number.isInteger(value) || value < 0 || value > 999) return cb?.({ ok: false, error: 'Chuỗi thắng phải là số nguyên từ 0 đến 999.' });
      ensureUserFields(target);
      const oldValue = target.currentWinStreak || 0;
      target.currentWinStreak = value;
      target.bestWinStreak = Math.max(Number(target.bestWinStreak || 0), value);
      saveDb();
      socketsForUser(target.id).forEach((s) => sendProfile(s));
      addAdminLog('admin_set_win_streak', socket, { username: target.username, oldValue, newValue: value });
      broadcastLeaderboard();
      broadcastAdminUsers();
      emitAllRooms();
      cb?.({ ok: true, message: `Đã chỉnh chuỗi thắng của ${target.displayName} thành ${value}.` });
    } catch (err) {
      cb?.({ ok: false, error: 'Không chỉnh được điểm bảng xếp hạng.' });
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

      addAdminLog('create_room', socket, { roomCode: code, player: p.name });

      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.seat = 0;
      cb?.({ ok: true, code, seat: 0 });
      emitRoom(room);
      emitRoomEffect(room, room.players[0], 'tạo phòng');
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
      addAdminLog('join_room', socket, { roomCode: code, player: p.name });
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.seat = 1;
      cb?.({ ok: true, code, seat: 1 });
      emitRoom(room);
      emitRoomEffect(room, room.players[1], 'vào phòng');
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
      players: room.players.map(p => ({ name: p.name, type: 'user', username: p.username }))
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
    const movePublicInfo = {
      seat,
      playerName: p.name,
      playerLabel: `Người chơi ${seat + 1}`,
      color: colorOf(bid),
      tier: tier(p.remaining),
      round: room.round,
      remainingTier: tier(p.remaining)
    };
    room.log.push(`${p.name} đã gửi điểm: ${colorOf(bid)}, mốc ${tier(p.remaining)}`);
    io.to(room.code).emit('playerMoveNotice', movePublicInfo);
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
        broadcastAdminUsers();
      }, 150);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Đen Trắng II đang chạy tại http://localhost:${PORT}`);
});
