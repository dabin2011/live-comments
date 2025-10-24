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

function sendComment() {
  const input = document.getElementById("commentInput");
  const text = input.value;
  if (text.trim() !== "") {
    db.ref("comments").push({ text });
    input.value = "";
  }
}

db.ref("comments").on("child_added", snapshot => {
  const comment = snapshot.val();
  const div = document.createElement("div");
  div.className = "comment";
  div.textContent = comment.text;
  document.getElementById("comments").appendChild(div);
});
