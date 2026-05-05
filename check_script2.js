(function() {
  var btn = document.getElementById('abtn');
  if (!btn) return;
  
  function doEnter() {
    var email = (document.getElementById('aem').value || '').trim().toLowerCase();
    var pass  = document.getElementById('apw').value || '';
    var errEl = document.getElementById('aerr');
    if (!email) { errEl.textContent = 'הכניסי אימייל'; return; }
    if (!pass)  { errEl.textContent = 'הכניסי סיסמה'; return; }
    if (typeof S === 'undefined') { errEl.textContent = 'שגיאה בטעינה, רענני'; return; }

    // בדיקת קוד זמני – עובד מוזמן
    if (S.team && S.team.length) {
      var member = S.team.find(function(m) {
        return m.email && m.email.toLowerCase() === email && m.tempCode && m.tempCode === pass.toUpperCase();
      });
      if (member) {
        window._pendingInvite = {
          invite: { name: member.name, email: member.email, role: member.role || 'employee', officeName: (S.office && S.office.name) || 'המשרד' },
          email: member.email, code: member.tempCode || ''
        };
        var spEl = document.getElementById('screen-set-password');
        if (spEl) {
          document.getElementById('sp-welcome').textContent = 'ברוכה הבאה, ' + member.name + '! 👋';
          document.getElementById('sp-subtitle').textContent = 'הגדרי סיסמא אישית להתחברות';
          document.getElementById('screen-auth').style.display = 'none';
          spEl.style.display = 'flex';
          setTimeout(function() { document.getElementById('sp-pass').focus(); }, 100);
        }
        return;
      }
    }

    // התחברות רגילה
    if (S.registeredUsers && S.registeredUsers.length) {
      var found = S.registeredUsers.find(function(u) { return u.email && u.email.toLowerCase() === email; });
      if (found) {
        if (found.pass !== pass) { errEl.textContent = 'סיסמה שגויה'; return; }
        S.user = { name: found.name, email: found.email, initials: found.initials, officeName: found.officeName, role: found.role };
        if (typeof enterApp === 'function') enterApp();
        return;
      }
    }

    // כניסה חופשית
    S.user = { name: email.split('@')[0], email: email, initials: email.slice(0,2).toUpperCase(), officeName: S.office ? S.office.name : 'משרד ייעוץ מס' };
    if (typeof enterApp === 'function') enterApp();
  }
  
  btn.addEventListener('click', doEnter);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doEnter();
  });
})();
