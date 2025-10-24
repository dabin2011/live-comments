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
firebase.initializeApp(firebaseConfig);

// Refs
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref("comments");
const pollsRef = db.ref("polls");
const arrivalsRef = db.ref("arrivals");

// Constants
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;

let firstCommentTime = null;
let _prevAuthUser = null;
let localActivePoll = null;
let localPollListenerSet = false;
let finalized = false;
let myVoteOpt = null;

// Utility
function escapeHtml(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function formatTimeOnly(ts){ const d=new Date(ts); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

// Modal: robust open/close (attach after DOM ready)
document.addEventListener('DOMContentLoaded', () => {
  window.openModal = function(id){
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    const focusable = el.querySelector('input,button,select,textarea,[tabindex]');
    if(focusable) focusable.focus();
  };
  window.closeModal = function(id){
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden','true');
  };
  document.querySelectorAll('.modal .close').forEach(btn=>{
    btn.addEventListener('click', () => { const id = btn.getAttribute('data-close') || btn.closest('.modal')?.id; if(id) closeModal(id); });
  });
  document.querySelectorAll('.modal').forEach(modal=>{
    modal.addEventListener('click', e => { if(e.target === modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); } });
  });

  setupGlobal();
});

// Startup listeners and UI setup
function setupGlobal(){
  arrivalsRef.on('child_added', snap => {
    const d = snap.val(); if(d && d.type === 'arrival') showArrivalBanner(d.name);
    snap.ref.remove().catch(()=>{});
  });

  ensurePollListener();
  initComments();

  const uf = document.getElementById('uploadForm');
  if(uf) uf.addEventListener('submit', handleUploadForm);
}

// Arrival banner
function showArrivalBanner(name){
  const banner = document.getElementById('arrivalBanner'); if(!banner) return;
  banner.textContent = `${escapeHtml(name || 'ゲスト')}さんが配信を視聴しに来ました`;
  banner.style.display = 'block';
  banner.classList.add('show');
  if(banner._hideTimer) clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(()=>{ banner.classList.remove('show'); setTimeout(()=>{ if(!banner.classList.contains('show')) banner.style.display='none'; },300); }, ARRIVAL_BANNER_DURATION);
}

// Auth
auth.onAuthStateChanged(user => {
  const form = document.getElementById('form');
  const loginBtn = document.getElementById('loginBtn');
  const mypageBtn = document.getElementById('mypageBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if(user){
    if(form) form.style.display = 'flex';
    if(loginBtn) loginBtn.style.display = 'none';
    if(mypageBtn) mypageBtn.style.display = 'inline-block';
    if(logoutBtn) logoutBtn.style.display = 'inline-block';
    const uname = user.displayName || user.email || '';
    document.getElementById('username').textContent = uname;
    document.getElementById('avatar').src = user.photoURL || '';
    if(!_prevAuthUser){
      arrivalsRef.push({ type: 'arrival', name: uname || 'ゲスト', timestamp: Date.now() }).catch(()=>{});
      showArrivalBanner(uname);
    }
  } else {
    if(form) form.style.display = 'none';
    if(loginBtn) loginBtn.style.display = 'inline-block';
    if(mypageBtn) mypageBtn.style.display = 'none';
    if(logoutBtn) logoutBtn.style.display = 'none';
    document.getElementById('avatar').src = '';
    document.getElementById('username').textContent = '';
  }
  _prevAuthUser = user;
});

function signUp(){ const email = document.getElementById('email').value.trim(); const password = document.getElementById('password').value; if(!email||!password) return alert('メールとパスワードを入力してください'); auth.createUserWithEmailAndPassword(email,password).then(()=>{ alert('登録成功'); closeModal('loginModal'); }).catch(err=>alert(err.message)); }
function signIn(){ const email = document.getElementById('email').value.trim(); const password = document.getElementById('password').value; if(!email||!password) return alert('メールとパスワードを入力してください'); auth.signInWithEmailAndPassword(email,password).then(()=>{ alert('ログイン成功'); closeModal('loginModal'); }).catch(err=>alert(err.message)); }
function signOut(){ auth.signOut().then(()=>{ alert('ログアウトしました'); }).catch(err=>alert(err.message)); }
function updateProfile(){ const user = auth.currentUser; const newName = document.getElementById('newName').value.trim(); if(!user) return alert('ログインしてください'); if(!newName) return alert('名前を入力してください'); user.updateProfile({ displayName: newName }).then(()=>{ alert('ユーザー名を更新しました'); document.getElementById('username').textContent = newName; closeModal('mypageModal'); }).catch(err=>alert('更新失敗：' + err.message)); }

// Comments
function initComments(){
  commentsRef.once('value', snap => {
    let earliest = null;
    snap.forEach(child => { const d = child.val(); if(d && d.timestamp && (!earliest || d.timestamp < earliest)) earliest = d.timestamp; });
    firstCommentTime = earliest || Date.now();
    commentsRef.on('child_added', cs => {
      const d = cs.val(); if(!d || !d.timestamp) return; if(d.timestamp - firstCommentTime > THREE_HOURS) return;
      prependCommentWithPushAnimation(d);
    });
  });
}
function prependCommentWithPushAnimation(d){
  const commentsEl = document.getElementById('comments'); if(!commentsEl) return;
  const existing = Array.from(commentsEl.children);
  existing.forEach(el => el.classList.add('_prep-shift'));
  commentsEl.offsetHeight;
  const div = document.createElement('div'); div.className = 'comment new';
  const avatarUrl = d.photo || 'https://via.placeholder.com/40';
  div.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="avatar"><div class="meta"><div><strong>${escapeHtml(d.name)}</strong></div><div>${escapeHtml(d.text)}</div></div><div style="margin-left:auto"><small>${formatTimeOnly(d.timestamp)}</small></div>`;
  if(commentsEl.firstChild) commentsEl.insertBefore(div, commentsEl.firstChild); else commentsEl.appendChild(div);
  requestAnimationFrame(()=>{ div.classList.remove('new'); existing.forEach(el=>el.classList.remove('_prep-shift')); });
  setTimeout(()=>{ div.classList.remove('new'); existing.forEach(el=>el.classList.remove('_prep-shift')); },600);
}
function sendComment(){ const user = auth.currentUser; const text = document.getElementById('commentInput').value.trim(); if(!user) return alert('ログインしてください'); if(!text) return; commentsRef.push({ uid:user.uid, name:user.displayName||user.email, photo:user.photoURL||'', text, timestamp: Date.now() }).then(()=> document.getElementById('commentInput').value = '').catch(err=>alert('保存失敗：' + err.message)); }

// Polls: ensure listener registered at startup so all updates propagate immediately
function ensurePollListener(){
  if(localPollListenerSet) return;
  pollsRef.child('active').on('value', snap => {
    const data = snap.val();
    if(!data || data.active !== true){
      hidePollUI();
      localActivePoll = null;
      finalized = false;
      return;
    }
    localActivePoll = data;
    renderPollState(localActivePoll);
    if(localActivePoll.state === 'voting' && Date.now() > localActivePoll.endsAt){
      finalizePollIfNeeded();
    }
  }, err => { console.warn('poll listener error', err); });
  localPollListenerSet = true;
}

// Render poll UI according to state; always respond to DB changes
function renderPollState(poll){
  const pollArea = document.getElementById('pollArea'); const pollContent = document.getElementById('pollContent');
  if(!pollArea || !pollContent) return;
  pollArea.style.display = 'block'; pollArea.classList.remove('hidden');
  pollContent.innerHTML = '';

  const header = document.createElement('div'); header.className = 'poll-header';
  const qEl = document.createElement('div'); qEl.className = 'poll-question'; qEl.textContent = poll.question;
  const rightWrap = document.createElement('div'); rightWrap.style.display='flex'; rightWrap.style.alignItems='center'; rightWrap.style.gap='8px';
  const statusEl = document.createElement('div'); statusEl.className = 'poll-status';
  const remEl = document.createElement('div'); remEl.id = 'pollRemainingRight'; remEl.className = 'poll-remaining';
  rightWrap.appendChild(statusEl); rightWrap.appendChild(remEl);
  header.appendChild(qEl); header.appendChild(rightWrap);
  pollContent.appendChild(header);

  let overlay = pollContent.querySelector('.poll-overlay');
  if(!overlay){
    overlay = document.createElement('div'); overlay.className = 'poll-overlay'; overlay.textContent = '集計中';
  }

  const optionsWrap = document.createElement('div'); optionsWrap.className = 'poll-options';
  const total = (poll.options||[]).reduce((s,o)=>s + (o.count||0), 0);
  (poll.options||[]).forEach(o => {
    const pct = total === 0 ? 0 : Math.round(((o.count||0)/total)*100);
    const optEl = document.createElement('div'); optEl.className = 'poll-option'; optEl.dataset.optId = o.id;
    optEl.innerHTML = `<div class="label">${escapeHtml(o.label)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="percent">${pct}%</div>`;
    if(poll.state === 'voting'){
      optEl.addEventListener('click', ()=> voteOption(o.id));
      const uid = auth.currentUser ? auth.currentUser.uid : null;
      if(uid){
        pollsRef.child('active').child('votes').child(uid).once('value').then(snap=>{ const v=snap.val(); if(v && v.opt) markSelectedOption(v.opt); }).catch(()=>{});
      }
    } else {
      optEl.classList.add('disabled');
      if(myVoteOpt === o.id) optEl.classList.add('selected');
    }
    optionsWrap.appendChild(optEl);
  });
  pollContent.appendChild(optionsWrap);

  clearPollTimers(poll);
  if(poll.state === 'counting'){
    if(!pollContent.querySelector('.poll-overlay')) pollContent.appendChild(overlay);
    overlay.classList.add('pulse'); overlay.style.opacity = '1';
    statusEl.textContent = ''; remEl.textContent = '集計中';
  } else {
    const ex = pollContent.querySelector('.poll-overlay'); if(ex){ ex.classList.remove('pulse'); ex.style.opacity = '0'; ex.remove(); }
  }

  if(poll.state === 'showResults'){
    statusEl.textContent = '結果！';
    const showAt = poll.showResultsAt || Date.now();
    const removalAt = showAt + 30000;
    poll._resultInterval = setInterval(()=> {
      const now = Date.now(); const rem = Math.max(0, Math.ceil((removalAt - now)/1000));
      remEl.textContent = `終了まで ${rem}s`;
      if(rem <= 0) clearInterval(poll._resultInterval);
    }, 250);
  } else if(poll.state === 'voting'){
    statusEl.textContent = '';
    poll._timerInterval = setInterval(()=> {
      const now = Date.now(); const rem = Math.max(0, Math.ceil((poll.endsAt - now)/1000));
      remEl.textContent = `残り ${rem}s`;
      if(rem <= 0) clearInterval(poll._timerInterval);
    }, 300);
  }

  pollArea.style.display = 'block';
}

// Clear intervals references stored on 'poll' object if any
function clearPollTimers(poll){
  try{ if(poll && poll._timerInterval){ clearInterval(poll._timerInterval); poll._timerInterval = null; } }catch(e){}
  try{ if(poll && poll._resultInterval){ clearInterval(poll._resultInterval); poll._resultInterval = null; } }catch(e){}
}

// Vote
function voteOption(optId){
  const user = auth.currentUser; if(!user) return alert('ログインしてください'); if(!localActivePoll) return;
  if(localActivePoll.state === 'counting' || localActivePoll.state === 'showResults') return;
  const uid = user.uid;
  pollsRef.child('active').child('votes').child(uid).set({ opt: optId, at: Date.now(), name: user.displayName || user.email })
    .then(()=> { myVoteOpt = optId; markSelectedOption(optId); })
    .catch(err=> console.warn('vote failed', err));
}
function markSelectedOption(optId){ document.querySelectorAll('.poll-option').forEach(el=> el.classList.toggle('selected', el.dataset.optId === optId)); }

// Create poll
function addPollOption(){ const wrapper = document.getElementById('pollOptionsWrapper'); const input = document.createElement('input'); input.type='text'; input.className='pollOption'; input.placeholder = `選択肢${wrapper.querySelectorAll('.pollOption').length + 1}`; wrapper.appendChild(input); }
function createPoll(){
  const user = auth.currentUser; if(!user) return alert('ログインしてください');
  const q = document.getElementById('pollQuestion').value.trim(); if(!q) return alert('質問を入力してください');
  const labels = Array.from(document.querySelectorAll('.pollOption')).map(i=>i.value.trim()).filter(Boolean);
  if(labels.length < 2) return alert('選択肢は2つ以上必要です');
  const opts = labels.map((label, idx) => ({ id:`o${idx+1}`, label, count:0 }));
  const now = Date.now();
  const pollObj = { active:true, question:q, options:opts, startedAt:now, endsAt: now + POLL_DURATION_MS, creatorUid: user.uid, state:'voting' };
  pollsRef.child('active').set(pollObj).then(()=> closeModal('pollModal')).catch(err=> alert('作成失敗：' + err.message));
}

// Finalize: counting -> showResults -> removal (any client may perform)
function finalizePollIfNeeded(){
  if(!localActivePoll || finalized) return;
  finalized = true;
  pollsRef.child('active').update({ state: 'counting' }).catch(()=>{});
  setTimeout(()=> {
    pollsRef.child('active').child('votes').once('value').then(snap => {
      const votes = snap.val() || {};
      const counts = {};
      (localActivePoll.options || []).forEach(o => counts[o.id] = 0);
      Object.values(votes).forEach(v => { if(v && v.opt && counts[v.opt] !== undefined) counts[v.opt] += 1; });
      const newOptions = (localActivePoll.options || []).map(o => ({ id:o.id, label:o.label, count: counts[o.id] || 0 }));
      pollsRef.child('active').update({ options: newOptions, state:'showResults', showResultsAt: Date.now() })
        .then(()=> {
          setTimeout(()=> {
            const pollArea = document.getElementById('pollArea'); if(pollArea) pollArea.classList.add('poll-fadeout');
            setTimeout(()=> { pollsRef.child('active').remove().catch(()=>{}); finalized = false; }, 600);
          }, 30000);
        }).catch(err=>{ console.warn('finalize update failed', err); finalized = false; });
    }).catch(err=>{ console.warn('count votes failed', err); finalized = false; });
  }, 800);
}

function hidePollUI(){
  const pollArea = document.getElementById('pollArea'); if(!pollArea) return;
  pollArea.style.display = 'none'; pollArea.classList.remove('poll-fadeout');
  document.getElementById('pollContent').innerHTML = ''; const t = document.getElementById('pollTimer'); if(t) t.textContent = '';
  myVoteOpt = null;
}

// Upload form (Apps Script)
function handleUploadForm(e){
  e.preventDefault();
  const file = document.getElementById('imageFile').files[0]; if(!file) return alert('画像を選択してください');
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec'; // replace
  const fd = new FormData(); fd.append('file', file);
  fetch(GAS_URL, { method:'POST', body: fd }).then(r => r.text()).then(url => {
    const user = auth.currentUser; if(!user) return alert('ログインしてください');
    user.updateProfile({ photoURL: url }).then(()=> { document.getElementById('avatar').src = url; closeModal('mypageModal'); }).catch(err=>alert('更新失敗：' + err.message));
  }).catch(err=>alert('アップロード失敗：' + err.message));
}
