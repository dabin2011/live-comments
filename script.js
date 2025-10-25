// ==============================
// Firebase 設定（必ず置き換え）
// ==============================
const firebaseConfig = {
  apiKey: "AIzaSyD1AK05uuGBw2U4Ne5LbKzzjzCqnln60mg",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://shige-live-default-rtdb.firebaseio.com/",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Apps Script のURL（プロフィール画像アップロード用）
const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

// ==============================
// Firebase 初期化
// ==============================
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

// ==============================
// Realtime Database Refs
// ==============================
const commentsRef = db.ref('comments');
const pollsRef = db.ref('polls');
const arrivalsRef = db.ref('arrivals');
const presenceRefRoot = db.ref('presence');
const gamesRef = db.ref('games');
const usersRef = db.ref('users');

// ==============================
// ユーティリティ
// ==============================
function el(id){ return document.getElementById(id); }
function now(){ return Date.now(); }
function escapeHtml(s){ return s ? s.replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])) : ""; }

// ==============================
// 駒画像マッピング
// ==============================
const pieceImages = {
  'p': 'pawn.png','P': 'pawn.png',
  'l': 'lance.png','L': 'lance.png',
  'n': 'knight.png','N': 'knight.png',
  's': 'silver.png','S': 'silver.png',
  'g': 'gold.png','G': 'gold.png',
  'k': 'king.png','K': 'king.png',
  'r': 'rook.png','R': 'rook.png',
  'b': 'bishop.png','B': 'bishop.png',
  '+p': 'tokin.png',
  '+s': 'promoted_silver.png',
  '+n': 'promoted_knight.png',
  '+l': 'promoted_lance.png',
  '+r': 'dragon.png',
  '+b': 'horse.png'
};

// ==============================
// 認証処理
// ==============================
auth.onAuthStateChanged(async user => {
  if (user) {
    el('loginBtn').style.display='none';
    el('mypageBtn').style.display='inline-block';
    el('logoutBtn').style.display='inline-block';
    el('username').textContent = user.displayName || user.email;
    el('avatar').src = user.photoURL || '';

    // ポイント表示
    const snap = await usersRef.child(user.uid).child('points').once('value');
    el('myPoints').textContent = snap.val() || 0;

    arrivalsRef.push({ type:'arrival', name:user.displayName||user.email, timestamp: now() });
  } else {
    el('loginBtn').style.display='inline-block';
    el('mypageBtn').style.display='none';
    el('logoutBtn').style.display='none';
    el('username').textContent='';
    el('avatar').src='';
    el('myPoints').textContent='';
  }
});

el('signinBtn').onclick = async ()=>{
  try {
    await auth.signInWithEmailAndPassword(el('email').value, el('password').value);
    closeModal('loginModal');
  } catch(e){ el('loginError').textContent = e.message; }
};
el('signupBtn').onclick = async ()=>{
  try {
    await auth.createUserWithEmailAndPassword(el('email').value, el('password').value);
    closeModal('loginModal');
  } catch(e){ el('loginError').textContent = e.message; }
};
el('logoutBtn').onclick = ()=>auth.signOut();

// ==============================
// コメント機能
// ==============================
function renderComment(d){
  const div = document.createElement('div');
  div.className='comment';
  div.innerHTML = `<img class="avatar" src="${d.photo||'https://via.placeholder.com/40'}">
                   <div class="meta"><strong>${escapeHtml(d.name)}</strong><div>${escapeHtml(d.text)}</div></div>`;
  el('comments').prepend(div);
}
commentsRef.limitToLast(50).on('child_added', snap=>renderComment(snap.val()));
el('sendBtn').onclick = ()=>{
  if (!auth.currentUser) return alert('ログインしてください');
  const text = el('commentInput').value.trim();
  if (!text) return;
  commentsRef.push({ uid:auth.currentUser.uid, name:auth.currentUser.displayName||auth.currentUser.email, photo:auth.currentUser.photoURL, text, ts:now() });
  el('commentInput').value='';
};

// ==============================
// アンケート機能
// ==============================
function renderPoll(poll){
  const pollContent = el('pollContent');
  pollContent.innerHTML = `<div class="poll-question">${escapeHtml(poll.question)}</div>`;
  poll.options.forEach(o=>{
    const div = document.createElement('div');
    div.className='poll-option';
    div.textContent = `${o.label} (${o.count})`;
    div.onclick=()=>voteOption(o.id);
    pollContent.appendChild(div);
  });
}
function voteOption(optId){
  if (!auth.currentUser) return alert('ログインしてください');
  pollsRef.child('active/options').once('value', snap=>{
    const opts = snap.val();
    for (let k in opts){ if (opts[k].id===optId) opts[k].count++; }
    pollsRef.child('active/options').set(opts);
  });
}
el('createPollBtn').onclick = ()=>{
  const q = el('pollQuestion').value;
  const opts = Array.from(document.querySelectorAll('.pollOptionInput')).map(i=>({id:Math.random().toString(36).slice(2),label:i.value,count:0}));
  pollsRef.child('active').set({question:q,options:opts});
  closeModal('pollModal');
};
pollsRef.child('active').on('value', snap=>{
  const poll = snap.val();
  if (poll) { el('pollArea').style.display='block'; renderPoll(poll); }
  else el('pollArea').style.display='none';
});

// ==============================
// 将棋ゲーム機能
// ==============================
function initialShogiBoard(){
  return [
    ['l','n','s','g','k','g','s','n','l'],
    ['.','r','.','.','.','.','.','b','.'],
    ['p','p','p','p','p','p','p','p','p'],
    ['.','.','.','.','.','.','.','.','.'],
    ['.','.','.','.','.','.','.','.','.'],
    ['.','.','.','.','.','.','.','.','.'],
    ['P','P','P','P','P','P','P','P','P'],
    ['.','B','.','.','.','.','.','R','.'],
    ['L','N','S','G','K','G','S','N','L']
  ];
}
function renderShogiBoard(board){
  const container = el('shogiContainer');
  container.innerHTML='';
  const grid = document.createElement('div');
  grid.className='grid';
  for (let r=0;r<9;r++){
    for (let c=0;c<9;c++){
      const sq = document.createElement('div');
      sq.className='grid-cell';
      const piece = board[r][c];
      if (piece!=='.'){
        const img = document.createElement('img');
        const filename = pieceImages[piece] || 'pawn.png';
        img.src = `assets/koma/${filename}`;
        if (piece===piece.toLowerCase()) img.classList.add('koma-gote');
        sq.appendChild(img);
      }
      grid.appendChild(sq);
    }
  }
  container.appendChild(grid);
}
el('startGameBtn').onclick = ()=>{
  const gid = gamesRef.push().key;
  gamesRef.child(gid).set({board:initialShogiBoard()});
  closeModal('gameModal');
};
gamesRef.limitToLast(1).on('child_added', snap=>{
  const g = snap.val();
  renderShogiBoard(g.board);
});

// ==============================
// プロフィール画像アップロード (Apps Script 経由)
// ==============================
el('uploadProfileBtn').onclick = async ()=>{
  if (!auth.currentUser) return alert('ログインしてください');
  const file = el('profileImageFile').files[0];
  if (!file) return alert('画像を選択してください');
  const form = new FormData();
  form.append('uid', auth.currentUser.uid);
  form.append
