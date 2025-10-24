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
let currentIncomingCallListener = null;
let currentOutgoingCallId = null;
const _pollTimers = new Map();
let _pollRemovalTimeout = null;

// WebRTC state per call
const rtcSessions = {}; // callId -> { pc, localStream, remoteAudioEl, iceListenerRef, timerInterval, callStartTs, _waitInterval }

// STUN
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Utils
function escapeHtml(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function now() { return Date.now(); }
function el(id) { return document.getElementById(id); }

// ----------------- DOM init -----------------
document.addEventListener('DOMContentLoaded', () => {
  // modal helpers
  window.openModal = function (id) { const m = el(id); if (!m) return; m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); };
  window.closeModal = function (id) { const m = el(id); if (!m) return; m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); };
  document.querySelectorAll('.modal .close').forEach(btn => btn.addEventListener('click', () => { const id = btn.getAttribute('data-close') || btn.closest('.modal')?.id; if (id) closeModal(id); }));

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); });
  });

  // Wire buttons (preserve existing IDs)
  const sendBtn = el('sendBtn'); if (sendBtn) sendBtn.addEventListener('click', sendComment);
  const pollBtn = el('pollBtn'); if (pollBtn) pollBtn.addEventListener('click', () => openModal('pollModal'));
  const addPollOptionBtn = el('addPollOptionBtn'); if (addPollOptionBtn) addPollOptionBtn.addEventListener('click', addPollOption);
  const createPollBtn = el('createPollBtn'); if (createPollBtn) createPollBtn.addEventListener('click', createPollFromModal);

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

  // upload form
  const uf = el('uploadForm'); if (uf) uf.addEventListener('submit', handleUploadForm);

  // delegate clicks inside comments
  const commentsEl = el('comments');
  if (commentsEl) {
    commentsEl.addEventListener('click', ev => {
      const badge = ev.target.closest('.call-badge');
      if (badge) { const uid = badge.getAttribute('data-uid'); if (uid) openCallRequestPopup(uid); }
      const img = ev.target.closest('img[data-uid]');
      if (img) { const uid = img.getAttribute('data-uid'); if (uid) openCallRequestPopup(uid); }
    });
  }

  const form = el('form'); if (form) form.style.display = 'flex';

  arrivalsRef.on('child_added', snap => { const d = snap.val(); if (d && d.type === 'arrival') showArrivalBanner(d.name || 'ゲスト'); snap.ref.remove().catch(() => { }); });
  ensurePollListener();
  initComments();

  // global listener: cleanup rtc when call state changes
  callsRef.on('child_changed', snap => {
    const call = snap.val(); const callId = snap.key;
    if (!call) return;
    if (call.state === 'finished' || call.state === 'rejected' || call.state === 'canceled') {
      console.log('callsRef child_changed -> cleanup', callId, call.state);
      hangupCall(callId, true);
      if (el('callNotifyPopup')?.classList.contains('open')) closeModal('callNotifyPopup');
      if (el('incomingCallPopup')?.classList.contains('open')) closeModal('incomingCallPopup');
    }
  });
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
auth.onAuthStateChanged(user => {
  const loginBtn = el('loginBtn'), mypageBtn = el('mypageBtn'), logoutBtn = el('logoutBtn'), usernameEl = el('username'), avatarEl = el('avatar');
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

async function signUp() {
  const email = el('email')?.value?.trim(); const password = el('password')?.value || '';
  if (!email || !password) return alert('メールとパスワードを入力してください');
  try { await auth.createUserWithEmailAndPassword(email, password); alert('登録しました'); closeModal('loginModal'); } catch (e) { console.error(e); alert('登録失敗: ' + e.message); }
}
async function signIn() {
  const email = el('email')?.value?.trim(); const password = el('password')?.value || '';
  if (!email || !password) return alert('メールとパスワードを入力してください');
  try { await auth.signInWithEmailAndPassword(email, password); alert('ログインしました'); closeModal('loginModal'); } catch (e) { console.error(e); alert('ログイン失敗: ' + e.message); }
}
async function updateProfile() {
  const user = auth.currentUser;
  if (!user) return alert('ログインしてください');
  const newName = el('newName')?.value?.trim();
  if (!newName) return alert('ユーザー名を入力してください');
  try {
    await user.updateProfile({ displayName: newName });
    const usernameEl = el('username'); if (usernameEl) usernameEl.textContent = newName;
    alert('ユーザー名を更新しました');
    closeModal('mypageModal');
  } catch (err) {
    console.error('updateProfile error', err);
    alert('ユーザー名の更新に失敗しました: ' + (err && err.message ? err.message : err));
  }
}

function attachPresence(uid) {
  if (!uid) return;
  myPresenceRef = presenceRefRoot.child(uid);
  myPresenceRef.set({ online: true, lastSeen: now() }).catch(() => { });
  try { myPresenceRef.onDisconnect().set({ online: false, lastSeen: now() }).catch(() => { }); } catch (e) { }
}
function detachPresence() {
  if (myPresenceRef) { myPresenceRef.set({ online: false, lastSeen: now() }).catch(() => { }); try { myPresenceRef.onDisconnect().cancel(); } catch (e) { } myPresenceRef = null; }
}

// ----------------- comments & presence dot -----------------
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

  div.appendChild(avatarWrap);
  div.appendChild(meta);
  div.appendChild(right);

  commentsEl.insertBefore(div, commentsEl.firstChild || null);

  const uid = d.uid;
  if (uid) {
    presenceRefRoot.child(uid).on('value', snap => {
      const v = snap.val();
      const dot = document.getElementById(`presenceDot-${uid}`);
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

// ----------------- polls (unchanged) -----------------
function addPollOption() { const wrap = el('pollOptionsWrapper'); if (!wrap) return; const input = document.createElement('input'); input.type = 'text'; input.className = 'pollOptionInput'; input.placeholder = '選択肢'; wrap.appendChild(input); }
function createPollFromModal() { const q = el('pollQuestion'); if (!q) return alert('質問を入力してください'); const options = Array.from(document.querySelectorAll('.pollOptionInput')).map(i => i.value.trim()).filter(v => v); if (!options.length) return alert('選択肢を1つ以上入力してください'); const dur = POLL_DURATION_MS; const poll = { active: true, question: q.value.trim(), options: options.map((label, idx) => ({ id: 'o' + idx + '_' + now(), label, count: 0 })), state: 'voting', startedAt: now(), endsAt: now() + dur, votes: {} }; pollsRef.child('active').set(poll).then(() => { closeModal('pollModal'); }).catch(err => { console.error('createPoll error', err); alert('アンケート作成失敗'); }); }
function ensurePollListener() {
  pollsRef.child('active').on('value', snap => {
    const data = snap.val();
    if (!data || data.active !== true) { hidePollUI(); localActivePoll = null; return; }
    localActivePoll = data;
    renderPollState(data);
    if (data.state === 'finished') {
      if (_pollRemovalTimeout) { clearTimeout(_pollRemovalTimeout); _pollRemovalTimeout = null; }
      _pollRemovalTimeout = setTimeout(async () => {
        try {
          const snapCheck = await pollsRef.child('active').once('value');
          const cur = snapCheck.val();
          if (cur && cur.state === 'finished') { await pollsRef.child('active').remove(); }
        } catch (err) { console.error('poll removal error', err); } finally { hidePollUI(); if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); } _pollRemovalTimeout = null; }
      }, POLL_AFTER_FINISH_DISPLAY_MS);
    }
    if (data.state === 'voting' && now() >= (data.endsAt || 0)) finalizePoll();
  }, err => console.warn('poll listener error', err));
}
function renderPollState(poll) {
  const pollArea = el('pollArea'); const pollContent = el('pollContent'); const pollTimer = el('pollTimer');
  if (!pollArea || !pollContent) return;
  pollArea.style.display = 'block';
  pollContent.innerHTML = '';
  const header = document.createElement('div'); header.className = 'poll-header';
  const q = document.createElement('div'); q.className = 'poll-question'; q.textContent = poll.question || '';
  header.appendChild(q); pollContent.appendChild(header);
  const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options';
  const total = (poll.options || []).reduce((s, o) => s + (o.count || 0), 0) || 0;
  (poll.options || []).forEach(o => {
    const opt = document.createElement('div'); opt.className = 'poll-option'; opt.dataset.optId = o.id;
    const pct = total === 0 ? 0 : Math.round(((o.count || 0) / total) * 100);
    opt.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`;
    if (poll.state === 'voting') { opt.addEventListener('click', () => voteOption(o.id)); } else opt.style.opacity = '0.7';
    optionsWrap.appendChild(opt);
  });
  pollContent.appendChild(optionsWrap);

  if (pollTimer) {
    if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
    if (poll.state === 'voting') {
      const updateFn = () => {
        const remainingMs = Math.max(0, (poll.endsAt || 0) - now());
        if (remainingMs <= 0) {
          if (pollTimer) pollTimer.textContent = '集計中...';
          finalizePoll().catch(err => console.error('finalizePoll error', err));
          if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
          return;
        }
        if (pollTimer) pollTimer.textContent = `残り ${Math.ceil(remainingMs / 1000)} 秒`;
      };
      updateFn();
      const t = setInterval(updateFn, 500);
      _pollTimers.set('active', t);
    } else {
      pollTimer.textContent = '投票終了';
    }
  }
}
function hidePollUI() { const pa = el('pollArea'); if (pa) pa.style.display = 'none'; const pc = el('pollContent'); if (pc) pc.innerHTML = ''; }
function voteOption(optId) {
  const user = auth.currentUser; if (!user) return alert('投票にはログインが必要です');
  const uid = user.uid;
  const activeRef = pollsRef.child('active');
  activeRef.transaction(current => {
    if (!current) return current;
    if (current.state !== 'voting') return current;
    const prev = current.votes && current.votes[uid] && current.votes[uid].opt;
    if (prev) {
      const idxPrev = (current.options || []).findIndex(o => o.id === prev);
      if (idxPrev >= 0) current.options[idxPrev].count = Math.max(0, (current.options[idxPrev].count || 0) - 1);
    }
    const idx = (current.options || []).findIndex(o => o.id === optId);
    if (idx >= 0) current.options[idx].count = (current.options[idx].count || 0) + 1;
    if (!current.votes) current.votes = {};
    current.votes[uid] = { opt: optId, at: now(), name: user.displayName || user.email || 'ユーザー' };
    return current;
  }, (err, committed, snapshot) => { if (err) console.error('vote txn error', err); });
}
async function finalizePoll() {
  const activeRef = pollsRef.child('active');
  try {
    const snap = await activeRef.once('value');
    const poll = snap.val(); if (!poll) return;
    if (poll.state === 'finished') return;
    await activeRef.update({ state: 'finished', finishedAt: now() });
    await pollsRef.child('history').push(poll).catch(() => { });
    if (_pollTimers.has('active')) { clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
  } catch (err) { console.error('finalizePoll error', err); }
}

// ----------------- Calls & WebRTC (修正版) -----------------

// open request popup
function openCallRequestPopup(uid) {
  const content = el('callRequestContent'); if (content) content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`;
  window._callTargetUid = uid; openModal('callRequestPopup');
}

// Caller: create call node and wait for accepted -> start createOffer
function sendCallRequestFromPopup() {
  if (!auth.currentUser) return alert('ログインしてください');
  const toUid = window._callTargetUid; if (!toUid) return alert('ターゲットが不明です');
  const callId = callsRef.push().key;
  const callObj = { from: auth.currentUser.uid, to: toUid, state: 'pending', ts: now() };
  callsRef.child(callId).set(callObj).then(() => {
    console.log('call created', callId);
    currentOutgoingCallId = callId;
    closeModal('callRequestPopup');
    showCallerWaiting(callId, toUid);
    // listen for state change for this call
    callsRef.child(callId).on('value', snap => {
      const v = snap.val(); if (!v) return;
      if (v.state === 'accepted') {
        console.log('call accepted -> creating offer', callId);
        // create offer now, but do it as a user action if possible; this flow assumes accept click already is a user action on callee side
        startLocalAudioAndCreateOffer(callId).catch(e => console.error('startLocalAudioAndCreateOffer error', e));
      }
    });
    // auto-cancel if still pending
    setTimeout(() => {
      callsRef.child(callId).once('value').then(s => {
        const v = s.val();
        if (v && v.state === 'pending') callsRef.child(callId).update({ state: 'canceled', ts: now() }).catch(() => { });
      });
    }, CALL_REQUEST_TIMEOUT_MS);
  }).catch(err => { console.error('call send error', err); alert('送信失敗'); });
}

// Show waiting popup for caller
function showCallerWaiting(callId, toUid) {
  const c = el('callNotifyContent'); if (!c) return;
  c.innerHTML = `<div>通話リクエスト送信中: ${escapeHtml(toUid)}</div><div id="callWaitingState"></div>`;
  openModal('callNotifyPopup');
  ensureCallControlsInPopup('callNotifyContent', callId, true);
  const callNode = callsRef.child(callId);
  const listener = callNode.on('value', snap => {
    const v = snap.val(); const stateEl = el('callWaitingState');
    if (!v) { if (stateEl) stateEl.textContent = '相手が不在か、リクエストが消去されました'; callNode.off('value', listener); currentOutgoingCallId = null; return; }
    if (v.state === 'pending') { if (stateEl) stateEl.textContent = '応答待ち...'; }
    else if (v.state === 'accepted') { if (stateEl) stateEl.textContent = '相手が応答しました'; }
    else if (v.state === 'rejected') { if (stateEl) stateEl.textContent = '通話は拒否されました'; callNode.off('value', listener); currentOutgoingCallId = null; }
    else if (v.state === 'canceled') { if (stateEl) stateEl.textContent = 'リクエストはキャンセルされました'; callNode.off('value', listener); currentOutgoingCallId = null; }
  });
}

// Callee: incoming call listener
let incomingCallsListener = null;
function listenIncomingCalls(myUid) {
  if (!myUid) return;
  incomingCallsListener = callsRef.orderByChild('to').equalTo(myUid).on('child_added', snap => {
    const call = snap.val(); const callId = snap.key; if (!call) return;
    if (call.state !== 'pending') return;
    console.log('incoming call', callId, call.from);
    showIncomingCallPopup(callId, call.from);
    // watch for acceptance to start answer flow (startLocalAudioAndAnswer will read offer and answer)
    callsRef.child(callId).on('value', s => {
      const v = s.val(); if (!v) return;
      if (v.state === 'accepted') {
        // start answer flow (callee)
        console.log('call accepted (callee) -> startLocalAudioAndAnswer', callId);
        startLocalAudioAndAnswer(callId).catch(e => console.error('startLocalAudioAndAnswer error', e));
      }
    });
  });

  callsRef.on('child_changed', snap => {
    const call = snap.val(); if (!call || !auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    if (call.to === myUid && call.state !== 'pending') { if (el('incomingCallPopup')?.classList.contains('open')) closeModal('incomingCallPopup'); }
  });
}
function stopListeningIncomingCalls() { if (incomingCallsListener) { callsRef.off('child_added', incomingCallsListener); incomingCallsListener = null; } callsRef.off('child_changed'); }

// Incoming popup display
let _currentIncomingCallId = null;
function showIncomingCallPopup(callId, fromUid) {
  _currentIncomingCallId = callId;
  const c = el('incomingCallContent'); if (!c) return;
  c.innerHTML = `<div><strong>${escapeHtml(fromUid)}</strong> から通話のリクエストがあります</div>`;
  openModal('incomingCallPopup');
  ensureCallControlsInPopup('incomingCallContent', callId, false);
}

// accept/reject
function respondToIncomingCall(result) {
  if (!_currentIncomingCallId) return closeModal('incomingCallPopup');
  const callId = _currentIncomingCallId;
  if (result === 'accepted') {
    callsRef.child(callId).update({ state: 'accepted', ts: now() }).then(() => {
      closeModal('incomingCallPopup');
      // startLocalAudioAndAnswer will be triggered by DB watcher set in listenIncomingCalls
    }).catch(err => console.error('accept error', err));
  } else {
    callsRef.child(callId).update({ state: 'rejected', ts: now() }).then(() => {
      closeModal('incomingCallPopup');
    }).catch(err => console.error('reject error', err));
  }
}

// Called when caller sees DB state change
function handleOutgoingCallStateChange(callId, call) {
  if (!call) return;
  if (call.state === 'canceled' || call.state === 'rejected') {
    hangupCall(callId, true);
  }
}

// Ensure call controls (timer + hangup) appear inside popup container
function ensureCallControlsInPopup(containerId, callId, isCallerPopup) {
  const container = el(containerId);
  if (!container) return;
  let controls = container.querySelector('.call-controls');
  if (controls) controls.remove();
  controls = document.createElement('div'); controls.className = 'call-controls'; controls.style.marginTop = '8px'; controls.style.display = 'flex'; controls.style.alignItems = 'center'; controls.style.justifyContent = 'space-between';
  const timer = document.createElement('div'); timer.className = 'call-timer'; timer.textContent = '通話時間: 00:00';
  const hangupBtn = document.createElement('button'); hangupBtn.textContent = '通話終了'; hangupBtn.style.marginLeft = '12px';
  hangupBtn.addEventListener('click', () => {
    callsRef.child(callId).update({ state: 'finished', ts: now() }).catch(() => { });
    hangupCall(callId);
    closeModal('callNotifyPopup'); closeModal('incomingCallPopup');
  });
  controls.appendChild(timer);
  controls.appendChild(hangupBtn);
  container.appendChild(controls);

  const sess = rtcSessions[callId];
  if (sess && sess.callStartTs) {
    startCallTimerUI(callId, timer);
  } else {
    // poll until session start
    const waitInterval = setInterval(() => {
      const s = rtcSessions[callId];
      if (s && s.callStartTs) {
        startCallTimerUI(callId, timer);
        clearInterval(waitInterval);
      }
    }, 500);
    if (!rtcSessions[callId]) rtcSessions[callId] = {};
    rtcSessions[callId]._waitInterval = waitInterval;
  }
}

function startCallTimerUI(callId, timerEl) {
  const sess = rtcSessions[callId]; if (!sess) return;
  if (sess.timerInterval) clearInterval(sess.timerInterval);
  sess.timerInterval = setInterval(() => {
    const elapsed = Math.max(0, Date.now() - (sess.callStartTs || Date.now()));
    const sec = Math.floor(elapsed / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `通話時間: ${m}:${s}`;
  }, 500);
}

// Hangup: cleanup local resources. localCleanupOnly=true prevents DB updates.
function hangupCall(callId, localCleanupOnly = false) {
  const sess = rtcSessions[callId];
  if (sess) {
    if (sess.timerInterval) clearInterval(sess.timerInterval);
    if (sess._waitInterval) clearInterval(sess._waitInterval);
    if (sess.localStream) { sess.localStream.getTracks().forEach(t => t.stop()); }
    if (sess.pc) { try { sess.pc.close(); } catch (e) { } }
    if (sess.iceListenerRef) callsRef.child(callId).child('ice').off('child_added', sess.iceListenerRef);
    if (sess.remoteAudioEl) { try { sess.remoteAudioEl.srcObject = null; sess.remoteAudioEl.remove(); } catch (e) { } }
    delete rtcSessions[callId];
  }
  if (!localCleanupOnly) {
    callsRef.child(callId).update({ state: 'finished', ts: now() }).catch(() => { });
  }
}

// ----------------- WebRTC routines (堅牢化) -----------------

// Caller: create offer and write to DB
async function startLocalAudioAndCreateOffer(callId) {
  if (rtcSessions[callId]) { console.warn('session already exists for', callId); return; }
  console.log('startLocalAudioAndCreateOffer', callId);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const sess = { pc, localStream: null, remoteAudioEl: null, iceListenerRef: null, timerInterval: null, callStartTs: null };
  rtcSessions[callId] = sess;

  // getUserMedia must be called as a result of user action to avoid autoplay block; but if already accepted it's ok to call now
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    sess.localStream = stream;
    stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
    console.log('local media obtained for', callId);
  } catch (err) {
    console.error('getUserMedia failed', err);
    alert('マイクアクセスが必要です: ' + (err && err.message ? err.message : err));
    // set call to rejected/finished to inform remote
    callsRef.child(callId).update({ state: 'rejected', ts: now() }).catch(() => { });
    return;
  }

  // prepare remote audio element
  const remoteAudio = document.createElement('audio'); remoteAudio.autoplay = true; remoteAudio.playsInline = true;
  remoteAudio.style.display = 'none';
  document.body.appendChild(remoteAudio);
  sess.remoteAudioEl = remoteAudio;

  pc.ontrack = (evt) => {
    try {
      if (evt.streams && evt.streams[0]) {
        remoteAudio.srcObject = evt.streams[0];
      } else {
        const inbound = new MediaStream();
        inbound.addTrack(evt.track);
        remoteAudio.srcObject = inbound;
      }
      // try to play and log if blocked
      remoteAudio.play().then(() => { console.log('remoteAudio play succeeded for', callId); }).catch(e => { console.warn('remoteAudio.play blocked', e); });
    } catch (e) { console.warn('ontrack error', e); }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      const candidateObj = { candidate: e.candidate.toJSON(), from: auth.currentUser?.uid || 'anon', ts: now() };
      callsRef.child(callId).child('ice').push(candidateObj).catch(err => console.warn('push ice error', err));
      console.log('caller pushed ICE', callId, e.candidate.type || '');
    }
  };

  // Listen for remote answer (use RTCSessionDescription)
  callsRef.child(callId).child('answer').on('value', async snap => {
    const ans = snap.val();
    if (ans && ans.sdp) {
      try {
        console.log('answer received for', callId);
        await pc.setRemoteDescription(new RTCSessionDescription(ans.sdp));
        sess.callStartTs = now();
        // start timer UI if present
        const notifyTimer = el('callNotifyContent')?.querySelector('.call-timer');
        if (notifyTimer) startCallTimerUI(callId, notifyTimer);
      } catch (err) { console.error('setRemoteDescription(answer) failed', err); }
    }
  });

  // Listen for remote ICE
  const iceListener = callsRef.child(callId).child('ice').on('child_added', snap => {
    const obj = snap.val(); if (!obj) return;
    if (obj.from === auth.currentUser?.uid) return;
    const cand = obj.candidate;
    try {
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.warn('addIceCandidate.catch', e));
      console.log('caller added remote ICE', callId);
    } catch (e) { console.warn('addIceCandidate error', e); }
  });
  sess.iceListenerRef = iceListener;

  // create offer
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await callsRef.child(callId).child('offer').set({ sdp: offer.toJSON(), from: auth.currentUser?.uid || 'anon', ts: now() });
    console.log('offer written to DB', callId);
  } catch (err) {
    console.error('createOffer error', err);
  }
}

// Callee: read offer, create answer
async function startLocalAudioAndAnswer(callId) {
  if (rtcSessions[callId]) { console.warn('session already exists for', callId); return; }
  console.log('startLocalAudioAndAnswer', callId);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const sess = { pc, localStream: null, remoteAudioEl: null, iceListenerRef: null, timerInterval: null, callStartTs: null };
  rtcSessions[callId] = sess;

  // get offer from DB
  const offerSnap = await callsRef.child(callId).child('offer').once('value');
  const offerObj = offerSnap.val();
  if (!offerObj || !offerObj.sdp) {
    console.error('no offer for', callId);
    callsRef.child(callId).update({ state: 'rejected', ts: now() }).catch(() => { });
    return;
  }

  // get local media
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    sess.localStream = stream;
    stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
    console.log('local media obtained (callee) for', callId);
  } catch (err) {
    console.error('getUserMedia error', err);
    alert('マイクアクセスが必要です: ' + (err && err.message ? err.message : err));
    callsRef.child(callId).update({ state: 'rejected', ts: now() }).catch(() => { });
    return;
  }

  // prepare remote audio element
  const remoteAudio = document.createElement('audio'); remoteAudio.autoplay = true; remoteAudio.playsInline = true;
  remoteAudio.style.display = 'none';
  document.body.appendChild(remoteAudio);
  sess.remoteAudioEl = remoteAudio;

  pc.ontrack = (evt) => {
    try {
      if (evt.streams && evt.streams[0]) {
        remoteAudio.srcObject = evt.streams[0];
      } else {
        const inbound = new MediaStream();
        inbound.addTrack(evt.track);
        remoteAudio.srcObject = inbound;
      }
      remoteAudio.play().then(() => { console.log('remoteAudio play succeeded (callee) for', callId); }).catch(e => { console.warn('remoteAudio.play blocked (callee)', e); });
    } catch (e) { console.warn('ontrack error', e); }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      const candidateObj = { candidate: e.candidate.toJSON(), from: auth.currentUser?.uid || 'anon', ts: now() };
      callsRef.child(callId).child('ice').push(candidateObj).catch(err => console.warn('push ice error', err));
      console.log('callee pushed ICE', callId, e.candidate.type || '');
    }
  };

  // Listen for ICE candidates
  const iceListener = callsRef.child(callId).child('ice').on('child_added', snap => {
    const obj = snap.val(); if (!obj) return;
    if (obj.from === auth.currentUser?.uid) return;
    try {
      pc.addIceCandidate(new RTCIceCandidate(obj.candidate)).catch(e => console.warn('addIceCandidate.catch', e));
      console.log('callee added remote ICE', callId);
    } catch (e) { console.warn('addIceCandidate error', e); }
  });
  sess.iceListenerRef = iceListener;

  // set remote offer and create answer
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offerObj.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await callsRef.child(callId).child('answer').set({ sdp: answer.toJSON(), from: auth.currentUser?.uid || 'anon', ts: now() });
    console.log('answer written to DB', callId);
    sess.callStartTs = now();
    const incomingTimer = el('incomingCallContent')?.querySelector('.call-timer');
    if (incomingTimer) startCallTimerUI(callId, incomingTimer);
  } catch (err) {
    console.error('answer flow error', err);
  }
}

// ----------------- signaling cleanup -----------------
callsRef.on('child_changed', snap => {
  const call = snap.val(); const callId = snap.key;
  if (!call) return;
  if (call.state === 'finished' || call.state === 'rejected' || call.state === 'canceled') {
    hangupCall(callId, true);
    if (el('callNotifyPopup')?.classList.contains('open')) closeModal('callNotifyPopup');
    if (el('incomingCallPopup')?.classList.contains('open')) closeModal('incomingCallPopup');
  }
});

// ----------------- upload handler -----------------
function handleUploadForm(e) {
  e && e.preventDefault();
  const file = el('imageFile')?.files?.[0];
  if (!file) return alert('画像を選択してください');
  const fd = new FormData(); fd.append('file', file);
  fetch(GAS_URL, { method: 'POST', body: fd }).then(r => r.text()).then(url => {
    const user = auth.currentUser; if (!user) return alert('ログインしてください');
    user.updateProfile({ photoURL: url }).then(() => { const avatar = el('avatar'); if (avatar) avatar.src = url; closeModal('mypageModal'); }).catch(err => alert('更新失敗：' + err.message));
  }).catch(err => alert('アップロード失敗：' + err.message));
}

// debug
window.checkDebug = function () { console.log('firebase loaded?', typeof firebase !== 'undefined'); console.log('auth.currentUser', auth.currentUser); };
