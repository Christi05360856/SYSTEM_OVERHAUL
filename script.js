// ============================================
// SCRIPTUREQUEST — script.js (v4 Overhaul)
// Quiz Engine • Result v2 • Sound • Mascot
// ============================================

const quizScreen   = document.getElementById('quiz-screen');
const resultScreen = document.getElementById('result-screen');

const currentNumEl   = document.getElementById('current-num');
const qNumEl         = document.getElementById('q-num');
const timerEl        = document.getElementById('timer');
const displayNameEl  = document.getElementById('display-name');
const questionTextEl = document.getElementById('question-text');
const optionsEl      = document.getElementById('options');
const feedbackArea   = document.getElementById('feedback-area');
const feedbackEmoji  = document.getElementById('feedback-emoji');
const feedbackMsg    = document.getElementById('feedback-message');

const prevBtn        = document.getElementById('prev-btn');
const nextBtn        = document.getElementById('next-btn');
const submitBtn      = document.getElementById('submit-btn');
const confirmModal   = document.getElementById('confirm-modal');
const answeredCountEl = document.getElementById('answered-count');

// Result screen elements
const candidateNameEl = document.getElementById('candidate-name');
const resultChartEl   = document.getElementById('resultChart');
const rewardSection   = document.getElementById('reward-section');

// ── State ──
let currentIndex      = 0;
let userAnswers       = {};
let timeLeft          = 6 * 60;
let timerInterval     = null;
let candidateName     = '';
let quizSubmitted     = false;
let selectedQuestions = [];
let isWaitingForNext  = false;

const TOTAL_QUESTIONS = 15;
const LETTERS         = ['A', 'B', 'C', 'D'];
const QUIZ_STATE_KEY  = 'scriptureQuest_state_v4';

// ── Feedback emoji pools ──
// Wisdom mascot (🕊️) is ONLY used for idle/level-up/celebration states.
// Correct/wrong feedback use emoji pools below.
const CORRECT_EMOJIS = ['😊','😄','🎉','✨','🌟','👏','🙌','💯','🥳','😁'];
const WRONG_EMOJIS   = ['😢','😞','😔','💔','😟','😕','🤦','😿','😣','🙁'];

function getRandomEmoji(isCorrect) {
  const pool = isCorrect ? CORRECT_EMOJIS : WRONG_EMOJIS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Wisdom hint messages ──
const CORRECT_HINTS = [
  'Well done! Keep it up!',
  'Correct! You know your Bible!',
  'Excellent! On fire! 🔥',
  'That\'s right! Brilliant!',
  'Perfect! Keep going!',
];
const WRONG_HINTS = [
  'Not quite — review and retry!',
  'Keep studying! You\'ll get it.',
  'Almost! Check that verse.',
  'Don\'t give up — keep going!',
];

function getHintMessage(isCorrect) {
  const pool = isCorrect ? CORRECT_HINTS : WRONG_HINTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================
// AUTO-SAVE (localStorage)
// ============================================

function saveQuizState() {
  if (quizSubmitted) return;
  try {
    localStorage.setItem(QUIZ_STATE_KEY, JSON.stringify({
      version: 4, currentIndex, userAnswers,
      expiresAt: Date.now() + (timeLeft * 1000),
      selectedQuestions, candidateName,
      quizSubmitted: false, savedAt: Date.now(),
      totalQuestions: TOTAL_QUESTIONS
    }));
  } catch (e) { console.warn('saveQuizState failed:', e); }
}

function restoreQuizState() {
  try {
    const raw = localStorage.getItem(QUIZ_STATE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);

    if (state.version !== 4) { localStorage.removeItem(QUIZ_STATE_KEY); return null; }
    if (Date.now() - (state.savedAt || 0) > 12 * 60 * 60 * 1000) {
      localStorage.removeItem(QUIZ_STATE_KEY); return null;
    }

    const remaining = state.expiresAt
      ? Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000))
      : 0;

    if (remaining <= 0) { localStorage.removeItem(QUIZ_STATE_KEY); return null; }
    if (!Array.isArray(state.selectedQuestions) || state.selectedQuestions.length === 0) {
      localStorage.removeItem(QUIZ_STATE_KEY); return null;
    }

    const first = state.selectedQuestions[0];
    if (!first?.question || !Array.isArray(first?.options) || typeof first?.answer !== 'number') {
      localStorage.removeItem(QUIZ_STATE_KEY); return null;
    }

    return { ...state, timeLeft: remaining };
  } catch (e) {
    localStorage.removeItem(QUIZ_STATE_KEY); return null;
  }
}

function clearQuizState() {
  localStorage.removeItem(QUIZ_STATE_KEY);
  updateResumeButtonVisibility();
}

function updateResumeButtonVisibility() {
  const btn = document.getElementById('resume-quiz-btn');
  if (!btn) return;
  try {
    const raw = localStorage.getItem(QUIZ_STATE_KEY);
    if (!raw) { btn.classList.add('hidden'); return; }
    const s = JSON.parse(raw);
    const valid = s.version === 4 &&
                  s.expiresAt > Date.now() &&
                  !s.quizSubmitted &&
                  Date.now() - (s.savedAt || 0) < 12 * 60 * 60 * 1000;
    btn.classList.toggle('hidden', !valid);
  } catch { btn.classList.add('hidden'); }
}
window.updateResumeButtonVisibility = updateResumeButtonVisibility;

// ============================================
// START QUIZ
// ============================================

async function startQuiz() {
  if (typeof questions === 'undefined' || !Array.isArray(questions) || questions.length === 0) {
    alert('Questions failed to load. Please refresh the page.');
    return;
  }

  const user = firebase.auth().currentUser;
  candidateName = user ? (user.displayName || user.email || 'Champion') : 'Guest';
  if (displayNameEl) displayNameEl.textContent = candidateName;

  // Try to restore saved state first
  const restored = restoreQuizState();
  if (restored) {
    currentIndex      = restored.currentIndex;
    userAnswers       = restored.userAnswers;
    timeLeft          = restored.timeLeft;
    selectedQuestions = restored.selectedQuestions;
    candidateName     = restored.candidateName || candidateName;
    quizSubmitted     = false;
    isWaitingForNext  = false;

    if (displayNameEl) displayNameEl.textContent = candidateName;
    renderQuestion();
    updateNavButtons();
    startTimer();

    if (typeof window.showToast === 'function') {
      window.showToast(`Quiz restored! ${Math.ceil(timeLeft / 60)} min left ⏳`, 'success');
    }
    updateResumeButtonVisibility();
    return;
  }

  // Fresh start
  const count = Math.min(TOTAL_QUESTIONS, questions.length);
  if (typeof window.getQuizQuestions === 'function') {
    try { selectedQuestions = await window.getQuizQuestions(questions, count); }
    catch { selectedQuestions = shuffleArr(questions).slice(0, count); }
  } else {
    selectedQuestions = shuffleArr(questions).slice(0, count);
  }

  currentIndex     = 0;
  userAnswers      = {};
  timeLeft         = 6 * 60;
  quizSubmitted    = false;
  isWaitingForNext = false;

  // Show Wisdom idle hint
  if (typeof window.showWisdomHint === 'function') {
    window.showWisdomHint('Take your time and think carefully!');
  }

  renderQuestion();
  updateNavButtons();
  startTimer();
  updateResumeButtonVisibility();
}

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================
// TIMER
// ============================================

function startTimer() {
  clearInterval(timerInterval);
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft % 3 === 0) saveQuizState();

    // Wisdom hints at specific time points
    if (timeLeft === 180 && typeof window.showWisdomHint === 'function') {
      window.showWisdomHint('3 minutes left — keep going!');
    }
    if (timeLeft === 60 && typeof window.showWisdomHint === 'function') {
      window.showWisdomHint('1 minute left! Start wrapping up!');
    }

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      submitQuiz();
    }
  }, 1000);
}

function updateTimerDisplay() {
  if (!timerEl) return;
  const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const s = (timeLeft % 60).toString().padStart(2, '0');
  timerEl.textContent = m + ':' + s;
  timerEl.classList.toggle('warning', timeLeft <= 60);
  timerEl.style.color = timeLeft <= 60 ? '#dc2626' : '#ef4444';
}

// ============================================
// RENDER & NAVIGATE
// ============================================

function renderQuestion() {
  const q = selectedQuestions[currentIndex];
  if (!q) { console.error('No question at index', currentIndex); return; }

  if (currentNumEl) currentNumEl.textContent = currentIndex + 1;
  if (qNumEl)       qNumEl.textContent       = currentIndex + 1;
  if (questionTextEl) questionTextEl.textContent = q.question;

  // Reset feedback
  if (feedbackArea) {
    feedbackArea.classList.add('hidden');
    feedbackArea.className = 'feedback-area hidden';
  }
  isWaitingForNext = false;
  if (optionsEl) optionsEl.innerHTML = '';

  q.options.forEach((opt, idx) => {
    const btn = document.createElement('div');
    btn.classList.add('option');
    btn.setAttribute('data-letter', LETTERS[idx]);
    btn.textContent = opt;

    // Restore answer state if already answered
    if (userAnswers.hasOwnProperty(currentIndex)) {
      const saved   = userAnswers[currentIndex];
      const correct = q.answer;
      if (idx === correct)                       btn.classList.add('correct');
      else if (idx === saved && saved !== correct) btn.classList.add('wrong');
      else                                         btn.classList.add('disabled');
    } else {
      btn.addEventListener('click', () => handleOptionClick(idx));
      btn.addEventListener('mouseenter', () => btn.style.transform = 'translateX(4px)');
      btn.addEventListener('mouseleave', () => { if (!btn.classList.contains('selected')) btn.style.transform = ''; });
    }

    if (optionsEl) optionsEl.appendChild(btn);
  });

  // Re-show feedback if already answered
  if (userAnswers.hasOwnProperty(currentIndex)) {
    const saved  = userAnswers[currentIndex];
    showFeedback(saved === q.answer, q.answer, false);
  }

  updateNavButtons();
}

function updateNavButtons() {
  if (prevBtn) prevBtn.disabled = currentIndex === 0;
  if (nextBtn) nextBtn.textContent = currentIndex === TOTAL_QUESTIONS - 1 ? 'Finish' : 'Next';
}

function navigate(direction) {
  const newIdx = currentIndex + direction;
  if (newIdx >= 0 && newIdx < TOTAL_QUESTIONS) {
    currentIndex = newIdx;
    saveQuizState();
    renderQuestion();
  } else if (newIdx >= TOTAL_QUESTIONS) {
    openSubmitModal();
  }
}
window.navigate = navigate;

// ============================================
// ANSWER HANDLING
// ============================================

function handleOptionClick(selectedIdx) {
  if (isWaitingForNext) return;

  const q          = selectedQuestions[currentIndex];
  const correctIdx = q.answer;
  const isCorrect  = selectedIdx === correctIdx;

  userAnswers[currentIndex] = selectedIdx;
  saveQuizState();

  // Style options
  const optEls = optionsEl.querySelectorAll('.option');
  optEls.forEach((el, idx) => {
    el.removeEventListener('click', () => {});
    if (idx === correctIdx)                          el.classList.add('correct');
    else if (idx === selectedIdx && !isCorrect)      el.classList.add('wrong');
    else                                             el.classList.add('disabled');
  });

  // Play sound
  if (isCorrect && typeof window.playCorrectSound === 'function') window.playCorrectSound();
  else if (!isCorrect && typeof window.playWrongSound === 'function') window.playWrongSound();

  // Show feedback (emoji pool — NOT wisdom dove)
  showFeedback(isCorrect, correctIdx, true);

  // Wisdom quiz hint — text only, mascot does NOT change state here
  if (typeof window.showWisdomHint === 'function') {
    window.showWisdomHint(getHintMessage(isCorrect));
  }

  isWaitingForNext = true;

  setTimeout(() => {
    if (currentIndex < TOTAL_QUESTIONS - 1) {
      currentIndex++;
      renderQuestion();
    } else {
      if (feedbackMsg) feedbackMsg.textContent = '🎊 Quiz complete! Preparing your results...';
      setTimeout(() => submitQuiz(), 1500);
    }
  }, 1800);
}

function showFeedback(isCorrect, correctIdx, animate) {
  if (!feedbackArea) return;

  feedbackArea.classList.remove('hidden');
  feedbackArea.className = 'feedback-area';

  if (isCorrect) {
    feedbackArea.classList.add('correct-feedback');
    if (feedbackEmoji) {
      feedbackEmoji.textContent = getRandomEmoji(true);  // happy emoji pool
      if (animate) feedbackEmoji.style.animation = 'bounceIn 0.5s ease';
    }
    if (feedbackMsg) feedbackMsg.textContent = 'Correct! Well done!';
  } else {
    feedbackArea.classList.add('wrong-feedback');
    if (feedbackEmoji) {
      feedbackEmoji.textContent = getRandomEmoji(false);  // sad emoji pool
      if (animate) feedbackEmoji.style.animation = 'shake 0.5s ease';
    }
    if (feedbackMsg) feedbackMsg.textContent = 'Wrong! The correct answer is ' + LETTERS[correctIdx] + '.';
  }

  if (!animate && feedbackEmoji) feedbackEmoji.style.animation = 'none';
}

// ============================================
// SUBMIT MODAL
// ============================================

function openSubmitModal() {
  const answered = Object.keys(userAnswers).length;
  if (answeredCountEl) answeredCountEl.textContent = answered;
  if (confirmModal) confirmModal.classList.remove('hidden');
  saveQuizState();
}

function closeSubmitModal() {
  if (confirmModal) confirmModal.classList.add('hidden');
}
window.openSubmitModal  = openSubmitModal;
window.closeSubmitModal = closeSubmitModal;

// ============================================
// SUBMIT QUIZ
// ============================================

async function submitQuiz() {
  if (quizSubmitted) return;
  quizSubmitted = true;
  clearInterval(timerInterval);
  closeSubmitModal();
  clearQuizState();

  const score = calculateScore();

  // Show loading state
  if (questionTextEl) questionTextEl.textContent = 'Calculating your results... 🕊️';
  if (optionsEl) optionsEl.innerHTML = '';

  let resultData = { 
    xpEarned: 0, leveledUp: false, newLevel: 1, streak: 0, 
    pct: Math.round((score / TOTAL_QUESTIONS) * 100), 
    completedQuests: [] 
  };

  // Calculate local XP as fallback
  const localXp = score * 10 + 50 + Math.min(70, (resultData.streak || 0) * 10);
  if (score / TOTAL_QUESTIONS >= 0.9) resultData.xpEarned += 90;
  if (score / TOTAL_QUESTIONS >= 0.7) resultData.xpEarned += 40;
  resultData.xpEarned = localXp;

  // Try Firestore save
  if (typeof saveQuizResult === 'function' && firebase.auth().currentUser) {
    try {
      const firestoreResult = await saveQuizResult(score, TOTAL_QUESTIONS, timeLeft, 0);
      // Merge Firestore result with local fallback (Firestore wins if it worked)
      resultData = { ...resultData, ...firestoreResult };
    } catch (err) {
      console.error('saveQuizResult failed, using local calculation:', err);
      // Keep the locally calculated resultData
    }
  }

  // Navigate to result screen
  if (typeof window.showScreen === 'function') window.showScreen('result');

  // Render results
  await showResults(score, resultData);
}

// ============================================
// RESULTS v2
// ============================================

async function showResults(score, resultData) {
  // Use firebase.js v4's showResultScreenV2 if available
  if (typeof window.showResultScreenV2 === 'function') {
    await window.showResultScreenV2(resultData, score, TOTAL_QUESTIONS, timeLeft);
  } else {
    // Fallback: basic display
    showResultsFallback(score, resultData);
  }

  // Always render the chart
  renderChart(score, TOTAL_QUESTIONS - score);

  // Check leaderboard rank for prize section
  if (typeof checkRewardEligibility === 'function') {
    await checkRewardEligibility();
  }
}

function showResultsFallback(score, resultData) {
  const pct = resultData.pct || Math.round((score / TOTAL_QUESTIONS) * 100);
  const el  = id => document.getElementById(id);

  if (el('result-title'))   el('result-title').textContent   = 'Lesson Complete! 🎉';
  if (el('score-display'))  el('score-display').textContent  = pct + '%';
  if (el('detailed-score')) el('detailed-score').textContent = score + ' / ' + TOTAL_QUESTIONS;
  if (el('stat-accuracy'))  el('stat-accuracy').textContent  = pct + '%';
  if (el('stat-xp'))        el('stat-xp').textContent        = '+' + (resultData.xpEarned || 0);
  if (el('stat-streak'))    el('stat-streak').textContent    = resultData.streak || 0;

  const m = Math.floor(timeLeft / 60), s = timeLeft % 60;
  if (el('stat-speed')) el('stat-speed').textContent = `${m}:${String(s).padStart(2,'0')}`;

  const badge = el('score-badge');
  if (badge) {
    badge.className   = 'score-badge ' + (pct >= 50 ? 'pass' : 'fail');
    badge.textContent = pct >= 70 ? '👍 Great Work!' : pct >= 50 ? '✅ Pass' : '📚 Keep Going!';
  }

  const tip = el('study-tip');
  if (tip) tip.textContent = pct >= 70 ? '🌟 Excellent work!' : '📖 Keep studying — you\'re growing!';

  if (el('candidate-name')) el('candidate-name').textContent = 'Candidate: ' + candidateName;
}

async function checkRewardEligibility() {
  const user = firebase.auth().currentUser;
  if (!user || !rewardSection) return;
  try {
    if (typeof fetchLeaderboard === 'function') {
      const entries = await fetchLeaderboard();
      const rank    = entries.findIndex(e => e.userId === user.uid) + 1;
      rewardSection.classList.toggle('hidden', !(rank > 0 && rank <= 3));
    }
  } catch { if (rewardSection) rewardSection.classList.add('hidden'); }
}

// ============================================
// CHART
// ============================================

function renderChart(correct, incorrect) {
  if (!resultChartEl) return;
  const ctx = resultChartEl.getContext('2d');
  if (!ctx) return;

  if (window._resultChart) window._resultChart.destroy();

  window._resultChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Correct ✅', 'Incorrect ❌'],
      datasets: [{
        data: [correct, incorrect],
        backgroundColor: ['#22c55e', '#ef4444'],
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      cutout: '65%',
      animation: { animateRotate: true, duration: 800 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 20, font: { size: 14, family: 'Inter' }, usePointStyle: true }
        }
      }
    }
  });
}

// ============================================
// GLOBAL EXPOSE
// ============================================

window.startQuiz   = startQuiz;
window.navigate    = navigate;
window.submitQuiz  = submitQuiz;

// Init
function init() {
  if (prevBtn)   prevBtn.addEventListener('click',   () => navigate(-1));
  if (nextBtn)   nextBtn.addEventListener('click',   () => navigate(1));
  if (submitBtn) submitBtn.addEventListener('click', openSubmitModal);

  const cancelBtn  = document.getElementById('cancel-submit');
  const confirmBtn = document.getElementById('confirm-submit');
  if (cancelBtn)  cancelBtn.addEventListener('click',  closeSubmitModal);
  if (confirmBtn) confirmBtn.addEventListener('click', submitQuiz);

  updateResumeButtonVisibility();
}

init();

console.log('🕊️ ScriptureQuest script.js v4 loaded — Quiz Engine • Result v2 • Sound • Emoji Feedback');
