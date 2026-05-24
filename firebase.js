// ============================================
// SCRIPTUREQUEST — firebase.js (v4 Overhaul)
// XP/Levels • Daily Quests • Badges • Achievements
// Leagues • Quiz History • Profile v2 • Dark Mode
// ============================================

const db   = firebase.firestore();
const auth = firebase.auth();

let authModalShown    = false;
let currentScreen     = 'landing';
let isProcessingAuth  = false;

// ============================================
// WEEK CONFIGURATION
// ============================================

const WEEK_EPOCH   = new Date('2026-05-04T08:00:00Z');
const MS_PER_WEEK  = 7 * 24 * 60 * 60 * 1000;

function getWeekInfo() {
  const now              = new Date();
  const diffTime         = now - WEEK_EPOCH;
  const weekIdx          = Math.floor(diffTime / MS_PER_WEEK);
  const weekNum          = weekIdx + 1;
  const currentWeekId    = '2026-W' + weekNum;
  const previousWeekId   = weekNum > 1 ? '2026-W' + weekIdx : null;

  const start = new Date(WEEK_EPOCH.getTime() + weekIdx * MS_PER_WEEK);
  const end   = new Date(WEEK_EPOCH.getTime() + (weekIdx + 1) * MS_PER_WEEK - 1);
  const next  = new Date(WEEK_EPOCH.getTime() + (weekIdx + 1) * MS_PER_WEEK);

  return { currentWeekId, previousWeekId, weekNumber: weekNum,
           weekStart: start.toISOString(), weekEnd: end.toISOString(),
           nextWeekStart: next.toISOString() };
}

function getCurrentWeekId()  { return getWeekInfo().currentWeekId; }
function getWeekStart()      { return getWeekInfo().weekStart; }
function getWeekEnd()        { return getWeekInfo().weekEnd; }
function getDisplayWeek()    { return getWeekInfo().weekNumber; }
function getNextWeekStart()  { return new Date(getWeekInfo().nextWeekStart); }
function getPreviousWeekId() { return getWeekInfo().previousWeekId; }

function getTimeUntilNextWeek() {
  const diff    = getNextWeekStart() - new Date();
  const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours   = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return { days, hours, minutes, totalMs: diff };
}

// ============================================
// XP & LEVEL SYSTEM
// ============================================

// Level thresholds: exponential growth
function getXpForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(1.4, level - 1));
}

function getTotalXpForLevel(level) {
  let total = 0;
  for (let i = 1; i < level; i++) total += getXpForLevel(i);
  return total;
}

function getLevelFromTotalXp(totalXp) {
  let level = 1;
  while (getTotalXpForLevel(level + 1) <= totalXp) level++;
  return level;
}

function getXpProgress(totalXp) {
  const level       = getLevelFromTotalXp(totalXp);
  const xpForThis   = getTotalXpForLevel(level);
  const xpForNext   = getTotalXpForLevel(level + 1);
  const current     = totalXp - xpForThis;
  const needed      = xpForNext - xpForThis;
  const pct         = Math.min(100, Math.round((current / needed) * 100));
  return { level, current, needed, pct, xpForNext };
}

/**
 * XP Formula:
 * base = correct * 10
 * accuracy bonus = if >=90% → +90
 * completion bonus = all answered → +50
 * streak bonus = +10 per streak day (max 70)
 * quest bonus = passed in separately
 */
function calculateXp(score, total, timeLeft, streak, questBonus = 0) {
  const pct        = score / total;
  let xp           = score * 10;
  if (pct >= 0.9)  xp += 90;
  if (pct >= 0.7)  xp += 40;
  xp += 50;                                          // completion bonus always
  xp += Math.min(70, (streak || 0) * 10);           // streak bonus
  xp += questBonus;
  return xp;
}

// Level title names
const LEVEL_TITLES = [
  '', 'Seeker', 'Disciple', 'Student', 'Scholar', 'Scribe',
  'Prophet', 'Apostle', 'Elder', 'Sage', 'Theologian',
  'Master', 'Patriarch', 'Champion', 'Legend', 'Wisdom Keeper'
];

function getLevelTitle(level) {
  return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)] || 'Wisdom Keeper';
}

// ============================================
// LEAGUE SYSTEM
// ============================================

const LEAGUES = [
  { name: 'Bronze',  icon: '🥉', color: '#cd7f32', class: '',        minRank: 1,  maxRank: 999 },
  { name: 'Silver',  icon: '🥈', color: '#c0c0c0', class: 'silver',  minRank: 1,  maxRank: 10  },
  { name: 'Gold',    icon: '🏅', color: '#ffd700', class: 'gold',    minRank: 1,  maxRank: 10  },
  { name: 'Sapphire',icon: '💎', color: '#0ea5e9', class: 'sapphire',minRank: 1,  maxRank: 10  },
  { name: 'Diamond', icon: '💠', color: '#a78bfa', class: 'diamond', minRank: 1,  maxRank: 5   },
];

function getUserLeague(weeklyXp, rank) {
  // Simple tier based on rank among active users
  if (rank <= 5)  return LEAGUES[4];   // Diamond
  if (rank <= 15) return LEAGUES[3];   // Sapphire
  if (rank <= 30) return LEAGUES[2];   // Gold
  if (rank <= 60) return LEAGUES[1];   // Silver
  return LEAGUES[0];                   // Bronze
}

// ============================================
// MONTHLY BADGES (12 badges)
// ============================================

const MONTHLY_BADGES = [
  { month: 0,  name: 'Genesis Explorer',   emoji: '🌍', description: 'January scholar' },
  { month: 1,  name: 'Exodus Pilgrim',     emoji: '🏔️', description: 'February pilgrim' },
  { month: 2,  name: 'Covenant Keeper',    emoji: '📜', description: 'March keeper' },
  { month: 3,  name: 'Spring Seeker',      emoji: '🌸', description: 'April seeker' },
  { month: 4,  name: 'Proverbs Wise',      emoji: '🦉', description: 'May wisdom' },
  { month: 5,  name: 'Psalm Singer',       emoji: '🎵', description: 'June singer' },
  { month: 6,  name: 'Prophecy Watcher',   emoji: '👁️', description: 'July watcher' },
  { month: 7,  name: 'Gospel Bearer',      emoji: '✝️', description: 'August bearer' },
  { month: 8,  name: 'Harvest Faithful',   emoji: '🌾', description: 'September faithful' },
  { month: 9,  name: 'Kingdom Builder',    emoji: '👑', description: 'October builder' },
  { month: 10, name: 'Remnant Warrior',    emoji: '⚔️', description: 'November warrior' },
  { month: 11, name: 'Advent Waiter',      emoji: '⭐', description: 'December waiter' },
];

// ============================================
// ACHIEVEMENTS (20 achievements)
// ============================================

const ACHIEVEMENTS = [
  { id: 'perfect_score',    name: 'Perfect Score',      icon: '🏅', desc: 'Score 15/15 correct',        tiers: [1,5,10,25,50],  field: 'perfectScores'    },
  { id: 'quiz_taker',       name: 'Quiz Taker',         icon: '📝', desc: 'Complete any quiz',           tiers: [1,5,10,25,50],  field: 'quizzesTaken'     },
  { id: 'streak_keeper',    name: 'Streak Keeper',      icon: '🔥', desc: 'Maintain a daily streak',     tiers: [3,7,14,30,60],  field: 'currentStreak'    },
  { id: 'xp_earner',        name: 'XP Earner',          icon: '⭐', desc: 'Earn total XP',               tiers: [100,500,1000,5000,10000], field: 'totalXp' },
  { id: 'speed_demon',      name: 'Speed Demon',        icon: '⚡', desc: 'Finish with 4+ min left',     tiers: [1,5,10,25,50],  field: 'speedRuns'        },
  { id: 'scholar',          name: 'Bible Scholar',      icon: '📖', desc: 'Score 80%+ on a quiz',        tiers: [1,5,10,25,50],  field: 'scholarScores'    },
  { id: 'quest_master',     name: 'Quest Master',       icon: '🎯', desc: 'Complete daily quests',        tiers: [1,5,10,25,50],  field: 'questsCompleted'  },
  { id: 'leaderboard_top',  name: 'Leaderboard Legend', icon: '🏆', desc: 'Finish in top 3 weekly',      tiers: [1,3,5,10,20],   field: 'topThreeFinishes' },
  { id: 'badge_collector',  name: 'Badge Collector',    icon: '🎖️', desc: 'Earn monthly badges',          tiers: [1,3,6,9,12],    field: 'badgesEarned'     },
  { id: 'old_testament',    name: 'OT Champion',        icon: '📕', desc: 'Answer OT questions correctly',tiers: [10,25,50,100,200],field:'otCorrect'        },
  { id: 'new_testament',    name: 'NT Champion',        icon: '📗', desc: 'Answer NT questions correctly',tiers: [10,25,50,100,200],field:'ntCorrect'        },
  { id: 'never_miss',       name: 'Dedicated',          icon: '🌟', desc: 'Quiz every day for a week',   tiers: [1,2,4,8,12],    field: 'weekStreaks'       },
  { id: 'early_bird',       name: 'Early Bird',         icon: '🌅', desc: 'Quiz before 9AM',             tiers: [1,5,10,25,50],  field: 'earlyBird'        },
  { id: 'night_owl',        name: 'Night Owl',          icon: '🦉', desc: 'Quiz after 9PM',              tiers: [1,5,10,25,50],  field: 'nightOwl'         },
  { id: 'come_back',        name: 'Comeback Kid',       icon: '💪', desc: 'Return after missing a day',  tiers: [1,3,5,10,20],   field: 'comebacks'        },
  { id: 'sharer',           name: 'Community Member',   icon: '🤝', desc: 'Contact admin via WhatsApp',  tiers: [1,2,3,5,10],    field: 'contactedAdmin'   },
  { id: 'level_up',         name: 'Level Up',           icon: '📈', desc: 'Reach higher levels',         tiers: [5,10,15,20,25], field: 'level'            },
  { id: 'consistent',       name: 'Consistent',         icon: '⏰', desc: 'Quiz 2x in one day',          tiers: [1,5,10,20,30],  field: 'doubleQuizDays'   },
  { id: 'ace',              name: 'Ace',                icon: '🎴', desc: 'Score 100% twice in a row',   tiers: [1,2,3,5,10],    field: 'consecutivePerfect'},
  { id: 'champion',         name: 'All-Round Champ',    icon: '🥇', desc: 'Complete all quest types',    tiers: [1,3,5,10,20],   field: 'allQuestTypes'    },
];

function getAchievementTierIndex(achievement, value) {
  let tier = -1;
  for (let i = 0; i < achievement.tiers.length; i++) {
    if (value >= achievement.tiers[i]) tier = i;
  }
  return tier;
}

// ============================================
// DAILY QUESTS ENGINE
// ============================================

const QUEST_TEMPLATES = [
  { id: 'complete_quiz',     name: 'Complete a Quiz',         icon: '📝', xp: 30,  type: 'quizzes',    target: 1  },
  { id: 'score_70',          name: 'Score 70% or Higher',     icon: '🎯', xp: 40,  type: 'score',      target: 70 },
  { id: 'score_90',          name: 'Score 90% or Higher',     icon: '🌟', xp: 60,  type: 'score',      target: 90 },
  { id: 'two_quizzes',       name: 'Take 2 Quizzes Today',    icon: '✌️', xp: 50,  type: 'quizzes',    target: 2  },
  { id: 'earn_100xp',        name: 'Earn 100 XP Today',       icon: '⭐', xp: 20,  type: 'xp',         target: 100},
  { id: 'perfect_q',         name: 'Answer 10 Correctly',     icon: '💯', xp: 35,  type: 'correct',    target: 10 },
  { id: 'full_quiz',         name: 'Answer All 15 Questions', icon: '📋', xp: 25,  type: 'answered',   target: 15 },
  { id: 'speed_run',         name: 'Finish with 3+ Min Left', icon: '⚡', xp: 45,  type: 'speed',      target: 180},
];

function generateDailyQuests() {
  const today    = new Date();
  const seed     = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const shuffled = [...QUEST_TEMPLATES].sort((a, b) => {
    const ha = Math.sin(seed + a.id.charCodeAt(0)) * 10000;
    const hb = Math.sin(seed + b.id.charCodeAt(0)) * 10000;
    return (ha - Math.floor(ha)) - (hb - Math.floor(hb));
  });
  return shuffled.slice(0, 3).map(q => ({ ...q, completed: false, progress: 0 }));
}

function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadOrGenerateDailyQuests(userId) {
  const today   = getTodayDateString();
  const userRef = db.collection('users').doc(userId);

  try {
    const doc  = await userRef.get();
    const data = doc.data() || {};

    // If quests exist for today, return them
    if (data.dailyQuests && data.dailyQuests.date === today) {
      return data.dailyQuests.quests;
    }

    // Generate fresh quests for today
    const quests = generateDailyQuests();
    await userRef.update({
      dailyQuests: { date: today, quests: quests }
    });
    return quests;
  } catch (err) {
    console.error('loadOrGenerateDailyQuests error:', err);
    return generateDailyQuests();
  }
}

async function checkAndUpdateQuests(userId, quizResult) {
  // quizResult: { score, total, xpEarned, timeLeft, answered }
  const today   = getTodayDateString();
  const userRef = db.collection('users').doc(userId);
  let questBonusXp = 0;
  let completedQuests = [];

  try {
    const doc  = await userRef.get();
    const data = doc.data() || {};

    if (!data.dailyQuests || data.dailyQuests.date !== today) return { questBonusXp: 0, completedQuests: [] };

    const quests   = data.dailyQuests.quests || [];
    const pct      = Math.round((quizResult.score / quizResult.total) * 100);
    let allDone    = true;
    let newlyDone  = [];

    const updated = quests.map(q => {
      if (q.completed) return q;

      let progress = q.progress || 0;
      let done     = false;

      switch (q.type) {
        case 'quizzes':
          progress++;
          done = progress >= q.target;
          break;
        case 'score':
          if (pct >= q.target) { progress = q.target; done = true; }
          break;
        case 'xp':
          progress += quizResult.xpEarned;
          done = progress >= q.target;
          break;
        case 'correct':
          progress += quizResult.score;
          done = progress >= q.target;
          break;
        case 'answered':
          progress += quizResult.answered;
          done = progress >= q.target;
          break;
        case 'speed':
          if (quizResult.timeLeft >= q.target) { progress = q.target; done = true; }
          break;
      }

      if (done && !q.completed) {
        newlyDone.push(q);
        questBonusXp += q.xp;
      }

      return { ...q, progress, completed: done };
    });

    const totalDone = updated.filter(q => q.completed).length;
    if (totalDone === 3 && !data.dailyQuests.allCompleteBonus) {
      questBonusXp += 100;
      completedQuests = [...newlyDone];
      await userRef.update({
        'dailyQuests.quests': updated,
        'dailyQuests.allCompleteBonus': true,
        questsCompleted: firebase.firestore.FieldValue.increment(3)
      });
    } else {
      completedQuests = [...newlyDone];
      await userRef.update({
        'dailyQuests.quests': updated,
        questsCompleted: firebase.firestore.FieldValue.increment(newlyDone.length)
      });
    }

    return { questBonusXp, completedQuests, allCompleted: totalDone === 3 };
  } catch (err) {
    console.error('checkAndUpdateQuests error:', err);
    return { questBonusXp: 0, completedQuests: [] };
  }
}

// ============================================
// BADGE SYSTEM
// ============================================

async function checkAndAwardBadges(userId) {
  const today   = new Date();
  const month   = today.getMonth(); // 0-11
  const userRef = db.collection('users').doc(userId);

  try {
    const doc  = await userRef.get();
    const data = doc.data() || {};

    const currentMonthKey  = `${today.getFullYear()}-${month}`;
    const monthQuizCount   = data.monthQuizCount || {};
    const earnedBadges     = data.badges || [];

    const count = (monthQuizCount[currentMonthKey] || 0) + 1;
    const update = { [`monthQuizCount.${currentMonthKey}`]: count };

    // Award badge if this month's badge isn't earned yet and hit 10 quizzes
    const badgeId = `badge-${month}`;
    if (count >= 10 && !earnedBadges.includes(badgeId)) {
      update.badges = firebase.firestore.FieldValue.arrayUnion(badgeId);
      update.badgesEarned = firebase.firestore.FieldValue.increment(1);
      await userRef.update(update);
      return MONTHLY_BADGES[month];
    } else {
      await userRef.update(update);
      return null;
    }
  } catch (err) {
    console.error('checkAndAwardBadges error:', err);
    return null;
  }
}

// ============================================
// ACHIEVEMENT SYSTEM
// ============================================

async function updateAchievements(userId, stats) {
  // stats: { perfectScores, quizzesTaken, currentStreak, totalXp,
  //          speedRuns, scholarScores, questsCompleted, topThreeFinishes,
  //          badgesEarned, level }
  const userRef = db.collection('users').doc(userId);
  let newAchievements = [];

  try {
    const doc  = await userRef.get();
    const data = doc.data() || {};
    const achs = data.achievements || {};
    const updateData = {};

    ACHIEVEMENTS.forEach(ach => {
      const value    = stats[ach.field] || data[ach.field] || 0;
      const prevTier = achs[ach.id]?.tier ?? -1;
      const newTier  = getAchievementTierIndex(ach, value);

      if (newTier > prevTier) {
        updateData[`achievements.${ach.id}`] = { tier: newTier, value };
        newAchievements.push({ ...ach, tier: newTier });
      }
    });

    if (Object.keys(updateData).length > 0) {
      await userRef.update(updateData);
    }

    return newAchievements;
  } catch (err) {
    console.error('updateAchievements error:', err);
    return [];
  }
}

// ============================================
// TOAST UTILITY
// ============================================

function showToast(message, type = 'info') {
  const existing = document.getElementById('app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  const bg    = type === 'success' ? '#dcfce7' : type === 'error' ? '#fee2e2' : '#f0f9ff';
  const color = type === 'success' ? '#166534' : type === 'error' ? '#991b1b' : '#0369a1';
  const border= type === 'success' ? '#86efac' : type === 'error' ? '#fca5a5' : '#bae6fd';

  toast.style.cssText = `
    position:fixed;top:20px;left:50%;transform:translateX(-50%);
    z-index:99999;padding:14px 28px;border-radius:12px;
    font-weight:600;font-size:14px;font-family:'Inter',sans-serif;
    box-shadow:0 8px 24px rgba(0,0,0,0.15);animation:fadeInUp 0.3s ease;
    max-width:90vw;text-align:center;
    background:${bg};color:${color};border:1px solid ${border};
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3500);
}
window.showToast = showToast;

// ============================================
// DARK MODE
// ============================================

function initDarkMode() {
  const saved = localStorage.getItem('sq_theme') || 'light';
  setTheme(saved);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('sq_theme', theme);
  const icon = document.getElementById('theme-icon');
  const toggle = document.getElementById('dark-mode-toggle');
  if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  if (toggle) toggle.checked = theme === 'dark';
}

function toggleDarkMode() {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
}
window.toggleDarkMode = toggleDarkMode;

// ============================================
// SOUND SYSTEM (Web Audio API)
// ============================================

let soundEnabled = localStorage.getItem('sq_sound') !== 'false';
let audioCtx     = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(frequency, duration, type = 'sine', volume = 0.3) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function playCorrectSound() {
  playTone(523, 0.1);
  setTimeout(() => playTone(659, 0.1), 100);
  setTimeout(() => playTone(784, 0.2), 200);
}

function playWrongSound() {
  playTone(300, 0.15, 'sawtooth', 0.2);
  setTimeout(() => playTone(250, 0.2, 'sawtooth', 0.15), 150);
}

function playLevelUpSound() {
  [523,587,659,698,784,880].forEach((f, i) => {
    setTimeout(() => playTone(f, 0.15), i * 80);
  });
}

function playCelebrationSound() {
  [784,988,1175,1319].forEach((f, i) => {
    setTimeout(() => playTone(f, 0.2), i * 100);
  });
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('sq_sound', soundEnabled);
  const icon = document.getElementById('sound-icon');
  const toggle = document.getElementById('sound-toggle');
  if (icon) icon.className = soundEnabled ? 'fas fa-volume-up' : 'fas fa-volume-mute';
  if (toggle) toggle.checked = soundEnabled;
  showToast(soundEnabled ? '🔊 Sound enabled' : '🔇 Sound muted', 'info');
}
window.toggleSound     = toggleSound;
window.playCorrectSound = playCorrectSound;
window.playWrongSound   = playWrongSound;
window.playLevelUpSound = playLevelUpSound;
window.playCelebrationSound = playCelebrationSound;

// ============================================
// WISDOM MASCOT CONTROLLER
// ============================================

function setWisdomState(state, message) {
  const mascot = document.getElementById('wisdom-mascot');
  const speech = document.getElementById('wisdom-speech');
  if (!mascot) return;

  mascot.className = 'wisdom-mascot';
  if (state) mascot.classList.add(state);

  if (message && speech) {
    speech.textContent = message;
    speech.classList.remove('hidden');
    setTimeout(() => speech.classList.add('hidden'), 3000);
  }
}

function showWisdomHint(text) {
  const hint = document.getElementById('wisdom-quiz-hint');
  const hintText = document.getElementById('wisdom-hint-text');
  if (hint && hintText) {
    hintText.textContent = text;
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 4000);
  }
}
window.setWisdomState = setWisdomState;
window.showWisdomHint  = showWisdomHint;

// ============================================
// CONFETTI
// ============================================

function launchConfetti() {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#6366f1','#8b5cf6','#f59e0b','#22c55e','#ef4444','#3b82f6','#ec4899'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.style.cssText = `
      position:absolute;
      left:${Math.random()*100}%;
      top:-10px;
      width:${6 + Math.random()*8}px;
      height:${6 + Math.random()*8}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      animation:confetti-fall ${1.5 + Math.random()*2}s ease ${Math.random()*1.5}s forwards;
      opacity:1;
    `;
    container.appendChild(piece);
  }
}
window.launchConfetti = launchConfetti;

// ============================================
// SCREEN NAVIGATION
// ============================================

const ALL_SCREENS = [
  'landing','quiz','result','leaderboard','rewards',
  'profile','history','badges','achievements','settings'
];

function showScreen(name) {
  if (name === currentScreen) return;
  currentScreen = name;

  ALL_SCREENS.forEach(s => {
    const el = document.getElementById(s + '-screen');
    if (el) el.classList.add('hidden');
  });

  const target = document.getElementById(name + '-screen');
  if (target) {
    target.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  updateBottomNav(name);

  // Show/hide global UI elements
  const globalEls = ['fixed-logout-btn','sound-toggle-btn','theme-toggle-btn','whatsapp-fab','bottom-nav'];
  const hideOnQuiz = name === 'quiz' || name === 'result';
  globalEls.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'bottom-nav') {
      el.classList.toggle('hidden', name === 'quiz');
    }
  });
}

function updateBottomNav(active) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.nav === active);
  });
}

function navigateTo(name) {
  showScreen(name);
  if (name === 'leaderboard')   renderLeaderboard();
  if (name === 'rewards')       loadUserDashboard();
  if (name === 'profile')       loadProfile();
  if (name === 'history')       loadQuizHistory();
  if (name === 'badges')        loadBadges();
  if (name === 'achievements')  loadAchievements();
  if (name === 'settings')      loadSettings();
}
window.showScreen  = showScreen;
window.navigateTo  = navigateTo;

// ============================================
// AUTH FUNCTIONS
// ============================================

function showAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('hidden');
  authModalShown = true;
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
  const err = document.getElementById('auth-error');
  if (err) err.textContent = '';
}

function switchAuthTab(tab) {
  const forms = { login: 'login-form', register: 'register-form' };
  const tabs  = { login: 'login-tab',  register: 'register-tab'  };
  Object.keys(forms).forEach(t => {
    const form = document.getElementById(forms[t]);
    const tabEl = document.getElementById(tabs[t]);
    if (!form || !tabEl) return;
    if (t === tab) { form.classList.remove('hidden'); tabEl.classList.add('active'); }
    else           { form.classList.add('hidden');    tabEl.classList.remove('active'); }
  });
}
window.switchAuthTab = switchAuthTab;

async function handleRegister(e) {
  e.preventDefault();
  if (isProcessingAuth) return;
  isProcessingAuth = true;

  const btn  = e.target.querySelector('button[type="submit"]');
  const orig = btn?.textContent || 'Create Account';
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('auth-error');

  if (errEl) { errEl.textContent = ''; errEl.style.color = '#ef4444'; }

  if (name.length < 2) {
    if (errEl) errEl.textContent = 'Please enter your full name';
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    isProcessingAuth = false; return;
  }
  if (password.length < 6) {
    if (errEl) errEl.textContent = 'Password must be at least 6 characters';
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    isProcessingAuth = false; return;
  }

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });

    await db.collection('users').doc(cred.user.uid).set({
      name, email,
      totalPoints: 0, totalXp: 0, xp: 0, level: 1,
      quizzesTaken: 0, bestScore: 0, bestScoreFormat: 'percentage',
      currentStreak: 0, longestStreak: 0,
      phoneNumber: '', networkProvider: '', profileComplete: false,
      claimedMilestones: [], badges: [], achievements: {},
      questsCompleted: 0, perfectScores: 0, speedRuns: 0,
      scholarScores: 0, topThreeFinishes: 0, badgesEarned: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (errEl) { errEl.style.color = '#22c55e'; errEl.textContent = 'Account created!'; }
    setTimeout(() => { hideAuthModal(); updateUIForLoggedInUser(cred.user); isProcessingAuth = false; }, 1000);
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    isProcessingAuth = false;
  }
}

async function handleLogin(e) {
  e.preventDefault();
  if (isProcessingAuth) return;
  isProcessingAuth = true;

  const btn  = e.target.querySelector('button[type="submit"]');
  const orig = btn?.textContent || 'Sign In';
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('auth-error');

  if (errEl) { errEl.textContent = ''; errEl.style.color = '#ef4444'; }

  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    if (errEl) { errEl.style.color = '#22c55e'; errEl.textContent = 'Login successful!'; }
    setTimeout(() => { hideAuthModal(); updateUIForLoggedInUser(cred.user); isProcessingAuth = false; }, 800);
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    isProcessingAuth = false;
  }
}

async function handleLogout() {
  await auth.signOut();
  location.reload();
}
window.handleLogout   = handleLogout;
window.handleRegister = handleRegister;
window.handleLogin    = handleLogin;

// ============================================
// PROFILE CONTACT
// ============================================

async function saveProfileContact() {
  const user = auth.currentUser;
  if (!user) return;
  const phone   = (document.getElementById('profile-phone')?.value || '').trim();
  const network = document.getElementById('profile-network')?.value || '';
  if (!phone || phone.length < 10) { showToast('Please enter a valid phone number', 'error'); return; }
  if (!network) { showToast('Please select your network provider', 'error'); return; }
  try {
    await db.collection('users').doc(user.uid).update({ phoneNumber: phone, networkProvider: network, profileComplete: true });
    showToast('Contact details saved! ✅', 'success');
    loadProfile();
  } catch (err) { showToast('Error saving contact details', 'error'); }
}
window.saveProfileContact = saveProfileContact;

async function saveRequiredContact() {
  const user = auth.currentUser;
  if (!user) return;
  const phone   = (document.getElementById('req-phone')?.value || '').trim();
  const network = document.getElementById('req-network')?.value || '';
  if (!phone || phone.length < 10) { showToast('Please enter a valid phone number', 'error'); return; }
  if (!network) { showToast('Please select your network provider', 'error'); return; }
  try {
    await db.collection('users').doc(user.uid).update({ phoneNumber: phone, networkProvider: network, profileComplete: true });
    const modal = document.getElementById('profile-required-modal');
    if (modal) modal.classList.add('hidden');
    showToast('Profile complete! You can now take quizzes. 🎉', 'success');
    loadProfile();
  } catch (err) { showToast('Error saving details. Please try again.', 'error'); }
}
window.saveRequiredContact = saveRequiredContact;

// ============================================
// UI UPDATE ON LOGIN
// ============================================

async function updateUIForLoggedInUser(user) {
  const el = id => document.getElementById(id);
  if (el('auth-section'))    el('auth-section').classList.add('hidden');
  if (el('welcome-section')) el('welcome-section').classList.remove('hidden');
  if (el('welcome-name'))    el('welcome-name').textContent = user.displayName || 'Champion';
  if (el('fixed-logout-btn')) el('fixed-logout-btn').classList.remove('hidden');
  if (el('sound-toggle-btn')) el('sound-toggle-btn').classList.remove('hidden');
  if (el('theme-toggle-btn')) el('theme-toggle-btn').classList.remove('hidden');
  if (el('whatsapp-fab'))     el('whatsapp-fab').classList.remove('hidden');
  if (el('bottom-nav'))       el('bottom-nav').classList.remove('hidden');
  if (el('wisdom-mascot'))    el('wisdom-mascot').classList.remove('hidden');

  updateWeekBadges();
  checkNewWeekBanner();
  updateResumeButtonVisibility();

  showQuizAttemptsLeft(null, true);

    try {
    const doc  = await db.collection('users').doc(user.uid).get();
    const data = doc.data() || {};

    // Auto-migrate bestScore
    if (data.bestScore !== undefined && data.bestScoreFormat !== 'percentage') {
      await recalculateUserBestScore(user.uid).catch(console.error);
    }

    // Show XP/Level display
    renderXpDisplay(data.totalXp || 0);

    // Load daily quests preview
    const quests = await loadOrGenerateDailyQuests(user.uid);
    renderQuestsPreview(quests);

    if (!data.phoneNumber || !data.networkProvider) {
      showRequiredProfileModal();
      showToast('📱 Please complete your profile to continue', 'info');
      showQuizAttemptsLeft(0);
    } else {
      const limitCheck = await checkDailyQuizLimit();
      if (limitCheck.blocked && limitCheck.reason !== 'check_failed') {
        showDailyLimitMessage(limitCheck);
      } else if (limitCheck.reason === 'check_failed') {
        showQuizAttemptsLeft(null, true, true);
      } else {
        showQuizAttemptsLeft(limitCheck.remaining);
      }
    }

    // Update league display
    const entries = await fetchLeaderboard();
    const rank    = entries.findIndex(e => e.userId === user.uid) + 1;
    if (rank > 0) {
      const league = getUserLeague(0, rank);
      updateLeagueBadges(league);
    }
  } catch (err) {
    console.error('updateUIForLoggedInUser error:', err);
    showQuizAttemptsLeft(2);
  }

  setTimeout(() => checkNotificationStatus(), 1000);
}

function renderXpDisplay(totalXp) {
  const { level, current, needed, pct } = getXpProgress(totalXp);
  const display = document.getElementById('xp-level-display');
  const badge   = document.getElementById('level-badge');
  const fill    = document.getElementById('xp-bar-fill');
  const text    = document.getElementById('xp-text');

  if (display) display.classList.remove('hidden');
  if (badge)   badge.textContent = `Lv. ${level} — ${getLevelTitle(level)}`;
  if (fill)    fill.style.width  = pct + '%';
  if (text)    text.textContent  = `${current} / ${needed} XP`;
}

function renderQuestsPreview(quests) {
  const preview = document.getElementById('daily-quests-preview');
  const list    = document.getElementById('quests-preview-list');
  if (!preview || !list) return;

  preview.classList.remove('hidden');
  list.innerHTML = quests.map(q => `
    <div class="quest-preview-item ${q.completed ? 'done' : ''}">
      <span class="quest-preview-icon">${q.icon}</span>
      <span>${q.name}</span>
      <span style="margin-left:auto;font-weight:800;color:var(--accent)">+${q.xp} XP</span>
      ${q.completed ? '<span>✅</span>' : ''}
    </div>
  `).join('');
}

function updateLeagueBadges(league) {
  document.querySelectorAll('.league-badge, #league-badge, .league-badge-small').forEach(el => {
    el.textContent  = `${league.icon} ${league.name}`;
    el.className    = el.className.replace(/\b(silver|gold|sapphire|diamond)\b/g, '');
    if (league.class) el.classList.add(league.class);
  });
}

function updateWeekBadges() {
  const weekNum = getDisplayWeek();
  document.querySelectorAll('#leaderboard-week-badge, #week-badge').forEach(el => {
    if (el) el.textContent = 'Week ' + weekNum;
  });
}

// ============================================
// SAVE QUIZ RESULT (Full v4)
// ============================================
async function saveQuizResult(score, totalQuestions, timeLeft, pointsLegacy) {
  const user = auth.currentUser;
  if (!user) return { xpEarned: 0, leveledUp: false, newLevel: 1, questBonus: 0, completedQuests: [] };

  // ── Calculate everything locally FIRST (so we have values even if Firestore fails) ──
  const now          = new Date();
  const pct          = Math.round((score / totalQuestions) * 100);
  
  // Get current user data for streak calc
  let streak = 1, oldTotalXp = 0, oldLevel = 1, comebacks = 0;
  let userData = {};
  
  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    userData = userDoc.data() || {};
    const lastDate = userData.lastQuizDate ? userData.lastQuizDate.toDate() : null;
    
    if (lastDate) {
      const diff = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
      if (diff === 1) streak = (userData.currentStreak || 0) + 1;
      else if (diff === 0) streak = userData.currentStreak || 1;
      else { streak = 1; comebacks = (userData.comebacks || 0) + 1; }
    }
    
    oldTotalXp = userData.totalXp || 0;
    oldLevel = userData.level || 1;
  } catch (err) {
    console.warn('Could not fetch user data for streak calc:', err);
  }

  // ── XP Calculation (local) ──
  let xp = score * 10;
  if (pct >= 90) xp += 90;
  if (pct >= 70) xp += 40;
  xp += 50; // completion bonus
  xp += Math.min(70, streak * 10);
  
  // Try quests (best effort)
  let questBonusXp = 0;
  try {
    const questResult = await checkAndUpdateQuests(user.uid, {
      score, total: totalQuestions, xpEarned: xp, timeLeft, answered: totalQuestions
    });
    questBonusXp = questResult.questBonusXp || 0;
  } catch (err) {
    console.warn('Quest check failed:', err);
  }
  
  const xpEarned = xp + questBonusXp;
  const newTotalXp = oldTotalXp + xpEarned;
  const newLevel = getLevelFromTotalXp(newTotalXp);
  const leveledUp = newLevel > oldLevel;

  // ── Build result object (return this even if Firestore fails) ──
  const result = {
    xpEarned, leveledUp, newLevel, oldLevel,
    questBonusXp, completedQuests: [],
    allQuestsCompleted: false,
    newBadge: null, newAchievements: [],
    score, pct, streak, newTotalXp
  };

  // ── Firestore writes (best effort — don't let failures break the quiz) ──
  try {
    const isPerfect = score === totalQuestions;
    const isScholar = pct >= 80;
    const isSpeed   = timeLeft >= 180;
    const hour      = now.getHours();
    const earlyBird = hour < 9 ? 1 : 0;
    const nightOwl  = hour >= 21 ? 1 : 0;
    const oldBest   = userData.bestScore || 0;
    const newBest   = Math.max(pct, oldBest);

    await db.collection('users').doc(user.uid).set({
      name: user.displayName || userData.name || 'User',
      email: user.email,
      totalPoints: firebase.firestore.FieldValue.increment(xpEarned),
      totalXp: newTotalXp,
      xp: getXpProgress(newTotalXp).current,
      level: newLevel,
      quizzesTaken: firebase.firestore.FieldValue.increment(1),
      bestScore: newBest,
      bestScoreFormat: 'percentage',
      currentStreak: streak,
      longestStreak: Math.max(streak, userData.longestStreak || 0),
      lastQuizDate: firebase.firestore.FieldValue.serverTimestamp(),
      comebacks: comebacks,
      perfectScores: firebase.firestore.FieldValue.increment(isPerfect ? 1 : 0),
      scholarScores: firebase.firestore.FieldValue.increment(isScholar ? 1 : 0),
      speedRuns: firebase.firestore.FieldValue.increment(isSpeed ? 1 : 0),
      earlyBird: firebase.firestore.FieldValue.increment(earlyBird),
      nightOwl: firebase.firestore.FieldValue.increment(nightOwl),
    }, { merge: true });

    // Log quiz attempt
    await db.collection('quizAttempts').add({
      userId: user.uid,
      userName: user.displayName || userData.name || 'User',
      score, totalQuestions, percentage: pct, timeLeft,
      points: xpEarned, xpEarned,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Update leaderboard
    await updateWeeklyLeaderboard(user.uid, user.displayName || userData.name || 'User', xpEarned);

    // Check badges & achievements
    const newBadge = await checkAndAwardBadges(user.uid).catch(() => null);
    const freshDoc = await db.collection('users').doc(user.uid).get();
    const freshData = freshDoc.data() || {};
    const newAchs = await updateAchievements(user.uid, {
      perfectScores: freshData.perfectScores || 0,
      quizzesTaken: freshData.quizzesTaken || 0,
      currentStreak: streak,
      totalXp: newTotalXp,
      speedRuns: freshData.speedRuns || 0,
      scholarScores: freshData.scholarScores || 0,
      questsCompleted: freshData.questsCompleted || 0,
      level: newLevel,
      badgesEarned: freshData.badgesEarned || 0,
    }).catch(() => []);

    result.newBadge = newBadge;
    result.newAchievements = newAchs;

  } catch (err) {
    console.error('Firestore save failed (quiz still valid):', err);
    // Return the locally calculated result — user still sees their XP!
  }

  if (leveledUp) playLevelUpSound();
  else playCelebrationSound();

  return result;
}

window.saveQuizResult = saveQuizResult;


// ============================================
// QUIZ COMPLETE v2 — RESULT SCREEN RENDERER
// ============================================

async function showResultScreenV2(resultData, score, totalQuestions, timeLeft) {
  // resultData = returned from saveQuizResult()
  const el  = id => document.getElementById(id);
  const pct = resultData.pct || Math.round((score / totalQuestions) * 100);

  // — Header
  if (el('result-title'))   el('result-title').textContent = 'Lesson Complete! 🎉';
  if (el('candidate-name')) el('candidate-name').textContent = 'Candidate: ' + (auth.currentUser?.displayName || 'Champion');

  // — Score circle
  if (el('score-display'))   el('score-display').textContent  = pct + '%';
  if (el('detailed-score'))  el('detailed-score').textContent = score + ' / ' + totalQuestions;
  const badge = el('score-badge');
  if (badge) {
    badge.className = 'score-badge ' + (pct >= 50 ? 'pass' : 'fail');
    badge.textContent = pct >= 90 ? '🌟 Excellent!' : pct >= 70 ? '👍 Great Work!' : pct >= 50 ? '✅ Pass' : '📚 Keep Going!';
  }

  // — Stat cards
  if (el('stat-accuracy')) el('stat-accuracy').textContent = pct + '%';
  const m = Math.floor(timeLeft / 60), s = timeLeft % 60;
  if (el('stat-speed'))  el('stat-speed').textContent  = `${m}:${String(s).padStart(2,'0')}`;
  if (el('stat-streak')) el('stat-streak').textContent = resultData.streak || 0;
  if (el('stat-xp'))     el('stat-xp').textContent     = '+' + (resultData.xpEarned || 0);

  // — XP pop-up animation
  const popup = el('xp-popup');
  if (popup) {
    popup.classList.remove('hidden');
    el('xp-popup-value').textContent = '+' + (resultData.xpEarned || 0) + ' XP';
    setTimeout(() => popup.classList.add('hidden'), 2500);
  }

  // — Level-up banner
  if (resultData.leveledUp) {
    const banner = el('level-up-banner');
    if (banner) {
      banner.classList.remove('hidden');
      const newLevelEl = el('new-level');
      if (newLevelEl) newLevelEl.textContent = `Level ${resultData.newLevel} — ${getLevelTitle(resultData.newLevel)}`;
    }
    setWisdomState('level-up', `Level ${resultData.newLevel}! Amazing!`);
  } else {
    setWisdomState('celebrating', pct >= 70 ? 'Great job!' : 'Keep going!');
  }

  // — Confetti
  launchConfetti();

  // — Quests completed section
  if (resultData.completedQuests && resultData.completedQuests.length > 0) {
    const section = el('quests-completed');
    const list    = el('quests-completed-list');
    const bonusEl = el('quest-bonus-xp');
    if (section && list) {
      section.classList.remove('hidden');
      list.innerHTML = resultData.completedQuests.map(q =>
        `<div class="quest-completed-item">
          <span>${q.icon}</span>
          <span>${q.name}</span>
          <span style="margin-left:auto;color:var(--accent);font-weight:800">+${q.xp} XP</span>
          <span>✅</span>
        </div>`
      ).join('');
      if (bonusEl && resultData.allQuestsCompleted) {
        bonusEl.classList.remove('hidden');
        bonusEl.textContent = '+100 Bonus XP! All quests done! 🎯';
      }
    }
  }

  // — Study tip
  const tip = el('study-tip');
  if (tip) {
    const tips = [
      pct >= 90 ? '🌟 Outstanding! You truly know the Word!' : null,
      pct >= 70 ? '👏 Great performance! Consistency is key.' : null,
      pct >= 50 ? '📖 Good effort! Review missed answers to grow.' : null,
      '📚 "Study to show yourself approved" — 2 Tim 2:15',
    ];
    tip.textContent = tips.find(t => t !== null) || tips[tips.length - 1];
  }

  // — Dashboard stats
  await loadUserDashboard();

  // — New badge notification
  if (resultData.newBadge) {
    setTimeout(() => showToast(`🎖️ New badge earned: ${resultData.newBadge.emoji} ${resultData.newBadge.name}!`, 'success'), 2000);
  }

  // — New achievement notifications
  if (resultData.newAchievements && resultData.newAchievements.length > 0) {
    resultData.newAchievements.forEach((ach, i) => {
      setTimeout(() => showToast(`🏅 Achievement unlocked: ${ach.name}!`, 'success'), 3000 + i * 1500);
    });
  }
}
window.showResultScreenV2 = showResultScreenV2;

// ============================================
// LEADERBOARD FUNCTIONS
// ============================================

async function updateWeeklyLeaderboard(userId, userName, points) {
  const weekId = getCurrentWeekId();
  const userRef = db.collection('leaderboard').doc(weekId).collection('entries').doc(userId);
  
  try {
    const doc = await userRef.get();
    const current = doc.exists ? (doc.data().points || 0) : 0;
    
    await userRef.set({
      userId: userId,
      name: userName,
      points: current + points,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Leaderboard updated:', weekId, userName, current + points);
  } catch (err) {
    console.error('❌ Leaderboard update FAILED:', err);
    // Try once more with a simpler write
    try {
      await userRef.set({
        userId: userId,
        name: userName,
        points: points,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log('✅ Leaderboard updated (retry):', weekId, userName, points);
    } catch (retryErr) {
      console.error('❌ Leaderboard retry also failed:', retryErr);
    }
  }
}

// OLD (delete)
// async function fetchLeaderboard() { ... }

// NEW
async function fetchLeaderboard() {
  try {
    const snap = await db.collection('leaderboard')
      .doc(getCurrentWeekId())
      .collection('entries')
      .orderBy('points', 'desc')
      .get();
    return snap.docs.map(d => ({ userId: d.id, ...d.data() }));
  } catch (err) {
    return [];
  }
}


async function renderLeaderboard() {
  const container = document.getElementById('leaderboard-list');
  const rankEl    = document.getElementById('leaderboard-user-rank');
  const user      = auth.currentUser;
  if (!container) return;

  container.innerHTML = '<p class="loading">Loading leaderboard...</p>';

  const entries = await fetchLeaderboard();

  // Update league info card
  const timeLeft  = getTimeUntilNextWeek();
  const countdown = document.getElementById('league-countdown');
  if (countdown) countdown.textContent = `${timeLeft.days}d ${timeLeft.hours}h until league ends`;

  if (entries.length === 0) {
    container.innerHTML = '<p class="empty-state" style="padding:32px;text-align:center;">No scores yet this week. Be the first!</p>';
    return;
  }

  let html = '';
  entries.slice(0, 25).forEach((entry, i) => {
    const rank   = i + 1;
    const medal  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank;
    const isSelf = user && entry.userId === user.uid;
    const league = getUserLeague(entry.points, rank);
    const prize  = rank <= 3 ? '<span class="reward-badge">🏆 Prize</span>' : '';

    html += `<div class="leaderboard-row ${isSelf ? 'current-user' : ''}">
      <div class="leaderboard-rank">${medal}</div>
      <div class="leaderboard-name">${entry.name} ${prize}</div>
      <div class="leaderboard-points">${entry.points.toLocaleString()} XP</div>
    </div>`;
  });

  container.innerHTML = html;

  // Show user rank if outside top 25
  if (rankEl && user) {
    const userIdx = entries.findIndex(e => e.userId === user.uid);
    if (userIdx >= 25) {
      rankEl.innerHTML = `<div class="leaderboard-row current-user" style="margin-top:8px;border-top:2px dashed var(--border-light);padding-top:12px;">
        <div class="leaderboard-rank">#${userIdx+1}</div>
        <div class="leaderboard-name">${entries[userIdx].name} (You)</div>
        <div class="leaderboard-points">${entries[userIdx].points.toLocaleString()} XP</div>
      </div>`;
    } else if (rankEl) {
      rankEl.innerHTML = '';
    }

    // Update user's league badge
    if (userIdx >= 0) {
      const league = getUserLeague(0, userIdx + 1);
      updateLeagueBadges(league);
    }
  }
}
window.renderLeaderboard = renderLeaderboard;

// ============================================
// USER DASHBOARD & REWARDS
// ============================================

async function loadUserDashboard() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const doc  = await db.collection('users').doc(user.uid).get();
    if (!doc.exists) return;
    const data = doc.data();
    const el   = id => document.getElementById(id);

    // Mini dashboard on result screen
    if (el('dash-quizzes')) el('dash-quizzes').textContent = data.quizzesTaken || 0;
    if (el('dash-best'))    el('dash-best').textContent    = (data.bestScore || 0) + '%';
    if (el('dash-points'))  el('dash-points').textContent  = (data.totalXp || 0).toLocaleString();
    if (el('dash-streak'))  el('dash-streak').textContent  = data.currentStreak || 0;

    // Rewards screen
    if (el('reward-current-points')) el('reward-current-points').textContent = (data.totalXp || 0).toLocaleString();
    if (el('rewards-user-name'))     el('rewards-user-name').textContent     = data.name || '';
    if (el('current-level-label'))   el('current-level-label').textContent   = `Lv.${getLevelFromTotalXp(data.totalXp || 0)}`;
    if (el('next-level-label'))      el('next-level-label').textContent      = `Lv.${getLevelFromTotalXp(data.totalXp || 0) + 1}`;

    const progress = getXpProgress(data.totalXp || 0);
    if (el('reward-progress-fill')) el('reward-progress-fill').style.width = progress.pct + '%';

    const sentMilestones = await getSentMilestones(user.uid);
    updateRewardTiers(data.totalXp || 0, data.claimedMilestones || [], sentMilestones);
    await checkWeeklyTop3(user.uid);
  } catch (err) { console.error('loadUserDashboard error:', err); }
}

async function checkWeeklyTop3(userId) {
  try {
    const entries = await fetchLeaderboard();
    const rank    = entries.findIndex(e => e.userId === userId) + 1;
    const section = document.getElementById('reward-section');
    if (section) section.classList.toggle('hidden', !(rank > 0 && rank <= 3));
  } catch {}
}

// ============================================
// PROFILE v2
// ============================================

async function loadProfile() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const doc  = await db.collection('users').doc(user.uid).get();
    if (!doc.exists) return;
    const data   = doc.data();
    const joined = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : '-';
    const el     = id => document.getElementById(id);
    const totalXp   = data.totalXp || 0;
    const level     = getLevelFromTotalXp(totalXp);
    const progress  = getXpProgress(totalXp);

    if (el('profile-avatar'))    el('profile-avatar').textContent    = (data.name || 'U').charAt(0).toUpperCase();
    if (el('profile-name'))      el('profile-name').textContent      = data.name || 'User';
    if (el('profile-email'))     el('profile-email').textContent     = data.email || user.email;
    if (el('profile-joined'))    el('profile-joined').textContent    = 'Joined: ' + joined;
    if (el('profile-level-badge')) el('profile-level-badge').textContent = `Lv. ${level} — ${getLevelTitle(level)}`;

    // XP bar
    if (el('profile-xp-fill')) el('profile-xp-fill').style.width = progress.pct + '%';
    if (el('profile-xp-text')) el('profile-xp-text').textContent  = `${progress.current} / ${progress.needed} XP`;
    if (el('profile-total-xp')) el('profile-total-xp').textContent = `${totalXp.toLocaleString()} XP total`;

    // Stats
    if (el('profile-quizzes'))     el('profile-quizzes').textContent     = data.quizzesTaken || 0;
    if (el('profile-best'))        el('profile-best').textContent        = (data.bestScore || 0) + '%';
    if (el('profile-points'))      el('profile-points').textContent      = totalXp.toLocaleString();
    if (el('profile-streak'))      el('profile-streak').textContent      = data.currentStreak || 0;
    if (el('profile-badges-count')) el('profile-badges-count').textContent = (data.badges || []).length;

    // Achievements count
    const achs   = data.achievements || {};
    const achDone = Object.values(achs).filter(a => a.tier >= 0).length;
    if (el('profile-achievements')) el('profile-achievements').textContent = achDone;

    // Contact
    if (el('profile-phone'))   el('profile-phone').value   = data.phoneNumber || '';
    if (el('profile-network')) el('profile-network').value = data.networkProvider || '';

    // League badge
    const entries = await fetchLeaderboard();
    const rank    = entries.findIndex(e => e.userId === user.uid) + 1;
    if (rank > 0) {
      const league = getUserLeague(0, rank);
      const lgBadge = el('profile-league-badge');
      if (lgBadge) {
        lgBadge.textContent = `${league.icon} ${league.name}`;
        lgBadge.className   = 'league-badge-small ' + league.class;
      }
    }
  } catch (err) { console.error('loadProfile error:', err); }
}
window.loadProfile = loadProfile;

// ============================================
// QUIZ HISTORY SCREEN
// ============================================

async function loadQuizHistory() {
  const user = auth.currentUser;
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  if (!user || !list) return;

  list.innerHTML = '<p class="loading">Loading your history...</p>';

  try {
    const filter = document.getElementById('history-filter')?.value || 'all';
    let query    = db.collection('quizAttempts')
                     .where('userId', '==', user.uid)
                     .orderBy('timestamp', 'desc')
                     .limit(50);

    const snap = await query.get();

    if (snap.empty) {
      list.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }

    const now      = new Date();
    const weekAgo  = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1);

    let items = [];
    snap.forEach(doc => {
      const d  = doc.data();
      const ts = d.timestamp ? d.timestamp.toDate() : new Date();
      if (filter === 'week'  && ts < weekAgo)  return;
      if (filter === 'month' && ts < monthAgo) return;
      items.push({ ...d, ts });
    });

    if (items.length === 0) {
      list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px;">No quizzes found for this period.</p>';
      return;
    }

    list.innerHTML = items.map(d => {
      const pct       = d.percentage || 0;
      const scoreClass = pct >= 70 ? 'high' : pct >= 50 ? 'medium' : 'low';
      const m = Math.floor((d.timeLeft||0)/60), s = (d.timeLeft||0)%60;
      const dateStr = d.ts.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
      return `<div class="history-item">
        <div class="history-score ${scoreClass}">${pct}%</div>
        <div class="history-details">
          <h4>${d.score || 0} / ${d.totalQuestions || 15} correct</h4>
          <p>${dateStr} &nbsp;•&nbsp; ⏱ ${m}:${String(s).padStart(2,'0')} left</p>
        </div>
        <div class="history-xp">+${d.xpEarned || d.points || 0} XP</div>
      </div>`;
    }).join('');

    if (empty) empty.classList.add('hidden');
  } catch (err) {
    console.error('loadQuizHistory error:', err);
    list.innerHTML = '<p style="text-align:center;color:var(--danger);padding:24px;">Error loading history.</p>';
  }
}
window.loadQuizHistory = loadQuizHistory;

// ============================================
// BADGES SCREEN
// ============================================

async function loadBadges() {
  const user = auth.currentUser;
  const grid = document.getElementById('badges-grid');
  if (!user || !grid) return;

  try {
    const doc    = await db.collection('users').doc(user.uid).get();
    const data   = doc.data() || {};
    const earned = data.badges || [];
    const monthMap = data.monthQuizCount || {};
    const today    = new Date();
    const thisMonth = today.getMonth();
    const thisKey   = `${today.getFullYear()}-${thisMonth}`;
    const thisCount = monthMap[thisKey] || 0;

    grid.innerHTML = MONTHLY_BADGES.map(badge => {
      const badgeId    = `badge-${badge.month}`;
      const isEarned   = earned.includes(badgeId);
      const isCurrent  = badge.month === thisMonth && !isEarned;
      const progress   = badge.month === thisMonth ? thisCount : (isEarned ? 10 : 0);
      const stateClass = isEarned ? 'earned' : isCurrent ? 'current' : 'locked';
      const monthName  = new Date(2024, badge.month, 1).toLocaleString('default', { month: 'long' });

      return `<div class="badge-item ${stateClass}" data-month="${badge.month}">
        <div class="badge-emoji">${badge.emoji}</div>
        <div class="badge-name">${badge.name}</div>
        <div class="badge-month">${monthName}</div>
        <div class="badge-progress">${Math.min(progress, 10)}/10</div>
        ${isEarned ? '<div style="font-size:11px;color:var(--success);font-weight:700">✅ Earned</div>' : ''}
      </div>`;
    }).join('');
  } catch (err) { console.error('loadBadges error:', err); }
}
window.loadBadges = loadBadges;

// ============================================
// ACHIEVEMENTS SCREEN
// ============================================

async function loadAchievements() {
  const user = auth.currentUser;
  const list = document.getElementById('achievements-list');
  const prog = document.getElementById('achievements-progress');
  if (!user || !list) return;

  try {
    const doc    = await db.collection('users').doc(user.uid).get();
    const data   = doc.data() || {};
    const achs   = data.achievements || {};
    let doneCount = 0;

    list.innerHTML = ACHIEVEMENTS.map(ach => {
      const info     = achs[ach.id] || { tier: -1, value: 0 };
      const value    = data[ach.field] || info.value || 0;
      const curTier  = getAchievementTierIndex(ach, value);
      const nextTier = curTier + 1;
      const isDone   = curTier >= ach.tiers.length - 1;
      if (isDone) doneCount++;

      const tiersHtml = ach.tiers.map((t, i) => {
        const cls = i <= curTier ? 'done' : i === nextTier ? 'current' : '';
        return `<span class="tier ${cls}" title="${t}">${t}</span>`;
      }).join('');

      const nextTarget = nextTier < ach.tiers.length ? ach.tiers[nextTier] : ach.tiers[ach.tiers.length - 1];
      const progressText = isDone
        ? `${value} ✅`
        : `${Math.min(value, nextTarget)} / ${nextTarget}`;

      return `<div class="achievement-item ${isDone ? 'completed' : ''}">
        <div class="achievement-icon">${ach.icon}</div>
        <div class="achievement-info">
          <h4>${ach.name}</h4>
          <p>${ach.desc}</p>
          <div class="achievement-tiers">${tiersHtml}</div>
        </div>
        <div class="achievement-progress">${progressText}</div>
      </div>`;
    }).join('');

    if (prog) prog.textContent = `${doneCount} / ${ACHIEVEMENTS.length} completed`;
  } catch (err) { console.error('loadAchievements error:', err); }
}
window.loadAchievements = loadAchievements;

// ============================================
// SETTINGS SCREEN
// ============================================

function loadSettings() {
  const darkToggle  = document.getElementById('dark-mode-toggle');
  const soundToggle = document.getElementById('sound-toggle');
  if (darkToggle)  darkToggle.checked  = document.documentElement.getAttribute('data-theme') === 'dark';
  if (soundToggle) soundToggle.checked = soundEnabled;
}
window.loadSettings = loadSettings;

// ============================================
// REWARD TIERS
// ============================================

async function getSentMilestones(userId) {
  try {
    const snap = await db.collection('rewardClaims')
      .where('userId','==',userId)
      .where('type','==','milestone')
      .where('status','==','sent')
      .get();
    const sent = [];
    snap.forEach(d => { if (d.data().tier) sent.push(d.data().tier); });
    return sent;
  } catch { return []; }
}
window.getSentMilestones = getSentMilestones;

function updateRewardTiers(xp, claimedMilestones, sentMilestones) {
  const tiers = [
    { threshold: 5000,  reward: '1GB',   id: 'tier-5000',  dataReward: '1GB Data'  },
    { threshold: 10000, reward: '2.5GB', id: 'tier-10000', dataReward: '2.5GB Data'},
    { threshold: 20000, reward: '5GB',   id: 'tier-20000', dataReward: '5GB Data'  },
  ];

  tiers.forEach(tier => {
    const el   = document.getElementById(tier.id);
    const card = el?.closest('.reward-tier');
    if (!el) return;

    const unlocked = xp >= tier.threshold;
    const claimed  = (claimedMilestones || []).includes(tier.threshold);
    const sent     = (sentMilestones    || []).includes(tier.threshold);

    if (sent) { if (card) card.style.display = 'none'; return; }
    if (card)  card.style.display = '';

    if (claimed) {
      el.textContent = 'Claimed — Pending ⏳';
      el.style.cssText = 'background:#fef3c7;color:#92400e;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:700;border:1px solid #fbbf24;';
    } else if (unlocked) {
      el.innerHTML = `<button onclick="claimMilestoneReward(${tier.threshold},'${tier.dataReward}')" class="primary-btn" style="padding:8px 18px;font-size:13px;border-radius:10px;">Claim ${tier.reward}</button>`;
    } else {
      const remaining = (tier.threshold - xp).toLocaleString();
      el.textContent = `${remaining} XP to go 🔒`;
      el.style.cssText = 'background:#f1f5f9;color:#64748b;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:700;';
    }
  });
}
window.updateRewardTiers = updateRewardTiers;

async function claimMilestoneReward(threshold, rewardType) {
  const user = auth.currentUser;
  if (!user) { showToast('Please login to claim your reward', 'error'); return; }

  try {
    const userRef = db.collection('users').doc(user.uid);
    const userDoc = await userRef.get();
    const data    = userDoc.data() || {};
    const claimed = data.claimedMilestones || [];

    if (claimed.includes(threshold)) { showToast('Already claimed!', 'info'); return; }
    if (!data.phoneNumber || !data.networkProvider) {
      showToast('Please complete your profile before claiming', 'error');
      navigateTo('profile'); return;
    }

    await db.collection('rewardClaims').add({
      userId: user.uid, userName: user.displayName || data.name || 'User',
      email: data.email || user.email, phone: data.phoneNumber,
      network: data.networkProvider, rewardType, tier: threshold,
      type: 'milestone', status: 'pending', week: getCurrentWeekId(),
      claimedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await userRef.update({ claimedMilestones: firebase.firestore.FieldValue.arrayUnion(threshold) });
    showToast('Reward claimed! Admin will send it shortly. 🎁', 'success');
    await loadUserDashboard();
  } catch (err) { showToast('Error claiming reward. Please try again.', 'error'); }
}
window.claimMilestoneReward = claimMilestoneReward;

// ============================================
// DAILY QUIZ LIMIT (2 per day)
// ============================================

async function checkDailyQuizLimit() {
  const user = auth.currentUser;
  if (!user) return { blocked: true, remaining: 0, reason: 'not_logged_in' };
  
  try {
    const now = new Date();
    
    // Get all attempts for this user, ordered by newest first
    const snap = await db.collection('quizAttempts')
      .where('userId', '==', user.uid)
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();

    let takenToday = 0;
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth();
    const todayDate = now.getDate();
    
    snap.forEach(doc => {
      const data = doc.data();
      const ts = data.timestamp;
      if (ts && ts.toDate) {
        const d = ts.toDate();
        // Check if same calendar day
        if (d.getFullYear() === todayYear && 
            d.getMonth() === todayMonth && 
            d.getDate() === todayDate) {
          takenToday++;
        }
      }
    });

    const remaining = Math.max(0, 2 - takenToday);
    
    if (remaining <= 0) {
      const tomorrow = new Date(todayYear, todayMonth, todayDate + 1);
      const msUntil = tomorrow - now;
      return { 
        blocked: true, 
        nextQuizTime: tomorrow, 
        msUntilMidnight: msUntil, 
        takenToday: takenToday, 
        remaining: 0 
      };
    }
    
    return { blocked: false, takenToday: takenToday, remaining: remaining };
    
  } catch (err) {
    console.error('checkDailyQuizLimit error:', err);
    // FAIL OPEN — let them quiz if check breaks
    return { blocked: false, takenToday: 0, remaining: 2, reason: 'check_failed' };
  }
}

// ============================================
// BEGIN QUIZ GATEKEEPER
// ============================================

async function handleBeginQuiz() {
  const user = auth.currentUser;
  if (!user) { showAuthModal(); return; }

  try {
    const doc  = await db.collection('users').doc(user.uid).get();
    const data = doc.data() || {};
    if (!data.phoneNumber || !data.networkProvider) {
      showRequiredProfileModal();
      showToast('📱 Please complete your profile first', 'error');
      return;
    }
  } catch {}

  const btn = document.getElementById('begin-test-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }

  const limit = await checkDailyQuizLimit();
  if (btn) { btn.disabled = false; btn.textContent = '📝 Begin Test'; }

  if (limit.blocked) {
    if (limit.reason === 'check_failed') {
      showToast('⚠️ Could not verify daily limit. Proceeding...', 'info');
    } else {
      showDailyLimitMessage(limit); return;
    }
  }

  showScreen('quiz');
  if (typeof window.startQuiz === 'function') window.startQuiz();
}
window.handleBeginQuiz = handleBeginQuiz;

function resumeQuiz() {
  showScreen('quiz');
  if (typeof window.startQuiz === 'function') window.startQuiz();
}
window.resumeQuiz = resumeQuiz;

// ============================================
// NEW WEEK BANNER
// ============================================

function checkNewWeekBanner() {
  const lastSeen = localStorage.getItem('lastSeenWeek');
  const current  = getCurrentWeekId();
  if (lastSeen !== current) {
    showNewWeekBanner(current);
    localStorage.setItem('lastSeenWeek', current);
  }
}

function showNewWeekBanner(weekId) {
  const existing = document.getElementById('new-week-banner');
  if (existing) existing.remove();

  const { days, hours } = getTimeUntilNextWeek();
  const banner = document.createElement('div');
  banner.id = 'new-week-banner';
  banner.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:10000;
    background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;
    padding:14px 24px;text-align:center;font-weight:600;font-size:15px;
    font-family:'Inter',sans-serif;box-shadow:0 4px 20px rgba(99,102,241,.3);
    animation:slideDown .5s ease;
  `;
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;">
      <span>🎉</span>
      <span>Welcome to <strong>Week ${getDisplayWeek()}</strong>! Leaderboard reset. ${days}d ${hours}h until next reset.</span>
      <button onclick="document.getElementById('new-week-banner').remove()" style="background:rgba(255,255,255,.2);border:none;color:white;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">Dismiss</button>
    </div>`;
  document.body.appendChild(banner);
  setTimeout(() => { if (banner.parentNode) banner.remove(); }, 10000);
}

// ============================================
// REQUIRED PROFILE MODAL
// ============================================

function showRequiredProfileModal() {
  const modal = document.getElementById('profile-required-modal');
  if (modal) modal.classList.remove('hidden');
}

// ============================================
// LEADERBOARD CHALLENGE (Architecture stub)
// ============================================

function showChallengeModal() {
  showToast('🚀 Head-to-Head Challenges coming soon!', 'info');
}
window.showChallengeModal = showChallengeModal;

// ============================================
// WEEKLY ARCHIVE (Admin)
// ============================================

async function archiveWeeklyWinners() {
  const { previousWeekId } = getWeekInfo();
  if (!previousWeekId) { showToast('No previous week to archive', 'info'); return; }

  try {
    const doc = await db.collection('leaderboard').doc(previousWeekId).get();
    if (!doc.exists) { showToast('No leaderboard data for ' + previousWeekId, 'info'); return; }

    const entries = doc.data().entries || [];
    const top3    = entries.slice(0, 3);
    const rewards = ['2GB Data', '1GB Data', '500MB Data'];

    await db.collection('weeklyWinners').doc(previousWeekId).set({
      week: previousWeekId, archivedAt: firebase.firestore.FieldValue.serverTimestamp(),
      winners: top3.map((e, i) => ({ rank:i+1, userId:e.userId, name:e.name, points:e.points, reward:rewards[i] }))
    });

    for (let i = 0; i < top3.length; i++) {
      const winner  = top3[i];
      const userDoc = await db.collection('users').doc(winner.userId).get();
      const ud      = userDoc.exists ? userDoc.data() : {};
      const exists  = await db.collection('rewardClaims')
        .where('userId','==',winner.userId).where('week','==',previousWeekId).where('type','==','weekly').get();
      if (exists.empty) {
        await db.collection('rewardClaims').add({
          userId: winner.userId, userName: winner.name, email: ud.email || '',
          phone: ud.phoneNumber || '', network: ud.networkProvider || '',
          rewardType: rewards[i], type: 'weekly', status: 'pending',
          week: previousWeekId, rank: i+1, points: winner.points,
          claimedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    }
    showToast(`${previousWeekId} archived! ${top3.length} winners processed.`, 'success');
  } catch (err) { showToast('Error archiving week. Check console.', 'error'); console.error(err); }
}
window.archiveWeeklyWinners = archiveWeeklyWinners;

// ============================================
// BEST SCORE RECALCULATION
// ============================================

async function recalculateUserBestScore(userId) {
  const snap = await db.collection('quizAttempts').where('userId','==',userId).get();
  let max = 0;
  snap.forEach(d => {
    const p = d.data().percentage || Math.round((d.data().score / d.data().totalQuestions) * 100) || 0;
    if (p > max) max = p;
  });
  await db.collection('users').doc(userId).update({ bestScore: max, bestScoreFormat: 'percentage' });
  return max;
}
window.recalculateUserBestScore = recalculateUserBestScore;

// ============================================
// QUESTION HISTORY (7-day cooldown)
// ============================================

async function getQuizQuestions(allQuestions, count) {
  count = count || 15;
  const user = auth.currentUser;
  if (!user || !Array.isArray(allQuestions) || allQuestions.length === 0) {
    return shuffleArr(allQuestions).slice(0, Math.min(count, allQuestions.length));
  }

  try {
    const userRef = db.collection('users').doc(user.uid);
    const doc     = await userRef.get();
    const history = (doc.data() || {}).questionHistory || [];
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const recentSeen = new Set();
    const pruned     = [];
    history.forEach(h => {
      const ts = h.seenAt?.toDate ? h.seenAt.toDate() : new Date(h.seenAt);
      if (ts > oneWeekAgo) { recentSeen.add(h.question); pruned.push(h); }
    });

    let available = allQuestions.filter(q => !recentSeen.has(q.question));
    if (available.length < count) available = allQuestions;

    const selected = shuffleArr(available).slice(0, count);
    const newHistory = selected.map(q => ({
      question: q.question,
      seenAt: firebase.firestore.FieldValue.serverTimestamp()
    }));

    await userRef.update({ questionHistory: [...pruned, ...newHistory] });
    return selected;
  } catch (err) {
    return shuffleArr(allQuestions).slice(0, Math.min(count, allQuestions.length));
  }
}

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
window.getQuizQuestions = getQuizQuestions;

// ============================================
// NOTIFICATIONS
// ============================================

function checkNotificationStatus() {
  if (!auth.currentUser) return;
  if (Notification.permission === 'granted') { scheduleDailyReminder(); return; }
  // Don't aggressively prompt — only on first use
  const dismissed = localStorage.getItem('sq_notif_dismissed');
  if (!dismissed) showNotificationModal();
}

function showNotificationModal() {
  const modal = document.getElementById('notification-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const btn = document.getElementById('enable-notify-btn');
  if (btn) {
    btn.onclick = async () => {
      const perm = await Notification.requestPermission();
      modal.classList.add('hidden');
      if (perm === 'granted') {
        scheduleDailyReminder();
        showToast('✅ Notifications enabled!', 'success');
      } else {
        localStorage.setItem('sq_notif_dismissed', '1');
        showToast('Notifications declined. You can enable them in Settings.', 'info');
      }
    };
  }
}

function scheduleDailyReminder() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function showBrowserNotification(title, body) {
  if (Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(reg => {
    reg.showNotification(title, { body, tag: 'scripture-quest', requireInteraction: false });
  }).catch(() => {});
}

// ============================================
// EVENT LISTENERS
// ============================================

function attachEventListeners() {
  const loginForm    = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const authBtn      = document.getElementById('auth-btn');

  if (authBtn)      authBtn.addEventListener('click', showAuthModal);
  if (loginForm)    loginForm.addEventListener('submit', handleLogin);
  if (registerForm) registerForm.addEventListener('submit', handleRegister);

  // Begin / Resume
  const beginBtn  = document.getElementById('begin-test-btn');
  const resumeBtn = document.getElementById('resume-quiz-btn');
  if (beginBtn)  beginBtn.addEventListener('click', handleBeginQuiz);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeQuiz);

  // Dark mode & sound state init
  initDarkMode();
  const soundIcon = document.getElementById('sound-icon');
  if (soundIcon) soundIcon.className = soundEnabled ? 'fas fa-volume-up' : 'fas fa-volume-mute';
}

// ============================================
// AUTH STATE
// ============================================

auth.onAuthStateChanged(user => {
  if (user) {
    updateUIForLoggedInUser(user);
    loadUserDashboard();
    authModalShown = false;
    hideAuthModal();
  } else {
    const el = id => document.getElementById(id);
    if (el('auth-section'))    el('auth-section').classList.remove('hidden');
    if (el('welcome-section')) el('welcome-section').classList.add('hidden');
    if (el('fixed-logout-btn')) el('fixed-logout-btn').classList.add('hidden');
    if (el('bottom-nav'))       el('bottom-nav').classList.add('hidden');
    if (el('wisdom-mascot'))    el('wisdom-mascot').classList.add('hidden');

    showScreen('landing');
    if (!authModalShown) {
      setTimeout(() => { if (!auth.currentUser) showAuthModal(); }, 400);
    }
  }
});

// ============================================
// INIT
// ============================================

auth.setPersistence(firebase.auth.Auth.Persistence.NONE)
  .then(() => console.log('Auth persistence: NONE'))
  .catch(console.error);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachEventListeners);
} else {
  attachEventListeners();
}

console.log('🕊️ ScriptureQuest firebase.js v4 loaded — XP • Levels • Quests • Badges • Achievements • Leagues');
