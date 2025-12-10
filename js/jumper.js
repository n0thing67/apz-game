// jumper.js — Canvas Джампер
export let level2Score = 0;

let canvas, ctx, W, H;
let player, platforms, parts, collected;
let running=false, startTime=0;

const heroImg = new Image(); heroImg.src = "assets/hero.png";
const platImg = new Image(); platImg.src = "assets/platform.png";
const partImg = new Image(); partImg.src = "assets/part.png";

export function initJumper() {
    canvas = document.createElement("canvas");
    canvas.id = "jumper-canvas";
    document.getElementById("screen-level2").appendChild(canvas);
    ctx = canvas.getContext("2d");

    resize();
    window.addEventListener("resize", resize);
    resetGame();
    canvas.addEventListener("touchstart", startGame);
}

function resize() {
    const box = document.getElementById("doodle-container");
    W = canvas.width = box.clientWidth;
    H = canvas.height = box.clientHeight;
}

function resetGame() {
    running=false;
    collected=0;
    platforms=[];
    parts=[];
    player={x:W/2-25, y:H-120, w:50, h:50, vy:-8};
    let y=H-40;
    for(let i=0;i<8;i++){
        platforms.push({x:Math.random()*(W-80), y});
        y-=100+Math.random()*40;
    }
}

function startGame() {
    running=true;
    startTime = Date.now();
    requestAnimationFrame(loop);
}

function loop() {
    if(!running) return;
    update();
    render();
    requestAnimationFrame(loop);
}

function update() {
    player.vy+=0.3;
    player.y+=player.vy;

    // Столкновения с платформами
    if(player.vy>0){
        platforms.forEach(p=>{
            if(player.x+player.w>p.x && player.x<p.x+80 &&
               player.y+player.h>p.y && player.y+player.h<p.y+20){
                player.vy=-10;
            }
        });
    }

    // Движение вверх
    if(player.y<H*0.4){
        let dy = H*0.4-player.y;
        player.y=H*0.4;
        platforms.forEach(p=>p.y+=dy);
        parts.forEach(pt=>pt.y+=dy);
    }

    // Удаление нижних платформ, генерация верхних
    platforms=platforms.filter(p=>p.y<H);
    while(platforms.length<8){
        let top=Math.min(...platforms.map(p=>p.y));
        let y=top-(100+Math.random()*40);
        let x=Math.random()*(W-80);
        platforms.push({x,y});
        if(Math.random()<0.2) parts.push({x:x+40, y:y-30});
    }

    // Сбор деталей
    parts=parts.filter(pt=>{
        if(Math.abs(player.x+player.w/2-pt.x)<30 && Math.abs(player.y+player.h/2-pt.y)<30){
            collected++;
            document.getElementById("doodle-score").textContent=collected;
            return false;
        }
        return true;
    });

    if(collected>=12) win();
    if(player.y>H) lose();
}

function render() {
    ctx.fillStyle="#AEE6FF";
    ctx.fillRect(0,0,W,H);
    platforms.forEach(p=>ctx.drawImage(platImg,p.x,p.y,80,20));
    parts.forEach(pt=>ctx.drawImage(partImg,pt.x-20,pt.y-20,40,40));
    ctx.drawImage(heroImg,player.x,player.y,player.w,player.h);
}

function win(){
    running=false;
    level2Score = Math.max(100, Math.floor(1500-(Date.now()-startTime)/1000*5));
    document.getElementById("victory-overlay").classList.add("visible");
    setTimeout(()=>{document.getElementById("victory-overlay").classList.remove("visible");
        document.getElementById("btn-next-3").classList.remove("hidden");},1500);
}

function lose(){
    running=false;
    document.getElementById("game-over-overlay").classList.add("visible");
}
