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
let adminFraudAlertsState = [];
let socialState = { friends: [], incoming: [], outgoing: [] };
let leaderboardState = [];
let leaderboardMeta = { visible: true, publicEnabled: true, privileged: false, message: '' };
let adminSettingsLoaded = false;
let adminSettingsState = { leaderboardPublic: true, matchLogPublic: true };
let activeInvites = [];
let finalSummaryState = null;

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
const backupError = $('backupError');
const backupSuccess = $('backupSuccess');
const adminAnnouncementError = $('adminAnnouncementError');
const adminAnnouncementSuccess = $('adminAnnouncementSuccess');

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

$('leaveRoomBtn').onclick = () => {
  if (!roomState) return;
  const msg = roomState.started
    ? 'Ván đang diễn ra. Rời phòng sẽ đóng phòng cho cả hai người chơi. Bạn chắc chắn muốn rời?'
    : 'Rời phòng này? Phòng sẽ đóng và nếu muốn chơi tiếp cần tạo phòng mới.';
  if (!confirm(msg)) return;
  socket.emit('leaveRoom', (res) => {
    if (!res.ok) return alert(res.error);
    roomState = null;
    privateState = null;
    mySeat = null;
    showDashboard();
  });
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

$('saveAdminSettingsBtn').onclick = () => {
  saveAdminSettings();
};

$('downloadBackupBtn').onclick = () => {
  downloadAccountsBackup();
};

$('restoreBackupBtn').onclick = () => {
  restoreAccountsBackup();
};

$('adminAnnouncementInput').addEventListener('input', () => {
  $('adminAnnouncementCounter').textContent = `${$('adminAnnouncementInput').value.length}/240`;
});

$('adminAnnouncementInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendAdminAnnouncement();
});

$('sendAdminAnnouncementBtn').onclick = () => {
  sendAdminAnnouncement();
};

$('createAccountBtn').onclick = () => {
  adminError.textContent = '';
  adminSuccess.textContent = '';
  socket.emit('createAccount', {
    username: $('newUsername').value,
    displayName: $('newDisplayName').value,
    password: $('newPassword').value,
    isAdmin: $('newIsAdmin').checked,
    isVip: $('newIsVip').checked
  }, (res) => {
    if (!res.ok) return adminError.textContent = res.error;
    adminSuccess.textContent = res.message || 'Đã tạo tài khoản.';
    $('newUsername').value = '';
    $('newDisplayName').value = '';
    $('newPassword').value = '';
    $('newIsAdmin').checked = false;
    $('newIsVip').checked = false;
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
  if (btn.dataset.action === 'toggle-vip') toggleVip(id, btn.dataset.value === 'true');
  if (btn.dataset.action === 'set-streak') setWinStreak(id, btn.dataset.name, btn.dataset.current);
  if (btn.dataset.action === 'delete-account') deleteAccount(id, btn.dataset.username);
  if (btn.dataset.action === 'unlock-account') unlockAccount(id, btn.dataset.username);
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
    leaderboardMeta = {
      visible: res.visible !== false,
      publicEnabled: res.publicEnabled !== false,
      privileged: !!res.privileged,
      message: res.message || ''
    };
    $('leaderboardStatus').textContent = leaderboardMeta.message || '';
    leaderboardState = res.leaderboard || [];
    renderLeaderboard();
  });
}

function loadAdminSettings(showMessage = false) {
  if (!profile?.isAdmin) return;
  const status = $('adminSettingsStatus');
  if (showMessage && status) status.textContent = 'Đang tải cài đặt...';
  socket.emit('getAdminSettings', {}, (res) => {
    if (!res.ok) {
      if (status) status.textContent = res.error;
      return;
    }
    adminSettingsState = res.settings || adminSettingsState;
    renderAdminSettings();
    if (status) status.textContent = '';
  });
}

function saveAdminSettings() {
  if (!profile?.isAdmin) return;
  const status = $('adminSettingsStatus');
  if (status) status.textContent = 'Đang lưu...';
  socket.emit('updateAdminSettings', {
    leaderboardPublic: $('adminLeaderboardPublic').checked,
    matchLogPublic: $('adminMatchLogPublic').checked
  }, (res) => {
    if (!res.ok) {
      if (status) status.textContent = res.error;
      return;
    }
    adminSettingsState = res.settings || adminSettingsState;
    renderAdminSettings();
    loadLeaderboard(false);
    if (status) status.textContent = res.message || 'Đã lưu cài đặt.';
  });
}


function sendAdminAnnouncement() {
  if (!profile?.isAdmin) return;
  adminAnnouncementError.textContent = '';
  adminAnnouncementSuccess.textContent = '';
  const message = $('adminAnnouncementInput').value.trim();
  if (!message) {
    adminAnnouncementError.textContent = 'Nhập nội dung thông báo trước đã.';
    return;
  }
  socket.emit('adminAnnouncement', { message }, (res) => {
    if (!res.ok) return adminAnnouncementError.textContent = res.error;
    adminAnnouncementSuccess.textContent = res.message || 'Đã gửi thông báo tới toàn bộ người chơi.';
    $('adminAnnouncementInput').value = '';
    $('adminAnnouncementCounter').textContent = '0/240';
  });
}

function renderAdminSettings() {
  if (!$('adminLeaderboardPublic')) return;
  $('adminLeaderboardPublic').checked = adminSettingsState.leaderboardPublic !== false;
  $('adminMatchLogPublic').checked = adminSettingsState.matchLogPublic !== false;
}


function downloadAccountsBackup() {
  if (!profile?.isAdmin) return;
  backupError.textContent = '';
  backupSuccess.textContent = 'Đang tạo file backup...';
  socket.emit('downloadAccountsBackup', {}, (res) => {
    if (!res.ok) {
      backupSuccess.textContent = '';
      backupError.textContent = res.error;
      return;
    }
    const text = JSON.stringify(res.backup || {}, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename || `accounts-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupSuccess.textContent = 'Đã tải file backup tài khoản.';
  });
}

function restoreAccountsBackup() {
  if (!profile?.isAdmin) return;
  backupError.textContent = '';
  backupSuccess.textContent = '';
  const file = $('restoreBackupFile').files[0];
  if (!file) {
    backupError.textContent = 'Chọn file backup .json trước.';
    return;
  }
  if (!confirm('Khôi phục backup sẽ thay thế dữ liệu tài khoản hiện tại và đóng toàn bộ phòng đang mở. Bạn chắc chắn muốn tiếp tục?')) return;
  if (file.size > 25 * 1024 * 1024) {
    backupError.textContent = 'File backup quá nặng. Tối đa 25MB.';
    return;
  }

  backupSuccess.textContent = 'Đang đọc file backup...';
  const reader = new FileReader();
  reader.onload = () => {
    backupSuccess.textContent = 'Đang khôi phục dữ liệu...';
    socket.emit('restoreAccountsBackup', { backupText: String(reader.result || '') }, (res) => {
      if (!res.ok) {
        backupSuccess.textContent = '';
        backupError.textContent = res.error;
        return;
      }
      if (res.sessionToken) localStorage.setItem(SESSION_KEY, res.sessionToken);
      if (res.profile) profile = res.profile;
      $('restoreBackupFile').value = '';
      backupSuccess.textContent = res.message || 'Đã khôi phục backup.';
      renderProfile();
      loadAdminUsers(false);
      loadAdminLogs(false);
      loadLeaderboard(false);
    });
  };
  reader.onerror = () => {
    backupSuccess.textContent = '';
    backupError.textContent = 'Không đọc được file backup.';
  };
  reader.readAsText(file);
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
    adminFraudAlertsState = res.alerts || adminFraudAlertsState || [];
    renderAdminUsers(adminUsersState);
    renderAdminAlerts(adminFraudAlertsState);
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
    const lockIp = u.lockedIp || u.lastIp || '';
    const wld = u.stats ? `${u.stats.wins || 0}/${u.stats.losses || 0}/${u.stats.draws || 0}` : '0/0/0';
    const disableDelete = profile?.id === u.id ? 'disabled title="Không thể xóa chính mình"' : '';
    const vipActionText = u.isVip ? 'Gỡ VIP' : 'Cấp VIP';
    const nextVipValue = u.isVip ? 'false' : 'true';
    const lockedMeta = u.isLocked
      ? `<span class="badge locked-badge">🔒 Đang khóa</span><span class="badge">Lý do: ${escapeHtml(u.lockReason || 'Nghi ngờ gian lận')}</span><span class="badge">IP khóa: ${escapeHtml(lockIp || 'Không rõ')}</span>`
      : '';
    const unlockBtn = u.isLocked
      ? `<button class="secondary small-btn unlock-btn" data-action="unlock-account" data-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}">Mở khóa</button>`
      : '';
    return `
      <li class="admin-user-row ${u.isAdmin ? 'admin-user-special' : ''} ${u.isVip ? 'vip-user-special' : ''} ${u.isLocked ? 'locked-user-row' : ''}">
        ${renderUserMini({ ...u, online: !!u.online })}
        <div class="admin-user-meta">
          ${renderRoleBadges(u)}
          <span class="badge">${status}</span>
          <span class="badge">IP: ${escapeHtml(ip)}</span>
          <span class="badge">10 ván: ${escapeHtml(wld)}</span>
          <span class="badge">Chuỗi: ${Number(u.currentWinStreak || 0)}</span>
          <span class="badge">Cao nhất: ${Number(u.bestWinStreak || 0)}</span>
          ${lockedMeta}
        </div>
        <div class="friend-actions">
          <button class="small-btn" data-action="view-history" data-id="${escapeHtml(u.id)}">Xem lịch sử</button>
          <button class="secondary small-btn" data-action="set-streak" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.displayName)}" data-current="${Number(u.currentWinStreak || 0)}">Sửa chuỗi</button>
          <button class="secondary small-btn" data-action="toggle-vip" data-id="${escapeHtml(u.id)}" data-value="${nextVipValue}">${vipActionText}</button>
          ${unlockBtn}
          <button class="secondary small-btn danger-btn" data-action="delete-account" data-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}" ${disableDelete}>Xóa tài khoản</button>
        </div>
      </li>
    `;
  }).join('');
}



function renderAdminAlerts(alerts) {
  const el = $('adminFraudAlertList');
  if (!el) return;
  alerts = Array.isArray(alerts) ? alerts : [];
  if (!alerts.length) {
    el.innerHTML = '<li class="muted">Chưa có cảnh báo IP trùng.</li>';
    return;
  }

  el.innerHTML = alerts.map((a) => {
    const time = new Date(a.at || a.updatedAt || Date.now()).toLocaleString('vi-VN');
    const status = a.resolvedAt ? `Đã xử lý bởi ${escapeHtml(a.resolvedBy || 'admin')}` : 'Đang mở';
    const users = (a.users || []).map((u) => {
      const lock = u.isLocked ? ' 🔒' : '';
      const role = u.isAdmin ? ' ADMIN' : u.isVip ? ' VIP' : '';
      return `${escapeHtml(u.displayName || u.username)} (@${escapeHtml(u.username)})${role}${lock}`;
    }).join('<br>');
    return `
      <li class="admin-log-item fraud-alert-item ${a.resolvedAt ? 'resolved-alert' : 'open-alert'}">
        <div><b>⚠️ IP trùng: ${escapeHtml(a.ip || 'Không rõ')}</b> <span class="badge">${escapeHtml(status)}</span></div>
        <div class="muted small">${escapeHtml(time)} | Tổng tài khoản: ${Number(a.totalAccounts || 0)} | Đã khóa: ${Number(a.lockedCount || 0)}</div>
        <div class="small">${escapeHtml(a.message || '')}</div>
        <div class="muted small">${users || 'Không có danh sách tài khoản'}</div>
      </li>
    `;
  }).join('');
}

function setWinStreak(userId, name, current) {
  if (!userId) return;
  const value = prompt(`Nhập chuỗi thắng mới cho ${name || 'tài khoản này'}:`, String(current || 0));
  if (value === null) return;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 999) {
    adminUserError.textContent = 'Chuỗi thắng phải là số nguyên từ 0 đến 999.';
    return;
  }
  adminUserError.textContent = '';
  adminSuccess.textContent = '';
  socket.emit('adminSetWinStreak', { userId, currentWinStreak: number }, (res) => {
    if (!res.ok) {
      adminUserError.textContent = res.error;
      return;
    }
    adminSuccess.textContent = res.message || 'Đã chỉnh chuỗi thắng.';
    loadAdminUsers(false);
    loadLeaderboard(false);
  });
}

function toggleVip(userId, nextValue) {
  if (!userId) return;
  const action = nextValue ? 'cấp VIP cho' : 'gỡ VIP của';
  if (!confirm(`Bạn chắc chắn muốn ${action} tài khoản này?`)) return;
  adminUserError.textContent = '';
  socket.emit('toggleVip', { userId, isVip: nextValue }, (res) => {
    if (!res.ok) {
      adminUserError.textContent = res.error;
      return;
    }
    adminSuccess.textContent = res.message || 'Đã cập nhật VIP.';
    loadAdminUsers(false);
    loadLeaderboard(false);
  });
}

function unlockAccount(userId, username) {
  if (!userId) return;
  if (!confirm(`Mở khóa tài khoản @${username}?`)) return;
  adminUserError.textContent = '';
  adminSuccess.textContent = '';
  socket.emit('unlockAccount', { userId }, (res) => {
    if (!res.ok) {
      adminUserError.textContent = res.error;
      return;
    }
    adminSuccess.textContent = res.message || 'Đã mở khóa tài khoản.';
    loadAdminUsers(false);
  });
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
      return `<div><span class="badge">${renderRoleBadges(p)} ${escapeHtml(p.name)}${p.username && p.username !== 'guest' ? ` @${escapeHtml(p.username)}` : p.type === 'guest' ? ' (Khách)' : ''}</span> ${result} · ${Number(p.wins || 0)} điểm thắng${ip}</div>`;
    }).join('');
    const rounds = (log.rounds || []).map(r => {
      const ps = (r.players || []).map(p => `${escapeHtml(p.name || '')}: ${Number(p.bid || 0)} điểm`).join(' | ');
      return `<div class="muted small">Vòng ${Number(r.round || 0)}: ${ps}</div>`;
    }).join('');
    return `
      <li class="admin-log-item">
        <div><b>Phòng ${escapeHtml(log.roomCode || '')}</b><span class="muted"> | ${escapeHtml(time)}</span></div>
        <div>Kết quả: <b>${escapeHtml(log.finalScore || '')}</b> | Người thắng: <b>${escapeHtml(log.winnerName || 'Hòa')}</b></div>
        ${players}
        ${rounds}
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
    disconnect: 'Thoát game',
    update_admin_settings: 'Cập nhật cài đặt hiển thị',
    admin_set_win_streak: 'Admin chỉnh chuỗi thắng'
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
  adminFraudAlertsState = state?.alerts || adminFraudAlertsState || [];
  renderAdminUsers(adminUsersState);
  renderAdminAlerts(adminFraudAlertsState);
});

socket.on('adminFraudAlertsState', (state) => {
  if (!profile?.isAdmin) return;
  adminFraudAlertsState = state?.alerts || [];
  renderAdminAlerts(adminFraudAlertsState);
});

socket.on('adminFraudAlert', (alertData) => {
  if (!profile?.isAdmin || !alertData) return;
  adminFraudAlertsState = [alertData, ...adminFraudAlertsState.filter(a => a.id !== alertData.id)].slice(0, 50);
  renderAdminAlerts(adminFraudAlertsState);
  alert(alertData.message || 'Có cảnh báo IP trùng.');
});

socket.on('socialState', (state) => {
  socialState = state || { friends: [], incoming: [], outgoing: [] };
  renderSocial();
  renderGameFriends();
});

socket.on('leaderboardState', (state) => {
  leaderboardMeta = {
    visible: state?.visible !== false,
    publicEnabled: state?.publicEnabled !== false,
    privileged: !!state?.privileged,
    message: state?.message || ''
  };
  leaderboardState = state?.leaderboard || [];
  renderLeaderboard();
});

socket.on('adminSettingsState', (state) => {
  if (!profile?.isAdmin) return;
  adminSettingsState = state?.settings || adminSettingsState;
  renderAdminSettings();
});


socket.on('roomEffect', (effect) => {
  showRoomEffect(effect);
});


socket.on('adminAnnouncement', (data) => {
  showAdminAnnouncement(data);
});

socket.on('playerMoveNotice', (data) => {
  showPlayerMoveNotice(data);
});

socket.on('roomInvite', (invite) => {
  if (!invite || !invite.roomCode) return;
  activeInvites = activeInvites.filter(i => i.roomCode !== invite.roomCode);
  activeInvites.unshift(invite);
  activeInvites = activeInvites.slice(0, 5);
  renderInvites();
  if (!gameBox.classList.contains('hidden')) renderGameFriends();
});

socket.on('gameEnded', (data) => {
  finalSummaryState = data?.summary || null;
  roomState = null;
  privateState = null;
  mySeat = null;
  loadLeaderboard(false);
  showDashboard();
  renderFinalSummary();
});

socket.on('roomClosed', (data) => {
  roomState = null;
  privateState = null;
  mySeat = null;
  showDashboard();
  if (data?.message) alert(data.message);
});

socket.on('accountDeleted', (data) => {
  localStorage.removeItem(SESSION_KEY);
  alert(data?.message || 'Tài khoản của bạn đã bị admin xóa.');
  location.reload();
});

socket.on('accountLocked', (data) => {
  localStorage.removeItem(SESSION_KEY);
  alert(data?.message || 'Tài khoản của bạn đã bị khóa tạm thời.');
  location.reload();
});

socket.on('accountsRestored', (data) => {
  alert(data?.message || 'Admin vừa khôi phục dữ liệu tài khoản. Trang sẽ tải lại.');
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
  renderFinalSummary();
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
  $('profileMeta').innerHTML = isUser
    ? `${escapeHtml(profile.username)} ${renderRoleBadges(profile)}`
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
  $('socialPanel').classList.add('hidden');

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
  if (profile.isAdmin && !adminSettingsLoaded) {
    adminSettingsLoaded = true;
    loadAdminSettings(false);
  }
}

function renderGame() {
  if (!roomState) return;

  const hasAdmin = roomState.players.some(p => p?.isAdmin);
  const hasVip = roomState.players.some(p => p?.isVip);
  gameBox.classList.toggle('room-has-admin', hasAdmin);
  gameBox.classList.toggle('room-has-vip', hasVip);

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
  card.classList.toggle('player-admin', !!p.isAdmin);
  card.classList.toggle('player-vip', !!p.isVip && !p.isAdmin);
  setAvatar($(`p${seat}Avatar`), p.name || `P${seat + 1}`, p.avatar);
  const medal = p.badge?.icon ? `<span class="rank-badge" title="${escapeHtml(p.badge.label || '')}">${p.badge.icon}</span>` : '';
  const roleBadges = renderRoleBadges(p);
  $(`p${seat}Name`).innerHTML = p.name
    ? `${medal} ${roleBadges} ${escapeHtml(p.name)}${p.isGuest ? ' <span class="muted">(Khách)</span>' : ''}${mySeat === seat ? ' <span class="muted">(Bạn)</span>' : ''}`
    : `Đang chờ người chơi ${seat + 1}`;
  $(`p${seat}Remain`).textContent = p.name ? (p.remaining === null ? 'Ẩn' : p.remaining) : '-';
  $(`p${seat}Tier`).textContent = p.tier || '-';
  $(`p${seat}Wins`).textContent = p.wins || 0;
  [`p${seat}Remain`, `p${seat}Tier`, `p${seat}Wins`].forEach((id) => {
    const el = $(id);
    el.classList.toggle('admin-score-glow', !!p.isAdmin);
    el.classList.toggle('vip-score-glow', !!p.isVip && !p.isAdmin);
  });
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
    return;
  }

  const firstName = roomState.players[roomState.firstSeat].name;
  const secondSeat = roomState.firstSeat === 0 ? 1 : 0;
  const secondName = roomState.players[secondSeat].name;

  $('statusTitle').textContent = `Vòng ${roomState.round}/${roomState.maxRounds} · Đạt ${roomState.targetWins || 5} điểm thắng vòng là thắng`;
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
    <div class="mini-user ${user.isAdmin ? 'mini-admin' : ''} ${user.isVip ? 'mini-vip' : ''}">
      <div class="avatar small-avatar" style="${user.avatar ? `background-image:url('${user.avatar.replaceAll("'", "%27")}')` : ''}">${user.avatar ? '' : escapeHtml(String(user.displayName || '?').charAt(0).toUpperCase())}</div>
      <div class="mini-user-info">
        <b>${renderRoleBadges(user)} ${escapeHtml(user.displayName)}</b>
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
  if ($('socialPanel')) $('socialPanel').classList.add('hidden');
}

function renderGameFriends() {
  if ($('gameSocialPanel')) $('gameSocialPanel').classList.add('hidden');
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
  if (!leaderboardMeta.visible) {
    $('leaderboardStatus').textContent = leaderboardMeta.message || 'Bảng xếp hạng đang được admin tắt.';
    el.innerHTML = '<li class="muted">Bảng xếp hạng đang được admin tắt. Chỉ VIP/Admin mới xem được.</li>';
    return;
  }
  $('leaderboardStatus').textContent = leaderboardMeta.publicEnabled ? '' : 'Bảng xếp hạng đang tắt với người thường. Bạn xem được vì là VIP/Admin.';
  if (!leaderboardState.length) {
    el.innerHTML = '<li class="muted">Chưa ai có chuỗi thắng từ 3 trở lên.</li>';
    return;
  }
  el.innerHTML = leaderboardState.map((u, idx) => `
    <li class="leaderboard-row">
      <span class="rank">${u.badge?.icon || `#${idx + 1}`}</span>
      ${renderUserMini(u)}
      <div class="streak-box"><b>${Number(u.currentWinStreak || 0)}</b><span>chuỗi hiện tại</span></div>
      <div class="streak-box"><b>${Number(u.bestWinStreak || 0)}</b><span>cao nhất</span></div>
    </li>
  `).join('');
}

function renderFinalSummary() {
  const card = $('finalSummaryCard');
  if (!card) return;
  if (!finalSummaryState) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  const s = finalSummaryState;
  const time = s.at ? new Date(s.at).toLocaleString('vi-VN') : '';
  $('finalSummaryTitle').textContent = s.winnerSeat === null
    ? `Kết quả phòng ${s.roomCode || ''} — Hòa`
    : `Kết quả phòng ${s.roomCode || ''} — ${s.winnerName || ''} thắng`;
  $('finalSummaryMeta').textContent = `Tỉ số ${s.finalScore || ''}${time ? ` | ${time}` : ''}. Hai người chơi đã được đưa ra khỏi phòng, muốn chơi tiếp hãy tạo phòng mới.`;

  if (s.matchLogVisible === false) {
    $('finalRoundList').innerHTML = `<li class="admin-log-item muted">${escapeHtml(s.matchLogMessage || 'Log sau trận đấu đang được admin tắt.')}</li>`;
    return;
  }

  const rounds = Array.isArray(s.rounds) ? s.rounds : [];
  $('finalRoundList').innerHTML = rounds.length ? rounds.map((r) => {
    const players = (r.players || []).map((p) => `
      <div>
        <span class="badge">${renderRoleBadges(p)} ${escapeHtml(p.name || 'Không rõ')}</span>
        bỏ <b>${Number(p.bid || 0)}</b> điểm · ${escapeHtml(p.color || '')} · còn ${Number(p.remaining || 0)} điểm · mốc ${escapeHtml(p.tier || '')}
      </div>
    `).join('');
    return `
      <li class="admin-log-item">
        <div><b>Vòng ${Number(r.round || 0)}</b> — ${escapeHtml(r.resultText || '')} <span class="muted">| Tỉ số sau vòng: ${escapeHtml(r.scoreAfterRound || '')}</span></div>
        ${players}
      </li>
    `;
  }).join('') : '<li class="muted">Không có dữ liệu từng vòng.</li>';
}


function renderRoleBadges(user) {
  const badges = [];
  if (user?.isAdmin) badges.push('<span class="role-badge role-admin">🛡️ ADMIN</span>');
  if (user?.isVip) badges.push('<span class="role-badge role-vip">💎 VIP</span>');
  return badges.join(' ');
}


function showAdminAnnouncement(data = {}) {
  const layer = $('announcementLayer');
  if (!layer) return;
  const box = document.createElement('div');
  box.className = 'admin-announcement-toast';
  const sender = data.senderName || 'Admin';
  const message = data.message || '';
  const time = data.at ? new Date(data.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
  box.innerHTML = `
    <button class="admin-announcement-close" type="button" aria-label="Tắt thông báo">×</button>
    <div class="admin-announcement-title">🛡️ Admin ${escapeHtml(sender)} thông báo</div>
    <div class="admin-announcement-message">${escapeHtml(message)}</div>
    ${time ? `<div class="admin-announcement-time">${escapeHtml(time)}</div>` : ''}
  `;
  layer.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    box.classList.remove('show');
    setTimeout(() => box.remove(), 450);
  };
  const closeBtn = box.querySelector('.admin-announcement-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
    });
  }
  box.addEventListener('click', close);
  setTimeout(close, 8500);
}


function showPlayerMoveNotice(data = {}) {
  const layer = $('announcementLayer');
  if (!layer || !data) return;
  const box = document.createElement('div');
  const color = String(data.color || '').toUpperCase();
  const isWhite = color === 'TRẮNG';
  const playerText = data.playerLabel || (Number.isInteger(data.seat) ? `Người chơi ${data.seat + 1}` : 'Người chơi');
  const name = data.playerName ? ` (${data.playerName})` : '';
  const tierText = data.tier || data.remainingTier || '-';
  box.className = `move-notice-toast ${isWhite ? 'move-white' : 'move-black'}`;
  box.innerHTML = `
    <button class="move-notice-close" type="button" aria-label="Tắt thông báo">×</button>
    <div class="move-notice-title">Vòng ${Number(data.round || roomState?.round || 0)}</div>
    <div class="move-notice-main"><b>${escapeHtml(playerText)}</b>${escapeHtml(name)} đã đi <b>${escapeHtml(color || '-')}</b> · mốc <b>${escapeHtml(tierText)}</b></div>
  `;
  layer.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    box.classList.remove('show');
    setTimeout(() => box.remove(), 350);
  };
  const closeBtn = box.querySelector('.move-notice-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
    });
  }
  box.addEventListener('click', close);
  setTimeout(close, 5200);
}

function showRoomEffect(effect) {
  if (!effect || !$('effectLayer')) return;
  const layer = $('effectLayer');
  const div = document.createElement('div');
  div.className = `room-effect-pop ${effect.type === 'admin' ? 'admin-pop' : 'vip-pop'}`;
  div.innerHTML = `
    <div class="effect-burst"></div>
    <div class="effect-icons">${escapeHtml(effect.icons || '')}</div>
    <div class="effect-title">${escapeHtml(effect.labels || '')}</div>
    <div class="effect-message">${escapeHtml(effect.message || '')}</div>
  `;
  layer.appendChild(div);
  document.body.classList.add(effect.type === 'admin' ? 'admin-entry-flash' : 'vip-entry-flash');
  setTimeout(() => div.remove(), 3200);
  setTimeout(() => {
    document.body.classList.remove('admin-entry-flash');
    document.body.classList.remove('vip-entry-flash');
  }, 1800);
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
