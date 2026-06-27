const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();

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

function maskLastRound(lastRound, viewerSeat) {
  if (!lastRound) return null;
  return {
    ...lastRound,
    players: lastRound.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      color: p.color,
      tier: p.tier,
      // Chỉ người chơi đó thấy điểm còn lại chính xác của mình.
      // Đối thủ chỉ thấy mốc A/B/C/D/E.
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
      connected: !!p?.connected,
      // Không public điểm còn lại chính xác của đối thủ.
      // Viewer chỉ thấy số điểm của chính mình; người kia chỉ hiện mốc.
      remaining: p && idx === viewerSeat ? p.remaining : null,
      tier: p ? tier(p.remaining) : null,
      wins: p?.wins ?? 0,
      submittedThisRound: room.current.bids[idx] !== null
    })),
    lastRound: maskLastRound(room.lastRound, viewerSeat),
    log: room.log.slice(-10)
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

  // Luật đúng: người thắng vòng trước được đi trước vòng tiếp theo.
  // Nếu vòng trước hòa, giữ người thắng gần nhất trước đó.
  // Nếu từ đầu ván tới giờ chưa ai thắng, giữ người đi trước hiện tại.
  if (room.lastWinnerSeat !== null && room.lastWinnerSeat !== undefined) {
    room.firstSeat = room.lastWinnerSeat;
  }

  room.phase = 'waiting_first';
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
      color: colorOf(room.current.bids[seat]),
      tier: tier(p.remaining),
      remaining: p.remaining
      // Không gửi số đã chọn để giữ đúng luật bí mật.
    }))
  };

  room.log.push(note);

  if (room.round >= room.maxRounds) {
    room.finished = true;
    room.phase = 'finished';
    const w0 = room.players[0].wins;
    const w1 = room.players[1].wins;
    if (w0 > w1) room.log.push(`${room.players[0].name} thắng chung cuộc ${w0}-${w1}`);
    else if (w1 > w0) room.log.push(`${room.players[1].name} thắng chung cuộc ${w1}-${w0}`);
    else room.log.push(`Chung cuộc hòa ${w0}-${w1}`);
  } else {
    nextRound(room);
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    try {
      const cleanName = String(name || '').trim().slice(0, 20);
      if (!cleanName) return cb({ ok: false, error: 'Nhập tên trước đã.' });

      let code = makeCode();
      while (rooms.has(code)) code = makeCode();

      const room = {
        code,
        started: false,
        finished: false,
        maxRounds: 9,
        round: 1,
        firstSeat: 0, // Vòng 1: chủ phòng đi trước. Từ vòng 2 trở đi: người thắng gần nhất đi trước.
        lastWinnerSeat: null,
        phase: 'lobby',
        players: [
          { id: socket.id, name: cleanName, remaining: 99, wins: 0, connected: true },
          null
        ],
        current: resetCurrent(),
        lastRound: null,
        log: [`${cleanName} đã tạo phòng ${code}`]
      };

      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.seat = 0;
      cb({ ok: true, code, seat: 0 });
      emitRoom(room);
    } catch (err) {
      cb({ ok: false, error: 'Không tạo được phòng.' });
    }
  });

  socket.on('joinRoom', ({ code, name }, cb) => {
    try {
      code = String(code || '').trim().toUpperCase();
      const cleanName = String(name || '').trim().slice(0, 20);
      if (!cleanName) return cb({ ok: false, error: 'Nhập tên trước đã.' });
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, error: 'Không tìm thấy phòng.' });
      if (room.players[1] && room.players[1].connected) return cb({ ok: false, error: 'Phòng đã đủ 2 người.' });
      if (room.started) return cb({ ok: false, error: 'Ván đã bắt đầu.' });

      room.players[1] = { id: socket.id, name: cleanName, remaining: 99, wins: 0, connected: true };
      room.log.push(`${cleanName} đã vào phòng`);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.seat = 1;
      cb({ ok: true, code, seat: 1 });
      emitRoom(room);
    } catch (err) {
      cb({ ok: false, error: 'Không vào được phòng.' });
    }
  });

  socket.on('startGame', (cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb?.({ ok: false, error: 'Bạn chưa ở trong phòng.' });
    if (socket.data.seat !== 0) return cb?.({ ok: false, error: 'Chỉ chủ phòng được bắt đầu.' });
    if (!room.players[0] || !room.players[1]) return cb?.({ ok: false, error: 'Cần đủ 2 người.' });

    room.started = true;
    room.finished = false;
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
    room.log.push('Ván đấu bắt đầu. Vòng 1 chủ phòng đi trước. Từ vòng 2, người thắng gần nhất đi trước.');
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

    room.started = true;
    room.finished = false;
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
    room.log = ['Ván mới bắt đầu. Vòng 1 chủ phòng đi trước. Từ vòng 2, người thắng gần nhất đi trước.'];
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
