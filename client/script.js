const BOARD_SIZE = 8;
const EMPTY = '';
const DIRECTIONS = [-1, 0, 1];
const POSITION_WEIGHTS = [
    [100, -20, 10, 5, 5, 10, -20, 100],
    [-20, -50, -2, -2, -2, -2, -50, -20],
    [10, -2, -1, -1, -1, -1, -2, 10],
    [5, -2, -1, -1, -1, -1, -2, 5],
    [5, -2, -1, -1, -1, -1, -2, 5],
    [10, -2, -1, -1, -1, -1, -2, 10],
    [-20, -50, -2, -2, -2, -2, -50, -20],
    [100, -20, 10, 5, 5, 10, -20, 100],
];

const boardElement = document.querySelector('.board');
const modeSelect = document.getElementById('mode');
const themeSelect = document.getElementById('theme');
const difficultySelect = document.getElementById('difficulty');
const restartButton = document.getElementById('restartBtn');
const blackScoreElement = document.getElementById('blackScore');
const whiteScoreElement = document.getElementById('whiteScore');
const statusElement = document.getElementById('statusText');
const metaElement = document.getElementById('metaText');
const aiControls = document.getElementById('aiControls');
const onlineControls = document.getElementById('onlineControls');
const roomIdInput = document.getElementById('roomIdInput');
const createRoomButton = document.getElementById('createRoomBtn');
const joinRoomButton = document.getElementById('joinRoomBtn');
const refreshRoomsButton = document.getElementById('refreshRoomsBtn');
const leaveRoomButton = document.getElementById('leaveRoomBtn');
const roomsListElement = document.getElementById('roomsList');

const socket = window.io();

let state = {
    board: createInitialBoard(),
    currentPlayer: 'B',
    finished: false,
    mode: 'ai',
};

let online = {
    roomId: null,
    color: null,
    connected: false,
    rooms: [],
};

function createInitialBoard() {
    const board = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => EMPTY));
    board[3][3] = 'W';
    board[3][4] = 'B';
    board[4][3] = 'B';
    board[4][4] = 'W';
    return board;
}

function cloneBoard(board) {
    return board.map((row) => [...row]);
}

function opponent(player) {
    return player === 'B' ? 'W' : 'B';
}

function playerName(player) {
    return player === 'B' ? 'Black' : 'White';
}

function collectFlips(board, row, col, player) {
    if (board[row][col] !== EMPTY) {
        return [];
    }

    const flips = [];
    const enemy = opponent(player);

    for (const dr of DIRECTIONS) {
        for (const dc of DIRECTIONS) {
            if (dr === 0 && dc === 0) {
                continue;
            }

            const line = [];
            let r = row + dr;
            let c = col + dc;

            while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
                if (board[r][c] === enemy) {
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

function applyMove(board, row, col, player) {
    const flips = collectFlips(board, row, col, player);
    if (flips.length === 0) {
        return null;
    }

    const updated = cloneBoard(board);
    updated[row][col] = player;
    flips.forEach((tile) => {
        updated[tile.row][tile.col] = player;
    });

    return updated;
}

function countScore(board) {
    let black = 0;
    let white = 0;

    board.forEach((row) => {
        row.forEach((cell) => {
            if (cell === 'B') black += 1;
            if (cell === 'W') white += 1;
        });
    });

    return { black, white };
}

function evaluateBoard(board) {
    const score = countScore(board);
    const pieceDiff = score.white - score.black;

    let positional = 0;
    for (let r = 0; r < BOARD_SIZE; r += 1) {
        for (let c = 0; c < BOARD_SIZE; c += 1) {
            if (board[r][c] === 'W') positional += POSITION_WEIGHTS[r][c];
            if (board[r][c] === 'B') positional -= POSITION_WEIGHTS[r][c];
        }
    }

    const whiteMoves = getValidMoves(board, 'W').length;
    const blackMoves = getValidMoves(board, 'B').length;
    const mobility = whiteMoves - blackMoves;

    return pieceDiff * 2 + positional + mobility * 5;
}

function minimax(board, player, depth, alpha, beta) {
    const myMoves = getValidMoves(board, player);
    const otherMoves = getValidMoves(board, opponent(player));

    if (depth === 0 || (myMoves.length === 0 && otherMoves.length === 0)) {
        return { score: evaluateBoard(board), move: null };
    }

    if (myMoves.length === 0) {
        return minimax(board, opponent(player), depth - 1, alpha, beta);
    }

    if (player === 'W') {
        let best = { score: -Infinity, move: myMoves[0] };
        for (const move of myMoves) {
            const next = applyMove(board, move.row, move.col, player);
            const result = minimax(next, opponent(player), depth - 1, alpha, beta);
            if (result.score > best.score) {
                best = { score: result.score, move };
            }
            alpha = Math.max(alpha, result.score);
            if (beta <= alpha) {
                break;
            }
        }
        return best;
    }

    let best = { score: Infinity, move: myMoves[0] };
    for (const move of myMoves) {
        const next = applyMove(board, move.row, move.col, player);
        const result = minimax(next, opponent(player), depth - 1, alpha, beta);
        if (result.score < best.score) {
            best = { score: result.score, move };
        }
        beta = Math.min(beta, result.score);
        if (beta <= alpha) {
            break;
        }
    }
    return best;
}

function aiChooseMove() {
    const moves = getValidMoves(state.board, 'W');
    if (moves.length === 0) {
        return null;
    }

    if (difficultySelect.value === 'easy') {
        return moves[Math.floor(Math.random() * moves.length)];
    }

    const depth = difficultySelect.value === 'hard' ? 4 : 2;
    return minimax(state.board, 'W', depth, -Infinity, Infinity).move;
}

function resolveTurnAfterMove() {
    const next = opponent(state.currentPlayer);
    const nextMoves = getValidMoves(state.board, next);
    const currentMoves = getValidMoves(state.board, state.currentPlayer);

    if (nextMoves.length > 0) {
        state.currentPlayer = next;
        statusElement.textContent = `${playerName(state.currentPlayer)} to move.`;
        return;
    }

    if (currentMoves.length > 0) {
        statusElement.textContent = `${playerName(next)} has no valid moves. Turn passed.`;
        return;
    }

    endGame();
}

function endGame() {
    state.finished = true;
    const score = countScore(state.board);

    if (score.black > score.white) {
        statusElement.textContent = `Game over. Black wins (${score.black}:${score.white}).`;
    } else if (score.white > score.black) {
        statusElement.textContent = `Game over. White wins (${score.white}:${score.black}).`;
    } else {
        statusElement.textContent = `Game over. Draw (${score.black}:${score.white}).`;
    }
}

function renderRoomList() {
    if (state.mode !== 'online') {
        roomsListElement.innerHTML = '';
        return;
    }

    if (!online.rooms.length) {
        roomsListElement.innerHTML = '<p class="small">Нет комнат. Создайте первую.</p>';
        return;
    }

    roomsListElement.innerHTML = online.rooms
        .map((room) => {
            const disabled = room.players >= 2 ? 'disabled' : '';
            const status = room.waiting ? 'waiting' : room.finished ? 'finished' : 'active';
            return `
                <div class="room-item">
                    <div>
                        <strong>${room.roomId}</strong>
                        <p>${room.players}/2 • ${status}</p>
                    </div>
                    <button data-room-id="${room.roomId}" ${disabled}>Join</button>
                </div>
            `;
        })
        .join('');

    roomsListElement.querySelectorAll('button[data-room-id]').forEach((button) => {
        button.addEventListener('click', () => {
            socket.emit('online:join-room', { roomId: button.dataset.roomId });
        });
    });
}

function updateBoardView() {
    const validMoves = getValidMoves(state.board, state.currentPlayer);

    boardElement.querySelectorAll('.cell').forEach((cell) => {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);

        cell.classList.remove('black', 'white', 'hint', 'playable');

        if (state.board[row][col] === 'B') {
            cell.classList.add('black');
        } else if (state.board[row][col] === 'W') {
            cell.classList.add('white');
        } else if (validMoves.some((move) => move.row === row && move.col === col)) {
            cell.classList.add('hint', 'playable');
        }
    });

    const score = countScore(state.board);
    blackScoreElement.textContent = String(score.black);
    whiteScoreElement.textContent = String(score.white);

    if (state.mode === 'online') {
        if (!online.connected) {
            metaElement.textContent = 'Lobby mode. Pick a room or create one.';
            leaveRoomButton.classList.add('hidden');
        } else {
            metaElement.textContent = `Room ${online.roomId} • You are ${playerName(online.color)}.`;
            leaveRoomButton.classList.remove('hidden');
        }
        renderRoomList();
    } else {
        metaElement.textContent = '';
        leaveRoomButton.classList.add('hidden');
    }
}

function playLocalMove(row, col) {
    if (state.finished) return;

    const updated = applyMove(state.board, row, col, state.currentPlayer);
    if (!updated) {
        statusElement.textContent = 'Invalid move. Choose a highlighted cell.';
        return;
    }

    state.board = updated;
    resolveTurnAfterMove();
    updateBoardView();

    if (state.mode === 'ai' && !state.finished && state.currentPlayer === 'W') {
        window.setTimeout(() => {
            const aiMove = aiChooseMove();
            if (!aiMove) {
                resolveTurnAfterMove();
                updateBoardView();
                return;
            }
            state.board = applyMove(state.board, aiMove.row, aiMove.col, 'W');
            state.currentPlayer = 'W';
            resolveTurnAfterMove();
            updateBoardView();
        }, 280);
    }
}

function onCellClick(row, col) {
    if (state.mode === 'online') {
        if (!online.connected) {
            statusElement.textContent = 'Create or join a room first.';
            return;
        }
        if (state.finished) return;
        if (state.currentPlayer !== online.color) {
            statusElement.textContent = 'Wait for your turn.';
            return;
        }
        socket.emit('online:move', { row, col });
        return;
    }

    if (state.mode === 'local' || state.mode === 'ai') {
        if (state.mode === 'ai' && state.currentPlayer === 'W') return;
        playLocalMove(row, col);
    }
}


function applyTheme(themeName) {
    const allowedThemes = ['forest-night', 'sunset-wood', 'neon-grid', 'minimal-light'];
    const nextTheme = allowedThemes.includes(themeName) ? themeName : 'forest-night';
    document.body.setAttribute('data-theme', nextTheme);
    themeSelect.value = nextTheme;
    window.localStorage.setItem('reversi-theme', nextTheme);
}

function initTheme() {
    const savedTheme = window.localStorage.getItem('reversi-theme') || 'forest-night';
    applyTheme(savedTheme);
}

function setupBoard() {
    boardElement.innerHTML = '';

    for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'cell';
            cell.dataset.row = String(row);
            cell.dataset.col = String(col);
            cell.addEventListener('click', () => onCellClick(row, col));
            boardElement.appendChild(cell);
        }
    }
}

function resetOfflineGame() {
    state.board = createInitialBoard();
    state.currentPlayer = 'B';
    state.finished = false;
    statusElement.textContent = 'Black to move.';
    updateBoardView();
}

function setMode(mode) {
    state.mode = mode;
    aiControls.classList.toggle('hidden', mode !== 'ai');
    onlineControls.classList.toggle('hidden', mode !== 'online');

    if (mode === 'online') {
        statusElement.textContent = 'Online lobby: create a room or join existing one.';
        socket.emit('online:list-rooms');
        updateBoardView();
        return;
    }

    if (online.connected) {
        socket.emit('online:leave-room');
    }
    online = { roomId: null, color: null, connected: false, rooms: [] };
    resetOfflineGame();
}

modeSelect.addEventListener('change', () => {
    setMode(modeSelect.value);
});

difficultySelect.addEventListener('change', () => {
    if (state.mode === 'ai') {
        resetOfflineGame();
    }
});

restartButton.addEventListener('click', () => {
    if (state.mode === 'online' && online.connected) {
        socket.emit('online:restart');
        return;
    }
    resetOfflineGame();
});

refreshRoomsButton.addEventListener('click', () => {
    socket.emit('online:list-rooms');
});

createRoomButton.addEventListener('click', () => {
    socket.emit('online:create-room', { roomId: roomIdInput.value });
});

joinRoomButton.addEventListener('click', () => {
    socket.emit('online:join-room', { roomId: roomIdInput.value });
});

leaveRoomButton.addEventListener('click', () => {
    socket.emit('online:leave-room');
    online.connected = false;
    online.roomId = null;
    online.color = null;
    statusElement.textContent = 'You left the room. Choose another in lobby.';
    state.board = createInitialBoard();
    state.currentPlayer = 'B';
    state.finished = false;
    socket.emit('online:list-rooms');
    updateBoardView();
});

socket.on('online:joined', ({ roomId, color }) => {
    online = { ...online, roomId, color, connected: true };
    roomIdInput.value = roomId;
    statusElement.textContent = 'Connected. Waiting for game state...';
    updateBoardView();
});

socket.on('online:state', (payload) => {
    if (state.mode !== 'online') {
        return;
    }

    state.board = payload.board;
    state.currentPlayer = payload.currentPlayer;
    state.finished = payload.finished;
    statusElement.textContent = payload.lastAction || `${playerName(state.currentPlayer)} to move.`;
    updateBoardView();
});

socket.on('online:rooms', (rooms) => {
    online.rooms = rooms;
    renderRoomList();
});

socket.on('online:error', ({ message }) => {
    statusElement.textContent = message;
});

themeSelect.addEventListener('change', () => {
    applyTheme(themeSelect.value);
});

initTheme();
setupBoard();
setMode('ai');
