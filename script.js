// Firebase 初期化
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
const auth = firebase.auth();
const db = firebase.database();
const gamesRef = db.ref('games');
const commentsRef = db.ref('comments');
const pollsRef = db.ref('polls');

// ユーティリティ
function el(id){ return document.getElementById(id); }
function now(){ return Date.now(); }
function escapeHtml(s){ return s.replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }

// ログイン状態監視
auth.onAuthStateChanged(user => {
  if (user) {
    el('loginArea').style.display = 'none';
    el('userArea').style.display = 'block';
    el('username').textContent = user.displayName || user.email;
  } else {
    el('loginArea').style.display = 'block';
    el('userArea').style.display = 'none';
  }
});

// コメント機能
el('sendCommentBtn').onclick = () => {
  const text = el('commentInput').value.trim();
  if (!text || !auth.currentUser) return;
  commentsRef.push({
    uid: auth.currentUser.uid,
    name: auth.currentUser.displayName || auth.currentUser.email,
    text,
    ts: now()
  });
  el('commentInput').value = '';
};

commentsRef.limitToLast(50).on('child_added', snap => {
  const d = snap.val();
  const div = document.createElement('div');
  div.className = 'comment';
  div.innerHTML = `<strong>${escapeHtml(d.name)}</strong>: ${escapeHtml(d.text)}`;
  el('commentList').prepend(div);
});

// アンケート機能
el('createPollBtn').onclick = () => {
  const question = el('pollQuestion').value;
  const options = Array.from(document.querySelectorAll('.pollOption')).map(i => ({
    id: Math.random().toString(36).slice(2),
    label: i.value,
    count: 0
  }));
  pollsRef.child('active').set({ question, options });
};

pollsRef.child('active').on('value', snap => {
  const poll = snap.val();
  const area = el('pollArea');
  area.innerHTML = `<h3>${escapeHtml(poll.question)}</h3>`;
  poll.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.textContent = `${opt.label} (${opt.count})`;
    btn.onclick = () => {
      pollsRef.child('active/options').once('value', s => {
        const opts = s.val();
        for (let k in opts) {
          if (opts[k].id === opt.id) opts[k].count++;
        }
        pollsRef.child('active/options').set(opts);
      });
    };
    area.appendChild(btn);
  });
});

// 将棋ゲーム機能
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

let selectedPiece = null;
let currentGameId = null;
let gameLocalState = null;

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

function renderGameState(game){
  if (!game || game.type !== 'shogi') return;
  const shogi = game.shogi || {};
  renderShogiBoard(game.id, shogi);
  const info = el('gameInfo');
  if (auth?.currentUser && info) {
    info.textContent = (shogi.turn === auth.currentUser.uid) ? "あなたの番です" : "相手の番です";
  }
}

function clearHighlights(){
  document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
}

function calcMoves(piece, r, c, board){
  const moves = [];
  if (piece.toLowerCase() === 'p') {
    const dir = (piece === 'P') ? -1 : 1;
    const nr = r + dir;
    if (nr >= 0 && nr < 9 && board[nr][c] === '.') {
      moves.push({ r: nr, c });
    }
  }
  return moves;
}

function renderShogiBoard(gid, shogiState){
  const container = el('shogiContainer');
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'grid';
  const board = shogiState.board || initialShogiBoard();

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const sq = document.createElement('div');
      sq.className = 'grid-cell';
      sq.dataset.r = r;
      sq.dataset.c = c;

      const piece = board[r][c];
      if (piece !== '.') {
        const img = document.createElement('img');
        img.src = `assets/koma/${pieceImages[piece] || 'pawn.png'}`;
        img.alt = piece;
        if (piece === piece.toLowerCase()) img.classList.add('koma-gote');
        img.onclick = () => {
          clearHighlights();
          selectedPiece = { r, c };
          const moves = calcMoves(piece, r, c, board);
          moves.forEach(m => {
            const target = grid.querySelector(`.grid-cell[data-r="${m.r}"][data-c="${m.c}"]`);
            if (target) target.classList.add('highlight');
          });
        };
        sq.appendChild(img);
      }

      sq.onclick = () => {
        if (selectedPiece) {
          makeShogiMove(gid, auth.currentUser.uid, selectedPiece, { r, c });
          selectedPiece = null;
          clearHighlights();
        }
      };

      grid.appendChild(sq);
    }
  }

  container.appendChild(grid);
}

function makeShogiMove(gid, uid, from, to){
  const ref = gamesRef.child(gid).child('shogi');
  ref.transaction(current => {
    if (!current) return;
    const board = current.board || initialShogiBoard();
    const piece = board[from.r][from.c];
    if (!piece || piece === '.') return;

    const target = board[to.r][to.c];
    if (target === 'k' || target === 'K') {
      alert(uid === auth.currentUser.uid ? "あなたの勝利" : "あなたの負け");
    }

    board[to.r][to.c] = piece;
    board[from.r][from.c] = '.';
    current.board = board;
    current.turn = uid === auth.currentUser.uid ? "opponent" : auth.currentUser.uid;
    return current;
  });
}

el('startGameBtn').onclick = () => {
  const gid = gamesRef.push().key;
  gamesRef.child(gid).set({
    id: gid,
    type: 'shogi',
    status: 'running',
    hostUid: auth.currentUser.uid,
    shogi: { board: initialShogiBoard(), turn: auth.currentUser.uid }
  });
  currentGameId = gid;
  gamesRef.child(gid).on('value', snap => {
    const g = snap.val();
    if (g) {
      gameLocalState = g;
      renderGameState(g);
    }
 
