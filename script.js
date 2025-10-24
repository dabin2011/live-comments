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
if(typeof firebase === 'undefined') {
  console.error('Firebase SDK が読み込まれていません。index.html のスクリプト順を確認してください。');
} else if(!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Refs
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref("comments");
const pollsRef = db.ref("polls");
const arrivalsRef = db.ref("arrivals");
const presenceRefRoot = db.ref("presence");
const callsRef = db.ref("calls");

// Apps Script URL (画像アップロード) を自分の URL に置き換えてください
const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

// 小さめの定数
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;
const CALL_REQUEST_TIMEOUT_MS = 20 * 1000;

// ローカル状態
let firstCommentTime = null;
let _prevAuthUser = null;
let myPresenceRef = null;
let currentIncomingCallListener = null;
let currentOutgoingCallId = null;

// HTML 操作は DOMContentLoaded 後に行う（確実）
document.addEventListener('DOMContentLoaded', () => {
  // モーダル操作
  window.openModal = function(id){
    const el = document.getElementById(id);
    if(!el) return console.warn('openModal: element not found', id);
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
  };
  window.closeModal = function(id){
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden','true');
  };

  // 共通のモーダル閉じボタン
  document.querySelectorAll('.modal .close').forEach(btn=>{
    btn.addEventListener('click', e => {
      const id = btn.getAttribute('data-close') || btn.closest('.modal')?.id;
      if(id) closeModal(id);
    });
  });

  // デバッグ用（コンソールから呼べる）
  window.openModalTest = (id='callRequestPopup') => {
    console.log('openModalTest', id);
    openModal(id);
  };
  window.logDomStatus = () => {
    console.log('callRequestPopup exists?', !!document.getElementById('callRequestPopup'));
    console.log('incomingCallPopup exists?', !!document.getElementById('incomingCallPopup'));
    console.log('callNotifyPopup exists?', !!document.getElementById('callNotifyPopup'));
    console.log('openModal defined?', typeof openModal === 'function');
  };

  // イベントの一部（モーダル内ボタン）
  const cancelBtn = document.getElementById('callCancelBtn'); if(cancelBtn) cancelBtn.addEventListener('click', ()=>{ closeModal('callRequestPopup'); currentOutgoingCallId = null; });
  const sendBtn = document.getElementById('callSendBtn'); if(sendBtn) sendBtn.addEventListener('click', sendCallRequestFromPopup);
  const rejectBtn = document.getElementById('rejectCallBtn'); if(rejectBtn) rejectBtn.addEventListener('click', ()=> respondToIncomingCall('rejected'));
  const acceptBtn = document.getElementById('acceptCallBtn'); if(acceptBtn) acceptBtn.addEventListener('click', ()=> respondToIncomingCall('accepted'));
  const notifyClose = document.getElementById('callNotifyClose'); if(notifyClose) notifyClose.addEventListener('click', ()=> closeModal('callNotifyPopup'));

  // コメント欄の通話ボタンはイベントデリゲーションで対応（動的挿入を考慮）
  const commentsEl = document.getElementById('comments');
  if(commentsEl){
    commentsEl.addEventListener('click', (ev) => {
      const badge = ev.target.closest('.call-badge');
      if(!badge) return;
      const targetUid = badge.getAttribute('data-uid');
      if(!targetUid) return alert('ターゲット不明');
      onUserIconClick(targetUid);
    });
    // avatar クリックも拾う
    commentsEl.addEventListener('click', (ev) => {
      const img = ev.target.closest('img[data-uid]');
      if(!img) return;
      const targetUid = img.getAttribute('data-uid');
      if(!targetUid) return;
      onUserIconClick(targetUid);
    });
  }

  // フォーム submit（画像アップロード）
  const uf = document.getElementById('uploadForm');
  if(uf) uf.addEventListener('submit', handleUploadForm);

  // 初期表示（デバッグ用にフォームを見える状態）
  const formEl = document.getElementById('form'); if(formEl) formEl.style.display = 'flex';

  // DB リスナ登録
  setupGlobal();
});

// 全体セットアップ（DBリスナなど）
function setupGlobal(){
  arrivalsRef.on('child_added', snap => { const d = snap.val(); if(d && d.type === 'arrival') showArrivalBanner(d.name); snap.ref.remove().catch(()=>{}); });
  initComments();
  ensurePollListener();
}

// Arrival
function showArrivalBanner(name){
  const banner = document.getElementById('arrivalBanner'); if(!banner) return;
  banner.textContent = `${(name || 'ゲスト')}さんが配信を視聴しに来ました`;
  banner.style.display = 'block';
  banner.classList.add('show');
  if(banner._hideTimer) clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(()=>{ banner.classList.remove('show'); setTimeout(()=>{ banner.style.display='none'; },300); }, ARRIVAL_BANNER_DURATION);
}

// Auth + presence
auth.onAuthStateChanged(user => {
  const loginBtn = document.getElementById('loginBtn');
  const mypageBtn = document.getElementById('mypageBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if(user){
    if(loginBtn) loginBtn.style.display = 'none';
    if(mypageBtn) mypageBtn.style.display = 'inline-block';
    if(logoutBtn) logoutBtn.style.display = 'inline-block';
    const uname = user.displayName || user.email || '';
    const avatarEl = document.getElementById('avatar'); if(avatarEl) avatarEl.src = user.photoURL || '';
    const unameEl = document.getElementById('username'); if(unameEl) unameEl.textContent = uname;
    if(!_prevAuthUser){
      arrivalsRef.push({ type:'arrival', name: uname || 'ゲスト', timestamp: Date.now() }).catch(()=>{});
      showArrivalBanner(uname);
    }
    attachPresence(user.uid);
    listenIncomingCalls(user.uid);
  } else {
    if(loginBtn) loginBtn.style.display = 'inline-block';
    if(mypageBtn) mypageBtn.style.display = 'none';
    if(logoutBtn) logoutBtn.style.display = 'none';
    detachPresence();
    stopListeningIncomingCalls();
  }
  _prevAuthUser = user;
});

// Presence
function attachPresence(uid){
  if(!uid) return;
  myPresenceRef = presenceRefRoot.child(uid);
  myPresenceRef.set({ online: true, lastSeen: Date.now() }).catch(()=>{});
  myPresenceRef.onDisconnect().set({ online: false, lastSeen: Date.now() }).catch(()=>{});
}
function detachPresence(){
  if(myPresenceRef){
    myPresenceRef.set({ online: false, lastSeen: Date.now() }).catch(()=>{});
    try{ myPresenceRef.onDisconnect().cancel(); }catch(e){}
    myPresenceRef = null;
  }
}

// Comments
function initComments(){
  commentsRef.once('value', snap => {
    let earliest = null;
    snap.forEach(child => { const d = child.val(); if(d && d.timestamp && (!earliest || d.timestamp < earliest)) earliest = d.timestamp; });
    firstCommentTime = earliest || Date.now();
    commentsRef.on('child_added', cs => {
      const d = cs.val(); if(!d || !d.timestamp) return; if(d.timestamp - firstCommentTime > THREE_HOURS) return;
      insertComment(d);
    });
  }, err => console.warn('comments.once error', err));
}
function insertComment(d){
  const commentsEl = document.getElementById('comments'); if(!commentsEl) return;
  const div = document.createElement('div'); div.className = 'comment';
  const avatarUrl = d.photo || 'https://via.placeholder.com/40';
  div.innerHTML = `
    <img src="${escapeHtml(avatarUrl)}" alt="avatar" data-uid="${escapeHtml(d.uid||'')}" />
    <div class="meta">
      <div><strong>${escapeHtml(d.name)}</strong></div>
      <div>${escapeHtml(d.text)}</div>
    </div>
    <div style="margin-left:auto;display:flex;align-items:center;">
      <span class="presence-dot presence-offline" id="presenceDot-${escapeHtml(d.uid||'')}"></span>
      <div class="call-badge" data-uid="${escapeHtml(d.uid||'')}">通話</div>
    </div>
  `;
  commentsEl.insertBefore(div, commentsEl.firstChild || null);

  // presence indicator
  const uid = d.uid;
  if(uid) {
    presenceRefRoot.child(uid).on('value', snap => {
      const v = snap.val();
      const dot = document.getElementById(`presenceDot-${uid}`);
      if(dot){
        dot.classList.toggle('presence-online', !!v && v.online);
        dot.classList.toggle('presence-offline', !v || !v.online);
      }
    });
  }
}
function sendComment(){ const user = auth.currentUser; const text = document.getElementById('commentInput').value.trim(); if(!user) return alert('ログインしてください'); if(!text) return; commentsRef.push({ uid:user.uid, name:user.displayName||user.email, photo:user.photoURL||'', text, timestamp: Date.now() }).then(()=> document.getElementById('commentInput').value = '').catch(err=>alert('保存失敗：' + err.message)); }

// Caller flow: popup target selected by uid
let _callPopupTargetUid = null;
function onUserIconClick(uid){
  _callPopupTargetUid = uid;
  const content = document.getElementById('callRequestContent');
  if(content) content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`;
  openModal('callRequestPopup');
}

// Send call request
function sendCallRequestFromPopup(){
  if(!auth.currentUser){ alert('ログインしてください'); closeModal('callRequestPopup'); return; }
  const fromUid = auth.currentUser.uid;
  const toUid = _callPopupTargetUid;
  if(!toUid){ alert('ターゲットが見つかりません'); closeModal('callRequestPopup'); return; }
  const callId = callsRef.push().key;
  const callObj = { from: fromUid, to: toUid, state: 'pending', ts: Date.now() };
  callsRef.child(callId).set(callObj).then(()=>{
    currentOutgoingCallId = callId;
    closeModal('callRequestPopup');
    showCallerWaiting(callId, toUid);
    setTimeout(()=> {
      callsRef.child(callId).once('value').then(s => {
        const v = s.val();
        if(v && v.state === 'pending') {
          callsRef.child(callId).update({ state: 'canceled', ts: Date.now() });
        }
      });
    }, CALL_REQUEST_TIMEOUT_MS);
  }).catch(()=>{ alert('通話リクエスト送信失敗'); closeModal('callRequestPopup'); });
}
function showCallerWaiting(callId, toUid){
  const notifyContent = document.getElementById('callNotifyContent'); if(!notifyContent) return;
  notifyContent.innerHTML = `<div>通話リクエスト送信中: ${escapeHtml(toUid)}</div><div id="callWaitingState"></div>`;
  openModal('callNotifyPopup');
  const callNode = callsRef.child(callId);
  const listener = callNode.on('value', snap => {
    const v = snap.val();
    const stateEl = document.getElementById('callWaitingState');
    if(!v){
      if(stateEl) stateEl.textContent = '相手が不在か、リクエストが消去されました';
      callNode.off('value', listener);
      currentOutgoingCallId = null;
      return;
    }
    if(v.state === 'pending') if(stateEl) stateEl.textContent = '応答待ち...';
    else if(v.state === 'accepted') { if(stateEl) stateEl.textContent = '相手が応答しました。通話を開始してください。'; callNode.off('value', listener); currentOutgoingCallId = null; }
    else if(v.state === 'rejected') { if(stateEl) stateEl.textContent = '通話は拒否されました'; callNode.off('value', listener); currentOutgoingCallId = null; }
    else if(v.state === 'canceled') { if(stateEl) stateEl.textContent = 'リクエストはキャンセルされました'; callNode.off('value', listener); currentOutgoingCallId = null; }
  });
}

// Incoming calls
let incomingCallsListener = null;
function listenIncomingCalls(myUid){
  if(!myUid) return;
  incomingCallsListener = callsRef.orderByChild('to').equalTo(myUid).on('child_added', snap => {
    const call = snap.val(); const callId = snap.key;
    if(!call || call.state !== 'pending') return;
    presenceRefRoot.child(call.from).once('value').then(psnap => {
      const p = psnap.val(); if(!p || !p.online) return;
      showIncomingCallPopup(callId, call.from);
    }).catch(()=>{});
  });
  callsRef.on('child_changed', snap => {
    const call = snap.val(); if(!call || !auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    if(call.to === myUid && call.state !== 'pending'){ if(document.getElementById('incomingCallPopup').classList.contains('open')) closeModal('incomingCallPopup'); }
  });
}
function stopListeningIncomingCalls(){ if(incomingCallsListener) { callsRef.off('child_added', incomingCallsListener); incomingCallsListener = null; } callsRef.off('child_changed'); }

let _currentIncomingCallId = null;
function showIncomingCallPopup(callId, fromUid){
  _currentIncomingCallId = callId;
  const content = document.getElementById('incomingCallContent'); if(!content) return;
  content.innerHTML = `<div><strong>${escapeHtml(fromUid)}</strong> から通話のリクエストがあります</div>`;
  openModal('incomingCallPopup');
  if(currentIncomingCallListener) callsRef.child(_currentIncomingCallId).off('value', currentIncomingCallListener);
  currentIncomingCallListener = callsRef.child(callId).on('value', snap => {
    const v = snap.val();
    if(!v){ closeModal('incomingCallPopup'); callsRef.child(callId).off('value', currentIncomingCallListener); currentIncomingCallListener = null; _currentIncomingCallId = null; return; }
    if(v.state !== 'pending'){ closeModal('incomingCallPopup'); callsRef.child(callId).off('value', currentIncomingCallListener); currentIncomingCallListener = null; _currentIncomingCallId = null; }
  });
}

function respondToIncomingCall(result){
  if(!_currentIncomingCallId) return closeModal('incomingCallPopup');
  const callId = _currentIncomingCallId;
  if(result === 'accepted'){
    callsRef.child(callId).update({ state: 'accepted', ts: Date.now() }).then(()=>{ closeModal('incomingCallPopup'); if(currentIncomingCallListener) callsRef.child(callId).off('value', currentIncomingCallListener); currentIncomingCallListener = null; _currentIncomingCallId = null; }).catch(()=>{});
  } else {
    callsRef.child(callId).update({ state: 'rejected', ts: Date.now() }).then(()=>{ closeModal('incomingCallPopup'); if(currentIncomingCallListener) callsRef.child(callId).off('value', currentIncomingCallListener); currentIncomingCallListener = null; _currentIncomingCallId = null; }).catch(()=>{});
  }
}

// Global notify for caller
callsRef.on('child_changed', snap => {
  const v = snap.val(); if(!v || !auth.currentUser) return;
  const myUid = auth.currentUser.uid;
  if(v.from === myUid){
    const el = document.getElementById('callNotifyContent'); if(!el) return;
    if(v.state === 'rejected') { el.innerHTML = `<div>通話は拒否されました</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null; }
    else if(v.state === 'accepted') { el.innerHTML = `<div>相手が応答しました。通話を開始してください。</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null; }
    else if(v.state === 'canceled') { el.innerHTML = `<div>リクエストはキャンセルされました</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null; }
  }
});

// Polls: 最小実装
let localPollListenerSet = false;
function ensurePollListener(){
  if(localPollListenerSet) return;
  pollsRef.child('active').on('value', snap => {
    const data = snap.val();
    if(!data || data.active !== true){ hidePollUI(); return; }
    renderPollState(data);
  }, err => console.warn('poll listener error', err));
  localPollListenerSet = true;
}
function renderPollState(poll){
  const pollArea = document.getElementById('pollArea'); const pollContent = document.getElementById('pollContent');
  if(!pollArea || !pollContent) return;
  pollArea.style.display = 'block'; pollContent.innerHTML = '';
  const header = document.createElement('div'); header.className = 'poll-header';
  const q = document.createElement('div'); q.className = 'poll-question'; q.textContent = poll.question || '';
  header.appendChild(q); pollContent.appendChild(header);
  const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options';
  (poll.options||[]).forEach(o => {
    const optEl = document.createElement('div'); optEl.className = 'poll-option';
    optEl.dataset.optId = o.id || '';
    const total = (poll.options||[]).reduce((s,x)=>s + (x.count||0),0);
    const pct = total === 0 ? 0 : Math.round(((o.count||0)/total)*100);
    optEl.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`;
    if(poll.state === 'voting'){ optEl.addEventListener('click', ()=> voteOption(o.id)); }
    else optEl.classList.add('disabled');
    optionsWrap.appendChild(optEl);
  });
  pollContent.appendChild(optionsWrap);
}
function hidePollUI(){ const pollArea = document.getElementById('pollArea'); if(!pollArea) return; pollArea.style.display='none'; const pc=document.getElementById('pollContent'); if(pc) pc.innerHTML=''; }
function voteOption(optId){ const user = auth.currentUser; if(!user) return alert('ログインしてください'); pollsRef.child('active').child('votes').child(user.uid).set({ opt: optId, at: Date.now(), name: user.displayName || user.email }).catch(()=>{}); }

// Upload handler
function handleUploadForm(e){
  e && e.preventDefault();
  const file = document.getElementById('imageFile').files[0];
  if(!file) return alert('画像を選択してください');
  const fd = new FormData(); fd.append('file', file);
  fetch(GAS_URL, { method: 'POST', body: fd })
    .then(r => r.text())
    .then(url => {
      const user = auth.currentUser; if(!user) return alert('ログインしてください');
      user.updateProfile({ photoURL: url }).then(()=> { const avatar=document.getElementById('avatar'); if(avatar) avatar.src=url; closeModal('mypageModal'); }).catch(err=>alert('更新失敗：' + err.message));
    }).catch(err=>alert('アップロード失敗：' + err.message));
}

// 小ユーティリティ
function escapeHtml(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
