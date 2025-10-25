// script.js — 修正版（デザイン/機能を削らず、確実にログイン・コメント読込・アンケート・将棋・GASアップロード・ポイント・マイページを動かす）
// 1) index.html の <head> で Firebase compat SDK (app/auth/database/storage) を必ず読み込んでください。
// 2) firebaseConfig と GAS_URL を実環境に置き換えてください。

/* 設定（Firebase Console の値で必ず置換） */
const firebaseConfig = {
  apiKey: "AIzaSyD1AK05uuGBw2U4Ne5LbKzzjzCqnln60mg",
  authDomain: "shige-live.firebaseapp.com",
  databaseURL: "https://shige-live-default-rtdb.firebaseio.com",
  projectId: "shige-live",
  storageBucket: "shige-live.firebasestorage.app",
  messagingSenderId: "135620625815",
  appId: "1:135620625815:web:514ba3dd5cd625c144f0d2",
  measurementId: "G-5Y7F6V9668"
};

/* Apps Script の公開WebアプリURL（プロフィール画像アップロードに使用） */
const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

/* ユーティリティ */
function el(id){ return document.getElementById(id); }
function now(){ return Date.now(); }
function escapeHtml(s){ if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,"&#039;"); }
function fmtTime(ts){ try{ return new Date(ts).toLocaleString(); }catch(_){ return ''; } }

/* Firebase 初期化（順序が正しければここでOK） */
if (typeof firebase === 'undefined') {
  console.error('Firebase SDK が読み込まれていません。head に compat SDK を追加してください。');
} else {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  } catch (e) {
    console.error('firebase initialize error', e);
  }
}

/* SDK ハンドル */
const auth = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : null;
const db = (typeof firebase !== 'undefined' && firebase.database) ? firebase.database() : null;
const storage = (typeof firebase !== 'undefined' && firebase.storage) ? firebase.storage() : null;

/* 永続化（再読み込みしてもログイン保持） */
if (auth && firebase?.auth?.Auth?.Persistence) {
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e=>console.warn('setPersistence failed', e));
}

/* Realtime Database refs */
const commentsRef = db ? db.ref('comments') : null;
const pollsRef = db ? db.ref('polls') : null;
const arrivalsRef = db ? db.ref('arrivals') : null;
const presenceRefRoot = db ? db.ref('presence') : null;
const gamesRef = db ? db.ref('games') : null;
const usersRef = db ? db.ref('users') : null;

/* 定数 */
const POLL_DURATION_MS = 45 * 1000;
const POLL_AFTER_FINISH_DISPLAY_MS = 20 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;

/* 状態 */
let myPresenceRef = null;
let currentGameId = null;
let gameLocalState = null;
const _pollTimers = new Map();
let _pollRemovalTimeout = null;

/* モーダル */
const modalState = { openModalId: null };
function openModal(id){
  const m = el(id), b = el('modalBackdrop');
  if (!m) return;
  if (modalState.openModalId && modalState.openModalId !== id) closeModal(modalState.openModalId);
  m.classList.add('open'); m.setAttribute('aria-hidden','false');
  if (b) { b.style.visibility='visible'; b.style.opacity='1'; b.setAttribute('aria-hidden','false'); }
  modalState.openModalId = id;
  const focusable = m.querySelector('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
  focusable && focusable.focus && focusable.focus();
  document.addEventListener('keydown', _escClose);
}
function closeModal(id){
  const m = el(id), b = el('modalBackdrop');
  if (!m) return;
  m.classList.remove('open'); m.setAttribute('aria-hidden','true');
  if (b) { b.style.opacity='0'; b.style.visibility='hidden'; b.setAttribute('aria-hidden','true'); }
  if (modalState.openModalId === id) modalState.openModalId = null;
  document.removeEventListener('keydown', _escClose);
}
function _escClose(e){ if (e.key === 'Escape' && modalState.openModalId) closeModal(modalState.openModalId); }
document.addEventListener('click', (e) => {
  const b = el('modalBackdrop');
  if (b && e.target === b && modalState.openModalId) closeModal(modalState.openModalId);
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-close]');
  if (btn) { const id = btn.getAttribute('data-close'); id && closeModal(id); }
});

/* Arrival banner */
function showArrivalBanner(name){
  const b = el('arrivalBanner'); if (!b) return;
  b.textContent = `${escapeHtml(name)}さんが配信を視聴しに来ました`;
  b.style.display = 'block'; b.setAttribute('aria-hidden','false');
  if (b._hideTimer) clearTimeout(b._hideTimer);
  b._hideTimer = setTimeout(()=>{ b.style.display='none'; b.setAttribute('aria-hidden','true'); }, ARRIVAL_BANNER_DURATION);
}

/* Auth 状態監視 */
if (auth) {
  auth.onAuthStateChanged(async user => {
    const loginBtn = el('loginBtn'), mypageBtn = el('mypageBtn'), logoutBtn = el('logoutBtn'),
          usernameEl = el('username'), avatarEl = el('avatar'), myPoints = el('myPoints');
    if (user) {
      loginBtn && (loginBtn.style.display='none');
      mypageBtn && (mypageBtn.style.display='inline-block');
      logoutBtn && (logoutBtn.style.display='inline-block');
      const name = user.displayName || user.email || 'ユーザー';
      usernameEl && (usernameEl.textContent = name);
      avatarEl && (avatarEl.src = user.photoURL || '');

      arrivalsRef && arrivalsRef.push({ type:'arrival', name, timestamp: now() }).catch(()=>{});
      attachPresence(user.uid);

      // 保有ポイント表示
      try {
        if (usersRef) {
          const snap = await usersRef.child(user.uid).child('points').once('value');
          myPoints && (myPoints.textContent = snap.val() ?? 0);
        }
      } catch(e){ console.warn('points fetch failed', e); }

      el('loginError') && (el('loginError').textContent = '');
    } else {
      loginBtn && (loginBtn.style.display='inline-block');
      mypageBtn && (mypageBtn.style.display='none');
      logoutBtn && (logoutBtn.style.display='none');
      usernameEl && (usernameEl.textContent='');
      avatarEl && (avatarEl.src='');
      myPoints && (myPoints.textContent='');
      detachPresence();
    }
  });
}

/* Presence */
function attachPresence(uid){
  if (!uid || !presenceRefRoot) return;
  try {
    myPresenceRef = presenceRefRoot.child(uid);
    myPresenceRef.set({ online:true, lastSeen: now() }).catch(()=>{});
    myPresenceRef.onDisconnect().set({ online:false, lastSeen: now() }).catch(()=>{});
  } catch(e){ console.error('attachPresence error', e); }
}
function detachPresence(){
  if (!myPresenceRef) return;
  try { myPresenceRef.set({ online:false, lastSeen: now() }).catch(()=>{}); } catch(e){}
  try { myPresenceRef.onDisconnect().cancel(); } catch(e){}
  myPresenceRef = null;
}

/* Login/Signup/Profile name */
function showLoginError(msg){ const err = el('loginError'); err && (err.textContent = msg || ''); }
async function signUp(){
  try {
    if (!auth) return showLoginError('Auth 未初期化');
    const email = el('email')?.value?.trim();
    const password = el('password')?.value || '';
    if (!email || !password) return showLoginError('メールとパスワードを入力してください');
    showLoginError('');
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    // 初回登録時にユーザーノード用意
    if (usersRef && cred?.user?.uid) {
      await usersRef.child(cred.user.uid).update({
        profile: { displayName: cred.user.displayName || cred.user.email || 'ユーザー', photoURL: cred.user.photoURL || '' },
        points: 0
      }).catch(()=>{});
    }
    closeModal('loginModal');
  } catch (e) {
    showLoginError(e?.message || '登録に失敗しました');
  }
}
async function signIn(){
  try {
    if (!auth) return showLoginError('Auth 未初期化');
    const email = el('email')?.value?.trim();
    const password = el('password')?.value || '';
    if (!email || !password) return showLoginError('メールとパスワードを入力してください');
    showLoginError('');
    const cred = await auth.signInWithEmailAndPassword(email, password);
    if (!cred?.user) throw new Error('ログインに失敗しました');
    closeModal('loginModal');
  } catch (e) {
    showLoginError(e?.message || 'ログインに失敗しました');
  }
}
async function updateProfile(){
  try {
    if (!auth) return alert('Auth 未初期化');
    const user = auth.currentUser;
    if (!user) return alert('ログインしてください');
    const newName = el('newName')?.value?.trim();
    if (!newName) return alert('ユーザー名を入力してください');
    await user.updateProfile({ displayName: newName });
    usersRef && usersRef.child(user.uid).child('profile').update({ displayName:newName }).catch(()=>{});
    el('username') && (el('username').textContent = newName);
    alert('ユーザー名を更新しました');
    closeModal('mypageModal');
  } catch(e){ console.error('updateProfile error', e); alert('更新失敗'); }
}

/* DOMContentLoaded: バインド */
document.addEventListener('DOMContentLoaded', () => {
  const safeAdd = (id, ev, fn) => { const n = el(id); n && n.addEventListener(ev, fn); };

  safeAdd('loginBtn','click', () => openModal('loginModal'));
  safeAdd('mypageBtn','click', () => openModal('mypageModal'));
  safeAdd('logoutBtn','click', async () => { try { auth && await auth.signOut(); } catch(e) { console.error(e); alert('ログアウト失敗'); } });
  safeAdd('signinBtn','click', signIn);
  safeAdd('signupBtn','click', signUp);
  safeAdd('updateNameBtn','click', updateProfile);

  safeAdd('sendBtn','click', sendComment);
  safeAdd('pollBtn','click', () => openModal('pollModal'));
  safeAdd('addPollOptionBtn','click', addPollOption);
  safeAdd('createPollBtn','click', createPollFromModal);

  safeAdd('gameBtn','click', () => openModal('gameModal'));
  safeAdd('startGameBtn','click', startGameByHost);

  document.querySelectorAll('.gameChoice').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gameChoice').forEach(b => b.removeAttribute('data-selected'));
      btn.setAttribute('data-selected','true');
    });
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); } });
  });

  safeAdd('uploadProfileBtn','click', uploadProfileImageGAS);
  safeAdd('profileImageFile','change', previewProfileFile);

  safeAdd('callSendBtn','click', sendCallRequestFromPopup);
  safeAdd('callCancelBtn','click', () => closeModal('callRequestPopup'));

  const commentsEl = el('comments');
  if (commentsEl) {
    commentsEl.addEventListener('click', ev => {
      const badge = ev.target.closest('.call-badge');
      if (badge) { const uid = badge.getAttribute('data-uid'); uid && openCallRequestPopup(uid); }
      const img = ev.target.closest('img[data-uid]');
      if (img) { const uid = img.getAttribute('data-uid'); uid && openCallRequestPopup(uid); }
    });
  }

  // 到着バナー
  arrivalsRef && arrivalsRef.on('child_added', snap => {
    const d = snap.val(); if (d?.type === 'arrival') showArrivalBanner(d.name || 'ゲスト');
    snap.ref.remove().catch(()=>{});
  });

  ensurePollListener();
  initComments();
  initGameAutoSubscribe();
});

/* プロフィール画像: プレビュー */
function previewProfileFile(){
  const f = el('profileImageFile')?.files?.[0];
  const p = el('assetPreview');
  if (f && p) {
    const url = URL.createObjectURL(f);
    p.innerHTML = `<div style="font-weight:700">プレビュー</div><div style="margin-top:8px"><img src="${url}" style="max-width:160px;max-height:160px;border:1px solid #ddd;padding:4px;background:#fff" /></div>`;
  }
}

/* プロフィール画像: Apps Script 経由でアップロード（削らず強化） */
async function uploadProfileImageGAS(){
  try {
    if (!auth || !auth.currentUser) return alert('アップロードにはログインが必要です');
    const file = el('profileImageFile')?.files?.[0];
    if (!file) return alert('画像を選択してください');
    if (!GAS_URL) return alert('GAS_URL が未設定です');

    const uid = auth.currentUser.uid;
    const form = new FormData();
    form.append('uid', uid);
    form.append('file', file, file.name);

    // Apps Script 側は「doPost(e)」でファイル受信し、Drive/Storage に保存して公開URLを返す設計
    const res = await fetch(GAS_URL, { method:'POST', body: form });
    if (!res.ok) throw new Error('Apps Script へのアップロード失敗');
    const data = await res.json(); // 期待: { url: "https://..." }
    const url = data?.url;
    if (!url) throw new Error('Apps Script からURLが返されませんでした');

    // Firebase 側プロフィール更新
    await auth.currentUser.updateProfile({ photoURL: url });
    if (usersRef) {
      await usersRef.child(uid).child('profile').update({ photoURL: url }).catch(()=>{});
    }
    el('assetPreview').innerHTML = `<div style="font-weight:700">アップロード完了</div><div style="margin-top:8px"><img src="${url}" style="max-width:160px;max-height:160px;border:1px solid #ddd;padding:4px;background:#fff" /></div>`;
    el('avatar') && (el('avatar').src = url);
    alert('プロフィール画像をアップロードしました（Apps Script経由）');
  } catch(e){
    console.error('uploadProfileImageGAS error', e);
    alert('アップロードに失敗しました: ' + (e?.message || '不明なエラー'));
  }
}

/* コメント: 初期ロード + 新着 */
function getCommentsEl(){ const elc = el('comments'); if(!elc) console.warn('#comments が見つかりません'); return elc; }
function initComments(){
  try {
    if (!db || !commentsRef) { console.warn('initComments: DB未初期化'); return; }
    const commentsEl = getCommentsEl(); if (!commentsEl) return;

    // 初期取得（古い順に並べて描画）
    commentsRef.orderByChild('ts').limitToLast(200).once('value')
      .then(snap => {
        const items = [];
        snap.forEach(ch => { const v = ch.val(); v && items.push(v); });
        items.sort((a,b) => (a.ts||0) - (b.ts||0));
        items.forEach(d => renderComment(d, false));
      })
      .catch(err => console.error('initComments initial once failed', err))
      .finally(() => {
        // リアルタイム新着
        commentsRef.orderByChild('ts').limitToLast(500).on('child_added', snap => {
          const d = snap.val(); if (!d) return;
          renderComment(d, true);
        }, err => console.error('comments child_added listener error', err));
      });
  } catch(e) { console.error('initComments unexpected error', e); }
}
function renderComment(d, asNew){
  const commentsEl = getCommentsEl(); if(!commentsEl) return;
  const key = d._id || (d.uid ? `${d.uid}_${d.ts||Math.floor(Math.random()*1e9)}` : `c_${Math.floor(Math.random()*1e9)}`);
  if (commentsEl.querySelector(`[data-cid="${key}"]`)) return;

  const div = document.createElement('div'); div.className = 'comment'; div.setAttribute('data-cid', key);
  const avatarWrap = document.createElement('div'); avatarWrap.className = 'avatarWrap'; avatarWrap.style.marginRight='10px';
  const img = document.createElement('img'); img.className='avatar'; img.src = d.photo || 'https://via.placeholder.com/40?text=U'; img.width=40; img.height=40;
  d.uid && img.setAttribute('data-uid', d.uid); avatarWrap.appendChild(img);
  const dot = document.createElement('span'); dot.className='presence-dot presence-offline'; dot.id = `presenceDot-${d.uid || key}`; avatarWrap.appendChild(dot);

  const meta = document.createElement('div'); meta.className='meta';
  const timeStr = d.ts ? fmtTime(d.ts) : '';
  meta.innerHTML = `<strong>${escapeHtml(d.name||'匿名')} <small style="color:#666;font-weight:400;margin-left:6px">${escapeHtml(timeStr)}</small></strong><div>${escapeHtml(d.text||'')}</div>`;

  const right = document.createElement('div'); right.style.marginLeft='auto'; right.style.display='flex'; right.style.alignItems='center';
  const callBadge = document.createElement('span'); callBadge.className='call-badge'; callBadge.textContent='通話'; d.uid && callBadge.setAttribute('data-uid', d.uid);
  right.appendChild(callBadge);

  div.appendChild(avatarWrap); div.appendChild(meta); div.appendChild(right);
  if (asNew) commentsEl.insertBefore(div, commentsEl.firstChild || null); else commentsEl.appendChild(div);

  if (d.uid && presenceRefRoot) {
    presenceRefRoot.child(d.uid).on('value', snap => {
      const v = snap.val(); const dotEl = el(`presenceDot-${d.uid}`);
      if (dotEl) {
        dotEl.classList.toggle('presence-online', !!v?.online);
        dotEl.classList.toggle('presence-offline', !v?.online);
      }
    });
  }
}
function sendComment(){
  try {
    const input = el('commentInput'); if(!input) { alert('入力欄が見つかりません'); return; }
    const text = input.value.trim(); if(!text) { alert('コメントを入力してください'); return; }
    if (!auth || !auth.currentUser) { alert('コメントにはログインが必要です'); return; }
    const payload = {
      uid: auth.currentUser.uid,
      name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー',
      photo: auth.currentUser.photoURL || '',
      text, ts: Date.now()
    };
    if (!commentsRef) { console.error('sendComment: commentsRef 未定義'); return; }
    commentsRef.push(payload).then(()=>{ input.value=''; }).catch(err=>{ console.error('コメント保存エラー', err); alert('送信失敗'); });
  } catch(e) { console.error('sendComment unexpected error', e); }
}

/* Polls（アンケート） */
function addPollOption(){
  const wrap = el('pollOptionsWrapper'); if(!wrap) return;
  const input = document.createElement('input'); input.type='text'; input.className='pollOptionInput'; input.placeholder='選択肢';
  wrap.appendChild(input);
}
function createPollFromModal(){
  try {
    const qEl = el('pollQuestion');
    if (!qEl) return alert('質問を入力してください');
    const options = Array.from(document.querySelectorAll('.pollOptionInput')).map(i=>i.value.trim()).filter(v=>v);
    if (!options.length) return alert('選択肢を1つ以上入力してください');

    const poll = {
      active:true,
      question:qEl.value.trim(),
      options: options.map((label,idx)=>({ id:'o'+idx+'_'+now(), label, count:0 })),
      state:'voting',
      startedAt: now(),
      endsAt: now() + POLL_DURATION_MS,
      votes: {}
    };

    if (pollsRef) {
      pollsRef.child('active').set(poll).then(()=>{ closeModal('pollModal'); }).catch(err=>{ console.error('createPoll error', err); alert('アンケート作成失敗'); });
    } else {
      renderPollState(poll); closeModal('pollModal'); setTimeout(()=>{ finalizePollLocal(poll); }, POLL_DURATION_MS);
    }
  } catch(e){ console.error('createPollFromModal error', e); alert('アンケート作成失敗'); }
}
function finalizePollLocal(poll){ poll.state = 'finished'; renderPollState(poll); setTimeout(()=>{ hidePollUI(); }, POLL_AFTER_FINISH_DISPLAY_MS); }
function ensurePollListener(){
  try {
    if (!pollsRef) return;
    pollsRef.child('active').on('value', snap => {
      const data = snap.val();
      if (!data || data.active !== true) { hidePollUI(); return; }
      renderPollState(data);
      if (data.state === 'finished') {
        if (_pollRemovalTimeout) clearTimeout(_pollRemovalTimeout);
        _pollRemovalTimeout = setTimeout(async ()=>{
          try {
            const snapCheck = await pollsRef.child('active').once('value');
            const cur = snapCheck.val();
            if (cur && cur.state === 'finished') await pollsRef.child('active').remove();
          } catch(e){ console.error(e); } finally {
            hidePollUI();
            if (_pollTimers.has('active')){ clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
            _pollRemovalTimeout = null;
          }
        }, POLL_AFTER_FINISH_DISPLAY_MS);
      }
      if (data.state === 'voting' && now() >= (data.endsAt || 0)) finalizePoll();
    }, err => console.warn('poll listener error', err));
  } catch(e){ console.error('ensurePollListener error', e); }
}
function renderPollState(poll){
  const pollArea = el('pollArea'), pollContent = el('pollContent'), pollTimer = el('pollTimer');
  if (!pollArea || !pollContent) return;
  pollArea.style.display = 'block';
  pollContent.innerHTML = '';
  const header = document.createElement('div'); header.className = 'poll-header';
  const q = document.createElement('div'); q.className = 'poll-question'; q.textContent = poll.question || '';
  header.appendChild(q); pollContent.appendChild(header);
  const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options';
  const total = (poll.options || []).reduce((s,o)=>s+(o.count||0),0) || 0;
  (poll.options||[]).forEach(o => {
    const opt = document.createElement('div'); opt.className='poll-option'; opt.dataset.optId = o.id;
    const pct = total === 0 ? 0 : Math.round(((o.count||0)/ total)*100);
    opt.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`;
    if (poll.state === 'voting') opt.addEventListener('click', ()=>voteOption(o.id)); else opt.style.opacity='0.7';
    optionsWrap.appendChild(opt);
  });
  pollContent.appendChild(optionsWrap);

  if (pollTimer) {
    if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
    if (poll.state === 'voting') {
      const updateFn = ()=>{
        const remainingMs = Math.max(0,(poll.endsAt||0) - now());
        if (remainingMs <= 0) {
          pollTimer.textContent = '集計中...';
          finalizePoll().catch(err=>console.error(err));
          if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
          return;
        }
        pollTimer.textContent = `残り ${Math.ceil(remainingMs/1000)} 秒`;
      };
      updateFn(); const t = setInterval(updateFn,500); _pollTimers.set('active', t);
    } else { pollTimer.textContent = '投票終了'; }
  }
}
function hidePollUI(){ const pa = el('pollArea'); pa && (pa.style.display='none'); const pc = el('pollContent'); pc && (pc.innerHTML=''); }
function voteOption(optId){
  try {
    const user = auth?.currentUser;
    if (!user) return alert('投票にはログインが必要です');
    if (!pollsRef) return alert('サーバ未接続のため投票不可');
    const uid = user.uid;
    const activeRef = pollsRef.child('active');
    activeRef.transaction(current => {
      if (!current) return current;
      if (current.state !== 'voting') return current;
      const prev = current.votes && current.votes[uid] && current.votes[uid].opt;
      if (prev) {
        const idxPrev = (current.options||[]).findIndex(o=>o.id===prev);
        if (idxPrev>=0) current.options[idxPrev].count = Math.max(0,(current.options[idxPrev].count||0)-1);
      }
      const idx = (current.options||[]).findIndex(o=>o.id===optId);
      if (idx>=0) current.options[idx].count = (current.options[idx].count||0) + 1;
      if (!current.votes) current.votes = {};
      current.votes[uid] = { opt: optId, at: now(), name: user.displayName || user.email || 'ユーザー' };
      return current;
    });
  } catch(e){ console.error('voteOption error', e); }
}
async function finalizePoll(){
  try {
    if (!pollsRef) return;
    const activeRef = pollsRef.child('active');
    const snap = await activeRef.once('value');
    const poll = snap.val();
    if (!poll || poll.state === 'finished') return;
    await activeRef.update({ state:'finished', finishedAt: now() });
    await pollsRef.child('history').push(poll).catch(()=>{});
    if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
  } catch(e){ console.error('finalizePoll error', e); }
}

/* Game（将棋） */

// 駒コードと画像ファイルの対応表
const pieceImages = {
  'p': 'pawn.png','P': 'pawn.png',
  'l': 'lance.png','L': 'lance.png',
  'n': 'knight.png','N': 'knight.png',
  's': 'silver.png','S': 'silver.png',
  'g': 'gold.png','G': 'gold.png',
  'k': 'king.png','K': 'king.png',
  'r': 'rook.png','R': 'rook.png',
  'b': 'bishop.png','B': 'bishop.png',
  '+p': 'tokin.png',
  '+s': 'promoted_silver.png',
  '+n': 'promoted_knight.png',
  '+l': 'promoted_lance.png',
  '+r': 'dragon.png',
  '+b': 'horse.png'
};
function startGameByHost(){
  try {
    if (!auth?.currentUser) return alert('ゲーム開始はログインが必要です');
    const chosen = document.querySelector('.gameChoice[data-selected="true"]');
    if (!chosen) return alert('ゲームを選択してください');
    const gameType = chosen.getAttribute('data-game');
    const spectatorsAllowed = !!el('publicGame')?.checked;
    const gid = gamesRef ? gamesRef.push().key : ('g_' + Math.floor(Math.random()*1e9));
    const gameObj = { id: gid, type: gameType, hostUid: auth.currentUser.uid, status: 'lobby', createdAt: now(), players:{}, spectatorsAllowed: !!spectatorsAllowed, winnerUid: null };
    if (gamesRef) { gamesRef.child(gid).set(gameObj).then(()=>openGameUI(gid, gameObj)); } else openGameUI(gid, gameObj);
    closeModal('gameModal');
  } catch(e){ console.error('startGame error', e); alert('ゲーム作成に失敗しました'); }
}
function openGameUI(gid, initialObj){
  if (!gid) return;
  try { if (currentGameId && gamesRef) gamesRef.child(currentGameId).off(); } catch(e){}
  currentGameId = gid; gameLocalState = initialObj || null;
  const ga = el('gameArea'); ga && (ga.style.display = 'block');
  renderGameHeader(initialObj || {});
  if (!gamesRef) return;
  gamesRef.child(gid).on('value', snap => {
    const g = snap.val();
    if (!g) { closeGameUI(); return; }
    gameLocalState = g; renderGameState(g); renderGameHeader(g);
  });
}
function renderGameHeader(game){
  const title = el('gameTitle'); title && (title.textContent = game.type === 'shogi' ? '将棋（対戦）' : 'ゲーム');
  const controls = el('gameControls'); if (!controls) return; controls.innerHTML = '';
  const statusBadge = document.createElement('span'); statusBadge.textContent = game.status || 'lobby'; statusBadge.style.marginRight='8px'; statusBadge.style.fontWeight='700'; controls.appendChild(statusBadge);
  const hostInfo = document.createElement('span'); hostInfo.textContent = game.hostUid ? `主催: ${game.hostUid}` : '主催: なし'; hostInfo.style.marginRight='12px'; hostInfo.style.opacity='0.85'; controls.appendChild(hostInfo);

  if (auth?.currentUser) {
    if (game.status === 'lobby') {
      const joinBtn = document.createElement('button'); joinBtn.textContent='参加希望'; joinBtn.addEventListener('click', ()=> requestJoinGame(game.id)); controls.appendChild(joinBtn);
      if (auth.currentUser.uid === game.hostUid) {
        const pickBtn = document.createElement('button'); pickBtn.textContent='参加者から選出して開始'; pickBtn.addEventListener('click', ()=> pickAndStartGame(game.id)); controls.appendChild(pickBtn);
      }
    } else if (game.status === 'running') {
      if (auth.currentUser.uid === game.hostUid) {
        const endBtn = document.createElement('button'); endBtn.textContent='強制終了'; endBtn.addEventListener('click', ()=> endGame(game.id, null)); controls.appendChild(endBtn);
      }
    }
  } else {
    const info = document.createElement('span'); info.textContent='参加するにはログインしてください'; info.style.marginLeft='8px'; info.style.color='#666'; controls.appendChild(info);
  }
}
async function requestJoinGame(gid){
  if (!auth?.currentUser) return alert('ログインしてください');
  const u = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー', accepted:false, ts: now() };
  gamesRef && await gamesRef.child(gid).child('players').child(u.uid).set(u);
  alert('参加希望を出しました。主催者が選出するまでお待ちください。');
}
async function pickAndStartGame(gid){
  try {
    if (!gamesRef) return alert('サーバ未接続のため簡易開始は不可');
    const snap = await gamesRef.child(gid).child('players').once('value');
    const players = []; snap.forEach(ch=>{ const v = ch.val(); v?.uid && players.push(v); });
    const candidates = players.filter(p=>p.uid !== auth.currentUser.uid);
    if (candidates.length === 0) return alert('参加希望者がいません');
    const pick = candidates[Math.floor(Math.random()*candidates.length)];
    const updates = {};
    updates[`players/${auth.currentUser.uid}`] = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || '主催者', accepted:true, role:'host', ts: now() };
    updates[`players/${pick.uid}`] = { uid: pick.uid, name: pick.name, accepted:true, role:'player', ts: now() };
    updates['status'] = 'running';
    updates['startedAt'] = now();
    updates['activePlayers'] = { [auth.currentUser.uid]: true, [pick.uid]: true };
    await gamesRef.child(gid).update(updates);
    await gamesRef.child(gid).child('shogi').set({ board: initialShogiBoard(), turn: auth.currentUser.uid, moves: [] });
  } catch(e){ console.error('pickAndStartGame error', e); }
}
function initialShogiBoard(){
  return [
    ['l','n','s','g','k','g','s','n','l'],
    ['.','r','.','.','.','.','.','b','.'],
    ['p','p','p','p','p','p','p','p','p'],
    ['.','.','.','.','.','.','.','.','.'],
    ['.','.','.','.','.','.','.','.','.'],
    ['.','.','.','.','.','.','.','.','.'],
    ['P','P','P','P','P','P','P','P','P'],
    ['.','B','.','.','.','.','.','R','.'],
    ['L','N','S','G','K','G','S','N','L']
  ];
}
function renderGameState(game){
  if (!game) return;
  if (game.type === 'shogi') {
    const shogi = game.shogi || game.shogiState || {};
    renderShogiBoard(game.id, shogi);
  }
}
async function renderShogiBoard(gid, shogiState){
  const container = el('shogiContainer'); if (!container) return;
  container.innerHTML = '';
  const boardWrap = document.createElement('div'); boardWrap.className='shogiBoard';
  const size = 9;
  const grid = document.createElement('div'); grid.className='grid';
  const board = shogiState?.board || initialShogiBoard();
  for (let r=0;r<size;r++){
    for (let c=0;c<size;c++){
      const sq = document.createElement('div'); sq.className='grid-cell'; sq.dataset.r=r; sq.dataset.c=c;
      const piece = board[r][c];
      if (piece && piece !== '.') {
        const img = document.createElement('img'); img.alt = piece;
        // 駒コードに応じて画像を切り替え
        const filename = pieceImages[piece] || 'pawn.png';
        img.src = `assets/koma/${filename}`;
        const isSente = piece === piece.toUpperCase();
        if (!isSente) img.classList.add('koma-gote'); else img.classList.remove('koma-gote');
        sq.appendChild(img);
      }
      grid.appendChild(sq);
    }
  }
  boardWrap.appendChild(grid); container.appendChild(boardWrap);
}
async function makeShogiMove(gid, uid, from, to){
  try {
    if (!gamesRef) return;
    const shogiRef = gamesRef.child(gid).child('shogi');
    await shogiRef.transaction(current => {
      if (!current) return current;
      const board = current.board || initialShogiBoard();
      const piece = board[from.r][from.c];
      if (!piece || piece === '.') return;
      board[to.r][to.c] = piece;
      board[from.r][from.c] = '.';
      const moves = current.moves || [];
      moves.push({ by: uid, from, to, ts: now() });
      const activePlayers = gameLocalState?.activePlayers ? Object.keys(gameLocalState.activePlayers) : [];
      const other = activePlayers.find(u=>u!==uid) || uid;
      current.board = board; current.moves = moves; current.turn = other;
      return current;
    });
  } catch(e){ console.error('makeShogiMove error', e); }
}
async function endGame(gid, winnerUid){
  try {
    if (!gamesRef) return;
    const updates = { status:'finished', finishedAt: now(), winnerUid: winnerUid || null };
    await gamesRef.child(gid).update(updates);
    setTimeout(async ()=>{ try { await gamesRef.child(gid).remove(); } catch(e){ console.warn('remove game failed', e); } closeGameUI(); }, 2000);
  } catch(e){ console.error('endGame error', e); }
}
function closeGameUI(){ try { if (currentGameId && gamesRef) gamesRef.child(currentGameId).off(); } catch(e){} currentGameId=null; gameLocalState=null; const ga=el('gameArea'); ga && (ga.style.display='none'); }
function initGameAutoSubscribe(){
  try {
    if (!gamesRef) return;
    gamesRef.orderByChild('status').equalTo('lobby').on('child_added', snap=>{ const g=snap.val(); if(!g) return; if(!currentGameId) openGameUI(g.id,g); });
    gamesRef.orderByChild('status').equalTo('running').on('child_added', snap=>{ const g=snap.val(); if(!g) return; openGameUI(g.id,g); });
    gamesRef.on('child_changed', snap=>{ const g=snap.val(); if(!g) return; if (currentGameId === g.id) { gameLocalState = g; renderGameState(g); renderGameHeader(g); } });
    gamesRef.on('child_removed', snap=>{ const removed = snap.val(); if(!removed) return; if (currentGameId === removed.id) closeGameUI(); });
  } catch(e){ console.error('initGameAutoSubscribe error', e); }
}

/* 呼び出し関連プレースホルダ（UI保持） */
function openCallRequestPopup(uid){ const content = el('callRequestContent'); content && (content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`); window._callTargetUid = uid; openModal('callRequestPopup'); }
function sendCallRequestFromPopup(){ /* signaling 実装は後続 */ }

/* デバッグ */
window.checkDebug = function(){
  console.log('firebase loaded?', typeof firebase !== 'undefined');
  console.log('auth.currentUser', auth?.currentUser || null);
  console.log('DOM elements:', { comments: !!el('comments'), pollArea: !!el('pollArea'), gameArea: !!el('gameArea') });
};
