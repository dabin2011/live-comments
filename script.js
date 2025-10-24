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

// Realtime DB と Auth の参照
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref("comments");

// 表示制御・定数
const THREE_HOURS = 3 * 60 * 60 * 1000;
let firstCommentTime = null;

// ---------- モーダル制御 ----------
function openModal(id) {
  document.getElementById(id).style.display = "block";
}
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}
window.onclick = function(event) {
  const modals = document.querySelectorAll(".modal");
  modals.forEach(modal => {
    if (event.target === modal) modal.style.display = "none";
  });
};

// ---------- 認証状態監視（ボタン切替・表示更新） ----------
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
    document.getElementById("avatar").src = user.photoURL || "https://via.placeholder.com/100";
  } else {
    form.style.display = "none";
    loginBtn.style.display = "inline-block";
    mypageBtn.style.display = "none";
    logoutBtn.style.display = "none";
  }
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
    // 必要ならUIをリセット
    document.getElementById("avatar").src = "";
    document.getElementById("username").textContent = "";
  });
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

// ---------- 時刻フォーマット（時:分 24時間） ----------
function formatTimeOnly(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ---------- コメント表示：初期取得と child_added ----------
function initComments() {
  // まず全件を一度読み出して最初のタイムスタンプを決める
  commentsRef.once("value", snapshot => {
    let earliest = null;
    snapshot.forEach(child => {
      const data = child.val();
      if (!earliest || data.timestamp < earliest) earliest = data.timestamp;
    });
    firstCommentTime = earliest || Date.now();

    // 以降の追加を監視（表示は新しいものが下に来る）
    commentsRef.on("child_added", snap => {
      const data = snap.val();
      if (!data || !data.timestamp) return;
      if (data.timestamp - firstCommentTime > THREE_HOURS) return;

      appendCommentToBottom(data);
    });
  });
}
initComments();

// ---------- コメント要素を下に追加し自動スクロール ----------
function appendCommentToBottom(data) {
  const commentsEl = document.getElementById("comments");
  const container = document.getElementById("commentsContainer");

  const div = document.createElement("div");
  div.className = "comment";

  const avatarUrl = data.photo || "https://via.placeholder.com/40";
  div.innerHTML = `
    <img src="${escapeHtml(avatarUrl)}" alt="avatar">
    <div class="meta">
      <div><strong>${escapeHtml(data.name)}</strong></div>
      <div>${escapeHtml(data.text)}</div>
    </div>
    <div style="margin-left:auto;"><small>${formatTimeOnly(data.timestamp)}</small></div>
  `;

  commentsEl.appendChild(div);

  // アニメーション完了後にスクロールする（少し待つことでアニメーションが映える）
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ---------- 簡易エスケープ ----------
function escapeHtml(str) {
  if (!str && str !== "") return "";
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
