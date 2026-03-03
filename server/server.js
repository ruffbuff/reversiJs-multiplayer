const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const BOARD_SIZE = 8;

function createInitialBoard() {
    const board = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => ''));
    board[3][3] = 'W';
    board[3][4] = 'B';
    board[4][3] = 'B';
    board[4][4] = 'W';
    return board;
}

function collectFlips(board, row, col, player) {
    if (board[row][col] !== '') {
        return [];
    }

    const opponent = player === 'B' ? 'W' : 'B';
    const flips = [];

    for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
            if (dr === 0 && dc === 0) {
                continue;
            }

            const line = [];
            let r = row + dr;
            let c = col + dc;

            while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
                if (board[r][c] === opponent) {
                    line.push({ row: r, col: c });
                } else if (board[r][c] === player && line.length > 0) {
                    flips.push(...line);
                    break;
                } else {
                    break;
                }

                r += dr;
                c += dc;
            }
        }
    }

    return flips;
}

function getValidMoves(board, player) {
    const moves = [];

    for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
            const flips = collectFlips(board, row, col, player);
            if (flips.length > 0) {
                moves.push({ row, col, flips });
            }
        }
    }

    return moves;
}

function countScore(board) {
    let black = 0;
    let white = 0;

    for (const row of board) {
        for (const cell of row) {
            if (cell === 'B') {
                black += 1;
            } else if (cell === 'W') {
                white += 1;
            }
        }
    }

    return { black, white };
}

function applyMove(room, player, row, col) {
    if (room.finished || room.currentPlayer !== player) {
        return { ok: false, message: 'Not your turn.' };
    }

    const flips = collectFlips(room.board, row, col, player);
    if (flips.length === 0) {
        return { ok: false, message: 'Invalid move.' };
    }

    room.board[row][col] = player;
    flips.forEach(({ row: r, col: c }) => {
        room.board[r][c] = player;
    });

    const nextPlayer = player === 'B' ? 'W' : 'B';
    const nextMoves = getValidMoves(room.board, nextPlayer);
    const currentMoves = getValidMoves(room.board, player);

    if (nextMoves.length > 0) {
        room.currentPlayer = nextPlayer;
        room.lastAction = `${nextPlayer === 'B' ? 'Black' : 'White'} to move.`;
    } else if (currentMoves.length > 0) {
        room.currentPlayer = player;
        room.lastAction = `${nextPlayer === 'B' ? 'Black' : 'White'} has no valid moves. Turn passed.`;
    } else {
        room.finished = true;
        const { black, white } = countScore(room.board);
        if (black > white) {
            room.lastAction = `Game over. Black wins (${black}:${white}).`;
        } else if (white > black) {
            room.lastAction = `Game over. White wins (${white}:${black}).`;
        } else {
            room.lastAction = `Game over. Draw (${black}:${white}).`;
        }
    }

    return { ok: true };
}

function roomState(room, roomId) {
    return {
        roomId,
        board: room.board,
        currentPlayer: room.currentPlayer,
        finished: room.finished,
        score: countScore(room.board),
        players: room.players,
        lastAction: room.lastAction,
    };
}

function listRooms(rooms) {
    return Array.from(rooms.entries())
        .map(([roomId, room]) => ({
            roomId,
            players: Number(Boolean(room.players.B)) + Number(Boolean(room.players.W)),
            finished: room.finished,
            waiting: Boolean(room.players.B) && !room.players.W,
        }))
        .sort((a, b) => a.roomId.localeCompare(b.roomId));
}

function generateRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizeRoomId(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const clientPath = path.join(__dirname, '..', 'client');
const rooms = new Map();

app.use(express.static(clientPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

function broadcastRoomList() {
    io.emit('online:rooms', listRooms(rooms));
}

function leaveCurrentRoom(socket) {
    const roomId = socket.data.roomId;
    const color = socket.data.color;

    if (!roomId || !rooms.has(roomId) || !color) {
        return;
    }

    const room = rooms.get(roomId);
    if (room.players[color] === socket.id) {
        room.players[color] = null;
        room.lastAction = `${color === 'B' ? 'Black' : 'White'} disconnected.`;
    }

    socket.leave(roomId);
    socket.data.roomId = null;
    socket.data.color = null;

    if (!room.players.B && !room.players.W) {
        rooms.delete(roomId);
    } else {
        io.to(roomId).emit('online:state', roomState(room, roomId));
    }

    broadcastRoomList();
}

io.on('connection', (socket) => {
    socket.emit('online:rooms', listRooms(rooms));

    socket.on('online:list-rooms', () => {
        socket.emit('online:rooms', listRooms(rooms));
    });

    socket.on('online:create-room', ({ roomId }) => {
        leaveCurrentRoom(socket);

        let nextRoomId = normalizeRoomId(roomId);
        if (nextRoomId.length > 0 && nextRoomId.length < 4) {
            socket.emit('online:error', { message: 'Room code must be 4-6 characters.' });
            return;
        }

        if (!nextRoomId) {
            nextRoomId = generateRoomId();
            while (rooms.has(nextRoomId)) {
                nextRoomId = generateRoomId();
            }
        } else if (rooms.has(nextRoomId)) {
            socket.emit('online:error', { message: 'Room code already exists.' });
            return;
        }

        const room = {
            board: createInitialBoard(),
            currentPlayer: 'B',
            finished: false,
            players: { B: socket.id, W: null },
            lastAction: 'Room created. Waiting for opponent...',
        };

        rooms.set(nextRoomId, room);
        socket.join(nextRoomId);
        socket.data.roomId = nextRoomId;
        socket.data.color = 'B';

        socket.emit('online:joined', { roomId: nextRoomId, color: 'B' });
        socket.emit('online:state', roomState(room, nextRoomId));
        broadcastRoomList();
    });

    socket.on('online:join-room', ({ roomId }) => {
        leaveCurrentRoom(socket);

        const normalized = normalizeRoomId(roomId);
        const room = rooms.get(normalized);

        if (!room) {
            socket.emit('online:error', { message: 'Room not found.' });
            return;
        }

        if (room.players.B && room.players.W) {
            socket.emit('online:error', { message: 'Room is full.' });
            return;
        }

        const color = room.players.B ? 'W' : 'B';
        room.players[color] = socket.id;
        room.lastAction = `${room.currentPlayer === 'B' ? 'Black' : 'White'} to move.`;

        socket.join(normalized);
        socket.data.roomId = normalized;
        socket.data.color = color;

        socket.emit('online:joined', { roomId: normalized, color });
        io.to(normalized).emit('online:state', roomState(room, normalized));
        broadcastRoomList();
    });

    socket.on('online:leave-room', () => {
        leaveCurrentRoom(socket);
    });

    socket.on('online:move', ({ row, col }) => {
        const roomId = socket.data.roomId;
        const color = socket.data.color;

        if (!roomId || !color) {
            socket.emit('online:error', { message: 'Join a room first.' });
            return;
        }

        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('online:error', { message: 'Room no longer exists.' });
            return;
        }

        if (room.players[color] !== socket.id) {
            socket.emit('online:error', { message: 'Player session mismatch.' });
            return;
        }

        const numericRow = Number(row);
        const numericCol = Number(col);
        if (!Number.isInteger(numericRow) || !Number.isInteger(numericCol) || numericRow < 0 || numericRow > 7 || numericCol < 0 || numericCol > 7) {
            socket.emit('online:error', { message: 'Invalid board position.' });
            return;
        }

        const result = applyMove(room, color, numericRow, numericCol);
        if (!result.ok) {
            socket.emit('online:error', { message: result.message });
            return;
        }

        io.to(roomId).emit('online:state', roomState(room, roomId));
    });

    socket.on('online:restart', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms.has(roomId)) {
            return;
        }

        const room = rooms.get(roomId);
        room.board = createInitialBoard();
        room.currentPlayer = 'B';
        room.finished = false;
        room.lastAction = 'Game restarted. Black to move.';

        io.to(roomId).emit('online:state', roomState(room, roomId));
    });

    socket.on('disconnect', () => {
        leaveCurrentRoom(socket);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}/`);
});
