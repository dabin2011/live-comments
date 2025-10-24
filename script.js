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
const THREE_HOURS = 3 * 60 * 60 * 1000;
let firstCommentTime = null;

// モーダル開閉処理
function openModal(id) {
  document.getElementById(id).style.display = "block";
}
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}
window.onclick = function(event) {
  const modals = document.querySelectorAll(".modal");
  modals.forEach(modal => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  });
};

// 認証状態の監視
auth.onAuthStateChanged(user => {
  const form = document.getElementById("form");
  if (user) {
    form.style.display = "block";
    document.getElementById("username").textContent = user.displayName || user.email;
    document.getElementById("avatar").src = user.photoURL || "https://via.placeholder.com/100";
  } else {
    form.style.display = "none";
  }
});

// 新規登録
function signUp() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  auth.createUserWithEmailAndPassword(email, password)
    .then(() => alert("登録成功"))
    .catch(error => alert(error.message));
}

// ログイン
function signIn() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  auth.signInWithEmailAndPassword(email, password)
    .then(() => alert("ログイン成功"))
    .catch(error => alert(error.message));
}

// ログアウト
function signOut() {
  auth.signOut().then(() => alert("ログアウトしました"));
}

// ユーザー名更新
function updateProfile() {
  const user = auth.currentUser;
  const newName = document.getElementById("newName").value.trim();
  if (!user || !newName) return alert("名前を入力してください");

  user.updateProfile({ displayName: newName })
    .then(() => {
      alert("ユーザー名を更新しました");
      document.getElementById("username").textContent = newName;
    })
    .catch(error => alert("更新失敗：" + error.message));
}

// コメント送信
function sendComment() {
  const user = auth.currentUser;
  const text = document.getElementById("commentInput").value.trim();
  if (!user || !text) return;

  commentsRef.push({
    uid: user.uid,
    name: user.displayName || user.email,
    photo: user.photoURL || "",
    text,
    timestamp: Date.now()
  }).then(() => {
    document.getElementById("commentInput").value = "";
  }).catch(error => {
    alert("保存失敗：" + error.message);
  });
}

// コメント表示処理
commentsRef.once("value", snapshot => {
  let earliest = null;
  snapshot.forEach(child => {
    const data = child.val();
    if (!earliest || data.timestamp < earliest) {
      earliest = data.timestamp;
    }
  });
  firstCommentTime = earliest || Date.now();

  commentsRef.on("child_added", snap => {
    const { name, text, timestamp, photo } = snap.val();
    if (timestamp - firstCommentTime <= THREE_HOURS) {
      const div = document.createElement("div");
      div.className = "comment";
      div.innerHTML = `
        <img src="${photo || 'https://via.placeholder.com/40'}" width="40" height="40" style="vertical-align:middle;border-radius:50%;">
        <strong>${name}</strong>: ${text}
      `;
      document.getElementById("comments").appendChild(div);
    }
  });
});

// プロフィール画像アップロード（GAS経由）
document.getElementById("uploadForm").addEventListener("submit", function(e) {
  e.preventDefault();
  const file = document.getElementById("imageFile").files[0];
  if (!file) return alert("画像を選択してください");

  const reader = new FileReader();
  reader.onload = function() {
    fetch("https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec", {
      method: "POST",
      body: reader.result
    })
    .then(res => res.text())
    .then(url => {
      auth.currentUser.updateProfile({ photoURL: url })
        .then(() => {
          alert("プロフィール画像を更新しました");
          document.getElementById("avatar").src = url;
        })
        .catch(err => alert("更新失敗：" + err.message));
    });
  };
  reader.readAsArrayBuffer(file);
});
