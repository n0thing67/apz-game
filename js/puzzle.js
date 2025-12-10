// puzzle.js — Canvas версия пазла
export let level1Score = 0;

let canvas, ctx;
let pieces = [];
let selected = null;
let solved = false;
let startTime = 0;

export function initPuzzle() {
    solved = false;
    selected = null;
    startTime = Date.now();

    canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 300;
    ctx = canvas.getContext("2d");
    document.getElementById("screen-level1").appendChild(canvas);

    // Загружаем изображения и создаём кусочки
    pieces = [];
    for (let i = 1; i <= 9; i++) {
        const img = new Image();
        img.src = `assets/${i}.jpg`;
        pieces.push({ img, id: i, correctX: (i-1)%3, correctY: Math.floor((i-1)/3) });
    }

    shuffle(pieces);
    canvas.addEventListener("click", onClick);
    drawPuzzle();
}

function shuffle(arr) {
    for (let i = arr.length -1; i>0; i--) {
        let j = Math.floor(Math.random()* (i+1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function onClick(e) {
    if (solved) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left)/100);
    const y = Math.floor((e.clientY - rect.top)/100);

    const clicked = pieces.find(p => Math.floor(p.x) === x && Math.floor(p.y) === y);
    if (!clicked) return;

    if (!selected) {
        selected = clicked;
    } else {
        // Меняем местами
        [selected.x, clicked.x] = [clicked.x, selected.x];
        [selected.y, clicked.y] = [clicked.y, selected.y];
        selected = null;
        drawPuzzle();
        checkWin();
    }
}

function drawPuzzle() {
    ctx.clearRect(0,0,canvas.width, canvas.height);
    pieces.forEach(p => {
        if (p.x===undefined) p.x = Math.floor((pieces.indexOf(p))%3);
        if (p.y===undefined) p.y = Math.floor((pieces.indexOf(p))/3);
        ctx.drawImage(p.img, p.x*100, p.y*100, 100,100);
        if (selected===p) {
            ctx.strokeStyle = "red";
            ctx.lineWidth = 3;
            ctx.strokeRect(p.x*100,p.y*100,100,100);
        }
    });
}

function checkWin() {
    const won = pieces.every(p => p.x===p.correctX && p.y===p.correctY);
    if (won) {
        solved = true;
        let time = (Date.now() - startTime)/1000;
        level1Score = Math.max(100, Math.floor(1000 - 5*time));
        document.getElementById("btn-next-2").classList.remove("hidden");
    }
}
