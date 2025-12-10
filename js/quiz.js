// quiz.js — лёгкий Canvas-квиз
export let level4Score=0;
let questions=[
    {q:"На каком заводе игра?", a:["АПЗ","ГАЗ","ЗиЛ","Ростсельмаш"], correct:0},
    {q:"Сколько уровней?", a:["2","3","4","5"], correct:2},
    {q:"Финальная цель?", a:["Угадать код","Собрать прибор","Пройти викторину","Прыгать"], correct:1}
];
let index=0, score=0;

export function initQuiz(){
    index=0; score=0;
    showQuestion();
}

function showQuestion(){
    document.getElementById("quiz-progress").textContent=`Вопрос ${index+1} из ${questions.length}`;
    document.getElementById("question-text").textContent=questions[index].q;
    const block=document.getElementById("answers-block");
    block.innerHTML="";
    questions[index].a.forEach((ans,i)=>{
        let div=document.createElement("div");
        div.className="answer";
        div.textContent=ans;
        div.onclick=()=>check(i);
        block.appendChild(div);
    });
}

function check(i){
    if(i===questions[index].correct) score++;
    index++;
    if(index>=questions.length) finish();
    else showQuestion();
}

function finish(){
    level4Score=score*200;
    document.getElementById("res-l4").textContent=level4Score;
    window.levelScores=window.levelScores||{};
    window.levelScores[4]=level4Score;
    document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
    document.getElementById("screen-final").classList.add("active");
}
