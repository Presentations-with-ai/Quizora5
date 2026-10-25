/* Local conversations and model preferences; isolated by verified Telegram user. */
(() => {
  'use strict';
  const validModel=id=>typeof id==='string'&&/^gemini-[a-z0-9._-]{1,100}$/i.test(id);
  function createStore(storage,uid){
    if(!/^\d+$/.test(String(uid)))throw new Error('Дождитесь проверки Telegram.');
    const slot='quizora_ai_chats_v1_'+uid;
    return {
      load(){
        const raw=storage.getItem(slot);if(!raw)return {version:1,activeId:null,model:'',chats:[]};
        const state=JSON.parse(raw);
        if(state?.version!==1||!Array.isArray(state.chats)||!state.chats.every(c=>typeof c.id==='string'&&typeof c.title==='string'&&Array.isArray(c.messages)&&Array.isArray(c.history)&&c.messages.every(m=>['user','assistant','reference'].includes(m.kind)&&typeof m.text==='string'&&Array.isArray(m.refs))))throw new Error('Не удалось прочитать историю чатов.');
        return {...state,model:validModel(state.model)?state.model:'',activeId:state.chats.some(c=>c.id===state.activeId)?state.activeId:null};
      },
      save(state){const json=JSON.stringify(state);storage.setItem(slot,json);if(storage.getItem(slot)!==json)throw new Error('История не сохранилась. Недостаточно места или данные сайта запрещены.');}
    };
  }
  function sorted(chats){return [...chats].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||Number(b.updatedAt)-Number(a.updatedAt));}
  function models(rows){
    return (Array.isArray(rows)?rows:[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')&&validModel(String(m.name||'').replace(/^models\//,''))&&!/image|audio|tts|live|robotics|computer-use|embedding/i.test(m.name)).map(m=>({id:m.name.replace(/^models\//,''),label:m.displayName||m.name.replace(/^models\//,''),description:/flash-lite/i.test(m.name)?'Лёгкая · приоритет скорости':/pro/i.test(m.name)?'Для сложных объяснений · может отвечать дольше':/flash/i.test(m.name)?'Баланс скорости и качества':'Текстовая модель Gemini'}));
  }
  window.QuizoraChatState={createStore,sorted,models,validModel};
})();
