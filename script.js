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
  console.error('Firebase SDK が読み込まれていません。index.html のスクリプト読み込み順を確認してください。');
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

// Apps Script URL for image upload (deploy your Apps Script Web App and paste URL here)
const GAS_URL = "https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXX/exec";

// Constants
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;
const CALL_REQUEST_TIMEOUT_MS = 20 * 1000;

// Local state
let firstCommentTime = null;
let _prevAuthUser = null;
let localActivePoll = null;
let localPollListenerSet = false;
let myVoteOpt = null;
let myPresenceRef = null;
let currentIncomingCallListener = null;
let currentOutgoingCallId = null;

// Utility
function escapeHtml(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function formatTimeOnly(ts){ const d=new Date(ts); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

// Modal helpers and startup (safe: run after DOM ready)
document.addEventListener('DOMContentLoaded', () => {
  window.openModal = function(id){
    const el = document.getElementById(id); if(!el) return;
    el.classList.add('open'); el.setAttribute('aria-hidden','false');
    const focusable = el.querySelector('input,button,select,textarea,[tabindex]');
    if(focusable) focusable.focus();
  };
  window.closeModal = function(id){
    const el = document.getElementById(id); if(!el) return;
    el.classList.remove('open'); el.setAttribute('aria-hidden','true');
  };
  document.querySelectorAll('.modal .close').forEach(btn=>{
    btn.addEventListener('click', () => { const id = btn.getAttribute('data-close') || btn.closest('.modal')?.id; if(id) closeModal(id); });
  });
  document.querySelectorAll('.modal').forEach(modal=>{
    modal.addEventListener('click', e => { if(e.target === modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); } });
  });

  // wire call popup buttons (guard for missing elements)
  const cancelBtn = document.getElementById('callCancelBtn'); if(cancelBtn) cancelBtn.addEventListener('click', ()=>{ closeModal('callRequestPopup'); currentOutgoingCallId = null; });
  const sendBtn = document.getElementById('callSendBtn'); if(sendBtn) sendBtn.addEventListener('click', sendCallRequestFromPopup);
  const rejectBtn = document.getElementById('rejectCallBtn'); if(rejectBtn) rejectBtn.addEventListener('click', respondToIncomingCall.bind(null,'rejected'));
  const acceptBtn = document.getElementById('acceptCallBtn'); if(acceptBtn) acceptBtn.addEventListener('click', respondToIncomingCall.bind(null,'accepted'));
  const notifyClose = document.getElementById('callNotifyClose'); if(notifyClose) notifyClose.addEventListener('click', ()=> closeModal('callNotifyPopup'));

  // Ensure comment form visible for debugging / when auth not ready
  const formEl = document.getElementById('form');
  if(formEl) formEl.style.display = 'flex';

  setupGlobal();
});

// Setup listeners early
function setupGlobal(){
  arrivalsRef.on('child_added', snap => { const d = snap.val(); if(d && d.type === 'arrival') showArrivalBanner(d.name); snap.ref.remove().catch(()=>{}); });
  ensurePollListener();
  initComments();
  const uf = document.getElementById('uploadForm'); if(uf) uf.addEventListener('submit', handleUploadForm);
}

// Arrival banner
function showArrivalBanner(name){
  const banner = document.getElementById('arrivalBanner'); if(!banner) return;
  banner.textContent = `${escapeHtml(name || 'ゲスト')}さんが配信を視聴しに来ました`;
  banner.style.display = 'block'; banner.classList.add('show');
  if(banner._hideTimer) clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(()=>{ banner.classList.remove('show'); setTimeout(()=>{ if(!banner.classList.contains('show')) banner.style.display='none'; },300); }, ARRIVAL_BANNER_DURATION);
}

// Auth + presence (show/hide auth buttons; form always visible)
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

function signUp(){ const email=document.getElementById('email').value.trim(); const password=document.getElementById('password').value; if(!email||!password) return alert('メールとパスワードを入力してください'); auth.createUserWithEmailAndPassword(email,password).then(()=>{ alert('登録成功'); closeModal('loginModal'); }).catch(err=>alert(err.message)); }
function signIn(){ const email=document.getElementById('email').value.trim(); const password=document.getElementById('password').value; if(!email||!password) return alert('メールとパスワードを入力してください'); auth.signInWithEmailAndPassword(email,password).then(()=>{ alert('ログイン成功'); closeModal('loginModal'); }).catch(err=>alert(err.message)); }
function signOut(){ auth.signOut().then(()=>{ alert('ログアウトしました'); }).catch(err=>alert(err.message)); }
function updateProfile(){ const user=auth.currentUser; const newName=document.getElementById('newName').value.trim(); if(!user) return alert('ログインしてください'); if(!newName) return alert('名前を入力してください'); user.updateProfile({ displayName:newName }).then(()=>{ alert('ユーザー名を更新しました'); const ue=document.getElementById('username'); if(ue) ue.textContent=newName; closeModal('mypageModal'); }).catch(err=>alert('更新失敗：'+err.message)); }

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

// Comments + call UI wiring
function initComments(){
  commentsRef.once('value', snap => {
    let earliest = null;
    snap.forEach(child => { const d = child.val(); if(d && d.timestamp && (!earliest || d.timestamp < earliest)) earliest = d.timestamp; });
    firstCommentTime = earliest || Date.now();
    commentsRef.on('child_added', cs => {
      const d = cs.val(); if(!d || !d.timestamp) return; if(d.timestamp - firstCommentTime > THREE_HOURS) return;
      prependCommentWithPushAnimation(d);
    });
  }, err => { console.warn('comments.once error', err); });
}
function prependCommentWithPushAnimation(d){
  const commentsEl = document.getElementById('comments'); if(!commentsEl) return;
  const existing = Array.from(commentsEl.children); existing.forEach(el => el.classList.add('_prep-shift'));
  commentsEl.offsetHeight;
  const div = document.createElement('div'); div.className = 'comment new';
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
  if(commentsEl.firstChild) commentsEl.insertBefore(div, commentsEl.firstChild); else commentsEl.appendChild(div);

  const avatar = div.querySelector('img');
  const callBtn = div.querySelector('.call-badge');
  if(avatar) avatar.addEventListener('click', onUserIconClick);
  if(callBtn) callBtn.addEventListener('click', onUserIconClick);

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

  requestAnimationFrame(()=>{ div.classList.remove('new'); existing.forEach(el => el.classList.remove('_prep-shift')); });
  setTimeout(()=>{ div.classList.remove('new'); existing.forEach(el => el.classList.remove('_prep-shift')); },600);
}
function sendComment(){ const user = auth.currentUser; const text = document.getElementById('commentInput').value.trim(); if(!user) return alert('ログインしてください'); if(!text) return; commentsRef.push({ uid:user.uid, name:user.displayName||user.email, photo:user.photoURL||'', text, timestamp: Date.now() }).then(()=> document.getElementById('commentInput').value = '').catch(err=>alert('保存失敗：' + err.message)); }

// Caller flow: open popup for selected uid
let _callPopupTargetUid = null;
function onUserIconClick(e){
  const uid = e.currentTarget.dataset.uid || e.currentTarget.getAttribute('data-uid');
  if(!uid) return alert('そのユーザーは通話できません');
  _callPopupTargetUid = uid;
  const content = document.getElementById('callRequestContent');
  content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`;
  openModal('callRequestPopup');
}

// Send call request: create /calls/{callId} and wait
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

// Caller waiting UI + listener
function showCallerWaiting(callId, toUid){
  const notifyContent = document.getElementById('callNotifyContent');
  if(!notifyContent) return;
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
    if(v.state === 'pending') {
      if(stateEl) stateEl.textContent = '応答待ち...';
    } else if(v.state === 'accepted') {
      if(stateEl) stateEl.textContent = '相手が応答しました。通話を開始してください。';
      callNode.off('value', listener);
      currentOutgoingCallId = null;
    } else if(v.state === 'rejected') {
      if(stateEl) stateEl.textContent = '通話は拒否されました';
      callNode.off('value', listener);
      currentOutgoingCallId = null;
    } else if(v.state === 'canceled') {
      if(stateEl) stateEl.textContent = 'リクエストはキャンセルされました';
      callNode.off('value', listener);
      currentOutgoingCallId = null;
    }
  });
}

// Incoming call listener for callee
let incomingCallsListener = null;
function listenIncomingCalls(myUid){
  if(!myUid) return;
  incomingCallsListener = callsRef.orderByChild('to').equalTo(myUid).on('child_added', snap => {
    const call = snap.val(); const callId = snap.key;
    if(!call) return;
    if(call.state !== 'pending') return;
    presenceRefRoot.child(call.from).once('value').then(psnap => {
      const p = psnap.val();
      const online = !!p && !!p.online;
      if(!online) return;
      showIncomingCallPopup(callId, call.from);
    }).catch(()=>{});
  });
  callsRef.on('child_changed', snap => {
    const call = snap.val(); if(!call || !auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    if(call.to === myUid && call.state !== 'pending'){
      if(document.getElementById('incomingCallPopup').classList.contains('open')) closeModal('incomingCallPopup');
    }
  });
}
function stopListeningIncomingCalls(){
  if(incomingCallsListener) { callsRef.off('child_added', incomingCallsListener); incomingCallsListener = null; }
  callsRef.off('child_changed');
}

// Show incoming popup to callee + listen single call node
let _currentIncomingCallId = null;
function showIncomingCallPopup(callId, fromUid){
  _currentIncomingCallId = callId;
  const content = document.getElementById('incomingCallContent');
  if(!content) return;
  content.innerHTML = `<div><strong>${escapeHtml(fromUid)}</strong> から通話のリクエストがあります</div>`;
  openModal('incomingCallPopup');

  if(currentIncomingCallListener) callsRef.child(_currentIncomingCallId).off('value', currentIncomingCallListener);
  currentIncomingCallListener = callsRef.child(callId).on('value', snap => {
    const v = snap.val();
    if(!v){
      closeModal('incomingCallPopup'); callsRef.child(callId).off('value', currentIncomingCallListener); currentIncomingCallListener = null; _currentIncomingCallId = null;
      return;
    }
    if(v.state !== 'pending'){
      closeModal('incomingCallPopup'); callsRef.child(callId).off('value', currentIncomingCallListener); currentIncomingCallListener = null; _currentIncomingCallId = null;
    }
  });
}

// Callee responds accepted/rejected
function respondToIncomingCall(result){
  if(!_currentIncomingCallId) return closeModal('incomingCallPopup');
  const callId = _currentIncomingCallId;
  if(result === 'accepted'){
    callsRef.child(callId).update({ state: 'accepted', ts: Date.now() }).then(()=>{
      closeModal('incomingCallPopup');
      if(currentIncomingCallListener) callsRef.child(callId).off('value', currentIncomingCallListener);
      currentIncomingCallListener = null; _currentIncomingCallId = null;
    }).catch(()=>{});
  } else if(result === 'rejected'){
    callsRef.child(callId).update({ state: 'rejected', ts: Date.now() }).then(()=>{
      closeModal('incomingCallPopup');
      if(currentIncomingCallListener) callsRef.child(callId).off('value', currentIncomingCallListener);
      currentIncomingCallListener = null; _currentIncomingCallId = null;
    }).catch(()=>{});
  }
}

// Caller receives rejected/accepted notifications (global listener)
callsRef.on('child_changed', snap => {
  const v = snap.val(); const id = snap.key;
  if(!v || !auth.currentUser) return;
  const myUid = auth.currentUser.uid;
  if(v.from === myUid){
    if(v.state === 'rejected'){
      const el = document.getElementById('callNotifyContent'); if(el) el.innerHTML = `<div>通話は拒否されました</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null;
    } else if(v.state === 'accepted'){
      const el = document.getElementById('callNotifyContent'); if(el) el.innerHTML = `<div>相手が応答しました。通話を開始してください。</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null;
    } else if(v.state === 'canceled'){
      const el = document.getElementById('callNotifyContent'); if(el) el.innerHTML = `<div>リクエストはキャンセルされました</div>`; openModal('callNotifyPopup'); currentOutgoingCallId = null;
    }
  }
});

// Polls: ensure listener registered at startup (simple)
let localPollListenerSet = false;
function ensurePollListener(){
  if(localPollListenerSet) return;
  pollsRef.child('active').on('value', snap => {
    const data = snap.val();
    if(!data || data.active !== true){
      hidePollUI(); localActivePoll = null; return;
    }
    localActivePoll = data;
    renderPollState(localActivePoll);
    if(localActivePoll.state === 'voting' && Date.now() >= localActivePoll.endsAt){
      if(typeof attemptImmediateFinalize === 'function') attemptImmediateFinalize();
    }
  }, err => { console.warn('poll listener error', err); });
  localPollListenerSet = true;
}

// Minimal poll render (replace with richer UI if needed)
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
    const total = (poll.options||[]).reduce((s,x)=>s + (x.count||0),0);
    const pct = total === 0 ? 0 : Math.round(((o.count||0)/total)*100);
    optEl.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`;
    if(poll.state === 'voting'){
      optEl.addEventListener('click', ()=> voteOption(o.id));
    } else {
      optEl.classList.add('disabled');
    }
    optionsWrap.appendChild(optEl);
  });
  pollContent.appendChild(optionsWrap);
}
function hidePollUI(){ const pollArea = document.getElementById('pollArea'); if(!pollArea) return; pollArea.style.display='none'; const pc = document.getElementById('pollContent'); if(pc) pc.innerHTML=''; }

// Vote (simple)
function voteOption(optId){
  const user = auth.currentUser; if(!user) return alert('ログインしてください'); if(!localActivePoll) return;
  if(localActivePoll.state !== 'voting') return;
  const uid = user.uid;
  pollsRef.child('active').child('votes').child(uid).set({ opt: optId, at: Date.now(), name: user.displayName || user.email })
    .then(()=> { myVoteOpt = optId; document.querySelectorAll('.poll-option').forEach(el=> el.classList.toggle('selected', el.dataset.optId === optId)); })
    .catch(err=> console.warn('vote failed', err));
}

// Upload handler (uses GAS_URL)
function handleUploadForm(e){
  e && e.preventDefault();
  const file = document.getElementById('imageFile').files[0];
  if(!file) return alert('画像を選択してください');
  const fd = new FormData(); fd.append('file', file);
  fetch(https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec, { method: 'POST', body: fd })
    .then(r => r.text())
    .then(url => {
      const user = auth.currentUser;
      if(!user) return alert('ログインしてください');
      user.updateProfile({ photoURL: url }).then(()=> {
        const avatar = document.getElementById('avatar'); if(avatar) avatar.src = url;
        closeModal('mypageModal');
      }).catch(err=>alert('更新失敗：' + err.message));
    }).catch(err=>alert('アップロード失敗：' + err.message));
}
