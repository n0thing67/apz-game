// game2048.js — Canvas 2048 с кешом изображений и высокой производительностью
export let level3Score = 0;

const SIZE = 4;
const TILE_SIZE = 70;

let canvas, ctx;
let grid = [];
let active = false;
let startTime = 0;
let needsRedraw = true;

const tileMap = {
  2: 'bolt.png',
  4: 'nut.png',
  8: 'gear.png',
  16: 'chip.png',
  32: 'board.png',
  64: 'case.png',
  128: 'sensor.png',
  256: 'device.png'
};

const tileImages = {};
const cacheTiles = {};

// === Предзагрузка изображений и кеширование offscreen Canvas ===
function preloadTiles(callback) {
  let loadedCount = 0;
  const keys = Object.keys(tileMap);

  keys.forEach(val => {
    const img = new Image();
    img.src = 'assets/' + tileMap[val];
    tileImages[val] = img;

    const c = document.createElement('canvas');
    c.width = TILE_SIZE;
    c.height = TILE_SIZE;
    const ctxc = c.getContext('2d');

    img.onload = () => {
      ctxc.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
      cacheTiles[val] = c;
      loadedCount++;
      if (loadedCount === keys.length && callback) callback();
    };
  });
}

// === Инициализация Canvas и сетки ===
export function init2048() {
  const container = document.getElementById('screen-level3');
  if (!container) return;

  container.innerHTML = ''; // очистка
  canvas = document.createElement('canvas');
  canvas.width = SIZE * TILE_SIZE;
  canvas.height = SIZE * TILE_SIZE;
  container.appendChild(canvas);

  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false; // ускорение рендеринга

  grid = Array(SIZE).fill().map(() => Array(SIZE).fill(null));
  spawnTile();
  spawnTile();

  active = true;
  startTime = Date.now();
  needsRedraw = true;

  document.addEventListener('keydown', handleInput);
  canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: true });

  gameLoop();
}

// === Спавн плитки ===
function spawnTile() {
  const empty = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (!grid[r][c]) empty.push({ r, c });

  if (empty.length === 0) return;

  const { r, c } = empty[Math.floor(Math.random() * empty.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  needsRedraw = true;
}

// === Управление ===
let isMoving = false;

function handleInput(e) {
  if (!active || isMoving) return;
  let moved = false;
  switch(e.key){
    case 'ArrowUp': moved = move('up'); break;
    case 'ArrowDown': moved = move('down'); break;
    case 'ArrowLeft': moved = move('left'); break;
    case 'ArrowRight': moved = move('right'); break;
  }
  if(moved) afterMove();
}

let touchStartX=0, touchStartY=0;
const SWIPE_THRESHOLD = 30;

function handleTouchStart(e){ touchStartX=e.touches[0].clientX; touchStartY=e.touches[0].clientY; }
function handleTouchEnd(e){
  if(!active || isMoving) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if(Math.abs(dx)<SWIPE_THRESHOLD && Math.abs(dy)<SWIPE_THRESHOLD) return;

  let moved = false;
  if(Math.abs(dx)>Math.abs(dy)) moved = move(dx>0?'right':'left');
  else moved = move(dy>0?'down':'up');

  if(moved) afterMove();
}

// === После хода ===
function afterMove() {
  isMoving = true;
  spawnTile();
  checkWin();
  setTimeout(()=>{ isMoving=false; }, 50);
}

// === Логика движения и слияния плиток ===
function move(dir) {
  let moved = false;
  const merged = Array(SIZE).fill().map(() => Array(SIZE).fill(false));

  function slideLine(line) {
    let arr = line.filter(v => v!==null);
    for(let i=0;i<arr.length-1;i++){
      if(arr[i]===arr[i+1] && !merged[i][0]){
        arr[i]*=2;
        arr[i+1]=null;
        merged[i][0]=true;
        level3Score+=arr[i];
      }
    }
    arr = arr.filter(v=>v!==null);
    while(arr.length<SIZE) arr.push(null);
    return arr;
  }

  switch(dir){
    case 'left':
      for(let r=0;r<SIZE;r++){
        const old=[...grid[r]];
        grid[r]=slideLine(grid[r]);
        if(!moved && grid[r].some((v,i)=>v!==old[i])) moved=true;
      }
      break;
    case 'right':
      for(let r=0;r<SIZE;r++){
        const old=[...grid[r]];
        grid[r]=slideLine([...grid[r]].reverse()).reverse();
        if(!moved && grid[r].some((v,i)=>v!==old[i])) moved=true;
      }
      break;
    case 'up':
      for(let c=0;c<SIZE;c++){
        let line=[];
        for(let r=0;r<SIZE;r++) line.push(grid[r][c]);
        const old=[...line];
        line=slideLine(line);
        for(let r=0;r<SIZE;r++) grid[r][c]=line[r];
        if(!moved && line.some((v,i)=>v!==old[i])) moved=true;
      }
      break;
    case 'down':
      for(let c=0;c<SIZE;c++){
        let line=[];
        for(let r=0;r<SIZE;r++) line.push(grid[r][c]);
        const old=[...line];
        line=slideLine(line.reverse()).reverse();
        for(let r=0;r<SIZE;r++) grid[r][c]=line[r];
        if(!moved && line.some((v,i)=>v!==old[i])) moved=true;
      }
      break;
  }

  needsRedraw = moved;
  return moved;
}

// === Проверка победы ===
function checkWin(){
  for(let r=0;r<SIZE;r++)
    for(let c=0;c<SIZE;c++)
      if(grid[r][c]===256){
        active=false;
        document.getElementById("btn-next-4")?.classList.remove("hidden");
        return;
      }
}

// === Рисование сетки и плиток ===
function drawGrid(){
  if(!ctx) return;

  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#bbada0';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  for(let r=0;r<SIZE;r++){
    for(let c=0;c<SIZE;c++){
      const val = grid[r][c];
      if(val && cacheTiles[val]){
        ctx.drawImage(cacheTiles[val], c*TILE_SIZE, r*TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

// === Игровой цикл ===
function gameLoop(){
  if(needsRedraw) {
    drawGrid();
    needsRedraw=false;
  }
  requestAnimationFrame(gameLoop);
}

// === Запуск после загрузки изображений ===
preloadTiles(()=>{
  console.log("2048 Tiles preloaded");
});
gameLoop();
