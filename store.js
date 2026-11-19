/* Storage adapters. Every adapter keeps the same documents:
 *   m_YYYY-MM   one month: {month, income, incomeNote, items[], planned[]}
 *   debts       {list: [...]} in priority order
 *   categories  {list: [...]}
 * Claude (built-in): the viewer's private subtree data/users/<id>/<doc>.
 * Firebase: Firestore users/<uid>/docs/<doc>, signed in with Google.
 * Local: this browser only (fallback, e.g. opening index.html as a file).
 */
(function () {
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  function ClaudeStore(db, uid) {
    const col = () => db.collection('data/users/' + uid);
    return {
      mode: 'claude',
      label: 'Saved privately in Claude',
      async loadAll() {
        const snap = await withTimeout(col().get(), 10000);
        const out = {};
        snap.docs.forEach((d) => { if (d.exists) out[d.id] = JSON.parse(JSON.stringify(d.data())); });
        return out;
      },
      async save(id, data) { await db.doc('data/users/' + uid + '/' + id).set(data); },
      async remove(id) { await db.doc('data/users/' + uid + '/' + id).delete(); }
    };
  }

  function LocalStore() {
    const KEY = 'ft-data-v1';
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
    const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* storage unavailable */ } };
    return {
      mode: 'local',
      label: 'Saved in this browser only',
      async loadAll() { return read(); },
      async save(id, data) { const o = read(); o[id] = data; write(o); },
      async remove(id) { const o = read(); delete o[id]; write(o); }
    };
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }

  async function FirebaseStore(config) {
    const v = '10.12.2';
    await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-auth-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore-compat.js`);
    const app = firebase.initializeApp(config);
    const auth = firebase.auth(app);
    const fs = firebase.firestore(app);
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* offline cache unavailable in this browser */ }
    let user = auth.currentUser || await new Promise((res) => { const off = auth.onAuthStateChanged((u) => { off(); res(u); }); });
    const col = () => fs.collection('users').doc(user.uid).collection('docs');
    return {
      mode: 'firebase',
      get label() { return user ? 'Synced with Firebase' : 'Sign in to sync'; },
      needsSignIn: () => !user,
      async signIn() { const r = await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); user = r.user; },
      async signOut() { await auth.signOut(); user = null; },
      async loadAll() {
        if (!user) return {};
        const snap = await col().get();
        const out = {}; snap.forEach((d) => { out[d.id] = d.data(); });
        return out;
      },
      // Offline, Firestore keeps the write on the device and sends it later: don't wait on the server for more than a moment.
      async save(id, data) { if (user) await Promise.race([col().doc(id).set(JSON.parse(JSON.stringify(data))), new Promise((res) => setTimeout(res, 4000))]); },
      async remove(id) { if (user) await col().doc(id).delete(); }
    };
  }

  window.FTStore = {
    async open() {
      // 1. Your own hosting with Firebase configured (firebase-config.js sets window.FIREBASE_CONFIG)
      if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) {
        try { return await FirebaseStore(window.FIREBASE_CONFIG); } catch (e) { console.warn('Firebase failed, using this browser', e); return LocalStore(); }
      }
      // 2. Inside Claude: built-in private storage
      if (window.claude && typeof window.claude.use === 'function') {
        try {
          const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
          const uid = user && await user.id();
          if (db && uid) return ClaudeStore(db, uid);
        } catch (e) { console.warn('Built-in storage unavailable', e); }
      }
      // 3. Fallback
      return LocalStore();
    }
  };
})();
