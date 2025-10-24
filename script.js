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

let firstCommentTime = null;
const THREE_HOURS = 3 * 60 * 60 * 1000;

// 認証状態の監視
auth.onAuthStateChanged(user => {
  document.getElementById("form").style.display = user ? "block" : "none";
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

// コメント送信
function sendComment() {
  const user = auth.currentUser;
  const text = document.getElementById("commentInput").value.trim();
  if (user && text) {
    const timestamp = Date.now();
    db.ref("comments").push({
      name: user.email,
      text,
      timestamp
    });
    document.getElementById("commentInput").value = "";
  }
}

// コメント表示（3時間以内のみ）
db.ref("comments").on("child_added", snapshot => {
  const { name, text, timestamp } = snapshot.val();
  const now = Date.now();

  if (!firstCommentTime || timestamp < firstCommentTime) {
    firstCommentTime = timestamp;
  }

  if (timestamp - firstCommentTime <= THREE_HOURS) {
    const elapsedMin = Math.floor((timestamp - firstCommentTime) / 60000);
    const elapsedStr = elapsedMin > 0 ? `${elapsedMin}分後` : "開始直後";

    const div = document.createElement("div");
    div.className = "comment";
    div.innerHTML = `<strong>${name}</strong>: ${text} <span>（${elapsedStr}）</span>`;
    document.getElementById("comments").appendChild(div);
  }
});

// 古いコメントを削除（30分ごとに実行）
function cleanOldComments() {
  const now = Date.now();
  db.ref("comments").once("value", snapshot => {
    snapshot.forEach(child => {
      const data = child.val();
      if (now - data.timestamp > THREE_HOURS) {
        db.ref("comments").child(child.key).remove();
      }
    });
  });
}
setInterval(cleanOldComments, 30 * 60 * 1000);
