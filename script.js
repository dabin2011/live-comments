// script.js — コメント・アンケート・将棋（画像駒・後手は回転で表現）
// 必ず firebaseConfig と GAS_URL を実環境の値に置き換えてください。

// ====== Firebase 設定を置き換えてください ======
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

if (typeof firebase === 'undefined') {
  console.error('Firebase SDK が読み込まれていません');
} else if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref('comments');
const pollsRef = db.ref('polls');
const arrivalsRef = db.ref('arrivals');
const presenceRefRoot = db.ref('presence');
const gamesRef = db.ref('games');
const usersRef = db.ref('users');

// Apps Script Web アプリ URL (画像アップロード)
const GAS_URL = "https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXX/exec";

// Constants
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const POLL_AFTER_FINISH_DISPLAY_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;

// Local state
let firstCommentTime = null;
let localActivePoll = null;
let myPresenceRef = null;
const _pollTimers = new Map();
let _pollRemovalTimeout = null;

// Game state
let currentGameId = null;
let gameLocalState = null;

// Utilities
function el(id) { return document.getElementById(id); }
function now() { return Date.now(); }
function escapeHtml(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

// Modal helpers
window.openModal = function (id) {
  const m = el(id);
  if (!m) return console.warn('openModal: not found', id);
  m.style.display = 'flex';
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  m.style.zIndex = 999999;
  const focusable = m.querySelector('button, input, select, textarea, [tabindex]') || null;
  if (focusable) focusable.focus();
};
window.closeModal = function (id) {
  const m = el(id);
  if (!m) return console.warn('closeModal: not found', id);
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  m.style.display = 'none';
};

// Default piece image map (1枚で先後共有する前提)
const PIECE_IMG_MAP = {
  'P': '/assets/koma/pawn.png', 'p': '/assets/koma/pawn.png',
  'L': '/assets/koma/lance.png', 'l': '/assets/koma/lance.png',
  'N': '/assets/koma/knight.png','n':'/assets/koma/knight.png',
  'S': '/assets/koma/silver.png','s':'/assets/koma/silver.png',
  'G': '/assets/koma/gold.png','g':'/assets/koma/gold.png',
  'K': '/assets/koma/king.png','k':'/assets/koma/king.png',
  'B': '/assets/koma/bishop.png','b':'/assets/koma/bishop.png',
  'R': '/assets/koma/rook.png','r':'/assets/koma/rook.png',
  '+P':'/assets/koma/pawn_promoted.png', '+p':'/assets/koma/pawn_promoted.png',
  '+R':'/assets/koma/rook_promoted.png','+r':'/assets/koma/rook_promoted.png'
};

// resolve piece image URL: game assets -> user assets -> default map
async function resolvePieceImageUrl(pieceChar) {
  if (!pieceChar || pieceChar === '.') return null;
  try {
    if (gameLocalState && gameLocalState.assets && gameLocalState.assets.pieceMap && gameLocalState.assets.pieceMap[pieceChar]) {
      return gameLocalState.assets.pieceMap[pieceChar];
    }
  } catch (e) {}
  try {
    const uid = auth.currentUser?.uid;
    if (uid) {
      const snap = await usersRef.child(uid).child('assets').once('value');
      const assets = snap.val() || {};
      if (assets.pieceMap && assets.pieceMap[pieceChar]) return assets.pieceMap[pieceChar];
      if (assets.pieceUrl) return assets.pieceUrl;
    }
  } catch (e) {}
  return PIECE_IMG_MAP[pieceChar] || null;
}

// DOM ready
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal .close').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-close') || btn.closest('.modal')?.id;
    if (id) closeModal(id);
  }));
  document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); }));

  const safeAdd = (id, ev, fn) => { const elc = document.getElementById(id); if (elc) elc.addEventListener(ev, fn); };
  safeAdd('sendBtn', 'click', sendComment);
  safeAdd('pollBtn', 'click', () => openModal('pollModal'));
  safeAdd('addPollOptionBtn', 'click', addPollOption);
  safeAdd('createPollBtn', 'click', createPollFromModal);

  safeAdd('gameBtn', 'click', () => openModal('gameModal'));
  safeAdd('startGameBtn', 'click', startGameByHost);
  document.querySelectorAll('.gameChoice').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.gameChoice').forEach(b => b.removeAttribute('data-selected'));
    btn.setAttribute('data-selected', 'true');
  }));

  safeAdd('signupBtn', 'click', signUp);
  safeAdd('signinBtn', 'click', signIn);
  safeAdd('logoutBtn', 'click', async () => { try { await auth.signOut(); } catch (err) { console.error(err); alert('ログアウト失敗'); } });
  safeAdd('updateNameBtn', 'click', updateProfile);

  safeAdd('callCancelBtn', 'click', () => closeModal('callRequestPopup'));
  safeAdd('callSendBtn', 'click', sendCallRequestFromPopup);
  safeAdd('rejectCallBtn', 'click', () => respondToIncomingCall('rejected'));
  safeAdd('acceptCallBtn', 'click', () => respondToIncomingCall('accepted'));
  safeAdd('callNotifyClose', 'click', () => closeModal('callNotifyPopup'));

  const uf = el('uploadForm'); if (uf) uf.addEventListener('submit', handleUploadForm);

  // asset upload buttons
  safeAdd('uploadPieceBtn','click', uploadPieceImage);
  safeAdd('uploadBoardBtn','click', uploadBoardImage);

  arrivalsRef.on('child_added', snap => {
    const d = snap.val();
    if (d && d.type === 'arrival') showArrivalBanner(d.name || 'ゲスト');
    snap.ref.remove().catch(() => { });
  });

  ensurePollListener();
  initComments();
  initGameAutoSubscribe();
});

// Arrival banner
function showArrivalBanner(name) {
  const b = el('arrivalBanner'); if (!b) return;
  b.textContent = `${escapeHtml(name)}さんが配信を視聴しに来ました`;
  b.style.display = 'block';
  if (b._hideTimer) clearTimeout(b._hideTimer);
  b._hideTimer = setTimeout(() => { b.style.display = 'none'; }, ARRIVAL_BANNER_DURATION);
}

// Auth & presence
auth.onAuthStateChanged(async user => {
  const loginBtn = el('loginBtn'), mypageBtn = el('mypageBtn'), logoutBtn = el('logoutBtn'),
    usernameEl = el('username'), avatarEl = el('avatar'), myPoints = el('myPoints');

  if (user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (mypageBtn) mypageBtn.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
    const name = user.displayName || user.email || 'ユーザー';
    if (usernameEl) usernameEl.textContent = name;
    if (avatarEl && user.photoURL) avatarEl.src = user.photoURL;
    arrivalsRef.push({ type: 'arrival', name, timestamp: now() }).catch(() => { });
    attachPresence(user.uid);
    listenIncomingCalls(user.uid);
    try { const snap = await usersRef.child(user.uid).child('points').once('value'); const pts = snap.val() || 0; if (myPoints) myPoints.textContent = pts; } catch (e) {}
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (mypageBtn) mypageBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (usernameEl) usernameEl.textContent = '';
    if (avatarEl) avatarEl.src = '';
    detachPresence();
    stopListeningIncomingCalls();
  }
});

// Auth functions
async function signUp() { const email = el('email')?.value?.trim(); const password = el('password')?.value || ''; if (!email || !password) return alert('メールとパスワードを入力してください'); try { await auth.createUserWithEmailAndPassword(email, password); alert('登録しました'); closeModal('loginModal'); } catch (e) { console.error(e); alert('登録失敗: ' + (e.message || e)); } }
async function signIn() { const email = el('email')?.value?.trim(); const password = el('password')?.value || ''; if (!email || !password) return alert('メールとパスワードを入力してください'); try { await auth.signInWithEmailAndPassword(email, password); alert('ログインしました'); closeModal('loginModal'); } catch (e) { console.error(e); alert('ログイン失敗: ' + (e.message || e)); } }
async function updateProfile() { const user = auth.currentUser; if (!user) return alert('ログインしてください'); const newName = el('newName')?.value?.trim(); if (!newName) return alert('ユーザー名を入力してください'); try { await user.updateProfile({ displayName: newName }); const usernameEl = el('username'); if (usernameEl) usernameEl.textContent = newName; alert('ユーザー名を更新しました'); closeModal('mypageModal'); } catch (err) { console.error(err); alert('更新失敗'); } }

function attachPresence(uid) {
  if (!uid) return;
  myPresenceRef = presenceRefRoot.child(uid);
  myPresenceRef.set({ online: true, lastSeen: now() }).catch(() => { });
  try { myPresenceRef.onDisconnect().set({ online: false, lastSeen: now() }).catch(() => { }); } catch (e) {}
}
function detachPresence() {
  if (myPresenceRef) {
    myPresenceRef.set({ online: false, lastSeen: now() }).catch(() => { });
    try { myPresenceRef.onDisconnect().cancel(); } catch (e) {}
    myPresenceRef = null;
  }
}

// Comments
function initComments() {
  commentsRef.orderByChild('ts').limitToFirst(1).once('value').then(snap => {
    let earliest = null;
    snap.forEach(child => { const d = child.val(); if (d && d.ts) earliest = d.ts; });
    firstCommentTime = earliest || now();
  }).catch(() => { firstCommentTime = now(); });

  commentsRef.orderByChild('ts').limitToLast(500).on('child_added', snap => {
    const d = snap.val(); if (!d) return;
    if (d.ts && (d.ts - (firstCommentTime || now()) > THREE_HOURS)) return;
    renderComment(d);
  }, err => console.warn('comments on error', err));
}

function renderComment(d) {
  const commentsEl = el('comments'); if (!commentsEl) return;
  const idKey = d._id || (d.uid ? `${d.uid}_${d.ts || 0}` : `c_${Math.random()}`);
  if (commentsEl.querySelector(`[data-cid="${idKey}"]`)) return;

  const div = document.createElement('div'); div.className = 'comment'; div.setAttribute('data-cid', idKey);
  const avatarUrl = d.photo || 'https://via.placeholder.com/40';
  const name = d.name || '匿名';
  const time = d.ts ? new Date(d.ts).toLocaleTimeString() : '';
  const avatarWrap = document.createElement('div'); avatarWrap.className = 'avatarWrap'; avatarWrap.style.marginRight = '10px';
  const img = document.createElement('img'); img.className = 'avatar'; img.src = avatarUrl; img.width = 40; img.height = 40; img.style.borderRadius = '50%'; img.setAttribute('data-uid', d.uid || '');
  avatarWrap.appendChild(img);
  const pDot = document.createElement('span'); pDot.className = 'presence-dot presence-offline'; pDot.id = `presenceDot-${d.uid || idKey}`;
  avatarWrap.appendChild(pDot);

  const meta = document.createElement('div'); meta.className = 'meta';
  meta.innerHTML = `<strong>${escapeHtml(name)} <small style="color:#666;font-weight:400;margin-left:6px">${escapeHtml(time)}</small></strong><div>${escapeHtml(d.text || '')}</div>`;

  const right = document.createElement('div'); right.style.marginLeft = 'auto'; right.style.display = 'flex'; right.style.alignItems = 'center';
  const callBadge = document.createElement('span'); callBadge.className = 'call-badge'; callBadge.textContent = '通話'; callBadge.setAttribute('data-uid', d.uid || '');
  right.appendChild(callBadge);

  div.appendChild(avatarWrap);
  div.appendChild(meta);
  div.appendChild(right);

  commentsEl.insertBefore(div, commentsEl.firstChild || null);

  if (d.uid) {
    presenceRefRoot.child(d.uid).on('value', snap => {
      const v = snap.val();
      const dot = document.getElementById(`presenceDot-${d.uid}`);
      if (dot) {
        dot.classList.toggle('presence-online', !!v && !!v.online);
        dot.classList.toggle('presence-offline', !v || !v.online);
      }
    });
  }
}

function sendComment() {
  const input = el('commentInput'); if (!input) return alert('入力欄が見つかりません');
  const text = input.value.trim(); if (!text) return alert('コメントを入力してください');
  const user = auth.currentUser;
  if (!user) return alert('コメントにはログインが必要です');
  const payload = { uid: user.uid, name: user.displayName || user.email || 'ユーザー', photo: user.photoURL || '', text, ts: now() };
  commentsRef.push(payload).then(() => { input.value = ''; }).catch(err => { console.error('コメント保存エラー', err); alert('送信失敗'); });
}

// Polls
function addPollOption() { const wrap = el('pollOptionsWrapper'); if (!wrap) return; const input = document.createElement('input'); input.type = 'text'; input.className = 'pollOptionInput'; input.placeholder = '選択肢'; wrap.appendChild(input); }
function createPollFromModal() {
  const q = el('pollQuestion'); if (!q) return alert('質問を入力してください');
  const options = Array.from(document.querySelectorAll('.pollOptionInput')).map(i => i.value.trim()).filter(v => v);
  if (!options.length) return alert('選択肢を1つ以上入力してください');
  const poll = { active: true, question: q.value.trim(), options: options.map((label, idx) => ({ id: 'o' + idx + '_' + now(), label, count: 0 })), state: 'voting', startedAt: now(), endsAt: now() + POLL_DURATION_MS, votes: {} };
  pollsRef.child('active').set(poll).then(() => { closeModal('pollModal'); }).catch(err => { console.error('createPoll error', err); alert('アンケート作成失敗'); });
}
function ensurePollListener() {
  pollsRef.child('active').on('value', snap => {
    const data = snap.val();
    if (!data || data.active !== true) { hidePollUI(); localActivePoll = null; return; }
    localActivePoll = data;
    renderPollState(data);
    if (data.state === 'finished') {
      if (_pollRemovalTimeout) clearTimeout(_pollRemovalTimeout);
      _pollRemovalTimeout = setTimeout(async () => {
        try { const snapCheck = await pollsRef.child('active').once('value'); const cur = snapCheck.val(); if (cur && cur.state === 'finished') await pollsRef.child('active').remove(); } catch (err) { console.error(err); } finally { hidePollUI(); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } _pollRemovalTimeout = null; }
      }, POLL_AFTER_FINISH_DISPLAY_MS);
    }
    if (data.state === 'voting' && now() >= (data.endsAt || 0)) finalizePoll();
  }, err => console.warn('poll listener error', err));
}
function renderPollState(poll) {
  const pollArea = el('pollArea'); const pollContent = el('pollContent'); const pollTimer = el('pollTimer');
  if (!pollArea || !pollContent) return;
  pollArea.style.display = 'block'; pollContent.innerHTML = '';
  const header = document.createElement('div'); header.className = 'poll-header'; const q = document.createElement('div'); q.className = 'poll-question'; q.textContent = poll.question || ''; header.appendChild(q); pollContent.appendChild(header);
  const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options';
  const total = (poll.options || []).reduce((s, o) => s + (o.count || 0), 0) || 0;
  (poll.options || []).forEach(o => {
    const opt = document.createElement('div'); opt.className = 'poll-option'; opt.dataset.optId = o.id;
    const pct = total === 0 ? 0 : Math.round(((o.count || 0) / total) * 100);
    opt.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`;
    if (poll.state === 'voting') opt.addEventListener('click', () => voteOption(o.id)); else opt.style.opacity = '0.7';
    optionsWrap.appendChild(opt);
  });
  pollContent.appendChild(optionsWrap);
  if (pollTimer) {
    if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
    if (poll.state === 'voting') {
      const updateFn = () => {
        const remainingMs = Math.max(0, (poll.endsAt || 0) - now());
        if (remainingMs <= 0) { if (pollTimer) pollTimer.textContent = '集計中...'; finalizePoll().catch(err => console.error(err)); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } return; }
        if (pollTimer) pollTimer.textContent = `残り ${Math.ceil(remainingMs / 1000)} 秒`;
      };
      updateFn(); const t = setInterval(updateFn, 500); _pollTimers.set('active', t);
    } else { pollTimer.textContent = '投票終了'; }
  }
}
function hidePollUI() { const pa = el('pollArea'); if (pa) pa.style.display = 'none'; const pc = el('pollContent'); if (pc) pc.innerHTML = ''; }
function voteOption(optId) {
  const user = auth.currentUser; if (!user) return alert('投票にはログインが必要です');
  const uid = user.uid; const activeRef = pollsRef.child('active');
  activeRef.transaction(current => {
    if (!current) return current; if (current.state !== 'voting') return current;
    const prev = current.votes && current.votes[uid] && current.votes[uid].opt;
    if (prev) { const idxPrev = (current.options || []).findIndex(o => o.id === prev); if (idxPrev >= 0) current.options[idxPrev].count = Math.max(0, (current.options[idxPrev].count || 0) - 1); }
    const idx = (current.options || []).findIndex(o => o.id === optId);
    if (idx >= 0) current.options[idx].count = (current.options[idx].count || 0) + 1;
    if (!current.votes) current.votes = {}; current.votes[uid] = { opt: optId, at: now(), name: user.displayName || user.email || 'ユーザー' };
    return current;
  }, (err) => { if (err) console.error('vote txn error', err); });
}
async function finalizePoll() {
  const activeRef = pollsRef.child('active');
  try { const snap = await activeRef.once('value'); const poll = snap.val(); if (!poll) return; if (poll.state === 'finished') return; await activeRef.update({ state: 'finished', finishedAt: now() }); await pollsRef.child('history').push(poll).catch(() => {}); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } } catch (err) { console.error('finalizePoll error', err); }
  
// Calls placeholders
}
function openCallRequestPopup(uid) { const content = el('callRequestContent'); if (content) content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`; window._callTargetUid = uid; openModal('callRequestPopup'); }
function sendCallRequestFromPopup() { /* implement signaling */ }
function listenIncomingCalls(myUid) { /* implement if needed */ }
function stopListeningIncomingCalls() { /* cleanup */ }
function respondToIncomingCall(result) { /* accept/reject */ }

// Upload helpers (GAS)
async function uploadFileToGAS(file) {
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch(GAS_URL, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('upload failed');
  const text = await res.text();
  return text.trim();
}

async function uploadPieceImage() {
  const f = el('pieceImageFile')?.files?.[0];
  if (!f) return alert('駒画像を選んでください');
  try {
    const url = await uploadFileToGAS(f);
    const uid = auth.currentUser?.uid;
    if (!uid) return alert('ログインしてください');
    await usersRef.child(uid).child('assets').update({ pieceUrl: url });
    showAssetPreview(url, '駒画像をアップロードしました');
  } catch (err) { console.error(err); alert('アップロード失敗'); }
}

async function uploadBoardImage() {
  const f = el('boardImageFile')?.files?.[0];
  if (!f) return alert('盤画像を選んでください');
  try {
    const url = await uploadFileToGAS(f);
    const uid = auth.currentUser?.uid;
    if (!uid) return alert('ログインしてください');
    await usersRef.child(uid).child('assets').update({ boardUrl: url });
    showAssetPreview(url, '盤画像をアップロードしました');
  } catch (err) { console.error(err); alert('アップロード失敗'); }
}

function showAssetPreview(url, msg) {
  const p = el('assetPreview');
  if (!p) return;
  p.innerHTML = `${msg}<div style="margin-top:6px;"><img src="${url}" style="max-width:160px;max-height:160px;display:block;border:1px solid #ddd;padding:4px;background:#fff" /></div>`;
}

// Game features (将棋) — 画像駒で表示、後手は回転で表現
function isHost() { if (gameLocalState && gameLocalState.hostUid) return !!auth.currentUser && auth.currentUser.uid === gameLocalState.hostUid; return !!auth.currentUser; }

async function startGameByHost() {
  if (!auth.currentUser) return alert('ゲーム開始はログインが必要です');
  const chosen = document.querySelector('.gameChoice[data-selected="true"]');
  if (!chosen) return alert('ゲームを選択してください');
  const gameType = chosen.getAttribute('data-game');
  const spectatorsAllowed = !!el('publicGame')?.checked;
  const gid = gamesRef.push().key;
  const gameObj = { id: gid, type: gameType, hostUid: auth.currentUser.uid, status: 'lobby', createdAt: now(), players: {}, spectatorsAllowed: !!spectatorsAllowed, winnerUid: null };
  try { await gamesRef.child(gid).set(gameObj); openGameUI(gid, gameObj); closeModal('gameModal'); } catch (err) { console.error('startGame error', err); alert('ゲーム作成に失敗しました'); }
}

function openGameUI(gid, initialObj) {
  if (!gid) return;
  try { if (currentGameId) gamesRef.child(currentGameId).off(); } catch (e) {}
  currentGameId = gid;
  gameLocalState = initialObj || null;
  const ga = el('gameArea'); if (ga) ga.style.display = 'block';
  renderGameHeader(initialObj || {});
  gamesRef.child(gid).on('value', snap => {
    const g = snap.val();
    if (!g) { closeGameUI(); return; }
    gameLocalState = g;
    renderGameState(g);
    renderGameHeader(g);
  });
}

function renderGameHeader(game) {
  const title = el('gameTitle'); if (title) title.textContent = game.type === 'shogi' ? '将棋（対戦）' : 'ゲーム';
  const controls = el('gameControls'); if (!controls) return; controls.innerHTML = '';
  const statusBadge = document.createElement('span'); statusBadge.textContent = game.status || 'lobby'; statusBadge.style.marginRight = '8px'; statusBadge.style.fontWeight = '700';
  controls.appendChild(statusBadge);
  const hostInfo = document.createElement('span'); hostInfo.textContent = game.hostUid ? `主催: ${game.hostUid}` : '主催: なし'; hostInfo.style.marginRight = '12px'; hostInfo.style.opacity = '0.85';
  controls.appendChild(hostInfo);
  if (auth.currentUser) {
    if (game.status === 'lobby') {
      const joinBtn = document.createElement('button'); joinBtn.textContent = '参加希望'; joinBtn.addEventListener('click', () => requestJoinGame(game.id));
      controls.appendChild(joinBtn);
      if (auth.currentUser.uid === game.hostUid) {
        const pickBtn = document.createElement('button'); pickBtn.textContent = '参加者から選出して開始'; pickBtn.addEventListener('click', () => pickAndStartGame(game.id));
        controls.appendChild(pickBtn);
      }
    } else if (game.status === 'running') {
      if (auth.currentUser.uid === game.hostUid) {
        const endBtn = document.createElement('button'); endBtn.textContent = '強制終了'; endBtn.addEventListener('click', () => endGame(game.id, null));
        controls.appendChild(endBtn);
      }
    }
  } else {
    const info = document.createElement('span'); info.textContent = '参加するにはログインしてください'; info.style.marginLeft = '8px'; info.style.color = '#666';
    controls.appendChild(info);
  }
}

async function requestJoinGame(gid) { if (!auth.currentUser) return alert('ログインしてください'); const u = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー', accepted: false, ts: now() }; await gamesRef.child(gid).child('players').child(u.uid).set(u); alert('参加希望を出しました。主催者が選出するまでお待ちください。'); }

async function pickAndStartGame(gid) {
  const snap = await gamesRef.child(gid).child('players').once('value');
  const players = []; snap.forEach(ch => { const v = ch.val(); if (v && v.uid) players.push(v); });
  const candidates = players.filter(p => p.uid !== auth.currentUser.uid);
  if (candidates.length === 0) return alert('参加希望者がいません');
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const updates = {};
  updates[`players/${auth.currentUser.uid}`] = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || '主催者', accepted: true, role: 'host', ts: now() };
  updates[`players/${pick.uid}`] = { uid: pick.uid, name: pick.name, accepted: true, role: 'player', ts: now() };
  updates['status'] = 'running';
  updates['startedAt'] = now();
  updates['activePlayers'] = { [auth.currentUser.uid]: true, [pick.uid]: true };
  await gamesRef.child(gid).update(updates);
  await gamesRef.child(gid).child('shogi').set({ board: initialShogiBoard(), turn: auth.currentUser.uid, moves: [] });
}

function initialShogiBoard() {
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

async function renderShogiBoard(gid, shogiState) {
  const container = el('shogiContainer'); if (!container) return;
  container.innerHTML = '';

  let boardUrl = null;
  try { if (gameLocalState && gameLocalState.assets && gameLocalState.assets.boardUrl) boardUrl = gameLocalState.assets.boardUrl; } catch (e) {}
  const boardWrap = document.createElement('div'); boardWrap.className = 'shogiBoard';
  if (boardUrl) { boardWrap.style.backgroundImage = `url(${boardUrl})`; boardWrap.style.backgroundSize = 'cover'; boardWrap.style.backgroundPosition = 'center'; }
  boardWrap.style.position = 'relative'; boardWrap.style.padding = '8px'; boardWrap.style.boxSizing = 'border-box';

  const size = 9;
  const grid = document.createElement('div'); grid.className = 'grid'; grid.style.display = 'grid'; grid.style.gridTemplateColumns = `repeat(${size},1fr)`; grid.style.gap = '2px'; grid.style.width = '100%'; grid.style.height = '100%';

  const board = shogiState.board || initialShogiBoard();
  let selected = null;
  const urlCache = {};

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const sq = document.createElement('div'); sq.className = 'grid-cell';
      sq.dataset.r = r; sq.dataset.c = c;
      sq.style.minHeight = `${Math.floor(320/9)}px`;

      const piece = board[r][c];

      if (piece && piece !== '.') {
        const img = document.createElement('img');
        img.style.maxWidth = '70%';
        img.style.maxHeight = '70%';
        img.alt = piece;

        if (urlCache[piece]) {
          img.src = urlCache[piece];
        } else {
          img.src = PIECE_IMG_MAP[piece] || '';
          resolvePieceImageUrl(piece).then(url => { if (url) { urlCache[piece] = url; img.src = url; } }).catch(()=>{});
        }

        const isSente = piece === piece.toUpperCase();
        if (!isSente) img.classList.add('koma-gote'); else img.classList.remove('koma-gote');

        sq.appendChild(img);
      }

      sq.addEventListener('click', async () => {
        const myUid = auth.currentUser?.uid;
        const game = gameLocalState;
        if (!game) return;
        if (game.status !== 'running') return;
        if (!game.activePlayers || !game.activePlayers[myUid]) return;
        const turn = (shogiState.turn || '');
        if (turn !== myUid) return alert('相手の手番です');
        if (!selected) {
          if (board[r][c] === '.') return;
          selected = { r, c, piece: board[r][c] };
          sq.style.outline = '3px solid rgba(26,115,232,0.6)';
        } else {
          const from = selected; const to = { r, c };
          await makeShogiMove(gid, auth.currentUser.uid, from, to);
          selected = null;
        }
      });

      grid.appendChild(sq);
    }
  }

  boardWrap.appendChild(grid);
  container.appendChild(boardWrap);

  const controls = document.createElement('div'); controls.className = 'shogiControls';
  const playersDiv = document.createElement('div');
  const players = gameLocalState.players || {};
  const list = Object.values(players).map(p => `<div class="playerBadge">${escapeHtml(p.name || p.uid)}${p.role ? ' (' + p.role + ')' : ''}</div>`).join('');
  playersDiv.innerHTML = `<div style="font-weight:700;margin-bottom:8px">参加者</div>${list}`;
  controls.appendChild(playersDiv);
  if (auth.currentUser && gameLocalState.activePlayers && gameLocalState.activePlayers[auth.currentUser.uid]) {
    const resignBtn = document.createElement('button'); resignBtn.textContent = '降参（敗北）';
    resignBtn.addEventListener('click', () => { const otherUid = Object.keys(gameLocalState.activePlayers).find(u => u !== auth.currentUser.uid); endGame(gid, otherUid); });
    controls.appendChild(resignBtn);
  }
  container.appendChild(controls);
}

async function makeShogiMove(gid, uid, from, to) {
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
    const activePlayers = gameLocalState.activePlayers ? Object.keys(gameLocalState.activePlayers) : [];
    const other = activePlayers.find(u => u !== uid) || uid;
    current.board = board;
    current.moves = moves;
    current.turn = other;
    return current;
  });
}

async function endGame(gid, winnerUid) {
  try {
    const updates = { status: 'finished', finishedAt: now(), winnerUid: winnerUid || null };
    await gamesRef.child(gid).update(updates);
    if (winnerUid) {
      const pRef = usersRef.child(winnerUid).child('points');
      await pRef.transaction(cur => (cur || 0) + 100);
      try { const snap = await usersRef.child(winnerUid).child('points').once('value'); const pts = snap.val() || 0; if (auth.currentUser && auth.currentUser.uid === winnerUid) { const myPoints = el('myPoints'); if (myPoints) myPoints.textContent = pts; } } catch (e) {}
    }
    setTimeout(async () => { try { await gamesRef.child(gid).remove(); } catch (e) { console.warn('remove game failed', e); } closeGameUI(); }, 2000);
  } catch (err) { console.error('endGame error', err); }
}

function closeGameUI() {
  if (currentGameId) {
    try { gamesRef.child(currentGameId).off(); } catch (e) {}
  }
  currentGameId = null;
  gameLocalState = null;
  const ga = el('gameArea'); if (ga) ga.style.display = 'none';
}

function initGameAutoSubscribe() {
  gamesRef.orderByChild('status').equalTo('lobby').on('child_added', snap => { const g = snap.val(); if (!g) return; if (!currentGameId) openGameUI(g.id, g); });
  gamesRef.orderByChild('status').equalTo('running').on('child_added', snap => { const g = snap.val(); if (!g) return; openGameUI(g.id, g); });
  gamesRef.on('child_changed', snap => { const g = snap.val(); if (!g) return; if (currentGameId === g.id) { gameLocalState = g; renderGameState(g); renderGameHeader(g); } });
  gamesRef.on('child_removed', snap => { const removed = snap.val(); if (!removed) return; if (currentGameId === removed.id) closeGameUI(); });
}

// renderGameState wrapper
function renderGameState(game) {
  if (game.type === 'shogi') renderShogiBoard(game.id, game.shogi || game.shogiState || {});
}

// Debug
window.checkDebug = function () { console.log('firebase loaded?', typeof firebase !== 'undefined'); console.log('auth.currentUser', auth.currentUser); console.log('DOM elements:', { comments: !!el('comments'), pollArea: !!el('pollArea'), gameArea: !!el('gameArea') }); };
