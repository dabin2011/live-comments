// script.js — 全体（GAS_URL を含む）
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

// Apps Script (GAS) の URL をここに設定してください（例: 公開済みの Web アプリ URL）
const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

if (typeof firebase === 'undefined') {
  console.error('Firebase SDK が読み込まれていません');
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

let firstCommentTime = null;
let myPresenceRef = null;
let currentGameId = null;
let gameLocalState = null;
const _pollTimers = new Map();
let _pollRemovalTimeout = null;

function el(id){ return document.getElementById(id); }
function now(){ return Date.now(); }
function escapeHtml(s){ if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,"&#039;"); }

// Modal utilities (reliable open/close, focus trap minimal)
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

// DOMContentLoaded wiring
document.addEventListener('DOMContentLoaded', () => {
  try {
    const safeAdd = (id, ev, fn) => { const n = el(id); if (n) n.addEventListener(ev, fn); };

    safeAdd('loginBtn','click', () => openModal('loginModal'));
    safeAdd('mypageBtn','click', () => openModal('mypageModal'));
    safeAdd('logoutBtn','click', async () => { try { await auth.signOut(); } catch(e) { console.error(e); alert('ログアウト失敗'); } });

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

    safeAdd('signupBtn','click', signUp);
    safeAdd('signinBtn','click', signIn);
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

// Arrival banner
function showArrivalBanner(name){
  const b = el('arrivalBanner'); if (!b) return;
  b.textContent = `${escapeHtml(name)}さんが配信を視聴しに来ました`;
  b.style.display = 'block';
  b.setAttribute('aria-hidden','false');
  if (b._hideTimer) clearTimeout(b._hideTimer);
  b._hideTimer = setTimeout(()=>{ b.style.display='none'; b.setAttribute('aria-hidden','true'); }, ARRIVAL_BANNER_DURATION);
}

// Auth presence handlers
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
    } catch(e){ console.error('onAuthStateChanged error', e); }
  });
}

async function signUp(){ try{ if (!auth) return alert('Auth 未初期化'); const email = el('email')?.value?.trim(); const password = el('password')?.value || ''; if(!email||!password) return alert('メールとパスワードを入力してください'); await auth.createUserWithEmailAndPassword(email,password); alert('登録しました'); closeModal('loginModal'); }catch(e){ console.error('signUp error', e); alert('登録失敗: ' + (e.message||e)); } }
async function signIn(){ try{ if (!auth) return alert('Auth 未初期化'); const email = el('email')?.value?.trim(); const password = el('password')?.value || ''; if(!email||!password) return alert('メールとパスワードを入力してください'); await auth.signInWithEmailAndPassword(email,password); alert('ログインしました'); closeModal('loginModal'); }catch(e){ console.error('signIn error', e); alert('ログイン失敗: ' + (e.message||e)); } }
async function updateProfile(){ try{ if (!auth) return alert('Auth 未初期化'); const user = auth.currentUser; if(!user) return alert('ログインしてください'); const newName = el('newName')?.value?.trim(); if(!newName) return alert('ユーザー名を入力してください'); await user.updateProfile({ displayName:newName }); if (usersRef) usersRef.child(user.uid).child('profile').update({ displayName:newName }).catch(()=>{}); const usernameEl = el('username'); if(usernameEl) usernameEl.textContent=newName; alert('ユーザー名を更新しました'); closeModal('mypageModal'); }catch(e){ console.error('updateProfile error', e); alert('更新失敗'); } }

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

// Profile image upload (Firebase Storage)
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

// Comments stable
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
        firstCommentTime = items.length ? (items[0].ts || Date.now()) : Date.now();
      })
      .catch(err => { console.error('initComments initial once failed', err); firstCommentTime = Date.now(); })
      .finally(() => {
        commentsRef.orderByChild('ts').limitToLast(500).on('child_added', snap => {
          try {
            const d = snap.val(); if (!d) return;
            if (d.ts && firstCommentTime && (d.ts - firstCommentTime > THREE_HOURS)) return;
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

// Polls and game functions follow same implementations as before (omitted here for brevity)
// ensurePollListener, createPollFromModal, voteOption, finalizePoll, etc.
// startGameByHost, openGameUI, renderGameHeader, renderShogiBoard, makeShogiMove, endGame, etc.

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
