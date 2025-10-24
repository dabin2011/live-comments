const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let firstCommentTime = null;

function sendComment() {
  const name = document.getElementById("nameInput").value.trim();
  const text = document.getElementById("commentInput").value.trim();
  if (name && text) {
    const timestamp = Date.now();
    db.ref("comments").push({ name, text, timestamp });
    document.getElementById("commentInput").value = "";
  }
}

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
