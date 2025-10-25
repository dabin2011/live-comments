// script.js — ログイン問題の修正版含む全体
// Firebase SDK を index.html で読み込んだ後に読み込んでください。
// firebaseConfig と GAS_URL を実運用値に置き換えてください。

const firebaseConfig = {
  apiKey: "AIzaSyD1AK05uuGBw2U4Ne5LbKzzjzCqnln60mg",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://shige-live-default-rtdb.firebaseio.com/",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

function el(id){ return document.getElementById(id); }
function now(){ return Date.now(); }
function escapeHtml(s){ if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,"&#039;"); }

// Firebase init guard
if (typeof firebase === 'undefined') {
  console.error('Firebase SDK が読み込まれていません。index.html に SDK を追加してください。');
} else if (!firebase.apps.length) {
  try { firebase.initializeApp(firebaseConfig); } catch (e) { console.error('firebase initialize error', e); }
}

const auth = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : null;
const db = (typeof firebase !== 'undefined' && firebase.database) ? firebase.database() : null;
const storage = (typeof firebase !== 'undefined' && firebase.storage) ? firebase.storage() : null;

const commentsRef = db ? db.ref('comments') : null;
const pollsRef = db ? db.ref('polls') : null;
const arrivalsRef = db ? db.ref('arrivals') : null;
const presenceRefRoot = db ? db.ref('presence') : null;
const gamesRef = db ? db.ref('games') : null;
const usersRef = db ? db.ref('users') : null;

const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const POLL_AFTER_FINISH_DISPLAY_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;

let myPresenceRef = null;
let currentGameId = null;
let gameLocalState = null;
const _pollTimers = new Map();
let _pollRemovalTimeout = null;

const modalState = { openModalId: null };

function openModal(id){
  const modal = el(id);
  const backdrop = el('modalBackdrop');
  if (!modal) { console.warn('openModal: not found', id); return; }
  if (modalState.openModalId && modalState.openModalId !== id) closeModal(modalState.openModalId);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  if (backdrop) { backdrop.style.visibility = 'visible'; backdrop.style.opacity = '1'; backdrop.setAttribute('aria-hidden','false'); }
  modalState.openModalId = id;
  const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable) focusable.focus();
  document.addEventListener('keydown', _escClose);
}

function closeModal(id){
  const modal = el(id);
  const backdrop = el('modalBackdrop');
  if (!modal) { console.warn('closeModal: not found', id); return; }
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  if (backdrop) { backdrop.style.opacity = '0'; backdrop.style.visibility = 'hidden'; backdrop.setAttribute('aria-hidden','true'); }
  if (modalState.openModalId === id) modalState.openModalId = null;
  document.removeEventListener('keydown', _escClose);
}

function _escClose(e){
  if (e.key === 'Escape' && modalState.openModalId) closeModal(modalState.openModalId);
}

// backdrop click closes modal
document.addEventListener('click', (e) => {
  const backdrop = el('modalBackdrop');
  if (!backdrop) return;
  if (e.target === backdrop) {
    if (modalState.openModalId) closeModal(modalState.openModalId);
  }
});

// delegated close buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-close]');
  if (btn) {
    const id = btn.getAttribute('data-close');
    if (id) closeModal(id);
  }
});

// Login helpers (robust error display)
function showLoginError(msg){
  const err = el('loginError');
  if (err) { err.textContent = msg || ''; }
  console.error('Login error:', msg);
}

async function signUp(){
  try {
    if (!auth) return showLoginError('Auth 未初期化');
    const email = el('email')?.value?.trim();
    const password = el('password')?.value || '';
    if (!email || !password) return showLoginError('メールとパスワードを入力してください');
    showLoginError(''); // clear
    await auth.createUserWithEmailAndPassword(email, password);
    closeModal('loginModal');
  } catch (e) {
    showLoginError(e && e.message ? e.message : '登録に失敗しました');
  }
}

async function signIn(){
  try {
    if (!auth) return showLoginError('Auth 未初期化');
    const email = el('email')?.value?.trim();
    const password = el('password')?.value || '';
    if (!email || !password) return showLoginError('メールとパスワードを入力してください');
    showLoginError(''); // clear
    await auth.signInWithEmailAndPassword(email, password);
    closeModal('loginModal');
  } catch (e) {
    showLoginError(e && e.message ? e.message : 'ログインに失敗しました');
  }
}

// Ensure modal open buttons exist and bind handlers early
document.addEventListener('DOMContentLoaded', () => {
  try {
    const safeAdd = (id, ev, fn) => { const n = el(id); if (n) n.addEventListener(ev, fn); };

    safeAdd('loginBtn','click', () => openModal('loginModal'));
    safeAdd('mypageBtn','click', () => openModal('mypageModal'));
    safeAdd('logoutBtn','click', async () => { try { if (!auth) return; await auth.signOut(); } catch(e) { console.error(e); alert('ログアウト失敗'); } });

    safeAdd('signinBtn','click', signIn);
    safeAdd('signupBtn','click', signUp);

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

    safeAdd('updateNameBtn','click', updateProfile);
    safeAdd('uploadProfileBtn','click', uploadProfileImage);
    safeAdd('profileImageFile','change', previewProfileFile);

    safeAdd('callSendBtn','click', sendCallRequestFromPopup);
    safeAdd('callCancelBtn','click', () => closeModal('callRequestPopup'));

    const commentsEl = el('comments');
    if (commentsEl) {
      commentsEl.addEventListener('click', ev => {
        const badge = ev.target.closest('.call-badge');
        if (badge) { const uid = badge.getAttribute('data-uid'); if (uid) openCallRequestPopup(uid); }
        const img = ev.target.closest('img[data-uid]');
        if (img) { const uid = img.getAttribute('data-uid'); if (uid) openCallRequestPopup(uid); }
      });
    }

    if (arrivalsRef) arrivalsRef.on('child_added', snap => { const d = snap.val(); if (d && d.type === 'arrival') showArrivalBanner(d.name || 'ゲスト'); snap.ref.remove().catch(()=>{}); });

    ensurePollListener();
    initComments();
    initGameAutoSubscribe();
  } catch (e) {
    console.error('DOMContentLoaded handler error', e);
  }
});

// Auth state observer
if (auth) {
  auth.onAuthStateChanged(async user => {
    try {
      const loginBtn = el('loginBtn'), mypageBtn = el('mypageBtn'), logoutBtn = el('logoutBtn'),
            usernameEl = el('username'), avatarEl = el('avatar'), myPoints = el('myPoints');
      if (user) {
        if (loginBtn) loginBtn.style.display='none';
        if (mypageBtn) mypageBtn.style.display='inline-block';
        if (logoutBtn) logoutBtn.style.display='inline-block';
        const name = user.displayName || user.email || 'ユーザー';
        if (usernameEl) usernameEl.textContent = name;
        if (avatarEl) avatarEl.src = user.photoURL || '';
        if (arrivalsRef) arrivalsRef.push({ type:'arrival', name, timestamp: now() }).catch(()=>{});
        attachPresence(user.uid);
        listenIncomingCalls(user.uid);
        try { if (usersRef) { const snap = await usersRef.child(user.uid).child('points').once('value'); const pts = snap.val() || 0; if (myPoints) myPoints.textContent = pts; } } catch(e){}
      } else {
        if (loginBtn) loginBtn.style.display='inline-block';
        if (mypageBtn) mypageBtn.style.display='none';
        if (logoutBtn) logoutBtn.style.display='none';
        if (usernameEl) usernameEl.textContent='';
        if (avatarEl) avatarEl.src='';
        detachPresence();
        stopListeningIncomingCalls();
      }
      // clear login modal error when auth state changes
      const err = el('loginError'); if (err) err.textContent = '';
    } catch(e){ console.error('onAuthStateChanged error', e); }
  });
}

// Presence helpers
function attachPresence(uid){
  if (!uid || !presenceRefRoot) return;
  try {
    myPresenceRef = presenceRefRoot.child(uid);
    myPresenceRef.set({ online:true, lastSeen: now() }).catch(()=>{});
    try { myPresenceRef.onDisconnect().set({ online:false, lastSeen: now() }).catch(()=>{}); } catch(e){}
  } catch(e){ console.error('attachPresence error', e); }
}
function detachPresence(){
  if (myPresenceRef) {
    try { myPresenceRef.set({ online:false, lastSeen: now() }).catch(()=>{}); } catch(e){}
    try { myPresenceRef.onDisconnect().cancel(); } catch(e){}
    myPresenceRef = null;
  }
}

// Profile image upload
function previewProfileFile(){
  const f = el('profileImageFile')?.files?.[0];
  const p = el('assetPreview');
  if (f && p) {
    const url = URL.createObjectURL(f);
    p.innerHTML = `<div style="font-weight:700">プレビュー</div><div style="margin-top:8px"><img src="${url}" style="max-width:160px;max-height:160px;border:1px solid #ddd;padding:4px;background:#fff" /></div>`;
  }
}

async function uploadProfileImage(){
  try {
    if (!auth || !auth.currentUser) return alert('アップロードにはログインが必要です');
    const file = el('profileImageFile')?.files?.[0];
    if (!file) return alert('画像を選択してください');
    if (!storage) {
      alert('Storage 未初期化: Firebase Storage を読み込んでください');
      return;
    }
    const uid = auth.currentUser.uid;
    const ext = file.name.split('.').pop();
    const path = `profiles/${uid}/avatar_${Date.now()}.${ext}`;
    const storageRef = storage.ref().child(path);
    const uploadTask = storageRef.put(file);
    uploadTask.on('state_changed', null, err => {
      console.error('upload error', err); alert('アップロード失敗');
    }, async () => {
      try {
        const url = await storageRef.getDownloadURL();
        await auth.currentUser.updateProfile({ photoURL: url });
        if (usersRef) await usersRef.child(uid).child('profile').update({ photoURL: url }).catch(()=>{});
        el('assetPreview').innerHTML = `<div style="font-weight:700">アップロード完了</div><div style="margin-top:8px"><img src="${url}" style="max-width:160px;max-height:160px;border:1px solid #ddd;padding:4px;background:#fff" /></div>`;
        el('avatar').src = url;
        alert('プロフィール画像をアップロードしました');
      } catch(e) { console.error('upload finalize error', e); alert('アップロード完了後の処理でエラー'); }
    });
  } catch(e) { console.error('uploadProfileImage error', e); alert('アップロード失敗'); }
}

// Comments (kept minimal here)
function getCommentsEl(){ const elc = el('comments'); if(!elc) console.warn('#comments が見つかりません'); return elc; }

function initComments(){
  try {
    if (!db || !commentsRef) { console.warn('initComments: Firebase DB/commentsRef 未利用'); return; }
    const commentsEl = getCommentsEl(); if (!commentsEl) return;

    commentsRef.orderByChild('ts').limitToLast(200).once('value')
      .then(snap => {
        const items = [];
        snap.forEach(ch => { const v = ch.val(); if (v) items.push(v); });
        items.sort((a,b) => (a.ts||0) - (b.ts||0));
        items.forEach(d => { try{ renderComment(d); } catch(e){ console.error('renderComment(initial) error', e); } });
      })
      .catch(err => { console.error('initComments initial once failed', err); })
      .finally(() => {
        commentsRef.orderByChild('ts').limitToLast(500).on('child_added', snap => {
          try {
            const d = snap.val(); if (!d) return;
            renderComment(d);
          } catch(e) { console.error('child_added handler error', e); }
        }, err => { console.error('initComments child_added listener error', err); });
      });
  } catch(e) { console.error('initComments unexpected error', e); }
}

function renderComment(d){
  try {
    const commentsEl = getCommentsEl(); if(!commentsEl) return;
    const key = d._id || (d.uid ? `${d.uid}_${d.ts||Math.floor(Math.random()*1e9)}` : `c_${Math.floor(Math.random()*1e9)}`);
    if (commentsEl.querySelector(`[data-cid="${key}"]`)) return;

    const div = document.createElement('div'); div.className = 'comment'; div.setAttribute('data-cid', key);

    const avatarWrap = document.createElement('div'); avatarWrap.className = 'avatarWrap'; avatarWrap.style.marginRight='10px';
    const img = document.createElement('img'); img.className='avatar'; img.src = d.photo || 'https://via.placeholder.com/40?text=U'; img.width=40; img.height=40; img.style.borderRadius='50%';
    if (d.uid) img.setAttribute('data-uid', d.uid); avatarWrap.appendChild(img);
    const dot = document.createElement('span'); dot.className='presence-dot presence-offline'; dot.id = `presenceDot-${d.uid || key}`; avatarWrap.appendChild(dot);

    const meta = document.createElement('div'); meta.className='meta';
    const timeStr = d.ts ? new Date(d.ts).toLocaleTimeString() : '';
    meta.innerHTML = `<strong>${escapeHtml(d.name||'匿名')} <small style="color:#666;font-weight:400;margin-left:6px">${escapeHtml(timeStr)}</small></strong><div>${escapeHtml(d.text||'')}</div>`;

    const right = document.createElement('div'); right.style.marginLeft='auto'; right.style.display='flex'; right.style.alignItems='center';
    const callBadge = document.createElement('span'); callBadge.className='call-badge'; callBadge.textContent='通話'; if (d.uid) callBadge.setAttribute('data-uid', d.uid);
    right.appendChild(callBadge);

    div.appendChild(avatarWrap); div.appendChild(meta); div.appendChild(right);
    commentsEl.insertBefore(div, commentsEl.firstChild || null);

    if (d.uid && presenceRefRoot) {
      try {
        presenceRefRoot.child(d.uid).on('value', snap => {
          try {
            const v = snap.val(); const dotEl = el(`presenceDot-${d.uid}`);
            if (dotEl) { dotEl.classList.toggle('presence-online', !!v && !!v.online); dotEl.classList.toggle('presence-offline', !v || !v.online); }
          } catch(e) { console.error('presence inner handler error', e); }
        }, err => console.warn('presence listener firebase error', err));
      } catch(e) { console.error('presence listener setup error', e); }
    }
  } catch(e) { console.error('renderComment unexpected error', e); }
}

function sendComment(){
  try {
    const input = el('commentInput'); if(!input) { alert('入力欄が見つかりません'); return; }
    const text = input.value.trim(); if(!text) { alert('コメントを入力してください'); return; }
    if (!auth || !auth.currentUser) { alert('コメントにはログインが必要です'); return; }
    const payload = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー', photo: auth.currentUser.photoURL || '', text, ts: Date.now() };
    if (!commentsRef) { console.error('sendComment: commentsRef 未定義'); return; }
    commentsRef.push(payload).then(()=>{ input.value=''; console.log('sendComment pushed', payload); }).catch(err=>{ console.error('コメント保存エラー', err); alert('送信失敗'); });
  } catch(e) { console.error('sendComment unexpected error', e); }
}

// Polls (kept same as earlier; core functions present)
function addPollOption(){ const wrap = el('pollOptionsWrapper'); if(!wrap) return; const input = document.createElement('input'); input.type='text'; input.className='pollOptionInput'; input.placeholder='選択肢'; wrap.appendChild(input); }
function createPollFromModal(){ try { const q = el('pollQuestion'); if (!q) return alert('質問を入力してください'); const options = Array.from(document.querySelectorAll('.pollOptionInput')).map(i=>i.value.trim()).filter(v=>v); if (!options.length) return alert('選択肢を1つ以上入力してください'); const poll = { active:true, question:q.value.trim(), options: options.map((label,idx)=>({ id:'o'+idx+'_'+now(), label, count:0 })), state:'voting', startedAt: now(), endsAt: now() + POLL_DURATION_MS, votes: {} }; if (pollsRef) pollsRef.child('active').set(poll).then(()=>{ closeModal('pollModal'); }).catch(err=>{ console.error('createPoll error', err); alert('アンケート作成失敗'); }); } catch(e){ console.error('createPollFromModal error', e); } }
function ensurePollListener(){ try { if (!pollsRef) return; pollsRef.child('active').on('value', snap => { const data = snap.val(); if (!data || data.active !== true) { hidePollUI(); return; } renderPollState(data); if (data.state === 'finished') { if (_pollRemovalTimeout) clearTimeout(_pollRemovalTimeout); _pollRemovalTimeout = setTimeout(async ()=>{ try { const snapCheck = await pollsRef.child('active').once('value'); const cur = snapCheck.val(); if (cur && cur.state === 'finished') await pollsRef.child('active').remove(); } catch(e){ console.error(e); } finally { hidePollUI(); if (_pollTimers.has('active')){ clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } _pollRemovalTimeout = null; } }, POLL_AFTER_FINISH_DISPLAY_MS); } if (data.state === 'voting' && now() >= (data.endsAt || 0)) finalizePoll(); }, err => console.warn('poll listener error', err)); } catch(e){ console.error('ensurePollListener error', e); } }
function renderPollState(poll){ const pollArea = el('pollArea'); const pollContent = el('pollContent'); const pollTimer = el('pollTimer'); if (!pollArea || !pollContent) return; pollArea.style.display = 'block'; pollContent.innerHTML = ''; const header = document.createElement('div'); header.className = 'poll-header'; const q = document.createElement('div'); q.className = 'poll-question'; q.textContent = poll.question || ''; header.appendChild(q); pollContent.appendChild(header); const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options'; const total = (poll.options || []).reduce((s,o)=>s+(o.count||0),0) || 0; (poll.options||[]).forEach(o => { const opt = document.createElement('div'); opt.className='poll-option'; opt.dataset.optId = o.id; const pct = total === 0 ? 0 : Math.round(((o.count||0)/ total)*100); opt.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`; if (poll.state === 'voting') opt.addEventListener('click', ()=>voteOption(o.id)); else opt.style.opacity='0.7'; optionsWrap.appendChild(opt); }); pollContent.appendChild(optionsWrap); if (pollTimer) { if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } if (poll.state === 'voting') { const updateFn = ()=>{ const remainingMs = Math.max(0,(poll.endsAt||0) - now()); if (remainingMs <= 0) { if (pollTimer) pollTimer.textContent = '集計中...'; finalizePoll().catch(err=>console.error(err)); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } return; } if (pollTimer) pollTimer.textContent = `残り ${Math.ceil(remainingMs/1000)} 秒`; }; updateFn(); const t = setInterval(updateFn,500); _pollTimers.set('active', t); } else { pollTimer.textContent = '投票終了'; } } }
function hidePollUI(){ const pa = el('pollArea'); if(pa) pa.style.display='none'; const pc = el('pollContent'); if(pc) pc.innerHTML=''; }
function voteOption(optId){ try { const user = auth?.currentUser; if (!user) return alert('投票にはログインが必要です'); const uid = user.uid; const activeRef = pollsRef.child('active'); activeRef.transaction(current => { if (!current) return current; if (current.state !== 'voting') return current; const prev = current.votes && current.votes[uid] && current.votes[uid].opt; if (prev) { const idxPrev = (current.options||[]).findIndex(o=>o.id===prev); if (idxPrev>=0) current.options[idxPrev].count = Math.max(0,(current.options[idxPrev].count||0)-1); } const idx = (current.options||[]).findIndex(o=>o.id===optId); if (idx>=0) current.options[idx].count = (current.options[idx].count||0) + 1; if (!current.votes) current.votes = {}; current.votes[uid] = { opt: optId, at: now(), name: user.displayName || user.email || 'ユーザー' }; return current; }, (err)=>{ if (err) console.error('vote txn error', err); }); } catch(e){ console.error('voteOption error', e); } }
async function finalizePoll(){ try { const activeRef = pollsRef.child('active'); const snap = await activeRef.once('value'); const poll = snap.val(); if (!poll) return; if (poll.state === 'finished') return; await activeRef.update({ state:'finished', finishedAt: now() }); await pollsRef.child('history').push(poll).catch(()=>{}); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } } catch(e){ console.error('finalizePoll error', e); } }

// Game functions (kept minimal)
function isHost(){ if (gameLocalState && gameLocalState.hostUid) return !!auth?.currentUser && auth.currentUser.uid === gameLocalState.hostUid; return !!auth?.currentUser; }
async function startGameByHost(){ try { if (!auth?.currentUser) return alert('ゲーム開始はログインが必要です'); const chosen = document.querySelector('.gameChoice[data-selected="true"]'); if (!chosen) return alert('ゲームを選択してください'); const gameType = chosen.getAttribute('data-game'); const spectatorsAllowed = !!el('publicGame')?.checked; const gid = gamesRef ? gamesRef.push().key : ('g_' + Math.floor(Math.random()*1e9)); const gameObj = { id: gid, type: gameType, hostUid: auth.currentUser.uid, status: 'lobby', createdAt: now(), players:{}, spectatorsAllowed: !!spectatorsAllowed, winnerUid: null }; if (gamesRef) { await gamesRef.child(gid).set(gameObj); openGameUI(gid, gameObj); } else openGameUI(gid, gameObj); closeModal('gameModal'); } catch(e){ console.error('startGame error', e); alert('ゲーム作成に失敗しました'); } }
function openGameUI(gid, initialObj){ if (!gid) return; try { if (currentGameId && gamesRef) gamesRef.child(currentGameId).off(); } catch(e){} currentGameId = gid; gameLocalState = initialObj || null; const ga = el('gameArea'); if (ga) ga.style.display = 'block'; renderGameHeader(initialObj || {}); if (!gamesRef) return; gamesRef.child(gid).on('value', snap => { const g = snap.val(); if (!g) { closeGameUI(); return; } gameLocalState = g; renderGameState(g); renderGameHeader(g); }); }
function renderGameHeader(game){ const title = el('gameTitle'); if (title) title.textContent = game.type === 'shogi' ? '将棋（対戦）' : 'ゲーム'; const controls = el('gameControls'); if (!controls) return; controls.innerHTML = ''; const statusBadge = document.createElement('span'); statusBadge.textContent = game.status || 'lobby'; statusBadge.style.marginRight='8px'; statusBadge.style.fontWeight='700'; controls.appendChild(statusBadge); const hostInfo = document.createElement('span'); hostInfo.textContent = game.hostUid ? `主催: ${game.hostUid}` : '主催: なし'; hostInfo.style.marginRight='12px'; hostInfo.style.opacity='0.85'; controls.appendChild(hostInfo); const assetsInfo = document.createElement('div'); assetsInfo.style.display='inline-flex'; assetsInfo.style.flexDirection='column'; assetsInfo.style.marginLeft='12px'; assetsInfo.innerHTML = `<div style="font-size:12px;color:#666">駒/盤: デフォルト</div>`; controls.appendChild(assetsInfo); if (auth?.currentUser) { if (game.status === 'lobby') { const joinBtn = document.createElement('button'); joinBtn.textContent='参加希望'; joinBtn.addEventListener('click', ()=> requestJoinGame(game.id)); controls.appendChild(joinBtn); if (auth.currentUser.uid === game.hostUid) { const pickBtn = document.createElement('button'); pickBtn.textContent='参加者から選出して開始'; pickBtn.addEventListener('click', ()=> pickAndStartGame(game.id)); controls.appendChild(pickBtn); } } else if (game.status === 'running') { if (auth.currentUser.uid === game.hostUid) { const endBtn = document.createElement('button'); endBtn.textContent='強制終了'; endBtn.addEventListener('click', ()=> endGame(game.id, null)); controls.appendChild(endBtn); } } } else { const info = document.createElement('span'); info.textContent='参加するにはログインしてください'; info.style.marginLeft='8px'; info.style.color='#666'; controls.appendChild(info); } }
async function requestJoinGame(gid){ if (!auth?.currentUser) return alert('ログインしてください'); const u = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー', accepted:false, ts: now() }; if (gamesRef) await gamesRef.child(gid).child('players').child(u.uid).set(u); alert('参加希望を出しました。主催者が選出するまでお待ちください。'); }
async function pickAndStartGame(gid){ try { if (!gamesRef) return alert('サーバ未接続のため簡易開始は不可'); const snap = await gamesRef.child(gid).child('players').once('value'); const players = []; snap.forEach(ch=>{ const v = ch.val(); if (v && v.uid) players.push(v); }); const candidates = players.filter(p=>p.uid !== auth.currentUser.uid); if (candidates.length === 0) return alert('参加希望者がいません'); const pick = candidates[Math.floor(Math.random()*candidates.length)]; const updates = {}; updates[`players/${auth.currentUser.uid}`] = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || '主催者', accepted:true, role:'host', ts: now() }; updates[`players/${pick.uid}`] = { uid: pick.uid, name: pick.name, accepted:true, role:'player', ts: now() }; updates['status'] = 'running'; updates['startedAt'] = now(); updates['activePlayers'] = { [auth.currentUser.uid]: true, [pick.uid]: true }; await gamesRef.child(gid).update(updates); await gamesRef.child(gid).child('shogi').set({ board: initialShogiBoard(), turn: auth.currentUser.uid, moves: [] }); } catch(e){ console.error('pickAndStartGame error', e); } }
function initialShogiBoard(){ return [ ['l','n','s','g','k','g','s','n','l'], ['.','r','.','.','.','.','.','b','.'], ['p','p','p','p','p','p','p','p','p'], ['.','.','.','.','.','.','.','.','.'], ['.','.','.','.','.','.','.','.','.'], ['.','.','.','.','.','.','.','.','.'], ['P','P','P','P','P','P','P','P','P'], ['.','B','.','.','.','.','.','R','.'], ['L','N','S','G','K','G','S','N','L'] ]; }
function renderGameState(game){ if (!game) return; if (game.type === 'shogi') { const shogi = game.shogi || game.shogiState || {}; renderShogiBoard(game.id, shogi); } }
async function renderShogiBoard(gid, shogiState){ const container = el('shogiContainer'); if (!container) return; container.innerHTML = ''; const boardWrap = document.createElement('div'); boardWrap.className = 'shogiBoard'; boardWrap.style.position='relative'; boardWrap.style.padding='8px'; boardWrap.style.boxSizing='border-box'; const size = 9; const grid = document.createElement('div'); grid.className='grid'; grid.style.display='grid'; grid.style.gridTemplateColumns = `repeat(${size},1fr)`; grid.style.gap='2px'; grid.style.width='100%'; grid.style.height='100%'; const board = (shogiState && shogiState.board) ? shogiState.board : initialShogiBoard(); for (let r=0;r<size;r++){ for (let c=0;c<size;c++){ const sq = document.createElement('div'); sq.className='grid-cell'; sq.dataset.r=r; sq.dataset.c=c; sq.style.minHeight=`${Math.floor(320/9)}px`; const piece = board[r][c]; if (piece && piece !== '.') { const img = document.createElement('img'); img.style.maxWidth='70%'; img.style.maxHeight='70%'; img.alt = piece; img.src = '/assets/koma/pawn.png'; const isSente = piece === piece.toUpperCase(); if (!isSente) img.classList.add('koma-gote'); else img.classList.remove('koma-gote'); sq.appendChild(img); } grid.appendChild(sq); } } boardWrap.appendChild(grid); container.appendChild(boardWrap); }
async function makeShogiMove(gid, uid, from, to){ try { if (!gamesRef) return; const shogiRef = gamesRef.child(gid).child('shogi'); await shogiRef.transaction(current => { if (!current) return current; const board = current.board || initialShogiBoard(); const piece = board[from.r][from.c]; if (!piece || piece === '.') return; board[to.r][to.c] = piece; board[from.r][from.c] = '.'; const moves = current.moves || []; moves.push({ by: uid, from, to, ts: now() }); const activePlayers = gameLocalState && gameLocalState.activePlayers ? Object.keys(gameLocalState.activePlayers) : []; const other = activePlayers.find(u=>u!==uid) || uid; current.board = board; current.moves = moves; current.turn = other; return current; }); } catch(e){ console.error('makeShogiMove error', e); } }
async function endGame(gid, winnerUid){ try { if (!gamesRef) return; const updates = { status:'finished', finishedAt: now(), winnerUid: winnerUid || null }; await gamesRef.child(gid).update(updates); setTimeout(async ()=>{ try { await gamesRef.child(gid).remove(); } catch(e){ console.warn('remove game failed', e); } closeGameUI(); }, 2000); } catch(e){ console.error('endGame error', e); } }
function closeGameUI(){ try { if (currentGameId && gamesRef) gamesRef.child(currentGameId).off(); } catch(e){} currentGameId=null; gameLocalState=null; const ga=el('gameArea'); if(ga)ga.style.display='none'; }
function initGameAutoSubscribe(){ try { if (!gamesRef) return; gamesRef.orderByChild('status').equalTo('lobby').on('child_added', snap=>{ const g=snap.val(); if(!g) return; if(!currentGameId) openGameUI(g.id,g); }); gamesRef.orderByChild('status').equalTo('running').on('child_added', snap=>{ const g=snap.val(); if(!g) return; openGameUI(g.id,g); }); gamesRef.on('child_changed', snap=>{ const g=snap.val(); if(!g) return; if (currentGameId === g.id) { gameLocalState = g; renderGameState(g); renderGameHeader(g); } }); gamesRef.on('child_removed', snap=>{ const removed = snap.val(); if(!removed) return; if (currentGameId === removed.id) closeGameUI(); }); } catch(e){ console.error('initGameAutoSubscribe error', e); } }

// Calls placeholders
function openCallRequestPopup(uid){ const content = el('callRequestContent'); if (content) content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`; window._callTargetUid = uid; openModal('callRequestPopup'); }
function sendCallRequestFromPopup(){ /* signaling を実装 */ }
function listenIncomingCalls(myUid){ /* optional */ }
function stopListeningIncomingCalls(){ /* optional */ }
function respondToIncomingCall(result){ /* optional */ }

// Debug
window.checkDebug = function(){
  console.log('firebase loaded?', typeof firebase !== 'undefined');
  console.log('auth.currentUser', auth?.currentUser || null);
  console.log('GAS_URL', GAS_URL);
  console.log('DOM elements:', { comments: !!el('comments'), pollArea: !!el('pollArea'), gameArea: !!el('gameArea') });
};
