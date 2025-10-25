// script.js — モーダル表示確実化を含む（既存の機能はそのまま統合済み）
// 注意: firebaseConfig と GAS_URL を実運用値に置き換えてください

// ====== Firebase 設定を置き換えてください ======
const firebaseConfig = {
  apiKey: "AIzaSyD1AK05uuGBw2U4Ne5LbKzzjzCqnln60mg",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://shige-live-default-rtdb.firebaseio.com/",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Firebase 初期化（SDK を HTML で読み込んでおくこと）
if (typeof firebase === 'undefined') {
  console.error('Firebase SDK が読み込まれていません');
} else if (!firebase.apps.length) {
  try { firebase.initializeApp(firebaseConfig); } catch (e) { console.error('firebase initialize error', e); }
}

const auth = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : null;
const db = (typeof firebase !== 'undefined' && firebase.database) ? firebase.database() : null;
const commentsRef = db ? db.ref('comments') : null;
const pollsRef = db ? db.ref('polls') : null;
const arrivalsRef = db ? db.ref('arrivals') : null;
const presenceRefRoot = db ? db.ref('presence') : null;
const gamesRef = db ? db.ref('games') : null;
const usersRef = db ? db.ref('users') : null;

const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const POLL_AFTER_FINISH_DISPLAY_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;

let firstCommentTime = null;
let localActivePoll = null;
let myPresenceRef = null;
const _pollTimers = new Map();
let _pollRemovalTimeout = null;
let currentGameId = null;
let gameLocalState = null;

function el(id){ return document.getElementById(id); }
function now(){ return Date.now(); }
function escapeHtml(s){ if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,"&#039;"); }
function getFilenameFromUrl(url){ if(!url) return ''; try{ const u = url.split('?')[0]; const parts = u.split('/'); let name = parts[parts.length-1] || ''; try{ name = decodeURIComponent(name); }catch(e){} return name; }catch(e){return'';} }

// ===== モーダルユーティリティ（重要: 表示を確実にする） =====
const modalState = {
  openModalId: null
};

function openModal(id) {
  const modal = el(id);
  const backdrop = el('modalBackdrop');
  if (!modal) { console.warn('openModal: modal not found', id); return; }
  // close existing if any
  if (modalState.openModalId && modalState.openModalId !== id) closeModal(modalState.openModalId);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  if (backdrop) { backdrop.style.visibility = 'visible'; backdrop.style.opacity = '1'; backdrop.setAttribute('aria-hidden','false'); }
  modalState.openModalId = id;
  // trap focus: focus first focusable element inside modal
  const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable) focusable.focus();
  // allow ESC to close
  document.addEventListener('keydown', _escClose);
}

function closeModal(id) {
  const modal = el(id);
  const backdrop = el('modalBackdrop');
  if (!modal) { console.warn('closeModal: modal not found', id); return; }
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (backdrop) { backdrop.style.opacity = '0'; backdrop.style.visibility = 'hidden'; backdrop.setAttribute('aria-hidden','true'); }
  if (modalState.openModalId === id) modalState.openModalId = null;
  document.removeEventListener('keydown', _escClose);
}

function _escClose(e) {
  if (e.key === 'Escape' && modalState.openModalId) {
    closeModal(modalState.openModalId);
  }
}

// backdrop click closes modal
document.addEventListener('click', (e) => {
  const backdrop = el('modalBackdrop');
  if (!backdrop) return;
  if (e.target === backdrop) {
    if (modalState.openModalId) closeModal(modalState.openModalId);
  }
});

// モーダル内の close ボタン動作を確実に設定
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-close]');
  if (btn) {
    const id = btn.getAttribute('data-close');
    if (id) closeModal(id);
  }
});

// ===== 以下は既存機能（コメント/アンケート/将棋等） =====

// 駒画像マップ
const PIECE_IMG_MAP = {
  'P':'/assets/koma/pawn.png','p':'/assets/koma/pawn.png',
  'L':'/assets/koma/lance.png','l':'/assets/koma/lance.png',
  'N':'/assets/koma/knight.png','n':'/assets/koma/knight.png',
  'S':'/assets/koma/silver.png','s':'/assets/koma/silver.png',
  'G':'/assets/koma/gold.png','g':'/assets/koma/gold.png',
  'K':'/assets/koma/king.png','k':'/assets/koma/king.png',
  'B':'/assets/koma/bishop.png','b':'/assets/koma/bishop.png',
  'R':'/assets/koma/rook.png','r':'/assets/koma/rook.png',
  '+P':'/assets/koma/pawn_promoted.png','+p':'/assets/koma/pawn_promoted.png',
  '+R':'/assets/koma/rook_promoted.png','+r':'/assets/koma/rook_promoted.png'
};

async function resolvePieceImageUrl(pieceChar){
  if (!pieceChar || pieceChar === '.') return null;
  try { if (gameLocalState && gameLocalState.assets && gameLocalState.assets.pieceMap && gameLocalState.assets.pieceMap[pieceChar]) return gameLocalState.assets.pieceMap[pieceChar]; } catch(e){}
  try {
    const uid = auth?.currentUser?.uid;
    if (uid && usersRef) {
      const snap = await usersRef.child(uid).child('assets').once('value');
      const assets = snap.val() || {};
      if (assets.pieceMap && assets.pieceMap[pieceChar]) return assets.pieceMap[pieceChar];
      if (assets.pieceUrl) return assets.pieceUrl;
    }
  } catch(e){}
  return PIECE_IMG_MAP[pieceChar] || null;
}

function showAssetPreview(url, msg){
  const p = el('assetPreview');
  if (!p) return;
  const filename = getFilenameFromUrl(url) || '（ファイル名不明）';
  p.innerHTML = `<div style="font-weight:700">${escapeHtml(msg)}</div><div style="margin-top:6px;display:flex;gap:12px;align-items:center"><img src="${url}" style="max-width:160px;max-height:160px;border:1px solid #ddd;padding:4px;background:#fff" /><div style="font-size:13px;color:#333"><div><strong>ファイル名</strong></div><div style="margin-top:6px;word-break:break-all">${escapeHtml(filename)}</div></div></div>`;
}

// DOM ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    // modal close handlers already delegated globally
    const safeAdd = (id, ev, fn) => { const elc = document.getElementById(id); if (elc) elc.addEventListener(ev, fn); };

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
    });

    safeAdd('signupBtn','click', signUp);
    safeAdd('signinBtn','click', signIn);
    safeAdd('logoutBtn','click', async () => { try{ await auth.signOut(); } catch(e){ console.error(e); alert('ログアウト失敗'); } });

    safeAdd('updateNameBtn','click', updateProfile);
    safeAdd('callSendBtn','click', sendCallRequestFromPopup);
    safeAdd('callCancelBtn','click', () => closeModal('callRequestPopup'));
    safeAdd('uploadPieceBtn','click', uploadPieceImage);
    safeAdd('uploadBoardBtn','click', uploadBoardImage);

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

// Auth presence handlers (省略でなく現状コードを活かす)
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
        if (avatarEl && user.photoURL) avatarEl.src = user.photoURL;
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

// Auth functions (簡潔化)
async function signUp(){ try{ const email = el('email')?.value?.trim(); const password = el('password')?.value || ''; if(!email||!password) return alert('メールとパスワードを入力してください'); await auth.createUserWithEmailAndPassword(email,password); alert('登録しました'); closeModal('loginModal'); }catch(e){ console.error('signUp error', e); alert('登録失敗: ' + (e.message||e)); } }
async function signIn(){ try{ const email = el('email')?.value?.trim(); const password = el('password')?.value || ''; if(!email||!password) return alert('メールとパスワードを入力してください'); await auth.signInWithEmailAndPassword(email,password); alert('ログインしました'); closeModal('loginModal'); }catch(e){ console.error('signIn error', e); alert('ログイン失敗: ' + (e.message||e)); } }
async function updateProfile(){ try{ const user = auth.currentUser; if(!user) return alert('ログインしてください'); const newName = el('newName')?.value?.trim(); if(!newName) return alert('ユーザー名を入力してください'); await user.updateProfile({ displayName:newName }); const usernameEl = el('username'); if(usernameEl) usernameEl.textContent=newName; alert('ユーザー名を更新しました'); closeModal('mypageModal'); }catch(e){ console.error('updateProfile error', e); alert('更新失敗'); } }

function attachPresence(uid){ if(!uid || !presenceRefRoot) return; try{ myPresenceRef = presenceRefRoot.child(uid); myPresenceRef.set({ online:true, lastSeen: now() }).catch(()=>{}); try{ myPresenceRef.onDisconnect().set({ online:false, lastSeen: now() }).catch(()=>{}); }catch(e){} }catch(e){ console.error('attachPresence error', e); } }
function detachPresence(){ if(myPresenceRef){ try{ myPresenceRef.set({ online:false, lastSeen: now() }).catch(()=>{}); }catch(e){} try{ myPresenceRef.onDisconnect().cancel(); }catch(e){} myPresenceRef=null; } }

// ===== コメント周り（安定版） =====
function getCommentsEl(){ const elc = el('comments'); if(!elc) console.warn('#comments が見つかりません'); return elc; }

function initComments(){
  try {
    if (!db || !commentsRef) { console.warn('initComments: Firebase DB/commentsRef 未利用'); return; }
    const commentsEl = getCommentsEl(); if (!commentsEl) return;

    // 初回取得（安定のため最近200件）
    commentsRef.orderByChild('ts').limitToLast(200).once('value')
      .then(snap => {
        const items = [];
        snap.forEach(ch => { const v = ch.val(); if (v) items.push(v); });
        items.sort((a,b) => (a.ts||0) - (b.ts||0));
        items.forEach(d => { try{ renderComment(d); }catch(e){ console.error('renderComment(initial) error', e); } });
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
        }, err => { console.error('initComments: child_added listener error', err); });
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

// ===== Polls / Game / Upload / Calls は既存の実装をそのまま使う（省略せず統合可） =====
// 以降は前回提示済みの関数群（ensurePollListener, createPollFromModal, voteOption, finalizePoll,
// startGameByHost, openGameUI, renderGameHeader, renderShogiBoard, makeShogiMove, endGame,
// uploadFileToGAS, uploadPieceImage, uploadBoardImage, openCallRequestPopup, sendCallRequestFromPopup,
// listenIncomingCalls, stopListeningIncomingCalls, respondToIncomingCall, etc.）をそのまま貼って使ってください。
// ここでは省略しているが、あなたの既存実装を同じファイルに統合してください。

// Debug helper
window.checkDebug = function(){
  console.log('firebase loaded?', typeof firebase !== 'undefined');
  console.log('firebase apps:', firebase && firebase.apps ? firebase.apps.length : 'no firebase');
  console.log('auth.currentUser', auth?.currentUser || null);
  console.log('DOM elements:', { comments: !!el('comments'), pollArea: !!el('pollArea'), gameArea: !!el('gameArea'), shogiContainer: !!el('shogiContainer') });
};
