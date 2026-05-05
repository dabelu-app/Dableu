
// ══════════════════════════════════════
//  STATE
// ══════════════════════════════════════
let S = {
  user: null,
  page: 'dashboard',
  sidebarCollapsed: false,
  snoozeTarget: null,
  snoozeChoice: '1h',
  nextId: 10,
  nextMemberId: 4,
  registeredUsers: [],
  reminders: [],
  waMessages: [],
  inboxTab: 'whatsapp',
  calYear: null,
  calMonth: null,
  calView: 'month',
  taskFilter: {assignee:'', type:'', sort:'priority', view:'tabs'},
  clients: [
    {id:1, name:'כהן בע"מ', phone:'050-1111111', email:'cohen@example.com'},
    {id:2, name:'לוי ושות\'', phone:'052-2222222', email:'levi@example.com'},
    {id:3, name:'גולדברג', phone:'054-3333333', email:'gold@example.com'},
  ],
  team: [
    {id:1,name:'ישראל כהן',email:'israel@taxoffice.co.il',phone:'0501234567',role:'owner',perm:'full',colors:['#dbeafe','#1d4ed8'],status:'פעיל',notify:'whatsapp',notifyLabel:'💬 וואטסאפ'},
    {id:2,name:'שרה לוי',email:'sarah@taxoffice.co.il',phone:'0521234567',role:'manager',perm:'full',colors:['#dcfce7','#166534'],status:'פעיל',notify:'whatsapp',notifyLabel:'💬 וואטסאפ'},
    {id:3,name:'דוד גולדברג',email:'david@taxoffice.co.il',phone:'0531234567',role:'employee',perm:'edit',colors:['#fef9c3','#a16207'],status:'פעיל',notify:'both',notifyLabel:'🔔 שניהם'},
  ],
  tasks: [],
  office: {name:'משרד ייעוץ מס כהן',phone:'03-5551234',email:'office@taxoffice.co.il',addr:'רחוב הרצל 12, תל אביב'},
};

const deadlines=[
  {title:'מקדמה חודשית – מס הכנסה',date:'2026-03-25',days:6},
  {title:'דוח מע"מ חודשי',date:'2026-04-15',days:27},
  {title:'ביטוח לאומי',date:'2026-03-25',days:6},
  {title:'דוח שנתי – יחידים',date:'2026-04-30',days:42},
  {title:'הצהרת הון',date:'2026-06-30',days:103},
];

function initTasks(){
  const now=Date.now();
  S.tasks=[
    {id:1,title:'הגשת דוח מע"מ רבעוני',type:'tax',assignee:'שרה לוי',date:'2026-03-25',priority:'urgent',done:false,status:'pending',createdAt:now-51*3600000,remindedAt:null,snoozedUntil:null,pinned:false},
    {id:2,title:'בדיקת ניכויי שכר מרץ',type:'internal',assignee:'ישראל כהן',date:'2026-03-22',priority:'normal',done:false,status:'inprogress',createdAt:now-56*3600000,remindedAt:null,snoozedUntil:null,pinned:false},
    {id:3,title:'פגישה – כהן בע"מ',type:'meeting',assignee:'ישראל כהן',date:'2026-03-21',priority:'normal',done:false,status:'pending',createdAt:now-73*3600000,remindedAt:null,snoozedUntil:null,pinned:false},
    {id:4,title:'הכנת דוח שנתי 2025',type:'tax',assignee:'דוד גולדברג',date:'2026-04-30',priority:'normal',done:false,status:'pending',createdAt:now-10*3600000,remindedAt:null,snoozedUntil:null,pinned:false},
    {id:5,title:'עדכון תיק לקוח – לוי',type:'internal',assignee:'שרה לוי',date:'2026-03-19',priority:'normal',done:true,status:'done',createdAt:now-97*3600000,remindedAt:null,snoozedUntil:null,pinned:false},
  ];
  S.waMessages=[
    {text:'תזכור: תשלום ביטוח לאומי עד 25/3 🔴',time:'09:14',converted:true,taskTitle:'תשלום ביטוח לאומי'},
    {text:'לתאם פגישה עם לקוחה חדשה השבוע',time:'10:32',converted:false},
  ];
}

// ══════════════════════════════════════
//  AUTH
// ══════════════════════════════════════
let authTab="login";




// ══════════════════════════════════════
// מערכת מנוי וניסיון
// ══════════════════════════════════════
// ══ רשימת Admin ו-Whitelist ══
var ADMIN_EMAILS = [
  'shanitaxes11@gmail.com'
];

var FREE_EMAILS = [
  // הוסיפי כאן מיילים של עסקים שמשתמשים בחינם
  // לדוגמה: 'friend@gmail.com'
];

var FREE_COUPONS = [
  'DABELU2025',
  'BETA100',
  'VIP123'
];

function checkSubscription() {
  if(!S.user) return;

  var email = (S.user.email || '').toLowerCase();
  var now = Date.now();
  var uid = S.user.uid || S.user.email;

  // Admin – לעולם לא נחסם
  if(ADMIN_EMAILS.indexOf(email) !== -1) {
    S.user.subscription = 'admin';
    return;
  }

  // Whitelist – חינם לצמיתות
  if(FREE_EMAILS.indexOf(email) !== -1) {
    S.user.subscription = 'free';
    return;
  }

  // בדיקת קופון
  var couponKey = 'coupon_' + uid;
  var usedCoupon = localStorage.getItem(couponKey);
  if(usedCoupon && FREE_COUPONS.indexOf(usedCoupon) !== -1) {
    S.user.subscription = 'coupon';
    return;
  }

  // מנוי פעיל
  if(S.user.subscription === 'active') return;

  // ניסיון
  var trialKey = 'trial_start_' + uid;
  var trialStart = localStorage.getItem(trialKey);

  if(!trialStart) {
    trialStart = now;
    localStorage.setItem(trialKey, now);
    S.user.trialStart = now;
    toast('🎉 7 ימי ניסיון חינם החלו!');
    return;
  }

  var daysPassed = Math.floor((now - parseInt(trialStart)) / (1000 * 60 * 60 * 24));
  S.user.trialDaysLeft = Math.max(0, 7 - daysPassed);

  if(daysPassed === 6) {
    setTimeout(function(){ toast('⚠️ נשאר יום אחד לניסיון החינמי!'); }, 2000);
  }

  if(daysPassed >= 7) {
    showPaywall();
    return;
  }
}

// ── הפעלת קופון ──
window.activateCoupon = function() {
  var code = prompt('הזיני קוד קופון:');
  if(!code) return;
  code = code.trim().toUpperCase();
  if(FREE_COUPONS.indexOf(code) !== -1) {
    var uid = S.user.uid || S.user.email;
    localStorage.setItem('coupon_' + uid, code);
    // הסתר paywall אם פתוח
    var pw = document.getElementById('paywall-screen');
    if(pw) pw.style.display = 'none';
    document.getElementById('screen-app').style.display = 'flex';
    S.user.subscription = 'coupon';
    toast('✅ קופון הופעל! גישה חינמית מופעלת');
  } else {
    toast('❌ קוד קופון לא תקין');
  }
};

function showPaywall() {
  // הסתר את האפליקציה
  document.getElementById('screen-app').style.display = 'none';

  // הצג מסך תשלום
  var existing = document.getElementById('paywall-screen');
  if(existing) { existing.style.display = 'flex'; return; }

  var paywall = document.createElement('div');
  paywall.id = 'paywall-screen';
  paywall.style.cssText = 'position:fixed;inset:0;background:#1a1a2e;display:flex;align-items:center;justify-content:center;z-index:9999;font-family:Arial,sans-serif;direction:rtl';
  paywall.innerHTML =
    '<div style="background:white;border-radius:20px;padding:40px;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
    '<div style="font-size:48px;margin-bottom:16px">🔒</div>' +
    '<h2 style="font-size:22px;font-weight:900;color:#1a1a2e;margin-bottom:8px">תקופת הניסיון הסתיימה</h2>' +
    '<p style="color:#666;font-size:14px;margin-bottom:24px;line-height:1.6">7 ימי הניסיון החינמי הסתיימו.<br/>בחרי מסלול כדי להמשיך להשתמש ב-Dabelu.</p>' +
    '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">' +
    '<div style="border:2px solid #e5e7eb;border-radius:12px;padding:16px;cursor:pointer">' +
    '<div style="font-size:16px;font-weight:700">Basic</div>' +
    '<div style="font-size:24px;font-weight:900;color:#7c5cbf">&#8362;20<span style="font-size:13px;color:#888">/&#1495;&#1493;&#1491;&#1513;</span></div>' +
    '<div style="font-size:12px;color:#888">משתמש אחד</div></div>' +
    '<div style="border:2px solid #7c5cbf;border-radius:12px;padding:16px;cursor:pointer;background:rgba(124,92,191,.05)">' +
    '<div style="font-size:11px;background:#7c5cbf;color:white;padding:2px 10px;border-radius:10px;display:inline-block;margin-bottom:4px">&#11088; פופולרי</div>' +
    '<div style="font-size:16px;font-weight:700">Business</div>' +
    '<div style="font-size:24px;font-weight:900;color:#7c5cbf">&#8362;50<span style="font-size:13px;color:#888">/&#1495;&#1493;&#1491;&#1513;</span></div>' +
    '<div style="font-size:12px;color:#888">עד 50 עובדים</div></div>' +
    '<div style="border:2px solid #e5e7eb;border-radius:12px;padding:16px;cursor:pointer">' +
    '<div style="font-size:16px;font-weight:700">Premium</div>' +
    '<div style="font-size:24px;font-weight:900;color:#7c5cbf">&#8362;100<span style="font-size:13px;color:#888">/&#1495;&#1493;&#1491;&#1513;</span></div>' +
    '<div style="font-size:12px;color:#888">ללא הגבלה + התאמה אישית</div></div></div>' +
    '<a href="mailto:shanitaxes11@gmail.com" style="display:block;width:100%;padding:14px;background:#7c5cbf;color:white;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:10px;text-decoration:none;box-sizing:border-box">בחר מסלול ושלם &#8592;</a>' +
    '<div style="font-size:12px;color:#aaa;margin-bottom:8px">shanitaxes11@gmail.com</div>' +
    '<div onclick="activateCoupon()" style="font-size:12px;color:#7c5cbf;cursor:pointer;text-decoration:underline">יש לך קוד קופון? לחץ כאן</div>' +
    '</div>';
  document.body.appendChild(paywall);
}

function enterApp(){
  // טעינת נתוני צוות מ-localStorage
  loadTeamLocal();
  // בדיקת מנוי / ניסיון
  checkSubscription();

  // הודעת ברוכים הבאים למשתמש חדש
  if(!S.user.welcomeShown) {
    S.user.welcomeShown = true;
    setTimeout(function(){
      toast('👋 ברוכה הבאה! עברי להגדרות כדי להוסיף מספר וואטסאפ ומייל');
    }, 1500);
  }
  document.getElementById('screen-auth').style.display='none';
  document.getElementById('screen-app').style.display='flex';
  // update all user elements
  const initials=S.user.initials||'?';
  const name=S.user.name||'משתמש';
  const office=S.user.officeName||S.office?.name||'משרד ייעוץ מס';
  document.getElementById('sb-avatar').textContent=initials;
  document.getElementById('sb-name').textContent=name;
  const officeEl=document.getElementById('sb-office');
  if(officeEl) officeEl.textContent=office;
  const av2=document.getElementById('sb-avatar2');
  const nm2=document.getElementById('sb-name2');
  const of2=document.getElementById('sb-office-name');
  if(av2) av2.textContent=initials;
  if(nm2) nm2.textContent=name;
  if(of2) of2.textContent='🏢 '+office;
  initTasks();
  populateAssigneeSelect();
  nav('dashboard',document.querySelector('.nav-item'));
  startEngine();
}
function logout(){
  if(!confirm('להתנתק?'))return;
  document.getElementById('screen-app').style.display='none';
  document.getElementById('screen-auth').style.display='flex';
  S.user=null;
}

// ══════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════
const pageTitles={dashboard:'לוח בקרה',tasks:'משימות',messages:'הודעות',whatsapp:'הודעות',reminders:'תזכורות',deadlines:'דדליינים',calendar:'יומן',settings:'הגדרות'};
function nav(page,el){
  S.page=page;
  if(!el) { renderPage(); return; }
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(el)el.classList.add('active');
  document.getElementById('topbar-title').textContent=pageTitles[page]||page;
  renderPage();
}
function toggleBubble(){
  const b=document.getElementById('user-bubble');
  if(b) b.style.display=b.style.display==='none'?'block':'none';
}
function closeBubble(){
  const b=document.getElementById('user-bubble');
  if(b) b.style.display='none';
}
// Close bubble when clicking outside
document.addEventListener('click',function(e){
  const bubble=document.getElementById('user-bubble');
  const userArea=document.querySelector('.sidebar-user');
  if(bubble&&userArea&&!userArea.contains(e.target)){
    bubble.style.display='none';
  }
});
function toggleSidebar(){
  S.sidebarCollapsed=!S.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed',S.sidebarCollapsed);
}

// ══════════════════════════════════════
//  RENDER DISPATCHER
// ══════════════════════════════════════
function renderPage(){
  const el=document.getElementById('page-area');
  updateNavBadge();
  if(S.page==='dashboard')el.innerHTML=renderDashboard();
  else if(S.page==='tasks')el.innerHTML=renderTasksPage();
  else if(S.page==='whatsapp'||S.page==='messages')el.innerHTML=renderWAPage();
  else if(S.page==='reminders')el.innerHTML=renderRemindersPage();
  else if(S.page==='deadlines')el.innerHTML=renderDeadlinesPage();
  else if(S.page==='calendar')el.innerHTML=renderCalendarPage();
  else if(S.page==='settings')el.innerHTML=renderSettingsPage();
}

function updateNavBadge(){
  const open=S.tasks.filter(t=>!t.done).length;
  const nb=document.getElementById('nb-tasks');
  if(nb){nb.textContent=open;nb.style.display=open>0?'':'none';}
}

// ══════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════
function navToTasks(tab, assignee){
  taskTab=tab;
  if(!S.taskFilter) S.taskFilter={assignee:'',type:'',sort:'priority',view:'tabs'};
  if(assignee!==undefined){
    S.taskFilter.assignee=assignee;
    S.taskFilter.view='worker';
  }
  nav('tasks',document.querySelectorAll('.nav-item')[1]);
}
function renderDashboard(){
  if(!S.reminders)S.reminders=[];
  if(!S.clients)S.clients=[];
  if(!S.tasks)S.tasks=[];
  if(!S.waMessages)S.waMessages=[];
  if(!S.team)S.team=[];
  const total=S.tasks.length;
  const done=S.tasks.filter(t=>t.status==='done').length;
  const urgent=S.tasks.filter(t=>t.priority==='urgent'&&t.status!=='done').length;
  const inprogress=S.tasks.filter(t=>t.status==='inprogress').length;
  const pending=S.tasks.filter(t=>t.status==='pending').length;
  const over48=S.tasks.filter(t=>t.status!=='done'&&hrs(t.createdAt)>=48).length;
  const urgentTasks=S.tasks.filter(t=>t.status!=='done'&&(t.priority==='urgent'||t.pinned||hrs(t.createdAt)>=48)).slice(0,3);
  const hotDeadlines=deadlines.filter(d=>d.days<=7);
  const cs=`cursor:pointer;transition:all .2s;`;
  const ch=`onmouseenter="this.style.boxShadow='0 4px 12px rgba(0,0,0,.12)';this.style.transform='translateY(-2px)'" onmouseleave="this.style.boxShadow='';this.style.transform=''"`;
  return `
  <div class="stats-row">
    <div class="stat-card" style="${cs}" ${ch} onclick="navToTasks('pending')" title="לחץ לצפייה במשימות שטרם טופלו">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><span style="font-size:18px">📋</span><span style="font-size:10px;color:var(--text3);background:var(--surface3);padding:2px 6px;border-radius:20px">לחץ לפתיחה →</span></div>
      <div class="stat-num">${pending}</div><div class="stat-label">טרם טופלו</div>
      <div class="stat-trend">${over48>0?`<span style="color:var(--danger)">⚠️ ${over48} מעל 48 שעות</span>`:`ממתינות לטיפול`}</div>
    </div>
    <div class="stat-card" style="${cs}border-right:3px solid #d97706;" ${ch} onclick="navToTasks('inprogress')" title="לחץ לצפייה במשימות בביצוע">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><span style="font-size:18px">▶️</span><span style="font-size:10px;color:var(--text3);background:var(--surface3);padding:2px 6px;border-radius:20px">לחץ לפתיחה →</span></div>
      <div class="stat-num" style="color:#d97706">${inprogress}</div><div class="stat-label">בביצוע</div>
      <div class="stat-trend">${urgent>0?`<span style="color:var(--danger)">🔴 ${urgent} דחופות</span>`:`בטיפול פעיל`}</div>
    </div>
    <div class="stat-card s-done" style="${cs}" ${ch} onclick="navToTasks('done')" title="לחץ לצפייה במשימות שטופלו">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><span style="font-size:18px">✅</span><span style="font-size:10px;color:var(--text3);background:var(--surface3);padding:2px 6px;border-radius:20px">לחץ לפתיחה →</span></div>
      <div class="stat-num">${done}</div><div class="stat-label">טופלו</div>
      <div class="stat-trend">הושלמו בהצלחה</div>
    </div>
    <div class="stat-card" style="${cs}" ${ch} onclick="nav('deadlines',document.querySelectorAll('.nav-item')[4])" title="לחץ לצפייה בדדליינים">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><span style="font-size:18px">📅</span><span style="font-size:10px;color:var(--text3);background:var(--surface3);padding:2px 6px;border-radius:20px">לחץ לפתיחה →</span></div>
      <div class="stat-num" style="${hotDeadlines.length>0?'color:var(--danger)':''}">${hotDeadlines.length}</div><div class="stat-label">דדליינים קרובים</div>
      <div class="stat-trend">${hotDeadlines.length>0?`<span style="color:var(--danger)">⚠️ תוך 7 ימים</span>`:`הכל בשליטה`}</div>
    </div>
  </div>
  ${over48>0?`<div class="banner danger show" style="cursor:pointer" onclick="navToTasks('pending')">⚠️ ${over48} משימות פתוחות מעל 48 שעות – לחץ לצפייה</div>`:''}
  ${hotDeadlines.length>0?`
  <div class="section-header" style="margin-top:4px"><span class="section-title">🔴 דדליינים קרובים</span><button class="btn sm" onclick="nav('deadlines',document.querySelectorAll('.nav-item')[4])">הכל</button></div>
  ${hotDeadlines.map(d=>`<div class="deadline-card hot" style="cursor:pointer" onclick="nav('deadlines',document.querySelectorAll('.nav-item')[4])"><div class="deadline-days hot">${d.days}</div><div class="deadline-info"><div class="deadline-title">${d.title}</div><div class="deadline-date">עד ${fmtD(d.date)} · עוד ${d.days} ימים</div></div></div>`).join('')}`:''}
  <div class="section-header" style="margin-top:16px"><span class="section-title">⚡ משימות דורשות תשומת לב</span><button class="btn sm" onclick="navToTasks('pending')">כל הטרם טופלו</button></div>
  ${urgentTasks.length?urgentTasks.map(t=>taskCardHTML(t)).join(''):`<div class="empty-state">אין משימות דחופות 🎉</div>`}

  <!-- TEAM OVERVIEW -->
  <div class="section-header" style="margin-top:20px">
    <span class="section-title">👥 סקירת צוות</span>
    <button class="btn sm" onclick="navToTasks('pending','')">תצוגת כל העובדים</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
    ${S.team.map(w=>{
      const [bg,clr]=w.colors||['#dbeafe','#1d4ed8'];
      const wp=S.tasks.filter(t=>t.assignee===w.name&&t.status==='pending').length;
      const wi=S.tasks.filter(t=>t.assignee===w.name&&t.status==='inprogress').length;
      const wd=S.tasks.filter(t=>t.assignee===w.name&&t.status==='done').length;
      const hasUrgent=S.tasks.some(t=>t.assignee===w.name&&t.priority==='urgent'&&t.status!=='done');
      return `
      <div onclick="navToTasks('pending','${w.name}')"
        style="background:var(--surface);border:1.5px solid ${hasUrgent?'#fca5a5':'var(--border)'};border-radius:var(--radius-lg);padding:12px;cursor:pointer;transition:all .2s"
        onmouseenter="this.style.boxShadow='0 4px 12px rgba(0,0,0,.1)';this.style.transform='translateY(-2px)'"
        onmouseleave="this.style.boxShadow='';this.style.transform=''">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <div style="width:32px;height:32px;border-radius:50%;background:${bg};color:${clr};font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">${avInitials(w.name)}</div>
          <div>
            <div style="font-size:12px;font-weight:700">${w.name.split(' ')[0]}</div>
            <div style="font-size:10px;color:var(--text2)">${{owner:'בעל משרד',manager:'מנהל',employee:'עובד'}[w.role]||'עובד'}</div>
          </div>
          ${hasUrgent?`<span style="margin-right:auto;font-size:10px;background:#fee2e2;color:#b91c1c;padding:1px 6px;border-radius:10px;font-weight:700">דחוף!</span>`:''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;text-align:center">
          <div style="background:#fee2e220;border-radius:6px;padding:4px 2px">
            <div style="font-size:16px;font-weight:700;color:#dc2626">${wp}</div>
            <div style="font-size:9px;color:var(--text2)">טרם טופל</div>
          </div>
          <div style="background:#fef3c720;border-radius:6px;padding:4px 2px">
            <div style="font-size:16px;font-weight:700;color:#d97706">${wi}</div>
            <div style="font-size:9px;color:var(--text2)">בביצוע</div>
          </div>
          <div style="background:#dcfce720;border-radius:6px;padding:4px 2px">
            <div style="font-size:16px;font-weight:700;color:#16a34a">${wd}</div>
            <div style="font-size:9px;color:var(--text2)">טופלו</div>
          </div>
        </div>
        <div style="margin-top:8px;font-size:10px;color:var(--text3);text-align:center">לחץ לצפייה במשימות ←</div>
      </div>`;
    }).join('')}
  </div>
  `;
}

// ══════════════════════════════════════
//  TASKS PAGE
// ══════════════════════════════════════
function renderTasksPage(){
  const fa  = S.taskFilter?.assignee || '';
  const ft  = S.taskFilter?.type    || '';
  const fs  = S.taskFilter?.sort    || 'priority';
  const fv  = S.taskFilter?.view    || 'tabs'; // 'tabs' | 'worker'

  const assigneeOpts = S.team.map(m=>`<option value="${m.name}" ${fa===m.name?'selected':''}>${m.name}</option>`).join('');

  const cntPending   = S.tasks.filter(t=>t.status==='pending').length;
  const cntInprogress= S.tasks.filter(t=>t.status==='inprogress').length;
  const cntDone      = S.tasks.filter(t=>t.status==='done').length;

  // ── helpers ──
  const applyFilters = list => {
    if(fa) list=list.filter(t=>t.assignee===fa);
    if(ft) list=list.filter(t=>t.type===ft);
    return list;
  };
  const applySort = list => {
    return list.sort((a,b)=>{
      if(fs==='priority'){
        if(a.pinned!==b.pinned) return a.pinned?-1:1;
        if(a.priority!==b.priority) return a.priority==='urgent'?-1:1;
        return a.date.localeCompare(b.date);
      }
      if(fs==='date')      return a.date.localeCompare(b.date);
      if(fs==='date_desc') return b.date.localeCompare(a.date);
      if(fs==='assignee')  return a.assignee.localeCompare(b.assignee,'he');
      if(fs==='type')      return a.type.localeCompare(b.type);
      if(fs==='created')   return b.createdAt-a.createdAt;
      return 0;
    });
  };

  const tabBtn=(id,label,count,color)=>`
    <button onclick="S.taskFilter=S.taskFilter||{};S.taskFilter.tab='${id}';taskTab='${id}';renderPage()"
      style="display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:none;
             font-family:'Heebo',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;
             background:${taskTab===id?'var(--surface)':'transparent'};
             color:${taskTab===id?'var(--text)':'var(--text2)'};
             box-shadow:${taskTab===id?'0 1px 4px rgba(0,0,0,.1)':'none'}">
      ${label}<span style="background:${color};color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;min-width:20px;text-align:center">${count}</span>
    </button>`;

  // ── WORKER VIEW ──
  if(fv==='worker'){
    const workers = fa ? S.team.filter(m=>m.name===fa) : S.team;
    const workerSections = workers.map(w=>{
      let wTasks = applyFilters(applySort([...S.tasks].filter(t=>t.assignee===w.name)));
      if(ft) wTasks=wTasks.filter(t=>t.type===ft);
      const wp=wTasks.filter(t=>t.status==='pending').length;
      const wi=wTasks.filter(t=>t.status==='inprogress').length;
      const wd=wTasks.filter(t=>t.status==='done').length;
      const [bg,clr]=w.colors||['#dbeafe','#1d4ed8'];
      return `
      <div style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-lg) var(--radius-lg) 0 0;border-bottom:none">
          <div style="width:34px;height:34px;border-radius:50%;background:${bg};color:${clr};font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${avInitials(w.name)}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700">${w.name}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px;display:flex;gap:8px">
              <span style="color:#dc2626">● ${wp} טרם טופלו</span>
              <span style="color:#d97706">● ${wi} בביצוע</span>
              <span style="color:#16a34a">● ${wd} טופלו</span>
            </div>
          </div>
          <span style="font-size:12px;color:var(--text3)">${wTasks.length} סה"כ</span>
        </div>
        <div style="border:1.5px solid var(--border);border-top:none;border-radius:0 0 var(--radius-lg) var(--radius-lg);padding:8px">
          ${wTasks.length
            ? wTasks.map(t=>taskCardHTML(t)).join('')
            :'<div class="empty-state" style="padding:16px">אין משימות</div>'}
        </div>
      </div>`;
    }).join('');
    return renderTasksShell(assigneeOpts,fa,ft,fs,fv,cntPending,cntInprogress,cntDone,tabBtn) + workerSections;
  }

  // ── TABS VIEW ──
  let list = applySort(applyFilters([...S.tasks].filter(t=>t.status===taskTab)));
  const tabLabels={pending:'אין משימות שטרם טופלו 🎉',inprogress:'אין משימות בביצוע',done:'אין משימות שטופלו עדיין'};
  return renderTasksShell(assigneeOpts,fa,ft,fs,fv,cntPending,cntInprogress,cntDone,tabBtn) +
    `<div class="tasks-list">${list.length?list.map(t=>taskCardHTML(t)).join(''):`<div class="empty-state">${tabLabels[taskTab]}</div>`}</div>`;
}

function renderTasksShell(assigneeOpts,fa,ft,fs,fv,cp,ci,cd,tabBtn){
  const sortOpts=[
    ['priority','עדיפות'],['date','תאריך ↑'],['date_desc','תאריך ↓'],
    ['assignee','עובד א-ת'],['type','סוג'],['created','נוצר לאחרונה'],
  ];
  const typeOpts=[['','כל הסוגים'],['tax','רשויות מס'],['internal','פנימי'],['meeting','פגישה']];

  return `
  <!-- VIEW TOGGLE -->
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
    <div style="display:flex;gap:0;background:var(--surface3);border-radius:10px;padding:3px">
      ${tabBtn('pending','טרם טופלו',cp,'#dc2626')}
      ${tabBtn('inprogress','בביצוע',ci,'#d97706')}
      ${tabBtn('done','טופלו',cd,'#16a34a')}
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button onclick="S.taskFilter=S.taskFilter||{};S.taskFilter.view='tabs';renderPage()"
        style="padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:${fv==='tabs'?'var(--accent)':'var(--surface)'};color:${fv==='tabs'?'#fff':'var(--text2)'};font-size:11px;cursor:pointer;font-family:'Heebo',sans-serif" title="תצוגת לשוניות">≡ לשוניות</button>
      <button onclick="S.taskFilter=S.taskFilter||{};S.taskFilter.view='worker';renderPage()"
        style="padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:${fv==='worker'?'var(--accent)':'var(--surface)'};color:${fv==='worker'?'#fff':'var(--text2)'};font-size:11px;cursor:pointer;font-family:'Heebo',sans-serif" title="תצוגה לפי עובד">👤 לפי עובד</button>
    </div>
  </div>

  <!-- FILTERS BAR -->
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-lg)">
    <span style="font-size:11px;font-weight:600;color:var(--text2);flex-shrink:0">סינון ומיון:</span>

    <!-- worker filter chips -->
    <div style="display:flex;gap:5px;flex-wrap:wrap;flex:1">
      <button onclick="S.taskFilter=S.taskFilter||{};S.taskFilter.assignee='';renderPage()"
        style="padding:4px 10px;border-radius:20px;border:1.5px solid ${fa===''?'var(--accent)':'var(--border)'};background:${fa===''?'var(--accent-light)':'var(--surface)'};color:${fa===''?'var(--accent)':'var(--text2)'};font-size:11px;font-weight:600;cursor:pointer;font-family:'Heebo',sans-serif">
        כולם
      </button>
      ${S.team.map(m=>{
        const [bg,clr]=m.colors||['#dbeafe','#1d4ed8'];
        const cnt=S.tasks.filter(t=>t.assignee===m.name&&t.status===taskTab).length;
        const sel=fa===m.name;
        return `<button onclick="S.taskFilter=S.taskFilter||{};S.taskFilter.assignee='${m.name}';renderPage()"
          style="padding:4px 10px;border-radius:20px;border:1.5px solid ${sel?'var(--accent)':'var(--border)'};background:${sel?'var(--accent-light)':bg+'33'};color:${sel?'var(--accent)':clr};font-size:11px;font-weight:600;cursor:pointer;font-family:'Heebo',sans-serif;display:flex;align-items:center;gap:4px">
          <span style="width:16px;height:16px;border-radius:50%;background:${bg};color:${clr};font-size:8px;font-weight:800;display:inline-flex;align-items:center;justify-content:center">${avInitials(m.name)}</span>
          ${m.name.split(' ')[0]}
          <span style="background:${sel?'var(--accent)':clr};color:#fff;border-radius:10px;padding:0 5px;font-size:9px">${cnt}</span>
        </button>`;
      }).join('')}
    </div>

    <!-- type + sort -->
    <div style="display:flex;gap:6px;flex-shrink:0">
      <select class="filter-select" style="font-size:11px;padding:4px 8px"
        onchange="S.taskFilter=S.taskFilter||{};S.taskFilter.type=this.value;renderPage()">
        ${typeOpts.map(([v,l])=>`<option value="${v}" ${ft===v?'selected':''}>${l}</option>`).join('')}
      </select>
      <select class="filter-select" style="font-size:11px;padding:4px 8px"
        onchange="S.taskFilter=S.taskFilter||{};S.taskFilter.sort=this.value;renderPage()">
        ${sortOpts.map(([v,l])=>`<option value="${v}" ${fs===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>
  </div>
  `;
}


function taskCardHTML(t){
  const over48=(t.status!=='done')&&hrs(t.createdAt)>=48;
  const overdue=(t.status!=='done')&&t.date<today();
  const snoozeStr=t.snoozedUntil?new Date(t.snoozedUntil).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):null;
  const typeLbl={tax:'רשויות מס',internal:'פנימי',meeting:'פגישה'}[t.type];
  const av=avInitials(t.assignee);
  const isDone=t.status==='done';
  const isInprog=t.status==='inprogress';
  const statusColor={pending:'#dc2626',inprogress:'#d97706',done:'#16a34a'}[t.status];
  const statusLabel={pending:'טרם טופל',inprogress:'בביצוע',done:'טופל'}[t.status];
  const pinnedStyle=t.pinned?'border-color:#f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,.15);':'';
  return `
  <div class="task-card p-${t.priority} ${overdue?'overdue-card':''} ${isDone?'done-card':''}" style="${pinnedStyle}">
    ${t.pinned?`<div style="font-size:10px;font-weight:700;color:#b45309;margin-bottom:6px;display:flex;align-items:center;gap:4px">📌 מוצמדת לראש הרשימה</div>`:''}
    <div class="tc-top">
      <div class="tc-check ${isDone?'checked':''}" onclick="cycleStatus(${t.id})" title="לחץ לשינוי סטטוס">
        <svg width="9" height="9" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="tc-body">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="tc-title ${isDone?'done-text':''}">${t.title}</div>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40">${statusLabel}</span>
        </div>
        <div class="tc-meta">
          <span class="badge badge-${t.type}">${typeLbl}</span>
          ${t.recurring?`<span class="badge" style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0">🔁 ${recLabel(t.recurring.type)}</span>`:''}
          ${t.priority==='urgent'?'<span class="badge" style="background:#fee2e2;color:#b91c1c">🔴 דחוף</span>':''}
          ${overdue?'<span class="badge badge-overdue">באיחור</span>':''}
          ${over48?'<span class="badge badge-48h">⏰ +48 שעות</span>':''}
          ${t.remindedAt?'<span class="badge badge-reminded">תזכורת נשלחה</span>':''}
          <span class="tc-date">📅 ${fmtD(t.date)}</span>
          <span class="tc-assignee"><span class="av-xs">${av}</span>${t.assignee}</span>
        </div>
        ${snoozeStr&&!isDone?`<div class="snooze-label">⏰ תזכורת הבאה: ${snoozeStr}</div>`:''}
        <div class="tc-actions">
          ${!isDone?`
            <button class="tc-btn" style="background:${isInprog?'#fff7ed':'transparent'};color:${isInprog?'#d97706':'var(--text2)'};border-color:${isInprog?'#fcd34d':'var(--border)'}" onclick="setStatus(${t.id},'${isInprog?'pending':'inprogress'}')">${isInprog?'⏸ עצור':'▶ התחל טיפול'}</button>
            <button class="tc-btn b-done" onclick="setStatus(${t.id},'done')">✓ סמן כטופל</button>
            <button class="tc-btn" style="color:#b45309;border-color:#fcd34d" onclick="pinTask(${t.id})" title="${t.pinned?'הסר הצמדה':'הצמד לראש'}">${t.pinned?'📌 הסר הצמדה':'📌 הצמד'}</button>
            <button class="tc-btn b-remind" onclick="manualRemind(${t.id})">📲 תזכורת</button>
            ${t.priority==='urgent'?`<button class="tc-btn" style="background:#fee2e2;color:#b91c1c;border-color:#fca5a5;font-weight:700" onclick="urgentWA(${t.id})">🚨 וואטסאפ דחוף</button>`:''}
            <button class="tc-btn b-snooze" onclick="openSnoozeModal(${t.id})">⏰ דחה</button>
          `:`
            <button class="tc-btn" style="color:var(--text2)" onclick="setStatus(${t.id},'pending')">↩ פתח מחדש</button>
          `}
        </div>
      </div>
    </div>
  </div>`;
}

function cycleStatus(id){
  const t=S.tasks.find(t=>t.id===id);if(!t)return;
  const cycle={pending:'inprogress',inprogress:'done',done:'pending'};
  const labels={pending:'טרם טופל',inprogress:'בביצוע',done:'טופל'};
  t.status=cycle[t.status];
  t.done=t.status==='done';
  taskTab=t.status;
  renderPage();toast(`סטטוס עודכן → ${labels[t.status]}`);
}

function setStatus(id,status){
  const t=S.tasks.find(t=>t.id===id);if(!t)return;
  t.status=status;t.done=status==='done';
  taskTab=status;
  renderPage();
  const labels={pending:'טרם טופל',inprogress:'בביצוע ▶',done:'טופל ✓'};
  toast(`✓ ${t.title} → ${labels[status]}`);
}

function pinTask(id){
  const t=S.tasks.find(t=>t.id===id);if(!t)return;
  t.pinned=!t.pinned;
  renderPage();toast(t.pinned?'📌 המשימה הוצמדה לראש!':'📌 ההצמדה הוסרה');
}

function urgentWA(id){
  const t=S.tasks.find(t=>t.id===id);if(!t)return;
  t.remindedAt=Date.now();
  const msg=`🚨 *הודעה דחופה*\nשלום ${t.assignee},\nהמשימה *"${t.title}"* דחופה ודורשת טיפול מיידי!\nתאריך יעד: ${fmtD(t.date)}\nאנא עדכן סטטוס בהקדם.`;
  S.waMessages.push({text:msg,time:timeStr(),converted:false,auto:false,urgent:true});
  S.reminders.push({task:t.title,assignee:t.assignee,time:timeStr(),type:'🚨 דחוף',auto:false});
  renderPage();toast(`🚨 וואטסאפ דחוף נשלח ל${t.assignee}!`);
}

// ══════════════════════════════════════
//  WHATSAPP
// ══════════════════════════════════════
function renderWAPage(){
  if(!S.reminders)S.reminders=[];
  if(!S.clients)S.clients=[];
  if(!S.tasks)S.tasks=[];
  if(!S.waMessages)S.waMessages=[];
  if(!S.team)S.team=[];
  const waTab=S.inboxTab||'whatsapp';
  const msgs=[...S.waMessages].filter(m=>m.channel===(waTab==='email'?'email':'whatsapp')||(!m.channel&&waTab==='whatsapp'));
  const allConverted=S.waMessages.filter(m=>m.converted);

  const myWaNumber = '📱 972-50-XXX-XXXX';
  const myEmail = '📧 tasks@'+( S.office?.name?.replace(/\s/g,'')||'office')+'.taxapp.co.il';

  return `
  <!-- CHANNEL TABS -->
  <div style="display:flex;gap:0;margin-bottom:14px;background:var(--surface3);border-radius:10px;padding:3px;width:fit-content">
    <button onclick="S.inboxTab='whatsapp';renderPage()" style="display:flex;align-items:center;gap:6px;padding:7px 16px;border-radius:8px;border:none;font-family:'Heebo',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;background:${waTab==='whatsapp'?'var(--surface)':'transparent'};color:${waTab==='whatsapp'?'var(--text)':'var(--text2)'};box-shadow:${waTab==='whatsapp'?'0 1px 4px rgba(0,0,0,.1)':'none'}">
      💬 וואטסאפ <span style="background:#25D366;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px">${S.waMessages.filter(m=>!m.channel||m.channel==='whatsapp').length}</span>
    </button>
    <button onclick="S.inboxTab='email';renderPage()" style="display:flex;align-items:center;gap:6px;padding:7px 16px;border-radius:8px;border:none;font-family:'Heebo',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;background:${waTab==='email'?'var(--surface)':'transparent'};color:${waTab==='email'?'var(--text)':'var(--text2)'};box-shadow:${waTab==='email'?'0 1px 4px rgba(0,0,0,.1)':'none'}">
      📧 מייל <span style="background:var(--accent);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px">${S.waMessages.filter(m=>m.channel==='email').length}</span>
    </button>
  </div>

  <!-- INFO BOX -->
  <div style="background:${waTab==='whatsapp'?'#f0fdf4':'#eff6ff'};border:1px solid ${waTab==='whatsapp'?'#bbf7d0':'#bfdbfe'};border-radius:var(--radius-lg);padding:12px 14px;margin-bottom:14px">
    <div style="font-size:12px;font-weight:700;color:${waTab==='whatsapp'?'#166534':'#1e40af'};margin-bottom:6px">${waTab==='whatsapp'?'💬 שלח משימות בוואטסאפ':'📧 שלח משימות במייל'}</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px">
      ${waTab==='whatsapp'?`שלח הודעה חופשית למספר הייעודי שלך – ה-AI יזהה אוטומטית את המשימה, העובד, הדחיפות והתאריך.`:`שלח מייל לכתובת הייעודית שלך – נושא המייל יהפוך לכותרת המשימה.`}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface);border-radius:var(--radius);padding:8px 12px;border:1px solid var(--border)">
      <span style="font-size:13px;font-weight:700;direction:ltr">${waTab==='whatsapp'?myWaNumber:myEmail}</span>
      <button class="btn sm" onclick="toast('📋 הועתק!')">העתק</button>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--text2)">
      <div style="font-weight:600;margin-bottom:4px">דוגמאות לשליחה:</div>
      ${waTab==='whatsapp'?`
      <div style="display:flex;flex-direction:column;gap:3px">
        <div onclick="document.getElementById('wa-in').value=this.querySelector('span').textContent" style="cursor:pointer;padding:4px 8px;background:var(--surface);border-radius:6px;border:1px solid var(--border)" title="לחץ לשימוש">👆 <span>"שרה לוי – מקדמה לקוח כהן עד 25/3 דחוף"</span></div>
        <div onclick="document.getElementById('wa-in').value=this.querySelector('span').textContent" style="cursor:pointer;padding:4px 8px;background:var(--surface);border-radius:6px;border:1px solid var(--border)" title="לחץ לשימוש">👆 <span>"דוד גולדברג הגש דוח מע״מ השבוע"</span></div>
        <div onclick="document.getElementById('wa-in').value=this.querySelector('span').textContent" style="cursor:pointer;padding:4px 8px;background:var(--surface);border-radius:6px;border:1px solid var(--border)" title="לחץ לשימוש">👆 <span>"פגישה עם לקוח לוי מחר 10:00 – אני מטפל"</span></div>
      </div>`:`
      <div style="display:flex;flex-direction:column;gap:3px">
        <div style="padding:4px 8px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">📌 <strong>נושא:</strong> מקדמה לקוח כהן – דחוף | <strong>גוף:</strong> שרה – עד 25/3</div>
        <div style="padding:4px 8px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">📌 <strong>נושא:</strong> הגשת דוח מע"מ | <strong>גוף:</strong> דוד – רבעון ראשון</div>
      </div>`}
    </div>
  </div>

  <!-- MESSAGE FEED -->
  <div class="wa-panel">
    <div class="wa-head">
      <div class="${waTab==='whatsapp'?'wa-dot-live':''}" style="${waTab==='email'?'width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0':''}"></div>
      <div>
        <div class="wa-title">${waTab==='whatsapp'?'תיבת וואטסאפ':'תיבת מייל'}</div>
        <div class="wa-sub">הודעות נכנסות · ה-AI מנתח ומייצר משימות אוטומטית</div>
      </div>
    </div>
    <div class="wa-msgs" id="wa-msgs">
      ${msgs.length?msgs.map((m,i)=>`
        <div class="wa-msg ${m.auto?'auto-msg':''}" style="${m.urgent?'border-right:3px solid #dc2626;background:#fffbfb;':''}${m.channel==='email'?'border-right:3px solid #2563eb;':''}">
          ${m.channel==='email'?`<div style="font-size:10px;font-weight:700;color:var(--accent);margin-bottom:4px">📧 מ: ${m.from||'לקוח'} · נושא: ${m.subject||m.text.substring(0,30)}</div>`:''}
          <div style="white-space:pre-wrap">${m.text}</div>
          ${m.parsed?`<div style="margin-top:6px;padding:6px 8px;background:var(--surface3);border-radius:6px;font-size:11px">
            🤖 <strong>AI זיהה:</strong>
            ${m.parsed.assignee?`👤 ${m.parsed.assignee}`:''}
            ${m.parsed.priority==='urgent'?'🔴 דחוף':''}
            ${m.parsed.date?`📅 ${m.parsed.date}`:''}
            ${m.parsed.type?`· ${{tax:'רשויות מס',meeting:'פגישה',internal:'פנימי'}[m.parsed.type]||''}` :''}
          </div>`:''}
          ${m.parsing?`<div style="margin-top:6px;padding:6px 8px;background:#fffbeb;border-radius:6px;font-size:11px;color:#92400e;display:flex;align-items:center;gap:6px"><span style="animation:spin 1s linear infinite;display:inline-block">⏳</span> Claude AI מנתח את ההודעה...</div>`:''}
          ${m.converted
            ?`<div class="wa-msg-action" style="color:var(--success)">✓ נוצרה משימה: <strong>${m.taskTitle}</strong></div>`
            :m.parsing?''
            :`<div class="wa-msg-action" onclick="smartConvert(${S.waMessages.indexOf(m)})">⚡ המר למשימה עם AI</div>`}
          <div class="wa-msg-time">${m.channel==='email'?'📧 מייל · ':''}${m.time}</div>
        </div>`).join('')
      :'<div class="empty-state" style="padding:20px">אין הודעות עדיין</div>'}
    </div>
    <div class="wa-input-row">
      <input class="wa-input" id="wa-in" placeholder='${waTab==='whatsapp'?'הקלד הודעה חופשית... "שרה – מקדמה כהן עד 25/3 דחוף"':'נושא: | גוף: שם עובד והוראות'}' onkeydown="if(event.key==='Enter')sendMsg('${waTab}')"/>
      <button class="wa-send" style="${waTab==='email'?'background:var(--accent);':'background:#25D366;'}" onclick="sendMsg('${waTab}')">▶</button>
    </div>
  </div>

  <!-- CONVERTED LOG -->
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;margin-top:4px">משימות שנוצרו מהודעות (${allConverted.length})</div>
  <div class="s-card" style="padding:12px">
    ${allConverted.length?[...allConverted].reverse().map(m=>`
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span>${m.channel==='email'?'📧':'💬'}</span>
        <div style="flex:1">
          <div style="font-weight:600">${m.taskTitle}</div>
          <div style="color:var(--text2);margin-top:1px">${m.parsed?.assignee||'לא שויך'} · ${m.parsed?.priority==='urgent'?'🔴 דחוף':'רגיל'}</div>
        </div>
        <div style="color:var(--text3);font-size:10px">${m.time}</div>
      </div>`).join('')
    :'<div class="empty-state">אין משימות שנוצרו עדיין</div>'}
  </div>`;
}

// ══════════════════════════════════════
//  🤖 REAL AI PARSER – Claude API
// ══════════════════════════════════════
async function aiParseWithClaude(text, channel){
  const teamNames = S.team.map(m=>m.name).join(', ');
  const prompt = `אתה עוזר חכם של משרד ייעוץ מס. קיבלת הודעה ${channel==='email'?'במייל':'בוואטסאפ'} ועליך לחלץ ממנה פרטי משימה.

רשימת העובדים במשרד: ${teamNames}

הודעה: "${text}"

החזר JSON בלבד (ללא markdown, ללא הסברים) עם המבנה הבא:
{
  "title": "כותרת קצרה וברורה של המשימה (עד 60 תווים)",
  "assignee": "שם העובד המלא מהרשימה (אם לא צוין בחר '${S.user?.name||'אני'}' כברירת מחדל)",
  "priority": "urgent או normal (urgent אם יש מילות דחיפות: דחוף/מיידי/ASAP/!! וכדומה)",
  "date": "תאריך יעד בפורמט YYYY-MM-DD (אם לא צוין החזר תאריך עוד 7 ימים)",
  "type": "tax אם קשור לרשות מס/מע\"מ/מס הכנסה, meeting אם פגישה, internal לשאר",
  "summary": "שורת סיכום קצרה מה בדיוק צריך לעשות"
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{role:'user', content: prompt}]
      })
    });
    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(clean);
    // וודא שהתאריך תקין
    if(!parsed.date || isNaN(new Date(parsed.date))) {
      const d=new Date(); d.setDate(d.getDate()+7);
      parsed.date=d.toISOString().slice(0,10);
    }
    return parsed;
  } catch(e) {
    // fallback לפרסור מקומי אם ה-API לא זמין
    return aiParseFallback(text);
  }
}

// פרסור מקומי כגיבוי
function aiParseFallback(text){
  const lower=text.toLowerCase();
  let assignee=S.user?.name||'אני';
  S.team.forEach(m=>{
    const fn=m.name.split(' ')[0];
    if(text.includes(m.name)||text.includes(fn)) assignee=m.name;
  });
  const urgentWords=['דחוף','דחופה','urgent','!!','מיידי','asap','בהקדם'];
  const priority=urgentWords.some(w=>lower.includes(w))?'urgent':'normal';
  const dateMatch=text.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
  let date=null;
  if(dateMatch){
    const y=dateMatch[3]?(dateMatch[3].length===2?'20'+dateMatch[3]:dateMatch[3]):new Date().getFullYear();
    date=`${y}-${String(dateMatch[2]).padStart(2,'0')}-${String(dateMatch[1]).padStart(2,'0')}`;
  }
  if(!date){
    const d=new Date();
    if(lower.includes('מחר')){d.setDate(d.getDate()+1);}
    else if(lower.includes('השבוע')){d.setDate(d.getDate()+5);}
    else if(lower.includes('חודש הבא')){d.setMonth(d.getMonth()+1);}
    else d.setDate(d.getDate()+7);
    date=d.toISOString().slice(0,10);
  }
  const taxWords=['מע"מ','מס','דוח','רשות','מקדמה','ביטוח לאומי','ניכוי'];
  const meetWords=['פגישה','פגש','meeting','זום','zoom'];
  const type=taxWords.some(w=>text.includes(w))?'tax':meetWords.some(w=>lower.includes(w))?'meeting':'internal';
  let title=text.replace(/דחוף|דחופה|urgent|!!/gi,'').replace(/\d{1,2}[\/\-\.]\d{1,2}/g,'').trim().replace(/\s+/g,' ').substring(0,55);
  if(!title) title=text.substring(0,55);
  return {title,assignee,priority,date,type,summary:text.substring(0,80)};
}

// ── SEND MESSAGE (WA or Email) ──
async function sendMsg(channel){
  const inp=document.getElementById('wa-in');
  const text=inp.value.trim(); if(!text) return;
  const time=timeStr();
  const isEmail=channel==='email';

  // הוסף הודעה עם סטטוס "מנתח..."
  const msgObj={text,time,converted:false,channel,from:isEmail?S.user?.email:null,parsing:true,auto:false};
  S.waMessages.push(msgObj);
  inp.value='';
  renderPage();

  // קרא ל-Claude API לניתוח
  const parsed = await aiParseWithClaude(text, channel);
  const idx=S.waMessages.indexOf(msgObj);
  if(idx<0) return;

  S.waMessages[idx].parsing=false;
  S.waMessages[idx].converted=true;
  S.waMessages[idx].taskTitle=parsed.title;
  S.waMessages[idx].parsed=parsed;
  S.waMessages[idx].urgent=parsed.priority==='urgent';

  S.tasks.push({
    id:S.nextId++,
    title:parsed.title,
    type:parsed.type||'internal',
    assignee:parsed.assignee,
    date:parsed.date,
    priority:parsed.priority,
    notes:parsed.summary||text,
    done:false,status:'pending',
    createdAt:Date.now(),remindedAt:null,snoozedUntil:null,pinned:false,
    source:isEmail?'📧 מייל':'💬 וואטסאפ',
  });

  renderPage();
  toast(`🤖 AI זיהה: ${parsed.assignee} · ${parsed.priority==='urgent'?'🔴 דחוף':'רגיל'} · ✓ משימה נוצרה!`);
}

async function smartConvert(i){
  const m=S.waMessages[i]; if(!m) return;
  m.parsing=true; renderPage();
  const parsed = await aiParseWithClaude(m.text, m.channel||'whatsapp');
  m.parsing=false; m.converted=true; m.parsed=parsed; m.taskTitle=parsed.title;
  S.tasks.push({
    id:S.nextId++,title:parsed.title,type:parsed.type||'internal',
    assignee:parsed.assignee,date:parsed.date,priority:parsed.priority,
    notes:parsed.summary||m.text,done:false,status:'pending',
    createdAt:Date.now(),remindedAt:null,snoozedUntil:null,pinned:false,
    source:m.channel==='email'?'📧 מייל':'💬 וואטסאפ',
  });
  renderPage();
  toast(`🤖 AI יצר משימה: ${parsed.title} → ${parsed.assignee}`);
}

function sendWA(){ sendMsg('whatsapp'); }
function convertWA(i){ smartConvert(i); }





// ══════════════════════════════════════
//  REMINDERS
// ══════════════════════════════════════
function renderRemindersPage(){
  if(!S.reminders)S.reminders=[];
  if(!S.clients)S.clients=[];
  if(!S.tasks)S.tasks=[];
  if(!S.waMessages)S.waMessages=[];
  if(!S.team)S.team=[];
  const now=Date.now();
  // משימות שדורשות תזכורת – 48 שעות ולא טופלו
  const overdue48=S.tasks.filter(t=>t.status!=='done'&&hrs(t.createdAt)>=48&&!t.snoozedUntil||t.snoozedUntil&&now>t.snoozedUntil&&t.status!=='done');
  // משימות שהגיע מועד הטיפול שלהן
  const dueSoon=S.tasks.filter(t=>t.status!=='done'&&t.date<=today()&&!overdue48.find(x=>x.id===t.id));
  // משימות חוזרות
  const recurring=S.tasks.filter(t=>t.recurring&&t.status!=='done');

  // ביצועי עובדים
  const workerStats=S.team.map(w=>{
    const total=S.tasks.filter(t=>t.assignee===w.name).length;
    const done=S.tasks.filter(t=>t.assignee===w.name&&t.status==='done').length;
    const overdue=S.tasks.filter(t=>t.assignee===w.name&&t.status!=='done'&&t.date<today()).length;
    const inprog=S.tasks.filter(t=>t.assignee===w.name&&t.status==='inprogress').length;
    const rate=total>0?Math.round(done/total*100):0;
    return {...w,total,done,overdue,inprog,rate};
  });

  return `
  <!-- מנוע פעיל -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;background:var(--success-bg);border:1px solid #bbf7d0;border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--success)">
    <div class="pulse-dot"></div>
    <strong>מנוע תזכורות פעיל</strong> · בודק כל 30 שניות · תזכורת אוטומטית לאחר 48 שעות
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">

    <!-- 48 שעות -->
    <div class="s-card">
      <div class="s-card-title" style="color:var(--danger)">⏰ מעל 48 שעות ללא טיפול (${overdue48.length})</div>
      ${overdue48.length?overdue48.map(t=>`
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:12px;font-weight:600">${t.title}</div>
            <div style="font-size:10px;color:var(--text2);margin-top:2px">👤 ${t.assignee} · ⏱ ${Math.floor(hrs(t.createdAt))} שעות</div>
          </div>
          <button class="btn sm" style="font-size:10px;color:#b45309;border-color:#fcd34d" onclick="manualRemind(${t.id})">📲 שלח</button>
        </div>`).join('')
      :'<div class="empty-state" style="padding:16px">אין משימות דחופות 🎉</div>'}
    </div>

    <!-- הגיע מועד -->
    <div class="s-card">
      <div class="s-card-title" style="color:var(--warning)">📅 הגיע מועד הטיפול (${dueSoon.length})</div>
      ${dueSoon.length?dueSoon.map(t=>`
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:12px;font-weight:600">${t.title}</div>
            <div style="font-size:10px;color:var(--text2);margin-top:2px">👤 ${t.assignee} · 📅 ${fmtD(t.date)}</div>
          </div>
          <button class="btn sm" style="font-size:10px;color:#b45309;border-color:#fcd34d" onclick="manualRemind(${t.id})">📲 שלח</button>
        </div>`).join('')
      :'<div class="empty-state" style="padding:16px">אין משימות שהגיע מועדן</div>'}
    </div>
  </div>

  <!-- תזכורות חוזרות -->
  <div class="s-card" style="margin-bottom:16px">
    <div class="s-card-title">🔁 משימות חוזרות – תזכורות מתוזמנות (${recurring.length})</div>
    ${recurring.length?recurring.map(t=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span style="font-size:16px">🔁</span>
        <div style="flex:1">
          <div style="font-weight:600">${t.title}</div>
          <div style="color:var(--text2);margin-top:2px;font-size:11px">
            ${recLabel(t.recurring.type)} · תזכורת ${t.recurring.remindDaysBefore} ימים לפני
            · 👤 ${t.assignee}
          </div>
        </div>
        <div style="text-align:left">
          <div style="font-size:10px;color:var(--text3)">יעד: ${fmtD(t.date)}</div>
          <button class="btn sm" style="font-size:10px;margin-top:3px" onclick="manualRemind(${t.id})">📲 שלח עכשיו</button>
        </div>
      </div>`).join('')
    :'<div class="empty-state">אין משימות חוזרות פעילות</div>'}
  </div>

  <!-- היסטוריית תזכורות שנשלחו -->
  <div class="s-card">
    <div class="s-card-title">📋 היסטוריית תזכורות שנשלחו (${S.reminders.length})</div>
    ${S.reminders.length?[...S.reminders].reverse().slice(0,15).map(r=>`
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span style="font-size:16px">${r.auto?'🤖':'📲'}</span>
        <div style="flex:1">
          <div style="font-weight:600">${r.task}</div>
          <div style="color:var(--text2);font-size:11px">${r.assignee} · ${r.type}</div>
        </div>
        <div style="color:var(--text3);font-size:11px">${r.time}</div>
      </div>`).join('')
    :'<div class="empty-state">עדיין לא נשלחו תזכורות</div>'}
  </div>`;
}


// ══════════════════════════════════════
//  DEADLINES
// ══════════════════════════════════════
function renderDeadlinesPage(){
  return `
  <div class="section-title" style="margin-bottom:12px">דדליינים לרשויות מס</div>
  ${deadlines.map(d=>`
    <div class="deadline-card ${d.days<=7?'hot':''}">
      <div class="deadline-days ${d.days<=7?'hot':'ok'}">${d.days}</div>
      <div class="deadline-info">
        <div class="deadline-title">${d.title}</div>
        <div class="deadline-date">עד ${fmtD(d.date)} · <span style="color:${d.days<=7?'var(--danger)':'var(--text3)'}">עוד ${d.days} ימים</span></div>
      </div>
      <span class="badge badge-tax">רשויות מס</span>
    </div>`).join('')}`;
}

// ══════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════
let sSection='office';
let taskTab='pending';
function renderSettingsPage(){
  const sections={
    office: renderOfficeSettings(),
    personal: renderPersonalSettings(),
    team: renderTeamSettings(),
    notifications: renderNotifSettings(),
    permissions: renderPermSettings(),
    whatsapp: renderWASettings(),
    history: renderHistorySettings(),
    performance: renderPerformanceSettings(),
  };
  const navItems=[
    {id:'office',icon:'🏢',label:'פרטי משרד'},
    {id:'personal',icon:'👤',label:'פרופיל אישי'},
    {id:'team',icon:'👥',label:'צוות'},
    {id:'notifications',icon:'🔔',label:'התראות'},
    {id:'permissions',icon:'🔒',label:'הרשאות'},
    {id:'whatsapp',icon:'💬',label:'חיבורים'},
    {id:'history',icon:'📋',label:'היסטוריה'},
    {id:'performance',icon:'📊',label:'מדד ביצועים'},
  ];
  const officeName=S.office?.name||'משרד ייעוץ מס';
  const userName=S.user?.name||'';
  return `
  <div class="settings-layout">
    <div class="settings-nav">
      ${navItems.map(n=>`<div class="s-nav-item ${sSection===n.id?'active':''}" onclick="switchSSection('${n.id}')">${n.icon} ${n.label}</div>`).join('')}
      <!-- שם משרד בפינה כמו פייסבוק -->
      <div style="position:absolute;bottom:0;right:0;left:0;padding:12px;border-top:1px solid var(--border);background:var(--surface)">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--accent-light);color:var(--accent);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${S.user?.initials||'?'}</div>
          <div style="overflow:hidden">
            <div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${userName}</div>
            <div style="font-size:10px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🏢 ${officeName}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="settings-content">
      ${sections[sSection]||''}
    </div>
  </div>`;
}
function switchSSection(id){sSection=id;renderPage();}

function renderHistorySettings(){
  const allReminders=[...S.reminders].reverse();
  const allWA=[...S.waMessages].reverse();
  return `
  <div class="s-card">
    <div class="s-card-title">📋 היסטוריית תזכורות שנשלחו (${S.reminders.length})</div>
    ${allReminders.length?allReminders.map(r=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span style="font-size:16px">${r.auto?'🤖':'📲'}</span>
        <div style="flex:1">
          <div style="font-weight:600">${r.task}</div>
          <div style="color:var(--text2)">${r.assignee} · ${r.type}</div>
        </div>
        <div style="color:var(--text3);font-size:11px">${r.time}</div>
      </div>`).join('')
    :'<div class="empty-state">לא נשלחו תזכורות עדיין</div>'}
  </div>
  <div class="s-card" style="margin-top:14px">
    <div class="s-card-title">💬 היסטוריית הודעות (${S.waMessages.length})</div>
    ${allWA.length?allWA.slice(0,20).map(m=>`
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span>${m.channel==='email'?'📧':'💬'}</span>
        <div style="flex:1">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px">${m.text?.substring(0,60)}${m.text?.length>60?'...':''}</div>
          <div style="color:var(--text2);font-size:10px;margin-top:2px">${m.converted?'✓ הוסב למשימה':''} ${m.auto?'· אוטומטי':''}</div>
        </div>
        <div style="color:var(--text3);font-size:10px;flex-shrink:0">${m.time}</div>
      </div>`).join('')
    :'<div class="empty-state">אין היסטוריית הודעות</div>'}
  </div>`;
}


function renderOfficeSettings(){
  return `
  <div class="s-card">
    <div class="s-card-title">לוגו ופרטי משרד</div>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
      <div class="logo-upload-zone" onclick="document.getElementById('lf').click()" title="לחץ להעלאת לוגו">
        <span id="logo-emoji-s">📋</span><img id="logo-img-s" style="display:none"/>
      </div>
      <input type="file" id="lf" accept="image/*" style="display:none" onchange="prevLogo(this)"/>
      <div style="font-size:11px;color:var(--text2)">לחץ להעלאת לוגו המשרד<br/>PNG / JPG · 200×200px מומלץ</div>
    </div>
    <div class="form-grid">
      <div class="form-row"><label class="form-label">שם המשרד</label><input class="form-input" value="${S.office.name}" onchange="S.office.name=this.value"/></div>
      <div class="form-row"><label class="form-label">מספר רישיון</label><input class="form-input" placeholder="000000000"/></div>
      <div class="form-row"><label class="form-label">טלפון ראשי</label><input class="form-input" type="tel" value="${S.office.phone}" dir="ltr" onchange="S.office.phone=this.value"/></div>
      <div class="form-row"><label class="form-label">אימייל</label><input class="form-input" type="email" value="${S.office.email}" dir="ltr" onchange="S.office.email=this.value"/></div>
      <div class="form-row full"><label class="form-label">כתובת</label><input class="form-input" value="${S.office.addr}" onchange="S.office.addr=this.value"/></div>
    </div>
    <div class="save-row"><span class="saved-ok" id="sv-office">✓ נשמר</span><button class="btn primary" onclick="saveSection('office')">שמור שינויים</button></div>
  </div>`;
}

function renderPersonalSettings(){
  return `
  <div class="s-card">
    <div class="s-card-title">פרטים אישיים</div>
    <div class="form-grid">
      <div class="form-row"><label class="form-label">שם פרטי</label><input class="form-input" value="${S.user?.name?.split(' ')[0]||''}"/></div>
      <div class="form-row"><label class="form-label">שם משפחה</label><input class="form-input" value="${S.user?.name?.split(' ')[1]||''}"/></div>
      <div class="form-row"><label class="form-label">טלפון נייד</label><input class="form-input" type="tel" placeholder="050-0000000" dir="ltr"/></div>
      <div class="form-row"><label class="form-label">אימייל</label><input class="form-input" type="email" value="${S.user?.email||''}" dir="ltr"/></div>
      <div class="form-row"><label class="form-label">תפקיד</label>
        <select class="form-input"><option>בעל/ת משרד</option><option>מנהל/ת</option><option>יועץ/ת מס</option></select>
      </div>
      <div class="form-row"><label class="form-label">וואטסאפ לתזכורות</label><input class="form-input" type="tel" placeholder="972501234567" dir="ltr"/><span class="form-hint">פורמט בינלאומי ללא +</span></div>
    </div>
    <div class="save-row"><span class="saved-ok" id="sv-personal">✓ נשמר</span><button class="btn primary" onclick="saveSection('personal')">שמור שינויים</button></div>
  </div>
  <div class="s-card">
    <div class="s-card-title">אבטחה</div>
    <div class="form-grid">
      <div class="form-row"><label class="form-label">סיסמה חדשה</label><input class="form-input" type="password" placeholder="הזן סיסמה חדשה"/></div>
      <div class="form-row"><label class="form-label">אימות סיסמה</label><input class="form-input" type="password" placeholder="הזן שוב"/></div>
    </div>
    <div class="save-row"><button class="btn" onclick="toast('🔒 סיסמה עודכנה!')">עדכן סיסמה</button></div>
  </div>`;
}

function renderTeamSettings(){
  const cards=S.team.map(m=>{
    const [bg,clr]=m.colors;
    const initials=m.name.split(' ').map(w=>w[0]).join('').slice(0,2);
    const roleLbl={owner:'בעל משרד',manager:'מנהל',employee:'עובד'}[m.role];
    const rClass={owner:'rp-owner',manager:'rp-manager',employee:'rp-employee'}[m.role];
    return `
    <div class="member-card">
      <div class="member-av" style="background:${bg};color:${clr}">${initials}</div>
      <div class="member-info">
        <div class="member-name">${m.name} ${m.role==='owner'?'👑':''}</div>
        <div class="member-sub">
          <span class="role-pill ${rClass}">${roleLbl}</span>
          <span>${m.email}</span><span>${m.phone}</span>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px">${{full:'גישה מלאה',edit:'יצירה ועריכה',view:'צפייה בלבד'}[m.perm]} · <span style="color:var(--success)">● ${m.status}</span>${m.notifyLabel?` · ${m.notifyLabel}`:''}</div>
      </div>
      ${m.role!=='owner'?`<div style="display:flex;gap:6px">
        <button class="btn sm" onclick="openEditMember(${m.id})">✏️ עריכה</button>
        <button class="btn sm" onclick="toast('📲 הזמנה נשלחה ל${m.name}')">📲</button>
        <button class="btn sm danger" onclick="removeMember(${m.id})">הסר</button>
      </div>`:`<div style="display:flex;gap:6px">
        <button class="btn sm" onclick="openEditMember(${m.id})">✏️ עריכה</button>
      </div>`}
    </div>`;
  }).join('');

  // invite codes section
  const codes = S.inviteCodes||[];
  const codesHTML = codes.length ? codes.map(c=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-family:monospace;font-size:14px;font-weight:700;letter-spacing:2px;color:${c.used?'var(--text3)':'var(--accent)'}">${c.code}</span>
          ${c.used?`<span style="font-size:10px;background:#f1f5f9;color:var(--text2);padding:1px 7px;border-radius:20px">✓ נוצל ע"י ${c.usedBy||'?'}</span>`
          :`<span style="font-size:10px;background:#dcfce7;color:#166534;padding:1px 7px;border-radius:20px">פעיל עד ${c.expiry}</span>`}
        </div>
        <div style="color:var(--text2);margin-top:2px">${{owner:'בעל משרד',manager:'מנהל',employee:'עובד'}[c.role]||'עובד'} · ${c.singleUse?'שימוש חד-פעמי':'שימושים מרובים'}</div>
      </div>
      ${!c.used?`
      <button class="btn sm" onclick="copyCode('${c.code}')">📋 העתק</button>
      <button class="btn sm" onclick="shareCode('${c.code}','${c.role}')">📲 שתף</button>`
      :''}
    </div>`).join('')
  : '<div style="color:var(--text3);font-size:12px;padding:8px 0">לא נוצרו קודות עדיין</div>';

  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
    <span class="section-title">${S.team.length} חברי צוות</span>
    <button class="btn primary" onclick="openModal('member')">+ הוסף עובד</button>
  </div>
  ${cards}

  <!-- INVITE CODES -->
  <div class="s-card" style="margin-top:16px">
    <div class="s-card-title">🔑 קודות הזמנה</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">
      צור קוד ושלח לעובד – הוא/היא יוכלו להירשם רק עם הקוד שלך.
      הקוד מוגדר לתפקיד ספציפי ופג לאחר 30 יום.
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      <button class="btn" style="flex-direction:column;gap:3px;padding:10px 6px;text-align:center" onclick="createAndShowCode('employee')">
        <span style="font-size:18px">👤</span>
        <span style="font-size:11px;font-weight:600">קוד לעובד</span>
        <span style="font-size:10px;color:var(--text2)">הרשאות עריכה</span>
      </button>
      <button class="btn" style="flex-direction:column;gap:3px;padding:10px 6px;text-align:center" onclick="createAndShowCode('manager')">
        <span style="font-size:18px">👔</span>
        <span style="font-size:11px;font-weight:600">קוד למנהל</span>
        <span style="font-size:10px;color:var(--text2)">הרשאות מלאות</span>
      </button>
      <button class="btn" style="flex-direction:column;gap:3px;padding:10px 6px;text-align:center" onclick="createAndShowCode('employee','view')">
        <span style="font-size:18px">👁️</span>
        <span style="font-size:11px;font-weight:600">קוד לצפייה</span>
        <span style="font-size:10px;color:var(--text2)">קריאה בלבד</span>
      </button>
    </div>
    <div id="new-code-banner" style="display:none;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:var(--radius);padding:12px;margin-bottom:12px;text-align:center">
      <div style="font-size:11px;color:#1e40af;margin-bottom:6px">קוד הזמנה חדש – שתף עם העובד:</div>
      <div id="new-code-val" style="font-family:monospace;font-size:24px;font-weight:700;letter-spacing:4px;color:var(--accent)"></div>
      <div style="display:flex;justify-content:center;gap:8px;margin-top:8px">
        <button class="btn sm" onclick="copyCode(document.getElementById('new-code-val').textContent)">📋 העתק</button>
        <button class="btn sm" onclick="shareCode(document.getElementById('new-code-val').textContent,'')">📲 שתף בוואטסאפ</button>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:10px">${codesHTML}</div>
  </div>`;
}

function createAndShowCode(role, perm){
  const finalPerm = perm || (role==='manager'?'full':'edit');
  const entry = generateCode(role, finalPerm, true);
  const banner = document.getElementById('new-code-banner');
  const val = document.getElementById('new-code-val');
  if(banner && val){
    val.textContent = entry.code;
    banner.style.display='block';
  }
  renderPage(); // re-render to show in list too
  toast(`🔑 קוד נוצר: ${entry.code}`);
}

function copyCode(code){
  navigator.clipboard?.writeText(code).catch(()=>{});
  toast(`📋 הקוד ${code} הועתק!`);
}

function shareCode(code, role){
  const roleLbl={owner:'בעל משרד',manager:'מנהל',employee:'עובד'}[role]||'עובד';
  const text=`הוזמנת להצטרף למערכת ניהול המשימות של המשרד!\n\nקוד ההזמנה שלך: ${code}\n(תפקיד: ${roleLbl} · בתוקף 30 יום)\n\nפתח את התוכנה → הרשמה → הזן את הקוד`;
  if(navigator.share){navigator.share({text}).catch(()=>{});}
  else{navigator.clipboard?.writeText(text).catch(()=>{});toast('📋 הטקסט הועתק לשיתוף!');}
}


function renderNotifSettings(){
  return `
  <div class="s-card">
    <div class="s-card-title">הגדרות התראות</div>
    ${[
      ['תזכורת אוטומטית 48 שעות','שולחת וואטסאפ אם משימה לא בוצעה',true],
      ['סיכום בוקר יומי','משימות היום ב-08:00',true],
      ['התראת דדליין מס','7 ימים לפני כל דדליין',true],
      ['אישור ביצוע בוואטסאפ','עובד סימן בוצע – שולחת אישור',false],
      ['סיכום שבועי','כל יום ראשון',false],
    ].map(([l,s,on])=>`
    <div class="toggle-row">
      <div class="toggle-info"><div class="tl">${l}</div><div class="ts">${s}</div></div>
      <div class="t-track ${on?'on':''}" onclick="this.classList.toggle('on');toast('✓ עודכן')"><div class="t-thumb"></div></div>
    </div>`).join('')}
  </div>
  <div class="s-card">
    <div class="s-card-title">שעות שקט</div>
    <div class="form-grid">
      <div class="form-row"><label class="form-label">משעה</label><input class="form-input" type="time" value="22:00"/></div>
      <div class="form-row"><label class="form-label">עד שעה</label><input class="form-input" type="time" value="08:00"/></div>
    </div>
    <div class="save-row"><button class="btn primary" onclick="toast('✓ שעות שקט נשמרו')">שמור</button></div>
  </div>`;
}

function renderPermSettings(){
  const rows=[
    ['צפייה בכל המשימות',true,true,false],
    ['יצירת משימות',true,true,true],
    ['מחיקת משימות',true,true,false],
    ['שליחת תזכורות',true,true,false],
    ['ניהול עובדים',true,false,false],
    ['שינוי הגדרות',true,false,false],
  ];
  return `
  <div class="s-card">
    <div class="s-card-title">הרשאות לפי תפקיד</div>
    <table class="perm-tbl">
      <thead><tr><th>פעולה</th><th style="text-align:center">בעל משרד</th><th style="text-align:center">מנהל</th><th style="text-align:center">עובד</th></tr></thead>
      <tbody>${rows.map(([l,o,m,e])=>`
        <tr>
          <td>${l}</td>
          <td style="text-align:center"><input type="checkbox" class="perm-cb" ${o?'checked':''} ${o?'disabled':''}/></td>
          <td style="text-align:center"><input type="checkbox" class="perm-cb" ${m?'checked':''}/></td>
          <td style="text-align:center"><input type="checkbox" class="perm-cb" ${e?'checked':''}/></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="save-row"><button class="btn primary" onclick="toast('✓ הרשאות נשמרו')">שמור הרשאות</button></div>
  </div>`;
}

function renderWASettings(){
  return '<div class="s-card"><div class="s-card-title">🔗 חיבורים חיצוניים</div>'
    + '<div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:14px;margin-bottom:12px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
    + '<div style="font-size:24px">📅</div>'
    + '<div><div style="font-size:13px;font-weight:700">Google Calendar</div>'
    + '<div style="font-size:11px;color:var(--text2)">סנכרון פגישות ואירועים</div></div>'
    + '<button class="btn primary" style="margin-right:auto;font-size:12px" onclick="connectGoogleCalendar()">חבר</button>'
    + '</div></div>'
    + '<div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:14px;margin-bottom:12px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
    + '<div style="font-size:24px">📧</div>'
    + '<div><div style="font-size:13px;font-weight:700">Microsoft Outlook</div>'
    + '<div style="font-size:11px;color:var(--text2)">סנכרון יומן ומיילים</div></div>'
    + '<button class="btn" style="margin-right:auto;font-size:12px;background:#0078d4;color:#fff;border-color:#0078d4" onclick="connectOutlook()">חבר</button>'
    + '</div></div>'
    + '<div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:14px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
    + '<div style="font-size:24px">💬</div>'
    + '<div><div style="font-size:13px;font-weight:700">WhatsApp Business API</div>'
    + '<div style="font-size:11px;color:var(--text2)">תזכורות אוטומטיות</div></div>'
    + '</div>'
    + '<input class="form-input" type="password" placeholder="API Token" dir="ltr" style="font-size:12px;margin-bottom:6px"/>'
    + '<input class="form-input" placeholder="Phone Number ID" dir="ltr" style="font-size:12px;margin-bottom:10px"/>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn sm" onclick="toast(&quot;🔌 בדיקת חיבור...&quot;)">בדוק</button>'
    + '<button class="btn sm primary" onclick="toast(&quot;✓ נשמר&quot;)">שמור</button>'
    + '</div></div></div>';
}


function connectGoogleCalendar(){
  if(!S.integrations)S.integrations={};
  S.integrations.googleCalendar={email:S.user?.email||'user@gmail.com',connected:true};
  renderPage();toast('✅ Google Calendar חובר! (שלב 3 יחבר אמיתי)');
}
function connectOutlook(){
  if(!S.integrations)S.integrations={};
  S.integrations.outlook={email:S.user?.email||'user@outlook.com',connected:true};
  renderPage();toast('✅ Outlook חובר! (שלב 3 יחבר אמיתי)');
}
function disconnectIntegration(name){
  if(S.integrations)delete S.integrations[name];
  renderPage();toast('✓ חיבור נותק');
}


// ══════════════════════════════════════
//  TASK LOGIC
// ══════════════════════════════════════
function toggleTask(id){
  const t=S.tasks.find(t=>t.id===id);
  if(t){t.done=!t.done;renderPage();toast(t.done?'✓ משימה הושלמה!':'↩ חזר לפתוחות');}
}
function manualRemind(id){
  const t=S.tasks.find(t=>t.id===id);if(!t)return;
  t.remindedAt=Date.now();
  S.waMessages.push({text:`📲 תזכורת ידנית: ${t.title} - ${t.assignee} - יעד: ${fmtD(t.date)}`,time:timeStr(),converted:false,auto:false});
  S.reminders.push({task:t.title,assignee:t.assignee,time:timeStr(),type:'ידנית',auto:false});
  renderPage();toast(`📲 תזכורת נשלחה ל${t.assignee}!`);
}
let recurringOn=false;
function toggleRecurring(){
  recurringOn=!recurringOn;
  const track=document.getElementById('rec-track');
  const thumb=document.getElementById('rec-thumb');
  const opts=document.getElementById('rec-options');
  if(track) track.style.background=recurringOn?'#16a34a':'#e2e8f0';
  if(thumb) thumb.style.transform=recurringOn?'translateX(-16px)':'';
  if(opts) opts.style.display=recurringOn?'flex':'none';
  if(recurringOn) updateRecurringPreview();
}
function updateRecurringUI(){
  const type=document.getElementById('nt-rectype')?.value;
  const dayRow=document.getElementById('rec-day-row');
  const customRow=document.getElementById('rec-custom-row');
  if(dayRow) dayRow.style.display=(type==='monthly'||type==='bimonthly'||type==='quarterly')?'block':'none';
  if(customRow) customRow.style.display=type==='custom'?'block':'none';
  updateRecurringPreview();
}
function toggleRecEndDate(){
  const v=document.getElementById('nt-recend')?.value;
  const dr=document.getElementById('rec-end-date-row');
  const cr=document.getElementById('rec-end-count-row');
  if(dr) dr.style.display=v==='date'?'block':'none';
  if(cr) cr.style.display=v==='count'?'block':'none';
}
function updateRecurringPreview(){
  const el=document.getElementById('rec-preview');
  if(!el) return;
  const type=document.getElementById('nt-rectype')?.value||'monthly';
  const day=document.getElementById('nt-recday')?.value||'1';
  const remind=document.getElementById('nt-recremind')?.value||'7';
  const labels={monthly:'כל חודש',bimonthly:'כל חודשיים',quarterly:'כל רבעון',weekly:'כל שבוע',biweekly:'כל שבועיים',yearly:'כל שנה',custom:'בתאריך קבוע'};
  const dayStr=(type==='monthly'||type==='bimonthly'||type==='quarterly')?(day==='last'?' · ביום האחרון בחודש':` · ביום ${day} בחודש`):'';
  el.innerHTML=`🔁 <strong>${labels[type]||type}</strong>${dayStr} · תזכורת ${remind} ימים לפני`;
}
function recLabel(type){
  return {monthly:'כל חודש',bimonthly:'כל חודשיים',quarterly:'כל רבעון',weekly:'כל שבוע',biweekly:'כל שבועיים',yearly:'כל שנה',custom:'תאריך קבוע'}[type]||type;
}
function addTask(){
  const title=document.getElementById('nt-title').value.trim();
  if(!title){toast('⚠️ יש להזין כותרת');return;}
  const rec=recurringOn?{
    type:document.getElementById('nt-rectype').value,
    day:document.getElementById('nt-recday')?.value||'1',
    remindDaysBefore:parseInt(document.getElementById('nt-recremind').value)||7,
    endType:document.getElementById('nt-recend').value,
    endDate:document.getElementById('nt-recenddate')?.value||null,
    endCount:parseInt(document.getElementById('nt-reccount')?.value)||null,
    occurrenceCount:0,
  }:null;
  S.tasks.push({
    id:S.nextId++,title,
    type:document.getElementById('nt-type').value,
    assignee:document.getElementById('nt-assignee').value,
    date:document.getElementById('nt-date').value,
    priority:document.getElementById('nt-priority').value,
    notes:document.getElementById('nt-notes')?.value||'',
    done:false,status:'pending',
    createdAt:Date.now(),remindedAt:null,snoozedUntil:null,pinned:false,
    recurring:rec,
  });
  recurringOn=false;
  closeModal('task');renderPage();
  toast(rec?`🔁 משימה חוזרת נוספה! (${recLabel(rec.type)})`:'✓ משימה נוספה!');
}
function populateAssigneeSelect(){
  const sel=document.getElementById('nt-assignee');
  if(!sel)return;
  sel.innerHTML=S.team.map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
}

// ══════════════════════════════════════
//  SNOOZE
// ══════════════════════════════════════
function openSnoozeModal(id){
  const t=S.tasks.find(t=>t.id===id);if(!t)return;
  S.snoozeTarget=id;S.snoozeChoice='1h';
  document.getElementById('snooze-name').textContent=t.title;
  document.querySelectorAll('.snooze-opt').forEach((el,i)=>el.classList.toggle('sel',i===0));
  document.getElementById('custom-row').style.display='none';
  openModal('snooze');
}
function pickSnooze(el,val){
  document.querySelectorAll('.snooze-opt').forEach(e=>e.classList.remove('sel'));
  el.classList.add('sel');S.snoozeChoice=val;
  document.getElementById('custom-row').style.display=val==='custom'?'block':'none';
}
function confirmSnooze(){
  const t=S.tasks.find(t=>t.id===S.snoozeTarget);if(!t)return;
  let until;const now=Date.now();
  if(S.snoozeChoice==='1h')until=now+3600000;
  else if(S.snoozeChoice==='3h')until=now+3*3600000;
  else if(S.snoozeChoice==='tomorrow'){const d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);until=d.getTime();}
  else if(S.snoozeChoice==='2days')until=now+48*3600000;
  else if(S.snoozeChoice==='week')until=now+7*24*3600000;
  else if(S.snoozeChoice==='custom'){
    const v=document.getElementById('custom-dt').value;
    if(!v){toast('⚠️ בחר תאריך ושעה');return;}
    until=new Date(v).getTime();
  }
  t.snoozedUntil=until;t.remindedAt=null;
  closeModal('snooze');renderPage();
  toast(`⏰ תזכורת נדחתה ל-${new Date(until).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`);
}

// ══════════════════════════════════════
//  TEAM
// ══════════════════════════════════════
const memberColors=[['#dbeafe','#1d4ed8'],['#dcfce7','#166534'],['#fef9c3','#a16207'],['#fce7f3','#9d174d'],['#ede9fe','#6d28d9']];
function highlightPref(){
  ['wa','email','both'].forEach(id=>{
    const lbl=document.getElementById('pref-'+id+'-lbl');
    const inp=document.getElementById('nm-notify-'+id);
    if(lbl&&inp) lbl.style.borderColor=inp.checked?'var(--accent)':'var(--border)';
    if(lbl&&inp) lbl.style.background=inp.checked?'var(--accent-light)':'transparent';
  });
}

function generateTempCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  for(let i=0;i<6;i++) code+=chars[Math.floor(Math.random()*chars.length)];
  return code;
}

function addMember(){
  const name=document.getElementById('nm-name').value.trim();
  const email=document.getElementById('nm-email').value.trim();
  const phone=document.getElementById('nm-phone').value.trim()||'לא הוזן';
  const notify=document.querySelector('input[name="nm-notify"]:checked')?.value||'whatsapp';
  const nmErr = document.getElementById('nm-err');
  const showNmErr = function(msg){ nmErr.textContent=msg; nmErr.style.display='block'; };
  nmErr.style.display='none';
  if(!name||!email){showNmErr('⚠️ יש למלא שם ואימייל');return;}
  // בדיקת כפילות מייל
  if(S.team && S.team.find(function(m){return m.email&&m.email.toLowerCase()===email.toLowerCase();})){
    showNmErr('❌ עובד עם המייל ' + email + ' כבר קיים בצוות');return;
  }
  // בדיקת כפילות טלפון
  const phoneVal = document.getElementById('nm-phone').value.trim();
  if(phoneVal && phoneVal !== 'לא הוזן' && S.team && S.team.find(function(m){return m.phone&&m.phone===phoneVal;})){
    showNmErr('❌ עובד עם מספר הטלפון ' + phoneVal + ' כבר קיים בצוות');return;
  }
  const c=memberColors[S.nextMemberId%memberColors.length];
  const notifyLabel={whatsapp:'💬 וואטסאפ',email:'📧 מייל',both:'🔔 שניהם'}[notify];
  // בדיקה אם המייל כבר רשום – אין צורך בקוד זמני
  const alreadyRegistered=S.registeredUsers&&S.registeredUsers.find(function(u){return u.email&&u.email.toLowerCase()===email.toLowerCase();});
  const tempCode=alreadyRegistered ? null : generateTempCode();
  S.team.push({id:S.nextMemberId++,name,email,phone,role:document.getElementById('nm-role').value,perm:document.getElementById('nm-perm').value,colors:c,status:alreadyRegistered?'פעיל':'הוזמן',notify,notifyLabel,...(tempCode?{tempCode}:{})});
  saveTeamLocal();
  closeModal('member');renderPage();
  document.getElementById('nm-name').value='';document.getElementById('nm-email').value='';document.getElementById('nm-phone').value='';
  if(alreadyRegistered){
    toast('✅ '+name+' נוסף לצוות (כבר רשום במערכת)');
    return;
  }
  // שמירת קוד הזמנה ב-Firestore לאימות מכל מכשיר
  if(window.saveInviteCode){
    window.saveInviteCode(tempCode,{
      email,
      name,
      role:document.getElementById('nm-role').value,
      officeName:S.office?.name||S.user?.officeName||'המשרד'
    });
  }
  fetch('/api/invite',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      employeeName:name,
      employeeEmail:email,
      officeName:S.office?.name||S.user?.officeName||'המשרד',
      inviterName:S.user?.name||'',
      tempCode
    })
  }).then(r=>r.json()).then(d=>{
    if(d.ok) toast('📧 הזמנה עם קוד כניסה נשלחה ל'+name+'!');
    else toast('⚠️ שגיאה בשליחת מייל: '+(d.error||'נסה שוב'));
  }).catch(()=>toast('⚠️ לא ניתן לשלוח מייל כרגע'));
}
function removeMember(id){
  const m=S.team.find(t=>t.id===id);if(!m)return;
  if(!confirm(`להסיר את ${m.name}?`))return;
  S.team=S.team.filter(t=>t.id!==id);saveTeamLocal();renderPage();toast(`✓ ${m.name} הוסר`);
}

let editMemberId=null;
function openEditMember(id){
  const m=S.team.find(t=>t.id===id);if(!m)return;
  editMemberId=id;
  document.getElementById('em-name').value=m.name;
  document.getElementById('em-email').value=m.email;
  document.getElementById('em-phone').value=m.phone||'';
  document.getElementById('em-role').value=m.role||'employee';
  document.getElementById('em-perm').value=m.perm||'edit';
  document.getElementById('em-status').value=m.status||'פעיל';
  const notifySel=document.getElementById('em-notify');
  if(notifySel) notifySel.value=m.notify||'whatsapp';
  document.getElementById('m-edit-member').classList.add('open');
}
function saveEditMember(){
  const m=S.team.find(t=>t.id===editMemberId);if(!m)return;
  const name=document.getElementById('em-name').value.trim();
  const email=document.getElementById('em-email').value.trim();
  const phone=document.getElementById('em-phone').value.trim();
  if(!name||!email){toast('⚠️ יש למלא שם ואימייל');return;}
  // Update tasks assigned to this member
  const oldName=m.name;
  S.tasks.forEach(t=>{ if(t.assignee===oldName) t.assignee=name; });
  m.name=name; m.email=email; m.phone=phone;
  m.role=document.getElementById('em-role').value;
  m.perm=document.getElementById('em-perm').value;
  m.status=document.getElementById('em-status').value;
  const notifyVal=document.getElementById('em-notify')?.value||'whatsapp';
  m.notify=notifyVal;
  m.notifyLabel={whatsapp:'💬 וואטסאפ',email:'📧 מייל',both:'🔔 שניהם'}[notifyVal];
  m.initials=name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  saveTeamLocal();
  closeModal('edit-member');
  renderPage();
  toast(`✓ פרטי ${name} עודכנו בהצלחה!`);
}

// ── CALENDAR ──
function renderCalendarPage(){
  if(!S.reminders) S.reminders=[];
  if(!S.clients) S.clients=[];
  if(!S.tasks) S.tasks=[];
  const now=new Date();
  const year=S.calYear||now.getFullYear();
  const month=S.calMonth!==undefined&&S.calMonth!==null?S.calMonth:now.getMonth();
  const view=S.calView||'month';

  const monthNames=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  const dayNames=['א','ב','ג','ד','ה','ו','ש'];

  // Collect events: only meetings + reminders (NO regular tasks) + deadlines
  const events=[];
  S.tasks.forEach(t=>{
    // רק פגישות ותזכורות – לא משימות רגילות
    if(t.type==='meeting' && t.date)
      events.push({date:t.date,title:t.title,type:'meeting',priority:t.priority,assignee:t.assignee,status:t.status,source:'meeting',time:t.time||''});
  });
  // תזכורות שנשלחו
  S.reminders.forEach(r=>{
    if(r.date) events.push({date:r.date,title:'🔔 תזכורת: '+r.task,type:'reminder',priority:'normal',assignee:r.assignee,source:'reminder'});
  });
  // דדליינים לרשויות מס
  deadlines.forEach(d=>{
    events.push({date:d.date,title:d.title,type:'tax',priority:'urgent',source:'deadline'});
  });

  const firstDay=new Date(year,month,1);
  const lastDay=new Date(year,month+1,0);
  const startDow=firstDay.getDay();
  const totalDays=lastDay.getDate();

  const prevMonth=()=>{
    if(!S.calMonth&&S.calMonth!==0){S.calMonth=now.getMonth();S.calYear=now.getFullYear();}
    if(S.calMonth===0){S.calMonth=11;S.calYear--;}else{S.calMonth--;}
    renderPage();
  };
  const nextMonth=()=>{
    if(!S.calMonth&&S.calMonth!==0){S.calMonth=now.getMonth();S.calYear=now.getFullYear();}
    if(S.calMonth===11){S.calMonth=0;S.calYear++;}else{S.calMonth++;}
    renderPage();
  };

  // Build calendar grid
  let cells='';
  // Empty cells before first day
  for(let i=0;i<startDow;i++) cells+=`<div style="min-height:80px;background:var(--surface3);border-radius:8px;opacity:.4"></div>`;
  // Day cells
  for(let d=1;d<=totalDays;d++){
    const dateStr=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEvents=events.filter(e=>e.date===dateStr);
    const isToday=dateStr===today();
    cells+=`
    <div style="min-height:80px;background:var(--surface);border:1.5px solid ${isToday?'var(--accent)':'var(--border)'};border-radius:8px;padding:6px;transition:all .15s;cursor:pointer" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='${isToday?'var(--accent)':'var(--border)'}'">
      <div style="font-size:12px;font-weight:${isToday?'700':'500'};color:${isToday?'var(--accent)':'var(--text)'};background:${isToday?'var(--accent-light)':'transparent'};width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:4px">${d}</div>
      ${dayEvents.slice(0,2).map(e=>`
        <div style="font-size:10px;padding:2px 5px;border-radius:4px;margin-bottom:2px;background:${e.priority==='urgent'?'#fee2e2':e.source==='deadline'?'#fef3c7':'#dbeafe'};color:${e.priority==='urgent'?'#b91c1c':e.source==='deadline'?'#92400e':'#1e40af'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${e.title}">${e.title}</div>
      `).join('')}
      ${dayEvents.length>2?`<div style="font-size:10px;color:var(--text3)">+${dayEvents.length-2} עוד</div>`:''}
    </div>`;
  }

  // אירועי היום בלבד
  const todayStr=today();
  const todayEvents=events.filter(e=>e.date===todayStr).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  const upcomingSoon=events.filter(e=>e.date>todayStr).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);

  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn" onclick="(${prevMonth.toString()})()">→</button>
      <div style="font-size:16px;font-weight:700">${monthNames[month]} ${year}</div>
      <button class="btn" onclick="(${nextMonth.toString()})()">←</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn sm" onclick="S.calMonth=new Date().getMonth();S.calYear=new Date().getFullYear();renderPage()">היום</button>
      <div style="font-size:11px;background:var(--info-bg);color:var(--info);padding:4px 10px;border-radius:20px;border:1px solid var(--border-info)">
        🔗 חיבור Google Calendar – שלב 3
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start">
    <div>
      <!-- Day headers -->
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px">
        ${dayNames.map(d=>`<div style="text-align:center;font-size:11px;font-weight:600;color:var(--text2);padding:4px">${d}</div>`).join('')}
      </div>
      <!-- Calendar grid -->
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
        ${cells}
      </div>
      <!-- Legend -->
      <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)"><div style="width:10px;height:10px;border-radius:2px;background:#fee2e2"></div>דחוף</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)"><div style="width:10px;height:10px;border-radius:2px;background:#fef3c7"></div>דדליין מס</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)"><div style="width:10px;height:10px;border-radius:2px;background:#dbeafe"></div>משימה</div>
      </div>
    </div>

    <!-- Sidebar -->
    <div style="display:flex;flex-direction:column;gap:12px">

      <!-- אירועי היום -->
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span style="background:var(--accent);color:#fff;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${new Date().getDate()}</span>
          אירועי היום
        </div>
        ${todayEvents.length?todayEvents.map(e=>`
          <div style="border-right:3px solid ${e.source==='meeting'?'#2563eb':e.source==='deadline'?'#d97706':'#16a34a'};padding:6px 8px;border-radius:0 6px 6px 0;margin-bottom:5px;background:var(--surface2)">
            <div style="font-size:11px;font-weight:600">${e.title}</div>
            ${e.assignee?`<div style="font-size:10px;color:var(--text2);margin-top:2px">👤 ${e.assignee}</div>`:''}
          </div>`).join('')
        :`<div style="font-size:12px;color:var(--text2);text-align:center;padding:8px">אין אירועים היום 🎉</div>`}
      </div>

      <!-- קרובים -->
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px">📅 אירועים קרובים</div>
        ${upcomingSoon.length?upcomingSoon.map(e=>`
          <div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:10px;color:var(--text2);white-space:nowrap;min-width:40px">${fmtD(e.date)}</div>
            <div style="font-size:11px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.title}</div>
          </div>`).join('')
        :`<div style="font-size:12px;color:var(--text2);text-align:center;padding:8px">אין אירועים קרובים</div>`}
      </div>

      <!-- קבע פגישה עם לקוח -->
      <div style="background:var(--surface3);border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
        <div style="font-size:12px;font-weight:700;margin-bottom:10px">📅 קבע פגישה עם לקוח</div>
        <input class="form-input" id="cal-meeting-title" placeholder="נושא הפגישה" style="margin-bottom:6px;font-size:12px"/>
        <input class="form-input" id="cal-meeting-date" type="datetime-local" style="margin-bottom:6px;font-size:12px"/>

        <!-- בחירת לקוח -->
        <select class="form-input" id="cal-client-select" style="margin-bottom:6px;font-size:12px" onchange="onClientSelect(this.value)">
          <option value="">── בחר לקוח קיים ──</option>
          ${(S.clients||[]).map(c=>`<option value="${c.id}">${c.name} ${c.phone?'· '+c.phone:''}</option>`).join('')}
          <option value="new">+ לקוח חדש</option>
        </select>

        <!-- פרטי לקוח חדש -->
        <div id="new-client-fields" style="display:none;margin-bottom:6px">
          <input class="form-input" id="cal-client-name" placeholder="שם הלקוח" style="margin-bottom:4px;font-size:12px"/>
          <input class="form-input" id="cal-client-phone" placeholder="טלפון" dir="ltr" style="margin-bottom:4px;font-size:12px"/>
          <input class="form-input" id="cal-client-email" type="email" placeholder="מייל" dir="ltr" style="margin-bottom:4px;font-size:12px"/>
        </div>

        <!-- פרטי לקוח נבחר -->
        <div id="selected-client-info" style="display:none;background:var(--surface);border-radius:8px;padding:6px 8px;margin-bottom:6px;font-size:11px;color:var(--text2)"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <button class="btn" style="font-size:11px;padding:6px" onclick="scheduleWithWA()">📲 וואטסאפ</button>
          <button class="btn" style="font-size:11px;padding:6px" onclick="scheduleWithEmail()">📧 מייל</button>
        </div>
        <button class="btn primary" style="width:100%;font-size:12px" onclick="scheduleWithWA()">✅ קבע פגישה</button>

        <!-- יבוא לקוחות -->
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:6px">ניהול לקוחות</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
            <button class="btn sm" style="font-size:10px" onclick="openModal('addClient')">+ הוסף לקוח</button>
            <button class="btn sm" style="font-size:10px" onclick="importClients()">📥 ייבוא CSV</button>
          </div>
        </div>
      </div>

    </div>
  </div>`;
}

function onClientSelect(val){
  const nf=document.getElementById('new-client-fields');
  const si=document.getElementById('selected-client-info');
  if(!nf||!si)return;
  if(val==='new'){nf.style.display='block';si.style.display='none';}
  else if(val){
    nf.style.display='none';
    const c=(S.clients||[]).find(x=>String(x.id)===val);
    if(c){si.style.display='block';si.innerHTML=`👤 ${c.name}${c.phone?' · 📱 '+c.phone:''}${c.email?' · 📧 '+c.email:''}`;}
  } else {nf.style.display='none';si.style.display='none';}
}
function getSelectedClient(){
  const sel=document.getElementById('cal-client-select')?.value;
  if(sel==='new'){
    const name=document.getElementById('cal-client-name')?.value?.trim();
    const phone=document.getElementById('cal-client-phone')?.value?.trim();
    const email=document.getElementById('cal-client-email')?.value?.trim();
    if(!name){toast('⚠️ יש להזין שם לקוח');return null;}
    const nc={id:Date.now(),name,phone,email};
    if(!S.clients)S.clients=[];
    S.clients.push(nc);return nc;
  } else if(sel){return (S.clients||[]).find(x=>String(x.id)===sel)||null;}
  return null;
}
function scheduleWithWA(){
  const title=document.getElementById('cal-meeting-title')?.value?.trim();
  const date=document.getElementById('cal-meeting-date')?.value;
  if(!title||!date){toast('⚠️ יש למלא נושא ותאריך');return;}
  const client=getSelectedClient();
  const clientName=client?client.name:'לקוח';
  const d=new Date(date);
  const dateStr=d.toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',year:'numeric'});
  const ts=d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
  S.tasks.push({id:S.nextId++,title:`פגישה: ${title} – ${clientName}`,type:'meeting',
    assignee:S.user?.name,date:d.toISOString().slice(0,10),priority:'normal',
    done:false,status:'pending',createdAt:Date.now(),remindedAt:null,snoozedUntil:null,pinned:false,client:clientName,time:ts});
  S.waMessages.push({text:`📅 פגישה נקבעה!\nנושא: ${title}\nלקוח: ${clientName}${client?.phone?'\nטלפון: '+client.phone:''}\nתאריך: ${dateStr} בשעה ${ts}`,
    time:timeStr(),converted:false,channel:'whatsapp',auto:false});
  if(document.getElementById('cal-meeting-title'))document.getElementById('cal-meeting-title').value='';
  if(document.getElementById('cal-meeting-date'))document.getElementById('cal-meeting-date').value='';
  renderPage();toast(`✅ פגישה עם ${clientName} + וואטסאפ!`);
}
function scheduleWithEmail(){
  const title=document.getElementById('cal-meeting-title')?.value?.trim();
  const date=document.getElementById('cal-meeting-date')?.value;
  if(!title||!date){toast('⚠️ יש למלא נושא ותאריך');return;}
  const client=getSelectedClient();
  if(!client?.email){toast('⚠️ אין מייל ללקוח');return;}
  const d=new Date(date);
  const dateStr=d.toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',year:'numeric'});
  const ts=d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
  const sub=encodeURIComponent(`פגישה: ${title} – ${dateStr}`);
  const body=encodeURIComponent(`שלום ${client.name},\n\nאשמח לאשר פגישה:\nנושא: ${title}\nתאריך: ${dateStr}\nשעה: ${ts}\n\nבברכה,\n${S.user?.name||''}`);
  window.open(`mailto:${client.email}?subject=${sub}&body=${body}`);
  toast(`📧 מייל נפתח עבור ${client.name}!`);
}
function importClients(){
  const input=document.createElement('input');
  input.type='file';input.accept='.csv';
  input.onchange=e=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const lines=ev.target.result.split('\n').filter(l=>l.trim());
      if(!S.clients)S.clients=[];
      let count=0;
      lines.forEach((line,i)=>{
        if(i===0&&line.toLowerCase().includes('name'))return;
        const parts=line.split(',');
        const name=(parts[0]||'').trim().replace(/"/g,'');
        const phone=(parts[1]||'').trim().replace(/"/g,'');
        const email=(parts[2]||'').trim().replace(/"/g,'');
        if(name){S.clients.push({id:Date.now()+i,name,phone,email});count++;}
      });
      renderPage();toast(`✅ יובאו ${count} לקוחות!`);
    };
    reader.readAsText(file);
  };
  input.click();
}



function renderPerformanceSettings(){
  const workerStats=S.team.map(w=>{
    const total=S.tasks.filter(t=>t.assignee===w.name).length;
    const done=S.tasks.filter(t=>t.assignee===w.name&&t.status==='done').length;
    const inprog=S.tasks.filter(t=>t.assignee===w.name&&t.status==='inprogress').length;
    const pending=S.tasks.filter(t=>t.assignee===w.name&&t.status==='pending').length;
    const overdue=S.tasks.filter(t=>t.assignee===w.name&&t.status!=='done'&&t.date<today()).length;
    const over48=S.tasks.filter(t=>t.assignee===w.name&&t.status!=='done'&&hrs(t.createdAt)>=48).length;
    const rate=total>0?Math.round(done/total*100):0;
    const score=Math.max(0,rate - overdue*10 - over48*5);
    const grade=score>=80?{label:'מצוין',color:'#16a34a',bg:'#dcfce7'}:score>=60?{label:'טוב',color:'#d97706',bg:'#fef3c7'}:score>=40?{label:'לשיפור',color:'#ea580c',bg:'#ffedd5'}:{label:'דורש תשומת לב',color:'#dc2626',bg:'#fee2e2'};
    const [bg,clr]=w.colors||['#dbeafe','#1d4ed8'];
    return {w,total,done,inprog,pending,overdue,over48,rate,score,grade,bg,clr};
  });

  return `
  <div class="s-card">
    <div class="s-card-title">📊 מדד ביצועי עובדים</div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:14px">הציון מחושב לפי: % ביצוע − עיכובים − חריגות 48 שעות</div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${workerStats.map(s=>`
        <div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div style="width:36px;height:36px;border-radius:50%;background:${s.bg};color:${s.clr};font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center">${avInitials(s.w.name)}</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:700">${s.w.name}</div>
              <div style="font-size:10px;color:var(--text2)">${{owner:'בעל משרד',manager:'מנהל',employee:'עובד'}[s.w.role]||'עובד'}</div>
            </div>
            <div style="text-align:center;background:${s.grade.bg};border-radius:10px;padding:6px 12px">
              <div style="font-size:22px;font-weight:800;color:${s.grade.color}">${s.score}</div>
              <div style="font-size:10px;font-weight:700;color:${s.grade.color}">${s.grade.label}</div>
            </div>
          </div>
          <!-- Progress bar -->
          <div style="background:var(--surface3);border-radius:20px;height:8px;margin-bottom:10px;overflow:hidden">
            <div style="height:100%;border-radius:20px;background:${s.rate>=70?'#16a34a':s.rate>=40?'#d97706':'#dc2626'};width:${s.rate}%;transition:width .5s"></div>
          </div>
          <!-- Stats grid -->
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;text-align:center">
            <div style="background:var(--surface3);border-radius:8px;padding:6px 4px">
              <div style="font-size:16px;font-weight:700">${s.total}</div>
              <div style="font-size:9px;color:var(--text2)">סה"כ</div>
            </div>
            <div style="background:#dcfce7;border-radius:8px;padding:6px 4px">
              <div style="font-size:16px;font-weight:700;color:#16a34a">${s.done}</div>
              <div style="font-size:9px;color:#16a34a">טופלו</div>
            </div>
            <div style="background:#fef3c7;border-radius:8px;padding:6px 4px">
              <div style="font-size:16px;font-weight:700;color:#d97706">${s.inprog}</div>
              <div style="font-size:9px;color:#d97706">בביצוע</div>
            </div>
            <div style="background:#fee2e2;border-radius:8px;padding:6px 4px">
              <div style="font-size:16px;font-weight:700;color:#dc2626">${s.overdue}</div>
              <div style="font-size:9px;color:#dc2626">באיחור</div>
            </div>
            <div style="background:#fff7ed;border-radius:8px;padding:6px 4px">
              <div style="font-size:16px;font-weight:700;color:#ea580c">${s.over48}</div>
              <div style="font-size:9px;color:#ea580c">+48 שעות</div>
            </div>
          </div>
          ${s.overdue>0||s.over48>0?`
          <div style="margin-top:10px;padding:8px 10px;background:#fff7ed;border-radius:8px;font-size:11px;color:#92400e;border:1px solid #fed7aa">
            💡 המלצה: ${s.over48>2?`יש ${s.over48} משימות מעל 48 שעות – כדאי לשלוח תזכורת`:s.overdue>0?`יש ${s.overdue} משימות באיחור – בדקו עם העובד`:''}
          </div>`:''}
        </div>`).join('')}
    </div>
  </div>`;
}

function saveNewClient(){
  const name=document.getElementById('nc-name')?.value?.trim();
  const phone=document.getElementById('nc-phone')?.value?.trim();
  const email=document.getElementById('nc-email')?.value?.trim();
  const taxId=document.getElementById('nc-id')?.value?.trim();
  const notes=document.getElementById('nc-notes')?.value?.trim();
  if(!name){toast('⚠️ יש להזין שם לקוח');return;}
  if(!S.clients)S.clients=[];
  S.clients.push({id:Date.now(),name,phone,email,taxId,notes});
  closeModal('addClient');
  renderPage();
  toast(`✅ לקוח ${name} נוסף!`);
}

function startEngine(){
  checkEngine();setInterval(checkEngine,30000);
}
function checkEngine(){
  if(!S.waMessages)S.waMessages=[];
  if(!S.reminders)S.reminders=[];
  if(!S.tasks)S.tasks=[];
  S.tasks.forEach(t=>{
    if(t.status==='done')return;
    const over=hrs(t.createdAt)>=48;
    const snoozed=t.snoozedUntil&&Date.now()<t.snoozedUntil;
    if(over&&!t.remindedAt&&!snoozed){
      t.remindedAt=Date.now();
      const h=Math.floor(hrs(t.createdAt));
      S.waMessages.push({text:`🤖 תזכורת אוטומטית\n"${t.title}"\nפתוחה כבר ${h} שעות ללא ביצוע.\nאנא עדכן סטטוס או דחה תזכורת.`,time:timeStr(),converted:false,auto:true});
      S.reminders.push({task:t.title,assignee:t.assignee,time:timeStr(),type:'אוטומטית (48 שעות)',auto:true});
    }
  });
  if(S.page==='dashboard'||S.page==='tasks')renderPage();
}

// ══════════════════════════════════════
//  MODALS
// ══════════════════════════════════════
function openModal(id){
  if(id==='task'){
    const d=new Date();d.setDate(d.getDate()+7);
    document.getElementById('nt-date').value=d.toISOString().slice(0,10);
    document.getElementById('nt-title').value='';
    recurringOn=false;
    // reset UI after DOM updates
    setTimeout(()=>{
      const track=document.getElementById('rec-track');
      const thumb=document.getElementById('rec-thumb');
      const opts=document.getElementById('rec-options');
      if(track) track.style.background='#e2e8f0';
      if(thumb) thumb.style.transform='';
      if(opts) opts.style.display='none';
    },10);
    populateAssigneeSelect();
  }
  document.getElementById('m-'+id).classList.add('open');
  if(id==='task')setTimeout(()=>document.getElementById('nt-title').focus(),60);
  if(id==='member')setTimeout(()=>document.getElementById('nm-name').focus(),60);
}
function closeModal(id){
  if(id==='member'){ const e=document.getElementById('nm-err'); if(e){e.style.display='none';e.textContent='';} }document.getElementById('m-'+id).classList.remove('open');}

// ══════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════
function hrs(ts){return(Date.now()-ts)/3600000;}
function today(){return new Date().toISOString().slice(0,10);}
function fmtD(d){const[y,m,day]=d.split('-');return`${day}/${m}/${y}`;}
function timeStr(){return new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});}
function avInitials(name){return name.split(' ').map(w=>w[0]).join('').slice(0,2);}
function prevLogo(input){
  const f=input.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=e=>{
    const img=document.getElementById('logo-img-s');
    if(img){img.src=e.target.result;img.style.display='block';const em=document.getElementById('logo-emoji-s');if(em)em.style.display='none';}
  };r.readAsDataURL(f);
}
function saveSection(id){
  const el=document.getElementById('sv-'+id);
  if(el){el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3000);}
  toast('✓ הגדרות נשמרו בהצלחה!');
}

// ── שמירה וטעינה של צוות ב-localStorage ──
function saveTeamLocal(){
  try{
    const key='dabelu_team_'+(S.user&&(S.user.uid||S.user.email)||'default');
    localStorage.setItem(key, JSON.stringify({team:S.team||[], nextMemberId:S.nextMemberId||1, registeredUsers:S.registeredUsers||[]}));
    if(S.user&&S.user.uid&&window.saveTeamToDB) window.saveTeamToDB(S.user.uid, S.team||[]);
  }catch(e){}
}
function loadTeamLocal(){
  try{
    const key='dabelu_team_'+(S.user&&(S.user.uid||S.user.email)||'default');
    const raw=localStorage.getItem(key);
    if(!raw) return;
    const data=JSON.parse(raw);
    if(data.team&&data.team.length) S.team=data.team;
    if(data.nextMemberId) S.nextMemberId=data.nextMemberId;
    if(data.registeredUsers&&data.registeredUsers.length) S.registeredUsers=data.registeredUsers;
  }catch(e){}
}

// ── כניסה ראשונה: הגדרת סיסמא ──
async function doSetPassword(){
  const p1=document.getElementById('sp-pass').value;
  const p2=document.getElementById('sp-pass2').value;
  const errEl=document.getElementById('sp-err');
  if(!p1||p1.length<6){errEl.textContent='סיסמא חייבת להיות לפחות 6 תווים';return;}
  if(p1!==p2){errEl.textContent='הסיסמאות אינן תואמות';return;}
  const pending=window._pendingInvite;
  if(!pending){errEl.textContent='שגיאה - נסי לרענן את הדף';return;}
  const {invite,email,code}=pending;
  const initials=((invite.name||email).split(' ').map(function(w){return w[0];}).join('').slice(0,2)||email.slice(0,2)).toUpperCase();
  if(!S.registeredUsers) S.registeredUsers=[];
  if(!S.registeredUsers.find(function(u){return u.email&&u.email.toLowerCase()===email.toLowerCase();})){ 
    S.registeredUsers.push({name:invite.name||email.split('@')[0],email:email.toLowerCase(),pass:p1,initials:initials,role:invite.role||'employee',officeName:invite.officeName||'משרד ייעוץ מס'});
  }
  if(S.team){
    var m=S.team.find(function(t){return t.email&&t.email.toLowerCase()===email.toLowerCase();});
    if(m){delete m.tempCode;m.status='פעיל';}
  }
  if(window.markInviteUsed) await window.markInviteUsed(code);
  window._pendingInvite=null;
  S.user={name:invite.name||email.split('@')[0],email:email.toLowerCase(),initials:initials,officeName:invite.officeName||'משרד ייעוץ מס',role:invite.role||'employee'};
  window.history.replaceState({},document.title,window.location.pathname);
  document.getElementById('screen-set-password').style.display='none';
  if(typeof enterApp==='function') enterApp();
}

let _toastT;
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(_toastT);_toastT=setTimeout(()=>el.classList.remove('show'),2600);
}

  if(window.lnkToLogin) window.lnkToLogin.addEventListener('click', function(){
    document.getElementById('frm-reg').style.display='none';
    document.getElementById('frm-login').style.display='block';
  });

  if(window.btnLogin) window.btnLogin.addEventListener('click', function(){
    var e=document.getElementById('a-email').value.trim().toLowerCase();
    var p=document.getElementById('a-pass').value;
    if(!e||!p){alert('יש למלא אימייל וסיסמה');return;}

    // בדיקת קוד זמני - עובד חדש
    if(S.team && S.team.length){
      var teamMember=S.team.find(function(m){return m.email&&m.email.toLowerCase()===e&&m.tempCode&&m.tempCode===p.toUpperCase();});
      if(teamMember){
        // הקוד תואם - הצג מסך הגדרת סיסמא
        window._pendingInvite = {
          invite: { name: teamMember.name, email: teamMember.email, role: teamMember.role||'employee', officeName: (S.office&&S.office.name)||(S.user&&S.user.officeName)||'המשרד' },
          email: teamMember.email,
          code: teamMember.tempCode||''
        };
        var spEl = document.getElementById('screen-set-password');
        if(spEl){
          document.getElementById('sp-welcome').textContent = 'ברוכה הבאה, '+teamMember.name+'! 👋';
          document.getElementById('sp-subtitle').textContent = 'הגדרי סיסמא אישית להתחברות';
          document.getElementById('screen-auth').style.display = 'none';
          spEl.style.display = 'flex';
          setTimeout(function(){ document.getElementById('sp-pass').focus(); }, 100);
        }
        return;
      }
    }

    // התחברות רגילה
    var found=S.registeredUsers&&S.registeredUsers.find(function(u){return u.email===e;});
    if(found){
      if(found.pass!==p){alert('סיסמה שגויה');return;}
      S.user={name:found.name,email:found.email,initials:found.initials,officeName:found.officeName};
    } else {
      S.user={name:e.split('@')[0],email:e,initials:e.slice(0,2).toUpperCase()};
    }
    enterApp();
  });

    if(window.btnReg) window.btnReg.addEventListener('click', function(){
    var first=document.getElementById('r-firstname').value.trim();
    var last=document.getElementById('r-lastname').value.trim();
    var office=document.getElementById('r-office').value.trim();
    var email=document.getElementById('r-email').value.trim().toLowerCase();
    var pass=document.getElementById('r-pass').value;
    var pass2=document.getElementById('r-pass2').value;
    if(!first||!email||!pass){alert('יש למלא שם, אימייל וסיסמה');return;}
    if(pass.length<6){alert('סיסמה חייבת להיות לפחות 6 תווים');return;}
    if(pass!==pass2){alert('הסיסמאות אינן תואמות');return;}
    if(!S.registeredUsers) S.registeredUsers=[];
    if(S.registeredUsers.find(function(u){return u.email===email;})){alert('אימייל זה כבר רשום');return;}
    // בדיקה: אם הוזמן עם קוד זמני – לא לאפשר הרשמה רגילה
    if(S.team&&S.team.find(function(m){return m.email&&m.email.toLowerCase()===email&&m.tempCode;})){
      alert('המייל הזה הוזמן למערכת עם קוד זמני. יש להתחבר עם הקוד שנשלח אליך במייל ולא להירשם מחדש.');return;
    }
    var name=first+(last?' '+last:'');
    var initials=(first[0]+((last&&last[0])||'')).toUpperCase();
    S.registeredUsers.push({name:name,email:email,pass:pass,initials:initials,role:'owner',officeName:office||'משרד ייעוץ מס'});
    S.user={name:name,email:email,initials:initials,officeName:office||'משרד ייעוץ מס',role:'owner'};
    if(office&&S.office) S.office.name=office;
    enterApp();
  });
