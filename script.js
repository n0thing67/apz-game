let tg = window.Telegram.WebApp;
tg.expand();

// Хранилище очков по уровням
let levelScores = {
    1: 0,
    2: 0,
    3: 0,
    4: 0
};

let levelStartTime = 0; // Для засекания времени

// ==========================================
// НАВИГАЦИЯ
// ==========================================
function startGame(level) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));

    levelStartTime = Date.now(); // Засекаем время старта уровня

    if (level === 1) {
        document.getElementById('screen-level1').classList.add('active');
        initPuzzle();
    } else if (level === 2) {
        document.getElementById('screen-level2').classList.add('active');
        initJumper();
    } else if (level === 3) {
        document.getElementById('screen-level3').classList.add('active');
        init2048();
    } else if (level === 4) {
        document.getElementById('screen-level4').classList.add('active');
        initQuiz();
    }
}

// ==========================================
// УРОВЕНЬ 1: ПАЗЛ (Логика)
// ==========================================
let puzzleState = [1, 2, 3, 4, 5, 6, 7, 8, 9];
let selectedPieceNum = null;
let puzzleSolved = false;

function initPuzzle() {
    puzzleState.sort(() => Math.random() - 0.5);
    createPuzzleElements();
    updatePuzzlePositions();
}

function createPuzzleElements() {
    const board = document.getElementById('puzzle-board');
    board.innerHTML = '';
    for (let i = 1; i <= 9; i++) {
        const div = document.createElement('div');
        div.className = 'puzzle-piece';
        div.id = `piece-${i}`;
        div.style.backgroundImage = `url('assets/${i}.jpg')`;
        div.onclick = () => handlePieceClick(i);
        board.appendChild(div);
    }
}

function updatePuzzlePositions() {
    puzzleState.forEach((pieceNum, index) => {
        const div = document.getElementById(`piece-${pieceNum}`);
        const row = Math.floor(index / 3);
        const col = index % 3;
        div.style.top = `${row * 33.33}%`;
        div.style.left = `${col * 33.33}%`;
        if (selectedPieceNum === pieceNum) div.classList.add('selected');
        else div.classList.remove('selected');
    });
    checkPuzzleWin();
}

function handlePieceClick(clickedNum) {
    if (puzzleSolved) return;
    if (selectedPieceNum === null) {
        selectedPieceNum = clickedNum;
        updatePuzzlePositions();
    } else {
        if (selectedPieceNum !== clickedNum) {
            const index1 = puzzleState.indexOf(selectedPieceNum);
            const index2 = puzzleState.indexOf(clickedNum);
            [puzzleState[index1], puzzleState[index2]] = [puzzleState[index2], puzzleState[index1]];
            selectedPieceNum = null;
            updatePuzzlePositions();
        } else {
            selectedPieceNum = null;
            updatePuzzlePositions();
        }
    }
}

function checkPuzzleWin() {
    const isWin = puzzleState.every((val, index) => val === index + 1);
    if (isWin) {
        puzzleSolved = true;
        const status = document.getElementById('puzzle-status');
        status.textContent = "✅ Логотип собран!";
        status.style.color = "#2ecc71";
        document.querySelectorAll('.puzzle-piece').forEach(el => {
            el.style.border = "none";
            el.style.borderRadius = "0";
            el.style.width = "33.5%";
            el.style.height = "33.5%";
            el.style.cursor = "default";
            el.classList.remove('selected');
        });

        // == ПОДСЧЕТ ОЧКОВ (УРОВЕНЬ 1) ==
        let timeSpent = (Date.now() - levelStartTime) / 1000;
        // Макс 1000, минус 5 очков за секунду. Минимум 100.
        levelScores[1] = Math.max(100, Math.floor(1000 - timeSpent * 5));

        document.getElementById('btn-next-2').classList.remove('hidden');
    }
}

// ==========================================
// УРОВЕНЬ 2: JUMP GAME (Аркада)
// ==========================================
let doodleGameLoop;
let ctx;
let canvasWidth = 320;
let canvasHeight = 480;

const imgHero = new Image(); imgHero.src = 'assets/hero.png';
const imgPlatform = new Image(); imgPlatform.src = 'assets/platform.png';
const imgSpring = new Image(); imgSpring.src = 'assets/spring.png';
const imgPropeller = new Image(); imgPropeller.src = 'assets/propeller.png';
const imgJetpack = new Image(); imgJetpack.src = 'assets/jetpack.png';
const imgPart = new Image(); imgPart.src = 'assets/part.png';

const TOTAL_ITEMS = 12;
const GRAVITY = 0.25;
const JUMP_FORCE = -9;
const MOVE_SPEED = 5;
const HERO_SIZE = 65;
const PLATFORM_WIDTH = 100;
const PLATFORM_HEIGHT = 65;
const SPRING_WIDTH = 50; const SPRING_HEIGHT = 40;
const PROPELLER_WIDTH = 60; const PROPELLER_HEIGHT = 50;
const JETPACK_WIDTH = 50; const JETPACK_HEIGHT = 60;
const SPRING_FORCE = -16;
const PROPELLER_FORCE = -25;
const JETPACK_FORCE = -45;

let platforms = [];
let items = [];
let player = { x: 0, y: 0, width: HERO_SIZE, height: HERO_SIZE, vx: 0, vy: 0, isDead: false, equipment: null };
let itemsCollected = 0;
let keys = { left: false, right: false };
let scoreEl;
let timerEl;
let gameActive = false;
let gameStartTime = 0;

function initJumper() {
    document.getElementById('doodle-container').style.display = 'block';
    const ui = document.getElementById('doodle-ui');
    ui.style.display = 'flex';
    document.getElementById('factory-gate-container').style.display = 'none';
    ui.querySelector('h2').textContent = `Собери детали`;
    document.getElementById('doodle-score').textContent = "0";
    document.getElementById('doodle-timer').textContent = "⏱ 00:00";
    const container = document.getElementById('doodle-container');
    container.classList.remove('game-running');
    document.getElementById('game-over-overlay').classList.remove('visible');
    document.getElementById('victory-overlay').classList.remove('visible');
    document.getElementById('doodle-start-msg').style.display = 'flex';
    canvasWidth = container.offsetWidth;
    canvasHeight = container.offsetHeight;
    const canvas = document.getElementById('doodle-canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx = canvas.getContext('2d');
    scoreEl = document.getElementById('doodle-score');
    timerEl = document.getElementById('doodle-timer');
    setupControls(canvas);
}

function setupControls(canvas) {
    window.onkeydown = (e) => { if (e.code === 'ArrowLeft') keys.left = true; if (e.code === 'ArrowRight') keys.right = true; };
    window.onkeyup = (e) => { if (e.code === 'ArrowLeft') keys.left = false; if (e.code === 'ArrowRight') keys.right = false; };
    canvas.addEventListener('touchstart', handleTouch, { passive: false });
    canvas.addEventListener('touchmove', handleTouch, { passive: false });
    canvas.addEventListener('touchend', (e) => { e.preventDefault(); keys.left = false; keys.right = false; });
}

function handleTouch(e) {
    e.preventDefault();
    const touchX = e.touches[0].clientX;
    const rect = e.target.getBoundingClientRect();
    if (touchX - rect.left < rect.width / 2) { keys.left = true; keys.right = false; }
    else { keys.left = false; keys.right = true; }
}

function startDoodleLoop() {
    document.getElementById('doodle-container').classList.add('game-running');
    document.getElementById('doodle-start-msg').style.display = 'none';
    document.getElementById('game-over-overlay').classList.remove('visible');
    resetGame();
    gameActive = true;
    gameStartTime = Date.now();

    // Сбрасываем время начала уровня на момент старта движения
    levelStartTime = Date.now();

    update();
}

function resetGame() {
    itemsCollected = 0;
    scoreEl.textContent = "0";
    player.x = canvasWidth / 2 - player.width / 2;
    player.y = canvasHeight - 150;
    player.vx = 0;
    player.vy = JUMP_FORCE;
    player.isDead = false;
    player.equipment = null;
    platforms = [];
    items = [];
    let currentY = canvasHeight - 60;
    platforms.push({ x: canvasWidth / 2 - PLATFORM_WIDTH / 2, y: currentY, width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT, type: 'normal', bonus: null });
    for (let i = 0; i < 7; i++) {
        let gap = 110 + Math.random() * 40;
        currentY -= gap;
        generatePlatformAt(currentY);
    }
}

function generatePlatformAt(yPos) {
    const width = PLATFORM_WIDTH;
    const x = Math.random() * (canvasWidth - width);
    let bonusType = null;
    let spawnItem = false;
    const rand = Math.random();
    if (rand < 0.09) bonusType = 'jetpack';
    else if (rand < 0.11) bonusType = 'propeller';
    else if (rand < 0.13) bonusType = 'spring';
    else { if (Math.random() < 0.15) spawnItem = true; }
    platforms.push({ x, y: yPos, width, height: PLATFORM_HEIGHT, bonus: bonusType });
    if (spawnItem) items.push({ x: x + width / 2, y: yPos - 40, collected: false });
}

function update() {
    if (!gameActive) return;
    const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    timerEl.textContent = `⏱ ${minutes}:${seconds}`;

    if (keys.left) player.vx = -MOVE_SPEED; else if (keys.right) player.vx = MOVE_SPEED; else player.vx = 0;
    player.x += player.vx; player.vy += GRAVITY; player.y += player.vy;
    if (player.x + player.width < 0) player.x = canvasWidth;
    if (player.x > canvasWidth) player.x = -player.width;
    if (player.y < canvasHeight * 0.45 && player.vy < 0) {
        player.y = canvasHeight * 0.45;
        let shift = -player.vy;
        platforms.forEach(p => p.y += shift);
        items.forEach(i => i.y += shift);
    }
    platforms.forEach((p, index) => {
        if (p.y > canvasHeight) {
            let highestY = canvasHeight;
            platforms.forEach(plat => { if (plat.y < highestY) highestY = plat.y; });
            let gap = 110 + Math.random() * 40;
            p.y = highestY - gap;
            p.x = Math.random() * (canvasWidth - p.width);
            p.bonus = null;
            let r = Math.random();
            if (r < 0.09) p.bonus = 'jetpack'; else if (r < 0.11) p.bonus = 'propeller'; else if (r < 0.13) p.bonus = 'spring';
            if (p.bonus === null && Math.random() < 0.15) items.push({ x: p.x + p.width / 2, y: p.y - 40, collected: false });
        }
    });
    items = items.filter(i => i.y < canvasHeight + 100);
    if (player.vy > 0) {
        platforms.forEach(p => {
            if (player.x + player.width * 0.7 > p.x && player.x + player.width * 0.3 < p.x + p.width && player.y + player.height > p.y && player.y + player.height < p.y + p.height + player.vy + 2) {
                if (p.bonus === 'spring') player.vy = SPRING_FORCE;
                else if (p.bonus === 'propeller') { player.vy = PROPELLER_FORCE; player.equipment = 'propeller'; }
                else if (p.bonus === 'jetpack') { player.vy = JETPACK_FORCE; player.equipment = 'jetpack'; }
                else { player.vy = JUMP_FORCE; if (player.equipment && player.vy > -10) player.equipment = null; }
            }
        });
    }
    if (player.vy > 0) player.equipment = null;
    items.forEach(item => {
        if (!item.collected) {
            let dx = (player.x + player.width / 2) - item.x;
            let dy = (player.y + player.height / 2) - item.y;
            if (Math.sqrt(dx * dx + dy * dy) < 60) {
                item.collected = true;
                itemsCollected++;
                scoreEl.textContent = itemsCollected;
                scoreEl.style.transform = "scale(1.5)";
                setTimeout(() => scoreEl.style.transform = "scale(1)", 200);
                if (itemsCollected >= TOTAL_ITEMS) showVictoryLevel2();
            }
        }
    });
    if (player.y > canvasHeight) { showGameOver(); return; }
    draw();
    if (gameActive) doodleGameLoop = requestAnimationFrame(update);
}

function draw() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    platforms.forEach(p => {
        if (imgPlatform.complete && imgPlatform.naturalWidth !== 0) ctx.drawImage(imgPlatform, p.x, p.y, p.width, p.height);
        else { ctx.fillStyle = '#27ae60'; ctx.fillRect(p.x, p.y, p.width, p.height); }
        if (p.bonus === 'spring') { const bx = p.x + (PLATFORM_WIDTH - SPRING_WIDTH) / 2; const by = p.y - SPRING_HEIGHT + 15; drawBonus(imgSpring, bx, by, SPRING_WIDTH, SPRING_HEIGHT); }
        else if (p.bonus === 'propeller') { const bx = p.x + (PLATFORM_WIDTH - PROPELLER_WIDTH) / 2; const by = p.y - PROPELLER_HEIGHT + 10; drawBonus(imgPropeller, bx, by, PROPELLER_WIDTH, PROPELLER_HEIGHT); }
        else if (p.bonus === 'jetpack') { const bx = p.x + (PLATFORM_WIDTH - JETPACK_WIDTH) / 2; const by = p.y - JETPACK_HEIGHT + 10; drawBonus(imgJetpack, bx, by, JETPACK_WIDTH, JETPACK_HEIGHT); }
    });
    items.forEach(item => {
        if (item.collected) return;
        if (imgPart.complete && imgPart.naturalWidth !== 0) ctx.drawImage(imgPart, item.x - 30, item.y - 30, 60, 60);
        else { ctx.beginPath(); ctx.arc(item.x, item.y, 20, 0, Math.PI * 2); ctx.fillStyle = '#3498db'; ctx.fill(); }
    });
    if (imgHero.complete) {
        if (player.equipment === 'jetpack') {
            ctx.drawImage(imgJetpack, player.x - 15, player.y + 15, 40, 50); ctx.drawImage(imgJetpack, player.x + player.width - 20, player.y + 15, 40, 50);
            ctx.fillStyle = 'orange'; ctx.beginPath(); ctx.moveTo(player.x, player.y + 60); ctx.lineTo(player.x + 10, player.y + 90); ctx.lineTo(player.x + 20, player.y + 60); ctx.fill();
        }
        ctx.drawImage(imgHero, player.x, player.y, player.width, player.height);
        if (player.equipment === 'propeller') ctx.drawImage(imgPropeller, player.x + 10, player.y - 35, 60, 50);
    } else { ctx.fillStyle = '#e67e22'; ctx.fillRect(player.x, player.y, player.width, player.height); }
}

function drawBonus(img, x, y, w, h) { if (img.complete && img.naturalWidth !== 0) ctx.drawImage(img, x, y, w, h); else { ctx.fillStyle = 'red'; ctx.fillRect(x, y, w, h); } }
function showGameOver() { gameActive = false; cancelAnimationFrame(doodleGameLoop); document.getElementById('game-over-overlay').classList.add('visible'); }

function showVictoryLevel2() {
    gameActive = false;
    cancelAnimationFrame(doodleGameLoop);

    // == ПОДСЧЕТ ОЧКОВ (УРОВЕНЬ 2) ==
    let timeSpent = (Date.now() - levelStartTime) / 1000;
    // Макс 1500, минус 5 очков/сек
    levelScores[2] = Math.max(100, Math.floor(1500 - timeSpent * 5));

    document.getElementById('victory-overlay').classList.add('visible');
    setTimeout(() => { document.getElementById('victory-overlay').classList.remove('visible'); finishLevel2(); }, 2000);
}

function finishLevel2() {
    document.getElementById('doodle-container').style.display = 'none';
    document.getElementById('doodle-ui').style.display = 'none';
    const gateContainer = document.getElementById('factory-gate-container');
    gateContainer.style.display = 'block';
    setTimeout(() => {
        gateContainer.classList.add('lights-on');
        setTimeout(() => {
            const btn = document.getElementById('btn-next-3');
            if(btn) { btn.classList.remove('hidden'); btn.onclick = () => startGame(3); }
        }, 1000);
    }, 100);
}

// ==========================================
// УРОВЕНЬ 3: 2048
// ==========================================
const SIZE = 4;
let board2048 = [];
let score2048 = 0;
let game2048Active = false;

function init2048() {
    score2048 = 0;
    game2048Active = true;
    document.getElementById('score-2048').textContent = '0';
    document.getElementById('btn-next-4').classList.add('hidden');
    document.getElementById('overlay-2048-gameover').classList.remove('visible');
    document.getElementById('overlay-2048-victory').classList.remove('visible');

    const container = document.getElementById('grid-container');
    container.innerHTML = '';

    for(let i=0; i<SIZE*SIZE; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        const r = Math.floor(i/SIZE);
        const c = i%SIZE;
        cell.style.top = (10 + r * 72.5) + 'px';
        cell.style.left = (10 + c * 72.5) + 'px';
        container.appendChild(cell);
    }

    board2048 = Array(SIZE).fill().map(() => Array(SIZE).fill(null));
    addRandomTile();
    addRandomTile();
    setupSwipeListeners();
    document.onkeydown = handle2048Input;

    // Засекаем время старта 2048
    levelStartTime = Date.now();
}

function addRandomTile() {
    let emptyCells = [];
    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            if(board2048[r][c] === null) emptyCells.push({r, c});
        }
    }
    if(emptyCells.length > 0) {
        let rand = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        let val = Math.random() < 0.9 ? 2 : 4;
        createTile(rand.r, rand.c, val);
    }
}

function createTile(r, c, val) {
    const container = document.getElementById('grid-container');
    const tileDom = document.createElement('div');
    tileDom.className = `tile tile-${val} tile-new`;
    tileDom.style.top = (10 + r * 72.5) + 'px';
    tileDom.style.left = (10 + c * 72.5) + 'px';
    container.appendChild(tileDom);
    board2048[r][c] = { val: val, dom: tileDom, merged: false };
}

function handle2048Input(e) {
    if(!game2048Active) return;
    if(e.code === 'ArrowUp') moveTiles(-1, 0);
    else if(e.code === 'ArrowDown') moveTiles(1, 0);
    else if(e.code === 'ArrowLeft') moveTiles(0, -1);
    else if(e.code === 'ArrowRight') moveTiles(0, 1);
}

function moveTiles(dr, dc) {
    let moved = false;
    for(let r=0; r<SIZE; r++)
        for(let c=0; c<SIZE; c++)
            if(board2048[r][c]) board2048[r][c].merged = false;

    let rStart = dr === 1 ? SIZE - 1 : 0;
    let rEnd = dr === 1 ? -1 : SIZE;
    let rStep = dr === 1 ? -1 : 1;
    let cStart = dc === 1 ? SIZE - 1 : 0;
    let cEnd = dc === 1 ? -1 : SIZE;
    let cStep = dc === 1 ? -1 : 1;

    for (let r = rStart; r !== rEnd; r += rStep) {
        for (let c = cStart; c !== cEnd; c += cStep) {
            let tile = board2048[r][c];
            if (!tile) continue;

            let nextR = r + dr;
            let nextC = c + dc;
            let targetR = r;
            let targetC = c;

            while(nextR >= 0 && nextR < SIZE && nextC >= 0 && nextC < SIZE) {
                let nextTile = board2048[nextR][nextC];
                if (!nextTile) {
                    targetR = nextR; targetC = nextC;
                } else if (nextTile.val === tile.val && !nextTile.merged) {
                    targetR = nextR; targetC = nextC;
                    break;
                } else { break; }
                nextR += dr; nextC += dc;
            }

            if (targetR !== r || targetC !== c) {
                let targetTile = board2048[targetR][targetC];
                if (!targetTile) {
                    board2048[r][c] = null;
                    board2048[targetR][targetC] = tile;
                    updateTilePosition(tile, targetR, targetC);
                    moved = true;
                } else if (targetTile.val === tile.val) {
                    board2048[r][c] = null;
                    updateTilePosition(tile, targetR, targetC);
                    targetTile.val *= 2;
                    targetTile.merged = true;
                    score2048 += targetTile.val;
                    document.getElementById('score-2048').textContent = score2048;
                    setTimeout(() => {
                        if(tile.dom.parentNode) tile.dom.remove();
                        targetTile.dom.className = `tile tile-${targetTile.val} tile-merged`;
                    }, 150);
                    moved = true;
                }
            }
        }
    }

    if (moved) {
        setTimeout(() => {
            addRandomTile();
            check2048Status();
        }, 150);
    } else {
        check2048Status();
    }
}

function updateTilePosition(tile, r, c) {
    tile.dom.style.top = (10 + r * 72.5) + 'px';
    tile.dom.style.left = (10 + c * 72.5) + 'px';
}

function check2048Status() {
    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            if(board2048[r][c] && board2048[r][c].val >= 256 && game2048Active) {
                showVictory2048();
                return;
            }
        }
    }
    let hasEmpty = false;
    let canMerge = false;
    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            if(board2048[r][c] === null) {
                hasEmpty = true;
                break;
            }
            let val = board2048[r][c].val;
            if(c < SIZE-1 && board2048[r][c+1] && board2048[r][c+1].val === val) canMerge = true;
            if(r < SIZE-1 && board2048[r+1][c] && board2048[r+1][c].val === val) canMerge = true;
        }
    }

    if(!hasEmpty && !canMerge) {
        showGameOver2048();
    }
}

function showVictory2048() {
    game2048Active = false;

    // == ПОДСЧЕТ ОЧКОВ (УРОВЕНЬ 3) ==
    let timeSpent = (Date.now() - levelStartTime) / 1000;
    // Макс 2000, минус 2 очка/сек
    levelScores[3] = Math.max(100, Math.floor(2000 - timeSpent * 2));

    document.getElementById('overlay-2048-victory').classList.add('visible');
    setTimeout(() => {
        document.getElementById('overlay-2048-victory').classList.remove('visible');
        document.getElementById('btn-next-4').classList.remove('hidden');
    }, 2000);
}

function showGameOver2048() {
    game2048Active = false;
    document.getElementById('overlay-2048-gameover').classList.add('visible');
}

function setupSwipeListeners() {
    let touchStartX = 0;
    let touchStartY = 0;
    const grid = document.getElementById('grid-container');

    grid.addEventListener('touchstart', function(e) {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
        e.preventDefault();
    }, {passive: false});

    grid.addEventListener('touchend', function(e) {
        e.preventDefault();
        let touchEndX = e.changedTouches[0].screenX;
        let touchEndY = e.changedTouches[0].screenY;
        let dx = touchEndX - touchStartX;
        let dy = touchEndY - touchStartY;
        if(Math.abs(dx) > Math.abs(dy)) {
            if(Math.abs(dx) > 30) dx > 0 ? moveTiles(0, 1) : moveTiles(0, -1);
        } else {
            if(Math.abs(dy) > 30) dy > 0 ? moveTiles(1, 0) : moveTiles(-1, 0);
        }
    }, {passive: false});
}


// ==========================================
// УРОВЕНЬ 4: КВИЗ
// ==========================================
const questions = [
    { q: "Что является символом безопасности на заводе?", answers: ["Кепка", "Каска", "Панамка"], correct: 1 },
    { q: "Что производит Арзамасский приборостроительный завод?", answers: ["Булочки", "Игрушки", "Сложные приборы"], correct: 2 },
    { q: "Какого цвета кнопка аварийной остановки?", answers: ["Красная", "Зеленая", "Синяя"], correct: 0 },
    { q: "Кто управляет современным станком ЧПУ?", answers: ["Робот", "Оператор", "Директор"], correct: 1 },
    { q: "Где находится завод АПЗ?", answers: ["г. Арзамас", "г. Москва", "на Луне"], correct: 0 },
    { q: "Чем измеряют размер детали с высокой точностью?", answers: ["Линейкой", "На глаз", "Штангенциркулем"], correct: 2 },
    { q: "Кто разрабатывает чертежи новых приборов?", answers: ["Повар", "Инженер-конструктор", "Водитель"], correct: 1 },
    { q: "Что делает конвейер на заводе?", answers: ["Танцует", "Перемещает детали", "Поет песни"], correct: 1 },
    { q: "Зачем на заводе нужны защитные очки?", answers: ["Для красоты", "Беречь глаза", "Чтобы лучше видеть"], correct: 1 },
    { q: "Как называется 3D-чертёж на компьютере?", answers: ["Модель", "Рисунок", "Картина"], correct: 0 }
];

let currentQuestionIndex = 0;
let questionStartTime = 0;

function initQuiz() {
    currentQuestionIndex = 0;
    levelScores[4] = 0;
    renderQuestion();
}

function renderQuestion() {
    const qData = questions[currentQuestionIndex];
    document.getElementById('question-text').textContent = qData.q;
    document.getElementById('quiz-progress').textContent = `Вопрос ${currentQuestionIndex + 1} из ${questions.length}`;
    const container = document.getElementById('answers-block');
    container.innerHTML = '';

    questionStartTime = Date.now(); // Засекаем время на вопрос

    qData.answers.forEach((answerText, index) => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.textContent = answerText;
        btn.onclick = () => handleAnswerClick(btn, index, qData.correct);
        container.appendChild(btn);
    });
}

let isAnswering = false;

function handleAnswerClick(btn, index, correctIndex) {
    if (isAnswering) return;
    isAnswering = true;

    // Расчет очков за вопрос
    let timeSpent = (Date.now() - questionStartTime) / 1000;

    if (index === correctIndex) {
        btn.classList.add('correct');
        btn.innerHTML += ' ✅';
        // 200 база + бонус за скорость (макс 100)
        let speedBonus = Math.max(0, 100 - timeSpent * 10);
        levelScores[4] += (200 + Math.floor(speedBonus));
    } else {
        btn.classList.add('wrong');
        btn.innerHTML += ' ❌';
        const buttons = document.querySelectorAll('.answer-btn');
        buttons[correctIndex].classList.add('correct');
    }

    setTimeout(() => {
        isAnswering = false;
        currentQuestionIndex++;
        if (currentQuestionIndex < questions.length) renderQuestion();
        else showFinalScreen();
    }, 1500);
}

function showFinalScreen() {
    document.getElementById('screen-level4').classList.remove('active');
    document.getElementById('screen-final').classList.add('active');

    // Заполняем таблицу
    document.getElementById('res-l1').textContent = levelScores[1];
    document.getElementById('res-l2').textContent = levelScores[2];
    document.getElementById('res-l3').textContent = levelScores[3];
    document.getElementById('res-l4').textContent = levelScores[4];

    // Итого
    let totalScore = levelScores[1] + levelScores[2] + levelScores[3] + levelScores[4];

    // Анимация итогового счета
    const scoreVal = document.getElementById('final-score-val');
    let displayScore = 0;
    const step = Math.ceil(totalScore / 50);

    const timer = setInterval(() => {
        displayScore += step;
        if (displayScore >= totalScore) {
            displayScore = totalScore;
            clearInterval(timer);
        }
        scoreVal.textContent = displayScore;
    }, 30);
}

// === ФИНАЛ: ОТПРАВКА ДАННЫХ ===
function closeApp() {
    // Отправляем общую сумму
    let totalScore = levelScores[1] + levelScores[2] + levelScores[3] + levelScores[4];
    tg.sendData(JSON.stringify({score: totalScore}));
    tg.close();
}