'use strict';

// Constants
const BOARD_SIZE = 5;
const TARGET_VALUE = 3072;
const NEW_TILE_VALUE = 3;
const STORAGE_KEY = 'game-3072-state';

// State
let board = createEmptyBoard(); // 5x5, zeros
let moveCount = 0;
let inputLocked = false;
let lastDirection = null;
const SLIDE_MS = 200; // slowed down for smoother motion
const GROUP_MS = 220;

// Elements
const boardEl = document.getElementById('board');
const moveCountEl = document.getElementById('moveCount');
const restartBtn = document.getElementById('restartBtn');
const modalEl = document.getElementById('modal');
const modalTitleEl = document.getElementById('modalTitle');
const modalMessageEl = document.getElementById('modalMessage');
const playAgainBtn = document.getElementById('playAgainBtn');
const liveEl = document.getElementById('live');

// Utilities
function createEmptyBoard() {
	return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function cloneBoard(b) {
	return b.map(row => row.slice());
}

function getEmptyCells(b) {
	const cells = [];
	for (let r = 0; r < BOARD_SIZE; r++) {
		for (let c = 0; c < BOARD_SIZE; c++) {
			if (b[r][c] === 0) cells.push([r, c]);
		}
	}
	return cells;
}

function randomChoice(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

function saveState() {
	try {
		const data = { board, moveCount };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch (_) {}
}

function loadState() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return false;
		const data = JSON.parse(raw);
		if (!data || !Array.isArray(data.board)) return false;
		board = data.board;
		moveCount = data.moveCount || 0;
		return true;
	} catch (_) {
		return false;
	}
}

function announce(text) {
	if (!liveEl) return;
	liveEl.textContent = '';
	// Ensure screen readers pick up subsequent identical text
	setTimeout(() => (liveEl.textContent = text), 0);
}

// Rendering
function renderBoard(prevBoard, options = {}) {
	const { spawned = [], merged = [], moves = [] } = options;
	const animating = prevBoard && moves && moves.length > 0;
	boardEl.innerHTML = '';
	boardEl.setAttribute('aria-rowcount', String(BOARD_SIZE));
	boardEl.setAttribute('aria-colcount', String(BOARD_SIZE));

	if (!boardEl.classList.contains('with-overlay')) {
		boardEl.classList.add('with-overlay');
	}

	for (let r = 0; r < BOARD_SIZE; r++) {
		for (let c = 0; c < BOARD_SIZE; c++) {
			const value = board[r][c];
			const cell = document.createElement('div');
			cell.setAttribute('role', 'gridcell');
			cell.setAttribute('aria-rowindex', String(r + 1));
			cell.setAttribute('aria-colindex', String(c + 1));
			if (animating || value === 0) {
				cell.className = 'cell-empty';
				boardEl.appendChild(cell);
				continue;
			}
			const tile = document.createElement('div');
			tile.className = `tile ${tileClass(value)}`;
			tile.textContent = String(value);
			const len = String(value).length;
			tile.style.fontSize = len <= 2 ? '1.6rem' : len === 3 ? '1.3rem' : '1.1rem';
			if (spawned.some(([sr, sc]) => sr === r && sc === c)) tile.classList.add('spawn');
			// merged pulse will be applied later via addMergePulse to avoid flicker
			tile.dataset.row = String(r);
			tile.dataset.col = String(c);
			boardEl.appendChild(tile);
		}
	}

	if (!animating && merged && merged.length) {
		addMergePulse(merged);
	}

	moveCountEl.textContent = String(moveCount);
}

function addMergePulse(mergedPositions) {
	// Apply merge animation after tiles are in DOM to avoid flicker
	requestAnimationFrame(() => {
		for (const [r, c] of mergedPositions) {
			const selector = `.tile[data-row="${r}"][data-col="${c}"]`;
			const el = boardEl.querySelector(selector);
			if (el) {
				el.classList.remove('merge'); // restart if present
				// Force reflow to allow re-adding
				void el.offsetWidth;
				el.classList.add('merge');
			}
		}
	});
}

function animateSlides(prevBoard, moves, onDone) {
	const overlay = document.createElement('div');
	overlay.style.position = 'absolute';
	overlay.style.inset = '0';
	overlay.style.pointerEvents = 'none';
	overlay.className = 'anim-layer';
	boardEl.appendChild(overlay);

	const cs = getComputedStyle(boardEl);
	const gap = parseFloat(cs.getPropertyValue('grid-gap') || cs.getPropertyValue('gap') || '12');
	const pad = parseFloat(cs.paddingLeft || '0');
	const total = boardEl.clientWidth;
	const tileSize = (total - pad * 2 - gap * (BOARD_SIZE - 1)) / BOARD_SIZE;
	function pos(r, c) { const x = pad + c * (tileSize + gap); const y = pad + r * (tileSize + gap); return { x, y }; }

	for (const move of moves) {
		const { fromR, fromC, toR, toC, value } = move;
		if (fromR === toR && fromC === toC) continue;
		const start = pos(fromR, fromC);
		const end = pos(toR, toC);
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const piece = document.createElement('div');
		piece.className = `tile ${tileClass(value)}`;
		piece.textContent = String(value);
		piece.style.position = 'absolute';
		piece.style.left = `${start.x}px`;
		piece.style.top = `${start.y}px`;
		piece.style.width = `${tileSize}px`;
		piece.style.height = `${tileSize}px`;
		piece.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(.2,.8,.2,1)`;
		piece.style.willChange = 'transform';
		piece.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
		piece.style.opacity = '0.98';
		overlay.appendChild(piece);
	}

	setTimeout(() => {
		if (typeof onDone === 'function') onDone();
		// Keep overlay a bit longer to mask initial paint
		setTimeout(() => {
			if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
		}, 80);
	}, SLIDE_MS + 10);
}

function animateGroup(direction, onDone) {
	// Snapshot current non-zero tiles and move the whole group slightly towards direction
	const overlay = document.createElement('div');
	overlay.className = 'anim-layer';
	overlay.style.position = 'absolute';
	overlay.style.inset = '0';
	overlay.style.pointerEvents = 'none';

	const group = document.createElement('div');
	group.style.position = 'absolute';
	group.style.left = '0';
	group.style.top = '0';
	group.style.right = '0';
	group.style.bottom = '0';
	group.style.transition = `transform ${GROUP_MS}ms cubic-bezier(.25,.8,.25,1)`;

	const cs = getComputedStyle(boardEl);
	const gap = parseFloat(cs.getPropertyValue('grid-gap') || cs.getPropertyValue('gap') || '12');
	const pad = parseFloat(cs.paddingLeft || '0');
	const total = boardEl.clientWidth;
	const tileSize = (total - pad * 2 - gap * (BOARD_SIZE - 1)) / BOARD_SIZE;
	function pos(r, c) { const x = pad + c * (tileSize + gap); const y = pad + r * (tileSize + gap); return { x, y }; }

	for (let r = 0; r < BOARD_SIZE; r++) {
		for (let c = 0; c < BOARD_SIZE; c++) {
			const value = board[r][c];
			if (!value) continue;
			const p = pos(r, c);
			const piece = document.createElement('div');
			piece.className = `tile ${tileClass(value)}`;
			piece.textContent = String(value);
			piece.style.position = 'absolute';
			piece.style.left = `${p.x}px`;
			piece.style.top = `${p.y}px`;
			piece.style.width = `${tileSize}px`;
			piece.style.height = `${tileSize}px`;
			group.appendChild(piece);
		}
	}

	overlay.appendChild(group);
	boardEl.appendChild(overlay);

	const shift = tileSize + gap; // move one cell distance
	let dx = 0, dy = 0;
	switch (direction) {
		case Direction.Left: dx = -shift; break;
		case Direction.Right: dx = shift; break;
		case Direction.Up: dy = -shift; break;
		case Direction.Down: dy = shift; break;
	}
	requestAnimationFrame(() => { group.style.transform = `translate3d(${dx}px, ${dy}px, 0)`; });

	setTimeout(() => {
		if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
		if (typeof onDone === 'function') onDone();
	}, GROUP_MS + 20);
}

function tileClass(value) {
	// Map to nearest defined class
	switch (value) {
		case 3: return 'tile-3';
		case 6: return 'tile-6';
		case 12: return 'tile-12';
		case 24: return 'tile-24';
		case 48: return 'tile-48';
		case 96: return 'tile-96';
		case 192: return 'tile-192';
		case 384: return 'tile-384';
		case 768: return 'tile-768';
		case 1536: return 'tile-1536';
		case 3072: return 'tile-3072';
		default: return 'tile-3072';
	}
}

// Game lifecycle
function resetGame() {
	board = createEmptyBoard();
	moveCount = 0;
	spawnRandomTiles(2);
	renderBoard();
	saveState();
}

function spawnRandomTiles(n) {
	const spawned = [];
	for (let i = 0; i < n; i++) {
		const empties = getEmptyCells(board);
		if (empties.length === 0) break;
		const [r, c] = randomChoice(empties);
		board[r][c] = NEW_TILE_VALUE;
		spawned.push([r, c]);
	}
	return spawned;
}

function checkWin() {
	for (let r = 0; r < BOARD_SIZE; r++) {
		for (let c = 0; c < BOARD_SIZE; c++) {
			if (board[r][c] >= TARGET_VALUE) return true;
		}
	}
	return false;
}

function hasMovesAvailable() {
	if (getEmptyCells(board).length > 0) return true;
	for (let r = 0; r < BOARD_SIZE; r++) {
		for (let c = 0; c < BOARD_SIZE; c++) {
			const v = board[r][c];
			if (r + 1 < BOARD_SIZE && board[r + 1][c] === v) return true;
			if (c + 1 < BOARD_SIZE && board[r][c + 1] === v) return true;
		}
	}
	return false;
}

// Movement
const Direction = Object.freeze({ Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' });

function handleMove(direction) {
	if (inputLocked) return;
	inputLocked = true;
	lastDirection = direction;
	const before = cloneBoard(board);

	// Compute final state and precise moves first
	const { moved, mergedPositions, slideMoves } = moveBoard(direction);
	if (!moved) {
		inputLocked = false;
		return; // no-op
	}

	moveCount += 1;
	const spawned = spawnRandomTiles(1);

	// Render placeholders and animate all tiles to final destinations (incl. merges)
	renderBoard(before, { moves: slideMoves });
	animateSlides(before, slideMoves, () => {
		// Then show final board with spawn/merge pulses
		renderBoard(null, { spawned, merged: mergedPositions });
		saveState();
		if (handleWinLoseAfterRender()) { inputLocked = false; return; }
		setTimeout(() => { inputLocked = false; }, 20);
	});
}

function moveBoard(direction) {
	let moved = false;
	const mergedPositions = [];
	const slideMoves = [];

	if (direction === Direction.Left || direction === Direction.Right) {
		for (let r = 0; r < BOARD_SIZE; r++) {
			const row = board[r].slice();
			const { line, movedLine, mergedIdxs, moves } = compressAndMergeLineWithMoves(row, direction === Direction.Left);
			if (!arraysEqual(line, board[r])) moved = true;
			board[r] = line;
			for (const idx of mergedIdxs) mergedPositions.push([r, idx]);
			for (const m of moves) slideMoves.push({ fromR: r, fromC: m.from, toR: r, toC: m.to, value: m.value });
		}
	} else {
		for (let c = 0; c < BOARD_SIZE; c++) {
			const col = [];
			for (let r = 0; r < BOARD_SIZE; r++) col.push(board[r][c]);
			const { line, movedLine, mergedIdxs, moves } = compressAndMergeLineWithMoves(col, direction === Direction.Up);
			for (let r = 0; r < BOARD_SIZE; r++) {
				if (board[r][c] !== line[r]) moved = true;
				board[r][c] = line[r];
			}
			for (const idx of mergedIdxs) mergedPositions.push([idx, c]);
			for (const m of moves) slideMoves.push({ fromR: m.from, fromC: c, toR: m.to, toC: c, value: m.value });
		}
	}

	return { moved, mergedPositions, slideMoves };
}

function compressAndMergeLineWithMoves(line, forward) {
	// Build working list with original indices in line orientation
	const items = [];
	for (let i = 0; i < line.length; i++) if (line[i] !== 0) items.push({ value: line[i], idx: i });
	const working = forward ? items : items.slice().reverse().map(it => ({ value: it.value, idx: BOARD_SIZE - 1 - it.idx }));

	const result = [];
	const mergedIdxsForward = [];
	const moves = [];
	for (let i = 0; i < working.length; i++) {
		const cur = working[i];
		if (i + 1 < working.length && cur.value === working[i + 1].value) {
			const next = working[i + 1];
			const sum = cur.value + next.value;
			const toIdxForward = result.length; // destination index in forward orientation
			result.push(sum);
			mergedIdxsForward.push(toIdxForward);
			// Both tiles animate to the same destination index
			const mappedDest = forward ? toIdxForward : BOARD_SIZE - 1 - toIdxForward;
			moves.push({ from: cur.idx, to: mappedDest, value: cur.value });
			moves.push({ from: next.idx, to: mappedDest, value: next.value });
			i++; // consume next
		} else {
			const toIdxForward = result.length;
			result.push(cur.value);
			moves.push({ from: cur.idx, to: forward ? toIdxForward : BOARD_SIZE - 1 - toIdxForward, value: cur.value });
		}
	}
	while (result.length < BOARD_SIZE) result.push(0);

	let finalLine, mergedIdxsMapped;
	if (forward) {
		finalLine = result;
		mergedIdxsMapped = mergedIdxsForward;
	} else {
		finalLine = result.slice().reverse();
		mergedIdxsMapped = mergedIdxsForward.map(i => BOARD_SIZE - 1 - i);
	}
	return { line: finalLine, movedLine: !arraysEqual(finalLine, line), mergedIdxs: mergedIdxsMapped, moves };
}

function arraysEqual(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

// UI helpers
function openModal(title, message) {
	modalTitleEl.textContent = title;
	modalMessageEl.textContent = message;
	const modalCard = modalEl.querySelector('.modal-card');
	const iconEl = document.getElementById('modalIcon');
	const confettiCanvas = document.getElementById('confetti');
	modalCard.classList.remove('win', 'lose');
	iconEl.textContent = '🎉';
	if (title.includes('恭喜') || title.toLowerCase().includes('congrat')) {
		modalCard.classList.add('win');
		iconEl.textContent = '🎉';
		try { runConfetti(confettiCanvas); } catch (_) {}
	} else if (title.toLowerCase().includes('game over') || title.includes('失败')) {
		modalCard.classList.add('lose');
		iconEl.textContent = '😢';
		if (confettiCanvas) confettiCanvas.style.display = 'none';
	}
	modalEl.classList.add('open');
}

function closeModal() {
	modalEl.classList.remove('open');
}

function runConfetti(canvas) {
	if (!canvas) return;
	const dpr = window.devicePixelRatio || 1;
	const ctx = canvas.getContext('2d');
	canvas.style.display = 'block';
	function resize() { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; }
	resize();
	const colors = ['#fbbf24','#34d399','#60a5fa','#f472b6','#f87171','#a78bfa'];
	const count = Math.floor(Math.min(180, Math.max(90, innerWidth / 8)));
	const particles = Array.from({ length: count }, () => ({
		x: Math.random() * canvas.width,
		y: -Math.random() * canvas.height * 0.2,
		r: (4 + Math.random() * 6) * dpr,
		vx: (Math.random() - 0.5) * 1.2 * dpr,
		vy: (1.2 + Math.random() * 1.8) * dpr,
		color: colors[Math.floor(Math.random() * colors.length)],
		life: 60 + Math.random() * 60
	}));
	let frame = 0, rafId;
	function tick() {
		ctx.clearRect(0,0,canvas.width,canvas.height);
		for (const p of particles) {
			p.vy += 0.02 * dpr;
			p.x += p.vx; p.y += p.vy; p.life -= 1;
			ctx.beginPath(); ctx.fillStyle = p.color; ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
		}
		frame++;
		if (frame < 75) { rafId = requestAnimationFrame(tick); } else { stop(); }
	}
	function stop() {
		cancelAnimationFrame(rafId);
		ctx.clearRect(0,0,canvas.width,canvas.height);
		canvas.style.display = 'none';
	}
	window.addEventListener('resize', resize, { once: true });
	tick();
}

// Input wiring
function setupInputs() {
	const btnUp = document.getElementById('btnUp'); if (btnUp) btnUp.addEventListener('click', () => handleMove(Direction.Up));
	const btnDown = document.getElementById('btnDown'); if (btnDown) btnDown.addEventListener('click', () => handleMove(Direction.Down));
	const btnLeft = document.getElementById('btnLeft'); if (btnLeft) btnLeft.addEventListener('click', () => handleMove(Direction.Left));
	const btnRight = document.getElementById('btnRight'); if (btnRight) btnRight.addEventListener('click', () => handleMove(Direction.Right));

	document.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowUp') { e.preventDefault(); handleMove(Direction.Up); }
		else if (e.key === 'ArrowDown') { e.preventDefault(); handleMove(Direction.Down); }
		else if (e.key === 'ArrowLeft') { e.preventDefault(); handleMove(Direction.Left); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); handleMove(Direction.Right); }
	});

	// Touch swipe on board
	let touchStartX = 0, touchStartY = 0, touching = false;
	const threshold = 30;
	if (boardEl) {
		boardEl.addEventListener('touchstart', (e) => {
			if (!e.touches || e.touches.length === 0) return;
			touching = true;
			touchStartX = e.touches[0].clientX;
			touchStartY = e.touches[0].clientY;
		}, { passive: true });
		boardEl.addEventListener('touchend', (e) => {
			if (!touching) return;
			touching = false;
			const touch = e.changedTouches && e.changedTouches[0];
			if (!touch) return;
			const dx = touch.clientX - touchStartX;
			const dy = touch.clientY - touchStartY;
			if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
			if (Math.abs(dx) > Math.abs(dy)) {
				handleMove(dx > 0 ? Direction.Right : Direction.Left);
			} else {
				handleMove(dy > 0 ? Direction.Down : Direction.Up);
			}
		}, { passive: true });
	}

	if (restartBtn) restartBtn.addEventListener('click', () => {
		closeModal();
		resetGame();
		announce(currentLang === 'en' ? 'Game reset' : '游戏已重置');
	});
	if (playAgainBtn) playAgainBtn.addEventListener('click', () => {
		closeModal();
		resetGame();
	});

	// Language select
	const sel = document.getElementById('langSelect');
	if (sel) sel.addEventListener('change', () => {
		currentLang = sel.value;
		applyI18n();
	});
}

// Bootstrap
(function init() {
	const restored = loadState();
	// Defer i18n until next frame so I18N/currentLang are defined
	requestAnimationFrame(() => applyI18n());
	if (!restored) {
		resetGame();
	} else {
		renderBoard();
	}
	setupInputs();
})();

const I18N = {
	en: {
		title: '3072 Number Merge',
		subtitle: 'Merge tiles to reach 3072',
		steps: 'Steps',
		restart: 'Restart',
		helper: 'Tip: Use arrow keys or swipe on the board.',
		rulesTitle: 'How to Play',
		rule1: 'The board is 5×5. Two 3-tiles appear at start.',
		rule2: 'After every valid move, a new 3 appears at a random empty cell.',
		rule3: 'Use buttons/arrow keys/swipe to shift all tiles to the edge.',
		rule4: 'Adjacent equal tiles merge into their sum. A tile merges once per move.',
		rule5: 'Reach 3072 to win; no moves and no merges left means game over.',
		rule6: 'Use Restart anytime to reset the game.',
		playAgain: 'Play Again',
		winTitle: 'Congratulations!',
		loseTitle: 'Game Over',
		usedSteps: (n) => `Used ${n} steps`,
	},
	zh: {
		title: '3072推数字游戏',
		subtitle: '合并出3072即可获胜',
		steps: '步数',
		restart: '重新开始',
		helper: '提示：可用键盘方向键，或在棋盘上滑动。',
		rulesTitle: '游戏规则',
		rule1: '棋盘为 5×5，初始随机生成两个数字卡片 3。',
		rule2: '每次有效移动后，随机在一个空格生成数字卡片 3。',
		rule3: '使用按钮/方向键/滑动，让所有卡片向指令方向移动到底。',
		rule4: '相邻且相同的数字会在移动中合并；单次移动每张卡片只合并一次。',
		rule5: '当出现 3072 即获胜；棋盘满且无可合并时游戏结束。',
		rule6: '随时可点击“重新开始”重置本局。',
		playAgain: '再来一局',
		winTitle: '恭喜获胜',
		loseTitle: 'Game Over',
		usedSteps: (n) => `本局用时 ${n} 步`,
	}
};
let currentLang = 'en';

function applyI18n() {
	try {
		document.documentElement.lang = currentLang;
		const dict = I18N[currentLang];
		const nodes = document.querySelectorAll('[data-i18n]');
		nodes.forEach(node => {
			const key = node.getAttribute('data-i18n');
			if (!key) return;
			const val = dict[key];
			if (typeof val === 'string') node.textContent = val;
		});
		// Dynamic labels (guard nulls)
		const b = document.getElementById('board'); if (b) b.setAttribute('aria-label', currentLang === 'en' ? 'Board' : '棋盘');
		const up = document.getElementById('btnUp'); if (up) up.setAttribute('aria-label', currentLang === 'en' ? 'Up' : '上');
		const down = document.getElementById('btnDown'); if (down) down.setAttribute('aria-label', currentLang === 'en' ? 'Down' : '下');
		const left = document.getElementById('btnLeft'); if (left) left.setAttribute('aria-label', currentLang === 'en' ? 'Left' : '左');
		const right = document.getElementById('btnRight'); if (right) right.setAttribute('aria-label', currentLang === 'en' ? 'Right' : '右');
		// Keep focus on board for keyboard controls
		setTimeout(() => { try { if (b) b.focus(); } catch(_){} }, 0);
	} catch (e) {
		console.error('i18n apply failed', e);
	}
}

function formatUsedSteps(n) {
	const dict = I18N[currentLang];
	return typeof dict.usedSteps === 'function' ? dict.usedSteps(n) : String(n);
}

// Override win/lose messaging to use i18n
function handleWinLoseAfterRender() {
	if (checkWin()) {
		openModal(I18N[currentLang].winTitle, formatUsedSteps(moveCount));
		announce(I18N[currentLang].winTitle);
		return true;
	}
	if (!hasMovesAvailable()) {
		openModal(I18N[currentLang].loseTitle, '');
		announce(I18N[currentLang].loseTitle);
		return true;
	}
	return false;
}
