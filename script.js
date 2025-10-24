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

// References
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref("comments");
const pollsRef = db.ref("polls");       // use /polls/active
const arrivalsRef = db.ref("arrivals");

const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000; // 30秒
const ARRIVAL_BANNER_DURATION = 5000;

let firstCommentTime = null;
let _prevAuthUser = null;
let localActivePoll = null;
let localPollListenerSet = false;
let finalized = false;
let myVoteOpt = null;

// -------------------- Utility --------------------
function escapeHtml(str){ if(str===null||str===undefined) return ""; return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

// -------------------- Modal --------------------
function openModal(id){ const el = document.getElementById(id); if(!el) return; el.style.display = "block"; el.setAttribute("aria-hidden","false"); }
function closeModal(id){ const el = document.getElementById(id); if(!el) return; el.style.display = "none"; el.setAttribute("aria-hidden","true"); }
window.addEventListener("click", (e)=>{ document.querySelectorAll(".modal").forEach(m=>{ if(e.target===m) m.style.display="none"; }); });

// -------------------- Arrival banner --------------------
function showArrivalBanner(name){
  const banner = document.getElementById("arrivalBanner");
  if(!banner) return;
  const safe = name ? escapeHtml(name) : "ゲスト";
  banner.textContent = `${safe}さんが配信を視聴しに来ました`;
  banner.style.display = "block";
  banner.classList.add("show");
  if(banner._hideTimer) clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(()=>{
    banner.classList.remove("show");
    setTimeout(()=>{ if(!banner.classList.contains("show")) banner.style.display = "none"; }, 300);
  }, ARRIVAL_BANNER_DURATION);
}

// -------------------- Startup listeners (must register early) --------------------
setupGlobalListeners();
function setupGlobalListeners(){
  // arrivals
  arrivalsRef.on("child_added", snap=>{
    const data = snap.val();
    if(!data || data.type !== "arrival") return;
    showArrivalBanner(data.name);
    snap.ref.remove().catch(()=>{/*ignore*/});
  });

  // polls listener registered immediately
  ensurePollListener();

  // comments
  initComments();
}

// -------------------- Auth state --------------------
auth.onAuthStateChanged(user=>{
  const form = document.getElementById("form");
  const loginBtn = document.getElementById("loginBtn");
  const mypageBtn = document.getElementById("mypageBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if(user){
    form.style.display = "flex";
    loginBtn.style.display = "none";
    mypageBtn.style.display = "inline-block";
    logoutBtn.style.display = "inline-block";
    document.getElementById("username").textContent = user.displayName || user.email;
    document.getElementById("avatar").src = user.photoURL || "";

    if(!_prevAuthUser){
      const name = user.displayName || user.email || "ゲスト";
      arrivalsRef.push({ type:"arrival", name, timestamp: Date.now() }).catch(err=>console.warn(err));
      showArrivalBanner(name);
    }
  } else {
    form.style.display = "none";
    loginBtn.style.display = "inline-block";
    mypageBtn.style.display = "none";
    logoutBtn.style.display = "none";
    document.getElementById("avatar").src = "";
    document.getElementById("username").textContent = "";
  }
  _prevAuthUser = user;
});

// -------------------- Auth actions --------------------
function signUp(){ const email=document.getElementById("email").value.trim(); const password=document.getElementById("password").value; if(!email||!password) return alert("メールとパスワードを入力してください"); auth.createUserWithEmailAndPassword(email,password).then(()=>{ alert("登録成功"); closeModal('loginModal'); }).catch(err=>alert(err.message)); }
function signIn(){ const email=document.getElementById("email").value.trim(); const password=document.getElementById("password").value; if(!email||!password) return alert("メールとパスワードを入力してください"); auth.signInWithEmailAndPassword(email,password).then(()=>{ alert("ログイン成功"); closeModal('loginModal'); }).catch(err=>alert(err.message)); }
function signOut(){ auth.signOut().then(()=>{ alert("ログアウトしました"); }).catch(err=>alert(err.message)); }
function updateProfile(){ const user=auth.currentUser; const newName=document.getElementById("newName").value.trim(); if(!user) return alert("ログインしてください"); if(!newName) return alert("名前を入力してください"); user.updateProfile({ displayName:newName }).then(()=>{ alert("ユーザー名を更新しました"); document.getElementById("username").textContent=newName; closeModal('mypageModal'); }).catch(err=>alert("更新失敗："+err.message)); }

// -------------------- Comments --------------------
function sendComment(){
  const user = auth.currentUser;
  const text = document.getElementById("commentInput").value.trim();
  if(!user) return alert("ログインしてください");
  if(!text) return;
  commentsRef.push({ uid: user.uid, name: user.displayName || user.email, photo: user.photoURL || "", text, timestamp: Date.now() })
    .then(()=> document.getElementById("commentInput").value = "")
    .catch(err=>alert("保存失敗："+err.message));
}

function formatTimeOnly(ts){ const d=new Date(ts); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

function initComments(){
  commentsRef.once("value", snapshot=>{
    let earliest = null;
    snapshot.forEach(child=>{ const data = child.val(); if(data && data.timestamp && (!earliest || data.timestamp < earliest)) earliest = data.timestamp; });
    firstCommentTime = earliest || Date.now();
    commentsRef.on("child_added", snap=>{
      const data = snap.val();
      if(!data || !data.timestamp) return;
      if(data.timestamp - firstCommentTime > THREE_HOURS) return;
      prependCommentWithPushAnimation(data);
    });
  });
}

function prependCommentWithPushAnimation(data){
  const commentsEl = document.getElementById("comments");
  const existing = Array.from(commentsEl.children);
  existing.forEach(el=>el.classList.add("_prep-shift"));
  commentsEl.offsetHeight;
  const div = document.createElement("div");
  div.className = "comment new";
  const avatarUrl = data.photo || "https://via.placeholder.com/40";
  div.innerHTML = `
    <img src="${escapeHtml(avatarUrl)}" alt="avatar">
    <div class="meta">
      <div><strong>${escapeHtml(data.name)}</strong></div>
      <div>${escapeHtml(data.text)}</div>
    </div>
    <div style="margin-left:auto;"><small>${formatTimeOnly(data.timestamp)}</small></div>
  `;
  if(commentsEl.firstChild) commentsEl.insertBefore(div, commentsEl.firstChild);
  else commentsEl.appendChild(div);
  requestAnimationFrame(()=>{ div.classList.remove("new"); existing.forEach(el=>el.classList.remove("_prep-shift")); });
  setTimeout(()=>{ div.classList.remove("new"); existing.forEach(el=>el.classList.remove("_prep-shift")); },600);
}

// -------------------- Poll (アンケート) --------------------
// ensure listener is registered immediately (done in setupGlobalListeners)

function addPollOption(){
  const wrapper = document.getElementById("pollOptionsWrapper");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "pollOption";
  input.placeholder = `選択肢${wrapper.querySelectorAll('.pollOption').length + 1}`;
  wrapper.appendChild(input);
}

function createPoll(){
  const user = auth.currentUser;
  if(!user) return alert("ログインしてください");
  const q = document.getElementById("pollQuestion").value.trim();
  if(!q) return alert("質問を入力してください");
  const optionEls = Array.from(document.querySelectorAll(".pollOption"));
  const labels = optionEls.map(el=>el.value.trim()).filter(x=>x);
  if(labels.length < 2) return alert("選択肢は2つ以上必要です");

  const opts = labels.map((label, idx)=>({ id:`o${idx+1}`, label, count:0 }));
  const now = Date.now();
  const pollObj = { active:true, question:q, options:opts, startedAt:now, endsAt: now + POLL_DURATION_MS, creatorUid: user.uid, state:"voting" };

  pollsRef.child("active").set(pollObj)
    .then(()=> { closeModal('pollModal'); })
    .catch(err=> { console.error("createPoll failed", err); alert("アンケート作成失敗："+err.message); });
}

function ensurePollListener(){
  if(localPollListenerSet) return;
  pollsRef.child("active").on("value", snap=>{
    const data = snap.val();
    console.log("poll active value", data);
    if(!data || data.active !== true){
      hidePollUI();
      localActivePoll = null;
      finalized = false;
      return;
    }
    localActivePoll = data;
    // render according to state
    renderPollState(data);

    // If voting timed out, trigger finalize from one client (race-safe since update uses DB and finalized flag)
    if(data.state === "voting" && Date.now() > data.endsAt){
      finalizePollIfNeeded();
    }
  });
  localPollListenerSet = true;
}

// compute percent width
function calcPercentWidth(count, poll){
  const total = (poll.options||[]).reduce((s,o)=>s+(o.count||0),0) || 0;
  if(total===0) return 0;
  return Math.round((count/total)*100);
}

// vote
function voteOption(optId){
  const user = auth.currentUser;
  if(!user) return alert("ログインしてください");
  if(!localActivePoll) return;
  if(localActivePoll.state === "showResults" || localActivePoll.state === "counting") return;
  const uid = user.uid;
  const votePath = pollsRef.child("active").child("votes").child(uid);
  votePath.set({ opt:optId, at:Date.now(), name:user.displayName || user.email })
    .then(()=> { myVoteOpt = optId; markSelectedOption(optId); })
    .catch(err=>console.warn("vote failed", err));
}
function markSelectedOption(optId){
  document.querySelectorAll(".poll-option").forEach(el=>{
    if(el.dataset.optId === optId) el.classList.add("selected");
    else el.classList.remove("selected");
  });
}

// render UI for poll (voting / counting / showResults)
function renderPollState(poll){
  const pollArea = document.getElementById("pollArea");
  const pollContent = document.getElementById("pollContent");
  if(!pollContent) return;
  pollArea.style.display = "block";
  pollArea.classList.remove("hidden");

  pollContent.innerHTML = "";
  // header
  const header = document.createElement("div"); header.className = "poll-header";
  const qEl = document.createElement("div"); qEl.className = "poll-question"; qEl.textContent = poll.question;
  const rightWrap = document.createElement("div"); rightWrap.style.display="flex"; rightWrap.style.alignItems="center"; rightWrap.style.gap="8px";
  const statusEl = document.createElement("div"); statusEl.className = "poll-status";
  const remEl = document.createElement("div"); remEl.id = "pollRemainingRight"; remEl.className = "poll-remaining";
  rightWrap.appendChild(statusEl); rightWrap.appendChild(remEl);
  header.appendChild(qEl); header.appendChild(rightWrap);
  pollContent.appendChild(header);

  // overlay
  let overlay = pollContent.querySelector(".poll-overlay");
  if(!overlay){
    overlay = document.createElement("div");
    overlay.className = "poll-overlay";
    overlay.textContent = "集計中";
    pollContent.appendChild(overlay);
  }

  // options
  const optionsWrap = document.createElement("div"); optionsWrap.className = "poll-options";
  const total = (poll.options||[]).reduce((s,o)=>s+(o.count||0),0);
  (poll.options||[]).forEach(o=>{
    const percent = total === 0 ? 0 : Math.round(((o.count||0)/total)*100);
    const optEl = document.createElement("div");
    optEl.className = "poll-option";
    optEl.dataset.optId = o.id;
    optEl.innerHTML = `<div class="label">${escapeHtml(o.label)}</div><div class="bar"><i style="width:${percent}%"></i></div><div class="percent">${percent}%</div>`;
    if(poll.state === "voting"){
      optEl.addEventListener("click", ()=> { voteOption(o.id); });
      // try to mark user's existing vote
      const uid = auth.currentUser ? auth.currentUser.uid : null;
      if(uid){
        pollsRef.child("active").child("votes").child(uid).once("value").then(snap=>{
          const v = snap.val();
          if(v && v.opt) markSelectedOption(v.opt);
        }).catch(()=>{/*ignore*/});
      }
    } else {
      optEl.classList.add("disabled");
      if(myVoteOpt === o.id) optEl.classList.add("selected");
    }
    optionsWrap.appendChild(optEl);
  });
  pollContent.appendChild(optionsWrap);

  // state handling
  if(poll.state === "counting"){
    overlay.classList.add("pulse");
    overlay.style.opacity = "1";
    statusEl.textContent = "";
    // remaining to result calculation not necessary; show overlay
  } else {
    overlay.classList.remove("pulse");
    overlay.style.opacity = "0";
  }

  if(poll.state === "showResults"){
    statusEl.textContent = "結果！";
    // compute removal countdown
    const showResultsAt = poll.showResultsAt || Date.now();
    const removalAt = showResultsAt + 30000;
    if(poll._resultInterval) clearInterval(poll._resultInterval);
    poll._resultInterval = setInterval(()=>{
      const now = Date.now();
      const remain = Math.max(0, Math.ceil((removalAt - now)/1000));
      remEl.textContent = `終了まで ${remain}s`;
      if(remain <= 0) { clearInterval(poll._resultInterval); }
    }, 250);
  } else if(poll.state === "voting"){
    statusEl.textContent = "";
    if(poll._timerInterval) clearInterval(poll._timerInterval);
    poll._timerInterval = setInterval(()=> {
      const now = Date.now();
      const remain = Math.max(0, Math.ceil((poll.endsAt - now)/1000));
      remEl.textContent = `残り ${remain}s`;
      if(remain <= 0) clearInterval(poll._timerInterval);
    }, 300);
  }

  // ensure visible
  document.getElementById("pollArea").style.display = "block";
}

// finalize: set counting -> compute -> set showResults -> schedule removal
function finalizePollIfNeeded(){
  if(!localActivePoll || finalized) return;
  finalized = true;
  // set counting state
  pollsRef.child("active").update({ state: "counting" }).catch(()=>{});
  // short delay so clients show overlay
  setTimeout(()=>{
    pollsRef.child("active").child("votes").once("value").then(snap=>{
      const votes = snap.val() || {};
      const counts = {};
      (localActivePoll.options || []).forEach(o=> counts[o.id]=0);
      Object.values(votes).forEach(v=>{ if(v && v.opt && counts[v.opt] !== undefined) counts[v.opt] += 1; });
      const newOptions = (localActivePoll.options || []).map(o=> ({ id:o.id, label:o.label, count: counts[o.id] || 0 }));
      pollsRef.child("active").update({ options: newOptions, state: "showResults", showResultsAt: Date.now() })
        .then(()=>{
          // after 30s, animate fadeout and remove
          setTimeout(()=>{
            const pollArea = document.getElementById("pollArea");
            if(pollArea) pollArea.classList.add("poll-fadeout");
            setTimeout(()=>{ pollsRef.child("active").remove().catch(()=>{}); finalized = false; }, 600);
          }, 30000);
        }).catch(err=>{ console.warn("finalize update failed", err); finalized = false; });
    }).catch(err=>{ console.warn("count votes failed", err); finalized = false; });
  }, 800);
}

function hidePollUI(){
  const pollArea = document.getElementById("pollArea");
  if(!pollArea) return;
  pollArea.style.display = "none";
  pollArea.classList.remove("poll-fadeout");
  document.getElementById("pollContent").innerHTML = "";
  document.getElementById("pollTimer").textContent = "";
  myVoteOpt = null;
}

// -------------------- Profile Upload (Apps Script) --------------------
document.getElementById("uploadForm").addEventListener("submit", function(e){
  e.preventDefault();
  const file = document.getElementById("imageFile").files[0];
  if(!file) return alert("画像を選択してください");
  const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec"; // ← ここを置き換えてください
  const form = new FormData();
  form.append("file", file);
  fetch(GAS_URL, { method: "POST", body: form })
    .then(res => res.text())
    .then(url => {
      const user = auth.currentUser;
      if(!user) return alert("ログインしてください");
      user.updateProfile({ photoURL: url })
        .then(()=>{ alert("プロフィール画像を更新しました"); document.getElementById("avatar").src = url; closeModal('mypageModal'); })
        .catch(err=>alert("更新失敗：" + err.message));
    })
    .catch(err=>alert("アップロード失敗：" + err.message));
});
