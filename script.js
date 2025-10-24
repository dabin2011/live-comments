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

// Apps Script Web アプリ URL (画像アップロード)
const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

// Constants
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const POLL_AFTER_FINISH_DISPLAY_MS = 30 * 1000; // ← 終了後に表示する時間（30秒）
const ARRIVAL_BANNER_DURATION = 5000;
const CALL_REQUEST_TIMEOUT_MS = 20 * 1000;

// Local state
let firstCommentTime = null;
let _prevAuthUser = null;
let localActivePoll = null;
let myPresenceRef = null;
let currentIncomingCallListener = null;
let currentOutgoingCallId = null;
const _pollTimers = new Map(); // timer management
let _pollRemovalTimeout = null; // 終了後の自動削除タイマー

// Utility
function escapeHtml(s){ if(s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function now(){ return Date.now(); }
function el(id){ return document.getElementById(id); }

// DOM & initialization
document.addEventListener('DOMContentLoaded', () => {
  // modal helpers
  window.openModal = function(id){
    const m = el(id); if(!m) return console.warn('openModal: not found', id); m.classList.add('open'); m.setAttribute('aria-hidden','false');
  };
  window.closeModal = function(id){
    const m = el(id); if(!m) return; m.classList.remove('open'); m.setAttribute('aria-hidden','true');
  };
  document.querySelectorAll('.modal .close').forEach(btn=> btn.addEventListener('click', () => { const id = btn.getAttribute('data-close') || btn.closest('.modal')?.id; if(id) closeModal(id); }));

  // modal background click to close
  document.querySelectorAll('.modal').forEach(modal=>{
    modal.addEventListener('click', e => { if(e.target === modal) closeModal(modal.id); });
  });

  // buttons wiring
  const sendBtn = el('sendBtn'); if(sendBtn) sendBtn.addEventListener('click', sendComment);
  const pollBtn = el('pollBtn'); if(pollBtn) pollBtn.addEventListener('click', ()=> openModal('pollModal'));
  const addPollOptionBtn = el('addPollOptionBtn'); if(addPollOptionBtn) addPollOptionBtn.addEventListener('click', addPollOption);
  const createPollBtn = el('createPollBtn'); if(createPollBtn) createPollBtn.addEventListener('click', createPollFromModal);

  // login/signup/update handlers
  const signupBtn = el('signupBtn'), signinBtn = el('signinBtn'), logoutBtn = el('logoutBtn'), updateNameBtn = el('updateNameBtn');
  if(signupBtn) signupBtn.addEventListener('click', signUp);
  if(signinBtn) signinBtn.addEventListener('click', signIn);
  if(logoutBtn) logoutBtn.addEventListener('click', async () => {
    try {
      await auth.signOut();
    } catch(err){
      console.error('signOut error', err);
      alert('ログアウトに失敗しました: ' + (err && err.message ? err.message : err));
    }
  });
  if(updateNameBtn) updateNameBtn.addEventListener('click', updateProfile);

  const callCancelBtn = el('callCancelBtn'); if(callCancelBtn) callCancelBtn.addEventListener('click', ()=> closeModal('callRequestPopup'));
  const callSendBtn = el('callSendBtn'); if(callSendBtn) callSendBtn.addEventListener('click', sendCallRequestFromPopup);
  const rejectCallBtn = el('rejectCallBtn'); if(rejectCallBtn) rejectCallBtn.addEventListener('click', ()=> respondToIncomingCall('rejected'));
  const acceptCallBtn = el('acceptCallBtn'); if(acceptCallBtn) acceptCallBtn.addEventListener('click', ()=> respondToIncomingCall('accepted'));
  const callNotifyClose = el('callNotifyClose'); if(callNotifyClose) callNotifyClose.addEventListener('click', ()=> closeModal('callNotifyPopup'));

  // upload form
  const uf = el('uploadForm'); if(uf) uf.addEventListener('submit', handleUploadForm);

  // delegate clicks inside comments (dynamic)
  const commentsEl = el('comments');
  if(commentsEl){
    commentsEl.addEventListener('click', ev => {
      const badge = ev.target.closest('.call-badge');
      if(badge){ const uid = badge.getAttribute('data-uid'); if(uid) openCallRequestPopup(uid); }
      const img = ev.target.closest('img[data-uid]');
      if(img){ const uid = img.getAttribute('data-uid'); if(uid) openCallRequestPopup(uid); }
    });
  }

  // ensure form visible
  const form = el('form'); if(form) form.style.display = 'flex';

  // DB listeners
  arrivalsRef.on('child_added', snap => { const d = snap.val(); if(d && d.type === 'arrival') showArrivalBanner(d.name || 'ゲスト'); snap.ref.remove().catch(()=>{}); });
  ensurePollListener();
  initComments();
});

// Arrival banner
function showArrivalBanner(name){
  const b = el('arrivalBanner'); if(!b) return;
  b.textContent = `${escapeHtml(name)}さんが配信を視聴しに来ました`;
  b.style.display = 'block';
  if(b._hideTimer) clearTimeout(b._hideTimer);
  b._hideTimer = setTimeout(()=> { b.style.display = 'none'; }, ARRIVAL_BANNER_DURATION);
}

// Auth & presence
auth.onAuthStateChanged(user => {
  const loginBtn = el('loginBtn'), mypageBtn = el('mypageBtn'), logoutBtn = el('logoutBtn'), usernameEl = el('username'), avatarEl = el('avatar');
  if(user){
    if(loginBtn) loginBtn.style.display = 'none';
    if(mypageBtn) mypageBtn.style.display = 'inline-block';
    if(logoutBtn) logoutBtn.style.display = 'inline-block';
    const name = user.displayName || user.email || 'ユーザー';
    if(usernameEl) usernameEl.textContent = name;
    if(avatarEl && user.photoURL) avatarEl.src = user.photoURL;
    arrivalsRef.push({ type:'arrival', name, timestamp: now() }).catch(()=>{});
    attachPresence(user.uid);
    listenIncomingCalls(user.uid);
  } else {
    if(loginBtn) loginBtn.style.display = 'inline-block';
    if(mypageBtn) mypageBtn.style.display = 'none';
    if(logoutBtn) logoutBtn.style.display = 'none';
    if(usernameEl) usernameEl.textContent = '';
    if(avatarEl) avatarEl.src = '';
    detachPresence();
    stopListeningIncomingCalls();
  }
  _prevAuthUser = user;
});

async function signUp(){
  const email = el('email')?.value?.trim(); const password = el('password')?.value || '';
  if(!email || !password) return alert('メールとパスワードを入力してください');
  try { await auth.createUserWithEmailAndPassword(email, password); alert('登録しました'); closeModal('loginModal'); } catch(e){ console.error(e); alert('登録失敗: ' + e.message); }
}
async function signIn(){
  const email = el('email')?.value?.trim(); const password = el('password')?.value || '';
  if(!email || !password) return alert('メールとパスワードを入力してください');
  try { await auth.signInWithEmailAndPassword(email, password); alert('ログインしました'); closeModal('loginModal'); } catch(e){ console.error(e); alert('ログイン失敗: ' + e.message); }
}
async function updateProfile(){
  const user = auth.currentUser;
  if(!user) return alert('ログインしてください');
  const newName = el('newName')?.value?.trim();
  if(!newName) return alert('ユーザー名を入力してください');
  try {
    await user.updateProfile({ displayName: newName });
    const usernameEl = el('username'); if(usernameEl) usernameEl.textContent = newName;
    alert('ユーザー名を更新しました');
    closeModal('mypageModal');
  } catch(err){
    console.error('updateProfile error', err);
    alert('ユーザー名の更新に失敗しました: ' + (err && err.message ? err.message : err));
  }
}

function attachPresence(uid){
  if(!uid) return;
  myPresenceRef = presenceRefRoot.child(uid);
  myPresenceRef.set({ online:true, lastSeen: now() }).catch(()=>{});
  try{ myPresenceRef.onDisconnect().set({ online:false, lastSeen: now() }).catch(()=>{}); }catch(e){}
}
function detachPresence(){
  if(myPresenceRef){ myPresenceRef.set({ online:false, lastSeen: now() }).catch(()=>{}); try{ myPresenceRef.onDisconnect().cancel(); }catch(e){} myPresenceRef = null; }
}

// Comments
function initComments(){
  commentsRef.orderByChild('ts').limitToFirst(1).once('value').then(snap => {
    let earliest = null;
    snap.forEach(child => { const d = child.val(); if(d && d.ts) earliest = d.ts; });
    firstCommentTime = earliest || now();
  }).catch(()=>{ firstCommentTime = now(); });

  commentsRef.orderByChild('ts').limitToLast(500).on('child_added', snap => {
    const d = snap.val(); if(!d) return;
    if(d.ts && (d.ts - (firstCommentTime || now()) > THREE_HOURS)) return;
    renderComment(d);
  }, err => console.warn('comments on error', err));
}

function renderComment(d){
  const commentsEl = el('comments'); if(!commentsEl) return;
  const div = document.createElement('div'); div.className = 'comment';
  const avatarUrl = d.photo || 'https://via.placeholder.com/40';
  const name = d.name || '匿名';
  const time = d.ts ? new Date(d.ts).toLocaleTimeString() : '';
  // avatar with presence wrapper
  const avatarWrap = document.createElement('div'); avatarWrap.className = 'avatarWrap';
  avatarWrap.style.marginRight = '10px';
  const img = document.createElement('img'); img.className = 'avatar'; img.src = avatarUrl; img.width = 40; img.height = 40; img.style.borderRadius = '50%'; img.setAttribute('data-uid', d.uid || '');
  avatarWrap.appendChild(img);
  // presence dot (default offline)
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

  // presence listener for this user's uid
  const uid = d.uid;
  if(uid){
    presenceRefRoot.child(uid).on('value', snap => {
      const v = snap.val();
      const dot = document.getElementById(`presenceDot-${uid}`);
      if(dot){
        dot.classList.toggle('presence-online', !!v && !!v.online);
        dot.classList.toggle('presence-offline', !v || !v.online);
      }
    });
  }
}

function sendComment(){
  const input = el('commentInput'); if(!input) return alert('入力欄が見つかりません');
  const text = input.value.trim(); if(!text) return alert('コメントを入力してください');
  const user = auth.currentUser;
  if(!user) return alert('コメントにはログインが必要です');
  const payload = { uid: user.uid, name: user.displayName || user.email || 'ユーザー', photo: user.photoURL || '', text, ts: now() };
  commentsRef.push(payload).then(()=> { input.value = ''; }).catch(err => { console.error('コメント保存エラー', err); alert('送信失敗'); });
}

// Polls
function addPollOption(){
  const wrap = el('pollOptionsWrapper'); if(!wrap) return;
  const input = document.createElement('input'); input.type='text'; input.className='pollOptionInput'; input.placeholder='選択肢';
  wrap.appendChild(input);
}

function createPollFromModal(){
  const q = el('pollQuestion'); if(!q) return alert('質問を入力してください');
  const options = Array.from(document.querySelectorAll('.pollOptionInput')).map(i=>i.value.trim()).filter(v=>v);
  if(!options.length) return alert('選択肢を1つ以上入力してください');
  const dur = POLL_DURATION_MS;
  const poll = {
    active: true,
    question: q.value.trim(),
    options: options.map((label, idx) => ({ id: 'o' + idx + '_' + now(), label, count: 0 })),
    state: 'voting',
    startedAt: now(),
    endsAt: now() + dur,
    votes: {}
  };
  pollsRef.child('active').set(poll).then(()=> { closeModal('pollModal'); }).catch(err => { console.error('createPoll error', err); alert('アンケート作成失敗'); });
}

function ensurePollListener(){
  pollsRef.child('active').on('value', snap => {
    const data = snap.val();
    if(!data || data.active !== true){ hidePollUI(); localActivePoll = null; return; }
    localActivePoll = data;
    renderPollState(data);
    if(data.state === 'finished'){
      // 終了になったら 30 秒後に active ノードを削除して UI を隠す（安全に一度だけ）
      if(_pollRemovalTimeout) { clearTimeout(_pollRemovalTimeout); _pollRemovalTimeout = null; }
      _pollRemovalTimeout = setTimeout(async () => {
        try {
          // active がまだ存在し、かつ finished のままであれば削除
          const snapCheck = await pollsRef.child('active').once('value');
          const cur = snapCheck.val();
          if(cur && cur.state === 'finished') {
            await pollsRef.child('active').remove();
          }
        } catch(err) {
          console.error('poll removal error', err);
        } finally {
          hidePollUI();
          if(_pollTimers.has('active')){ clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
          _pollRemovalTimeout = null;
        }
      }, POLL_AFTER_FINISH_DISPLAY_MS);
    }
    // safety: if voting expired, try finalize
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
  header.appendChild(q); pollContent.appendChild(header);
  const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options';
  const total = (poll.options||[]).reduce((s,o)=>s + (o.count||0), 0) || 0;
  (poll.options||[]).forEach(o => {
    const opt = document.createElement('div'); opt.className = 'poll-option'; opt.dataset.optId = o.id;
    const pct = total === 0 ? 0 : Math.round(((o.count||0)/total)*100);
    opt.innerHTML = `<div>${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`;
    if(poll.state === 'voting'){ opt.addEventListener('click', ()=> voteOption(o.id)); } else opt.style.opacity = '0.7';
    optionsWrap.appendChild(opt);
  });
  pollContent.appendChild(optionsWrap);

  // timer management (global)
  if(pollTimer){
    if(_pollTimers.has('active')){ clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
    if(poll.state === 'voting'){
      const updateFn = () => {
        const remainingMs = Math.max(0, (poll.endsAt || 0) - now());
        if(remainingMs <= 0){
          if(pollTimer) pollTimer.textContent = '集計中...';
          finalizePoll().catch(err=>console.error('finalizePoll error', err));
          if(_pollTimers.has('active')){ clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
          return;
        }
        if(pollTimer) pollTimer.textContent = `残り ${Math.ceil(remainingMs/1000)} 秒`;
      };
      updateFn();
      const t = setInterval(updateFn, 500);
      _pollTimers.set('active', t);
    } else {
      pollTimer.textContent = '投票終了';
    }
  }
}

function hidePollUI(){ const pa = el('pollArea'); if(pa) pa.style.display='none'; const pc = el('pollContent'); if(pc) pc.innerHTML=''; }

function voteOption(optId){
  const user = auth.currentUser; if(!user) return alert('投票にはログインが必要です');
  const uid = user.uid;
  const activeRef = pollsRef.child('active');
  activeRef.transaction(current => {
    if(!current) return current;
    if(current.state !== 'voting') return current;
    const prev = current.votes && current.votes[uid] && current.votes[uid].opt;
    if(prev){
      const idxPrev = (current.options||[]).findIndex(o=>o.id===prev);
      if(idxPrev >= 0) current.options[idxPrev].count = Math.max(0,(current.options[idxPrev].count||0)-1);
    }
    const idx = (current.options||[]).findIndex(o=>o.id===optId);
    if(idx >= 0) current.options[idx].count = (current.options[idx].count||0) + 1;
    if(!current.votes) current.votes = {};
    current.votes[uid] = { opt: optId, at: now(), name: user.displayName || user.email || 'ユーザー' };
    return current;
  }, (err, committed, snapshot) => { if(err) console.error('vote txn error', err); });
}

async function finalizePoll(){
  const activeRef = pollsRef.child('active');
  try {
    const snap = await activeRef.once('value');
    const poll = snap.val(); if(!poll) return;
    if(poll.state === 'finished') return;
    // mark finished (clients will show finished state)
    await activeRef.update({ state: 'finished', finishedAt: now() });
    // push to history (store snapshot)
    await pollsRef.child('history').push(poll).catch(()=>{});
    // keep UI visible: pollsRef listener will schedule removal after POLL_AFTER_FINISH_DISPLAY_MS
    if(_pollTimers.has('active')){ clearInterval(_pollTimers.get('active')); _pollTimers.delete('active'); }
  } catch(err){
    console.error('finalizePoll error', err);
  }
}

// Calls (minimal) - unchanged
function openCallRequestPopup(uid){
  const content = el('callRequestContent'); if(content) content.innerHTML = `<div>ユーザー <strong>${escapeHtml(uid)}</strong> に通話リクエストを送りますか？</div>`;
  window._callTargetUid = uid; openModal('callRequestPopup');
}
function sendCallRequestFromPopup(){
  if(!auth.currentUser) return alert('ログインしてください');
  const toUid = window._callTargetUid; if(!toUid) return alert('ターゲット不明');
  const callId = callsRef.push().key;
  const callObj = { from: auth.currentUser.uid, to: toUid, state: 'pending', ts: now() };
  callsRef.child(callId).set(callObj).then(()=> { currentOutgoingCallId = callId; closeModal('callRequestPopup'); showCallerWaiting(callId, toUid); setTimeout(()=> { callsRef.child(callId).once('value').then(s=>{ const v=s.val(); if(v && v.state==='pending') callsRef.child(callId).update({ state:'canceled', ts: now() }); }); }, CALL_REQUEST_TIMEOUT_MS); }).catch(err=>{ console.error('call send error', err); alert('送信失敗'); });
}
function showCallerWaiting(callId, toUid){
  const c = el('callNotifyContent'); if(!c) return; c.innerHTML = `<div>通話リクエスト送信中: ${escapeHtml(toUid)}</div><div id="callWaitingState"></div>`; openModal('callNotifyPopup');
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

// Upload handler (uses GAS_URL)
function handleUploadForm(e){
  e && e.preventDefault();
  const file = el('imageFile')?.files?.[0];
  if(!file) return alert('画像を選択してください');
  const fd = new FormData(); fd.append('file', file);
  fetch(GAS_URL, { method: 'POST', body: fd }).then(r => r.text()).then(url => {
    const user = auth.currentUser; if(!user) return alert('ログインしてください');
    user.updateProfile({ photoURL: url }).then(()=> { const avatar = el('avatar'); if(avatar) avatar.src = url; closeModal('mypageModal'); }).catch(err=>alert('更新失敗：' + err.message));
  }).catch(err=>alert('アップロード失敗：' + err.message));
}

// debug
window.checkDebug = function(){ console.log('firebase loaded?', typeof firebase !== 'undefined'); console.log('auth.currentUser', auth.currentUser); };
