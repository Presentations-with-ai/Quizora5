/* Quizora: static access controls. No backend and no claims of hardware attestation. */
(() => {
  'use strict';
  const DEVICE_KEY = 'quizora_device_v1';
  const COOKIE_KEY = 'quizora_device_v1';
  const ID_PATTERN = /^(?:local|tg)-[a-zA-Z0-9-]{16,128}$/;
  const PUBLIC_KEY = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';
  let sdkPromise, devicePromise, checking, lastStatus;
  let lastDeniedReport = '', periodicStarted = false;
  const api = window.QuizoraAccess = {user: null, deviceId: '', deviceIds: [], deviceModel: '', deviceSource: '', isAllowed: false, check, reportBlocked, reportEntry};

  function timeout(promise, ms, fallback) {
    return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(fallback), ms))]);
  }
  async function loadSdk() {
    if (window.Telegram?.WebApp) return window.Telegram.WebApp;
    if (!sdkPromise) sdkPromise = timeout(new Promise(resolve => {
      let script = document.querySelector('script[src*="telegram-web-app.js"]');
      if (!script) {
        script = document.createElement('script'); script.src = 'https://telegram.org/js/telegram-web-app.js';
        script.onload = () => resolve(window.Telegram?.WebApp || null);
        script.onerror = () => resolve(null); document.head.appendChild(script);
      } else {
        script.addEventListener('load', () => resolve(window.Telegram?.WebApp || null), {once:true});
        script.addEventListener('error', () => resolve(null), {once:true});
      }
    }), 6000, null);
    return sdkPromise;
  }
  function showPending() {
    if (document.getElementById('quizora-access-check')) return;
    const el = document.createElement('div'); el.id = 'quizora-access-check';
    el.innerHTML = '<div class="access-check-card"><span class="access-spinner"></span><h1>Quizora</h1><strong>Free forever</strong><p>Проверяем доступ…</p></div>';
    document.body.appendChild(el);
  }
  function hidePending() { document.getElementById('quizora-access-check')?.remove(); }
  async function readJson(name) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${name}?t=${Date.now()}`, {cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw new Error(`Не удалось загрузить ${name}`);
      return await response.json();
    } catch(error) {
      if (error.name === 'AbortError') throw new Error(`Слишком долго загружается ${name}. Проверьте подключение и повторите вход.`);
      throw error;
    } finally { clearTimeout(timer); }
  }
  function normalizeId(value) {
    const s = String(value ?? '').trim();
    return /^\d{1,16}$/.test(s) && Number(s)>0 ? s : '';
  }
  function validIds(values) {
    if (!Array.isArray(values)) throw new Error('В списке ID должен быть JSON-массив.');
    return new Set(values.map(normalizeId).filter(Boolean));
  }
  function uuid() {
    if (!crypto?.getRandomValues) throw new Error('Для Device ID требуется современный браузер.');
    return 'local-' + (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(24)), b=>b.toString(16).padStart(2,'0')).join(''));
  }
  function readCookie() {
    return document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_KEY+'='))?.slice(COOKIE_KEY.length+1) || '';
  }
  function persistId(value) {
    try { localStorage.setItem(DEVICE_KEY, value); } catch (_) {}
    document.cookie = `${COOKIE_KEY}=${value}; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
  }
  function storageGet(storage, key) {
    return timeout(new Promise(resolve => {
      try {storage.getItem(key, (err, val) => resolve(err ? '' : val || ''));} catch (_) {resolve('');}
    }), 1200, '');
  }
  async function digest(text) {
    const raw = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    return Array.from(new Uint8Array(raw), b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function collectDevice(tg) {
    if (devicePromise) return devicePromise;
    devicePromise = (async () => {
      let local = ''; try {local = localStorage.getItem(DEVICE_KEY) || '';} catch (_) {}
      const cookie = readCookie();
      let stored = '';
      if (tg?.DeviceStorage && tg.isVersionAtLeast?.('9.0')) stored = await storageGet(tg.DeviceStorage,DEVICE_KEY);
      local = [cookie, local, stored].find(x=>ID_PATTERN.test(x)) || uuid();
      persistId(local);
      if (tg?.DeviceStorage && tg.isVersionAtLeast?.('9.0')) {
        try {tg.DeviceStorage.setItem(DEVICE_KEY,local,()=>{});} catch (_) {}
      }
      let native = '';
      if (tg?.BiometricManager && tg.isVersionAtLeast?.('7.2')) {
        await timeout(new Promise(resolve => {
          try {tg.BiometricManager.init(resolve);} catch (_) {resolve();}
        }), 1500, null);
        const value = tg.BiometricManager.deviceId;
        if (value && crypto?.subtle) native = 'tg-' + await digest(String(value));
      }
      const ids = [...new Set([native, local, cookie, stored].filter(x=>ID_PATTERN.test(x)))];
      api.deviceId = native || local; api.deviceIds = ids;
      api.deviceSource = native ? 'Telegram BiometricManager.deviceId (client-reported)' : 'Persistent local ID (resettable)';
      const ua=navigator.userAgent || '';
      api.deviceModel = (/Android[^;]*;\s*([^;()]+?)\s+Build\//i.exec(ua)?.[1] || (/iPad/.test(ua)?'iPad':/iPhone/.test(ua)?'iPhone':/Windows/.test(ua)?'Windows device':/Macintosh/.test(ua)?'Mac':/Android/.test(ua)?'Android device':/Linux/.test(ua)?'Linux device':'Unknown device')).trim();
    })();
    return devicePromise;
  }
  function bytesHex(hex) { return Uint8Array.from(hex.match(/../g),x=>parseInt(x,16)); }
  function bytesBase64url(input) {
    const s=input.replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from(atob(s+'='.repeat((4-s.length%4)%4)),x=>x.charCodeAt(0));
  }
  async function verifyIdentity(tg, config) {
    const raw = tg?.initData || '';
    if (!raw) throw new Error('Откройте Quizora кнопкой приложения в Telegram.');
    const pairs = Array.from(new URLSearchParams(raw));
    if (new Set(pairs.map(x=>x[0])).size !== pairs.length) throw new Error('Некорректные данные Telegram.');
    const fields = Object.fromEntries(pairs);
    const stamp = Number(fields.auth_date), now = Date.now()/1000;
    if (!Number.isFinite(stamp) || now-stamp>86400 || stamp>now+120) throw new Error('Сессия Telegram устарела. Закройте и снова откройте приложение.');
    if (config.verifyTelegramSignature !== true) throw new Error('В app_config.json должна быть включена проверка подписи Telegram.');
    if (!/^\d+$/.test(String(config.botId || '')) || (!fields.signature && !fields.hash)) throw new Error('Telegram не передал данные подтверждения входа. Закройте и откройте приложение заново.');
    if (!crypto?.subtle) throw new Error('Проверка входа доступна по HTTPS в современном Telegram.');
    let ok = false;
    if(fields.signature) {
      try {
        const body = pairs.filter(([key])=>key!=='hash' && key!=='signature').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>`${key}=${value}`).join('\n');
        const key = await crypto.subtle.importKey('raw',bytesHex(PUBLIC_KEY),{name:'Ed25519'},false,['verify']);
        ok = await crypto.subtle.verify('Ed25519',key,bytesBase64url(fields.signature),new TextEncoder().encode(`${config.botId}:WebAppData\n${body}`));
      } catch(_) { /* Older WebViews may not support Ed25519. */ }
    }
    if(!ok && fields.hash && window.QuizoraProof?.verify) {
      try { ok = await window.QuizoraProof.verify(raw, config.botId); } catch(_) {}
    }
    if (!ok) throw new Error(`Telegram не подтвердил вход. Закройте Mini App и откройте его заново через ${config.botUsername ? '@'+config.botUsername : 'бота этого приложения'}.`);
    const user = JSON.parse(fields.user || '{}');
    if (!normalizeId(user.id)) throw new Error('Telegram не передал ID пользователя.');
    return user;
  }
  function userBan(payload, id) {
    const arrays = Array.isArray(payload) ? [payload] : [payload.bannedUserIds,payload.userIds,payload.telegramIds,payload.bannedUsers];
    for (const a of arrays) if (Array.isArray(a) && a.some(x=>normalizeId(typeof x==='object' ? x.userId || x.id || x.telegramId : x)===id && !(typeof x==='object' && (x.active===false || x.enabled===false || x.blocked===false)))) return 'Аккаунт заблокирован администратором.';
    const record = payload.users?.[id];
    if (record && record.active!==false && record.enabled!==false && record.blocked!==false) return record.reason || 'Аккаунт заблокирован администратором.';
    return '';
  }
  function deviceBan(payload) {
    if (!payload || typeof payload!=='object') throw new Error('Некорректный файл банов устройств.');
    for (const id of api.deviceIds) {
      if (Array.isArray(payload.bannedDeviceIds) && payload.bannedDeviceIds.includes(id)) return 'Устройство заблокировано администратором.';
      const r=payload.devices?.[id];
      if (r && r.active!==false && r.blocked!==false) return r.reason || 'Устройство заблокировано администратором.';
    }
    if (Array.isArray(payload.bannedDeviceModels) && payload.bannedDeviceModels.some(x=>String(x).trim().toLowerCase()===api.deviceModel.toLowerCase())) return 'Эта модель устройства заблокирована администратором.';
    return '';
  }
  async function check() {
    if (checking) return checking;
    checking = (async () => {
      // Keep the last verified identity during a periodic check; clear it on failure.
      if (!lastStatus) { showPending(); api.user = null; }
      let status, tgForAudit = window.Telegram?.WebApp;
      try {
        const [tg,config,allowed,banned,devices] = await Promise.all([loadSdk(),readJson('app_config.json'),readJson('allowed_users.json'),readJson('banned_users.json'),readJson('banned_devices.json')]);
        tgForAudit = tg;
        await collectDevice(tg);
        const user = await verifyIdentity(tg,config);
        api.user = user;
        const id=normalizeId(user.id);
        if (!(allowed && (Array.isArray(allowed) || Array.isArray(allowed.allowedUserIds)))) throw new Error('Проверьте allowed_users.json: требуется allowedUserIds.');
        const allow=validIds(Array.isArray(allowed)?allowed:allowed.allowedUserIds);
        const reason=userBan(banned,id) || deviceBan(devices) || (!allow.has(id)?'Ваш Telegram ID пока не добавлен в список разрешённых пользователей.':'');
        status={blocked:!!reason,reason,user,deviceId:api.deviceId};
        if (!reason) startPeriodicChecks();
      } catch (error) {
        api.user = null;
        status={blocked:true,user:api.user,deviceId:api.deviceId,reason:location.protocol==='file:'?'Откройте приложение по HTTPS. Локальный file:// не поддерживает загрузку JSON.':error.message || 'Не удалось проверить доступ. Попробуйте снова.'};
      } finally {hidePending();}
      lastStatus=status; api.isAllowed=!status.blocked; window.dispatchEvent(new Event('quizora:access'));
      auditStatus(status, tgForAudit);
      return status;
    })();
    try {return await checking;} finally {checking=null;}
  }
  function startPeriodicChecks() {
    if (periodicStarted) return; periodicStarted=true;
    const run = async () => {
      if (document.hidden) return;
      const result=await check();
      if (result.blocked) {
        try {if(typeof stopTimer==='function') stopTimer();} catch (_) {}
        for(const id of ['study-modal','history-modal','favorites-modal','stats-modal','app-menu-overlay']) document.getElementById(id)?.classList.add('hidden');
        if(typeof showBanOverlay==='function') showBanOverlay({...result,userId:result.user?.id || ''});
        void reportBlocked();
      }
    };
    setInterval(run,15000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void run();});
  }
  const OUTBOX = 'quizora_access_outbox_v3';
  let auditMemory = [], auditSending = false;
  const auditSeen = new Set();
  function readAuditQueue() {
    try { const value=JSON.parse(localStorage.getItem(OUTBOX)||'[]'); if(Array.isArray(value)) return value.filter(x=>x&&typeof x.key==='string'&&typeof x.text==='string').slice(-50); } catch(_) {}
    return auditMemory;
  }
  function writeAuditQueue(queue) {
    auditMemory=queue.slice(-50);
    try {localStorage.setItem(OUTBOX,JSON.stringify(auditMemory));}catch(_){}
  }
  function auditIdentity(status, tg=window.Telegram?.WebApp) {
    let claimed=null,stamp='';
    try {const fields=new URLSearchParams(tg?.initData||'');claimed=JSON.parse(fields.get('user')||'null');stamp=fields.get('auth_date')||'';}catch(_){}
    const user=status?.user || claimed;
    return {user, verified:!!status?.user, stamp:stamp || 'browser', id:normalizeId(user?.id) || 'unknown'};
  }
  function queueAudit(kind,status=lastStatus,tg) {
    if(!status)return;
    const who=auditIdentity(status,tg);
    const marker=['quizora_audit_v3',who.id,who.stamp,api.deviceId,kind,kind==='denied'?status.reason:''].join('|');
    let remembered=false;try{remembered=sessionStorage.getItem(marker)==='1';}catch(_){}
    if(auditSeen.has(marker)||remembered){void flushAudit();return;}
    const labels={attempt:'🚪 Quizora: попытка входа',allowed:'✅ Quizora: пользователь вошёл',denied:'⛔ Quizora: вход отклонён'};
    const idLabel=who.verified?'Telegram ID (подтверждён)':'Заявленный Telegram ID (не подтверждён)';
    const user=who.user || {};
    const text=[labels[kind],`${idLabel}: ${who.id}`,`Имя: ${[user.first_name,user.last_name].filter(Boolean).join(' ')||'не предоставлено'}`,`Username: ${user.username?'@'+String(user.username).slice(0,80):'нет'}`,`Device ID: ${api.deviceId||'недоступно'}`,`Все Device ID: ${api.deviceIds.join(', ')||'нет'}`,`Модель: ${api.deviceModel||'не определена'}`,`Источник ID: ${api.deviceSource||'нет'}`,kind==='denied'?`Причина: ${status.reason||'доступ ограничен'}`:'',`Дата: ${new Date().toLocaleString('ru-RU',{timeZone:'Asia/Tashkent',hour12:false})}`].filter(Boolean).join('\n');
    const queue=readAuditQueue();
    if(!queue.some(x=>x.key===marker)) {queue.push({key:marker,text});writeAuditQueue(queue);}
    auditSeen.add(marker);try{sessionStorage.setItem(marker,'1');}catch(_){}
    void flushAudit();
  }
  async function flushAudit() {
    if(auditSending || typeof sendTelegramResultsMessage!=='function')return false;
    auditSending=true;
    try {
      while(true){
        const queue=readAuditQueue(); if(!queue.length)return true;
        const item=queue[0];
        try {await sendTelegramResultsMessage(item.text,{force:true});}catch(_){return false;}
        writeAuditQueue(readAuditQueue().filter(x=>x.key!==item.key));
      }
    }finally{auditSending=false;}
  }
  function auditStatus(status,tg) {
    queueAudit('attempt',status,tg);
    if(status.blocked)queueAudit('denied',status,tg);
    void flushAudit();
  }
  async function reportBlocked() {if(lastStatus?.blocked)queueAudit('denied');return flushAudit();}
  async function reportEntry() {if(lastStatus&&!lastStatus.blocked&&api.user)queueAudit('allowed');return flushAudit();}
  window.addEventListener('online',()=>void flushAudit());
  setInterval(()=>void flushAudit(),15000);
  api.describeDevice = () => `Device ID: ${api.deviceId}\nВсе Device ID: ${api.deviceIds.join(', ')}\nМодель: ${api.deviceModel}\nИсточник ID: ${api.deviceSource}`;
  showPending();
})();
