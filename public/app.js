const socket = io();

let roomState = null;
let privateState = null;
let mySeat = null;
let profile = null;
let pendingAvatar;
let pendingBackground;
let clearAvatar = false;
let clearBackground = false;
let adminLogsLoaded = false;

const $ = (id) => document.getElementById(id);

const authBox = $('authBox');
const dashboardBox = $('dashboardBox');
const gameBox = $('gameBox');
const authError = $('authError');
const joinError = $('joinError');
const bidError = $('bidError');
const profileError = $('profileError');
const profileSuccess = $('profileSuccess');
const passwordError = $('passwordError');
const passwordSuccess = $('passwordSuccess');
const adminError = $('adminError');
const adminSuccess = $('adminSuccess');
const adminLogError = $('adminLogError');

$('loginBtn').onclick = () => {
  authError.textContent = '';
  socket.emit('login', {
    username: $('loginUsername').value,
    password: $('loginPassword').value
  }, (res) => {
    if (!res.ok) return authError.textContent = res.error;
    profile = res.profile;
    showDashboard();
    renderProfile();
  });
};

$('guestBtn').onclick = () => {
  authError.textContent = '';
  socket.emit('guestLogin', { name: $('guestName').value }, (res) => {
    if (!res.ok) return authError.textContent = res.error;
    profile = res.profile;
    showDashboard();
    renderProfile();
  });
};

$('createBtn').onclick = () => {
  joinError.textContent = '';
  socket.emit('createRoom', (res) => {
    if (!res.ok) return joinError.textContent = res.error;
    mySeat = res.seat;
    dashboardBox.classList.add('hidden');
    gameBox.classList.remove('hidden');
  });
};

$('joinBtn').onclick = () => {
  joinError.textContent = '';
  socket.emit('joinRoom', { code: $('roomInput').value }, (res) => {
    if (!res.ok) return joinError.textContent = res.error;
    mySeat = res.seat;
    dashboardBox.classList.add('hidden');
    gameBox.classList.remove('hidden');
  });
};

$('copyBtn').onclick = async () => {
  if (!roomState) return;
  await navigator.clipboard.writeText(roomState.code);
  $('copyBtn').textContent = 'Đã copy';
  setTimeout(() => $('copyBtn').textContent = 'Copy mã', 1200);
};

$('startBtn').onclick = () => {
  socket.emit('startGame', (res) => {
    if (!res.ok) alert(res.error);
  });
};

$('restartBtn').onclick = () => {
  socket.emit('restartGame', (res) => {
    if (!res.ok) alert(res.error);
  });
};

$('bidBtn').onclick = submitBid;
$('bidInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitBid();
});

$('avatarFile').onchange = async (e) => {
  profileError.textContent = '';
  if (profile?.type !== 'user') {
    profileError.textContent = 'Khách không thể sửa hồ sơ. Hãy đăng nhập bằng tài khoản.';
    e.target.value = '';
    return;
  }
  try {
    pendingAvatar = await readImageFile(e.target.files[0], 2 * 1024 * 1024);
    clearAvatar = false;
    profileSuccess.textContent = 'Đã chọn avatar mới, bấm Lưu thay đổi.';
  } catch (err) {
    profileError.textContent = err.message;
    e.target.value = '';
  }
};

$('backgroundFile').onchange = async (e) => {
  profileError.textContent = '';
  if (profile?.type !== 'user') {
    profileError.textContent = 'Khách không thể sửa hồ sơ. Hãy đăng nhập bằng tài khoản.';
    e.target.value = '';
    return;
  }
  try {
    pendingBackground = await readImageFile(e.target.files[0], 4 * 1024 * 1024);
    clearBackground = false;
    profileSuccess.textContent = 'Đã chọn nền mới, bấm Lưu thay đổi.';
  } catch (err) {
    profileError.textContent = err.message;
    e.target.value = '';
  }
};

$('clearAvatarBtn').onclick = () => {
  if (profile?.type !== 'user') return profileError.textContent = 'Khách không thể sửa hồ sơ. Hãy đăng nhập bằng tài khoản.';
  pendingAvatar = undefined;
  clearAvatar = true;
  $('avatarFile').value = '';
  profileSuccess.textContent = 'Sẽ xóa avatar khi bạn bấm Lưu thay đổi.';
};

$('clearBackgroundBtn').onclick = () => {
  if (profile?.type !== 'user') return profileError.textContent = 'Khách không thể sửa hồ sơ. Hãy đăng nhập bằng tài khoản.';
  pendingBackground = undefined;
  clearBackground = true;
  $('backgroundFile').value = '';
  profileSuccess.textContent = 'Sẽ xóa nền khi bạn bấm Lưu thay đổi.';
};

$('saveProfileBtn').onclick = () => {
  profileError.textContent = '';
  profileSuccess.textContent = '';
  if (profile?.type !== 'user') {
    profileError.textContent = 'Khách không thể sửa hồ sơ. Hãy đăng nhập bằng tài khoản.';
    return;
  }
  const payload = {
    displayName: $('displayNameInput').value,
    clearAvatar,
    clearBackground
  };
  if (pendingAvatar !== undefined) payload.avatar = pendingAvatar;
  if (pendingBackground !== undefined) payload.background = pendingBackground;

  socket.emit('updateProfile', payload, (res) => {
    if (!res.ok) return profileError.textContent = res.error;
    profile = res.profile;
    pendingAvatar = undefined;
    pendingBackground = undefined;
    clearAvatar = false;
    clearBackground = false;
    $('avatarFile').value = '';
    $('backgroundFile').value = '';
    profileSuccess.textContent = 'Đã lưu hồ sơ.';
    renderProfile();
  });
};

$('changePasswordBtn').onclick = () => {
  passwordError.textContent = '';
  passwordSuccess.textContent = '';
  socket.emit('changePassword', {
    oldPassword: $('oldPasswordInput').value,
    newPassword: $('newPasswordInput').value,
    confirmPassword: $('confirmPasswordInput').value
  }, (res) => {
    if (!res.ok) return passwordError.textContent = res.error;
    passwordSuccess.textContent = res.message || 'Đã đổi mật khẩu.';
    $('oldPasswordInput').value = '';
    $('newPasswordInput').value = '';
    $('confirmPasswordInput').value = '';
  });
};

$('refreshAdminLogsBtn').onclick = () => {
  loadAdminLogs(true);
};

$('createAccountBtn').onclick = () => {
  adminError.textContent = '';
  adminSuccess.textContent = '';
  socket.emit('createAccount', {
    username: $('newUsername').value,
    displayName: $('newDisplayName').value,
    password: $('newPassword').value,
    isAdmin: $('newIsAdmin').checked
  }, (res) => {
    if (!res.ok) return adminError.textContent = res.error;
    adminSuccess.textContent = res.message || 'Đã tạo tài khoản.';
    $('newUsername').value = '';
    $('newDisplayName').value = '';
    $('newPassword').value = '';
    $('newIsAdmin').checked = false;
  });
};

function loadAdminLogs(showMessage = false) {
  if (!profile?.isAdmin) return;
  adminLogError.textContent = showMessage ? 'Đang tải log...' : '';
  const limit = Number($('adminLogLimit').value) || 100;
  socket.emit('getAdminLogs', { limit }, (res) => {
    if (!res.ok) {
      adminLogError.textContent = res.error;
      return;
    }
    adminLogError.textContent = '';
    renderAdminLogs(res.logs || []);
  });
}

function renderAdminLogs(logs) {
  const el = $('adminLogList');
  if (!logs.length) {
    el.innerHTML = '<li class="muted">Chưa có log.</li>';
    return;
  }

  el.innerHTML = logs.map((log) => {
    const time = new Date(log.at).toLocaleString('vi-VN');
    const actor = formatActor(log.actor);
    const event = eventLabel(log.event);
    const room = log.roomCode ? ` | Phòng ${escapeHtml(log.roomCode)}` : '';
    const detail = formatDetails(log.details || {});
    return `
      <li class="admin-log-item">
        <div><b>${escapeHtml(event)}</b><span class="muted"> | ${escapeHtml(time)}${room}</span></div>
        <div>Người thực hiện: <span class="badge">${escapeHtml(actor)}</span></div>
        ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ''}
      </li>
    `;
  }).join('');
}

function formatActor(actor) {
  if (!actor) return 'Không rõ';
  if (actor.type === 'user') return `${actor.name} (@${actor.username})`;
  if (actor.type === 'guest') return `${actor.name} (Khách)`;
  if (actor.type === 'system') return 'Hệ thống';
  return actor.name || 'Không rõ';
}

function eventLabel(event) {
  const map = {
    login_user: 'Đăng nhập tài khoản',
    login_guest: 'Đăng nhập khách',
    create_account: 'Tạo tài khoản',
    change_password: 'Đổi mật khẩu',
    update_profile: 'Sửa hồ sơ',
    create_room: 'Tạo phòng',
    join_room: 'Vào phòng',
    start_game: 'Bắt đầu ván',
    restart_game: 'Chơi lại',
    submit_bid: 'Gửi điểm',
    round_result: 'Kết quả vòng',
    game_finished: 'Kết thúc ván',
    disconnect: 'Thoát game'
  };
  return map[event] || event;
}

function formatDetails(details) {
  const clean = { ...details };
  delete clean.action;
  delete clean.roomCode;
  const pairs = Object.entries(clean).filter(([, v]) => v !== '' && v !== null && v !== undefined);
  if (!pairs.length) return '';
  return pairs.map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('\n');
}

function submitBid() {
  bidError.textContent = '';
  socket.emit('submitBid', { bid: $('bidInput').value }, (res) => {
    if (!res.ok) return bidError.textContent = res.error;
    $('bidInput').value = '';
  });
}

socket.on('profileState', (state) => {
  profile = state;
  if (!authBox.classList.contains('hidden')) showDashboard();
  renderProfile();
});

socket.on('roomState', (state) => {
  roomState = state;
  renderGame();
});

socket.on('privateState', (state) => {
  privateState = state;
  mySeat = state.yourSeat;
  renderGame();
});

socket.on('adminLogAdded', () => {
  if (profile?.isAdmin && adminLogsLoaded) loadAdminLogs(false);
});

function showDashboard() {
  authBox.classList.add('hidden');
  dashboardBox.classList.remove('hidden');
  gameBox.classList.add('hidden');
}

function renderProfile() {
  if (!profile) return;

  const isUser = profile.type === 'user';

  $('profileName').textContent = profile.displayName;
  $('profileMeta').textContent = isUser
    ? `${profile.username}${profile.isAdmin ? ' - Admin' : ''}`
    : 'Khách';

  setAvatar($('myAvatar'), profile.displayName, isUser ? profile.avatar : '');
  if (isUser && profile.background) document.body.style.backgroundImage = `url("${profile.background}")`;
  else document.body.style.backgroundImage = '';

  $('profileEditCard').classList.toggle('hidden', !isUser);
  $('accountStatsBlock').classList.toggle('hidden', !isUser);
  $('guestNameOnlyBlock').classList.toggle('hidden', isUser);

  if (isUser) {
    $('displayNameInput').value = profile.displayName;

    const s = profile.stats || { total: 0, wins: 0, losses: 0, draws: 0, winRate: 0, recent: [] };
    $('statRate').textContent = `${s.winRate || 0}%`;
    $('statTotal').textContent = s.total || 0;
    $('statWLD').textContent = `${s.wins || 0}/${s.losses || 0}/${s.draws || 0}`;

    if (!s.recent || !s.recent.length) {
      $('recentList').innerHTML = '<li class="muted">Chưa có ván nào được lưu.</li>';
    } else {
      $('recentList').innerHTML = s.recent.map((g) => {
        const label = g.result === 'win' ? 'Thắng' : g.result === 'loss' ? 'Thua' : 'Hòa';
        const date = new Date(g.at).toLocaleString('vi-VN');
        return `<li>${label} vs ${escapeHtml(g.opponent)} | tỉ số ${escapeHtml(g.score)} | ${escapeHtml(date)}</li>`;
      }).join('');
    }
  }

  $('adminPanel').classList.toggle('hidden', !profile.isAdmin);
  $('passwordPanel').classList.toggle('hidden', !isUser);

  if (profile.isAdmin && !adminLogsLoaded) {
    adminLogsLoaded = true;
    loadAdminLogs(false);
  }
}

function renderGame() {
  if (!roomState) return;

  $('roomCode').textContent = roomState.code;

  renderPlayer(0);
  renderPlayer(1);
  renderStatus();
  renderPrivate();
  renderLastRound();
  renderLog();
}

function renderPlayer(seat) {
  const p = roomState.players[seat];
  const card = $(`p${seat}Card`);
  card.classList.toggle('me', mySeat === seat);
  setAvatar($(`p${seat}Avatar`), p.name || `P${seat + 1}`, p.avatar);
  $(`p${seat}Name`).textContent = p.name ? `${p.name}${p.isGuest ? ' (Khách)' : ''}${mySeat === seat ? ' (Bạn)' : ''}` : `Đang chờ người chơi ${seat + 1}`;
  $(`p${seat}Remain`).textContent = p.name ? (p.remaining === null ? 'Ẩn' : p.remaining) : '-';
  $(`p${seat}Tier`).textContent = p.tier || '-';
  $(`p${seat}Wins`).textContent = p.wins || 0;
  $(`p${seat}Sub`).textContent = p.submittedThisRound ? 'Đã gửi điểm vòng này' : 'Chưa gửi';
}

function renderStatus() {
  const p0 = roomState.players[0]?.name;
  const p1 = roomState.players[1]?.name;
  const isHost = mySeat === 0;

  $('startBtn').classList.add('hidden');
  $('restartBtn').classList.add('hidden');

  if (!roomState.started) {
    $('statusTitle').textContent = 'Phòng chờ';
    $('statusText').textContent = p1 ? 'Đủ 2 người. Chủ phòng có thể bắt đầu.' : 'Gửi mã phòng cho bạn để vào chơi.';
    if (isHost && p0 && p1) $('startBtn').classList.remove('hidden');
    return;
  }

  if (roomState.finished) {
    $('statusTitle').textContent = 'Kết thúc ván';
    const a = roomState.players[0].wins;
    const b = roomState.players[1].wins;
    let text = `Tỉ số ${a}-${b}. `;
    if (a > b) text += `${roomState.players[0].name} thắng chung cuộc.`;
    else if (b > a) text += `${roomState.players[1].name} thắng chung cuộc.`;
    else text += 'Hai người hòa.';
    $('statusText').textContent = text + ' Nếu dùng tài khoản, kết quả đã được lưu vào 10 ván gần nhất.';
    if (isHost) $('restartBtn').classList.remove('hidden');
    return;
  }

  const firstName = roomState.players[roomState.firstSeat].name;
  const secondSeat = roomState.firstSeat === 0 ? 1 : 0;
  const secondName = roomState.players[secondSeat].name;

  $('statusTitle').textContent = `Vòng ${roomState.round}/${roomState.maxRounds}`;
  if (roomState.phase === 'waiting_first') {
    $('statusText').textContent = `Lượt ${firstName} đi trước.`;
  } else {
    $('statusText').textContent = `${firstName} đã gửi. Tới lượt ${secondName}.`;
  }
}

function renderPrivate() {
  if (!privateState || !roomState.started || roomState.finished) {
    $('privateInfo').textContent = 'Chưa có thông tin riêng.';
    $('bidBtn').disabled = true;
    $('bidInput').disabled = true;
    return;
  }

  const opp = privateState.opponentPublicInfo;

  let text = `Bạn còn ${privateState.yourRemaining} điểm, mốc ${privateState.yourTier}. `;
  if (opp) text += `Đối thủ vừa gửi: ${opp.color}, mốc còn lại ${opp.tier}.`;
  else text += 'Chưa có thông tin lượt này từ đối thủ.';

  if (privateState.yourBidSubmitted) text += ` Bạn đã gửi điểm vòng này.`;
  else if (privateState.canSubmit) text += ` Đang tới lượt bạn.`;
  else text += ` Chưa tới lượt bạn.`;

  $('privateInfo').textContent = text;
  $('bidBtn').disabled = !privateState.canSubmit;
  $('bidInput').disabled = !privateState.canSubmit;
  $('bidInput').max = privateState.yourRemaining;
}

function renderLastRound() {
  const lr = roomState.lastRound;
  if (!lr) {
    $('lastRound').textContent = 'Chưa có.';
    return;
  }

  const html = `
    <p><b>${escapeHtml(lr.resultText)}</b></p>
    ${lr.players.map(p => `
      <p>
        <span class="badge">${escapeHtml(p.name)}</span>
        ${escapeHtml(p.color)}, mốc ${escapeHtml(p.tier)}${p.remaining === null ? '' : `, còn ${p.remaining} điểm`}
      </p>
    `).join('')}
  `;
  $('lastRound').innerHTML = html;
}

function renderLog() {
  $('logList').innerHTML = roomState.log.map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function setAvatar(el, name, image) {
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  if (image) {
    el.textContent = '';
    el.style.backgroundImage = `url("${image}")`;
  } else {
    el.textContent = initial;
    el.style.backgroundImage = '';
  }
}

function readImageFile(file, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(undefined);
    if (!file.type.startsWith('image/')) return reject(new Error('Chỉ được chọn file ảnh.'));
    if (file.size > maxBytes) return reject(new Error(`Ảnh quá nặng. Tối đa ${Math.round(maxBytes / 1024 / 1024)}MB.`));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không đọc được file ảnh.'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
