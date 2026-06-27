const socket = io();
const SESSION_KEY = 'den_trang_ii_session_token';

let roomState = null;
let privateState = null;
let mySeat = null;
let profile = null;
let pendingAvatar;
let pendingBackground;
let clearAvatar = false;
let clearBackground = false;
let adminLogsLoaded = false;
let adminUsersLoaded = false;
let adminUsersState = [];
let socialState = { friends: [], incoming: [], outgoing: [] };
let leaderboardState = [];
let activeInvites = [];

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
const adminUserError = $('adminUserError');

$('loginBtn').onclick = () => {
  authError.textContent = '';
  socket.emit('login', {
    username: $('loginUsername').value,
    password: $('loginPassword').value
  }, (res) => {
    if (!res.ok) return authError.textContent = res.error;
    handleAuthSuccess(res);
  });
};

$('registerBtn').onclick = () => {
  authError.textContent = '';
  socket.emit('registerAccount', {
    username: $('registerUsername').value,
    displayName: $('registerDisplayName').value,
    password: $('registerPassword').value,
    confirmPassword: $('registerConfirmPassword').value
  }, (res) => {
    if (!res.ok) return authError.textContent = res.error;
    handleAuthSuccess(res);
  });
};

$('guestBtn').onclick = () => {
  authError.textContent = '';
  localStorage.removeItem(SESSION_KEY);
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
    showGame();
  });
};

$('joinBtn').onclick = () => {
  joinError.textContent = '';
  socket.emit('joinRoom', { code: $('roomInput').value }, (res) => {
    if (!res.ok) return joinError.textContent = res.error;
    mySeat = res.seat;
    showGame();
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

$('refreshAdminUsersBtn').onclick = () => {
  loadAdminUsers(true);
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
    loadAdminUsers(false);
  });
};

$('refreshSocialBtn').onclick = () => loadSocialState(true);
$('searchFriendBtn').onclick = searchFriend;
$('friendSearchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchFriend();
});
$('refreshLeaderboardBtn').onclick = () => loadLeaderboard(true);

$('adminUserList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'view-history') viewPlayerHistory(id);
  if (btn.dataset.action === 'delete-account') deleteAccount(id, btn.dataset.username);
});

$('friendSearchResults').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const username = btn.dataset.username;
  if (btn.dataset.action === 'add-friend') sendFriendRequest(id, username);
  if (btn.dataset.action === 'accept-request') respondFriendRequest(id, true);
  if (btn.dataset.action === 'reject-request') respondFriendRequest(id, false);
});

$('incomingFriendList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'accept-request') respondFriendRequest(id, true);
  if (btn.dataset.action === 'reject-request') respondFriendRequest(id, false);
});

$('friendList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'invite-friend') inviteFriend(id);
  if (btn.dataset.action === 'remove-friend') removeFriend(id);
});

$('gameFriendList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'invite-friend') inviteFriend(btn.dataset.id);
});

function handleInviteListClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const code = btn.dataset.code;
  if (btn.dataset.action === 'accept-invite') joinInvitedRoom(code);
  if (btn.dataset.action === 'dismiss-invite') {
    activeInvites = activeInvites.filter(inv => inv.roomCode !== code);
    renderInvites();
  }
}
$('inviteList').addEventListener('click', handleInviteListClick);
$('dashboardInviteList').addEventListener('click', handleInviteListClick);

function searchFriend() {
  const q = $('friendSearchInput').value;
  $('socialError').textContent = '';
  socket.emit('searchUsers', { query: q }, (res) => {
    if (!res.ok) return $('socialError').textContent = res.error;
    renderFriendSearchResults(res.results || []);
  });
}

function sendFriendRequest(id, username) {
  $('socialError').textContent = '';
  $('socialSuccess').textContent = '';
  socket.emit('sendFriendRequest', { userId: id, username }, (res) => {
    if (!res.ok) return $('socialError').textContent = res.error;
    $('socialSuccess').textContent = res.message || 'Đã gửi lời mời.';
    searchFriend();
    loadSocialState(false);
  });
}

function respondFriendRequest(fromUserId, accept) {
  $('socialError').textContent = '';
  $('socialSuccess').textContent = '';
  socket.emit('respondFriendRequest', { fromUserId, accept }, (res) => {
    if (!res.ok) return $('socialError').textContent = res.error;
    $('socialSuccess').textContent = res.message || 'Đã cập nhật lời mời.';
    loadSocialState(false);
  });
}

function removeFriend(friendId) {
  if (!confirm('Xóa người này khỏi danh sách bạn bè?')) return;
  $('socialError').textContent = '';
  $('socialSuccess').textContent = '';
  socket.emit('removeFriend', { friendId }, (res) => {
    if (!res.ok) return $('socialError').textContent = res.error;
    $('socialSuccess').textContent = res.message || 'Đã xóa bạn bè.';
    loadSocialState(false);
  });
}

function inviteFriend(friendId) {
  $('socialError').textContent = '';
  $('gameInviteError').textContent = '';
  socket.emit('inviteFriend', { friendId }, (res) => {
    if (!res.ok) {
      $('socialError').textContent = res.error;
      $('gameInviteError').textContent = res.error;
      return;
    }
    $('socialSuccess').textContent = res.message || 'Đã gửi lời mời.';
    $('gameInviteError').textContent = res.message || 'Đã gửi lời mời.';
  });
}

function joinInvitedRoom(code) {
  if (!code) return;
  joinError.textContent = '';
  socket.emit('joinRoom', { code }, (res) => {
    if (!res.ok) return alert(res.error);
    mySeat = res.seat;
    activeInvites = activeInvites.filter(inv => inv.roomCode !== code);
    showGame();
  });
}

function loadSocialState(showMessage = false) {
  if (!profile || profile.type !== 'user') return;
  if (showMessage) $('socialError').textContent = 'Đang tải bạn bè...';
  socket.emit('getSocialState', {}, (res) => {
    if (!res.ok) {
      $('socialError').textContent = res.error;
      return;
    }
    $('socialError').textContent = '';
    socialState = res.social || { friends: [], incoming: [], outgoing: [] };
    renderSocial();
  });
}

function loadLeaderboard(showMessage = false) {
  if (showMessage) $('leaderboardStatus').textContent = 'Đang tải bảng xếp hạng...';
  socket.emit('getLeaderboard', {}, (res) => {
    if (!res.ok) {
      $('leaderboardStatus').textContent = res.error;
      return;
    }
    $('leaderboardStatus').textContent = '';
    leaderboardState = res.leaderboard || [];
    renderLeaderboard();
  });
}

function loadAdminUsers(showMessage = false) {
  if (!profile?.isAdmin) return;
  adminUserError.textContent = showMessage ? 'Đang tải danh sách tài khoản...' : '';
  socket.emit('getAdminUsers', {}, (res) => {
    if (!res.ok) {
      adminUserError.textContent = res.error;
      return;
    }
    adminUserError.textContent = '';
    adminUsersState = res.users || [];
    renderAdminUsers(adminUsersState);
  });
}

function loadAdminLogs(showMessage = false) {
  if (!profile?.isAdmin) return;
  adminLogError.textContent = showMessage ? 'Đang tải lịch sử đấu...' : '';
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

function renderAdminUsers(users) {
  const el = $('adminUserList');
  if (!el) return;
  if (!users.length) {
    el.innerHTML = '<li class="muted">Chưa có tài khoản.</li>';
    return;
  }

  el.innerHTML = users.map((u) => {
    const status = u.online ? '<span class="online-dot"></span>Online' : 'Offline';
    const ip = u.lastIp || 'Chưa có';
    const wld = u.stats ? `${u.stats.wins || 0}/${u.stats.losses || 0}/${u.stats.draws || 0}` : '0/0/0';
    const disableDelete = profile?.id === u.id ? 'disabled title="Không thể xóa chính mình"' : '';
    return `
      <li class="admin-user-row">
        ${renderUserMini({ ...u, online: !!u.online })}
        <div class="admin-user-meta">
          <span class="badge">${u.isAdmin ? 'Admin' : 'Người chơi'}</span>
          <span class="badge">${status}</span>
          <span class="badge">IP: ${escapeHtml(ip)}</span>
          <span class="badge">10 ván: ${escapeHtml(wld)}</span>
        </div>
        <div class="friend-actions">
          <button class="small-btn" data-action="view-history" data-id="${escapeHtml(u.id)}">Xem lịch sử</button>
          <button class="secondary small-btn danger-btn" data-action="delete-account" data-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}" ${disableDelete}>Xóa tài khoản</button>
        </div>
      </li>
    `;
  }).join('');
}

function deleteAccount(userId, username) {
  if (!userId) return;
  if (!confirm(`Xóa tài khoản @${username}? Hành động này không thể hoàn tác.`)) return;
  adminUserError.textContent = '';
  socket.emit('deleteAccount', { userId }, (res) => {
    if (!res.ok) {
      adminUserError.textContent = res.error;
      return;
    }
    adminUserError.textContent = '';
    adminSuccess.textContent = res.message || 'Đã xóa tài khoản.';
    loadAdminUsers(false);
    loadAdminLogs(false);
    $('adminHistoryTitle').textContent = 'Chọn một tài khoản để xem lịch sử';
    $('adminHistoryList').innerHTML = '';
  });
}

function viewPlayerHistory(userId) {
  if (!userId) return;
  $('adminHistoryTitle').textContent = 'Đang tải lịch sử...';
  $('adminHistoryList').innerHTML = '';
  socket.emit('getPlayerHistory', { userId, limit: 100 }, (res) => {
    if (!res.ok) {
      $('adminHistoryTitle').textContent = res.error;
      return;
    }
    renderPlayerHistory(res.user, res.history || []);
  });
}

function renderPlayerHistory(user, history) {
  const ip = user.lastIp || 'Chưa có';
  $('adminHistoryTitle').textContent = `${user.displayName} (@${user.username}) — IP gần nhất: ${ip}`;
  const el = $('adminHistoryList');
  if (!history.length) {
    el.innerHTML = '<li class="muted">Tài khoản này chưa có lịch sử đấu.</li>';
    return;
  }
  el.innerHTML = history.map((g) => {
    const label = resultLabel(g.result);
    const time = new Date(g.at).toLocaleString('vi-VN');
    return `
      <li class="admin-log-item">
        <div><b>${label}</b><span class="muted"> | ${escapeHtml(time)} | Phòng ${escapeHtml(g.roomCode || '')}</span></div>
        <div>Đối thủ: <span class="badge">${escapeHtml(g.opponent || 'Không rõ')}${g.opponentUsername ? ` @${escapeHtml(g.opponentUsername)}` : ''}</span></div>
        <div>Tỉ số của người chơi: <b>${escapeHtml(g.score || '')}</b></div>
      </li>
    `;
  }).join('');
}

function renderAdminLogs(logs) {
  const el = $('adminLogList');
  if (!logs.length) {
    el.innerHTML = '<li class="muted">Chưa có ván đấu nào.</li>';
    return;
  }

  el.innerHTML = logs.map((log) => {
    const time = new Date(log.at).toLocaleString('vi-VN');
    const players = (log.players || []).map(p => {
      const result = resultLabel(p.result);
      const ip = p.ip ? ` · IP ${escapeHtml(p.ip)}` : '';
      return `<div><span class="badge">${escapeHtml(p.name)}${p.username && p.username !== 'guest' ? ` @${escapeHtml(p.username)}` : p.type === 'guest' ? ' (Khách)' : ''}</span> ${result} · ${Number(p.wins || 0)} điểm thắng${ip}</div>`;
    }).join('');
    return `
      <li class="admin-log-item">
        <div><b>Phòng ${escapeHtml(log.roomCode || '')}</b><span class="muted"> | ${escapeHtml(time)}</span></div>
        <div>Kết quả: <b>${escapeHtml(log.finalScore || '')}</b> | Người thắng: <b>${escapeHtml(log.winnerName || 'Hòa')}</b></div>
        ${players}
      </li>
    `;
  }).join('');
}

function resultLabel(result) {
  if (result === 'win') return 'Thắng';
  if (result === 'loss') return 'Thua';
  return 'Hòa';
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
    register_account: 'Tự tạo tài khoản',
    resume_session: 'Tự đăng nhập lại',
    reconnect_room: 'Đăng nhập lại vào ván',
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
    friend_request: 'Gửi lời mời kết bạn',
    friend_accept: 'Đồng ý kết bạn',
    friend_reject: 'Từ chối kết bạn',
    friend_remove: 'Xóa bạn bè',
    invite_friend: 'Mời bạn vào phòng',
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

socket.on('adminBattleLogsState', (state) => {
  if (!profile?.isAdmin) return;
  renderAdminLogs(state?.logs || []);
});

socket.on('adminUsersState', (state) => {
  if (!profile?.isAdmin) return;
  adminUsersState = state?.users || [];
  renderAdminUsers(adminUsersState);
});

socket.on('socialState', (state) => {
  socialState = state || { friends: [], incoming: [], outgoing: [] };
  renderSocial();
  renderGameFriends();
});

socket.on('leaderboardState', (state) => {
  leaderboardState = state?.leaderboard || [];
  renderLeaderboard();
});

socket.on('roomInvite', (invite) => {
  if (!invite || !invite.roomCode) return;
  activeInvites = activeInvites.filter(i => i.roomCode !== invite.roomCode);
  activeInvites.unshift(invite);
  activeInvites = activeInvites.slice(0, 5);
  renderInvites();
  if (!gameBox.classList.contains('hidden')) renderGameFriends();
});

socket.on('accountDeleted', (data) => {
  localStorage.removeItem(SESSION_KEY);
  alert(data?.message || 'Tài khoản của bạn đã bị admin xóa.');
  location.reload();
});

socket.on('kickedByReconnect', (data) => {
  roomState = null;
  privateState = null;
  mySeat = null;
  alert(data?.message || 'Tài khoản này đã đăng nhập ở thiết bị khác.');
  showDashboard();
});

socket.on('connect', () => {
  const token = localStorage.getItem(SESSION_KEY);
  if (token) autoResumeSession(token);
});

function handleAuthSuccess(res) {
  profile = res.profile;
  if (res.sessionToken) localStorage.setItem(SESSION_KEY, res.sessionToken);
  renderProfile();
  loadLeaderboard(false);
  if (profile?.type === 'user') loadSocialState(false);
  if (res.rejoined) {
    mySeat = res.rejoined.seat;
    showGame();
  } else {
    showDashboard();
  }
}

function autoResumeSession(token) {
  if (!token || profile?.type === 'guest') return;
  socket.emit('resumeSession', { token }, (res) => {
    if (!res.ok) {
      localStorage.removeItem(SESSION_KEY);
      if (!profile) authError.textContent = '';
      return;
    }
    handleAuthSuccess(res);
  });
}

function showDashboard() {
  authBox.classList.add('hidden');
  dashboardBox.classList.remove('hidden');
  gameBox.classList.add('hidden');
  renderSocial();
  renderLeaderboard();
  renderInvites();
}

function showGame() {
  authBox.classList.add('hidden');
  dashboardBox.classList.add('hidden');
  gameBox.classList.remove('hidden');
  renderGameFriends();
  renderInvites();
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
  $('socialPanel').classList.toggle('hidden', !isUser);

  renderSocial();
  renderLeaderboard();
  renderInvites();

  if (profile.isAdmin && !adminLogsLoaded) {
    adminLogsLoaded = true;
    loadAdminLogs(false);
  }
  if (profile.isAdmin && !adminUsersLoaded) {
    adminUsersLoaded = true;
    loadAdminUsers(false);
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
  renderGameFriends();
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

function renderUserMini(user) {
  const status = user.online ? '<span class="online-dot"></span>Online' : 'Offline';
  return `
    <div class="mini-user">
      <div class="avatar small-avatar" style="${user.avatar ? `background-image:url('${user.avatar.replaceAll("'", "%27")}')` : ''}">${user.avatar ? '' : escapeHtml(String(user.displayName || '?').charAt(0).toUpperCase())}</div>
      <div class="mini-user-info">
        <b>${escapeHtml(user.displayName)}</b>
        <span class="muted">@${escapeHtml(user.username)} · ${status} · chuỗi ${Number(user.currentWinStreak || 0)}</span>
      </div>
    </div>
  `;
}

function renderFriendSearchResults(results) {
  const el = $('friendSearchResults');
  if (!results.length) {
    el.innerHTML = '<li class="muted">Không có kết quả.</li>';
    return;
  }
  el.innerHTML = results.map((u) => {
    let action = '';
    if (u.relation === 'friend') action = '<span class="badge">Đã là bạn</span>';
    else if (u.relation === 'incoming') action = `<button class="small-btn" data-action="accept-request" data-id="${escapeHtml(u.id)}">Đồng ý</button><button class="secondary small-btn" data-action="reject-request" data-id="${escapeHtml(u.id)}">Từ chối</button>`;
    else if (u.relation === 'outgoing') action = '<span class="badge">Đã gửi lời mời</span>';
    else action = `<button class="small-btn" data-action="add-friend" data-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}">Kết bạn</button>`;
    return `<li class="friend-row">${renderUserMini(u)}<div class="friend-actions">${action}</div></li>`;
  }).join('');
}

function renderSocial() {
  if (!$('socialPanel')) return;
  if (!profile || profile.type !== 'user') {
    $('socialPanel').classList.add('hidden');
    return;
  }
  $('socialPanel').classList.remove('hidden');
  const friends = socialState.friends || [];
  const incoming = socialState.incoming || [];
  const outgoing = socialState.outgoing || [];

  $('friendList').innerHTML = friends.length ? friends.map((f) => {
    const canInvite = f.online && roomState && !roomState.started && !roomState.finished;
    return `<li class="friend-row">${renderUserMini(f)}<div class="friend-actions">${canInvite ? `<button class="small-btn" data-action="invite-friend" data-id="${escapeHtml(f.id)}">Mời vào phòng</button>` : ''}<button class="secondary small-btn" data-action="remove-friend" data-id="${escapeHtml(f.id)}">Xóa</button></div></li>`;
  }).join('') : '<li class="muted">Chưa có bạn bè.</li>';

  $('incomingFriendList').innerHTML = incoming.length ? incoming.map((u) => `<li class="friend-row">${renderUserMini(u)}<div class="friend-actions"><button class="small-btn" data-action="accept-request" data-id="${escapeHtml(u.id)}">Đồng ý</button><button class="secondary small-btn" data-action="reject-request" data-id="${escapeHtml(u.id)}">Từ chối</button></div></li>`).join('') : '<li class="muted">Không có lời mời mới.</li>';

  $('outgoingFriendList').innerHTML = outgoing.length ? outgoing.map((u) => `<li class="friend-row">${renderUserMini(u)}<span class="badge">Đang chờ</span></li>`).join('') : '<li class="muted">Không có lời mời đang chờ.</li>';

  renderGameFriends();
}

function renderGameFriends() {
  if (!$('gameSocialPanel')) return;
  const isUser = profile?.type === 'user';
  $('gameSocialPanel').classList.toggle('hidden', !isUser);
  if (!isUser) return;
  const friends = (socialState.friends || []).filter(f => f.online);
  $('gameFriendList').innerHTML = friends.length ? friends.map((f) => {
    const canInvite = roomState && !roomState.started && !roomState.finished;
    return `<li class="friend-row">${renderUserMini(f)}<div class="friend-actions">${canInvite ? `<button class="small-btn" data-action="invite-friend" data-id="${escapeHtml(f.id)}">Mời</button>` : '<span class="muted small">Không thể mời khi ván đã bắt đầu</span>'}</div></li>`;
  }).join('') : '<li class="muted">Không có bạn bè online.</li>';
  renderInvites();
}

function renderInvites() {
  if (!$('inviteList')) return;
  const html = activeInvites.length ? activeInvites.map((inv) => `
    <li class="invite-item">
      <div><b>${escapeHtml(inv.fromName)}</b> mời bạn vào phòng <span class="badge">${escapeHtml(inv.roomCode)}</span></div>
      <div class="friend-actions">
        <button class="small-btn" data-action="accept-invite" data-code="${escapeHtml(inv.roomCode)}">Nhận lời</button>
        <button class="secondary small-btn" data-action="dismiss-invite" data-code="${escapeHtml(inv.roomCode)}">Bỏ qua</button>
      </div>
    </li>
  `).join('') : '<li class="muted">Chưa có lời mời vào phòng.</li>';
  $('inviteList').innerHTML = html;
  if ($('dashboardInviteList')) $('dashboardInviteList').innerHTML = html;
}

function renderLeaderboard() {
  const el = $('leaderboardList');
  if (!el) return;
  if (!leaderboardState.length) {
    el.innerHTML = '<li class="muted">Chưa có tài khoản nào.</li>';
    return;
  }
  el.innerHTML = leaderboardState.map((u, idx) => `
    <li class="leaderboard-row">
      <span class="rank">#${idx + 1}</span>
      ${renderUserMini(u)}
      <div class="streak-box"><b>${Number(u.currentWinStreak || 0)}</b><span>chuỗi hiện tại</span></div>
      <div class="streak-box"><b>${Number(u.bestWinStreak || 0)}</b><span>cao nhất</span></div>
    </li>
  `).join('');
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
