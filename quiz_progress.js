/* Quizora progress views: local records only, no external chart dependency. */
(() => {
  'use strict';
  const DAY=86400000, $=id=>document.getElementById(id);
  const n=value=>Math.max(0,Math.floor(Number(value)||0));
  const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dayKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t)).reduce((a,p)=>{if(['year','month','day'].includes(p.type))a[p.type]=p.value;return a;},{});
  function dateKey(t){const p=dayKey(t);return `${p.year}-${p.month}-${p.day}`;}
  const pct=value=>`${Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`;
  const num=value=>n(value).toLocaleString('ru-RU');
  function duration(seconds){const s=n(seconds);if(s<60)return `${s} сек`;const m=Math.floor(s/60);return m<60?`${m} мин`:`${Math.floor(m/60)} ч ${m%60} мин`;}
  function summarize(records,period='all',now=Date.now()) {
    const today=Date.parse(dateKey(now)+'T00:00:00+05:00');
    const start=period==='all'?-Infinity:today-(Number(period)-1)*DAY;
    const byId=new Map();
    (records||[]).forEach(x=>{
      if(!x?.id || !Number.isFinite(Number(x.finishedAt)) || Number(x.finishedAt)>now+120000)return;
      const answered=n(x.answeredQuestions),score=Math.min(answered,n(x.score));if(!answered)return;
      const timeout=Math.min(answered-score,n(x.timeoutCount));
      const clean={...x,answeredQuestions:answered,score,timeoutCount:timeout,incorrectCount:answered-score-timeout,plannedQuestions:Math.max(answered,n(x.plannedQuestions)),durationSeconds:n(x.durationSeconds),finishedAt:Number(x.finishedAt)};
      if(!byId.has(x.id)||byId.get(x.id).finishedAt<=clean.finishedAt)byId.set(x.id,clean);
    });
    const entries=Array.from(byId.values()).filter(x=>x.finishedAt>=start).sort((a,b)=>a.finishedAt-b.finishedAt);
    const out={entries,attempts:entries.length,answered:0,correct:0,wrong:0,timeout:0,skipped:0,seconds:0,completed:0,early:0,interrupted:0,modes:[]};
    const completed=x=>x.completionType!=='tab_closed'&&x.stopReason!=='tab_closed'&&x.answeredQuestions>=x.plannedQuestions;
    for(const e of entries){out.answered+=e.answeredQuestions;out.correct+=e.score;out.wrong+=e.incorrectCount;out.timeout+=e.timeoutCount;out.skipped+=e.plannedQuestions-e.answeredQuestions;out.seconds+=e.durationSeconds;
      if(completed(e))out.completed++;else if(e.completionType==='tab_closed'||e.stopReason==='tab_closed')out.interrupted++;else out.early++;
    }
    out.accuracy=out.answered?out.correct/out.answered*100:0;out.averageSeconds=out.answered?out.seconds/out.answered:0;
    out.best=entries.length?[...entries].sort((a,b)=>b.score/b.answeredQuestions-a.score/a.answeredQuestions||b.score-a.score||a.durationSeconds-b.durationSeconds)[0]:null;
    out.activity=Array.from({length:7},(_,i)=>{const t=today-(6-i)*DAY,key=dateKey(t),items=entries.filter(x=>dateKey(x.finishedAt)===key);return{key,date:t,answered:items.reduce((sum,x)=>sum+x.answeredQuestions,0),attempts:items.length};});
    out.recent=entries.slice(-12).map(x=>({...x,accuracy:x.score/x.answeredQuestions*100}));
    out.activeDays=new Set(entries.map(x=>dateKey(x.finishedAt))).size;
    const labels={regular:'Обычный',speed:'На скорость',untimed:'Без времени'};
    out.modes=Object.entries(labels).map(([id,label])=>{const items=entries.filter(x=>(x.testMode||'regular')===id),answered=items.reduce((a,x)=>a+x.answeredQuestions,0),correct=items.reduce((a,x)=>a+x.score,0);return{id,label,attempts:items.length,answered,accuracy:answered?correct/answered*100:0};});
    return out;
  }
  function metric(value,label){return `<div class="qp-metric"><strong>${value}</strong><span>${label}</span></div>`;}
  function trendChart(items){
    if(!items.length)return '<div class="qp-no-chart">Здесь появится динамика результатов</div>';
    const points=items.map((x,i)=>({x:items.length===1?280:16+i*528/(items.length-1),y:178-x.accuracy*1.56,item:x}));
    const line=points.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const dates=items.map(x=>new Date(x.finishedAt).toLocaleDateString('ru-RU',{timeZone:'Asia/Tashkent',day:'numeric',month:'short'}));
    const desc=items.map((x,i)=>`Тест ${i+1}: ${x.score} из ${x.answeredQuestions}, ${pct(x.accuracy)}`).join('; ');
    return `<div class="qp-trend"><div class="qp-axis"><span>100%</span><span>50%</span><span>0%</span></div><div class="qp-plot"><svg viewBox="0 0 560 200" preserveAspectRatio="none" role="img" aria-label="Динамика последних ${items.length} тестов"><title>${esc(desc)}</title><path d="M0 22 H560 M0 100 H560 M0 178 H560" stroke="currentColor" class="qp-gridlines" fill="none"/>${items.length>1?`<polygon points="${points[0].x},178 ${line} ${points.at(-1).x},178" fill="#7566ed" fill-opacity=".08"/><polyline points="${line}" fill="none" stroke="#7566ed" stroke-width="3.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`:''}${points.map((p,i)=>`<circle cx="${p.x}" cy="${p.y}" r="5.5" fill="#7566ed" tabindex="0"><title>${esc(dates[i]+': '+p.item.score+'/'+p.item.answeredQuestions+' · '+pct(p.item.accuracy))}</title></circle>`).join('')}</svg><div class="qp-chart-dates"><span>${esc(dates[0])}</span><span>${items.length>1?esc(dates.at(-1)):pct(items[0].accuracy)}</span></div></div></div>`;
  }
  function activityChart(days){const max=Math.max(1,...days.map(x=>x.answered));return `<div class="qp-activity" role="img" aria-label="${esc(days.map(x=>`${x.key}: ${x.answered} ответов`).join('; '))}">${days.map(x=>`<div class="qp-day"><strong>${num(x.answered)}</strong><div class="qp-day-track"><i style="height:${x.answered?Math.max(4,x.answered/max*100):0}%"></i></div><span>${new Date(x.date).toLocaleDateString('ru-RU',{weekday:'short',timeZone:'Asia/Tashkent'})}</span></div>`).join('')}</div>`;}
  let period='all',achievementFilter='all';
  function renderStats(container){
    const source=window.QuizoraData;if(!container||!source)return;
    const data=source.read(),stats=summarize(data.entries,period),progress=data.progress || {studiedCount:0,totalCount:296,percent:0};
    container.innerHTML=`<div class="qp-filters" aria-label="Период статистики">${[['7','Неделя'],['30','Месяц'],['all','Всё время']].map(([id,label])=>`<button type="button" data-qp-period="${id}" class="${period===id?'active':''}" aria-pressed="${period===id}">${label}</button>`).join('')}</div>
    <div class="qp-metrics">${metric(stats.attempts?pct(stats.accuracy):'—','Точность')}${metric(num(stats.attempts),'Попыток')}${metric(num(stats.answered),'Ответов')}${metric(stats.seconds>=3600?(stats.seconds/3600).toLocaleString('ru-RU',{maximumFractionDigits:1})+' ч':duration(stats.seconds),'В тестах')}</div>
    ${!stats.attempts?'<div class="qp-empty">Пока нет результатов за этот период. Завершите тест, и здесь появится ваш прогресс.</div>':''}
    <section class="qp-card"><div class="qp-card-head"><h3>Динамика</h3><span>Последние ${stats.recent.length || 0} тестов</span></div>${trendChart(stats.recent)}</section>
    <section class="qp-card"><h3>Ответы за неделю</h3>${activityChart(stats.activity)}</section>
    <div class="qp-two"><section class="qp-card"><h3>Результаты ответов</h3><div class="qp-result-track" aria-hidden="true">${[[stats.correct,'good'],[stats.wrong,'bad'],[stats.timeout,'late']].map(([v,c])=>`<i class="${c}" style="width:${stats.answered?v/stats.answered*100:0}%"></i>`).join('')}</div><div class="qp-detail-list">${[['Верно',stats.correct,'good'],['Ошибки',stats.wrong,'bad'],['Время вышло',stats.timeout,'late'],['Не отвечено',stats.skipped,'neutral']].map(([label,v,c])=>`<div><span><i class="qp-dot ${c}"></i>${label}</span><strong>${num(v)}</strong></div>`).join('')}</div></section>
    <section class="qp-card"><h3>База вопросов</h3><div class="qp-bank-number">${num(Math.min(progress.studiedCount,progress.totalCount))}<span> / ${num(progress.totalCount)}</span></div><div class="qp-meter" role="progressbar" aria-label="Просмотрено вопросов" aria-valuenow="${Math.min(100,progress.percent||0)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100,progress.percent||0)}%"></i></div><p class="qp-note">Встречались в ваших тестах</p><div class="qp-detail-list"><div><span>Ждут повторения</span><strong>${num(data.mistakes?.remainingCount)}</strong></div><div><span>Серия дней</span><strong>${num(data.streak?.current)}</strong></div></div></section></div>
    <section class="qp-card"><h3>По режимам</h3><div class="qp-mode-list">${stats.modes.map(m=>`<div><div class="qp-mode-top"><strong>${m.label}</strong><b>${m.answered?pct(m.accuracy):'—'}</b></div><p>${num(m.attempts)} тестов · ${num(m.answered)} ответов</p><div class="qp-meter"><i style="width:${m.accuracy}%"></i></div></div>`).join('')}</div></section>
    <section class="qp-card"><h3>Подробности</h3><div class="qp-detail-list"><div><span>Завершено полностью</span><strong>${num(stats.completed)}</strong></div><div><span>Завершено досрочно</span><strong>${num(stats.early)}</strong></div><div><span>Прервано</span><strong>${num(stats.interrupted)}</strong></div><div><span>Активных дней</span><strong>${num(stats.activeDays)}</strong></div><div><span>В среднем на ответ</span><strong>${duration(Math.round(stats.averageSeconds))}</strong></div><div><span>Лучший результат</span><strong>${stats.best?stats.best.score+' / '+stats.best.answeredQuestions+' · '+pct(stats.best.score/stats.best.answeredQuestions*100):'—'}</strong></div></div></section>
    ${data.weak?.length?`<section class="qp-card"><h3>Что повторить</h3><div class="qp-weak-list">${[...data.weak].sort((a,b)=>(b.wrongCount+b.timeoutCount)-(a.wrongCount+a.timeoutCount)).slice(0,5).map(x=>`<details><summary>${esc(x.question)}</summary><p>${num((x.wrongCount||0)+(x.timeoutCount||0))} ошибок и пропусков по времени</p><div>${x.options.map((o,i)=>`<p class="${i===x.answer?'qp-answer-correct':''}">${i===x.answer?'✓ ':''}${esc(o)}</p>`).join('')}</div></details>`).join('')}</div></section>`:''}`;
    container.querySelectorAll('[data-qp-period]').forEach(b=>b.onclick=()=>{period=b.dataset.qpPeriod;renderStats(container);});
  }
  function renderAchievements(container){
    if(!container || !window.QuizoraData)return;
    const data=window.QuizoraData.achievements(),all=data.items,earned=new Set(data.snapshot.unlocked.map(x=>x.id));
    const cards=all.map(item=>({item,progress:window.QuizoraData.achievementProgress(item,data.snapshot.context),unlocked:earned.has(item.id)}));
    const visible=cards.filter(x=>achievementFilter==='all'||(achievementFilter==='earned'?x.unlocked:!x.unlocked));
    container.innerHTML=`<div class="qp-achievement-hero"><div><span>Получено</span><strong>${earned.size}<em> / ${all.length}</em></strong></div><div class="qp-award-mark">✦</div></div><div class="qp-meter qp-achievement-total"><i style="width:${all.length?earned.size/all.length*100:0}%"></i></div>
    <div class="qp-filters">${[['all','Все'],['earned','Получены'],['next','В процессе']].map(([id,label])=>`<button type="button" data-ach-filter="${id}" class="${achievementFilter===id?'active':''}" aria-pressed="${achievementFilter===id}">${label}</button>`).join('')}</div>
    <div class="qp-awards">${visible.map(({item,progress,unlocked})=>`<article class="qp-award ${unlocked?'earned':''}"><span class="qp-award-icon" aria-hidden="true">${esc(item.icon)}</span><div><div class="qp-award-title"><h3>${esc(item.title)}</h3>${unlocked?'<span aria-label="Получено">✓</span>':''}</div><p>${esc(item.description)}</p><div class="qp-award-progress">${unlocked?'Получено':esc(progress.label)}</div><div class="qp-meter" role="progressbar" aria-label="${esc(item.title)}" aria-valuenow="${unlocked?100:progress.percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${unlocked?100:progress.percent}%"></i></div></div></article>`).join('')||'<div class="qp-empty">Здесь пока пусто. Продолжайте решать тесты.</div>'}</div>`;
    container.querySelectorAll('[data-ach-filter]').forEach(b=>b.onclick=()=>{achievementFilter=b.dataset.achFilter;renderAchievements(container);});
  }
  window.QuizoraProgress={summarize,dateKey,renderStats,renderAchievements};
  ['stats-modal','achievements-modal'].forEach(id=>{const modal=$(id);if(!modal)return;modal.classList.add('qp-modal');modal.querySelector('.history-subtitle')?.remove();const title=modal.querySelector('.history-title');if(title)title.textContent=id==='stats-modal'?'Статистика':'Достижения';});
})();
