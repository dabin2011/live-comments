// ===== script.js =====

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

// Realtime DB / Auth 参照
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref("comments");
const pollsRef = db.ref("polls");       // 単一アクティブアンケート: /polls/active
const arrivalsRef = db.ref("arrivals"); // 到着通知用ノード

// 定数
const THREE_HOURS = 3 * 60 * 60 * 1000;
const POLL_DURATION_MS = 30 * 1000; // 30秒
const ARRIVAL_BANNER_DURATION = 5000;

let firstCommentTime = null;
let _prevAuthUser = null;
let localActivePoll = null;
let localPollListenerSet = false;
let finalized = false;

// -------------------- モーダル制御 --------------------
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "block";
  el.setAttribute("aria-hidden", "false");
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "none";
  el.setAttribute("aria-hidden", "true");
}
window.addEventListener("click", (event) => {
  document.querySelectorAll(".modal").forEach(modal => {
    if (event.target === modal) modal.style.display = "none";
  });
});

// -------------------- Arrival banner --------------------
function showArrivalBanner(name) {
  const banner = document.getElementById("arrivalBanner");
  if (!banner) return;
  const safeName = name ? escapeHtml(name) : "ゲスト";
  banner.textContent = `${safeName}さんが配信を視聴しに来ました`;
  banner.style.display = "block";
  banner.classList.add("show");
  if (banner._hideTimer) clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(() => {
    banner.classList.remove("show");
    setTimeout(() => { if (!banner.classList.contains("show")) banner.style.display = "none"; }, 300);
  }, ARRIVAL_BANNER_DURATION);
}

// -------------------- 認証状態の監視 --------------------
// 監視登録は早めに行う（arrivals 等のリスナーも先に）
setupGlobalListeners();

auth.onAuthStateChanged(user => {
  const form = document.getElementById("form");
  const loginBtn = document.getElementById("loginBtn");
  const mypageBtn = document.getElementById("mypageBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (user) {
    form.style.display = "flex";
    loginBtn.style.display = "none";
    mypageBtn.style.display = "inline-block";
    logoutBtn.style.display = "inline-block";
    document.getElementById("username").textContent = user.displayName || user.email;
    document.getElementById("avatar").src = user.photoURL || "";

    // 未ログイン -> ログイン の遷移を検出したら arrivals に書き込む
    if (!_prevAuthUser) {
      const name = user.displayName || user.email || "ゲスト";
      // arrivalsRef に push して全クライアントへ通知
      arrivalsRef.push({ type: "arrival", name, timestamp: Date.now() })
        .then(() => { /* ok */ })
        .catch(err => console.warn("arrival push failed:", err));
      // 自クライアントにも即表示
      showArrivalBanner(user.displayName || user.email);
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

// -------------------- arrivals ノード監視（全体通知） --------------------
arrivalsRef.on("child_added", snap => {
  const data = snap.val();
  if (!data || data.type !== "arrival") return;
  showArrivalBanner(data.name);
  // 一度表示したら削除して過去イベント再表示を防ぐ
  snap.ref.remove().catch(()=>{/* ignore */});
});

// -------------------- 認証操作 --------------------
function signUp() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) return alert("メールとパスワードを入力してください");
  auth.createUserWithEmailAndPassword(email, password)
    .then(() => { alert("登録成功"); closeModal('loginModal'); })
    .catch(err => alert(err.message));
}
function signIn() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) return alert("メールとパスワードを入力してください");
  auth.signInWithEmailAndPassword(email, password)
    .then(() => { alert("ログイン成功"); closeModal('loginModal'); })
    .catch(err => alert(err.message));
}
function signOut() {
  auth.signOut().then(()=> { alert("ログアウトしました"); }).catch(err => alert(err.message));
}
function updateProfile() {
  const user = auth.currentUser;
  const newName = document.getElementById("newName").value.trim();
  if (!user) return alert("ログインしてください");
  if (!newName) return alert("名前を入力してください");
  user.updateProfile({ displayName: newName })
    .then(() => {
      alert("ユーザー名を更新しました");
      document.getElementById("username").textContent = newName;
      closeModal('mypageModal');
    })
    .catch(err => alert("更新失敗：" + err.message));
}

// -------------------- コメント送信 --------------------
function sendComment() {
  const user = auth.currentUser;
  const text = document.getElementById("commentInput").value.trim();
  if (!user) return alert("ログインしてください");
  if (!text) return;
  commentsRef.push({
    uid: user.uid,
    name: user.displayName || user.email,
    photo: user.photoURL || "",
    text,
    timestamp: Date.now()
  }).then(()=> {
    document.getElementById("commentInput").value = "";
  }).catch(err => alert("保存失敗：" + err.message));
}

// -------------------- コメント表示 --------------------
function formatTimeOnly(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function initComments() {
  commentsRef.once("value", snapshot => {
    let earliest = null;
    snapshot.forEach(child => {
      const data = child.val();
      if (data && data.timestamp && (!earliest || data.timestamp < earliest)) earliest = data.timestamp;
    });
    firstCommentTime = earliest || Date.now();

    commentsRef.on("child_added", snap => {
      const data = snap.val();
      if (!data || !data.timestamp) return;
      if (data.timestamp - firstCommentTime > THREE_HOURS) return;
      prependCommentWithPushAnimation(data);
    });
  });
}
initComments();

function prependCommentWithPushAnimation(data) {
  const commentsEl = document.getElementById("comments");
  const existing = Array.from(commentsEl.children);
  existing.forEach(el => el.classList.add("_prep-shift"));
  commentsEl.offsetHeight; // force reflow

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
  if (commentsEl.firstChild) commentsEl.insertBefore(div, commentsEl.firstChild);
  else commentsEl.appendChild(div);

  requestAnimationFrame(() => {
    div.classList.remove("new");
    existing.forEach(el => el.classList.remove("_prep-shift"));
  });
  setTimeout(() => {
    div.classList.remove("new");
    existing.forEach(el => el.classList.remove("_prep-shift"));
  }, 600);
}

// -------------------- Poll（アンケート）機能 --------------------
// DB structure: /polls/active => { active:true, question, options:[{id,label,count}], startedAt, endsAt, creatorUid, state, showResultsAt, votes: { uid: {opt,at,name} } }

function addPollOption() {
  const wrapper = document.getElementById("pollOptionsWrapper");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "pollOption";
  input.placeholder = `選択肢${wrapper.querySelectorAll('.pollOption').length + 1}`;
  wrapper.appendChild(input);
}

function createPoll() {
  const user = auth.currentUser;
  if (!user) return alert("ログインしてください");
  const q = document.getElementById("pollQuestion").value.trim();
  if (!q) return alert("質問を入力してください");
  const optionEls = Array.from(document.querySelectorAll(".pollOption"));
  const labels = optionEls.map(el => el.value.trim()).filter(x => x);
  if (labels.length < 2) return alert("選択肢は2つ以上必要です");

  const opts = labels.map((label, idx) => ({ id: `o${idx+1}`, label, count: 0 }));
  const now = Date.now();
  const pollObj = { active: true, question: q, options: opts, startedAt: now, endsAt: now + POLL_DURATION_MS, creatorUid: user.uid, state: "voting" };

  // set active poll (overwrite)
  pollsRef.child("active").set(pollObj)
    .then(() => {
      closeModal('pollModal');
    })
    .catch(err => alert("アンケート作成失敗：" + err.message));
}

// リスナーは一度だけ登録
function ensurePollListener() {
  if (localPollListenerSet) return;
  pollsRef.child("active").on("value", snap => {
    const data = snap.val();
    if (!data || data.active !== true) {
      hidePollUI();
      localActivePoll = null;
      finalized = false;
      return;
    }
    localActivePoll = data;
    // If voting ended on server side, ensure finalize runs
    if (data.state === "showResults") {
      renderPollState(data);
    } else {
      showPollUI(data);
    }
  });
  localPollListenerSet = true;
}
ensurePollListener();

function showPollUI(poll) {
  const pollArea = document.getElementById("pollArea");
  const pollContent = document.getElementById("pollContent");
  pollArea.style.display = "block";

  // build UI
  pollContent.innerHTML = "";
  const qEl = document.createElement("div"); qEl.className = "poll-question"; qEl.textContent = poll.question;
  pollContent.appendChild(qEl);

  const optionsWrap = document.createElement("div"); optionsWrap.className = "poll-options";
  (poll.options || []).forEach(opt => {
    const optEl = document.createElement("div");
    optEl.className = "poll-option";
    optEl.dataset.optId = opt.id;
    optEl.innerHTML = `<div class="label">${escapeHtml(opt.label)}</div><div class="bar"><i style="width:${calcPercentWidth(opt.count, poll)}%"></i></div><div class="percent" style="margin-left:8px;min-width:44px;text-align:right">${formatPercent(opt.count, poll)}%</div>`;
    optEl.addEventListener("click", () => {
      if (!localActivePoll) return;
      if (Date.now() > localActivePoll.endsAt) return;
      voteOption(opt.id);
    });
    optionsWrap.appendChild(optEl);
  });
  pollContent.appendChild(optionsWrap);

  updatePollTimerDisplay(poll.endsAt);
  if (poll._timerInterval) clearInterval(poll._timerInterval);
  poll._timerInterval = setInterval(() => {
    updatePollTimerDisplay(poll.endsAt);
    if (Date.now() > poll.endsAt) {
      clearInterval(poll._timerInterval);
      // finalize from one client (only run finalize once)
      finalizePollIfNeeded();
    }
  }, 300);
}

function hidePollUI() {
  const pollArea = document.getElementById("pollArea");
  pollArea.style.display = "none";
  document.getElementById("pollContent").innerHTML = "";
  document.getElementById("pollTimer").textContent = "";
}

function calcPercentWidth(count, poll) {
  const total = (poll.options || []).reduce((s, o) => s + (o.count || 0), 0) || 0;
  if (total === 0) return 0;
  return Math.round((count / total) * 100);
}
function formatPercent(count, poll) {
  return calcPercentWidth(count, poll);
}

// vote
function voteOption(optId) {
  const user = auth.currentUser;
  if (!user) return alert("ログインしてください");
  const uid = user.uid;
  const votePath = pollsRef.child("active").child("votes").child(uid);
  votePath.set({ opt: optId, at: Date.now(), name: user.displayName || user.email })
    .then(() => { /* voted */ })
    .catch(err => console.warn("vote failed", err));
}

// finalize: count votes -> update options counts -> set state showResults -> schedule removal
function finalizePollIfNeeded() {
  if (!localActivePoll || finalized) return;
  finalized = true;
  pollsRef.child("active").child("votes").once("value").then(snap => {
    const votes = snap.val() || {};
    const counts = {};
    (localActivePoll.options || []).forEach(o => counts[o.id] = 0);
    Object.values(votes).forEach(v => {
      if (v && v.opt && counts[v.opt] !== undefined) counts[v.opt] += 1;
    });
    const newOptions = (localActivePoll.options || []).map(o => ({ id: o.id, label: o.label, count: counts[o.id] || 0 }));
    pollsRef.child("active").update({ options: newOptions, state: "showResults", showResultsAt: Date.now() })
      .then(() => {
        // 保持期間後に削除して全員を元の画面へ戻す
        setTimeout(() => {
          pollsRef.child("active").remove().catch(()=>{/*ignore*/});
          finalized = false;
        }, 30000); // 結果表示を30秒保持
      }).catch(err => {
        console.warn("finalize update failed", err);
        finalized = false;
      });
  }).catch(err => {
    console.warn("count votes failed", err);
    finalized = false;
  });
}

// listen active poll changes to render results when published
pollsRef.child("active").on("value", snap => {
  const data = snap.val();
  if (!data || data.active !== true) {
    hidePollUI();
    localActivePoll = null;
    finalized = false;
    return;
  }
  localActivePoll = data;
  renderPollState(data);
});

function renderPollState(poll) {
  const pollContent = document.getElementById("pollContent");
  pollContent.innerHTML = "";
  const qEl = document.createElement("div"); qEl.className = "poll-question"; qEl.textContent = poll.question;
  pollContent.appendChild(qEl);

  const optionsWrap = document.createElement("div"); optionsWrap.className = "poll-options";
  const total = (poll.options || []).reduce((s, o) => s + (o.count || 0), 0);
  (poll.options || []).forEach(o => {
    const optEl = document.createElement("div");
    optEl.className = "poll-option";
    if (poll.state === "showResults") optEl.classList.add("disabled");
    const percent = total === 0 ? 0 : Math.round((o.count || 0) / total * 100);
    optEl.innerHTML = `<div class="label">${escapeHtml(o.label)}</div><div class="bar"><i style="width:${percent}%"></i></div><div class="percent" style="margin-left:8px;min-width:44px;text-align:right">${percent}%</div>`;
    if (poll.state !== "showResults") {
      optEl.addEventListener("click", () => { voteOption(o.id); });
    }
    optionsWrap.appendChild(optEl);
  });
  pollContent.appendChild(optionsWrap);

  const timerEl = document.getElementById("pollTimer");
  if (poll.state === "showResults") {
    timerEl.textContent = "集計結果";
  } else {
    updatePollTimerDisplay(poll.endsAt);
    if (poll._timerInterval) clearInterval(poll._timerInterval);
    poll._timerInterval = setInterval(() => {
      updatePollTimerDisplay(poll.endsAt);
      if (Date.now() > poll.endsAt) clearInterval(poll._timerInterval);
    }, 300);
  }
  document.getElementById("pollArea").style.display = "block";
}

function updatePollTimerDisplay(endsAt) {
  const now = Date.now();
  const remain = Math.max(0, endsAt - now);
  const s = Math.ceil(remain / 1000);
  document.getElementById("pollTimer").textContent = `残り ${s} 秒`;
}

// -------------------- Apps Script 経由のプロフィール画像アップロード --------------------
document.getElementById("uploadForm").addEventListener("submit", function(e) {
  e.preventDefault();
  const file = document.getElementById("imageFile").files[0];
  if (!file) return alert("画像を選択してください");

  // ここをデプロイ済み Apps Script の URL に置き換えてください
  const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

  // 例: FormData を使って送る (Apps Script 側で doPost(e) にて処理する想定)
  const form = new FormData();
  form.append("file", file);

  fetch(GAS_URL, {
    method: "POST",
    body: form
  })
  .then(res => res.text())
  .then(url => {
    const user = auth.currentUser;
    if (!user) return alert("ログインしてください");
    user.updateProfile({ photoURL: url })
      .then(() => {
        alert("プロフィール画像を更新しました");
        document.getElementById("avatar").src = url;
        closeModal('mypageModal');
      })
      .catch(err => alert("更新失敗：" + err.message));
  })
  .catch(err => alert("アップロード失敗：" + err.message));
});

// -------------------- ユーティリティ --------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// -------------------- 初期リスナー等セットアップ --------------------
function setupGlobalListeners() {
  // arrivalsRef listener はファイルロード時に登録済み (上部)
  // polls listener と comments 初期化を先に行っておく
  arrivalsRef.on("child_added", snap => {
    const data = snap.val();
    if (!data || data.type !== "arrival") return;
    showArrivalBanner(data.name);
    snap.ref.remove().catch(()=>{/* ignore */});
  });

  ensurePollListener(); // polls の監視を開始
  initComments();       // コメントの初期読み込みと child_added 監視を開始
}

// ensurePollListener のエクスポート化（定義上で呼ばれる）
function ensurePollListener() {
  if (localPollListenerSet) return;
  pollsRef.child("active").on("value", snap => {
    const data = snap.val();
    if (!data || data.active !== true) {
      hidePollUI();
      localActivePoll = null;
      finalized = false;
      return;
    }
    localActivePoll = data;
    renderPollState(data);
  });
  localPollListenerSet = true;
}
