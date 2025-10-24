// ====== Firebase 設定をあなたの値に置き換えてください ======
const firebaseConfig = {
  apiKey: "AIzaSyD1AK05uuGBw2U4Ne5LbKzzjzCqnln60mg",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://shige-live-default-rtdb.firebaseio.com/",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
if(typeof firebase === 'undefined'){ console.error('Firebase SDK が読み込まれていません'); }
else if(!firebase.apps.length){ firebase.initializeApp(firebaseConfig); }

// Refs
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref('comments');
const pollsRef = db.ref('polls');
const arrivalsRef = db.ref('arrivals');
const presenceRefRoot = db.ref('presence');
const callsRef = db.ref('calls');

// 定数
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;
const CALL_REQUEST_TIMEOUT_MS = 20 * 1000;

// ローカル状態
let firstCommentTime = null;
let _prevAuthUser = null;
let localActivePoll = null;
let myPresenceRef = null;
let currentIncomingCallListener = null;
let currentOutgoingCallId = null;

// ユーティリティ
function escapeHtml(s){ if(s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function now(){ return Date.now(); }
function el(id){ return document.getElementById(id); }

// DOM 準備とイベント初期化
document.addEventListener('DOMContentLoaded', () => {
  // modal helpers
  window.openModal = id => { const m = el(id); if(!m) return console.warn('openModal: no element', id); m.classList.add('open'); m.setAttribute('aria-hidden','false'); };
  window.closeModal = id => { const m = el(id); if(!m) return; m.classList.remove('open'); m.setAttribute('aria-hidden','true'); };

  document.querySelectorAll('.modal .close').forEach(btn=>{
    btn.addEventListener('click', () => { const id = btn.getAttribute('data-close') || btn.closest('.modal')?.id; if(id) closeModal(id); });
  });
  document.querySelectorAll('.modal').forEach(modal=>{
    modal.addEventListener('click', e => { if(e.target === modal) closeModal(modal.id); });
  });

  // UI wiring
  const sendBtn = el('sendBtn');
  if(sendBtn) sendBtn.addEventListener('click', sendComment);
  const pollBtn = el('pollBtn'); if(pollBtn) pollBtn.addEventListener('click', ()=> openModal('pollModal'));
  const addPollOptionBtn = el('addPollOptionBtn'); if(addPollOptionBtn) addPollOptionBtn.addEventListener('click', addPollOption);
  const createPollBtn = el('createPollBtn'); if(createPollBtn) createPollBtn.addEventListener('click', createPollFromModal);

  // simple test login/logout (replace with your flow)
  const loginBtn = el('loginBtn'), logoutBtn = el('logoutBtn');
  if(loginBtn) loginBtn.addEventListener('click', async () => {
    try {
      // テストアカウントでログイン。実運用ではサインアップUIを用意すること。
      const email = 'test@example.com';
      const password = 'password123';
      await auth.signInWithEmailAndPassword(email, password);
      console.log('test login ok');
    } catch(e){ console.error('login error', e); alert('テストログイン失敗: ' + e.message); }
  });
  if(logoutBtn) logoutBtn.addEventListener('click', ()=> auth.signOut());

  // modal call buttons
  const callCancelBtn = el('callCancelBtn'); if(callCancelBtn) callCancelBtn.addEventListener('click', ()=> closeModal('callRequestPopup'));
  const callSendBtn = el('callSendBtn'); if(callSendBtn) callSendBtn.addEventListener('click', sendCallRequestFromPopup);
  const rejectCallBtn = el('rejectCallBtn'); if(rejectCallBtn) rejectCallBtn.addEventListener('click', ()=> respondToIncomingCall('rejected'));
  const acceptCallBtn = el('acceptCallBtn'); if(acceptCallBtn) acceptCallBtn.addEventListener('click', ()=> respondToIncomingCall('accepted'));
  const callNotifyClose = el('callNotifyClose'); if(callNotifyClose) callNotifyClose.addEventListener('click', ()=> closeModal('callNotifyPopup'));

  // コメント欄内の動的ボタンはデリゲーションで扱う
  const commentsEl = el('comments');
  if(commentsEl){
    commentsEl.addEventListener('click', e => {
      const b = e.target.closest('.call-badge');
      if(b){ const uid = b.getAttribute('data-uid'); if(uid) openCallRequestPopup(uid); else alert('通話対象が不明です'); }
    });
    commentsEl.addEventListener('click', e => {
      const img = e.target.closest('img[data-uid]');
      if(img){ const uid = img.getAttribute('data-uid'); if(uid) openCallRequestPopup(uid); }
    });
  }

  // 初回ロード時にフォームを有効化
  const form = el('form'); if(form) form.style.display = 'flex';

  // グローバルセットアップ
  arrivalsRef.on('child_added', snap => { const d = snap.val(); if(d && d.type === 'arrival') showArrivalBanner(d.name || 'ゲスト'); snap.ref.remove().catch(()=>{}); });
  ensurePollListener();
  initComments();
});

// Arrival バナー
function showArrivalBanner(name){
  const banner = el('arrivalBanner'); if(!banner) return;
  banner.textContent = `${escapeHtml(name)}さんが配信を視聴しに来ました`;
  banner.style.display = 'block';
  if(banner._hideTimer) clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(()=>{ banner.style.display='none'; }, ARRIVAL_BANNER_DURATION);
}

// Auth / presence
auth.onAuthStateChanged(user => {
  const loginBtn = el('loginBtn'), logoutBtn = el('logoutBtn'), mypageBtn = el('mypageBtn');
  if(user){
    if(loginBtn) loginBtn.style.display = 'none';
    if(logoutBtn) logoutBtn.style.display = 'inline-block';
    if(mypageBtn) mypageBtn.style.display = 'inline-block';
    const name = user.displayName || user.email || 'ユーザー';
    arrivalsRef.push({ type:'arrival', name, timestamp: now() }).catch(()=>{});
    attachPresence(user.uid);
    listenIncomingCalls(user.uid);
  } else {
    if(loginBtn) loginBtn.style.display = 'inline-block';
    if(logoutBtn) logoutBtn.style.display = 'none';
    if(mypageBtn) mypageBtn.style.display = 'none';
    detachPresence();
    stopListeningIncomingCalls();
  }
  _prevAuthUser = user;
});

function attachPresence(uid){
  if(!uid) return;
  myPresenceRef = presenceRefRoot.child(uid);
  myPresenceRef.set({ online:true, lastSeen: now() }).catch(()=>{});
  try{ myPresenceRef.onDisconnect().set({ online:false, lastSeen: now() }).catch(()=>{}); }catch(e){}
}
function detachPresence(){
  if(myPresenceRef){ myPresenceRef.set({ online:false, lastSeen: now() }).catch(()=>{}); try{ myPresenceRef.onDisconnect().cancel(); }catch(e){} myPresenceRef = null; }
}

// Comments: init & render
function initComments(){
  // determine earliest timestamp to enforce 3 hour window
  commentsRef.orderByChild('ts').limitToFirst(1).once('value').then(snap => {
    let earliest = null;
    snap.forEach(child => { const d = child.val(); if(d && d.ts) earliest = d.ts; });
    firstCommentTime = earliest || now();
  }).catch(()=>{ firstCommentTime = now(); });

  // listen adds (newest at top)
  commentsRef.orderByChild('ts').limitToLast(500).on('child_added', snap => {
    const d = snap.val(); if(!d) return;
    if(d.ts && (d.ts - (firstCommentTime || now()) > THREE_HOURS)) return; // ignore older than window
    renderComment(d);
  }, err => console.warn('comments on error', err));
}

function renderComment(d){
  const commentsEl = el('comments'); if(!commentsEl) return;
  const div = document.createElement('div'); div.className = 'comment';
  const avatarUrl = d.photo || 'https://via.placeholder.com/40';
  const name = d.name || '匿名';
  const time = d.ts ? new Date(d.ts).toLocaleTimeString() : '';
  div.innerHTML = `
    <img src="${escapeHtml(avatarUrl)}" alt="avatar" width="40" height="40" style="border-radius:50%" data-uid="${escapeHtml(d.uid||'')}" />
    <div class="meta">
      <strong>${escapeHtml(name)} <small style="color:#666;font-weight:400;margin-left:6px">${escapeHtml(time)}</small></strong>
      <div>${escapeHtml(d.text)}</div>
    </div>
    <div style="margin-left:auto;display:flex;align-items:center;">
      <span class="call-badge" data-uid="${escapeHtml(d.uid||'')}">通話</span>
    </div>
  `;
  commentsEl.insertBefore(div, commentsEl.firstChild || null);
}

// send comment
function sendComment(){
  const input = el('commentInput'); if(!input) return alert('入力欄が見つかりません');
  const text = input.value.trim(); if(!text) return alert('コメントを入力してください');
  const user = auth.currentUser;
  if(!user) return alert('コメントにはログインが必要です（テストログインを使用してください）');

  const payload = { uid: user.uid, name: user.displayName || user.email || 'ユーザー', photo: user.photoURL || '', text, ts: now() };
  commentsRef.push(payload).then(()=> { input.value = ''; }).catch(err => { console.error('コメント保存エラー', err); alert('送信失敗'); });
}

// Polls: create / listen / vote
function addPollOption(){
  const wrap = el('pollOptionsWrapper'); if(!wrap) return;
  const input = document.createElement('input'); input.type='text'; input.className='pollOptionInput'; input.placeholder='選択肢';
  wrap.appendChild(input);
}
function createPollFromModal(){
  const q = el('pollQuestion'); const options = Array.from(document.querySelectorAll('.pollOptionInput')).map(i=>i.value.trim()).filter(v=>v);
  if(!q || !options.length) return alert('質問と少なくとも1つの選択肢を入力してください');
  const dur = POLL_DURATION_MS;
  const poll = {
    active: true,
    question: q.value.trim(),
    options: options.map((label, idx) => ({ id: 'o' + idx + '_' + Date.now(), label, count: 0 })),
    state: 'voting',
    startedAt: now(),
    endsAt: now() + dur,
    votes: {}
  };
  pollsRef.child('active').set(poll).then(()=> {
    closeModal('pollModal');
  }).catch(err => { console.error('createPoll error', err); alert('アンケート作成失敗'); });
}

function ensurePollListener(){
  pollsRef.child('active').on('value', snap => {
    const data = snap.val();
    if(!data || data.active !== true){ hidePollUI(); localActivePoll = null; return; }
    localActivePoll = data;
    renderPollState(data);
    // auto finalize when expired
    if(data.state === 'voting' && now() >= (data.endsAt||0)) finalizePoll();
  }, err => console.warn('poll listener error', err));
}

function renderPollState(poll){
  const pollArea = el('pollArea'); const pollContent = el('pollContent'); const pollTimer = el('pollTimer');
  if(!pollArea || !pollContent) return;
  pollArea.style.display = 'block';
  pollContent.innerHTML = '';
  const header = document.createElement('div'); header.className = 'poll-header';
  const q = document.createElement('div'); q.className = 'poll-question'; q.textContent = poll.question || '';
  header.appendChild(q);
  pollContent.appendChild(header);

  const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options';
  const total = (poll.options||[]).reduce((s,o)=>s + (o.count||0), 0) || 0;
  (poll.options||[]).forEach(o => {
    const opt = document.createElement('div'); opt.className = 'poll-option'; opt.dataset.optId = o.id;
    const pct = total === 0 ? 0 : Math.round(((o.count||0)/total)*100);
    opt.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`;
    if(poll.state === 'voting'){
      opt.addEventListener('click', ()=> voteOption(o.id));
    } else {
      opt.style.opacity = '0.7';
    }
    optionsWrap.appendChild(opt);
  });
  pollContent.appendChild(optionsWrap);

  // timer
  if(pollTimer){
    if(poll.state === 'voting'){
      const remainingMs = Math.max(0, (poll.endsAt || 0) - now());
      pollTimer.textContent = `残り ${Math.ceil(remainingMs/1000)} 秒`;
      // update countdown
      if(poll._timerInterval) clearInterval(poll._timerInterval);
      poll._timerInterval = setInterval(() => {
        const rem = Math.max(0, (poll.endsAt || 0) - now());
        if(rem <= 0){ clearInterval(poll._timerInterval); poll._timerInterval = null; pollTimer.textContent = '集計中...'; finalizePoll(); }
        else pollTimer.textContent = `残り ${Math.ceil(rem/1000)} 秒`;
      }, 500);
    } else {
      pollTimer.textContent = '投票終了';
    }
  }
}

function hidePollUI(){ const pollArea = el('pollArea'); if(pollArea) pollArea.style.display = 'none'; const pollContent = el('pollContent'); if(pollContent) pollContent.innerHTML = ''; }

function voteOption(optId){
  const user = auth.currentUser; if(!user) return alert('投票にはログインが必要です');
  const uid = user.uid;
  // register vote under active/votes/{uid} and update counts atomically via transaction
  const activeRef = pollsRef.child('active');
  activeRef.transaction(current => {
    if(!current) return current;
    if(current.state !== 'voting') return current;
    // decrement previous vote (if any)
    const prev = current.votes && current.votes[uid] && current.votes[uid].opt;
    if(prev){
      const idxPrev = (current.options||[]).findIndex(o=>o.id===prev);
      if(idxPrev >= 0) current.options[idxPrev].count = Math.max(0,(current.options[idxPrev].count||0)-1);
    }
    // increment new vote
    const idx = (current.options||[]).findIndex(o=>o.id===optId);
    if(idx >= 0) current.options[idx].count = (current.options[idx].count||0) + 1;
    if(!current.votes) current.votes = {};
    current.votes[uid] = { opt: optId, at: now(), name: user.displayName || user.email || 'ユーザー' };
    return current;
  }, (err, committed, snapshot) => {
    if(err) console.error('vote txn error', err);
  });
}

function finalizePoll(){
  // move poll to finished and clear active
  pollsRef.child('active').once('value').then(snap => {
    const poll = snap.val(); if(!poll) return;
    if(poll.state === 'finished') return;
    // mark finished
    pollsRef.child('active').update({ state: 'finished', finishedAt: now() }).catch(()=>{});
    // optionally push to history
    pollsRef.child('history').push(poll).catch(()=>{});
    // hide after short delay
    setTimeout(()=> hidePollUI(), 2000);
  }).catch(err => console.warn('finalize error', err));
}

// Calls (minimal wiring)
function openCallRequestPopup(uid){
  const content = el('callRequestContent'); if(content) content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`;
  // store target on window for send
  window._callTargetUid = uid;
  openModal('callRequestPopup');
}
function sendCallRequestFromPopup(){
  if(!auth.currentUser) return alert('ログインしてください');
  const toUid = window._callTargetUid; if(!toUid) return alert('ターゲットが不明です');
  const callId = callsRef.push().key;
  const callObj = { from: auth.currentUser.uid, to: toUid, state: 'pending', ts: now() };
  callsRef.child(callId).set(callObj).then(()=> {
    currentOutgoingCallId = callId; closeModal('callRequestPopup'); showCallerWaiting(callId, toUid);
    setTimeout(()=> { callsRef.child(callId).once('value').then(s=> { const v = s.val(); if(v && v.state === 'pending') callsRef.child(callId).update({ state: 'canceled', ts: now() }); }); }, CALL_REQUEST_TIMEOUT_MS);
  }).catch(err=> { console.error('call send error', err); alert('送信失敗'); });
}
function showCallerWaiting(callId, toUid){
  const c = el('callNotifyContent'); if(!c) return;
  c.innerHTML = `<div>通話リクエスト送信中: ${escapeHtml(toUid)}</div><div id="callWaitingState"></div>`; openModal('callNotifyPopup');
  const callNode = callsRef.child(callId);
  const listener = callNode.on('value', snap => {
    const v = snap.val(); const sEl = el('callWaitingState');
    if(!v){ if(sEl) sEl.textContent = '相手が不在か、リクエストが消去されました'; callNode.off('value', listener); currentOutgoingCallId = null; return; }
    if(v.state === 'pending'){ if(sEl) sEl.textContent = '応答待ち...'; }
    else if(v.state === 'accepted'){ if(sEl) sEl.textContent = '相手が応答しました'; callNode.off('value', listener); currentOutgoingCallId = null; }
    else if(v.state === 'rejected'){ if(sEl) sEl.textContent = '通話は拒否されました'; callNode.off('value', listener); currentOutgoingCallId = null; }
    else if(v.state === 'canceled'){ if(sEl) sEl.textContent = 'リクエストはキャンセルされました'; callNode.off('value', listener); currentOutgoingCallId = null; }
  });
}

let incomingCallsListener = null;
function listenIncomingCalls(myUid){
  if(!myUid) return;
  incomingCallsListener = callsRef.orderByChild('to').equalTo(myUid).on('child_added', snap => {
    const call = snap.val(); const callId = snap.key; if(!call) return;
    if(call.state !== 'pending') return;
    // show only if caller is online (optional)
    presenceRefRoot.child(call.from).once('value').then(psnap => { const p = psnap.val(); const online = !!p && !!p.online; if(online) showIncomingCallPopup(callId, call.from); }).catch(()=>{});
  });
  callsRef.on('child_changed', snap => {
    const call = snap.val(); if(!call || !auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    if(call.to === myUid && call.state !== 'pending'){ if(el('incomingCallPopup')?.classList.contains('open')) closeModal('incomingCallPopup'); }
  });
}
function stopListeningIncomingCalls(){ if(incomingCallsListener) { callsRef.off('child_added', incomingCallsListener); incomingCallsListener = null; } callsRef.off('child_changed'); }

let _currentIncomingCallId = null;
function showIncomingCallPopup(callId, fromUid){
  _currentIncomingCallId = callId;
  const c = el('incomingCallContent'); if(c) c.innerHTML = `<div><strong>${escapeHtml(fromUid)}</strong> から通話のリクエストがあります</div>`;
  openModal('incomingCallPopup');
  if(currentIncomingCallListener) callsRef.child(_currentIncomingCallId).off('value', currentIncomingCallListener);
  currentIncomingCallListener = callsRef.child(callId).on('value', snap => {
    const v = snap.val(); if(!v){ closeModal('incomingCallPopup'); callsRef.child(callId).off('value', currentIncomingCallListener); currentIncomingCallListener = null; _currentIncomingCallId = null; return; }
    if(v.state !== 'pending'){ closeModal('incomingCallPopup'); callsRef.child(callId).off('value', currentIncomingCallListener); currentIncomingCallListener = null; _currentIncomingCallId = null; }
  });
}
function respondToIncomingCall(result){
  if(!_currentIncomingCallId) return closeModal('incomingCallPopup');
  const callId = _currentIncomingCallId;
  callsRef.child(callId).update({ state: result === 'accepted' ? 'accepted' : 'rejected', ts: now() }).then(()=> {
    closeModal('incomingCallPopup');
    if(currentIncomingCallListener) callsRef.child(callId).off('value', currentIncomingCallListener);
    currentIncomingCallListener = null; _currentIncomingCallId = null;
  }).catch(()=>{});
}

// global notify for caller side
callsRef.on('child_changed', snap => {
  const v = snap.val(); if(!v || !auth.currentUser) return;
  const myUid = auth.currentUser.uid;
  if(v.from === myUid){
    const c = el('callNotifyContent'); if(!c) return;
    if(v.state === 'rejected'){ c.innerHTML = `<div>通話は拒否されました</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null; }
    else if(v.state === 'accepted'){ c.innerHTML = `<div>相手が応答しました。通話を開始してください。</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null; }
    else if(v.state === 'canceled'){ c.innerHTML = `<div>リクエストはキャンセルされました</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null; }
  }
});

// 最後に：エラー時のヒントを Console に出す簡易関数
window.checkDebug = function(){
  console.log('firebase?', typeof firebase !== 'undefined');
  console.log('auth currentUser', auth.currentUser);
  console.log('commentsRef connected? (no direct way) check DB rules and console errors');
};
