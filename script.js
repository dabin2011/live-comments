const firebaseConfig = {
  apiKey: "AIzaSyD1AK05uuGBw2U4Ne5LbKzzjzCqnln60mg",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://shige-live-default-rtdb.firebaseio.com/", // ← ここ重要！
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

// 認証状態の監視
auth.onAuthStateChanged(user => {
  const form = document.getElementById("form");
  const mypage = document.getElementById("mypage");

  if (user) {
    form.style.display = "block";
    mypage.style.display = "block";
    document.getElementById("username").textContent = user.displayName || user.email;
    document.getElementById("avatar").src = user.photoURL || "https://via.placeholder.com/100";
  } else {
    form.style.display = "none";
    mypage.style.display = "none";
  }
});

// 新規登録・ログイン・ログアウト
function signUp() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  auth.createUserWithEmailAndPassword(email, password)
    .then(() => alert("登録成功"))
    .catch(error => alert(error.message));
}

function signIn() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  auth.signInWithEmailAndPassword(email, password)
    .then(() => alert("ログイン成功"))
    .catch(error => alert(error.message));
}

function signOut() {
  auth.signOut().then(() => alert("ログアウトしました"));
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
    fetch("https://script.google.com/macros/s/AKfycbzw3HSk2HojzCsRX7HHljykN1sOK9IWhOJHy3EznbMLNg49uQfajx3gwNzsq1_qRk_G/exec", {
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
