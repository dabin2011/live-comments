// script.js — コメント・アンケート・通話・ゲーム（将棋）統合版
// 必ず firebaseConfig と GAS_URL を実環境の値に置き換えてください。

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
if (typeof firebase === 'undefined') { console.error('Firebase SDK が読み込まれていません'); }
else if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }

// Refs
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref('comments');
const pollsRef = db.ref('polls');
const arrivalsRef = db.ref('arrivals');
const presenceRefRoot = db.ref('presence');
const callsRef = db.ref('calls');
const gamesRef = db.ref('games');
const usersRef = db.ref('users');

// Apps Script Web アプリ URL (画像アップロード)
const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

// Constants
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const POLL_AFTER_FINISH_DISPLAY_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;
const CALL_REQUEST_TIMEOUT_MS = 20 * 1000;

// Local state
let firstCommentTime = null;
let _prevAuthUser = null;
let localActivePoll = null;
let myPresenceRef = null;
let currentOutgoingCallId = null;
const _pollTimers = new Map();
let _pollRemovalTimeout = null;

// Game state
let currentGameId = null;
let gameLocalState = null;

// WebRTC helpers
const rtcSessions = {};
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Utilities
function escapeHtml(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function now() { return Date.now(); }
function el(id) { return document.getElementById(id); }

// Modal helpers with debug-friendly behavior
window.openModal = function (id) {
  const m = el(id);
  console.log('openModal called for', id, 'element?', !!m);
  if (!m) return console.warn('openModal: modal not found', id);
  m.style.display = 'flex';
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  m.style.zIndex = 999999;
  const focusable = m.querySelector('button, input, [tabindex]');
  if (focusable) focusable.focus();
};
window.closeModal = function (id) {
  const m = el(id);
  console.log('closeModal called for', id, 'element?', !!m);
  if (!m) return console.warn('closeModal: modal not found', id);
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  m.style.display = 'none';
};

// ----------------- DOM init -----------------
document.addEventListener('DOMContentLoaded', () => {
  // close buttons
  document.querySelectorAll('.modal .close').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-close') || btn.closest('.modal')?.id;
    if (id) closeModal(id);
  }));
  document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); }));

  // wire buttons
  const sendBtn = el('sendBtn'); if (sendBtn) sendBtn.addEventListener('click', sendComment);
  const pollBtn = el('pollBtn'); if (pollBtn) pollBtn.addEventListener('click', () => openModal('pollModal'));
  const addPollOptionBtn = el('addPollOptionBtn'); if (addPollOptionBtn) addPollOptionBtn.addEventListener('click', addPollOption);
  const createPollBtn = el('createPollBtn'); if (createPollBtn) createPollBtn.addEventListener('click', createPollFromModal);

  const gameBtn = el('gameBtn'); if (gameBtn) gameBtn.addEventListener('click', () => openModal('gameModal'));
  const startGameBtn = el('startGameBtn'); if (startGameBtn) startGameBtn.addEventListener('click', startGameByHost);
  document.querySelectorAll('.gameChoice').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.gameChoice').forEach(b => b.removeAttribute('data-selected')); btn.setAttribute('data-selected', 'true'); }));

  const signupBtn = el('signupBtn'), signinBtn = el('signinBtn'), logoutBtn = el('logoutBtn'), updateNameBtn = el('updateNameBtn');
  if (signupBtn) signupBtn.addEventListener('click', signUp);
  if (signinBtn) signinBtn.addEventListener('click', signIn);
  if (logoutBtn) logoutBtn.addEventListener('click', async () => { try { await auth.signOut(); } catch (err) { console.error('signOut error', err); alert('ログアウトに失敗しました: ' + (err && err.message ? err.message : err)); } });
  if (updateNameBtn) updateNameBtn.addEventListener('click', updateProfile);

  const callCancelBtn = el('callCancelBtn'); if (callCancelBtn) callCancelBtn.addEventListener('click', () => closeModal('callRequestPopup'));
  const callSendBtn = el('callSendBtn'); if (callSendBtn) callSendBtn.addEventListener('click', sendCallRequestFromPopup);
  const rejectCallBtn = el('rejectCallBtn'); if (rejectCallBtn) rejectCallBtn.addEventListener('click', () => respondToIncomingCall('rejected'));
  const acceptCallBtn = el('acceptCallBtn'); if (acceptCallBtn) acceptCallBtn.addEventListener('click', () => respondToIncomingCall('accepted'));
  const callNotifyClose = el('callNotifyClose'); if (callNotifyClose) callNotifyClose.addEventListener('click', () => closeModal('callNotifyPopup'));

  const uf = el('uploadForm'); if (uf) uf.addEventListener('submit', handleUploadForm);

  const commentsEl = el('comments');
  if (commentsEl) {
    commentsEl.addEventListener('click', ev => {
      const badge = ev.target.closest('.call-badge');
      if (badge) { const uid = badge.getAttribute('data-uid'); if (uid) openCallRequestPopup(uid); }
      const img = ev.target.closest('img[data-uid]');
      if (img) { const uid = img.getAttribute('data-uid'); if (uid) openCallRequestPopup(uid); }
    });
  }

  arrivalsRef.on('child_added', snap => { const d = snap.val(); if (d && d.type === 'arrival') showArrivalBanner(d.name || 'ゲスト'); snap.ref.remove().catch(() => { }); });
  ensurePollListener();
  initComments();
  initGameAutoSubscribe();
});

// ----------------- arrival -----------------
function showArrivalBanner(name) {
  const b = el('arrivalBanner'); if (!b) return;
  b.textContent = `${escapeHtml(name)}さんが配信を視聴しに来ました`;
  b.style.display = 'block';
  if (b._hideTimer) clearTimeout(b._hideTimer);
  b._hideTimer = setTimeout(() => { b.style.display = 'none'; }, ARRIVAL_BANNER_DURATION);
}

// ----------------- auth & presence -----------------
auth.onAuthStateChanged(async user => {
  const loginBtn = el('loginBtn'), mypageBtn = el('mypageBtn'), logoutBtn = el('logoutBtn'), usernameEl = el('username'), avatarEl = el('avatar'), myPoints = el('myPoints');
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
    try { const snap = await usersRef.child(user.uid).child('points').once('value'); const pts = snap.val() || 0; if (myPoints) myPoints.textContent = pts; } catch (e) { }
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (mypageBtn) mypageBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (usernameEl) usernameEl.textContent = '';
    if (avatarEl) avatarEl.src = '';
    detachPresence();
    stopListeningIncomingCalls();
  }
  _prevAuthUser = user;
});

async function signUp() { const email = el('email')?.value?.trim(); const password = el('password')?.value || ''; if (!email || !password) return alert('メールとパスワードを入力してください'); try { await auth.createUserWithEmailAndPassword(email, password); alert('登録しました'); closeModal('loginModal'); } catch (e) { console.error(e); alert('登録失敗: ' + e.message); } }
async function signIn() { const email = el('email')?.value?.trim(); const password = el('password')?.value || ''; if (!email || !password) return alert('メールとパスワードを入力してください'); try { await auth.signInWithEmailAndPassword(email, password); alert('ログインしました'); closeModal('loginModal'); } catch (e) { console.error(e); alert('ログイン失敗: ' + e.message); } }
async function updateProfile() { const user = auth.currentUser; if (!user) return alert('ログインしてください'); const newName = el('newName')?.value?.trim(); if (!newName) return alert('ユーザー名を入力してください'); try { await user.updateProfile({ displayName: newName }); const usernameEl = el('username'); if (usernameEl) usernameEl.textContent = newName; alert('ユーザー名を更新しました'); closeModal('mypageModal'); } catch (err) { console.error('updateProfile error', err); alert('ユーザー名の更新に失敗しました: ' + (err && err.message ? err.message : err)); } }

function attachPresence(uid) { if (!uid) return; myPresenceRef = presenceRefRoot.child(uid); myPresenceRef.set({ online: true, lastSeen: now() }).catch(() => { }); try { myPresenceRef.onDisconnect().set({ online: false, lastSeen: now() }).catch(() => { }); } catch (e) { } }
function detachPresence() { if (myPresenceRef) { myPresenceRef.set({ online: false, lastSeen: now() }).catch(() => { }); try { myPresenceRef.onDisconnect().cancel(); } catch (e) { } myPresenceRef = null; } }

// ----------------- comments -----------------
function initComments() {
  commentsRef.orderByChild('ts').limitToFirst(1).once('value').then(snap => { let earliest = null; snap.forEach(child => { const d = child.val(); if (d && d.ts) earliest = d.ts; }); firstCommentTime = earliest || now(); }).catch(() => { firstCommentTime = now(); });

  commentsRef.orderByChild('ts').limitToLast(500).on('child_added', snap => { const d = snap.val(); if (!d) return; if (d.ts && (d.ts - (firstCommentTime || now()) > THREE_HOURS)) return; renderComment(d); }, err => console.warn('comments on error', err));
}

function renderComment(d) {
  const commentsEl = el('comments'); if (!commentsEl) return;
  const div = document.createElement('div'); div.className = 'comment';
  const avatarUrl = d.photo || 'https://via.placeholder.com/40';
  const name = d.name || '匿名';
  const time = d.ts ? new Date(d.ts).toLocaleTimeString() : '';
  const avatarWrap = document.createElement('div'); avatarWrap.className = 'avatarWrap'; avatarWrap.style.marginRight = '10px';
  const img = document.createElement('img'); img.className = 'avatar'; img.src = avatarUrl; img.width = 40; img.height = 40; img.style.borderRadius = '50%'; img.setAttribute('data-uid', d.uid || '');
  avatarWrap.appendChild(img);
  const pDot = document.createElement('span'); pDot.className = 'presence-dot presence-offline'; pDot.id = `presenceDot-${d.uid || ''}`;
  avatarWrap.appendChild(pDot);
  const meta = document.createElement('div'); meta.className = 'meta';
  meta.innerHTML = `<strong>${escapeHtml(name)} <small style="color:#666;font-weight:400;margin-left:6px">${escapeHtml(time)}</small></strong><div>${escapeHtml(d.text)}</div>`;
  const right = document.createElement('div'); right.style.marginLeft = 'auto'; right.style.display = 'flex'; right.style.alignItems = 'center';
  const callBadge = document.createElement('span'); callBadge.className = 'call-badge'; callBadge.textContent = '通話'; callBadge.setAttribute('data-uid', d.uid || '');
  right.appendChild(callBadge);
  div.appendChild(avatarWrap); div.appendChild(meta); div.appendChild(right);
  commentsEl.insertBefore(div, commentsEl.firstChild || null);
  const uid = d.uid;
  if (uid) {
    presenceRefRoot.child(uid).on('value', snap => {
      const v = snap.val();
      const dot = document.getElementById(`presenceDot-${uid}`);
      if (dot) { dot.classList.toggle('presence-online', !!v && !!v.online); dot.classList.toggle('presence-offline', !v || !v.online); }
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

// ----------------- polls -----------------
function addPollOption() { const wrap = el('pollOptionsWrapper'); if (!wrap) return; const input = document.createElement('input'); input.type = 'text'; input.className = 'pollOptionInput'; input.placeholder = '選択肢'; wrap.appendChild(input); }
function createPollFromModal() { const q = el('pollQuestion'); if (!q) return alert('質問を入力してください'); const options = Array.from(document.querySelectorAll('.pollOptionInput')).map(i => i.value.trim()).filter(v => v); if (!options.length) return alert('選択肢を1つ以上入力してください'); const poll = { active: true, question: q.value.trim(), options: options.map((label, idx) => ({ id: 'o' + idx + '_' + now(), label, count: 0 })), state: 'voting', startedAt: now(), endsAt: now() + POLL_DURATION_MS, votes: {} }; pollsRef.child('active').set(poll).then(() => { closeModal('pollModal'); }).catch(err => { console.error('createPoll error', err); alert('アンケート作成失敗'); }); }
function ensurePollListener() { pollsRef.child('active').on('value', snap => { const data = snap.val(); if (!data || data.active !== true) { hidePollUI(); localActivePoll = null; return; } localActivePoll = data; renderPollState(data); if (data.state === 'finished') { if (_pollRemovalTimeout) { clearTimeout(_pollRemovalTimeout); _pollRemovalTimeout = null; } _pollRemovalTimeout = setTimeout(async () => { try { const snapCheck = await pollsRef.child('active').once('value'); const cur = snapCheck.val(); if (cur && cur.state === 'finished') { await pollsRef.child('active').remove(); } } catch (err) { console.error('poll removal error', err); } finally { hidePollUI(); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } _pollRemovalTimeout = null; } }, POLL_AFTER_FINISH_DISPLAY_MS); } if (data.state === 'voting' && now() >= (data.endsAt || 0)) finalizePoll(); }, err => console.warn('poll listener error', err)); }
function renderPollState(poll) { const pollArea = el('pollArea'); const pollContent = el('pollContent'); const pollTimer = el('pollTimer'); if (!pollArea || !pollContent) return; pollArea.style.display = 'block'; pollContent.innerHTML = ''; const header = document.createElement('div'); header.className = 'poll-header'; const q = document.createElement('div'); q.className = 'poll-question'; q.textContent = poll.question || ''; header.appendChild(q); pollContent.appendChild(header); const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options'; const total = (poll.options || []).reduce((s, o) => s + (o.count || 0), 0) || 0; (poll.options || []).forEach(o => { const opt = document.createElement('div'); opt.className = 'poll-option'; opt.dataset.optId = o.id; const pct = total === 0 ? 0 : Math.round(((o.count || 0) / total) * 100); opt.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`; if (poll.state === 'voting') { opt.addEventListener('click', () => voteOption(o.id)); } else opt.style.opacity = '0.7'; optionsWrap.appendChild(opt); }); pollContent.appendChild(optionsWrap); if (pollTimer) { if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } if (poll.state === 'voting') { const updateFn = () => { const remainingMs = Math.max(0, (poll.endsAt || 0) - now()); if (remainingMs <= 0) { if (pollTimer) pollTimer.textContent = '集計中...'; finalizePoll().catch(err => console.error('finalizePoll error', err)); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } return; } if (pollTimer) pollTimer.textContent = `残り ${Math.ceil(remainingMs / 1000)} 秒`; }; updateFn(); const t = setInterval(updateFn, 500); _pollTimers.set('active', t); } else { pollTimer.textContent = '投票終了'; } } }
function hidePollUI() { const pa = el('pollArea'); if (pa) pa.style.display = 'none'; const pc = el('pollContent'); if (pc) pc.innerHTML = ''; }
function voteOption(optId) { const user = auth.currentUser; if (!user) return alert('投票にはログインが必要です'); const uid = user.uid; const activeRef = pollsRef.child('active'); activeRef.transaction(current => { if (!current) return current; if (current.state !== 'voting') return current; const prev = current.votes && current.votes[uid] && current.votes[uid].opt; if (prev) { const idxPrev = (current.options || []).findIndex(o => o.id === prev); if (idxPrev >= 0) current.options[idxPrev].count = Math.max(0, (current.options[idxPrev].count || 0) - 1); } const idx = (current.options || []).findIndex(o => o.id === optId); if (idx >= 0) current.options[idx].count = (current.options[idx].count || 0) + 1; if (!current.votes) current.votes = {}; current.votes[uid] = { opt: optId, at: now(), name: user.displayName || user.email || 'ユーザー' }; return current; }, (err, committed, snapshot) => { if (err) console.error('vote txn error', err); }); }
async function finalizePoll() { const activeRef = pollsRef.child('active'); try { const snap = await activeRef.once('value'); const poll = snap.val(); if (!poll) return; if (poll.state === 'finished') return; await activeRef.update({ state: 'finished', finishedAt: now() }); await pollsRef.child('history').push(poll).catch(() => { }); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } } catch (err) { console.error('finalizePoll error', err); } }

// ----------------- Calls (placeholder) -----------------
function openCallRequestPopup(uid) { const content = el('callRequestContent'); if (content) content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`; window._callTargetUid = uid; openModal('callRequestPopup'); }
// Include your working WebRTC functions (startLocalAudioAndCreateOffer, startLocalAudioAndAnswer, hangupCall, etc.) here.

function handleUploadForm(e) { e && e.preventDefault(); const file = el('imageFile')?.files?.[0]; if (!file) return alert('画像を選択してください'); const fd = new FormData(); fd.append('file', file); fetch(GAS_URL, { method: 'POST', body: fd }).then(r => r.text()).then(url => { const user = auth.currentUser; if (!user) return alert('ログインしてください'); user.updateProfile({ photoURL: url }).then(() => { const avatar = el('avatar'); if (avatar) avatar.src = url; closeModal('mypageModal'); }).catch(err => alert('更新失敗：' + err.message)); }).catch(err => alert('アップロード失敗：' + err.message)); }

// ----------------- Game features (将棋) -----------------
function isHost() { if (gameLocalState && gameLocalState.hostUid) { return !!auth.currentUser && auth.currentUser.uid === gameLocalState.hostUid; } return !!auth.currentUser; }

async function startGameByHost() {
  if (!auth.currentUser) return alert('ゲーム開始はログインが必要です');
  const chosen = document.querySelector('.gameChoice[data-selected="true"]');
  if (!chosen) return alert('ゲームを選択してください');
  const gameType = chosen.getAttribute('data-game');
  const spectatorsAllowed = !!el('publicGame')?.checked;
  const gid = gamesRef.push().key;
  const gameObj = { id: gid, type: gameType, hostUid: auth.currentUser.uid, status: 'lobby', createdAt: now(), players: {}, spectatorsAllowed: !!spectatorsAllowed, winnerUid: null };
  await gamesRef.child(gid).set(gameObj);
  openGameUI(gid, gameObj);
  closeModal('gameModal');
}

function openGameUI(gid, initialObj) {
  if (!gid) return;
  currentGameId = gid; gameLocalState = initialObj || null;
  const ga = el('gameArea'); if (ga) ga.style.display = 'block';
  renderGameHeader(initialObj || {});
  gamesRef.child(gid).on('value', snap => { const g = snap.val(); if (!g) { closeGameUI(); return; } gameLocalState = g; renderGameState(g); });
}

function renderGameHeader(game) {
  const title = el('gameTitle'); if (title) title.textContent = game.type === 'shogi' ? '将棋（対戦）' : 'ゲーム';
  const controls = el('gameControls'); if (!controls) return; controls.innerHTML = '';
  if (auth.currentUser) {
    if (game.status === 'lobby') {
      const joinBtn = document.createElement('button'); joinBtn.textContent = '参加希望'; joinBtn.addEventListener('click', () => requestJoinGame(game.id)); controls.appendChild(joinBtn);
      if (auth.currentUser.uid === game.hostUid) {
        const pickBtn = document.createElement('button'); pickBtn.textContent = '参加者から選出して開始'; pickBtn.addEventListener('click', () => pickAndStartGame(game.id)); controls.appendChild(pickBtn);
      }
    } else if (game.status === 'running') {
      if (auth.currentUser.uid === game.hostUid) {
        const endBtn = document.createElement('button'); endBtn.textContent = '強制終了'; endBtn.addEventListener('click', () => endGame(game.id, null)); controls.appendChild(endBtn);
      }
    }
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

function initialShogiBoard() { return [ ['l','n','s','g','k','g','s','n','l'], ['.','r','.','.','.','.','.','b','.'], ['p','p','p','p','p','p','p','p','p'], ['.','.','.','.','.','.','.','.','.'], ['.','.','.','.','.','.','.','.','.'], ['.','.','.','.','.','.','.','.','.'], ['P','P','P','P','P','P','P','P','P'], ['.','B','.','.','.','.','.','R','.'], ['L','N','S','G','K','G','S','N','L'] ]; }

function renderGameState(game) {
  if (game.type === 'shogi') {
    const sc = el('shogiContainer'); if (!sc) return;
    const spectatorArea = el('spectatorArea');
    if (game.status === 'running') { sc.style.display = 'flex'; spectatorArea.style.display = game.spectatorsAllowed ? 'block' : 'none'; renderShogiBoard(game.id, game.shogi || {}); }
    else { sc.style.display = 'none'; spectatorArea.style.display = 'none'; }
  }
}

function renderShogiBoard(gid, shogiState) {
  const container = el('shogiContainer'); if (!container) return;
  container.innerHTML = '';
  const boardWrap = document.createElement('div'); boardWrap.className = 'shogiBoard';
  const size = 9;
  const grid = document.createElement('div'); grid.style.display = 'grid'; grid.style.gridTemplateColumns = `repeat(${size},1fr)`; grid.style.gap = '2px';
  grid.style.width = '100%'; grid.style.height = '100%';
  let selected = null;
  const board = shogiState.board || initialShogiBoard();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const sq = document.createElement('div');
      sq.style.border = '1px solid rgba(0,0,0,0.06)'; sq.style.display = 'flex'; sq.style.alignItems = 'center'; sq.style.justifyContent = 'center';
      sq.style.background = '#fff'; sq.style.cursor = 'pointer';
      sq.dataset.r = r; sq.dataset.c = c;
      const piece = board[r][c];
      sq.textContent = piece === '.' ? '' : piece;
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
  const controls = document.createElement('div'); controls.className = 'shogiControls';
  const playersDiv = document.createElement('div');
  const players = gameLocalState.players || {};
  const list = Object.values(players).map(p => `<div class="playerBadge">${escapeHtml(p.name || p.uid)}${p.role ? ' (' + p.role + ')' : ''}</div>`).join('');
  playersDiv.innerHTML = `<div style="font-weight:700;margin-bottom:8px">参加者</div>${list}`;
  controls.appendChild(playersDiv);
  if (auth.currentUser && gameLocalState.activePlayers && gameLocalState.activePlayers[auth.currentUser.uid]) {
    const resignBtn = document.createElement('button'); resignBtn.textContent = '降参（敗北）';
    resignBtn.addEventListener('click', () => {
      const otherUid = Object.keys(gameLocalState.activePlayers).find(u => u !== auth.currentUser.uid);
      endGame(gid, otherUid);
    });
    controls.appendChild(resignBtn);
  }
  container.appendChild(boardWrap);
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
      await pRef.transaction(cur => { return (cur || 0) + 100; });
      try {
        const snap = await usersRef.child(winnerUid).child('points').once('value');
        const pts = snap.val() || 0;
        if (auth.currentUser && auth.currentUser.uid === winnerUid) { const myPoints = el('myPoints'); if (myPoints) myPoints.textContent = pts; }
      } catch (e) { }
    }
    setTimeout(async () => { try { await gamesRef.child(gid).remove(); } catch (e) { console.warn('remove game failed', e); } closeGameUI(); }, 2000);
  } catch (err) { console.error('endGame error', err); }
}

function closeGameUI() {
  if (!currentGameId) return;
  try { gamesRef.child(currentGameId).off(); } catch (e) { }
  currentGameId = null; gameLocalState = null;
  const ga = el('gameArea'); if (ga) ga.style.display = 'none';
}

function initGameAutoSubscribe() {
  gamesRef.orderByChild('status').equalTo('running').limitToLast(5).on('child_added', snap => {
    const g = snap.val(); if (!g) return; openGameUI(g.id, g);
  });
  gamesRef.on('child_changed', snap => { const g = snap.val(); if (!g) return; if (g.status === 'running') openGameUI(g.id, g); });
}

// Debug
window.checkDebug = function () { console.log('firebase loaded?', typeof firebase !== 'undefined'); console.log('auth.currentUser', auth.currentUser); };
