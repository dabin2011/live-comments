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

// DB / Auth refs
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref("comments");
const pollsRef = db.ref("polls");
const arrivalsRef = db.ref("arrivals");

const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000;
const ARRIVAL_BANNER_DURATION = 5000;

// state
let firstCommentTime = null;
let _prevAuthUser = null;
let localActivePoll = null;
let localPollListenerSet = false;
let finalized = false;
let myVoteOpt = null;

// util
function escapeHtml(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function formatTimeOnly(ts){ const d=new Date(ts); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

// ------------------ startup: register listeners immediately ------------------
setupListeners();
function setupListeners(){
  // arrivals
  arrivalsRef.on("child_added", snap=>{
    const v = snap.val();
    if(v && v.type==="arrival") showArrivalBanner(v.name);
    snap.ref.remove().catch(()=>{/*ignore*/});
  });

  // polls listener must be registered immediately so all state updates are received
  ensurePollListener();

  // comments
  initComments();
}

// ------------------ auth state ------------------
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
      arrivalsRef.push({ type:"arrival", name, timestamp: Date.now() }).catch(()=>{/*ignore*/});
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

// ------------------ arrival banner ------------------
function showArrivalBanner(name){
  const banner = document.getElementById("arrivalBanner");
  if(!banner) return;
  banner.textContent = `${escapeHtml(name||"ゲスト")}さんが配信を視聴しに来ました`;
  banner.style.display = "block";
  banner.classList.add("show");
  if(banner._hideTimer) clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(()=>{ banner.classList.remove("show"); setTimeout(()=>{ if(!banner.classList.contains("show")) banner.style.display="none"; },300); }, ARRIVAL_BANNER_DURATION);
}

// ------------------ comments ------------------
function initComments(){
  commentsRef.once("value", snap=>{
    let earliest = null;
    snap.forEach(c=>{ const d=c.val(); if(d && d.timestamp && (!earliest || d.timestamp < earliest)) earliest = d.timestamp; });
    firstCommentTime = earliest || Date.now();
    commentsRef.on("child_added", cs=>{
      const d = cs.val();
      if(!d || !d.timestamp) return;
      if(d.timestamp - firstCommentTime > THREE_HOURS) return;
      prependCommentWithPushAnimation(d);
    });
  });
}
function prependCommentWithPushAnimation(d){
  const commentsEl = document.getElementById("comments");
  const existing = Array.from(commentsEl.children);
  existing.forEach(el=>el.classList.add("_prep-shift"));
  commentsEl.offsetHeight;
  const div = document.createElement("div");
  div.className = "comment new";
  div.innerHTML = `<img src="${escapeHtml(d.photo||'https://via.placeholder.com/40')}" alt="avatar"><div class="meta"><div><strong>${escapeHtml(d.name)}</strong></div><div>${escapeHtml(d.text)}</div></div><div style="margin-left:auto"><small>${formatTimeOnly(d.timestamp)}</small></div>`;
  if(commentsEl.firstChild) commentsEl.insertBefore(div, commentsEl.firstChild); else commentsEl.appendChild(div);
  requestAnimationFrame(()=>{ div.classList.remove("new"); existing.forEach(el=>el.classList.remove("_prep-shift")); });
  setTimeout(()=>{ div.classList.remove("new"); existing.forEach(el=>el.classList.remove("_prep-shift")); },600);
}
function sendComment(){
  const user = auth.currentUser;
  const text = document.getElementById("commentInput").value.trim();
  if(!user) return alert("ログインしてください");
  if(!text) return;
  commentsRef.push({ uid:user.uid, name:user.displayName||user.email, photo:user.photoURL||"", text, timestamp: Date.now() })
    .then(()=> document.getElementById("commentInput").value = "")
    .catch(err=>alert("保存失敗："+err.message));
}

// ------------------ polls: listener and UI ------------------
function ensurePollListener(){
  if(localPollListenerSet) return;
  pollsRef.child("active").on("value", snap=>{
    const data = snap.val();
    // console.log("poll active changed", data);
    if(!data || data.active !== true){
      hidePollUI();
      localActivePoll = null;
      finalized = false;
      return;
    }
    // set localActivePoll then render
    localActivePoll = data;
    renderPollState(localActivePoll);

    // if voting expired and no one finalized yet, attempt finalize from any client
    if(localActivePoll.state === "voting" && Date.now() > localActivePoll.endsAt){
      finalizePollIfNeeded();
    }
  });
  localPollListenerSet = true;
}

// build UI according to state
function renderPollState(poll){
  const pollArea = document.getElementById("pollArea");
  const pollContent = document.getElementById("pollContent");
  if(!pollContent) return;
  pollArea.style.display = "block";
  pollArea.classList.remove("hidden");
  pollContent.innerHTML = "";

  // header
  const header = document.createElement("div"); header.className = "poll-header";
  const q = document.createElement("div"); q.className = "poll-question"; q.textContent = poll.question;
  const right = document.createElement("div"); right.style.display="flex"; right.style.gap="8px"; right.style.alignItems="center";
  const status = document.createElement("div"); status.className = "poll-status";
  const remaining = document.createElement("div"); remaining.id = "pollRemainingRight"; remaining.className = "poll-remaining";
  right.appendChild(status); right.appendChild(remaining);
  header.appendChild(q); header.appendChild(right);
  pollContent.appendChild(header);

  // overlay
  let overlay = document.createElement("div");
  overlay.className = "poll-overlay";
  overlay.textContent = "集計中";

  // options
  const optionsWrap = document.createElement("div"); optionsWrap.className = "poll-options";
  const total = (poll.options||[]).reduce((s,o)=>s+(o.count||0),0);
  (poll.options||[]).forEach(o=>{
    const percent = total===0 ? 0 : Math.round(((o.count||0)/total)*100);
    const opt = document.createElement("div"); opt.className = "poll-option"; opt.dataset.optId = o.id;
    opt.innerHTML = `<div class="label">${escapeHtml(o.label)}</div><div class="bar"><i style="width:${percent}%"></i></div><div class="percent">${percent}%</div>`;
    if(poll.state === "voting"){
      opt.addEventListener("click", ()=> voteOption(o.id));
      // mark user vote if exists
      const uid = auth.currentUser ? auth.currentUser.uid : null;
      if(uid){
        pollsRef.child("active").child("votes").child(uid).once("value").then(snap=>{
          const v = snap.val(); if(v && v.opt) markSelectedOption(v.opt);
        }).catch(()=>{/*ignore*/});
      }
    } else {
      opt.classList.add("disabled");
      if(myVoteOpt === o.id) opt.classList.add("selected");
    }
    optionsWrap.appendChild(opt);
  });
  pollContent.appendChild(optionsWrap);

  // state handling
  clearPollTimers(poll);
  if(poll.state === "counting"){
    // overlay pulse
    const existingOverlay = pollContent.querySelector(".poll-overlay");
    if(!existingOverlay) pollContent.appendChild(overlay);
    pollContent.querySelector(".poll-overlay").classList.add("pulse");
    pollContent.querySelector(".poll-overlay").style.opacity = "1";
    status.textContent = "";
    remaining.textContent = "集計中";
  } else {
    // remove overlay if present
    const ex = pollContent.querySelector(".poll-overlay");
    if(ex) { ex.classList.remove("pulse"); ex.style.opacity = "0"; ex.remove(); }
  }

  if(poll.state === "showResults"){
    status.textContent = "結果！";
    const showAt = poll.showResultsAt || Date.now();
    const removalAt = showAt + 30000;
    poll._resultInterval = setInterval(()=> {
      const now = Date.now(); const rem = Math.max(0, Math.ceil((removalAt - now)/1000));
      remaining.textContent = `終了まで ${rem}s`;
      if(rem <= 0) clearInterval(poll._resultInterval);
    }, 250);
  } else if(poll.state === "voting"){
    status.textContent = "";
    poll._timerInterval = setInterval(()=> {
      const now = Date.now(); const rem = Math.max(0, Math.ceil((poll.endsAt - now)/1000));
      remaining.textContent = `残り ${rem}s`;
      if(rem <= 0) clearInterval(poll._timerInterval);
    }, 300);
  }

  // ensure animated bar widths update (they're set inline)
  document.getElementById("pollArea").style.display = "block";
}

function clearPollTimers(poll){
  if(poll && poll._timerInterval) { clearInterval(poll._timerInterval); poll._timerInterval = null; }
  if(poll && poll._resultInterval) { clearInterval(poll._resultInterval); poll._resultInterval = null; }
}

// vote
function voteOption(optId){
  const user = auth.currentUser;
  if(!user) return alert("ログインしてください");
  if(!localActivePoll) return;
  if(localActivePoll.state === "counting" || localActivePoll.state === "showResults") return;
  const uid = user.uid;
  const voteRef = pollsRef.child("active").child("votes").child(uid);
  voteRef.set({ opt: optId, at: Date.now(), name: user.displayName || user.email })
    .then(()=> { myVoteOpt = optId; markSelectedOption(optId); })
    .catch(err=>console.warn("vote failed", err));
}
function markSelectedOption(optId){
  document.querySelectorAll(".poll-option").forEach(el=> el.classList.toggle("selected", el.dataset.optId===optId));
}

// create poll (sets active with state=voting)
function createPoll(){
  const user = auth.currentUser;
  if(!user) return alert("ログインしてください");
  const q = document.getElementById("pollQuestion").value.trim();
  if(!q) return alert("質問を入力してください");
  const labels = Array.from(document.querySelectorAll(".pollOption")).map(i=>i.value.trim()).filter(Boolean);
  if(labels.length < 2) return alert("選択肢は2つ以上必要です");
  const opts = labels.map((label,idx)=>({ id:`o${idx+1}`, label, count:0 }));
  const now = Date.now();
  const pollObj = { active:true, question:q, options:opts, startedAt:now, endsAt: now + POLL_DURATION_MS, creatorUid: user.uid, state:"voting" };
  pollsRef.child("active").set(pollObj).then(()=> closeModal('pollModal')).catch(err=>alert("作成失敗："+err.message));
}

// finalize (counting -> showResults -> removal). Any client may call when endsAt passed
function finalizePollIfNeeded(){
  if(!localActivePoll || finalized) return;
  finalized = true;
  // 1) set counting state (write to DB so all clients show overlay)
  pollsRef.child("active").update({ state: "counting" }).catch(()=>{/*ignore*/});
  // 2) small delay so overlay visible
  setTimeout(()=>{
    pollsRef.child("active").child("votes").once("value").then(snap=>{
      const votes = snap.val() || {};
      const counts = {};
      (localActivePoll.options || []).forEach(o=> counts[o.id]=0);
      Object.values(votes).forEach(v=>{ if(v && v.opt && counts[v.opt] !== undefined) counts[v.opt] += 1; });
      const newOptions = (localActivePoll.options || []).map(o=> ({ id:o.id, label:o.label, count: counts[o.id] || 0 }));
      // 3) write results and mark showResultsAt
      pollsRef.child("active").update({ options: newOptions, state: "showResults", showResultsAt: Date.now() })
        .then(()=>{
          // 4) schedule removal after 30s (clients will show countdown from showResultsAt)
          setTimeout(()=>{
            // fadeout locally then remove; removal also triggers hide for others
            const pollArea = document.getElementById("pollArea"); if(pollArea) pollArea.classList.add("poll-fadeout");
            setTimeout(()=>{ pollsRef.child("active").remove().catch(()=>{}); finalized = false; }, 600);
          }, 30000);
        }).catch(err=>{ console.warn("finalize update failed",err); finalized=false; });
    }).catch(err=>{ console.warn("count votes failed",err); finalized=false; });
  }, 800);
}

function hidePollUI(){
  const pollArea = document.getElementById("pollArea");
  if(!pollArea) return;
  pollArea.style.display = "none";
  pollArea.classList.remove("poll-fadeout");
  document.getElementById("pollContent").innerHTML = "";
  document.getElementById("pollTimer") && (document.getElementById("pollTimer").textContent = "");
  myVoteOpt = null;
}

// ------------------ profile upload via Apps Script (example) ------------------
document.getElementById("uploadForm")?.addEventListener("submit", function(e){
  e.preventDefault();
  const file = document.getElementById("imageFile").files[0];
  if(!file) return alert("画像を選択してください");
  const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec"; // replace
  const fd = new FormData(); fd.append("file", file);
  fetch(GAS_URL, { method:"POST", body:fd }).then(r=>r.text()).then(url=>{
    const user = auth.currentUser; if(!user) return alert("ログインしてください");
    user.updateProfile({ photoURL: url }).then(()=>{ document.getElementById("avatar").src = url; closeModal('mypageModal'); }).catch(err=>alert("更新失敗："+err.message));
  }).catch(err=>alert("アップロード失敗："+err.message));
});
