const firebaseConfig = {
  apiKey: "AIzaSyD1AK05uuGBw2U4Ne5LbKzzjzCqnln60mg",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

const commentsRef = db.ref("comments");
const THREE_HOURS = 3 * 60 * 60 * 1000;
let firstCommentTime = null;
let loaded = false;

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

// 新規登録
function signUp() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email.includes("@")) return alert("正しいメールアドレスを入力してください");
  auth.createUserWithEmailAndPassword(email, password)
    .then(() => alert("登録成功"))
    .catch(error => alert(error.message));
}

// ログイン
function signIn() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email.includes("@")) return alert("正しいメールアドレスを入力してください");
  auth.signInWithEmailAndPassword(email, password)
    .then(() => alert("ログイン成功"))
    .catch(error => alert(error.message));
}

// ログアウト
function signOut() {
  auth.signOut().then(() => alert("ログアウトしました"));
}

// プロフィール更新
function updateProfile() {
  const user = auth.currentUser;
  const newName = document.getElementById("newName").value.trim();
  const newPhoto = document.getElementById("newPhoto").value.trim();

  user.updateProfile({
    displayName: newName || user.displayName,
    photoURL: newPhoto || user.photoURL
  }).then(() => {
    alert("プロフィールを更新しました");
    location.reload();
  }).catch(error => {
    alert("更新エラー：" + error.message);
  });
}

// コメント送信
function sendComment() {
  const user = auth.currentUser;
  const text = document.getElementById("commentInput").value.trim();
  if (!user || !text) return;

  db.ref("comments").push({
    uid: user.uid,
    name: user.displayName || user.email,
    photo: user.photoURL || "",
    text,
    timestamp: Date.now()
  }).then(() => {
    console.log("保存成功");
  }).catch(error => {
    alert("保存エラー：" + error.message);
  });
}

// 最初のコメント時刻を取得
commentsRef.once("value", snapshot => {
  let earliest = null;
  snapshot.forEach(child => {
    const data = child.val();
    if (!earliest || data.timestamp < earliest) {
      earliest = data.timestamp;
    }
  });
  firstCommentTime = earliest || Date.now();
  loaded = true;
});

// コメント表示（3時間以内のみ）
commentsRef.on("child_added", snapshot => {
  const { name, text, timestamp, photo } = snapshot.val();
  if (!loaded) return;

  if (timestamp - firstCommentTime <= THREE_HOURS) {
    const elapsedMin = Math.floor((timestamp - firstCommentTime) / 60000);
    const elapsedStr = elapsedMin > 0 ? `${elapsedMin}分後` : "開始直後";

    const div = document.createElement("div");
    div.className = "comment";
    div.innerHTML = `
      <img src="${photo || 'https://via.placeholder.com/40'}" width="40" height="40" style="vertical-align:middle;border-radius:50%;">
      <strong>${name}</strong>: ${text} <span>（${elapsedStr}）</span>
    `;
    document.getElementById("comments").appendChild(div);
  } else {
    commentsRef.child(snapshot.key).remove();
  }
});

// 古いコメントを定期的に削除（30分ごと）
function cleanOldComments() {
  const now = Date.now();
  commentsRef.once("value", snapshot => {
    snapshot.forEach(child => {
      const data = child.val();
      if (now - data.timestamp > THREE_HOURS) {
        commentsRef.child(child.key).remove();
      }
    });
  });
}
setInterval(cleanOldComments, 30 * 60 * 1000);
