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

// 認証状態の監視
auth.onAuthStateChanged(user => {
  if (user) {
    document.getElementById("form").style.display = "block";
  } else {
    document.getElementById("form").style.display = "none";
  }
});

// 新規登録
function signUp() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  auth.createUserWithEmailAndPassword(email, password)
    .then(() => alert("登録成功"))
    .catch(error => alert(error.message));
}

// ログイン
function signIn() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
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

// コメント表示
db.ref("comments").on("child_added", snapshot => {
  const { name, text, timestamp } = snapshot.val();

  if (!firstCommentTime) {
    firstCommentTime = timestamp;
  }

  const elapsedMs = timestamp - firstCommentTime;
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedStr = elapsedMin > 0 ? `${elapsedMin}分後` : "開始直後";

  const div = document.createElement("div");
  div.className = "comment";
  div.innerHTML = `<strong>${name}</strong>: ${text} <span>（${elapsedStr}）</span>`;
  document.getElementById("comments").appendChild(div);
});
