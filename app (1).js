// ═══════════════════════════════════════════
// STUDYGOLD — app.js
// All persistence bugs fixed:
//  1. Data loaded before anything runs
//  2. seedDemo guarded by persistent _seeded flag
//  3. save() always writes live data object
//  4. PIN read from loaded data, not defaults
// ═══════════════════════════════════════════

const STORAGE_KEY = 'studygold_v2';

const QUOTES = [
  "Consistency beats perfection.",
  "One session at a time.",
  "You're building your future.",
  "Progress, not perfection.",
  "Every minute of study counts.",
  "Small steps, big results.",
  "Show up for yourself today.",
  "Your future self will thank you.",
  "Discipline is a form of self-love.",
  "You are capable of more than you know."
];

// ── Data ──────────────────────────────────
// Single source of truth. Loaded once at boot, never reset.
let data = null;

function defaultData() {
  return {
    subjects: [], homework: [], schedule: [], slots: [],
    scheduleOverrides: [], difficulty: [], studyLog: [],
    streak: 0, lastStudyDate: null, weekStartDate: null,
    settings: { pin: '1234', maxHours: 6, breakReminder: true, resetDay: 1, reminders: {} },
    _seeded: false
  };
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const d = defaultData();
      Object.assign(d, parsed);
      ['subjects','homework','schedule','slots','scheduleOverrides','difficulty','studyLog'].forEach(k => {
        if (!Array.isArray(d[k])) d[k] = [];
      });
      if (!d.settings || typeof d.settings !== 'object') d.settings = defaultData().settings;
      if (!d.settings.reminders) d.settings.reminders = {};
      return d;
    }
  } catch(e) { console.error('loadFromStorage:', e); }
  return defaultData();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch(e) { console.error('save:', e); }
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ── Focus & UI state ──────────────────────
let focusState = { active:false, paused:false, subjectId:null, topicId:null, topic:'', totalSecs:0, remainingSecs:0, interval:null };
let sessionDraft = { subjectId:null, topic:'', minutes:25 };
let hwFilter = 'all';
let schedView = 'week';
let schedDaySelected = new Date().getDay();

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Load data first — synchronously — before anything else
  data = loadFromStorage();

  if (sessionStorage.getItem('unlocked') === '1') {
    document.getElementById('lockScreen').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    initApp();
  } else {
    document.getElementById('lockScreen').style.display = 'flex';
  }

  // Close modals on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('active'); });
  });

  if ('Notification' in window) Notification.requestPermission();
});

function initApp() {
  // Seed demo ONLY on first ever launch — _seeded persists in localStorage
  if (!data._seeded) {
    data._seeded = true;
    if (data.subjects.length === 0) {
      const now = new Date();
      const fmt = d => d.toISOString().split('T')[0];
      const d1 = new Date(now); d1.setDate(d1.getDate() + 1);
      const d2 = new Date(now); d2.setDate(d2.getDate() + 3);
      data.subjects = [
        { id:uid(), name:'Mathematics', icon:'📐', color:'#c9a84c', goal:'2025-12-01',
          topics:[{id:uid(),name:'Quadratic Equations',done:false},{id:uid(),name:'Trigonometry',done:false},{id:uid(),name:'Calculus Intro',done:false}], studyMins:0 },
        { id:uid(), name:'Biology', icon:'🧬', color:'#4a8c5c', goal:'2025-11-01',
          topics:[{id:uid(),name:'Cell Structure',done:true},{id:uid(),name:'Photosynthesis',done:false},{id:uid(),name:'Genetics',done:false}], studyMins:0 },
        { id:uid(), name:'English', icon:'📖', color:'#4a6c8c', goal:'2025-11-15',
          topics:[{id:uid(),name:'Essay Structure',done:false},{id:uid(),name:'Poetry Analysis',done:false}], studyMins:0 },
      ];
      data.homework = [
        { id:uid(), title:'Algebra Problem Set', subjectId:data.subjects[0].id, due:fmt(d1), priority:'high', status:'todo', created:Date.now() },
        { id:uid(), title:'Cell Diagram Worksheet', subjectId:data.subjects[1].id, due:fmt(d2), priority:'med', status:'inprog', created:Date.now() },
      ];
    }
    save();
  }
  checkWeeklyReset();
  checkStreak();
  renderToday();
  loadSettings();
  scheduleReminders();
}

// ═══════════════════════════════════════════
// LOCK SCREEN
// ═══════════════════════════════════════════
let pinEntry = '';

function pinPress(n) { if (pinEntry.length >= 4) return; pinEntry += n; updateDots(); }
function pinClear() { pinEntry = pinEntry.slice(0, -1); updateDots(); }
function updateDots() {
  document.querySelectorAll('.lock-dot').forEach((d, i) => {
    d.classList.toggle('filled', i < pinEntry.length);
    d.classList.remove('error');
  });
}
function pinSubmit() {
  const pin = (data && data.settings && data.settings.pin) || '1234';
  if (pinEntry === pin) {
    sessionStorage.setItem('unlocked', '1');
    document.getElementById('lockScreen').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    initApp();
  } else {
    document.querySelectorAll('.lock-dot').forEach(d => { d.classList.add('error'); d.classList.remove('filled'); });
    pinEntry = '';
    setTimeout(() => document.querySelectorAll('.lock-dot').forEach(d => d.classList.remove('error')), 800);
  }
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function switchScreen(id, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  if (btn) btn.classList.add('active');
  renderScreen(id);
}
function renderScreen(id) {
  if (id === 'today') renderToday();
  else if (id === 'week') renderWeekGlance();
  else if (id === 'schedule') renderSchedule();
  else if (id === 'subjects') renderSubjects();
  else if (id === 'homework') renderHomework();
  else if (id === 'progress') renderProgress();
}

// ═══════════════════════════════════════════
// TODAY
// ═══════════════════════════════════════════
function renderToday() {
  const now = new Date();
  document.getElementById('todayDate').textContent = now.toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'});
  document.getElementById('streakCount').textContent = data.streak || 0;
  document.getElementById('todayQuote').textContent = '"' + QUOTES[now.getDay() % QUOTES.length] + '"';

  const todayStr = now.toISOString().split('T')[0];
  const soonHw = (data.homework || []).filter(h => h.status !== 'done' && h.due <= addDays(todayStr, 2)).slice(0, 3);

  let tasksHtml = '';
  if (soonHw.length) {
    soonHw.forEach(h => {
      const subj = data.subjects.find(s => s.id === h.subjectId);
      const overdue = h.due < todayStr;
      tasksHtml += `<div class="task-pill" onclick="updateHwStatus('${h.id}')">
        <div class="task-pill-dot ${h.status === 'done' ? 'done' : ''}"></div>
        <div class="task-pill-text ${h.status === 'done' ? 'done' : ''}">${h.title}${overdue ? ' ⚠️' : ''}</div>
        <div style="font-size:0.7rem;color:var(--text-muted)">${subj ? subj.name : ''}</div>
      </div>`;
    });
  }
  if (!tasksHtml) {
    data.subjects.slice(0, 2).forEach(s => {
      const next = s.topics.find(t => !t.done);
      if (next) tasksHtml += `<div class="task-pill"><div class="task-pill-dot"></div><div class="task-pill-text">${next.name} — ${s.name}</div></div>`;
    });
  }
  if (!tasksHtml) tasksHtml = `<div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">🎉 All caught up! Add subjects to get started.</div>`;

  const hw = (data.homework || []).filter(h => h.status !== 'done' && h.due <= addDays(todayStr, 2));
  document.getElementById('todayHeroSub').textContent = hw.length ? `${hw.length} assignment${hw.length > 1 ? 's' : ''} due soon` : 'Keep the momentum going!';
  document.getElementById('todayTasks').innerHTML = tasksHtml;

  const todayMins = getTodayStudyMins();
  const maxMins = (data.settings.maxHours || 6) * 60;
  const pct = Math.min(100, (todayMins / maxMins) * 100);
  document.getElementById('burnoutFill').style.width = pct + '%';
  document.getElementById('burnoutLabel').textContent = `${Math.round(todayMins / 60 * 10) / 10}h / ${data.settings.maxHours || 6}h`;

  const burnoutMsg = document.getElementById('burnoutMsg');
  burnoutMsg.innerHTML = pct >= 100
    ? `<div class="card" style="text-align:center;padding:16px;border-color:var(--gold-dim)"><div style="font-size:1.2rem">🌿</div><div style="font-size:0.85rem;margin-top:6px;color:var(--text-dim)">You've done enough for today.<br>Rest is productive too.</div></div>`
    : '';

  renderSuggestions();

  const dueEl = document.getElementById('dueToday');
  const urgent = (data.homework || []).filter(h => h.status !== 'done' && h.due <= addDays(todayStr, 3)).sort((a, b) => a.due.localeCompare(b.due));
  if (urgent.length) {
    dueEl.innerHTML = urgent.map(h => {
      const subj = data.subjects.find(s => s.id === h.subjectId);
      const overdue = h.due < todayStr;
      const daysLeft = daysBetween(todayStr, h.due);
      return `<div class="hw-item ${overdue ? 'overdue' : ''}" style="margin:6px 16px">
        <div class="hw-left">
          <div class="hw-title">${h.title}</div>
          <div class="hw-meta">
            <span>${subj ? subj.name : 'Unknown'}</span>
            <span class="hw-due ${daysLeft <= 1 ? 'soon' : ''}">${overdue ? '⚠️ Overdue' : daysLeft === 0 ? 'Due today' : daysLeft === 1 ? 'Due tomorrow' : 'Due in ' + daysLeft + ' days'}</span>
          </div>
        </div>
        <span class="chip chip-${h.status === 'done' ? 'done' : h.status === 'inprog' ? 'prog' : 'todo'}">${h.status === 'done' ? 'Done' : h.status === 'inprog' ? 'In Progress' : 'To Do'}</span>
      </div>`;
    }).join('');
  } else {
    dueEl.innerHTML = `<div style="padding:10px 20px;color:var(--text-muted);font-size:0.82rem">✓ No urgent assignments</div>`;
  }
}

function renderSuggestions() {
  const todayStr = new Date().toISOString().split('T')[0];
  const suggestions = [];
  const hardSubjs = {};
  (data.difficulty || []).filter(d => d.level === 'hard').forEach(d => { hardSubjs[d.subjectId] = (hardSubjs[d.subjectId] || 0) + 1; });
  Object.entries(hardSubjs).sort((a, b) => b[1] - a[1]).slice(0, 1).forEach(([sid]) => {
    const s = data.subjects.find(x => x.id === sid);
    if (s) suggestions.push({ text: `You struggled with ${s.name} → consider studying it today` });
  });
  (data.subjects || []).forEach(s => {
    const logs = (data.studyLog || []).filter(l => l.subjectId === s.id);
    if (!logs.length) { suggestions.push({ text: `You haven't started ${s.name} yet` }); return; }
    const last = logs.map(l => l.date).sort().reverse()[0];
    const diff = daysBetween(last, todayStr);
    if (diff >= 3) suggestions.push({ text: `You haven't studied ${s.name} in ${diff} days` });
  });
  const el = document.getElementById('suggestions');
  if (!suggestions.length) {
    el.innerHTML = `<div class="suggestion-card"><svg viewBox="0 0 24 24" style="stroke:var(--green)"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>You're on track — keep it up!</div>`;
    return;
  }
  el.innerHTML = suggestions.slice(0, 3).map(s => `<div class="suggestion-card"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${s.text}</div>`).join('');
}

// ═══════════════════════════════════════════
// SESSION FLOW
// ═══════════════════════════════════════════
function openSessionModal() { populateSubjectSelects(); openModal('sessionModal'); sessionNext(0); }
function sessionNext(step) {
  [0, 1, 2].forEach(i => {
    document.getElementById('sessionStep' + i).style.display = i === step ? 'block' : 'none';
    document.getElementById('sdot' + i).classList.toggle('active', i === step);
    document.getElementById('sdot' + i).classList.toggle('done', i < step);
  });
  if (step === 1) populateTopicSelect();
}
function populateTopicSelect() {
  const sid = document.getElementById('sessSubjSelect').value;
  sessionDraft.subjectId = sid;
  const subj = data.subjects.find(s => s.id === sid);
  const sel = document.getElementById('sessTopicSelect');
  sel.innerHTML = '<option value="">-- Select topic --</option>';
  if (subj) subj.topics.filter(t => !t.done).forEach(t => { sel.innerHTML += `<option value="${t.id}">${t.name}</option>`; });
}
function selectPreset(el, mins) {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  sessionDraft.minutes = mins;
  document.getElementById('customTimeWrap').style.display = mins === 0 ? 'block' : 'none';
}
function launchFocus() {
  const sid = document.getElementById('sessSubjSelect').value;
  const topicId = document.getElementById('sessTopicSelect').value;
  const customTopic = document.getElementById('sessCustomTopic').value.trim();
  let mins = sessionDraft.minutes;
  if (mins === 0) mins = parseInt(document.getElementById('customMins').value) || 25;
  const subj = data.subjects.find(s => s.id === sid);
  let topicName = customTopic;
  if (!topicName && topicId) { const t = subj?.topics.find(t => t.id === topicId); topicName = t?.name || ''; }
  if (!topicName) topicName = 'Study Session';
  closeModal('sessionModal');
  startFocusMode(sid, topicId, topicName, mins);
}

// ═══════════════════════════════════════════
// FOCUS MODE
// ═══════════════════════════════════════════
function startFocusMode(subjectId, topicId, topicName, minutes) {
  const subj = data.subjects.find(s => s.id === subjectId);
  document.getElementById('focusSubjectLabel').textContent = subj?.name || '';
  document.getElementById('focusTaskLabel').textContent = topicName;
  focusState = { active:true, paused:false, subjectId, topicId, topic:topicName, totalSecs:minutes*60, remainingSecs:minutes*60, interval:null };
  updateFocusDisplay();
  document.getElementById('focusMode').classList.add('active');
  document.getElementById('focusPauseBtn').textContent = 'Pause';
  document.getElementById('focusBreakMsg').textContent = '';
  focusState.interval = setInterval(focusTick, 1000);
}
function focusTick() {
  if (focusState.paused) return;
  focusState.remainingSecs--;
  updateFocusDisplay();
  if (focusState.remainingSecs <= 0) { clearInterval(focusState.interval); completeSession(); }
}
function updateFocusDisplay() {
  const s = focusState.remainingSecs;
  const m = Math.floor(s / 60), sec = s % 60;
  document.getElementById('focusTimerDisplay').textContent = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  const pct = 1 - s / focusState.totalSecs;
  document.getElementById('focusRingCircle').style.strokeDashoffset = 553 - pct * 553;
  document.getElementById('focusStatusText').textContent = focusState.paused ? 'PAUSED' : 'FOCUS';
}
function pauseResumeFocus() {
  focusState.paused = !focusState.paused;
  document.getElementById('focusPauseBtn').textContent = focusState.paused ? 'Resume' : 'Pause';
  document.getElementById('focusStatusText').textContent = focusState.paused ? 'PAUSED' : 'FOCUS';
}
function endFocusSession() {
  clearInterval(focusState.interval);
  const elapsedMins = Math.round((focusState.totalSecs - focusState.remainingSecs) / 60);
  if (elapsedMins >= 1) logStudySession(focusState.subjectId, focusState.topicId, elapsedMins);
  document.getElementById('focusMode').classList.remove('active');
  focusState.active = false;
  updateStreakAndSave();
  renderToday();
}
function completeSession() {
  logStudySession(focusState.subjectId, focusState.topicId, Math.round(focusState.totalSecs / 60));
  document.getElementById('focusStatusText').textContent = 'DONE!';
  document.getElementById('focusPauseBtn').textContent = 'Done';
  document.getElementById('focusBreakMsg').textContent = '✨ Session complete! Great work.';
  if (focusState.topicId) {
    const subj = data.subjects.find(s => s.id === focusState.subjectId);
    if (subj) { const t = subj.topics.find(t => t.id === focusState.topicId); if (t) t.done = true; }
  }
  updateStreakAndSave();
  showSparkles();
  setTimeout(() => { document.getElementById('focusMode').classList.remove('active'); focusState.active = false; renderToday(); }, 3000);
}
function logStudySession(subjectId, topicId, mins) {
  const today = new Date().toISOString().split('T')[0];
  data.studyLog.push({ date:today, subjectId, topicId, minutes:mins, ts:Date.now() });
  const subj = data.subjects.find(s => s.id === subjectId);
  if (subj) subj.studyMins = (subj.studyMins || 0) + mins;
  save();
}
function updateStreakAndSave() {
  const today = new Date().toISOString().split('T')[0];
  if (data.lastStudyDate !== today) {
    data.streak = data.lastStudyDate === addDays(today, -1) ? (data.streak || 0) + 1 : 1;
    data.lastStudyDate = today;
  }
  save();
}
function getTodayStudyMins() {
  const today = new Date().toISOString().split('T')[0];
  return (data.studyLog || []).filter(l => l.date === today).reduce((a, l) => a + l.minutes, 0);
}

// ═══════════════════════════════════════════
// SUBJECTS
// ═══════════════════════════════════════════
function renderSubjects() {
  const el = document.getElementById('subjectsList');
  if (!data.subjects.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📚</div><p>No subjects yet.<br>Tap "+ Add" to create your first subject.</p></div>`;
    return;
  }
  el.innerHTML = data.subjects.map(s => {
    const done = s.topics.filter(t => t.done).length;
    const total = s.topics.length;
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="subject-card">
      <div class="subject-card-header" onclick="toggleSubject('${s.id}')">
        <div class="subject-icon" style="background:${s.color}22;color:${s.color}">${s.icon || '📚'}</div>
        <div class="subject-info">
          <div class="subject-name">${s.name}</div>
          <div class="subject-goal">${s.goal ? 'Goal: ' + formatDate(s.goal) : ''} · ${done}/${total} topics</div>
        </div>
        <svg class="subject-prog-mini" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="20" fill="none" stroke="#1e1e1e" stroke-width="4"/>
          <circle cx="24" cy="24" r="20" fill="none" stroke="${s.color}" stroke-width="4"
            stroke-linecap="round" stroke-dasharray="${2*Math.PI*20}"
            stroke-dashoffset="${2*Math.PI*20*(1-pct/100)}" transform="rotate(-90 24 24)"/>
          <text x="24" y="24" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="${s.color}" font-family="DM Sans">${pct}%</text>
        </svg>
      </div>
      <div class="subject-body" id="subj-body-${s.id}">
        <div style="height:10px"></div>
        <div class="label">Topics & Chapters</div>
        ${s.topics.map(t => `
          <div class="topic-row">
            <div class="topic-check ${t.done ? 'checked' : ''}" onclick="toggleTopic('${s.id}','${t.id}')">
              <svg viewBox="0 0 12 12" ${t.done ? '' : 'style="display:none"'}><polyline points="2 6 5 9 10 3"/></svg>
            </div>
            <div class="topic-text ${t.done ? 'done' : ''}">${t.name}</div>
            <button onclick="deleteTopic('${s.id}','${t.id}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.85rem">×</button>
          </div>`).join('')}
        <div class="add-topic-row">
          <input type="text" id="newTopic-${s.id}" placeholder="Add topic…" onkeydown="if(event.key==='Enter')addTopic('${s.id}')">
          <button class="ghost-btn" onclick="addTopic('${s.id}')">+</button>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <div style="flex:1;background:var(--bg3);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:1.2rem;color:var(--gold);font-family:'Cormorant Garamond',serif">${Math.round((s.studyMins||0)/60*10)/10}h</div>
            <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">studied</div>
          </div>
          <div style="flex:1;background:var(--bg3);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:1.2rem;color:var(--gold);font-family:'Cormorant Garamond',serif">${pct}%</div>
            <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">complete</div>
          </div>
        </div>
        <button onclick="deleteSubject('${s.id}')" style="margin-top:12px;width:100%;background:none;border:1px solid #2a2a2a;color:var(--text-muted);padding:8px;border-radius:8px;cursor:pointer;font-size:0.8rem">Delete Subject</button>
      </div>
    </div>`;
  }).join('');
}

function toggleSubject(id) { document.getElementById('subj-body-' + id).classList.toggle('open'); }
function toggleTopic(sid, tid) {
  const s = data.subjects.find(x => x.id === sid); if (!s) return;
  const t = s.topics.find(x => x.id === tid);
  if (t) { t.done = !t.done; if (t.done) showSparkles(); }
  save(); renderSubjects();
}
function addTopic(sid) {
  const inp = document.getElementById('newTopic-' + sid);
  const name = inp.value.trim(); if (!name) return;
  const s = data.subjects.find(x => x.id === sid);
  if (s) { s.topics.push({ id:uid(), name, done:false }); save(); renderSubjects(); setTimeout(() => document.getElementById('subj-body-' + sid).classList.add('open'), 10); }
}
function deleteTopic(sid, tid) {
  const s = data.subjects.find(x => x.id === sid);
  if (s) { s.topics = s.topics.filter(t => t.id !== tid); save(); renderSubjects(); setTimeout(() => { const b = document.getElementById('subj-body-' + sid); if (b) b.classList.add('open'); }, 10); }
}
function deleteSubject(sid) {
  if (!confirm('Delete this subject?')) return;
  data.subjects = data.subjects.filter(s => s.id !== sid);
  save(); renderSubjects();
}
function saveSubject() {
  const name = document.getElementById('subjName').value.trim(); if (!name) return;
  const topicInputs = document.querySelectorAll('#multiTopicList .multi-topic-row input');
  const topics = [];
  topicInputs.forEach(inp => { const v = inp.value.trim(); if (v) topics.push({ id:uid(), name:v, done:false }); });
  data.subjects.push({ id:uid(), name, icon:document.getElementById('subjIcon').value || '📚', color:document.getElementById('subjColor').value, goal:document.getElementById('subjGoal').value, topics, studyMins:0 });
  save(); closeModal('subjModal'); renderSubjects();
  document.getElementById('subjName').value = ''; document.getElementById('subjIcon').value = ''; document.getElementById('subjGoal').value = '';
  document.getElementById('multiTopicList').innerHTML = '<div class="multi-topic-row"><input type="text" placeholder="Topic 1"><button onclick="removeTopicRow(this)">×</button></div>';
}
function addTopicRow() {
  const list = document.getElementById('multiTopicList'), count = list.querySelectorAll('.multi-topic-row').length + 1;
  const row = document.createElement('div'); row.className = 'multi-topic-row';
  row.innerHTML = `<input type="text" placeholder="Topic ${count}"><button onclick="removeTopicRow(this)">×</button>`;
  list.appendChild(row); row.querySelector('input').focus();
}
function removeTopicRow(btn) {
  const list = document.getElementById('multiTopicList');
  if (list.querySelectorAll('.multi-topic-row').length > 1) btn.parentElement.remove();
  else btn.previousElementSibling.value = '';
}

// ═══════════════════════════════════════════
// HOMEWORK
// ═══════════════════════════════════════════
function renderHomework() {
  populateSubjectSelects();
  const today = new Date().toISOString().split('T')[0];
  let hw = [...(data.homework || [])];
  if (hwFilter !== 'all') hw = hw.filter(h => h.status === hwFilter);
  hw.sort((a, b) => a.due.localeCompare(b.due));
  const el = document.getElementById('hwList');
  if (!hw.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✅</div><p>No assignments here.<br>${hwFilter === 'all' ? 'Tap "+ Add" to add homework.' : 'Try a different filter.'}</p></div>`;
    return;
  }
  el.innerHTML = hw.map(h => {
    const subj = data.subjects.find(s => s.id === h.subjectId);
    const overdue = h.due < today && h.status !== 'done';
    const daysLeft = daysBetween(today, h.due);
    return `<div class="hw-item ${overdue ? 'overdue' : ''}">
      <div class="hw-left">
        <div class="hw-title">${h.title}</div>
        <div class="hw-meta">
          <span>${subj ? subj.name : '—'}</span>
          <span class="hw-due ${daysLeft <= 1 && h.status !== 'done' ? 'soon' : ''}">${overdue ? '⚠️ Overdue' : h.due === today ? 'Due today' : daysLeft === 1 ? 'Due tomorrow' : formatDate(h.due)}</span>
        </div>
        <div style="margin-top:8px;display:flex;gap:6px">
          ${['todo','inprog','done'].map(s => `<button onclick="setHwStatus('${h.id}','${s}')" class="sched-btn" style="${h.status === s ? 'border-color:var(--gold-dim);color:var(--gold)' : ''}">${s === 'todo' ? 'To Do' : s === 'inprog' ? 'In Progress' : 'Done'}</button>`).join('')}
        </div>
      </div>
      <div class="hw-right">
        <div class="priority-dot priority-${h.priority}"></div>
        <span class="chip chip-${h.status === 'done' ? 'done' : h.status === 'inprog' ? 'prog' : 'todo'}" style="font-size:0.65rem">${h.priority}</span>
        <button class="hw-delete" onclick="deleteHw('${h.id}')">×</button>
      </div>
    </div>`;
  }).join('');
}
function filterHw(f, btn) {
  hwFilter = f;
  document.querySelectorAll('#hwFilters .preset-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  renderHomework();
}
function saveHw() {
  const title = document.getElementById('hwTitle').value.trim();
  const due = document.getElementById('hwDue').value;
  if (!title || !due) return;
  data.homework.push({ id:uid(), title, subjectId:document.getElementById('hwSubj').value, due, priority:document.getElementById('hwPriority').value, status:'todo', created:Date.now() });
  save(); closeModal('hwModal'); renderHomework();
  document.getElementById('hwTitle').value = ''; document.getElementById('hwDue').value = '';
}
function setHwStatus(id, status) {
  const h = data.homework.find(x => x.id === id);
  if (h) { h.status = status; if (status === 'done') showSparkles(); save(); renderHomework(); }
}
function updateHwStatus(id) {
  const h = data.homework.find(x => x.id === id); if (!h) return;
  const states = ['todo','inprog','done'];
  h.status = states[(states.indexOf(h.status) + 1) % 3];
  if (h.status === 'done') showSparkles();
  save(); renderToday();
}
function deleteHw(id) { data.homework = data.homework.filter(h => h.id !== id); save(); renderHomework(); }

// ═══════════════════════════════════════════
// SCHEDULE
// ═══════════════════════════════════════════
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getWeekKey(date) {
  const d = new Date(date), jan1 = new Date(d.getFullYear(), 0, 1);
  return d.getFullYear() + '-W' + String(Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)).padStart(2, '0');
}
function currentWeekKey() { return getWeekKey(new Date()); }
function getSlotsForDay(dow) { return (data.slots || []).filter(sl => sl.dayOfWeek === dow); }
function timeToMins(t) { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function formatDuration(start, end) {
  const mins = timeToMins(end) - timeToMins(start);
  if (mins <= 0) return '';
  if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}

function renderSchedule() {
  populateSubjectSelects();
  if (schedView === 'week') {
    document.getElementById('schedWeekView').style.display = 'block';
    document.getElementById('schedDayView').style.display = 'none';
    document.getElementById('schedViewToggle').textContent = 'Day View';
    renderWeekTabs(); renderDayGrid(schedDaySelected);
  } else {
    document.getElementById('schedWeekView').style.display = 'none';
    document.getElementById('schedDayView').style.display = 'block';
    document.getElementById('schedViewToggle').textContent = 'Week View';
    renderDayTimeline(schedDaySelected); updateSchedDayLabel();
  }
}
function toggleSchedView() { schedView = schedView === 'week' ? 'day' : 'week'; renderSchedule(); }
function renderWeekTabs() {
  const today = new Date().getDay();
  document.getElementById('schedDayTabs').innerHTML = DAY_SHORT.map((name, i) => {
    const slots = getSlotsForDay(i);
    return `<div class="sdt-tab${i === schedDaySelected ? ' active' : ''}${i === today ? ' today-tab' : ''}${slots.length ? ' has-items' : ''}" onclick="selectSchedDay(${i})">${name}${i === today ? '<span style="font-size:0.55rem;color:var(--gold-dim)">today</span>' : ''}<div class="sdt-dot"></div></div>`;
  }).join('');
  renderDayGrid(schedDaySelected);
}
function selectSchedDay(dow) { schedDaySelected = dow; renderWeekTabs(); }
function renderDayGrid(dow) {
  const slots = getSlotsForDay(dow).sort((a, b) => a.start.localeCompare(b.start));
  const grid = document.getElementById('schedWeekGrid');
  if (!slots.length) { grid.innerHTML = `<div class="swg-empty">No blocks for ${DAY_NAMES[dow]}.<br>Tap "+ Add" to build your schedule.</div>`; return; }
  const wk = currentWeekKey();
  const typeEmoji = {study:'📚',break:'☕',lunch:'🍽️',chore:'🧹',exercise:'🏃',free:'🌟'};
  const typeColor = {study:'var(--gold)',break:'var(--text-muted)',lunch:'#e09060',chore:'#9090d0',exercise:'#6bc98a',free:'#c090d0'};
  grid.innerHTML = slots.map(sl => {
    const subj = data.subjects.find(s => s.id === sl.subjectId);
    const isDone = sl.done && sl.done.includes(wk);
    const emoji = typeEmoji[sl.type] || '📌';
    const color = typeColor[sl.type] || 'var(--gold)';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #181818">
      <div style="width:52px;flex-shrink:0;text-align:right"><div style="font-size:0.78rem;color:var(--text-dim)">${sl.start}</div><div style="font-size:0.65rem;color:var(--text-muted)">${sl.end}</div></div>
      <div style="width:3px;height:36px;border-radius:2px;background:${color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0"><div style="font-size:0.88rem;font-weight:500${isDone?';text-decoration:line-through;opacity:0.5':''}">${emoji} ${sl.label || (subj ? subj.name : sl.type)}</div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px">${subj && sl.type==='study'?subj.name+' · ':''}${formatDuration(sl.start,sl.end)}</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${sl.type==='study'?`<button class="sched-btn" onclick="startFromSlot('${sl.id}')">▶</button>`:''}
        <button class="sched-btn" onclick="toggleSlotDone('${sl.id}')" style="${isDone?'border-color:var(--green);color:var(--green)':''}">${isDone?'↩':'✓'}</button>
        <button class="sched-btn" onclick="editSlot('${sl.id}')">✎</button>
        <button class="sched-btn" onclick="deleteSlot('${sl.id}')">×</button>
      </div>
    </div>`;
  }).join('');
}
function renderDayTimeline(dow) {
  const slots = getSlotsForDay(dow).sort((a, b) => a.start.localeCompare(b.start));
  const wk = currentWeekKey();
  let minHour = 6, maxHour = 22;
  slots.forEach(sl => { minHour = Math.min(minHour, parseInt(sl.start)); maxHour = Math.max(maxHour, parseInt(sl.end) + 1); });
  maxHour = Math.min(maxHour + 1, 24);
  const HOUR_PX = 60;
  let html = '<div class="timeline-wrap"><div style="position:relative">';
  for (let h = minHour; h <= maxHour; h++) {
    const label = h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM';
    html += `<div class="timeline-hour-row" style="height:${HOUR_PX}px"><div class="tl-time">${label}</div><div class="tl-line"></div></div>`;
  }
  html += '<div style="position:absolute;top:0;left:56px;right:0;bottom:0">';
  const typeEmoji = {study:'📚',break:'☕',lunch:'🍽️',chore:'🧹',exercise:'🏃',free:'🌟'};
  slots.forEach(sl => {
    const startMins = timeToMins(sl.start) - minHour * 60, endMins = timeToMins(sl.end) - minHour * 60;
    const top = (startMins / 60) * HOUR_PX, height = Math.max(((endMins - startMins) / 60) * HOUR_PX - 2, 26);
    const isDone = sl.done && sl.done.includes(wk);
    const subj = data.subjects.find(s => s.id === sl.subjectId);
    html += `<div class="tl-block tl-block-${sl.type}${isDone?' tl-block-done':''}" style="top:${top}px;height:${height}px" onclick="slotTap('${sl.id}')">
      <div class="tl-block-title">${typeEmoji[sl.type]||'📌'} ${sl.label||(subj?subj.name:sl.type)}</div>
      ${height>38?`<div class="tl-block-sub">${sl.start}–${sl.end}${isDone?' · done':''}</div>`:''}
    </div>`;
  });
  const today = new Date();
  if (today.getDay() === dow) {
    const nowMins = today.getHours() * 60 + today.getMinutes() - minHour * 60;
    const nowTop = (nowMins / 60) * HOUR_PX;
    if (nowTop >= 0 && nowTop < (maxHour - minHour) * HOUR_PX) html += `<div class="tl-now-line" style="top:${nowTop}px"></div>`;
  }
  html += '</div></div></div>';
  document.getElementById('schedDayTimeline').innerHTML = html;
}
function updateSchedDayLabel() { const el = document.getElementById('schedDayLabel'); if (el) el.textContent = DAY_NAMES[schedDaySelected]; }
function schedDayMove(dir) { schedDaySelected = (schedDaySelected + dir + 7) % 7; renderDayTimeline(schedDaySelected); updateSchedDayLabel(); }
function slotTap(id) { toggleSlotDone(id); }
function toggleSlotDone(id) {
  const sl = (data.slots || []).find(s => s.id === id); if (!sl) return;
  if (!sl.done) sl.done = [];
  const wk = currentWeekKey(), idx = sl.done.indexOf(wk);
  if (idx === -1) { sl.done.push(wk); showSparkles(); } else { sl.done.splice(idx, 1); }
  save(); renderSchedule();
}
function startFromSlot(id) {
  const sl = (data.slots || []).find(s => s.id === id); if (!sl || sl.type !== 'study') return;
  const subj = data.subjects.find(s => s.id === sl.subjectId); if (!subj) return;
  startFocusMode(sl.subjectId, null, sl.label || subj.name, Math.max(timeToMins(sl.end) - timeToMins(sl.start), 5));
}
function deleteSlot(id) { data.slots = (data.slots || []).filter(s => s.id !== id); save(); renderSchedule(); }

let schedEditId = null, slotDaysSelected = [1];
function openAddSlotModal() {
  schedEditId = null;
  document.getElementById('schedModalTitle').textContent = 'Add Time Block';
  slotDaysSelected = [new Date().getDay()]; refreshDayPickerUI();
  document.getElementById('slotStart').value = '08:00'; document.getElementById('slotEnd').value = '09:00';
  document.getElementById('slotType').value = 'study'; document.getElementById('slotLabel').value = '';
  document.getElementById('slotSubjWrap').style.display = 'block';
  populateSubjectSelects(); openModal('schedModal');
}
function editSlot(id) {
  const sl = (data.slots || []).find(s => s.id === id); if (!sl) return;
  schedEditId = id; document.getElementById('schedModalTitle').textContent = 'Edit Time Block';
  slotDaysSelected = [sl.dayOfWeek]; refreshDayPickerUI();
  document.getElementById('slotStart').value = sl.start; document.getElementById('slotEnd').value = sl.end;
  document.getElementById('slotType').value = sl.type; document.getElementById('slotLabel').value = sl.label || '';
  updateSlotType(); populateSubjectSelects();
  if (sl.subjectId) { const sel = document.getElementById('slotSubj'); if (sel) sel.value = sl.subjectId; }
  openModal('schedModal');
}
function pickSchedDay(el) {
  const day = parseInt(el.dataset.day), idx = slotDaysSelected.indexOf(day);
  if (idx === -1) { slotDaysSelected.push(day); el.classList.add('selected'); } else { slotDaysSelected.splice(idx, 1); el.classList.remove('selected'); }
}
function pickAllWeekdays() { slotDaysSelected = [1,2,3,4,5]; refreshDayPickerUI(); }
function pickAllDays() { slotDaysSelected = [0,1,2,3,4,5,6]; refreshDayPickerUI(); }
function clearDayPicks() { slotDaysSelected = []; refreshDayPickerUI(); }
function refreshDayPickerUI() {
  document.querySelectorAll('.sdp-btn').forEach(b => b.classList.toggle('selected', slotDaysSelected.includes(parseInt(b.dataset.day))));
}
function updateSlotType() {
  const t = document.getElementById('slotType').value, wrap = document.getElementById('slotSubjWrap');
  if (wrap) wrap.style.display = t === 'study' ? 'block' : 'none';
}
function saveSlot() {
  const start = document.getElementById('slotStart').value, end = document.getElementById('slotEnd').value;
  if (!start || !end) { alert('Please set start and end time.'); return; }
  if (timeToMins(end) <= timeToMins(start)) { alert('End time must be after start time.'); return; }
  if (!slotDaysSelected.length) { alert('Please select at least one day.'); return; }
  if (!data.slots) data.slots = [];
  const type = document.getElementById('slotType').value;
  const subjEl = document.getElementById('slotSubj'), subjectId = subjEl ? subjEl.value : '';
  const label = document.getElementById('slotLabel').value.trim();
  if (schedEditId) {
    const idx = data.slots.findIndex(s => s.id === schedEditId);
    if (idx !== -1) Object.assign(data.slots[idx], { dayOfWeek:slotDaysSelected[0], start, end, type, subjectId, label });
  } else {
    slotDaysSelected.forEach(dow => data.slots.push({ id:uid(), dayOfWeek:dow, start, end, type, subjectId, label, done:[] }));
  }
  schedDaySelected = slotDaysSelected[0];
  save(); closeModal('schedModal'); renderSchedule();
}

let dupWeekNum = 4;
function openDupWeekModal() { dupWeekNum = 4; updateDupWeekUI(); openModal('dupWeekModal'); }
function adjustDupWeeks(dir) { dupWeekNum = Math.max(1, Math.min(52, dupWeekNum + dir)); updateDupWeekUI(); }
function updateDupWeekUI() {
  document.getElementById('dupWeekCount').textContent = dupWeekNum;
  const slotCount = (data.slots || []).length, endDate = new Date();
  endDate.setDate(endDate.getDate() + dupWeekNum * 7);
  const endStr = endDate.toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'});
  document.getElementById('dupWeekPreview').innerHTML = !slotCount
    ? 'No time blocks yet.'
    : `${slotCount} blocks × ${dupWeekNum} weeks = <strong style="color:var(--gold)">${slotCount*dupWeekNum} total blocks</strong><br>Through <strong style="color:var(--gold-light)">${endStr}</strong>.`;
}
function confirmDupWeek() {
  const slots = data.slots || []; if (!slots.length) { alert('No blocks to duplicate.'); return; }
  if (!data.scheduleOverrides) data.scheduleOverrides = [];
  const today = new Date(); let totalAdded = 0;
  for (let w = 1; w <= dupWeekNum; w++) {
    slots.forEach(sl => {
      const d = new Date(today), daysUntil = (sl.dayOfWeek - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntil + (w - 1) * 7);
      const dateStr = d.toISOString().split('T')[0];
      if (!data.scheduleOverrides.some(o => o.date === dateStr && o.start === sl.start && o.subjectId === sl.subjectId)) {
        data.scheduleOverrides.push({ id:uid(), date:dateStr, start:sl.start, end:sl.end, type:sl.type, subjectId:sl.subjectId, label:sl.label, done:false, sourceSlotId:sl.id });
        totalAdded++;
      }
    });
  }
  save(); closeModal('dupWeekModal'); showToast('✨', 'Week duplicated!', `${totalAdded} blocks added across ${dupWeekNum} weeks.`); renderSchedule();
}

// ═══════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════
function renderProgress() {
  const totalMins = (data.studyLog || []).reduce((a, l) => a + l.minutes, 0);
  const doneHw = (data.homework || []).filter(h => h.status === 'done').length;
  const completedTopics = (data.subjects || []).reduce((a, s) => a + s.topics.filter(t => t.done).length, 0);
  document.getElementById('statsGrid').innerHTML = [
    {num: Math.round(totalMins/60*10)/10+'h', lbl:'Total Studied'},
    {num: (data.streak||0)+'🔥', lbl:'Day Streak'},
    {num: doneHw, lbl:'HW Done'},
    {num: completedTopics, lbl:'Topics Done'},
    {num: Math.round(getTodayStudyMins()/60*10)/10+'h', lbl:'Today'},
    {num: (data.subjects||[]).length, lbl:'Subjects'},
  ].map(s => `<div class="stat-card"><div class="stat-num">${s.num}</div><div class="stat-lbl">${s.lbl}</div></div>`).join('');

  const rings = document.getElementById('progressRings');
  rings.innerHTML = data.subjects.length ? data.subjects.map(s => {
    const done = s.topics.filter(t => t.done).length, total = s.topics.length || 1, pct = Math.round(done/total*100);
    const r = 36, circ = 2*Math.PI*r;
    return `<div style="text-align:center;width:90px">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r="${r}" fill="none" stroke="#1e1e1e" stroke-width="6"/>
        <circle cx="45" cy="45" r="${r}" fill="none" stroke="${s.color}" stroke-width="6"
          stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ*(1-pct/100)}"
          transform="rotate(-90 45 45)" style="transition:stroke-dashoffset 1s"/>
        <text x="45" y="42" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="${s.color}" font-family="Cormorant Garamond,serif">${pct}%</text>
        <text x="45" y="56" text-anchor="middle" dominant-baseline="middle" font-size="8" fill="var(--text-muted)" font-family="DM Sans">${s.icon||'📚'}</text>
      </svg>
      <div style="font-size:0.72rem;color:var(--text-dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name}</div>
    </div>`;
  }).join('') : '<div style="color:var(--text-muted);font-size:0.82rem;padding:20px">No subjects yet.</div>';

  const diffs = (data.difficulty || []).slice(-20).reverse();
  document.getElementById('diffList').innerHTML = diffs.length ? diffs.map(d => {
    const subj = data.subjects.find(s => s.id === d.subjectId);
    return `<div class="diff-entry"><div class="diff-info"><div class="diff-title">${d.topic}</div><div class="diff-sub">${subj?subj.name:''} · ${formatDate(d.date)}</div>${d.notes?`<div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px">${d.notes}</div>`:''}</div><span class="chip chip-${d.level==='easy'?'easy':d.level==='medium'?'medium':'hard'}">${d.level}</span></div>`;
  }).join('') : '<div class="empty-state"><div class="empty-state-icon">📊</div><p>No difficulty entries yet.</p></div>';
}
function saveDiff() {
  const topic = document.getElementById('diffTopic').value.trim(); if (!topic) return;
  data.difficulty.push({ id:uid(), subjectId:document.getElementById('diffSubj').value, topic, level:document.getElementById('diffLevel').value, notes:document.getElementById('diffNotes').value.trim(), date:new Date().toISOString().split('T')[0] });
  save(); closeModal('diffModal'); renderProgress();
  document.getElementById('diffTopic').value = ''; document.getElementById('diffNotes').value = '';
}

// ═══════════════════════════════════════════
// WEEKLY RESET
// ═══════════════════════════════════════════
function checkWeeklyReset() {
  const today = new Date().toISOString().split('T')[0];
  if (!data.weekStartDate) { data.weekStartDate = today; save(); return; }
  if (daysBetween(data.weekStartDate, today) >= 7) showWeeklyReset();
}
function forceWeeklyReset() { closeModal('settingsModal'); showWeeklyReset(); }
function showWeeklyReset() {
  const weekMins = (data.studyLog || []).reduce((a, l) => a + l.minutes, 0);
  const improved = (data.subjects || []).filter(s => s.topics.some(t => t.done)).length;
  const hardSubjNames = [...new Set((data.difficulty||[]).filter(d=>d.level==='hard').map(d=>d.subjectId))].map(id=>data.subjects.find(s=>s.id===id)?.name).filter(Boolean);
  document.getElementById('resetHours').textContent = Math.round(weekMins/60*10)/10+'h';
  document.getElementById('resetGrid').innerHTML = [
    {num:(data.subjects||[]).length,lbl:'Subjects'},{num:improved,lbl:'Improved'},{num:(data.homework||[]).filter(h=>h.status==='done').length,lbl:'HW Done'}
  ].map(c=>`<div class="reset-cell"><div class="reset-cell-num">${c.num}</div><div class="reset-cell-lbl">${c.lbl}</div></div>`).join('');
  const msgs = ["You showed up. That's everything. 🌟","Every session builds the foundation. ✨","Consistency is your superpower. 💛","Progress takes patience. You're on track. 🎯"];
  document.getElementById('resetMsg').textContent = msgs[Math.floor(Math.random()*msgs.length)] + (hardSubjNames.length ? ` Focus on ${hardSubjNames[0]} this week.` : '');
  openModal('resetModal');
}
function confirmWeeklyReset() {
  data.subjects.forEach(s => s.topics.forEach(t => t.done = false));
  data.homework = (data.homework || []).filter(h => h.status !== 'done');
  data.weekStartDate = new Date().toISOString().split('T')[0];
  data.studyLog = [];
  (data.subjects || []).forEach(s => s.studyMins = 0);
  save(); closeModal('resetModal'); renderToday(); showSparkles();
}

// ═══════════════════════════════════════════
// WEEK GLANCE
// ═══════════════════════════════════════════
function renderWeekGlance() {
  const now = new Date(), todayStr = now.toISOString().split('T')[0];
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? -6 : 1 - now.getDay()));
  const weekDays = Array.from({length:7}, (_, i) => { const d = new Date(startOfWeek); d.setDate(startOfWeek.getDate()+i); return d.toISOString().split('T')[0]; });
  const fmt = ds => new Date(ds+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  document.getElementById('weekGlanceRange').textContent = fmt(weekDays[0]) + ' – ' + fmt(weekDays[6]);

  let gridHtml = '', totalWeekMins = 0, studyDays = 0, hwDueCount = 0;
  weekDays.forEach(ds => {
    const dayMins = (data.studyLog||[]).filter(l=>l.date===ds).reduce((a,l)=>a+l.minutes,0);
    const dayHw = (data.homework||[]).filter(h=>h.due===ds&&h.status!=='done');
    const isToday = ds === todayStr;
    const loadPct = Math.min(100, Math.round(dayMins/((data.settings.maxHours||6)*60)*100));
    totalWeekMins += dayMins; if (dayMins > 0) studyDays++; hwDueCount += dayHw.length;
    const d = new Date(ds+'T12:00:00');
    gridHtml += `<div class="wg-col"><div class="wg-day-label">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}</div>
      <div class="wg-day-num${isToday?' today-num':''}">${d.getDate()}</div>
      ${dayMins>0?`<div class="wg-block wg-study">${Math.round(dayMins/60*10)/10}h</div>`:''}
      ${dayHw.slice(0,2).map(h=>`<div class="wg-block wg-hw">${h.title.slice(0,8)}</div>`).join('')}
      ${!dayMins&&!dayHw.length?'<div class="wg-empty"></div>':''}
      ${loadPct>0?`<div class="wg-load-bar"><div class="wg-load-fill" style="width:${loadPct}%"></div></div>`:''}
    </div>`;
  });
  document.getElementById('weekGlanceGrid').innerHTML = gridHtml;
  document.getElementById('weekSummaryRow').innerHTML = [
    {num:Math.round(totalWeekMins/60*10)/10+'h',lbl:'Studied'},
    {num:studyDays+'/7',lbl:'Active Days'},
    {num:hwDueCount,lbl:'HW Due'},
    {num:(data.streak||0)+'🔥',lbl:'Streak'}
  ].map(c=>`<div class="week-summary-chip"><div class="wsn">${c.num}</div><div class="wsl">${c.lbl}</div></div>`).join('');
  loadReminderSettings();
}

// ═══════════════════════════════════════════
// FOCUS TIMER (standalone card)
// ═══════════════════════════════════════════
let ftState = {mins:25, secs:0, total:25*60, running:false, interval:null};
function ftSelectPreset(el, mins) {
  document.querySelectorAll('.ft-preset').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('ftCustomWrap').style.display = mins === 0 ? 'block' : 'none';
  if (mins > 0) { ftState = {mins, secs:0, total:mins*60, running:false, interval:null}; ftUpdateDisplay(); document.getElementById('ftStartBtn').textContent = '▶ Start'; document.getElementById('ftLabel').textContent = mins+' MIN TIMER'; }
}
function ftToggle() {
  if (ftState.running) {
    clearInterval(ftState.interval); ftState.running = false;
    document.getElementById('ftStartBtn').textContent = '▶ Resume'; document.getElementById('ftLabel').textContent = 'PAUSED';
  } else {
    const customEl = document.getElementById('ftCustomMins');
    if (document.getElementById('ftCustomWrap').style.display !== 'none' && customEl.value) { ftState.mins = parseInt(customEl.value)||25; ftState.secs = 0; ftState.total = ftState.mins*60; }
    if (!ftState.mins && !ftState.secs) { ftReset(); return; }
    ftState.running = true; document.getElementById('ftStartBtn').textContent = '⏸ Pause'; document.getElementById('ftLabel').textContent = 'FOCUSING…';
    ftState.interval = setInterval(() => {
      if (ftState.secs === 0) { if (ftState.mins === 0) { clearInterval(ftState.interval); ftState.running = false; document.getElementById('ftLabel').textContent = 'COMPLETE! 🎉'; document.getElementById('ftStartBtn').textContent = '▶ Start'; showToast('⏰','Timer done!','Take a well-earned break.'); showSparkles(); return; } ftState.mins--; ftState.secs = 59; } else ftState.secs--; ftUpdateDisplay();
    }, 1000);
  }
}
function ftReset() {
  clearInterval(ftState.interval); ftState.running = false;
  const ap = document.querySelector('.ft-preset.on');
  const mins = ap ? (parseInt(ap.textContent)||25) : 25;
  ftState = {mins, secs:0, total:mins*60, running:false, interval:null};
  ftUpdateDisplay(); document.getElementById('ftStartBtn').textContent = '▶ Start'; document.getElementById('ftLabel').textContent = 'SELECT DURATION';
}
function ftUpdateDisplay() { document.getElementById('ftDisplay').textContent = String(ftState.mins).padStart(2,'0')+':'+String(ftState.secs).padStart(2,'0'); }

// ═══════════════════════════════════════════
// REMINDERS
// ═══════════════════════════════════════════
function saveReminderSetting(key, val) { if (!data.settings.reminders) data.settings.reminders = {}; data.settings.reminders[key] = val; save(); scheduleReminders(); }
function loadReminderSettings() {
  const r = data.settings.reminders || {};
  const set = (id, val) => { const el = document.getElementById(id); if (el) { if (el.type==='checkbox') el.checked=val; else el.value=val; } };
  set('breakReminderToggle', r.breakOn !== false);
  set('blueLightToggle', !!r.blueLightOn);
  set('sunToggle', !!r.sunOn);
  set('brainToggle', r.brainOn !== false);
  if (r.breakInterval) set('breakIntervalSel', r.breakInterval);
  if (r.sunTime) set('sunTimeSel', r.sunTime);
  if (r.brainInterval) set('brainIntervalSel', r.brainInterval);
}
let toastTimer = null;
function showToast(icon, title, msg) {
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('reminderToast').classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(closeToast, 7000);
}
function closeToast() { document.getElementById('reminderToast').classList.remove('show'); }
let reminderIntervals = [];
function scheduleReminders() {
  reminderIntervals.forEach(clearInterval); reminderIntervals = [];
  const r = data.settings.reminders || {};
  if (r.breakOn !== false) { const m = parseInt(r.breakInterval||25); reminderIntervals.push(setInterval(() => showToast('🧘','Break time!',`You've been studying for ${m} min. Rest your eyes.`), m*60000)); }
  if (r.brainOn !== false) { const m = parseInt(r.brainInterval||90); reminderIntervals.push(setInterval(() => showToast('🧠','Brain break!','Move around — 10 jumping jacks or 5 deep breaths.'), m*60000)); }
  if (r.blueLightOn) reminderIntervals.push(setTimeout(() => showToast('👓','Blue light glasses!','Put them on before your next session.'), 120000));
  if (r.sunOn) scheduleSunReminder(r.sunTime || '14:00');
}
function scheduleSunReminder(timeStr) {
  const [h, m] = timeStr.split(':').map(Number), now = new Date(), target = new Date();
  target.setHours(h, m, 0, 0); if (target <= now) target.setDate(target.getDate()+1);
  reminderIntervals.push(setTimeout(() => { showToast('☀️','Get some sun!','Step outside for 5–10 minutes.'); scheduleSunReminder(timeStr); }, target - now));
}

// ═══════════════════════════════════════════
// STREAK & SETTINGS
// ═══════════════════════════════════════════
function checkStreak() {
  const today = new Date().toISOString().split('T')[0];
  if (data.lastStudyDate && daysBetween(data.lastStudyDate, today) > 1) { data.streak = 0; save(); }
}
function loadSettings() {
  const s = data.settings;
  const set = (id, val) => { const el = document.getElementById(id); if (el) { if (el.type==='checkbox') el.checked=val; else el.value=val; } };
  set('maxHoursInput', s.maxHours||6);
  set('breakToggle', s.breakReminder!==false);
  set('resetDaySelect', s.resetDay||1);
}
function saveSetting(key, val) { data.settings[key] = val; save(); }
function changePin() {
  const np = prompt('Enter new 4-digit PIN:');
  if (np && /^\d{4}$/.test(np)) { data.settings.pin = np; save(); alert('PIN changed!'); }
  else if (np) alert('PIN must be exactly 4 digits.');
}

// ═══════════════════════════════════════════
// EXPORT / IMPORT
// ═══════════════════════════════════════════
function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'studygold-backup.json'; a.click();
}
function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try { Object.assign(data, JSON.parse(ev.target.result)); save(); alert('Data imported! Reloading…'); location.reload(); }
    catch(e) { alert('Invalid file.'); }
  };
  r.readAsText(f);
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function populateSubjectSelects() {
  const opts = data.subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  ['sessSubjSelect','hwSubj','slotSubj','diffSubj'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = opts || '<option value="">No subjects</option>'; });
}
function openModal(id) { document.getElementById(id).classList.add('active'); populateSubjectSelects(); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function addDays(dateStr, days) { const d = new Date(dateStr+'T12:00:00'); d.setDate(d.getDate()+days); return d.toISOString().split('T')[0]; }
function daysBetween(from, to) { return Math.round((new Date(to+'T12:00:00') - new Date(from+'T12:00:00')) / 86400000); }
function formatDate(ds) { if (!ds) return ''; return new Date(ds+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function showSparkles() {
  for (let i = 0; i < 6; i++) setTimeout(() => {
    const el = document.createElement('div'); el.className = 'sparkle';
    el.innerHTML = ['✦','✧','⋆','★','◆'][Math.floor(Math.random()*5)];
    el.style.cssText = `left:${Math.random()*80+10}%;top:${Math.random()*60+20}%;font-size:${Math.random()*16+10}px;color:var(--gold);`;
    document.body.appendChild(el); setTimeout(() => el.remove(), 900);
  }, i * 80);
}
