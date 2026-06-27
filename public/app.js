const socket = io();

let roomState = null;
let privateState = null;
let mySeat = null;

const $ = (id) => document.getElementById(id);

const joinBox = $('joinBox');
const gameBox = $('gameBox');
const joinError = $('joinError');
const bidError = $('bidError');

$('createBtn').onclick = () => {
  joinError.textContent = '';
  socket.emit('createRoom', { name: $('nameInput').value }, (res) => {
    if (!res.ok) return joinError.textContent = res.error;
    mySeat = res.seat;
    joinBox.classList.add('hidden');
    gameBox.classList.remove('hidden');
  });
};

$('joinBtn').onclick = () => {
  joinError.textContent = '';
  socket.emit('joinRoom', { name: $('nameInput').value, code: $('roomInput').value }, (res) => {
    if (!res.ok) return joinError.textContent = res.error;
    mySeat = res.seat;
    joinBox.classList.add('hidden');
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

function submitBid() {
  bidError.textContent = '';
  socket.emit('submitBid', { bid: $('bidInput').value }, (res) => {
    if (!res.ok) return bidError.textContent = res.error;
    $('bidInput').value = '';
  });
}

socket.on('roomState', (state) => {
  roomState = state;
  render();
});

socket.on('privateState', (state) => {
  privateState = state;
  mySeat = state.yourSeat;
  render();
});

function render() {
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
  $(`p${seat}Name`).textContent = p.name ? `${p.name}${mySeat === seat ? ' (Bạn)' : ''}` : `Đang chờ người chơi ${seat + 1}`;
  $(`p${seat}Remain`).textContent = p.name ? p.remaining : '-';
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
    $('statusText').textContent = text;
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

  const yourPlayer = roomState.players[mySeat];
  const opp = privateState.opponentPublicInfo;

  let text = `Bạn còn ${yourPlayer.remaining} điểm, mốc ${yourPlayer.tier}. `;
  if (opp) text += `Đối thủ vừa gửi: ${opp.color}, mốc còn lại ${opp.tier}.`;
  else text += 'Chưa có thông tin lượt này từ đối thủ.';

  if (privateState.yourBidSubmitted) text += ` Bạn đã gửi điểm vòng này.`;
  else if (privateState.canSubmit) text += ` Đang tới lượt bạn.`;
  else text += ` Chưa tới lượt bạn.`;

  $('privateInfo').textContent = text;
  $('bidBtn').disabled = !privateState.canSubmit;
  $('bidInput').disabled = !privateState.canSubmit;
  $('bidInput').max = yourPlayer.remaining;
}

function renderLastRound() {
  const lr = roomState.lastRound;
  if (!lr) {
    $('lastRound').textContent = 'Chưa có.';
    return;
  }

  const html = `
    <p><b>${lr.resultText}</b></p>
    ${lr.players.map(p => `
      <p>
        <span class="badge">${p.name}</span>
        ${p.color}, mốc ${p.tier}, còn ${p.remaining} điểm
      </p>
    `).join('')}
  `;
  $('lastRound').innerHTML = html;
}

function renderLog() {
  $('logList').innerHTML = roomState.log.map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
