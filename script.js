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

const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref("comments");
const arrivalsRef = db.ref("arrivals"); // arrival イベント用ノード
const THREE_HOURS = 3 * 60 * 60 * 1000;
let firstCommentTime = null;
let _prevAuthUser = null;
const ARRIVAL_BANNER_DURATION = 5000;

// ---------- モーダル制御 ----------
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
window.onclick = function(event) {
  const modals = document.querySelectorAll(".modal");
  modals.forEach(modal => {
    if (event.target === modal) modal.style.display = "none";
  });
};

// ---------- Arrival banner ----------
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
    setTimeout(() => {
      if (!banner.classList.contains("show")) banner.style.display = "none";
    }, 300);
  }, ARRIVAL_BANNER_DURATION);
}

// ---------- 認証状態の監視（ボタン切替・到着バナー表示 & 全体通知） ----------
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

    // 未ログイン -> ログイン への遷移を検出したら arrivals に到着イベントを書き込む
    if (!_prevAuthUser) {
      const name = user.displayName || user.email || "ゲスト";
      arrivalsRef.push({
        type: "arrival",
        name,
        timestamp: Date.now()
      }).catch(err => console.warn("arrival push failed:", err));
      // クライアント自身にもすぐ表示（他クライアントは child_added で受け取る）
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

// ---------- arrivals ノードを全クライアントで監視（全員に表示） ----------
arrivalsRef.on("child_added", snap => {
  const data = snap.val();
  if (!data || data.type !== "arrival") return;
  showArrivalBanner(data.name);
  // イベントを一度表示したら削除して過去イベントが新規接続時に再生されないようにする
  snap.ref.remove().catch(()=>{/* ignore */});
});

// ---------- 認証操作 ----------
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
  auth.signOut().then(() => {
    alert("ログアウトしました");
  }).catch(err => alert(err.message));
}

// ---------- ユーザー名更新 ----------
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

// ---------- コメント送信 ----------
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
  }).then(() => {
    document.getElementById("commentInput").value = "";
  }).catch(err => alert("保存失敗：" + err.message));
}

// ---------- 時刻フォーマット（時:分） ----------
function formatTimeOnly(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ---------- コメント表示：初期取得と child_added ----------
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

// ---------- 新しいコメントを先頭に挿入し、既存コメントを下へ押し出す動作 ----------
function prependCommentWithPushAnimation(data) {
  const commentsEl = document.getElementById("comments");

  // 既存コメントを上に引き上げる準備クラスを付与
  const existing = Array.from(commentsEl.children);
  existing.forEach(el => el.classList.add("_prep-shift"));

  // 強制再描画して transition の起点を作る
  commentsEl.offsetHeight; // no-op to force reflow

  // 新しいコメント要素（.new で初期状態）
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

  // 先頭に挿入
  if (commentsEl.firstChild) commentsEl.insertBefore(div, commentsEl.firstChild);
  else commentsEl.appendChild(div);

  // 次フレームでクラスを外してアニメーション開始
  requestAnimationFrame(() => {
    div.classList.remove("new");              // フェードイン＆位置戻し
    existing.forEach(el => el.classList.remove("_prep-shift")); // 既存要素は下へ移動
  });

  // クリーンアップ（念のためタイムアウト）
  setTimeout(() => {
    div.classList.remove("new");
    existing.forEach(el => el.classList.remove("_prep-shift"));
  }, 600);
}

// ---------- 簡易エスケープ ----------
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------- プロフィール画像アップロード（GAS経由） ----------
document.getElementById("uploadForm").addEventListener("submit", function(e) {
  e.preventDefault();
  const file = document.getElementById("imageFile").files[0];
  if (!file) return alert("画像を選択してください");

  const reader = new FileReader();
  reader.onload = function() {
    // YOUR_GAS_SCRIPT_URL をデプロイ済みGASのURLに置き換えてください
    fetch("https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec", {
      method: "POST",
      body: reader.result
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
  };
  reader.readAsArrayBuffer(file);
});
