<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>コメント・アンケート・通話リクエスト（修正版）</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="authButtons">
    <button id="loginBtn">テストログイン</button>
    <button id="logoutBtn" style="display:none">ログアウト</button>
    <button id="mypageBtn" style="display:none">マイページ</button>
  </div>

  <h2>コメント欄（3時間以内）</h2>

  <div id="commentsContainer">
    <div id="arrivalBanner" aria-live="polite"></div>

    <div id="pollArea" class="poll-area" style="display:none;">
      <div id="pollContent" class="poll-content"></div>
      <div id="pollTimer" class="poll-timer" style="text-align:right;color:#666;margin-top:6px;"></div>
    </div>

    <div id="comments" aria-live="polite"></div>

    <div id="form" style="display:flex;gap:8px;margin-top:12px;align-items:center;">
      <input type="text" id="commentInput" placeholder="コメントを入力" />
      <button id="pollBtn">アンケート作成</button>
      <button id="sendBtn">送信</button>
    </div>
  </div>

  <!-- Poll modal -->
  <div id="pollModal" class="modal" aria-hidden="true">
    <div class="modal-content">
      <button class="close" data-close="pollModal">&times;</button>
      <h2>アンケートを作成</h2>
      <input type="text" id="pollQuestion" placeholder="質問を入力" />
      <div id="pollOptionsWrapper" style="margin-top:8px;">
        <input type="text" class="pollOptionInput" placeholder="選択肢1" />
        <input type="text" class="pollOptionInput" placeholder="選択肢2" />
      </div>
      <div style="margin-top:8px;">
        <button id="addPollOptionBtn">選択肢を追加</button>
        <button id="createPollBtn">作成して開始（30秒）</button>
      </div>
    </div>
  </div>

  <!-- simple call popups (kept minimal) -->
  <div id="callRequestPopup" class="modal" aria-hidden="true">
    <div class="modal-content small">
      <button class="close" data-close="callRequestPopup">&times;</button>
      <div id="callRequestContent"></div>
      <div style="margin-top:10px;text-align:right;">
        <button id="callCancelBtn">キャンセル</button>
        <button id="callSendBtn">通話リクエスト送信</button>
      </div>
    </div>
  </div>

  <div id="incomingCallPopup" class="modal" aria-hidden="true">
    <div class="modal-content small">
      <button class="close" data-close="incomingCallPopup">&times;</button>
      <div id="incomingCallContent"></div>
      <div style="margin-top:10px;text-align:right;">
        <button id="rejectCallBtn">拒否</button>
        <button id="acceptCallBtn">応答</button>
      </div>
    </div>
  </div>

  <div id="callNotifyPopup" class="modal" aria-hidden="true">
    <div class="modal-content small">
      <button class="close" data-close="callNotifyPopup">&times;</button>
      <div id="callNotifyContent"></div>
      <div style="margin-top:10px;text-align:right;">
        <button id="callNotifyClose">閉じる</button>
      </div>
    </div>
  </div>

  <!-- Firebase SDKs -->
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>

  <script src="script.js"></script>
</body>
</html>
